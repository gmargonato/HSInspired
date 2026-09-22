import { CARD_CATALOG, HERO_POWER_CATALOG } from '../../../game/content'
import {
  enumerateLegalCommands,
  canonicalCommandKey,
  type TurnMatchCommand,
  type TurnMatchState
} from '../../../game/match'
import { effectiveBoardMinionKeywords } from '../../../game/match/rules/minion-attack-state'
import type { OpeningMatchAnalysis } from '../../../game/match/opening-match-types'
import type { AiObservation, AiObservedPlayer } from '../../../game/match/ai'
import type {
  AiDecisionApi,
  AiDecisionIdentity,
  AiDecisionRequest,
  AiDecisionResponse,
  JsonObject,
  AiSettings
} from '../../../shared/ipc/ai'
import type { AiDecisionChoice } from '../../../shared/ipc/ai-deliberation'
import { aiActionIntent } from './ai-action-intent'
import { aiActions } from './ai-context'
import { LOCAL_AI_POLICY } from './local-ai-policy'
import type { GameBoardSession } from './game-board-session'

const LOCAL_AI_MODEL_ID = 'hardware-local-v1'
const MAX_THINK_MS = 2_850
const SEQUENCE_THINK_MS = 900
const ROOT_SEARCH_LIMIT = 14
const SEQUENCE_BRANCH_LIMIT = 8
const SEQUENCE_MAX_DEPTH = 7
const SEQUENCE_NODE_LIMIT = 240
const SEQUENCE_ROOT_NODE_LIMIT = 8
const TRACE_CANDIDATE_LIMIT = 8
const RANDOM_SAMPLE_SEEDS = [0x1f123bb5, 0x8a5cd789, 0xc3ef14a1, 0x5eeded42] as const

type LocalAction = ReturnType<typeof aiActions>[number]

/** A compact, serializable explanation of one candidate considered by the CPU search. */
export interface LocalAiCandidateTrace {
  readonly actionId: string
  readonly type: TurnMatchCommand['type']
  readonly description: string
  readonly score: number
  readonly accepted: boolean
  readonly phase: TurnMatchState['phase'] | null
  readonly winnerId: string | null
}

/** Diagnostics for one local decision; kept small enough to persist with a match log. */
export interface LocalAiDecisionTrace {
  readonly requestId: string
  readonly phase: 'plan' | 'action' | 'mulligan'
  readonly durationMs: number
  readonly evaluatedActions: number
  readonly refinedActions: number
  readonly continuations: number
  readonly timedOut: boolean
  readonly baseScore: number | null
  readonly visibleThreat: number | null
  readonly chosenActionId: string | null
  readonly candidates: readonly LocalAiCandidateTrace[]
  readonly chosenSequence?: readonly string[]
  readonly chosenSequenceDepth?: number
  readonly sequenceNodes?: number
  readonly responseScore?: number | null
  readonly sampleCount?: number
  readonly sampleWinRate?: number
}

export type LocalAiTraceListener = (trace: LocalAiDecisionTrace) => void

interface Simulation {
  readonly accepted: boolean
  readonly observation?: AiObservation
  readonly phase?: TurnMatchState['phase']
  readonly winnerId?: TurnMatchState['winnerId']
  readonly score?: number
  readonly sampleCount?: number
  readonly sampleWinRate?: number
}

interface ScoredAction {
  readonly action: LocalAction
  score: number
  readonly reason: string
  readonly simulation: Simulation
  readonly rootPreference?: number
  sequence?: readonly TurnMatchCommand[]
  sequenceLabels?: readonly string[]
  sequenceNodes?: number
  sequenceResponseScore?: number | null
}

interface SequenceSearchResult {
  readonly score: number
  readonly sequence: readonly TurnMatchCommand[]
  readonly labels: readonly string[]
  readonly nodes: number
  readonly responseScore: number | null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function playerValue(player: AiObservedPlayer, turnNumber: number): number {
  const hero = record(player.hero)
  const armor = number(hero.armor)
  const health = number(hero.health)
  const board = player.board.reduce((total, minion) => {
    const entry = record(minion)
    const keywords = effectiveBoardMinionKeywords(minion, turnNumber)
    const keywordValue = keywords.length * LOCAL_AI_POLICY.weights.boardKeyword
    const attack = number(entry.attack)
    const minionHealth = number(entry.health)
    const summonedOnTurn = number(entry.summonedOnTurn, -1)
    const controllerChangedOnTurn = number(entry.controllerChangedOnTurn, -1)
    const frozenUntilTurn = number(entry.frozenUntilTurn, -1)
    const attacksUsed = number(entry.attacksUsedThisTurn)
    const maxAttacks = Math.max(1, number(entry.maxAttacksPerTurn, 1))
    const ready =
      attack > 0 &&
      summonedOnTurn < turnNumber &&
      controllerChangedOnTurn < turnNumber &&
      frozenUntilTurn < turnNumber &&
      attacksUsed < maxAttacks
    const readiness = ready ? 1.2 : 0.35
    return (
      total +
      attack * LOCAL_AI_POLICY.weights.boardAttack * readiness +
      minionHealth * LOCAL_AI_POLICY.weights.boardHealth +
      keywordValue
    )
  }, 0)
  const hand = player.hand.reduce((total, card) => {
    const definition = CARD_CATALOG.get(card.cardId)
    if (!definition) return total
    const body =
      definition.type === 'Minion'
        ? definition.attack * 1.4 + definition.health * 1.1
        : definition.type === 'Weapon'
          ? definition.attack * 1.25 + definition.durability
          : definition.type === 'Hero'
            ? 6
            : 4
    const effect = definition.effects.length * 2
    return total + (body + effect + Math.max(0, 6 - definition.cost)) * 0.22
  }, 0)
  // Opponent card identities remain hidden, but the public hand size is still
  // meaningful card advantage. Never inspect the concealed card IDs here.
  const hiddenHand = Math.max(0, player.handSize - player.hand.length)
  const mana = number(record(player.mana).available)
  const weapon = record(player.weapon)
  const weaponValue = player.weapon
    ? number(weapon.attack) * LOCAL_AI_POLICY.weights.weaponAttack +
      number(weapon.durability) * LOCAL_AI_POLICY.weights.weaponDurability
    : 0
  const secretValue = player.secrets.length * LOCAL_AI_POLICY.weights.secret
  const effects = record(player.effects)
  const overloadLocked = number(record(player.mana).overloadLocked)
  const handOverflow = Math.max(0, player.handSize - 8)
  return (
    health * LOCAL_AI_POLICY.weights.heroHealth +
    armor * LOCAL_AI_POLICY.weights.heroArmor +
    board +
    hand * LOCAL_AI_POLICY.weights.handCard +
    hiddenHand * LOCAL_AI_POLICY.weights.handCard * 0.6 +
    mana * LOCAL_AI_POLICY.weights.manaAvailable +
    weaponValue +
    secretValue +
    Math.min(player.deckSize, 10) * LOCAL_AI_POLICY.weights.deckCard -
    player.fatigueDamage * LOCAL_AI_POLICY.weights.fatigueRisk +
    handOverflow * LOCAL_AI_POLICY.weights.handOverflow +
    number(effects.overload) * LOCAL_AI_POLICY.weights.overloadLocked +
    overloadLocked * LOCAL_AI_POLICY.weights.overloadLocked
  )
}

function stateScore(observation: AiObservation, selfId: string): number {
  const self = observation.players.find((player) => player.participantId === selfId)
  const opponent = observation.players.find((player) => player.participantId !== selfId)
  if (!self || !opponent) return -Infinity
  const selfHero = record(self.hero)
  const opponentHero = record(opponent.hero)
  const selfHealth = number(selfHero.health) + number(selfHero.armor) * 0.7
  const opponentHealth = number(opponentHero.health) + number(opponentHero.armor) * 0.7
  const pressure = (30 - opponentHealth) * LOCAL_AI_POLICY.weights.faceDamage
  const danger = (30 - selfHealth) * LOCAL_AI_POLICY.weights.heroHealth
  return (
    playerValue(self, observation.turnNumber) -
    playerValue(opponent, observation.turnNumber) +
    pressure -
    danger
  )
}

function visibleThreat(
  player: AiObservedPlayer,
  turnNumber = Number.POSITIVE_INFINITY
): number {
  return player.board.reduce((total, minion) => {
    const entry = record(minion)
    if (number(entry.attack) <= 0) return total
    if (number(entry.summonedOnTurn, -1) >= turnNumber) return total
    if (number(entry.controllerChangedOnTurn, -1) >= turnNumber) return total
    if (number(entry.frozenUntilTurn, -1) >= turnNumber) return total
    const keywords = effectiveBoardMinionKeywords(minion, turnNumber)
    if (entry.immune === true || keywords.includes('immune')) return total
    if (
      number(entry.attacksUsedThisTurn) >=
      Math.max(1, number(entry.maxAttacksPerTurn, 1))
    )
      return total
    return total + number(entry.attack)
  }, 0)
}

/** Damage that can currently reach the hero; a visible friendly Taunt blocks face attacks. */
function visibleHeroThreat(
  attacker: AiObservedPlayer,
  defender: AiObservedPlayer,
  turnNumber: number
): number {
  const hasTaunt = defender.board.some((minion) => {
    return effectiveBoardMinionKeywords(minion, turnNumber).includes('taunt')
  })
  if (hasTaunt) return 0

  const hero = record(attacker.hero)
  const heroAttack = number(hero.attack)
  const heroAttacksUsed = number(hero.attacksUsedThisTurn)
  const heroMaxAttacks = Math.max(1, number(hero.maxAttacksPerTurn, 1))
  const frozenUntilTurn = number(hero.frozenUntilTurn, -1)
  const weapon = record(attacker.weapon)
  const weaponAttack = number(weapon.durability) > 0 ? number(weapon.attack) : 0
  const readyHeroAttack =
    heroAttack + weaponAttack > 0 &&
    heroAttacksUsed < heroMaxAttacks &&
    frozenUntilTurn < turnNumber

  return (
    visibleThreat(attacker, turnNumber) +
    (readyHeroAttack ? heroAttack + weaponAttack : 0)
  )
}

/**
 * Builds only public opponent attacks. It deliberately does not enumerate the
 * opponent's hidden hand, secrets, or deck, so response search stays within
 * the same information boundary as the live AI.
 */
function visibleOpponentAttackCommands(
  observation: AiObservation,
  selfId: string
): readonly TurnMatchCommand[] {
  const attacker = observation.players.find((player) => player.role === 'opponent')
  const defender = observation.players.find((player) => player.participantId === selfId)
  if (!attacker || !defender || observation.activePlayerId !== attacker.participantId)
    return []
  const turn = observation.turnNumber
  const allTargets: readonly (
    { kind: 'hero' } | { kind: 'minion'; instanceId: string }
  )[] = [
    { kind: 'hero' },
    ...defender.board.map((minion) => ({
      kind: 'minion' as const,
      instanceId: minion.instanceId
    }))
  ]
  const tauntTargets = defender.board
    .filter((minion) => effectiveBoardMinionKeywords(minion, turn).includes('taunt'))
    .map((minion) => ({
      kind: 'minion' as const,
      instanceId: minion.instanceId
    }))
  const targets = tauntTargets.length > 0 ? tauntTargets : allTargets
  const commands: TurnMatchCommand[] = []
  for (const minion of attacker.board) {
    const attacksUsed = number(minion.attacksUsedThisTurn)
    const maxAttacks = Math.max(1, number(minion.maxAttacksPerTurn, 1))
    if (
      number(minion.attack) <= 0 ||
      number(minion.summonedOnTurn, -1) >= turn ||
      number(minion.controllerChangedOnTurn, -1) >= turn ||
      attacksUsed >= maxAttacks ||
      number(minion.frozenUntilTurn, -1) >= turn
    )
      continue
    for (const defenderRef of targets)
      commands.push({
        type: 'attack-character',
        participantId: attacker.participantId,
        attacker: { kind: 'minion', instanceId: minion.instanceId },
        defender: defenderRef
      })
  }
  const hero = attacker.hero
  const heroAttack = number(hero.attack) + number(attacker.weapon?.attack)
  const heroMaxAttacks = Math.max(1, number(hero.maxAttacksPerTurn, 1))
  if (
    heroAttack > 0 &&
    number(hero.attacksUsedThisTurn) < heroMaxAttacks &&
    number(hero.frozenUntilTurn, -1) < turn
  )
    for (const defenderRef of targets)
      commands.push({
        type: 'attack-character',
        participantId: attacker.participantId,
        attacker: { kind: 'hero' },
        defender: defenderRef
      })
  return commands
}

function containsRandomMechanic(value: unknown): boolean {
  if (typeof value === 'string') return value.toLowerCase().includes('random')
  if (Array.isArray(value)) return value.some(containsRandomMechanic)
  if (value && typeof value === 'object')
    return Object.entries(value).some(
      ([key, nested]) =>
        key.toLowerCase().includes('random') || containsRandomMechanic(nested)
    )
  return false
}

function containsAdjacentMechanic(value: unknown): boolean {
  if (typeof value === 'string') return value.toLowerCase().includes('adjacent')
  if (Array.isArray(value)) return value.some(containsAdjacentMechanic)
  if (value && typeof value === 'object')
    return Object.values(value).some(containsAdjacentMechanic)
  return false
}

/** Finds a board-count threshold that gates a card's conditional effect. */
function requiredBoardCount(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const requirement = requiredBoardCount(entry)
      if (requirement !== null) return requirement
    }
    return null
  }
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  const condition =
    entry.condition && typeof entry.condition === 'object'
      ? (entry.condition as Record<string, unknown>)
      : null
  if (
    condition?.type === 'event-player-had-minion-count' &&
    (condition.operator === 'gte' || condition.operator === 'gt')
  ) {
    const threshold = number(condition.value, NaN)
    if (Number.isFinite(threshold))
      return condition.operator === 'gt' ? threshold + 1 : threshold
  }
  for (const [key, nested] of Object.entries(entry)) {
    if (key === 'condition') continue
    const requirement = requiredBoardCount(nested)
    if (requirement !== null) return requirement
  }
  return null
}

/**
 * Avoids spending mana on a conditional minion before its public prerequisite
 * is true. This is deliberately a small bias: lethal/removal signals still
 * outrank it, while cheap setup cards can be explored first in a turn plan.
 */
function conditionalBoardBias(
  cardId: string,
  state: TurnMatchState,
  participantId: string
): number {
  const definition = CARD_CATALOG.get(cardId)
  if (!definition) return 0
  const threshold = requiredBoardCount(definition.effects)
  if (threshold === null) return 0
  const boardCount =
    state.players.find((player) => player.participantId === participantId)?.board
      .length ?? 0
  return boardCount >= threshold ? 18 : -(threshold - boardCount) * 100
}

function hasRandomText(cardId: string): boolean {
  const definition = CARD_CATALOG.get(cardId)
  if (!definition) return false
  return (
    containsRandomMechanic({
      name: definition.name,
      rulesText: definition.rulesText,
      effects: definition.effects
    }) || /adapt/.test(`${definition.name} ${definition.rulesText}`.toLowerCase())
  )
}

function cardScore(cardId: string): number {
  const definition = CARD_CATALOG.get(cardId)
  if (!definition) return 0
  const body =
    definition.type === 'Minion'
      ? definition.attack * 1.5 + definition.health * 1.2
      : definition.type === 'Weapon'
        ? definition.attack * 1.4 + definition.durability
        : definition.type === 'Hero'
          ? 12
          : 5
  const mechanics =
    `${definition.rulesText} ${JSON.stringify(definition.effects)}`.toLowerCase()
  const utility =
    (mechanics.includes('discover') ? 10 : 0) +
    (mechanics.includes('draw') ? 5 : 0) +
    (mechanics.includes('destroy') || mechanics.includes('remove') ? 10 : 0) +
    (mechanics.includes('damage') ? 4 : 0) +
    (mechanics.includes('restore') || mechanics.includes('heal') ? 4 : 0) +
    (mechanics.includes('summon') ? 4 : 0) +
    (mechanics.includes('choose one') ? 3 : 0)
  return body + definition.effects.length * 3 + utility - definition.cost * 0.7
}

function choiceOptionBias(
  pending: NonNullable<TurnMatchState['pendingCardChoice']>,
  option: NonNullable<TurnMatchState['pendingCardChoice']>['options'][number],
  before: AiObservation,
  selfId: string
): number {
  const self = before.players.find((player) => player.participantId === selfId)
  const opponent = before.players.find((player) => player.participantId !== selfId)
  if (!self || !opponent) return 0
  const presentationId = option.presentationCardId
  const definition = presentationId ? CARD_CATALOG.get(presentationId) : undefined
  const text = `${definition?.name ?? option.label} ${definition?.rulesText ?? ''}`.toLowerCase()

  if (pending.resolution?.type === 'adapt') {
    const target = self.board.find(
      (minion) => minion.instanceId === pending.resolution?.targetInstanceId
    )
    if (!target) return 0
    const enemyMinions = opponent.board
    const enemyHeroHealth = number(opponent.hero.health) + number(opponent.hero.armor)
    const targetAttack = number(target.attack)
    const targetHealth = number(target.health)
    const largestEnemyAttack = Math.max(
      0,
      ...enemyMinions.map((minion) => number(minion.attack))
    )
    if (text.includes('windfury')) {
      return enemyHeroHealth <= targetAttack * 2
        ? 25_000
        : targetAttack * 18
    }
    if (text.includes('poisonous')) {
      return enemyMinions.length > 0 ? 1_800 : -20
    }
    if (text.includes('divine shield')) {
      const canTrade = enemyMinions.some(
        (minion) => targetAttack >= number(minion.health)
      )
      const wouldDie = largestEnemyAttack >= targetHealth
      return canTrade && wouldDie ? 1_800 : 80
    }
    if (text.includes('taunt')) {
      const visibleThreat = visibleHeroThreat(opponent, self, before.turnNumber)
      return visibleThreat >= number(self.hero.health) ? 1_800 : 60
    }
  }

  if (pending.sourceCardId === 'classic_druid_of_the_claw') {
    const target = self.board.find(
      (minion) => minion.instanceId === pending.sourceCardInstanceId
    )
    if (target && text.includes('charge')) {
      return number(opponent.hero.health) <= number(target.attack) ? 25_000 : 120
    }
    if (target && text.includes('taunt')) {
      const visibleThreat = visibleHeroThreat(opponent, self, before.turnNumber)
      return visibleThreat >= number(self.hero.health) ? 3_000 : 90
    }
  }

  if (pending.sourceCardId === 'classic_nourish') {
    if (text.includes('mana')) {
      const available = number(record(self.mana).available)
      const hasNearTermPlay = self.hand.some((card) => {
        const cardDefinition = CARD_CATALOG.get(card.cardId)
        const cost = number(card.currentCost, cardDefinition?.cost ?? 99)
        return cost > available && cost <= available + 2
      })
      return hasNearTermPlay ? 600 : 40
    }
    if (text.includes('draw'))
      return self.deckSize >= 3 ? 20 : -120
  }

  return 0
}

function commandReason(
  action: LocalAction,
  simulation: Simulation,
  score: number,
  selfId: string
): string {
  if (simulation.winnerId === selfId) return 'This line wins the game immediately.'
  if (simulation.winnerId) return 'This line loses immediately and is rejected.'
  if (action.command.type === 'end-turn')
    return 'End the turn after preserving the best current position.'
  if (action.command.type === 'attack-character')
    return 'Take the highest value legal combat line.'
  if (action.command.type === 'play-card')
    return 'Improve board, resources, or immediate interaction.'
  if (action.command.type === 'use-hero-power')
    return 'Use the hero power when its current value exceeds saving mana.'
  if (action.command.type === 'choose-discover-card')
    return 'Choose the strongest fair visible option.'
  if (action.command.type === 'choose-card-option')
    return 'Choose the option with the best current value.'
  return `Select the highest scored legal action (${Math.round(score)}).`
}

function mulliganReplace(
  session: GameBoardSession,
  self: AiObservedPlayer,
  state: TurnMatchState
): readonly string[] {
  const hand = self.hand
  const ordered = hand.map((card) => {
    const definition = CARD_CATALOG.get(card.cardId)
    const cost = card.currentCost ?? definition?.cost ?? 99
    const body =
      definition?.type === 'Minion' ? definition.attack + definition.health : 0
    const keep =
      cost <= 2
        ? 100 + body
        : cost === 3
          ? 60 + body
          : cost === 4
            ? 12 + body * 0.4
            : -cost * 7 + body * 0.2
    return { ref: card.instanceId, cost, keep }
  })
  const low = ordered.filter((entry) => entry.cost <= 2).length
  const keepCount =
    low === ordered.length
      ? ordered.length
      : low > 0
        ? Math.min(3, low + 1)
        : 1
  const keep = new Set(
    [...ordered]
      .sort((left, right) => right.keep - left.keep)
      .filter((entry) => entry.keep > 0)
      .slice(0, keepCount)
      .map((entry) => entry.ref)
  )
  return ordered.filter((entry) => !keep.has(entry.ref)).map((entry) => entry.ref)
}

function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Offline CPU opponent. It consumes the same fair observation boundary as the
 * remote controller and uses isolated engine forks for tactical lookahead.
 */
export class LocalAiDecisionApi implements AiDecisionApi {
  private readonly cancelled = new Set<string>()
  private lastTrace: LocalAiDecisionTrace | null = null

  constructor(
    private readonly session: GameBoardSession,
    private readonly onTrace?: LocalAiTraceListener
  ) {}

  /** Returns the last completed search for development diagnostics and scenario tests. */
  getLastTrace(): LocalAiDecisionTrace | null {
    return this.lastTrace
  }

  async settings(): Promise<AiSettings> {
    return {
      enabled: true,
      provider: 'none',
      modelId: LOCAL_AI_MODEL_ID,
      reasoningEffort: 'none',
      maxCompletionTokens: 1,
      maxContextBytes: 200_000
    }
  }

  async decide(request: AiDecisionRequest): Promise<AiDecisionResponse> {
    const started = performance.now()
    await yieldToRenderer()
    if (this.cancelled.delete(request.requestId))
      throw new Error('AI request cancelled.')

    if (request.phase === 'mulligan') {
      const state = this.session.getState()
      const observation = this.session.getAiObservation()
      const self = observation.players.find((player) => player.role === 'self')
      if (!self) throw new Error('Local AI cannot find its fair player observation.')
      const replace = mulliganReplace(this.session, self, state)
      this.publishTrace({
        requestId: request.requestId,
        phase: 'mulligan',
        durationMs: performance.now() - started,
        evaluatedActions: self.hand.length,
        refinedActions: 0,
        continuations: 0,
        timedOut: false,
        baseScore: null,
        visibleThreat: null,
        chosenActionId: null,
        candidates: []
      })
      return this.response(
        request,
        {
          replace,
          planUpdate: null
        },
        'Keep the best early curve and replace slow opening cards.',
        started,
        this.lastTrace
      )
    }

    const legal = enumerateLegalCommands(
      {
        getState: () => this.session.getState(),
        getPlayInput: this.session.match.getPlayInput!,
        getLegality: this.session.match.getLegality!
      },
      this.session.remoteParticipantId
    )
    if (!legal.length) throw new Error('Local AI has no legal command.')
    const actions = aiActions(this.session, legal)
    const search = await this.chooseAction(
      actions,
      request.requestId,
      request.phase === 'plan' ? 'plan' : 'action'
    )
    if (!search) throw new Error('Local AI could not score a legal command.')
    const { best } = search

    if (request.phase === 'plan') {
      return this.response(
        request,
        {
          plan: {
            objective: best.reason,
            winCheck:
              'Take an immediate win when the engine proves one; otherwise improve the position.',
            lossRisk:
              'Recheck visible damage and preserve enough health for the opponent turn.',
            candidates: [
              {
                sequence: (best.sequenceLabels ?? [best.action.description]).map(
                  (label) => label.slice(0, 580)
                ),
                budget:
                  'Replan after each public result; preserve this sequence only while its prerequisites remain legal.',
                endPosition: 'Keep the resulting board and hand advantage.',
                opponentReply:
                  'Compare the opponent’s visible attacks and public board before ending the turn.'
              }
            ],
            preferred: 0,
            firstActionId: best.action.id,
            checks: []
          }
        },
        best.reason,
        started,
        this.lastTrace
      )
    }

    const choice = {
      actionId: best.action.id,
      intent: aiActionIntent(best.action.command, this.session.localParticipantId),
      expectedResult: best.reason,
      planUpdate: null
    } satisfies AiDecisionChoice
    return this.response(request, choice, best.reason, started, this.lastTrace)
  }

  async cancel(identity: AiDecisionIdentity): Promise<void> {
    this.cancelled.add(identity.requestId)
  }

  private async chooseAction(
    actions: readonly LocalAction[],
    requestId: string,
    phase: 'plan' | 'action'
  ): Promise<{ best: ScoredAction; trace: LocalAiDecisionTrace } | null> {
    const started = performance.now()
    const deadline = started + Math.min(MAX_THINK_MS, SEQUENCE_THINK_MS)
    const current = this.session.getAiObservation()
    const baseScore = stateScore(current, this.session.remoteParticipantId)
    const currentSelf = current.players.find(
      (player) => player.participantId === this.session.remoteParticipantId
    )
    const currentOpponent = current.players.find(
      (player) => player.participantId !== this.session.remoteParticipantId
    )
    const threat =
      currentOpponent && currentSelf
        ? visibleHeroThreat(currentOpponent, currentSelf, current.turnNumber)
        : 0
    const currentHero = record(currentSelf?.hero)
    const currentHealth = number(currentHero.health) + number(currentHero.armor)
    const scored: ScoredAction[] = []

    for (const [index, action] of actions.entries()) {
      if (performance.now() >= deadline) break
      if (index > 0 && index % 8 === 0) {
        await yieldToRenderer()
        if (this.cancelled.has(requestId)) return null
      }
      let simulation: Simulation
      try {
        if (this.isBeneficialHeroPowerAgainstOpponent(action.command, current))
          continue
        simulation = this.simulate(action.command)
      } catch {
        // A single unsupported/complex effect must not abandon the whole turn.
        continue
      }
      if (!simulation.accepted || !simulation.observation) continue

      const rootPreference = this.commandScore(
        action.command,
        currentSelf,
        simulation.observation,
        current
      )
      let score =
        (simulation.score ??
          this.scoreObservation(simulation.observation, simulation.winnerId)) -
        baseScore
      score += rootPreference
      const afterSelf = simulation.observation.players.find(
        (player) => player.participantId === this.session.remoteParticipantId
      )
      const afterHero = record(afterSelf?.hero)
      const afterHealth = number(afterHero.health) + number(afterHero.armor)
      const afterOpponent = simulation.observation.players.find(
        (player) => player.participantId !== this.session.remoteParticipantId
      )
      const threatAfter =
        afterOpponent && afterSelf
          ? visibleHeroThreat(
              afterOpponent,
              afterSelf,
              simulation.observation!.turnNumber
            )
          : 0
      if (threat >= currentHealth && threatAfter < threat)
        score += (threat - threatAfter) * LOCAL_AI_POLICY.weights.preventVisibleLethal
      if (threat >= currentHealth && afterHealth > currentHealth)
        score += LOCAL_AI_POLICY.weights.preventVisibleLethal
      if (threat >= currentHealth && afterHealth <= currentHealth - 4)
        score -= LOCAL_AI_POLICY.weights.preventVisibleLethal
      const currentOpponentBoard = currentOpponent?.board.length ?? 0
      const afterOpponentBoard = afterOpponent?.board.length ?? 0
      const currentSelfBoard = currentSelf?.board.length ?? 0
      const afterSelfBoard = afterSelf?.board.length ?? 0
      score +=
        Math.max(0, currentOpponentBoard - afterOpponentBoard) *
        LOCAL_AI_POLICY.weights.enemyBoardRemoval
      score +=
        Math.max(0, currentSelfBoard - afterSelfBoard) *
        LOCAL_AI_POLICY.weights.friendlyMinionLoss

      scored.push({
        action,
        score,
        reason: commandReason(
          action,
          simulation,
          score,
          this.session.remoteParticipantId
        ),
        simulation,
        rootPreference,
        sequence: [action.command],
        sequenceLabels: [action.description]
      })
    }
    if (!scored.length) return null

    scored.sort((left, right) => right.score - left.score)
    const sequenceCandidates = scored.slice(0, ROOT_SEARCH_LIMIT)
    const passCandidate = scored.find(
      (candidate) => candidate.action.command.type === 'end-turn'
    )
    if (passCandidate && !sequenceCandidates.includes(passCandidate))
      sequenceCandidates.push(passCandidate)
    const sequenceStats = await this.searchSequences(
      sequenceCandidates,
      baseScore,
      deadline,
      requestId
    )
    for (const candidate of sequenceCandidates) {
      const result = sequenceStats.get(candidate.action.id)
      if (!result) continue
      // A deeper line may improve the position, but it must not erase the
      // root action's hard tactical signals (lethal, removal, or survival).
      candidate.score = Math.max(
        candidate.score,
        result.score + (candidate.rootPreference ?? 0)
      )
      candidate.sequence = result.sequence
      candidate.sequenceLabels = result.labels
      candidate.sequenceNodes = result.nodes
      candidate.sequenceResponseScore = result.responseScore
    }
    scored.sort((left, right) => right.score - left.score)
    const best = scored[0]
    if (!best) return null
    const trace: LocalAiDecisionTrace = {
      requestId,
      phase,
      durationMs: performance.now() - started,
      evaluatedActions: scored.length,
      refinedActions: sequenceCandidates.length,
      continuations: sequenceStats.size,
      timedOut: performance.now() >= deadline,
      baseScore,
      visibleThreat: threat,
      chosenActionId: best.action.id,
      chosenSequence: best.sequenceLabels,
      chosenSequenceDepth: best.sequence?.length,
      sequenceNodes: best.sequenceNodes,
      responseScore: best.sequenceResponseScore ?? null,
      sampleCount: best.simulation.sampleCount,
      sampleWinRate: best.simulation.sampleWinRate,
      candidates: scored.slice(0, TRACE_CANDIDATE_LIMIT).map((candidate) => ({
        actionId: candidate.action.id,
        type: candidate.action.command.type,
        description: candidate.action.description.slice(0, 180),
        score: Math.round(candidate.score * 100) / 100,
        accepted: candidate.simulation.accepted,
        phase: candidate.simulation.phase ?? null,
        winnerId: candidate.simulation.winnerId ?? null
      }))
    }
    this.publishTrace(trace)
    return { best, trace }
  }

  private scoreObservation(
    observation: AiObservation,
    winnerId: TurnMatchState['winnerId'] | undefined
  ): number {
    const score = stateScore(observation, this.session.remoteParticipantId)
    if (winnerId === this.session.remoteParticipantId)
      return (
        score +
        LOCAL_AI_POLICY.weights.terminalWin +
        LOCAL_AI_POLICY.weights.immediateLethal
      )
    if (winnerId) return score + LOCAL_AI_POLICY.weights.terminalLoss
    return score
  }

  private async searchSequences(
    roots: readonly ScoredAction[],
    baseScore: number,
    deadline: number,
    requestId: string
  ): Promise<Map<string, SequenceSearchResult>> {
    const results = new Map<string, SequenceSearchResult>()
    let nodes = 0
    let rootNodes = 0
    const selfId = this.session.remoteParticipantId

    const update = (
      root: ScoredAction,
      sequence: readonly TurnMatchCommand[],
      labels: readonly string[],
      fork: OpeningMatchAnalysis,
      responseScore: number | null
    ): void => {
      const state = fork.getState()
      const observation = fork.getAiObservation?.(selfId, 'fair')
      if (!observation) return
      const ownScore = this.scoreObservation(observation, state.winnerId)
      let score = (responseScore === null ? ownScore : responseScore) - baseScore
      if (state.winnerId === selfId)
        score += Math.max(0, SEQUENCE_MAX_DEPTH - sequence.length) * 20_000
      const previous = results.get(root.action.id)
      if (!previous || score > previous.score)
        results.set(root.action.id, {
          score,
          sequence,
          labels,
          nodes,
          responseScore
        })
    }

    const visit = (
      root: ScoredAction,
      fork: OpeningMatchAnalysis,
      sequence: readonly TurnMatchCommand[],
      labels: readonly string[],
      depth: number
    ): void => {
      if (
        nodes >= SEQUENCE_NODE_LIMIT ||
        rootNodes >= SEQUENCE_ROOT_NODE_LIMIT ||
        performance.now() >= deadline ||
        this.cancelled.has(requestId)
      )
        return
      nodes++
      rootNodes++
      const state = fork.getState()
      const observation = fork.getAiObservation?.(selfId, 'fair')
      if (!observation) return
      const last = sequence[sequence.length - 1]
      const shouldStop =
        state.phase === 'ended' ||
        state.activePlayerId !== selfId ||
        last?.type === 'end-turn' ||
        depth >= SEQUENCE_MAX_DEPTH
      if (shouldStop) {
        const response =
          state.phase === 'turns' && state.activePlayerId !== selfId
            ? this.scoreVisibleOpponentResponse(fork, observation, deadline)
            : null
        update(root, sequence, labels, fork, response)
        return
      }

      const commands = enumerateLegalCommands(fork, selfId)
      if (!commands.length) {
        update(root, sequence, labels, fork, null)
        return
      }
      const orderedAll = this.orderSequenceCommands(commands, fork)
      const ordered = orderedAll.slice(0, SEQUENCE_BRANCH_LIMIT)
      const pass = orderedAll.find((command) => command.type === 'end-turn')
      if (pass && !ordered.includes(pass)) ordered.push(pass)
      for (const command of ordered) {
        if (nodes >= SEQUENCE_NODE_LIMIT || performance.now() >= deadline) break
        const label = this.commandLabel(fork, command)
        fork.analyze((child) => {
          const result = child.dispatch(command)
          if (!result.accepted) return
          visit(root, child, [...sequence, command], [...labels, label], depth + 1)
        })
      }
    }

    for (const root of roots) {
      if (
        nodes >= SEQUENCE_NODE_LIMIT ||
        performance.now() >= deadline ||
        this.cancelled.has(requestId)
      )
        break
      try {
        rootNodes = 0
        this.session.match.analyze((fork) => {
          fork.analyze((child) => {
            const result = child.dispatch(root.action.command)
            if (!result.accepted) return
            visit(root, child, [root.action.command], [root.action.description], 1)
          })
        })
      } catch {
        // A complex effect may fail in analysis; the root action remains usable.
      }
      await yieldToRenderer()
    }

    return results
  }

  private isBeneficialHeroPowerAgainstOpponent(
    command: TurnMatchCommand,
    observation: AiObservation
  ): boolean {
    if (command.type !== 'use-hero-power' || !command.target) return false
    const self = observation.players.find(
      (player) => player.participantId === this.session.remoteParticipantId
    )
    const power = self ? HERO_POWER_CATALOG.get(self.heroPower.id) : undefined
    return (
      power?.effect.kind === 'restore-character' &&
      command.target.participantId !== this.session.remoteParticipantId
    )
  }

  private orderSequenceCommands(
    commands: readonly TurnMatchCommand[],
    fork: OpeningMatchAnalysis
  ): readonly TurnMatchCommand[] {
    return [...commands].sort((left, right) => {
      const priority = (command: TurnMatchCommand): number => {
        if (command.type === 'end-turn') return -100
        if (command.type === 'attack-character')
          return command.defender.kind === 'hero' ? 40 : 32
        if (command.type === 'play-card') {
          const cardId = this.cardIdForCommand(command, fork.getState())
          const definition = CARD_CATALOG.get(cardId)
          const position = command.position ?? 0
          const boardLength =
            fork
              .getState()
              .players.find(
                (player) => player.participantId === this.session.remoteParticipantId
              )?.board.length ?? 0
          const adjacentNeighbors =
            command.position !== undefined &&
            definition &&
            containsAdjacentMechanic(definition.effects)
              ? Math.min(command.position, boardLength - command.position)
              : 0
          return (
            60 +
            (definition ? cardScore(definition.id) : 0) +
            (definition
              ? conditionalBoardBias(
                  definition.id,
                  fork.getState(),
                  this.session.remoteParticipantId
                )
              : 0) +
            adjacentNeighbors * 12 +
            (position === 0 ? 0.01 : 0)
          )
        }
        if (command.type === 'use-hero-power') return 28
        return 8
      }
      return (
        priority(right) - priority(left) ||
        canonicalCommandKey(left).localeCompare(canonicalCommandKey(right))
      )
    })
  }

  private scoreVisibleOpponentResponse(
    fork: OpeningMatchAnalysis,
    observation: AiObservation,
    deadline: number
  ): number | null {
    const responses = visibleOpponentAttackCommands(
      observation,
      this.session.remoteParticipantId
    )
    if (!responses.length) return null
    let worst = Number.POSITIVE_INFINITY
    for (const response of responses) {
      if (performance.now() >= deadline) break
      const score = fork.analyze((child) => {
        const result = child.dispatch(response)
        if (!result.accepted) return null
        const after = child.getAiObservation?.(this.session.remoteParticipantId, 'fair')
        return after ? this.scoreObservation(after, result.state.winnerId) : null
      })
      if (score !== null) worst = Math.min(worst, score)
    }
    return Number.isFinite(worst) ? worst : null
  }

  private simulate(command: TurnMatchCommand): Simulation {
    const cardId = this.cardIdForCommand(command, this.session.getState())
    if (cardId && hasRandomText(cardId)) return this.simulateRandom(command)
    return this.session.match.analyze((fork) => {
      const result = fork.dispatch(command)
      if (!result.accepted) return { accepted: false }
      const observation = fork.getAiObservation?.(
        this.session.remoteParticipantId,
        'fair'
      )
      return {
        accepted: true,
        observation,
        phase: result.state.phase,
        winnerId: result.state.winnerId,
        score: observation
          ? this.scoreObservation(observation, result.state.winnerId)
          : undefined,
        sampleCount: 1,
        sampleWinRate:
          result.state.winnerId === this.session.remoteParticipantId ? 1 : 0
      }
    })
  }

  private simulateRandom(command: TurnMatchCommand): Simulation {
    const samples: {
      observation: AiObservation
      winnerId: TurnMatchState['winnerId']
    }[] = []
    for (const seed of RANDOM_SAMPLE_SEEDS) {
      const sample = this.session.match.analyzeWithSeed(seed, (fork) => {
        const result = fork.dispatch(command)
        if (!result.accepted) return null
        const observation = fork.getAiObservation?.(
          this.session.remoteParticipantId,
          'fair'
        )
        return observation ? { observation, winnerId: result.state.winnerId } : null
      })
      if (sample) samples.push(sample)
    }
    if (!samples.length) return { accepted: false }
    const scores = samples.map((sample) =>
      this.scoreObservation(sample.observation, sample.winnerId)
    )
    const wins = samples.filter(
      (sample) => sample.winnerId === this.session.remoteParticipantId
    ).length
    return {
      accepted: true,
      observation: samples[0]!.observation,
      phase: samples[0]!.observation.phase,
      winnerId: wins === samples.length ? this.session.remoteParticipantId : undefined,
      score: scores.reduce((total, score) => total + score, 0) / scores.length,
      sampleCount: samples.length,
      sampleWinRate: wins / samples.length
    }
  }

  private cardIdForCommand(
    command: TurnMatchCommand,
    state = this.session.getState()
  ): string {
    if (command.type === 'play-card') {
      const card = this.session
        .findPlayer(state, this.session.remoteParticipantId)
        .hand.find((entry) => entry.instanceId === command.cardInstanceId)
      return card?.cardId ?? ''
    }
    return ''
  }

  private commandLabel(fork: OpeningMatchAnalysis, command: TurnMatchCommand): string {
    if (command.type === 'play-card') {
      const cardId = this.cardIdForCommand(command, fork.getState())
      const name = CARD_CATALOG.get(cardId)?.name ?? cardId
      const position =
        command.position === undefined ? '' : ` at slot ${command.position}`
      return `play ${name}${position}`
    }
    if (command.type === 'attack-character') {
      const attacker =
        command.attacker.kind === 'hero' ? 'hero' : command.attacker.instanceId
      const defender =
        command.defender.kind === 'hero' ? 'enemy hero' : command.defender.instanceId
      return `attack ${defender} with ${attacker}`
    }
    if (command.type === 'use-hero-power') return 'use hero power'
    if (command.type === 'choose-discover-card')
      return `choose discover ${command.cardInstanceId}`
    if (command.type === 'choose-card-option') return `choose option ${command.choice}`
    return command.type
  }

  private commandScore(
    command: TurnMatchCommand,
    self: AiObservedPlayer | undefined,
    after: AiObservation,
    before: AiObservation
  ): number {
    if (!self) return 0
    const beforeMana = number(record(self.mana).available)
    const afterSelf = after.players.find(
      (entry) => entry.participantId === this.session.remoteParticipantId
    )
    const afterMana = number(record(afterSelf?.mana).available)
    const spentMana = Math.max(0, beforeMana - afterMana)
    const score = spentMana * LOCAL_AI_POLICY.weights.spentMana
    if (command.type === 'end-turn') return score
    if (command.type === 'attack-character' && command.defender.kind === 'minion') {
      const beforeOpponent = before.players.find(
        (entry) => entry.participantId !== this.session.remoteParticipantId
      )
      const beforeSelf = before.players.find(
        (entry) => entry.participantId === this.session.remoteParticipantId
      )
      const afterSelf = after.players.find(
        (entry) => entry.participantId === this.session.remoteParticipantId
      )
      const afterOpponent = after.players.find(
        (entry) => entry.participantId !== this.session.remoteParticipantId
      )
      const beforeTarget = beforeOpponent?.board.find(
        (entry) =>
          command.defender.kind === 'minion' &&
          entry.instanceId === command.defender.instanceId
      )
      const afterTarget = afterOpponent?.board.find(
        (entry) =>
          command.defender.kind === 'minion' &&
          entry.instanceId === command.defender.instanceId
      )
      const targetDamage = Math.max(
        0,
        number(beforeTarget?.health) - number(afterTarget?.health)
      )
      const losesFriendlyMinion =
        (afterSelf?.board.length ?? 0) < (beforeSelf?.board.length ?? 0)
      const attacker = beforeSelf?.board.find(
        (entry) =>
          command.attacker.kind === 'minion' &&
          entry.instanceId === command.attacker.instanceId
      )
      const attackerIsPoisonous =
        attacker !== undefined &&
        effectiveBoardMinionKeywords(attacker, before.turnNumber).includes('poisonous')
      const removesEnemyMinion =
        (afterOpponent?.board.length ?? 0) < (beforeOpponent?.board.length ?? 0)
      const attackerDefinition = attacker
        ? CARD_CATALOG.get(attacker.cardId)
        : undefined
      const hasFriendlyBeastDeathPayoff =
        beforeSelf?.board.some((entry) => {
          if (entry.instanceId === attacker?.instanceId) return false
          const definition = CARD_CATALOG.get(entry.cardId)
          const rulesText = definition?.rulesText.toLowerCase() ?? ''
          return (
            definition?.subtype === 'Beast' &&
            rulesText.includes('friendly beast') &&
            rulesText.includes('dies')
          )
        }) === true
      const feedsFriendlyBeastDeathPayoff =
        losesFriendlyMinion &&
        attackerDefinition?.subtype === 'Beast' &&
        hasFriendlyBeastDeathPayoff
      const targetHealthAfterAttack = number(afterTarget?.health)
      const setsUpImmediateRemoval =
        !attackerIsPoisonous &&
        losesFriendlyMinion &&
        beforeSelf !== undefined &&
        beforeSelf.board.length >= 5 &&
        targetDamage > 0 &&
        targetHealthAfterAttack > 0 &&
        beforeSelf.board.some(
          (entry) =>
            entry.instanceId !== attacker?.instanceId &&
            number(entry.attack) >= targetHealthAfterAttack
        )
      const waitsForFriendlyBeastDeath =
        attackerDefinition?.rulesText.toLowerCase().includes('friendly beast') === true &&
        attackerDefinition.rulesText.toLowerCase().includes('dies') === true &&
        (beforeSelf?.board.some(
          (entry) =>
            entry.instanceId !== attacker?.instanceId &&
            CARD_CATALOG.get(entry.cardId)?.subtype === 'Beast'
        ) ?? false)
      const handDefinitions = self.hand
        .map((card) => CARD_CATALOG.get(card.cardId))
        .filter((definition): definition is NonNullable<typeof definition> => definition !== undefined)
      const healingReplacementCost = handDefinitions.find((definition) => {
        const text = definition.rulesText.toLowerCase()
        return text.includes('restore') && text.includes('damage') && text.includes('instead')
      })?.cost
      const healingAreaCost = handDefinitions.find((definition) => {
        const text = definition.rulesText.toLowerCase()
        return text.includes('all minions') && text.includes('restore')
      })?.cost
      const activeHealingReplacement = beforeSelf?.board.some((entry) => {
        const text = CARD_CATALOG.get(entry.cardId)?.rulesText.toLowerCase() ?? ''
        return text.includes('restore') && text.includes('damage') && text.includes('instead')
      }) === true
      const holdsForHealingAreaClear =
        (beforeOpponent?.board.length ?? 0) >= 2 &&
        healingAreaCost !== undefined &&
        (activeHealingReplacement ||
          (healingReplacementCost !== undefined &&
            beforeMana >= healingReplacementCost + healingAreaCost))
      const hasFrostLichJaina = self.hand.some(
        (card) => card.cardId === 'knights_of_the_frozen_throne_frost_lich_jaina'
      )
      const holdsElementalForFrostLich =
        hasFrostLichJaina &&
        beforeMana >= 9 &&
        attacker?.cardId === 'basic_water_elemental'
      return (
        score +
        (removesEnemyMinion
          ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 10
          : 0) -
        (waitsForFriendlyBeastDeath
          ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 20
          : 0) +
        (setsUpImmediateRemoval
          ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 12
          : 0) +
        (feedsFriendlyBeastDeathPayoff
          ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 4
          : 0) +
        (holdsForHealingAreaClear ? -140 : 0) +
        (holdsElementalForFrostLich
          ? -LOCAL_AI_POLICY.weights.immediateLethal * 0.5
          : 0) +
        targetDamage * LOCAL_AI_POLICY.weights.enemyBoardRemoval * 2 +
        (losesFriendlyMinion && !attackerIsPoisonous
          ? LOCAL_AI_POLICY.weights.friendlyMinionLoss * 5
          : 0)
      )
    }
    if (command.type === 'attack-character' && command.defender.kind === 'hero') {
      const beforeSelf = before.players.find(
        (entry) => entry.participantId === this.session.remoteParticipantId
      )
      const beforeOpponent = before.players.find(
        (entry) => entry.participantId !== this.session.remoteParticipantId
      )
      const afterOpponent = after.players.find(
        (entry) => entry.participantId !== this.session.remoteParticipantId
      )
      const selfHealth =
        number(record(beforeSelf?.hero).health) + number(record(beforeSelf?.hero).armor)
      const hasLiveEnemyBoard = (beforeOpponent?.board.length ?? 0) > 0
      const leavesEnemyBoard =
        (afterOpponent?.board.length ?? 0) < (beforeOpponent?.board.length ?? 0)
      const isLethal = (afterOpponent?.hero.health ?? 1) <= 0
      return (
        score +
        LOCAL_AI_POLICY.weights.faceDamage * 2 +
        (hasLiveEnemyBoard && selfHealth <= 6 && !leavesEnemyBoard && !isLethal
          ? -LOCAL_AI_POLICY.weights.preventVisibleLethal * 0.25
          : 0)
      )
    }
    if (command.type === 'play-card') {
      const selfState = this.session.findPlayer(
        this.session.getState(),
        this.session.remoteParticipantId
      )
      const card = selfState.hand.find(
        (entry) => entry.instanceId === command.cardInstanceId
      )
      if (!card) return score
      if (card.cardId === 'basic_the_coin') return score - 8
      const definition = CARD_CATALOG.get(card.cardId)
      let targetBias = 0
      const beforeSelf = before.players.find(
        (entry) => entry.participantId === this.session.remoteParticipantId
      )
      const cthunProgress = beforeSelf?.effects.cthun
      const hasCthunPayoff = beforeSelf?.hand.some(
        (entry) => entry.cardId === 'whispers_of_the_old_gods_cthun'
      )
      if (
        hasCthunPayoff &&
        cthunProgress !== undefined &&
        JSON.stringify(definition?.effects ?? '').toLowerCase().includes('buff-cthun') &&
        cthunProgress.attack < 10
      )
        targetBias += 600
      const beforeOpponent = before.players.find(
        (entry) => entry.participantId !== this.session.remoteParticipantId
      )
      const hasPreResetTrade =
        beforeSelf?.board.some((entry) => number(entry.attack) >= 5) === true &&
        beforeOpponent?.board.some((target) => number(target.health) <= 5) === true
      if (
        card.cardId === 'knights_of_the_frozen_throne_shadowreaper_anduin' &&
        hasPreResetTrade
      )
        targetBias -= LOCAL_AI_POLICY.weights.immediateLethal * 0.8
      const hasHiddenSecret =
        beforeOpponent?.secrets.some((secret) => !secret.revealed) === true
      const doomsayer = beforeOpponent?.board.find(
        (entry) => entry.cardId === 'classic_doomsayer'
      )
      const hasCheapSecretProbe = self.hand.some((entry) => {
        if (entry.cardId === 'basic_the_coin') return true
        const candidate = CARD_CATALOG.get(entry.cardId)
        return candidate?.type === 'Minion' && candidate.cost <= 4
      })
      const targetsEnemyMinion = command.targets?.some(
        (target) =>
          target.kind === 'minion' &&
          target.participantId !== this.session.remoteParticipantId
      )
      const rulesText = definition?.rulesText.toLowerCase() ?? ''
      const targetsFriendlyMinion = command.targets?.some(
        (target) =>
          target.kind === 'minion' &&
          target.participantId === this.session.remoteParticipantId
      )
      if (
        targetsFriendlyMinion &&
        rulesText.includes('return') &&
        rulesText.includes('friendly minion')
      )
        targetBias += 300
      const hasDamagedFriendlyMinion = self.board.some(
        (minion) => number(minion.health) < number(minion.maxHealth)
      )
      const isHealingDrawEngine =
        definition?.type === 'Minion' &&
        rulesText.includes('heal') &&
        rulesText.includes('draw')
      if (isHealingDrawEngine && hasDamagedFriendlyMinion) targetBias += 150
      if (
        doomsayer &&
        definition?.type === 'Minion' &&
        !(definition.keywords.includes('charge') && definition.attack >= number(doomsayer.health))
      )
        targetBias -= LOCAL_AI_POLICY.weights.preventVisibleLethal
      if (hasHiddenSecret) {
        if (card.cardId === 'basic_the_coin') targetBias += 500
        else if (definition?.type === 'Minion' && definition.cost <= 4)
          targetBias += 220
        else if (targetsEnemyMinion && definition?.type === 'Spell')
          targetBias += 320
        else if (
          hasCheapSecretProbe &&
          definition?.type === 'Spell' &&
          command.targets?.some((target) => target.kind === 'hero')
        )
          targetBias -= 280
        else if (hasCheapSecretProbe && definition?.type === 'Minion' && definition.cost >= 6)
          targetBias -= 220
      }
      for (const target of command.targets ?? []) {
        if (target.kind !== 'minion') continue
        const beforePlayer = before.players.find(
          (entry) => entry.participantId === target.participantId
        )
        const afterPlayer = after.players.find(
          (entry) => entry.participantId === target.participantId
        )
        const beforeTarget = beforePlayer?.board.find(
          (entry) => entry.instanceId === target.instanceId
        )
        const afterTarget = afterPlayer?.board.find(
          (entry) => entry.instanceId === target.instanceId
        )
        if (!beforeTarget) continue
        if (target.participantId === this.session.remoteParticipantId) {
          const attackGain =
            number(afterTarget?.attack) - number(beforeTarget.attack)
          const healthGain =
            number(afterTarget?.health) - number(beforeTarget.health)
          if (attackGain > 0)
            targetBias +=
              attackGain * LOCAL_AI_POLICY.weights.boardAttack * 12
          if (healthGain > 0)
            targetBias +=
              healthGain * LOCAL_AI_POLICY.weights.boardHealth * 12
          if (rulesText.includes('deathrattle'))
            targetBias += 30 +
              (number(beforeTarget.attack) + number(beforeTarget.health)) * 2
          const effectText = definition ? JSON.stringify(definition.effects).toLowerCase() : ''
          if (effectText.includes('grant-deathrattle') && effectText.includes('return-to-play'))
            targetBias += 100
          // A targeted transform of our own developed body is usually a
          // severe loss of board value; do not let a temporary Taunt hide it.
          if (afterTarget && afterTarget.cardId !== beforeTarget.cardId)
            targetBias -= LOCAL_AI_POLICY.weights.preventVisibleLethal * 6
        } else {
          const suppressesEnemyText =
            afterTarget?.silenced === true && beforeTarget.silenced !== true
          if (suppressesEnemyText) {
            targetBias += LOCAL_AI_POLICY.weights.enemyBoardRemoval * 10
          } else if (
            (!afterTarget || afterTarget.cardId !== beforeTarget.cardId) &&
            card.currentCost <= 2
          ) {
            // A cheap targeted removal can preserve a ready body for the next
            // trade; give it a modest tempo edge without overpowering lethal.
            targetBias += LOCAL_AI_POLICY.weights.enemyBoardRemoval * 12
          }
        }
      }
      const adjacentNeighbors =
        command.position !== undefined &&
        definition &&
        containsAdjacentMechanic(definition.effects)
          ? Math.min(command.position, self.board.length - command.position)
          : 0
      return (
        score +
        cardScore(card.cardId) +
        targetBias +
        conditionalBoardBias(
          card.cardId,
          this.session.getState(),
          this.session.remoteParticipantId
        ) +
        adjacentNeighbors * 12
      )
    }
    if (command.type === 'choose-discover-card') {
      const candidate = this.session
        .getState()
        .pendingDiscover?.candidates.find(
          (entry) => entry.instanceId === command.cardInstanceId
        )
      return score + (candidate ? cardScore(candidate.cardId) * 1.8 : 0)
    }
    if (command.type === 'choose-card-option') {
      const option = this.session
        .getState()
        .pendingCardChoice?.options.find((entry) => entry.choice === command.choice)
      return (
        score +
        (option?.presentationCardId ? cardScore(option.presentationCardId) : 4) +
        (option
          ? choiceOptionBias(
              this.session.getState().pendingCardChoice!,
              option,
              before,
              this.session.remoteParticipantId
            )
          : 0)
      )
    }
    if (command.type === 'use-hero-power') {
      const player = after.players.find(
        (entry) => entry.participantId === this.session.remoteParticipantId
      )
      const power = player ? HERO_POWER_CATALOG.get(player.heroPower.id) : undefined
      const beforeSelf = before.players.find(
        (entry) => entry.participantId === this.session.remoteParticipantId
      )
      const beforeOpponent = before.players.find(
        (entry) => entry.participantId !== this.session.remoteParticipantId
      )
      const healingDrawOpportunity =
        beforeSelf?.hand.some((card) => {
          const definition = CARD_CATALOG.get(card.cardId)
          const text = definition?.rulesText.toLowerCase() ?? ''
          return definition?.type === 'Minion' && text.includes('heal') && text.includes('draw')
        }) === true &&
        beforeSelf?.board.some(
          (minion) => number(minion.health) < number(minion.maxHealth)
        ) === true
      const afterOpponent = after.players.find(
        (entry) => entry.participantId !== this.session.remoteParticipantId
      )
      const selfHealth =
        number(record(beforeSelf?.hero).health) + number(record(beforeSelf?.hero).armor)
      const visibleThreatValue =
        beforeOpponent && beforeSelf
          ? visibleHeroThreat(beforeOpponent, beforeSelf, before.turnNumber)
          : 0
      const targetsEnemyHero = command.target?.kind === 'hero'
      const targetMinion = command.target?.kind === 'minion' ? command.target : undefined
      const beforeTargetOwner = targetMinion
        ? before.players.find(
            (entry) => entry.participantId === targetMinion.participantId
          )
        : undefined
      const afterTargetOwner = targetMinion
        ? after.players.find(
            (entry) => entry.participantId === targetMinion.participantId
          )
        : undefined
      const beforeTarget = beforeTargetOwner?.board.find(
        (entry) => entry.instanceId === targetMinion?.instanceId
      )
      const afterTarget = afterTargetOwner?.board.find(
        (entry) => entry.instanceId === targetMinion?.instanceId
      )
      const targetsFriendlyMinion =
        targetMinion?.participantId === this.session.remoteParticipantId
      const targetHealthGain = Math.max(
        0,
        number(afterTarget?.health) - number(beforeTarget?.health)
      )
      const targetsEnemyMinion =
        targetMinion !== undefined &&
        targetMinion.participantId !== this.session.remoteParticipantId
      const removesEnemyMinion = targetsEnemyMinion && !afterTarget
      const consumesEnemyDivineShield =
        targetsEnemyMinion &&
        beforeTarget?.divineShield === true &&
        afterTarget?.divineShield !== true
      const enemyTargetValue = beforeTarget
        ? number(beforeTarget.attack) * LOCAL_AI_POLICY.weights.boardAttack +
          number(beforeTarget.health) * LOCAL_AI_POLICY.weights.boardHealth +
          effectiveBoardMinionKeywords(beforeTarget, before.turnNumber).length *
            LOCAL_AI_POLICY.weights.boardKeyword
        : 0
      const leavesEnemyBoard =
        (afterOpponent?.board.length ?? 0) < (beforeOpponent?.board.length ?? 0)
      const isLethal = (afterOpponent?.hero.health ?? 1) <= 0
      const hiddenSecretProbe =
        beforeOpponent?.secrets.some((secret) => !secret.revealed) === true &&
        targetsEnemyMinion &&
        number(beforeTarget?.health) <= 1
      const weakestHiddenSecretProbe =
        hiddenSecretProbe && number(beforeTarget?.attack) <= 1
      return (
        score +
        (power ? 3 : 0) +
        (removesEnemyMinion
          ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 12
          : consumesEnemyDivineShield
            ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 4 + enemyTargetValue * 3
            : 0) +
        (hiddenSecretProbe ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 50 : 0) +
        (weakestHiddenSecretProbe ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 25 : 0) +
        (targetsFriendlyMinion
          ? targetHealthGain * LOCAL_AI_POLICY.weights.boardHealth * 12
          : 0) +
        (healingDrawOpportunity && targetsEnemyHero ? -180 : 0) +
        (targetsEnemyHero &&
        visibleThreatValue >= selfHealth &&
        !leavesEnemyBoard &&
        !isLethal
          ? -LOCAL_AI_POLICY.weights.preventVisibleLethal * 0.5
          : 0)
      )
    }
    return score
  }

  private response(
    request: AiDecisionRequest,
    choice: AiDecisionChoice,
    reason: string,
    started: number,
    trace: LocalAiDecisionTrace | null
  ): AiDecisionResponse {
    return {
      matchId: request.matchId,
      requestId: request.requestId,
      expectedRevision: request.expectedRevision,
      modelId: LOCAL_AI_MODEL_ID,
      reason: reason.slice(0, 580),
      choice,
      durationMs: performance.now() - started,
      finishReason: 'local-search',
      ...(trace
        ? {
            usage: {
              mode: 'local-search',
              trace: traceAsJson(trace)
            }
          }
        : {})
    }
  }

  private publishTrace(trace: LocalAiDecisionTrace): void {
    this.lastTrace = trace
    try {
      this.onTrace?.(trace)
    } catch {
      // Diagnostics are deliberately non-authoritative and must never abort a turn.
    }
  }
}

function traceAsJson(trace: LocalAiDecisionTrace): JsonObject {
  return JSON.parse(JSON.stringify(trace)) as JsonObject
}
