import {
  CARD_CATALOG,
  isCardEffectObject,
  type CardDefinition
} from '../../content/cards'
import { HERO_POWER_CATALOG } from '../../content/hero-powers'
import type {
  AttackCharacterRef,
  CardPlayTargetRef,
  OpeningMatchInstance,
  OpeningMatchState,
  OpeningMatchCommand as TurnMatchCommand
} from '../opening-match-types'
import type { PlayerId } from '../match-types'
import type {
  AiCandidateDossier,
  AiSearchLimits,
  AiStrategicPlanView,
  AiTacticalProofKind
} from './ai-types'
import { evaluatePosition } from './evaluator'
import {
  activeParticipant,
  canonicalCommandKey,
  enumerateLegalCommands
} from './legal-commands'
import { hashAiState, AiTranspositionCache } from './state-hash'
import {
  classifyTacticalLine,
  proveGuaranteedLethal,
  type AiTacticalSolveLimits
} from './tactics'
import {
  commandTestsFacedownSecret,
  commandUsesUncertainty,
  immediateCardEffects
} from './uncertainty'

export interface AiSearchRootAction {
  readonly actionId: string
  readonly command: TurnMatchCommand
}

export interface AiStrategicSearchOptions {
  /**
   * When false, skip the fair-coverage baseline pass. The caller must already
   * hold baseline dossiers for these roots from an earlier pass (used by the
   * controller's round-robin deepening rounds).
   */
  readonly baselinePass?: boolean
  /** Return after guaranteed root baselines without expanding continuations. */
  readonly baselineOnly?: boolean
}

export interface AiStrategicSearchResult {
  readonly dossiers: readonly AiCandidateDossier[]
  readonly exploredNodes: number
  readonly cacheHits: number
  readonly partial: boolean
  readonly elapsedMs: number
}

interface SearchLine {
  readonly commands: readonly TurnMatchCommand[]
  readonly state: OpeningMatchState
  readonly score: number
  readonly completeTurn: boolean
  readonly usesUncertainty: boolean
  readonly stopsAtTurnHandoff?: boolean
  readonly boundaryEvaluation?: Readonly<{
    readonly score: number
    readonly components: AiCandidateDossier['evaluation']
  }>
  readonly boundaryResourceUsage?: AiCandidateDossier['resourceUsage']
}

interface TurnExpansion {
  readonly complete: readonly SearchLine[]
  readonly partial: readonly SearchLine[]
  readonly incomplete: boolean
}

/**
 * Tactical proofs that can justify direct damage to the AI hero or friendly
 * minions. A self-harm line carrying one of these is a real tactical outcome
 * (lethal, survival, or a board swing), not destructive waste.
 */
const COMPENSATING_PROOF_KINDS: ReadonlySet<AiTacticalProofKind> = new Set([
  'guaranteed-lethal',
  'forced-survival',
  'board-clear',
  'efficient-trade',
  'required-combo-sequence'
])

function simulate(
  match: OpeningMatchInstance,
  commands: readonly TurnMatchCommand[]
): Readonly<{ readonly accepted: boolean; readonly state: OpeningMatchState }> {
  return match.analyze((fork) => {
    let state = fork.getState()
    for (const command of commands) {
      const result = fork.dispatch(command)
      state = result.state
      if (!result.accepted) return { accepted: false, state }
    }
    return { accepted: true, state }
  })
}

function legalAfter(
  match: OpeningMatchInstance,
  commands: readonly TurnMatchCommand[],
  participantId: PlayerId
): readonly TurnMatchCommand[] {
  return match.analyze((fork) => {
    for (const command of commands) {
      if (!fork.dispatch(command).accepted) return []
    }
    return enumerateLegalCommands(fork, participantId)
  })
}

function producesNewDecisionInformation(value: unknown): boolean {
  return /discover|generate|draw/.test(JSON.stringify(value ?? []).toLowerCase())
}

function authoredInformationCount(value: unknown): number {
  if (Array.isArray(value))
    return value.reduce((total, entry) => total + authoredInformationCount(entry), 0)
  if (typeof value !== 'object' || value === null) return 0
  const record = value as Record<string, unknown>
  let count = 0
  if (record['kind'] === 'draw-and-self-damage') {
    count += typeof record['count'] === 'number' ? Math.max(1, record['count']) : 1
  }
  if (
    record['player'] !== 'opponent' &&
    (record['action'] === 'draw' ||
      record['action'] === 'draw-until' ||
      record['action'] === 'discover' ||
      (record['action'] === 'add-to-hand' && record['source'] === 'random-card'))
  ) {
    count += typeof record['count'] === 'number' ? Math.max(1, record['count']) : 1
  }
  for (const nested of Object.values(record)) count += authoredInformationCount(nested)
  return count
}

function authoredOpponentCardGainCount(value: unknown): number {
  if (Array.isArray(value))
    return value.reduce(
      (total, entry) => total + authoredOpponentCardGainCount(entry),
      0
    )
  if (typeof value !== 'object' || value === null) return 0
  const record = value as Record<string, unknown>
  const givesOpponentCards =
    (record['player'] === 'opponent' || record['player'] === 'each') &&
    (record['action'] === 'draw' ||
      record['action'] === 'draw-until' ||
      record['action'] === 'discover' ||
      record['action'] === 'add-to-hand')
  let count = givesOpponentCards
    ? typeof record['count'] === 'number'
      ? Math.max(1, record['count'])
      : 1
    : 0
  for (const nested of Object.values(record))
    count += authoredOpponentCardGainCount(nested)
  return count
}

function damageTargetsThatCanGenerateInformation(
  command: TurnMatchCommand,
  state: OpeningMatchState
): readonly CardPlayTargetRef[] {
  const self = state.players.find(
    (player) => player.participantId === command.participantId
  )
  if (!self) return []
  let targets: readonly CardPlayTargetRef[] = []
  let dealsDamage = false
  if (command.type === 'play-card') {
    const card = self.hand.find(
      (candidate) => candidate.instanceId === command.cardInstanceId
    )
    const definition = card ? CARD_CATALOG.get(card.cardId) : undefined
    dealsDamage = /"action":"damage"/.test(
      JSON.stringify(definition ? immediateCardEffects(definition) : [])
    )
    targets = command.targets ?? []
  } else if (command.type === 'use-hero-power' && command.target) {
    const power = HERO_POWER_CATALOG.get(self.heroPower.id)
    dealsDamage = power?.effect.kind === 'damage-character'
    targets = [command.target]
  }
  if (!dealsDamage) return []
  return targets.filter((target) => {
    if (target.kind !== 'minion') return false
    const owner = state.players.find(
      (player) => player.participantId === target.participantId
    )
    const minion = owner?.board.find(
      (candidate) => candidate.instanceId === target.instanceId
    )
    if (!minion || owner?.participantId !== command.participantId) return false
    const definition = CARD_CATALOG.get(minion.cardId)
    const effects = [
      ...(definition?.effects ?? []),
      ...(minion.grantedTriggers ?? []),
      ...(minion.attachedEffects ?? []),
      ...(minion.deathrattles ?? [])
    ]
    return effects.some(
      (block) =>
        block.trigger === 'on-damage' && producesNewDecisionInformation(block.actions)
    )
  })
}

/**
 * Strategic value of learning while there is still mana with which to react.
 * This deliberately reads authored effects, not the hidden outcome produced by
 * the authoritative RNG. A fresh decision is made after the action resolves.
 */
function informationActionValue(
  command: TurnMatchCommand,
  state: OpeningMatchState
): number {
  if (command.type === 'choose-discover-card') return 0.08
  const self = state.players.find(
    (player) => player.participantId === command.participantId
  )
  if (!self) return 0
  const testsSecret = commandTestsFacedownSecret(command, state, command.participantId)
  const secretTestValue = (remainingMana: number): number =>
    testsSecret ? 0.06 + 0.1 * (remainingMana / Math.max(1, self.mana.maximum)) : 0
  if (command.type === 'attack-character') {
    return secretTestValue(self.mana.available)
  }
  if (command.type === 'use-hero-power') {
    const power = HERO_POWER_CATALOG.get(self.heroPower.id)
    const informationTargets = damageTargetsThatCanGenerateInformation(command, state)
    const remainingMana = Math.max(0, self.mana.available - self.heroPower.cost)
    if (
      !producesNewDecisionInformation(power?.effect) &&
      informationTargets.length === 0
    )
      return secretTestValue(remainingMana)
    const informationCount = Math.max(
      1,
      authoredInformationCount(power?.effect),
      informationTargets.length
    )
    return (
      secretTestValue(remainingMana) +
      0.06 +
      Math.min(3, informationCount) * 0.18 +
      0.12 * (remainingMana / Math.max(1, self.mana.maximum))
    )
  }
  if (command.type !== 'play-card') return 0
  const card = self.hand.find(
    (candidate) => candidate.instanceId === command.cardInstanceId
  )
  const definition = card ? CARD_CATALOG.get(card.cardId) : undefined
  if (!card || !definition) return 0
  const immediateEffects = immediateCardEffects(definition)
  const informationTargets = damageTargetsThatCanGenerateInformation(command, state)
  const cost = card.currentCost ?? definition.cost
  const remainingMana = Math.max(0, self.mana.available - cost)
  if (
    !producesNewDecisionInformation(immediateEffects) &&
    informationTargets.length === 0
  )
    return secretTestValue(remainingMana)
  const informationCount = Math.max(
    1,
    authoredInformationCount(immediateEffects),
    informationTargets.length
  )
  // Information is most useful before the turn's resources are committed.
  return (
    secretTestValue(remainingMana) +
    0.06 +
    Math.min(3, informationCount) * 0.18 +
    0.12 * (remainingMana / Math.max(1, self.mana.maximum))
  )
}

function publicCharacterAttack(
  state: OpeningMatchState,
  participantId: PlayerId,
  ref: AttackCharacterRef
): number {
  const player = state.players.find(
    (candidate) => candidate.participantId === participantId
  )
  if (!player) return 0
  if (ref.kind === 'hero')
    return Math.max(0, player.hero.attack + (player.weapon?.attack ?? 0))
  return Math.max(
    0,
    player.board.find((minion) => minion.instanceId === ref.instanceId)?.attack ?? 0
  )
}

function publicMinionSwingValue(
  minion: OpeningMatchState['players'][number]['board'][number],
  incomingDamage: number
): number {
  const damage = Math.min(Math.max(0, incomingDamage), Math.max(0, minion.health))
  return damage * 0.02 + (incomingDamage >= minion.health ? minion.attack * 0.08 : 0)
}

/**
 * Value the known intent of an action that cannot be authoritatively previewed.
 * This uses visible stats and authored mechanics only, so Secret/RNG outcomes
 * remain unknown while attack targets and random-effect bodies no longer tie.
 */
function publicActionIntentValue(
  command: TurnMatchCommand,
  state: OpeningMatchState
): number {
  const self = state.players.find(
    (player) => player.participantId === command.participantId
  )
  const opponent = state.players.find(
    (player) => player.participantId !== command.participantId
  )
  if (!self || !opponent) return 0
  if (command.type === 'attack-character') {
    const attackerRef = command.attacker
    const defenderRef = command.defender
    const attack = publicCharacterAttack(state, command.participantId, attackerRef)
    if (defenderRef.kind === 'hero') return attack * 0.12
    const defender = opponent.board.find(
      (minion) => minion.instanceId === defenderRef.instanceId
    )
    if (!defender) return 0
    let value = publicMinionSwingValue(defender, attack)
    if (attackerRef.kind === 'hero') {
      value -= Math.max(0, defender.attack) * 0.12
    } else {
      const attacker = self.board.find(
        (minion) => minion.instanceId === attackerRef.instanceId
      )
      if (attacker) value -= publicMinionSwingValue(attacker, defender.attack)
    }
    return value
  }
  if (command.type === 'use-hero-power') {
    const power = HERO_POWER_CATALOG.get(self.heroPower.id)
    const amount =
      self.heroPower.effectOverride?.damage ??
      (power?.effect.kind === 'damage-character' ||
      power?.effect.kind === 'damage-enemy-hero' ||
      power?.effect.kind === 'damage-random-enemy'
        ? power.effect.amount
        : 0)
    if (power?.effect.kind === 'damage-enemy-hero') return amount * 0.12
    if (power?.effect.kind === 'restore-character' && command.target) {
      const targetRef = command.target
      const targetOwner = state.players.find(
        (player) => player.participantId === targetRef.participantId
      )
      const target =
        targetRef.kind === 'hero'
          ? targetOwner?.hero
          : targetRef.kind === 'minion'
            ? targetOwner?.board.find(
                (minion) => minion.instanceId === targetRef.instanceId
              )
            : undefined
      const restored = target
        ? Math.min(power.effect.amount, Math.max(0, target.maxHealth - target.health))
        : 0
      return targetOwner?.participantId === command.participantId
        ? restored * 0.12
        : -restored * 0.12
    }
    if (
      command.target?.kind === 'hero' &&
      command.target.participantId === opponent.participantId
    )
      return amount * 0.12
    if (command.target?.kind === 'minion') {
      const targetRef = command.target
      const targetOwner = state.players.find(
        (player) => player.participantId === targetRef.participantId
      )
      const target = targetOwner?.board.find(
        (minion) => minion.instanceId === targetRef.instanceId
      )
      if (!target) return 0
      const value = publicMinionSwingValue(target, amount)
      return targetOwner?.participantId === command.participantId ? -value : value
    }
    if (
      power?.effect.kind === 'gain-armor' ||
      power?.effect.kind === 'gain-attack-and-armor'
    )
      return (
        (power.effect.kind === 'gain-armor'
          ? power.effect.amount
          : power.effect.armor) *
          0.12 +
        (power.effect.kind === 'gain-attack-and-armor' ? power.effect.attack * 0.08 : 0)
      )
    if (power?.effect.kind === 'summon') {
      const summoned = CARD_CATALOG.get(power.effect.cardId)
      return summoned?.type === 'Minion'
        ? (summoned.attack * 0.08 + summoned.health * 0.02) * (power.effect.count ?? 1)
        : 0
    }
    if (power?.effect.kind === 'summon-random-totem') {
      const values = power.effect.cardIds
        .map((cardId) => CARD_CATALOG.get(cardId))
        .filter(
          (card): card is Extract<CardDefinition, { readonly type: 'Minion' }> =>
            card !== undefined && card.type === 'Minion'
        )
        .map((card) => card.attack * 0.08 + card.health * 0.02)
      return values.length > 0
        ? values.reduce((total, candidate) => total + candidate, 0) / values.length
        : 0
    }
    if (power?.effect.kind === 'damage-random-enemy') return amount * 0.08
    if (power?.effect.kind === 'draw-and-self-damage') {
      const currentHealth = self.hero.health + self.hero.armor
      if (power.effect.amount >= currentHealth) return -1_000
      const healthAfter = currentHealth - power.effect.amount
      const publicEnemyReach =
        opponent.board.reduce(
          (total, minion) => total + Math.max(0, minion.attack),
          0
        ) + (opponent.weapon?.attack ?? 0)
      const safetyFloor = Math.max(10, publicEnemyReach + 2)
      const dangerCost = Math.max(0, safetyFloor - healthAfter) * 0.12
      return power.effect.count * 0.14 - power.effect.amount * 0.1 - dangerCost
    }
    if (power?.effect.kind === 'equip-weapon') {
      const weapon = CARD_CATALOG.get(power.effect.cardId)
      return weapon?.type === 'Weapon' ? weapon.attack * weapon.durability * 0.06 : 0
    }
    return 0
  }
  if (command.type !== 'play-card') return 0
  const card = self.hand.find(
    (candidate) => candidate.instanceId === command.cardInstanceId
  )
  const definition = card ? CARD_CATALOG.get(card.cardId) : undefined
  if (!definition) return 0
  let value =
    definition.type === 'Minion'
      ? definition.attack * 0.08 + definition.health * 0.02
      : 0
  const immediateEffects = immediateCardEffects(definition)
  value -= authoredOpponentCardGainCount(immediateEffects) * 0.14
  for (const block of immediateEffects) {
    for (const action of block.actions ?? []) {
      if (action.action === 'gain-mana' && typeof action.amount === 'number')
        value += action.amount * 0.08
      if (action.action !== 'damage' || typeof action.amount !== 'number') continue
      for (const target of command.targets ?? []) {
        if (target.kind === 'hero') {
          value +=
            target.participantId === command.participantId
              ? -action.amount * 0.12
              : action.amount * 0.12
          continue
        }
        const owner = state.players.find(
          (player) => player.participantId === target.participantId
        )
        const minion = owner?.board.find(
          (candidate) => candidate.instanceId === target.instanceId
        )
        if (!minion) continue
        const swing = publicMinionSwingValue(minion, action.amount)
        value += owner?.participantId === command.participantId ? -swing : swing
      }
    }
  }
  return value
}

function effectiveHealth(state: OpeningMatchState, playerId: PlayerId): number {
  const player = state.players.find((candidate) => candidate.participantId === playerId)
  return player ? player.hero.health + player.hero.armor : 0
}

function boardAttack(state: OpeningMatchState, playerId: PlayerId): number {
  return (
    state.players
      .find((candidate) => candidate.participantId === playerId)
      ?.board.reduce((total, minion) => total + minion.attack, 0) ?? 0
  )
}

function boardHealth(state: OpeningMatchState, playerId: PlayerId): number {
  return (
    state.players
      .find((candidate) => candidate.participantId === playerId)
      ?.board.reduce((total, minion) => total + Math.max(0, minion.health), 0) ?? 0
  )
}

/**
 * Public, deterministic tactical delta for a searched line. Position scoring
 * deliberately contains longer-horizon hand, curve, threat, and plan terms;
 * this delta keeps those terms grounded in the concrete health and board
 * swing the engine proved. It also survives an end-turn boundary, where the
 * state's current-turn mana-efficiency field necessarily resets.
 */
function tacticalOutcomeValue(
  before: OpeningMatchState,
  after: OpeningMatchState,
  perspectivePlayerId: PlayerId
): number {
  const opponentId = before.players.find(
    (player) => player.participantId !== perspectivePlayerId
  )!.participantId
  const selfHealthDelta =
    effectiveHealth(after, perspectivePlayerId) -
    effectiveHealth(before, perspectivePlayerId)
  const opponentHealthDelta =
    effectiveHealth(after, opponentId) - effectiveHealth(before, opponentId)
  const selfAttackDelta =
    boardAttack(after, perspectivePlayerId) - boardAttack(before, perspectivePlayerId)
  const opponentAttackDelta =
    boardAttack(after, opponentId) - boardAttack(before, opponentId)
  const selfBoardHealthDelta =
    boardHealth(after, perspectivePlayerId) - boardHealth(before, perspectivePlayerId)
  const opponentBoardHealthDelta =
    boardHealth(after, opponentId) - boardHealth(before, opponentId)
  return (
    (selfHealthDelta - opponentHealthDelta) * 0.12 +
    (selfAttackDelta - opponentAttackDelta) * 0.08 +
    (selfBoardHealthDelta - opponentBoardHealthDelta) * 0.02
  )
}

function resourceUsage(
  before: OpeningMatchState,
  after: OpeningMatchState,
  playerId: PlayerId,
  plan?: AiStrategicPlanView
): AiCandidateDossier['resourceUsage'] {
  const first = before.players.find((player) => player.participantId === playerId)!
  const last = after.players.find((player) => player.participantId === playerId)!
  const reserved = new Set(plan?.activeReservedCardIds ?? plan?.reservedCardIds ?? [])
  const reservedBefore = first.hand.filter((card) =>
    reserved.has(String(card.cardId))
  ).length
  const reservedAfter = last.hand.filter((card) =>
    reserved.has(String(card.cardId))
  ).length
  return {
    manaSpent: Math.max(0, first.mana.available - last.mana.available),
    cardsSpent: Math.max(0, first.hand.length - last.hand.length),
    reservedResourceCost: Math.max(0, reservedBefore - reservedAfter)
  }
}

function uncertainResourceUsage(
  state: OpeningMatchState,
  command: TurnMatchCommand,
  playerId: PlayerId,
  plan?: AiStrategicPlanView
): AiCandidateDossier['resourceUsage'] {
  const player = state.players.find((candidate) => candidate.participantId === playerId)
  if (!player) return { manaSpent: 0, cardsSpent: 0, reservedResourceCost: 0 }
  if (command.type === 'use-hero-power') {
    return {
      manaSpent: player.heroPower.cost,
      cardsSpent: 0,
      reservedResourceCost: 0
    }
  }
  if (command.type !== 'play-card') {
    return { manaSpent: 0, cardsSpent: 0, reservedResourceCost: 0 }
  }
  const card = player.hand.find(
    (candidate) => candidate.instanceId === command.cardInstanceId
  )
  if (!card) return { manaSpent: 0, cardsSpent: 0, reservedResourceCost: 0 }
  const reserved = new Set(plan?.activeReservedCardIds ?? plan?.reservedCardIds ?? [])
  return {
    manaSpent: card.currentCost ?? CARD_CATALOG.get(card.cardId)?.cost ?? 0,
    cardsSpent: 1,
    reservedResourceCost: reserved.has(String(card.cardId)) ? 1 : 0
  }
}

function uncertaintyBoundary(
  command: TurnMatchCommand,
  state: OpeningMatchState,
  perspectivePlayerId: PlayerId,
  plan?: AiStrategicPlanView
): Readonly<{
  readonly evaluation: Readonly<{
    readonly score: number
    readonly components: AiCandidateDossier['evaluation']
  }>
  readonly resourceUsage: AiCandidateDossier['resourceUsage']
}> {
  // A boundary is terminal only for this planning segment: the live controller
  // will re-plan after the hidden result resolves. Normalize turn-only fields
  // to the same public handoff horizon used by complete deterministic lines so
  // initiative cannot make every draw/RNG action appear one full point better
  // merely because it was not authoritatively dispatched.
  const base = evaluatePosition(
    publicTurnHandoffState(state, perspectivePlayerId),
    perspectivePlayerId,
    plan
  )
  const informationValue = informationActionValue(command, state)
  const resourceUsageValue = uncertainResourceUsage(
    state,
    command,
    perspectivePlayerId,
    plan
  )
  const publicIntentValue = publicActionIntentValue(command, state)
  return {
    evaluation: {
      score:
        base.score +
        informationValue +
        publicIntentValue -
        resourceUsageValue.cardsSpent * 0.08 -
        resourceUsageValue.reservedResourceCost,
      components: {
        ...base.components,
        informationValue,
        reservedResourceCost: -resourceUsageValue.reservedResourceCost
      }
    },
    resourceUsage: resourceUsageValue
  }
}

function lineKey(commands: readonly TurnMatchCommand[]): string {
  return commands.map(canonicalCommandKey).join('|')
}

function publicTurnHandoffState(
  state: OpeningMatchState,
  endingParticipantId: PlayerId
): OpeningMatchState {
  const next = state.players.find(
    (player) => player.participantId !== endingParticipantId
  )
  return next ? { ...state, activePlayerId: next.participantId } : state
}

function isPublicOpponentResponse(command: TurnMatchCommand): boolean {
  return (
    command.type === 'attack-character' ||
    command.type === 'use-hero-power' ||
    command.type === 'end-turn'
  )
}

/** Cache/deduplication keys must obey the same information boundary as scoring. */
function fairSearchHashState(
  state: OpeningMatchState,
  perspectivePlayerId: PlayerId
): unknown {
  const hiddenCards = (cards: readonly unknown[], zone: string) =>
    Array.from({ length: cards.length }, () => ({ hidden: true, zone }))
  const visibleOrHiddenCards = <
    T extends { readonly knownTo?: readonly PlayerId[]; readonly zone?: string }
  >(
    cards: readonly T[] | undefined
  ) =>
    cards?.map((card) =>
      card.knownTo?.includes(perspectivePlayerId)
        ? { ...card, knownTo: undefined }
        : { hidden: true, zone: card.zone ?? 'private' }
    )
  return {
    phase: state.phase,
    playerOneId: state.playerOneId,
    playerTwoId: state.playerTwoId,
    activePlayerId: state.activePlayerId,
    turnNumber: state.turnNumber,
    winnerId: state.winnerId,
    loserId: state.loserId,
    pendingResolution: state.pendingResolution,
    history: state.history
      ? {
          ...state.history,
          cardsDrawnThisTurn: state.history.cardsDrawnThisTurn.length
        }
      : undefined,
    players: state.players.map((player) =>
      player.participantId === perspectivePlayerId
        ? {
            ...player,
            // A player knows its submitted list and observed changes, but not
            // the shuffled order. The hash needs only the remaining count.
            deck: hiddenCards(player.deck, 'deck'),
            hand: player.hand.map((card) => ({ ...card, knownTo: undefined })),
            revealedCards: visibleOrHiddenCards(player.revealedCards),
            discardedCards: visibleOrHiddenCards(player.discardedCards)
          }
        : {
            ...player,
            // A revealed identity is legitimate knowledge, but its live
            // opponent-side cost/enchantments and stable entity id are not.
            hand: player.hand.map((card) =>
              card.knownTo?.includes(perspectivePlayerId)
                ? {
                    cardId: card.cardId,
                    baseCost: card.baseCost,
                    zone: 'hand',
                    known: true
                  }
                : { hidden: true, zone: 'hand' }
            ),
            deck: hiddenCards(player.deck, 'deck'),
            revealedCards: visibleOrHiddenCards(player.revealedCards),
            discardedCards: visibleOrHiddenCards(player.discardedCards),
            pendingCostModifiers: undefined,
            secrets: (player.secrets ?? []).map((secret) =>
              secret.revealed
                ? secret
                : {
                    controllerId: secret.controllerId,
                    ownerId: secret.ownerId,
                    revealed: false
                  }
            )
          }
    ),
    pendingDiscover:
      state.pendingDiscover?.participantId === perspectivePlayerId
        ? state.pendingDiscover
        : undefined,
    pendingCardChoice:
      state.pendingCardChoice?.participantId === perspectivePlayerId
        ? state.pendingCardChoice
        : undefined,
    // Queued opponent effects are not part of the public match snapshot and
    // may originate from a hidden Secret. Own queued effects are known.
    scheduledEffects: (state.scheduledEffects ?? []).filter(
      (effect) => effect.controllerId === perspectivePlayerId
    )
  }
}

/**
 * Over-estimate of the damage the participant could deal to the opposing hero
 * this turn. Used only to skip the guaranteed-lethal proof when lethal is
 * impossible; any over-count merely keeps the proof running, which is safe.
 */
function maximumReachableDamage(
  state: OpeningMatchState,
  participantId: PlayerId
): number {
  const self = state.players.find((player) => player.participantId === participantId)
  if (!self) return 0
  const boardPotential = self.board.reduce(
    (total, minion) =>
      total + Math.max(0, minion.attack) * Math.max(1, minion.maxAttacksPerTurn ?? 1),
    0
  )
  const weaponPotential = self.weapon
    ? Math.max(0, self.weapon.attack) * Math.max(1, self.weapon.durability)
    : 0
  const heroPotential = Math.max(0, self.hero.attack)
  const spellDamage =
    self.board.reduce((total, minion) => total + (minion.spellDamage ?? 0), 0) +
    (self.hero.spellDamage ?? 0)
  const power = HERO_POWER_CATALOG.get(self.heroPower.id)
  let powerPotential = 0
  if (self.heroPower.available && self.heroPower.cost <= self.mana.available) {
    const overrideDamage = self.heroPower.effectOverride?.damage ?? 0
    if (
      power?.effect.kind === 'damage-enemy-hero' ||
      power?.effect.kind === 'damage-character'
    )
      powerPotential = Math.max(overrideDamage, power.effect.amount)
  }
  let handPotential = 0
  for (const card of self.hand) {
    const definition = CARD_CATALOG.get(card.cardId)
    if (!definition) continue
    const cost = card.currentCost ?? definition.cost
    if (cost > self.mana.available) continue
    for (const trigger of definition.effects ?? []) {
      for (const action of trigger.actions ?? []) {
        const target = isCardEffectObject(action.target) ? action.target : null
        if (action.action === 'damage' && typeof action.amount === 'number')
          handPotential += action.amount + spellDamage
        // An attack buff converts into extra face damage from a ready body or
        // the hero, so it counts toward the lethal plausibility bound.
        if (
          action.action === 'modify' &&
          typeof action.attack === 'number' &&
          action.attack > 0 &&
          target &&
          (target['controller'] === 'self' || target['controller'] === 'any')
        )
          handPotential += action.attack
      }
    }
    if (definition.type === 'Minion' && (definition.keywords ?? []).includes('charge'))
      handPotential += definition.attack ?? 0
  }
  return (
    boardPotential + weaponPotential + heroPotential + powerPotential + handPotential
  )
}

interface SelfDamageClassification {
  readonly isSelfDamage: boolean
  /** Groups equivalent target variants of the same source (card instance or hero power). */
  readonly siblingKey: string | null
}

function targetedDamageEffects(
  command: TurnMatchCommand,
  state: OpeningMatchState
): readonly unknown[] {
  if (command.type !== 'play-card') return []
  const card = state.players
    .find((player) => player.participantId === command.participantId)
    ?.hand.find((candidate) => candidate.instanceId === command.cardInstanceId)
  const definition = card ? CARD_CATALOG.get(card.cardId) : undefined
  return (definition?.effects ?? []).flatMap((trigger) =>
    (trigger.actions ?? []).filter((action) => {
      const target = isCardEffectObject(action.target) ? action.target : null
      return (
        action.action === 'damage' &&
        target?.['controller'] === 'any' &&
        target['selection'] === 'chosen'
      )
    })
  )
}

/**
 * Outcome-based self-harm classifier (AI plan phase 3): direct damage whose
 * chosen targets are all on the AI's own side. Buff-style friendly targeting
 * (Power Overwhelming and similar) is not classified as self-harm.
 */
function classifySelfDamage(
  command: TurnMatchCommand,
  state: OpeningMatchState,
  perspectivePlayerId: PlayerId
): SelfDamageClassification {
  if (command.type === 'play-card' && (command.targets ?? []).length > 0) {
    if (targetedDamageEffects(command, state).length === 0)
      return { isSelfDamage: false, siblingKey: null }
    const ownSide = (command.targets ?? []).every(
      (target) => target.participantId === perspectivePlayerId
    )
    return {
      isSelfDamage: ownSide,
      siblingKey: ownSide ? `card:${command.cardInstanceId}` : null
    }
  }
  if (command.type === 'use-hero-power' && command.target) {
    const player = state.players.find(
      (candidate) => candidate.participantId === perspectivePlayerId
    )
    const power = player ? HERO_POWER_CATALOG.get(player.heroPower.id) : undefined
    const damaging =
      power?.effect.kind === 'damage-character' ||
      power?.effect.kind === 'damage-enemy-hero'
    if (!damaging) return { isSelfDamage: false, siblingKey: null }
    const ownSide = command.target.participantId === perspectivePlayerId
    return { isSelfDamage: ownSide, siblingKey: ownSide ? 'hero-power' : null }
  }
  return { isSelfDamage: false, siblingKey: null }
}

/**
 * Iterative, deterministic complete-turn search. Every simulation is executed
 * on the engine's restoring analysis fork; the authoritative match is never
 * advanced and no private order is serialized to the worker/provider.
 *
 * Coverage policy: every root first receives a cheap baseline dossier (the
 * root command followed by passing), then roots are deep-expanded in order
 * until the budget ends. A root is never left unevaluated, and deep analysis
 * replaces the baseline only with complete-turn lines, so partial results
 * cannot masquerade as fully searched actions.
 */
export function searchStrategicTurn(
  match: OpeningMatchInstance,
  perspectivePlayerId: PlayerId,
  roots: readonly AiSearchRootAction[],
  limits: AiSearchLimits,
  plan?: AiStrategicPlanView,
  cache = new AiTranspositionCache<Readonly<{ readonly score: number }>>(
    limits.transpositionCapacity
  ),
  options: AiStrategicSearchOptions = {}
): AiStrategicSearchResult {
  const startedAt = Date.now()
  const deadlineAtMs = startedAt + limits.timeBudgetMs
  const initial = match.getState()
  const opponentId = initial.players.find(
    (player) => player.participantId !== perspectivePlayerId
  )!.participantId
  let exploredNodes = 0
  let searchPartial = false
  const evaluationContextHash = hashAiState(plan ?? {})

  const scoreState = (state: OpeningMatchState): number => {
    const key = `${perspectivePlayerId}:${evaluationContextHash}:${hashAiState(
      fairSearchHashState(state, perspectivePlayerId)
    )}`
    const cached = cache.get(key)
    if (cached) return cached.score
    const score = evaluatePosition(state, perspectivePlayerId, plan).score
    cache.set(key, { score })
    return score
  }

  const expandTurn = (
    prefix: readonly TurnMatchCommand[],
    participantId: PlayerId,
    beamWidth: number,
    prefixUsesUncertainty: boolean,
    rootAction?: AiSearchRootAction,
    publicOpponentResponsesOnly = false
  ): TurnExpansion => {
    const initialSimulation = simulate(match, prefix)
    if (!initialSimulation.accepted)
      return { complete: [], partial: [], incomplete: false }
    let incomplete = false
    let frontier: SearchLine[] = [
      {
        commands: prefix,
        state: initialSimulation.state,
        score: scoreState(initialSimulation.state),
        completeTurn: activeParticipant(initialSimulation.state) !== participantId,
        usesUncertainty: prefixUsesUncertainty
      }
    ]
    const completed: SearchLine[] = []
    for (
      let depth = rootAction ? prefix.length : 0;
      depth < limits.atomicDepth && frontier.length > 0;
      depth += 1
    ) {
      if (Date.now() >= deadlineAtMs || exploredNodes >= limits.nodeLimit) {
        incomplete = true
        searchPartial = true
        break
      }
      const next: SearchLine[] = []
      for (const line of frontier) {
        if (line.completeTurn || line.state.phase === 'ended') {
          completed.push(line)
          continue
        }
        const legalCommands = legalAfter(match, line.commands, participantId)
          .filter(
            (command) =>
              !publicOpponentResponsesOnly || isPublicOpponentResponse(command)
          )
          .sort((left, right) => {
            if (left.type === 'end-turn') return -1
            if (right.type === 'end-turn') return 1
            const priorityDifference =
              publicActionIntentValue(right, line.state) +
              informationActionValue(right, line.state) -
              publicActionIntentValue(left, line.state) -
              informationActionValue(left, line.state)
            if (priorityDifference !== 0) return priorityDifference
            return canonicalCommandKey(left).localeCompare(canonicalCommandKey(right))
          })
        // End Turn is free to retain as the complete-line baseline. Restrict
        // non-terminal branching before simulation so the configured beam is
        // a real beam instead of spending the entire node budget at depth one.
        const commands = [
          ...legalCommands.filter((command) => command.type === 'end-turn'),
          ...legalCommands
            .filter((command) => command.type !== 'end-turn')
            .slice(0, Math.max(0, beamWidth))
        ]
        for (const command of commands) {
          if (Date.now() >= deadlineAtMs || exploredNodes >= limits.nodeLimit) {
            incomplete = true
            searchPartial = true
            break
          }
          if (command.type === 'end-turn') {
            // End the searched line at the handoff itself. Dispatching would
            // consume an unknown top card and could reveal its on-draw effect.
            const handoffState = publicTurnHandoffState(line.state, participantId)
            completed.push({
              commands: [...line.commands, command],
              state: handoffState,
              score: scoreState(handoffState),
              completeTurn: true,
              usesUncertainty: line.usesUncertainty,
              stopsAtTurnHandoff: true
            })
            continue
          }
          if (commandUsesUncertainty(command, line.state, perspectivePlayerId)) {
            // Continuing would observe the authoritative secret/RNG/draw. Stop
            // at the information boundary and re-plan after live resolution.
            if (participantId === perspectivePlayerId) {
              const boundary = uncertaintyBoundary(
                command,
                line.state,
                perspectivePlayerId,
                plan
              )
              completed.push({
                commands: [...line.commands, command],
                state: line.state,
                score: boundary.evaluation.score,
                // Complete for this search segment: live resolution creates a
                // fresh decision even though the real turn may continue.
                completeTurn: true,
                usesUncertainty: true,
                boundaryEvaluation: boundary.evaluation,
                boundaryResourceUsage: boundary.resourceUsage
              })
            } else {
              incomplete = true
              searchPartial = true
            }
            continue
          }
          exploredNodes += 1
          const sequence = [...line.commands, command]
          const result = simulate(match, sequence)
          if (!result.accepted) continue
          const completeTurn =
            result.state.phase === 'ended' ||
            activeParticipant(result.state) !== participantId
          const expandedLine: SearchLine = {
            commands: sequence,
            state: result.state,
            score: scoreState(result.state),
            completeTurn,
            usesUncertainty:
              line.usesUncertainty ||
              commandUsesUncertainty(command, line.state, perspectivePlayerId)
          }
          if (completeTurn) completed.push(expandedLine)
          else next.push(expandedLine)
        }
      }
      const collapsed = new Map<string, SearchLine>()
      for (const line of next) {
        const firstKey = rootAction
          ? rootAction.actionId
          : canonicalCommandKey(line.commands[prefix.length] ?? line.commands[0]!)
        const key = `${firstKey}:${hashAiState(
          fairSearchHashState(line.state, perspectivePlayerId)
        )}`
        const current = collapsed.get(key)
        const preferable =
          participantId === perspectivePlayerId
            ? !current || line.score > current.score
            : !current || line.score < current.score
        if (preferable) collapsed.set(key, line)
      }
      frontier = [...collapsed.values()]
        .sort((left, right) =>
          participantId === perspectivePlayerId
            ? right.score - left.score ||
              lineKey(left.commands).localeCompare(lineKey(right.commands))
            : left.score - right.score ||
              lineKey(left.commands).localeCompare(lineKey(right.commands))
        )
        .slice(0, beamWidth)
    }
    const complete = [...completed, ...frontier.filter((line) => line.completeTurn)]
    const stillPartial = frontier.filter((line) => !line.completeTurn)
    if (stillPartial.length > 0) {
      incomplete = true
      searchPartial = true
    }
    return { complete, partial: stillPartial, incomplete }
  }

  const dossierFor = (
    root: AiSearchRootAction,
    ownLine: SearchLine,
    strongestResponse: SearchLine,
    opponentCommands: readonly TurnMatchCommand[],
    responseIsPartial: boolean,
    searchIsIncomplete: boolean,
    evaluation: Readonly<{
      readonly score: number
      readonly components: AiCandidateDossier['evaluation']
    }>,
    lethalProofCommands: readonly TurnMatchCommand[] | null
  ): AiCandidateDossier => {
    const tacticalProofs = [
      ...(ownLine.usesUncertainty
        ? []
        : classifyTacticalLine(
            initial,
            ownLine.state,
            perspectivePlayerId,
            ownLine.commands
          )),
      ...(lethalProofCommands
        ? [
            {
              kind: 'guaranteed-lethal' as const,
              proven: true,
              complete: true,
              commands: lethalProofCommands,
              verifiedBranches: 1,
              annotation: 'The global guaranteed-lethal proof begins with this action.'
            }
          ]
        : [])
    ]
    const strategyProgress =
      evaluation.components.matchupProgress + evaluation.components.comboProgress
    const score =
      evaluation.score +
      tacticalOutcomeValue(initial, strongestResponse.state, perspectivePlayerId)
    const resolvedUsage = resourceUsage(
      initial,
      ownLine.state,
      perspectivePlayerId,
      plan
    )
    const boundaryUsage = ownLine.boundaryResourceUsage
    return {
      actionId: root.actionId,
      firstCommand: root.command,
      recommendedContinuation: ownLine.commands.slice(1),
      projectedSuccessor: {
        revision: strongestResponse.state.revision,
        winnerId: strongestResponse.state.winnerId,
        selfEffectiveHealth: effectiveHealth(
          strongestResponse.state,
          perspectivePlayerId
        ),
        opponentEffectiveHealth: effectiveHealth(strongestResponse.state, opponentId),
        selfBoardAttack: boardAttack(strongestResponse.state, perspectivePlayerId),
        opponentBoardAttack: boardAttack(strongestResponse.state, opponentId)
      },
      opponentStrongestResponse: opponentCommands,
      tacticalProofs,
      evaluation: evaluation.components,
      score,
      meanScenarioValue: score,
      downsideScenarioValue: score,
      worstCaseScenarioValue: score,
      resourceUsage: boundaryUsage
        ? {
            manaSpent: resolvedUsage.manaSpent + boundaryUsage.manaSpent,
            cardsSpent: resolvedUsage.cardsSpent + boundaryUsage.cardsSpent,
            reservedResourceCost:
              resolvedUsage.reservedResourceCost + boundaryUsage.reservedResourceCost
          }
        : resolvedUsage,
      uncertainty: {
        // No hidden-state sampling exists yet. Zero is truthful; configured
        // future sample counts must never masquerade as completed analysis.
        determinizations: 0,
        randomOutcomeSamples: 0,
        incomplete:
          strongestResponse.usesUncertainty ||
          responseIsPartial ||
          searchIsIncomplete ||
          !ownLine.completeTurn
      },
      strategyProgress
    }
  }

  // The guaranteed-lethal proof only runs when reachable damage makes lethal
  // plausible, never consumes more than half the search budget, and is fast
  // enough (focused enemy-hero damage lines) to finish inside short slices.
  // An impossible or slow proof must not starve root coverage.
  const opponentEffectiveHealth = effectiveHealth(initial, opponentId)
  const lethalPlausible =
    maximumReachableDamage(initial, perspectivePlayerId) >= opponentEffectiveHealth
  let lethalProof: ReturnType<typeof proveGuaranteedLethal> = {
    kind: 'guaranteed-lethal',
    proven: false,
    complete: true,
    commands: [],
    verifiedBranches: 0,
    annotation:
      'Skipped: the maximum reachable damage this turn cannot reduce the opposing hero.'
  }
  if (lethalPlausible && options.baselinePass !== false) {
    const proofLimits: AiTacticalSolveLimits = {
      depth: Math.min(limits.atomicDepth, 12),
      nodeLimit: Math.min(limits.nodeLimit, 12_000),
      deadlineAtMs: Math.min(
        deadlineAtMs,
        Date.now() + Math.max(1, Math.floor(limits.timeBudgetMs * 0.5))
      )
    }
    lethalProof = proveGuaranteedLethal(match, perspectivePlayerId, proofLimits)
  }
  const lethalFirstKey =
    lethalProof.proven && lethalProof.commands.length > 0
      ? canonicalCommandKey(lethalProof.commands[0]!)
      : null

  const dossiersByAction = new Map<string, AiCandidateDossier>()

  // Fair minimum coverage: every root gets a cheap one-action baseline
  // dossier before any root is deep-expanded. The baseline evaluates the
  // resolved successor of the root command alone and is always marked
  // incomplete so ranking treats it as a floor, not a searched action.
  if (options.baselinePass !== false) {
    for (const root of roots) {
      // Root coverage is a small, bounded prerequisite rather than optional
      // deep-search work. Do not let wall-clock scheduling leave a legal root
      // completely unrepresented.
      if (root.command.type === 'end-turn') {
        const handoffState = publicTurnHandoffState(initial, root.command.participantId)
        const evaluation = evaluatePosition(handoffState, perspectivePlayerId, plan)
        const line: SearchLine = {
          commands: [root.command],
          state: handoffState,
          score: evaluation.score,
          completeTurn: true,
          usesUncertainty: false,
          stopsAtTurnHandoff: true
        }
        dossiersByAction.set(
          root.actionId,
          dossierFor(root, line, line, [], false, false, evaluation, null)
        )
        continue
      }
      const usesUncertainty = commandUsesUncertainty(
        root.command,
        initial,
        perspectivePlayerId
      )
      if (usesUncertainty) {
        const boundary = uncertaintyBoundary(
          root.command,
          initial,
          perspectivePlayerId,
          plan
        )
        const line: SearchLine = {
          commands: [root.command],
          state: initial,
          score: boundary.evaluation.score,
          completeTurn: false,
          usesUncertainty: true,
          boundaryEvaluation: boundary.evaluation,
          boundaryResourceUsage: boundary.resourceUsage
        }
        dossiersByAction.set(root.actionId, {
          ...dossierFor(root, line, line, [], true, true, boundary.evaluation, null)
        })
        continue
      }
      const baseline = simulate(match, [root.command])
      if (!baseline.accepted) continue
      const evaluation = evaluatePosition(baseline.state, perspectivePlayerId, plan)
      const dossier = dossierFor(
        root,
        {
          commands: [root.command],
          state: baseline.state,
          score: evaluation.score,
          completeTurn: true,
          usesUncertainty
        },
        {
          commands: [root.command],
          state: baseline.state,
          score: evaluation.score,
          completeTurn: true,
          usesUncertainty
        },
        [],
        true,
        true,
        evaluation,
        lethalFirstKey === canonicalCommandKey(root.command)
          ? lethalProof.commands
          : null
      )
      dossiersByAction.set(root.actionId, dossier)
    }
  }

  if (!options.baselineOnly) {
    // Spend the scarce deep-search budget on the strongest fair baselines
    // first. Legal-command enumeration order is an engine detail and must not
    // decide which root receives complete-turn analysis when the node budget
    // cannot deepen every action.
    const rootsByBaseline = [...roots].sort((left, right) => {
      const leftScore = dossiersByAction.get(left.actionId)?.score ?? -Infinity
      const rightScore = dossiersByAction.get(right.actionId)?.score ?? -Infinity
      return rightScore - leftScore || left.actionId.localeCompare(right.actionId)
    })
    for (const root of rootsByBaseline) {
      if (Date.now() >= deadlineAtMs || exploredNodes >= limits.nodeLimit) {
        searchPartial = true
        break
      }
      // The real result of this action is private or random. Its baseline uses
      // only authored information value; never deepen through the actual result.
      if (commandUsesUncertainty(root.command, initial, perspectivePlayerId)) continue
      const expansion = expandTurn(
        [root.command],
        perspectivePlayerId,
        limits.ownTurnBeam,
        commandUsesUncertainty(root.command, initial, perspectivePlayerId),
        root
      )
      if (expansion.complete.length === 0) continue
      let bestDossier: AiCandidateDossier | null = null
      for (const ownLine of expansion.complete) {
        // Search only the opponent's public board, weapon, and hero-power
        // responses. Opposing hand plays are excluded before simulation, so
        // the authoritative hidden hand cannot influence the line.
        let strongestResponse: SearchLine = ownLine
        let opponentCommands: readonly TurnMatchCommand[] = []
        let responseIsPartial = false
        let responseSearchIncomplete = false
        if (
          ownLine.state.phase !== 'ended' &&
          !ownLine.usesUncertainty &&
          !ownLine.stopsAtTurnHandoff
        ) {
          const response = expandTurn(
            ownLine.commands,
            opponentId,
            limits.opponentTurnBeam,
            ownLine.usesUncertainty,
            undefined,
            true
          )
          const pool =
            response.complete.length > 0 ? response.complete : response.partial
          if (pool.length > 0) {
            strongestResponse = [...pool].sort(
              (left, right) =>
                left.score - right.score ||
                lineKey(left.commands).localeCompare(lineKey(right.commands))
            )[0]!
            opponentCommands = strongestResponse.commands.slice(ownLine.commands.length)
            responseIsPartial = response.complete.length === 0
          }
          responseSearchIncomplete = response.incomplete
        }
        const evaluation =
          strongestResponse.boundaryEvaluation ??
          ownLine.boundaryEvaluation ??
          evaluatePosition(strongestResponse.state, perspectivePlayerId, plan)
        const dossier = dossierFor(
          root,
          ownLine,
          strongestResponse,
          opponentCommands,
          responseIsPartial,
          expansion.incomplete || responseSearchIncomplete,
          evaluation,
          lethalFirstKey === canonicalCommandKey(root.command)
            ? lethalProof.commands
            : null
        )
        if (!bestDossier || dossier.score > bestDossier.score) bestDossier = dossier
      }
      if (bestDossier) dossiersByAction.set(root.actionId, bestDossier)
    }
  }

  // Phase-3 self-harm dominance: drop a self-damage target variant when an
  // equivalent enemy-target variant or the pass baseline produces an outcome
  // at least as good and no compensating tactical proof justifies the cost.
  for (const root of roots) {
    const dossier = dossiersByAction.get(root.actionId)
    if (!dossier) continue
    const classification = classifySelfDamage(
      root.command,
      initial,
      perspectivePlayerId
    )
    if (!classification.isSelfDamage || !classification.siblingKey) continue
    if (
      dossier.tacticalProofs.some(
        (proof) =>
          proof.proven && proof.complete && COMPENSATING_PROOF_KINDS.has(proof.kind)
      )
    )
      continue
    let dominated = false
    for (const other of dossiersByAction.values()) {
      if (other.actionId === dossier.actionId) continue
      const otherCommand = other.firstCommand
      let isSibling = false
      if (otherCommand.type === 'play-card' && root.command.type === 'play-card')
        isSibling =
          `card:${otherCommand.cardInstanceId}` === classification.siblingKey &&
          !classifySelfDamage(otherCommand, initial, perspectivePlayerId).isSelfDamage
      if (
        otherCommand.type === 'use-hero-power' &&
        root.command.type === 'use-hero-power'
      )
        isSibling =
          classification.siblingKey === 'hero-power' &&
          !classifySelfDamage(otherCommand, initial, perspectivePlayerId).isSelfDamage
      const isBaseline = otherCommand.type === 'end-turn'
      if ((isSibling || isBaseline) && other.score >= dossier.score) {
        dominated = true
        break
      }
    }
    if (dominated) dossiersByAction.delete(root.actionId)
  }

  const dossiers = [...dossiersByAction.values()].sort(
    (left, right) =>
      right.score - left.score || left.actionId.localeCompare(right.actionId)
  )
  return {
    dossiers,
    exploredNodes,
    cacheHits: cache.hitCount,
    partial: searchPartial,
    elapsedMs: Date.now() - startedAt
  }
}
