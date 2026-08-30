import type { Deck } from '../../../game/decks'
import { CARD_CATALOG, type CardDefinition } from '../../../game/content/cards'
import { HERO_CATALOG } from '../../../game/content/heroes'
import { HERO_POWER_CATALOG } from '../../../game/content/hero-powers'
import type {
  AttackCharacterRef,
  CardPlayTargetRef,
  ConfirmMulliganCommand,
  OpeningCard,
  PlayCardInput,
  PlayerId,
  TurnMatchCommand,
  TurnMatchState
} from '../../../game/match'
import type {
  AiActionKind,
  AiDecisionApi,
  AiDecisionRequest,
  AiDecisionResponse,
  AiLegalAction,
  JsonObject
} from '../../../shared/ipc/ai'
import type { RendererLogger } from '../../ui/logger'
import type { GameBoardSession } from './game-board-session'

interface CandidateAction {
  readonly public: AiLegalAction
  readonly command: TurnMatchCommand
}

export interface AiActionDecision {
  readonly expectedRevision: number
  readonly actionId: string
  readonly command: TurnMatchCommand
  readonly source: 'model' | 'fallback'
}

interface AiTurnControllerOptions {
  readonly api?: AiDecisionApi
  readonly session: GameBoardSession
  readonly decks: readonly Deck[]
  readonly logger: RendererLogger
}

const MAX_STRATEGY_SUMMARY_LENGTH = 4000

function toJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

function compactCardDefinition(definition: CardDefinition): JsonObject {
  return toJsonObject({
    id: definition.id,
    name: definition.name,
    type: definition.type,
    cardClass: definition.cardClass,
    subtype: definition.subtype,
    spellSchool: definition.spellSchool,
    cost: definition.cost,
    rulesText: definition.rulesText,
    keywords: definition.keywords,
    effects: definition.effects,
    ...(definition.type === 'Minion'
      ? { attack: definition.attack, health: definition.health }
      : {}),
    ...(definition.type === 'Weapon'
      ? { attack: definition.attack, durability: definition.durability }
      : {}),
    ...(definition.type === 'Hero'
      ? { armor: definition.armor, replacementHeroId: definition.replacementHeroId }
      : {})
  })
}

function cardName(cardId: string | null | undefined): string {
  if (!cardId) return 'hidden card'
  return CARD_CATALOG.get(cardId)?.name ?? cardId
}

function cardSnapshot(card: OpeningCard): JsonObject {
  return toJsonObject({
    ...card,
    instanceId: card.instanceId,
    cardId: card.cardId,
    name: cardName(card.cardId)
  })
}

function collectReferencedCardIds(
  value: unknown,
  result = new Set<string>()
): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectReferencedCardIds(entry, result)
    return result
  }
  if (typeof value !== 'object' || value === null) return result
  for (const [key, entry] of Object.entries(value)) {
    if ((key === 'cardId' || key.endsWith('CardId')) && typeof entry === 'string') {
      result.add(entry)
    }
    if ((key === 'cardIds' || key.endsWith('CardIds')) && Array.isArray(entry)) {
      for (const cardId of entry) {
        if (typeof cardId === 'string') result.add(cardId)
      }
    }
    collectReferencedCardIds(entry, result)
  }
  return result
}

function targetKey(target: CardPlayTargetRef): string {
  return target.kind === 'hero'
    ? `hero:${target.participantId}`
    : `${target.kind}:${target.participantId}:${target.instanceId}`
}

function targetAssignments(
  input: PlayCardInput
): readonly (readonly CardPlayTargetRef[])[] {
  if (input.targetSelectors.length === 0) return [[]]
  const assignments: CardPlayTargetRef[][] = []
  const visit = (
    index: number,
    selected: CardPlayTargetRef[],
    used: Set<string>
  ): void => {
    if (index >= input.legalTargetOptions.length) {
      assignments.push([...selected])
      return
    }
    for (const target of input.legalTargetOptions[index] ?? []) {
      const key = targetKey(target)
      if (used.has(key)) continue
      used.add(key)
      selected.push(target)
      visit(index + 1, selected, used)
      selected.pop()
      used.delete(key)
    }
  }
  visit(0, [], new Set())
  return assignments
}

function describeAttackCharacter(
  ref: AttackCharacterRef,
  ownerId: PlayerId,
  state: TurnMatchState
): string {
  if (ref.kind === 'hero') {
    const heroId = state.players.find(
      (player) => player.participantId === ownerId
    )?.heroId
    return heroId ? HERO_CATALOG.require(heroId).displayName : 'hero'
  }
  for (const player of state.players) {
    const minion = player.board.find(
      (candidate) => candidate.instanceId === ref.instanceId
    )
    if (minion) return `${cardName(minion.cardId)} (${minion.attack}/${minion.health})`
  }
  return ref.instanceId
}

function describeCardTarget(target: CardPlayTargetRef, state: TurnMatchState): string {
  const owner = state.players.find(
    (player) => player.participantId === target.participantId
  )
  const side = target.participantId === state.activePlayerId ? 'friendly' : 'enemy'
  if (target.kind === 'hero') {
    return `${side} ${owner ? HERO_CATALOG.require(owner.heroId).displayName : 'hero'}`
  }
  if (target.kind === 'minion') {
    const minion = owner?.board.find(
      (candidate) => candidate.instanceId === target.instanceId
    )
    return `${side} ${minion ? cardName(minion.cardId) : target.instanceId}`
  }
  if (target.kind === 'weapon') return `${side} weapon ${target.instanceId}`
  if (target.kind === 'secret') return `${side} secret ${target.instanceId}`
  return `${side} ${cardName(target.cardId)} from ${target.zone ?? 'card zone'}`
}

function attackCharacterSnapshot(
  ref: AttackCharacterRef,
  ownerId: PlayerId,
  state: TurnMatchState,
  selfId: PlayerId
): JsonObject {
  const player = state.players.find((candidate) => candidate.participantId === ownerId)
  if (!player) return toJsonObject({ kind: ref.kind, participantId: ownerId })
  const role = ownerId === selfId ? 'self' : 'opponent'
  if (ref.kind === 'hero') {
    return toJsonObject({
      kind: 'hero',
      participantId: ownerId,
      role,
      heroId: player.heroId,
      name: HERO_CATALOG.require(player.heroId).displayName,
      hero: player.hero,
      weapon: player.weapon
    })
  }
  const minion = player.board.find(
    (candidate) => candidate.instanceId === ref.instanceId
  )
  return toJsonObject({
    kind: 'minion',
    participantId: ownerId,
    role,
    instanceId: ref.instanceId,
    ...(minion
      ? { name: cardName(minion.cardId), minion }
      : { name: 'stale minion reference' })
  })
}

function cardTargetSnapshot(
  target: CardPlayTargetRef,
  state: TurnMatchState,
  selfId: PlayerId
): JsonObject {
  const player = state.players.find(
    (candidate) => candidate.participantId === target.participantId
  )
  const role = target.participantId === selfId ? 'self' : 'opponent'
  if (!player) return toJsonObject({ ...target, role })
  if (target.kind === 'hero') {
    return toJsonObject({
      ...target,
      role,
      heroId: player.heroId,
      name: HERO_CATALOG.require(player.heroId).displayName,
      hero: player.hero,
      weapon: player.weapon
    })
  }
  if (target.kind === 'minion') {
    const minion = player.board.find(
      (candidate) => candidate.instanceId === target.instanceId
    )
    return toJsonObject({
      ...target,
      role,
      name: minion ? cardName(minion.cardId) : 'stale minion reference',
      minion: minion ?? null
    })
  }
  if (target.kind === 'weapon') {
    return toJsonObject({
      ...target,
      role,
      name: cardName(player.weapon?.cardId),
      weapon: player.weapon
    })
  }
  if (target.kind === 'secret') {
    const secret = player.secrets?.find(
      (candidate) => candidate.instanceId === target.instanceId
    )
    return toJsonObject({
      ...target,
      role,
      name: cardName(secret?.cardId),
      secret: secret ?? null
    })
  }
  const card = [
    ...player.deck,
    ...player.hand,
    ...(player.revealedCards ?? []),
    ...(player.discardedCards ?? [])
  ].find((candidate) => candidate.instanceId === target.instanceId)
  return toJsonObject({
    ...target,
    role,
    name: cardName(card?.cardId ?? target.cardId),
    card: card ?? null
  })
}

function isPermanentProviderError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    message.includes('ai configuration') ||
    message.includes('key is missing') ||
    message.includes('external game ai is disabled') ||
    message.includes('http 400') ||
    message.includes('http 401') ||
    message.includes('http 403') ||
    message.includes('http 404')
  )
}

export class AiTurnController {
  private strategySummary = ''
  private decisionSequence = 0
  private providerDisabled = false

  constructor(private readonly options: AiTurnControllerOptions) {}

  async chooseMulligan(): Promise<AiActionDecision> {
    return this.choose('mulligan', this.mulliganCandidates())
  }

  async chooseTurnAction(): Promise<AiActionDecision> {
    return this.choose('turn', this.turnCandidates())
  }

  private mulliganCandidates(): readonly CandidateAction[] {
    const state = this.options.session.getState()
    const player = this.options.session.findPlayer(
      state,
      this.options.session.remoteParticipantId
    )
    const candidates: CandidateAction[] = []
    for (let mask = 0; mask < 1 << player.hand.length; mask += 1) {
      const cards = player.hand.filter((_card, index) => (mask & (1 << index)) !== 0)
      const id = `mulligan-${mask}`
      const command: ConfirmMulliganCommand = {
        type: 'confirm-mulligan',
        participantId: this.options.session.remoteParticipantId,
        replaceInstanceIds: cards.map((card) => card.instanceId)
      }
      candidates.push({
        command,
        public: {
          id,
          kind: 'confirm-mulligan',
          description:
            cards.length === 0
              ? 'Keep the entire opening hand.'
              : `Replace ${cards.map((card) => cardName(card.cardId)).join(', ')}.`,
          details: toJsonObject({
            replaceInstanceIds: command.replaceInstanceIds,
            cards: cards.map(cardSnapshot)
          })
        }
      })
    }
    return candidates
  }

  private turnCandidates(): readonly CandidateAction[] {
    const state = this.options.session.getState()
    const participantId = this.options.session.remoteParticipantId
    const player = this.options.session.findPlayer(state, participantId)
    if (state.pendingDiscover?.participantId === participantId) {
      return state.pendingDiscover.candidates.map((card, index) => ({
        command: {
          type: 'choose-discover-card',
          participantId,
          cardInstanceId: card.instanceId
        },
        public: {
          id: `discover-${index}`,
          kind: 'choose-discover-card',
          description: `Choose ${cardName(card.cardId)} from Discover.`,
          details: toJsonObject({ card: cardSnapshot(card) })
        }
      }))
    }
    const legality = this.options.session.match.getLegality?.(participantId)
    if (!legality) throw new Error('The match engine does not expose legal AI actions.')
    const candidates: CandidateAction[] = []
    let sequence = 0
    const add = (
      kind: AiActionKind,
      description: string,
      details: unknown,
      command: TurnMatchCommand
    ): void => {
      candidates.push({
        command,
        public: {
          id: `action-${sequence++}`,
          kind,
          description,
          details: toJsonObject(details)
        }
      })
    }

    for (const cardInstanceId of legality.playableCardInstanceIds) {
      const card = player.hand.find(
        (candidate) => candidate.instanceId === cardInstanceId
      )
      if (!card) continue
      const baseInput = this.options.session.match.getPlayInput?.(
        participantId,
        cardInstanceId
      )
      if (!baseInput) continue
      const choices = baseInput.choiceCount > 0 ? baseInput.legalChoices : [undefined]
      for (const choice of choices) {
        const input =
          choice === undefined
            ? baseInput
            : this.options.session.match.getPlayInput?.(
                participantId,
                cardInstanceId,
                choice
              )
        if (!input) continue
        const positions = input.requiresPosition ? input.legalPositions : [undefined]
        for (const position of positions) {
          for (const targets of targetAssignments(input)) {
            const command: TurnMatchCommand = {
              type: 'play-card',
              participantId,
              cardInstanceId,
              ...(position === undefined ? {} : { position }),
              ...(targets.length === 0 ? {} : { targets }),
              ...(choice === undefined ? {} : { choice })
            }
            const choiceIndex =
              choice === undefined ? -1 : input.legalChoices.indexOf(choice)
            const choiceLabel =
              choiceIndex < 0 ? undefined : input.choiceLabels[choiceIndex]
            const targetLabels = targets.map((target) =>
              describeCardTarget(target, state)
            )
            add(
              'play-card',
              [
                `Play ${cardName(card.cardId)} for ${input.currentCost} mana`,
                choiceLabel ? `choose ${choiceLabel}` : '',
                position === undefined ? '' : `at board position ${position}`,
                targetLabels.length === 0 ? '' : `targeting ${targetLabels.join(', ')}`
              ]
                .filter(Boolean)
                .join('; '),
              {
                card: cardSnapshot(card),
                choice: choiceLabel ?? null,
                position: position ?? null,
                targets,
                targetLabels,
                targetSnapshots: targets.map((target) =>
                  cardTargetSnapshot(target, state, participantId)
                )
              },
              command
            )
          }
        }
      }
    }

    const opponentId = state.players.find(
      (candidate) => candidate.participantId !== participantId
    )?.participantId
    if (opponentId) {
      for (const [attackerId, targets] of Object.entries(legality.legalAttackTargets)) {
        const attacker: AttackCharacterRef =
          attackerId === `${participantId}:hero`
            ? { kind: 'hero' }
            : { kind: 'minion', instanceId: attackerId }
        for (const defender of targets) {
          add(
            'attack-character',
            `${describeAttackCharacter(attacker, participantId, state)} attacks ${describeAttackCharacter(defender, opponentId, state)}.`,
            {
              attacker,
              defender,
              attackerSnapshot: attackCharacterSnapshot(
                attacker,
                participantId,
                state,
                participantId
              ),
              defenderSnapshot: attackCharacterSnapshot(
                defender,
                opponentId,
                state,
                participantId
              )
            },
            {
              type: 'attack-character',
              participantId,
              attacker,
              defender
            }
          )
        }
      }
    }

    if (legality.legalHeroPower) {
      const power = HERO_POWER_CATALOG.require(player.heroPower.id)
      const targets =
        legality.legalHeroPowerTargets.length === 0
          ? [undefined]
          : legality.legalHeroPowerTargets
      for (const target of targets) {
        add(
          'use-hero-power',
          `Use ${power.displayName}${target ? ` on ${describeCardTarget(target, state)}` : ''}.`,
          {
            heroPower: power,
            target: target ?? null,
            targetSnapshot: target
              ? cardTargetSnapshot(target, state, participantId)
              : null
          },
          {
            type: 'use-hero-power',
            participantId,
            ...(target ? { target } : {})
          }
        )
      }
    }

    if (legality.canEndTurn) {
      add('end-turn', 'End the current turn.', {}, { type: 'end-turn', participantId })
    }
    return candidates
  }

  private gameState(phase: 'mulligan' | 'turn'): JsonObject {
    const state = this.options.session.getState()
    const recentEvents = this.options.session.getAiObservedEvents()
    const selfId = this.options.session.remoteParticipantId
    const opponentId = this.options.session.localParticipantId
    const {
      history: _history,
      effectTrace: _effectTrace,
      nextEntityOrdinal: _nextEntityOrdinal,
      pendingResolution: _pendingResolution,
      scheduledEffects: _scheduledEffects,
      turnStartedAtRevision: _turnStartedAtRevision,
      ...gameplayState
    } = state
    void _history
    void _effectTrace
    void _nextEntityOrdinal
    void _pendingResolution
    void _scheduledEffects
    void _turnStartedAtRevision

    const referencedIds = collectReferencedCardIds(gameplayState)
    collectReferencedCardIds(recentEvents, referencedIds)
    for (const deck of this.options.decks) {
      for (const cardId of Object.keys(deck.cards)) referencedIds.add(cardId)
    }
    const cardDefinitions = Object.fromEntries(
      [...referencedIds]
        .map((cardId) => CARD_CATALOG.get(cardId))
        .filter((definition): definition is CardDefinition => definition !== undefined)
        .map((definition) => [definition.id, compactCardDefinition(definition)])
    )
    const legality = this.options.session.match.getLegality?.(selfId)
    const participants = state.players.map((player) => {
      const role = player.participantId === selfId ? 'self' : 'opponent'
      const hero = HERO_CATALOG.require(player.heroId)
      const heroPower = HERO_POWER_CATALOG.require(player.heroPower.id)
      return {
        participantId: player.participantId,
        role,
        playerNumber: player.playerNumber,
        heroDefinition: hero,
        heroPowerDefinition: heroPower,
        tacticalSummary: {
          effectiveHealth: player.hero.health + player.hero.armor,
          health: player.hero.health,
          armor: player.hero.armor,
          manaAvailable: player.mana.available,
          manaMaximum: player.mana.maximum,
          handSize: player.hand.length,
          remainingDeckSize: player.deck.length,
          nextFatigueDamage: player.fatigueDamage,
          boardSize: player.board.length,
          openBoardSlots: Math.max(0, 7 - player.board.length),
          totalBoardAttack: player.board.reduce(
            (total, minion) => total + minion.attack,
            0
          ),
          totalBoardHealth: player.board.reduce(
            (total, minion) => total + minion.health,
            0
          ),
          secretCount: player.secrets?.length ?? 0,
          graveyardSize: player.graveyard?.length ?? 0,
          weapon: player.weapon,
          heroPower: player.heroPower,
          ...(role === 'self' && legality
            ? {
                playableCardInstanceIds: legality.playableCardInstanceIds,
                legalAttackerInstanceIds: legality.legalAttackerInstanceIds,
                heroPowerLegal: legality.legalHeroPower,
                canEndTurn: legality.canEndTurn
              }
            : {})
        }
      }
    })
    const originalDecks = state.players.map((player) => {
      const participant = this.options.session.match.setup.participants.find(
        (candidate) => candidate.participantId === player.participantId
      )
      const deck = this.options.decks.find(
        (candidate) => candidate.id === participant?.deckId
      )
      if (!deck) throw new Error(`Deck unavailable for ${player.participantId}.`)
      return {
        participantId: player.participantId,
        role: player.participantId === selfId ? 'self' : 'opponent',
        id: deck.id,
        name: deck.name,
        heroId: deck.heroId,
        cards: Object.entries(deck.cards).map(([cardId, count]) => ({
          cardId,
          count
        }))
      }
    })
    return toJsonObject({
      contextVersion: 2,
      informationPolicy: 'omniscient',
      perspective: {
        selfParticipantId: selfId,
        opponentParticipantId: opponentId,
        selfController: 'remote-ai',
        opponentController: 'local-human',
        hiddenHandsKnown: true,
        hiddenSecretsKnown: true,
        exactRemainingDeckOrderKnown: true
      },
      phase,
      stateConventions: {
        remainingDeckOrder:
          'Each player.deck array is exact and top-first; index 0 is the next draw.',
        actionGranularity:
          'Select one legal atomic action. A fresh resolved state follows.',
        authority:
          'Structured runtime state, card effects, and legal actions override display rulesText.'
      },
      originalDecks,
      participants,
      cardDefinitions,
      currentState: gameplayState,
      recentAuthoritativeEvents: recentEvents
    })
  }

  private fallback(candidates: readonly CandidateAction[]): CandidateAction {
    const keep = candidates.find(
      (candidate) =>
        candidate.public.kind === 'confirm-mulligan' &&
        Array.isArray(candidate.public.details['replaceInstanceIds']) &&
        candidate.public.details['replaceInstanceIds'].length === 0
    )
    if (keep) return keep
    return (
      candidates.find((candidate) => candidate.public.kind === 'play-card') ??
      candidates.find(
        (candidate) => candidate.public.kind === 'choose-discover-card'
      ) ??
      candidates.find((candidate) => candidate.public.kind === 'attack-character') ??
      candidates.find((candidate) => candidate.public.kind === 'use-hero-power') ??
      candidates.find((candidate) => candidate.public.kind === 'end-turn') ??
      candidates[0]!
    )
  }

  private logResponse(request: AiDecisionRequest, response: AiDecisionResponse): void {
    if (!import.meta.env.DEV) return
    if (!response.debug) {
      this.options.logger.info(`[Game AI] response ${request.decisionId}`, {
        actionId: response.actionId,
        strategicIntent: response.strategicIntent,
        rationale: response.rationale,
        strategySummary: response.strategySummary,
        modelId: response.modelId
      })
      return
    }
    console.groupCollapsed(
      `[Game AI] response ${request.decisionId}: ${response.actionId} (${response.debug.durationMs} ms)`
    )
    console.info('Game decision request', request)
    console.info('Model decision', {
      actionId: response.actionId,
      strategicIntent: response.strategicIntent,
      rationale: response.rationale,
      strategySummary: response.strategySummary,
      modelId: response.modelId
    })
    console.info('Provider request', {
      url: response.debug.url,
      body: response.debug.requestBody
    })
    console.info('Provider response', response.debug.responseBody)
    console.info('Provider duration (ms)', response.debug.durationMs)
    console.groupEnd()
  }

  private async choose(
    phase: 'mulligan' | 'turn',
    candidates: readonly CandidateAction[]
  ): Promise<AiActionDecision> {
    if (candidates.length === 0)
      throw new Error(`No legal AI actions exist for ${phase}.`)
    const expectedRevision = this.options.session.getState().revision
    const request: AiDecisionRequest = {
      decisionId: `${phase}-${expectedRevision}-${this.decisionSequence++}`,
      phase,
      matchRevision: expectedRevision,
      strategySummary: this.strategySummary,
      gameState: this.gameState(phase),
      legalActions: candidates.map((candidate) => candidate.public)
    }
    const fallback = this.fallback(candidates)
    if (!this.options.api || this.providerDisabled) {
      return {
        expectedRevision,
        actionId: fallback.public.id,
        command: fallback.command,
        source: 'fallback'
      }
    }

    try {
      const response = await this.options.api.decide(request)
      this.logResponse(request, response)
      const selected = candidates.find(
        (candidate) => candidate.public.id === response.actionId
      )
      if (!selected)
        throw new Error(`Model selected stale action ${response.actionId}.`)
      this.strategySummary = response.strategySummary.slice(
        0,
        MAX_STRATEGY_SUMMARY_LENGTH
      )
      return {
        expectedRevision,
        actionId: selected.public.id,
        command: selected.command,
        source: 'model'
      }
    } catch (error) {
      if (isPermanentProviderError(error)) this.providerDisabled = true
      this.options.logger.warn(
        `[Game AI] ${request.decisionId} failed; using local fallback`,
        error
      )
      return {
        expectedRevision,
        actionId: fallback.public.id,
        command: fallback.command,
        source: 'fallback'
      }
    }
  }
}
