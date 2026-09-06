import { CARD_CATALOG, asCardId, type CardId } from '../content/cards'
import { HERO_CATALOG } from '../content/heroes'
import { HERO_POWER_CATALOG } from '../content/hero-powers'
import { countDeckCards, type Deck } from '../decks'
import { createSeededRng, type DeterministicRng } from './rng'
import {
  EffectRuntime,
  getDerivedState,
  getMatchLegality,
  getPlayInput,
  resolveAttack,
  resolveCardPlay,
  resolvePendingCardChoice,
  resolveHeroPower,
  resolveTurnTransition
} from './effects/effect-runtime'
import { assertOpeningMatchInvariants } from './rules/invariants'
import { moveCardForPlayer, removeCardFromPlayer } from './rules/zone-state'
import { StateTransaction } from './rules/runtime-state'
import { createAiObservation } from './ai/observation'
import { projectHistoryAction } from './history-visibility'
import type { MatchParticipantSetup, MatchSetup, PlayerId } from './match-types'
import type {
  OpeningCard,
  EffectTraceEntry,
  EffectDomainEvent,
  BoardMinion,
  BoardWeapon,
  PlayerHeroState,
  PlayerMana,
  OpeningPlayerState,
  OpeningMatchState,
  UseHeroPowerCommand,
  HeroPowerTargetRef,
  CardPlayTargetRef,
  PlayCardCommand,
  ChooseDiscoverCardCommand,
  ChooseCardOptionCommand,
  AttackCharacterRef,
  AttackCharacterCommand,
  DevAddCardCommand,
  DevSetManaCommand,
  DevModifyDeckCommand,
  DevSummonMinionCommand,
  DevEndMatchCommand,
  OpeningMatchCommand,
  CoinGrantedEvent,
  OpeningCardDrawnEvent,
  CardDrawnEvent,
  CardGeneratedEvent,
  CardBurnedEvent,
  CharacterDamagedEvent,
  MinionCombatPreview,
  CharacterCombatantResult,
  CharacterCombatResolvedEvent,
  DevCardAddedEvent,
  OpeningMatchEvent,
  OpeningAcceptedResult,
  OpeningRejectionCode,
  OpeningRejectedResult,
  OpeningCommandResult,
  OpeningMatchInstance,
  OpeningMatchCheckpoint,
  OpeningMatchPublicEvent,
  OpeningMatchPublicState,
  OpeningPublicCard,
  OpeningPublicPlayerState,
  PlayCardInput,
  MatchLegality,
  HistoryActionResolvedEvent,
  HistoryActionOutcome,
  HistoryEntitySnapshot
} from './opening-match-types'
export type * from './opening-match-types'

/** Maximum number of cards a player may hold in hand. */
export const MAX_HAND_SIZE = 10

/** Maximum number of mana crystals a player may accumulate. */
export const MAX_MANA = 10

/** Maximum number of minions a player may have on their board. */
export const MAX_BOARD_SIZE = 7

const COIN_CARD_ID = asCardId('basic_the_coin')

function cloneUnknown<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => cloneUnknown(entry)) as T
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>))
    result[key] = cloneUnknown(nested)
  return result as T
}

function cloneCard(card: OpeningCard): OpeningCard {
  return cloneUnknown(card)
}

function cloneBoardMinion(minion: BoardMinion): BoardMinion {
  return cloneUnknown(minion)
}

function cloneBoardWeapon(weapon: BoardWeapon): BoardWeapon {
  return cloneUnknown(weapon)
}

function historySnapshotForCharacter(
  state: OpeningMatchState,
  participantId: PlayerId,
  character:
    { readonly kind: 'hero' } | { readonly kind: 'minion'; readonly instanceId: string }
): HistoryEntitySnapshot {
  if (character.kind === 'hero') {
    const player = state.players.find(
      (candidate) => candidate.participantId === participantId
    )
    return {
      id: `${participantId}:hero`,
      participantId,
      kind: 'hero',
      cardId: null,
      ...(player ? { heroId: player.heroId } : {})
    }
  }
  const player = state.players.find(
    (candidate) => candidate.participantId === participantId
  )
  const minion = player?.board.find(
    (candidate) => candidate.instanceId === character.instanceId
  )
  return {
    id: character.instanceId,
    participantId,
    kind: minion ? 'minion' : 'hidden',
    cardId: minion?.cardId ?? null
  }
}

function historySnapshotForCombatant(
  state: OpeningMatchState,
  participantId: PlayerId,
  character: AttackCharacterRef
): HistoryEntitySnapshot {
  return historySnapshotForCharacter(state, participantId, character)
}

function historySnapshotForInstance(
  state: OpeningMatchState,
  participantId: PlayerId,
  instanceId: string | null,
  cardId: CardId | null = null
): HistoryEntitySnapshot {
  if (instanceId === `${participantId}:hero`)
    return {
      id: instanceId,
      participantId,
      kind: 'hero',
      cardId: null,
      ...(state.players.find((player) => player.participantId === participantId)
        ? {
            heroId: state.players.find(
              (player) => player.participantId === participantId
            )!.heroId
          }
        : {})
    }
  const player = state.players.find(
    (candidate) => candidate.participantId === participantId
  )
  const minion = player?.board.find((candidate) => candidate.instanceId === instanceId)
  if (minion)
    return {
      id: minion.instanceId,
      participantId,
      kind: 'minion',
      cardId: minion.cardId
    }
  if (player?.weapon?.instanceId === instanceId)
    return {
      id: player.weapon.instanceId,
      participantId,
      kind: 'weapon',
      cardId: player.weapon.cardId
    }
  const card = [...(player?.hand ?? []), ...(player?.deck ?? [])].find(
    (candidate) => candidate.instanceId === instanceId
  )
  return {
    id: instanceId ?? `${participantId}:hidden:${cardId ?? 'unknown'}`,
    participantId,
    kind: cardId ? 'card' : 'hidden',
    cardId: card?.cardId ?? cardId,
    ...(card ? { baseCost: card.baseCost, currentCost: card.currentCost } : {})
  }
}

/** Resolves an effect target across both boards before falling back to its controller. */
function historySnapshotForEffectTarget(
  state: OpeningMatchState,
  fallbackParticipantId: PlayerId,
  instanceId: string | null,
  cardId: CardId | null = null
): HistoryEntitySnapshot {
  const owner = state.players.find(
    (player) =>
      instanceId === `${player.participantId}:hero` ||
      player.board.some((minion) => minion.instanceId === instanceId) ||
      player.weapon?.instanceId === instanceId ||
      [...player.hand, ...player.deck].some((card) => card.instanceId === instanceId)
  )
  return historySnapshotForInstance(
    state,
    owner?.participantId ?? fallbackParticipantId,
    instanceId,
    cardId
  )
}

function historyEffectOutcome(
  before: OpeningMatchState,
  after: OpeningMatchState,
  event: EffectDomainEvent
): readonly HistoryActionOutcome[] {
  const data = event.data ?? {}
  const participantId =
    typeof data.participantId === 'string'
      ? (data.participantId as PlayerId)
      : event.controllerId
  const instanceId =
    typeof data.target === 'string'
      ? data.target
      : typeof data.instanceId === 'string'
        ? data.instanceId
        : null
  const cardId = typeof data.cardId === 'string' ? asCardId(data.cardId) : null
  const target = historySnapshotForEffectTarget(
    event.action === 'add-to-hand' || event.action === 'summon' ? after : before,
    participantId,
    instanceId,
    cardId
  )
  if (event.action === 'damage') {
    const amount = typeof data.actualDamage === 'number' ? data.actualDamage : 0
    return [
      { kind: 'damage', target, amount },
      ...(typeof data.healthAfter === 'number' && data.healthAfter <= 0
        ? [{ kind: 'death' as const, target }]
        : [])
    ]
  }
  if (event.action === 'freeze') return [{ kind: 'freeze', target }]
  if (event.action === 'summon') return [{ kind: 'summon-board', target }]
  if (event.action === 'add-to-hand') return [{ kind: 'create-hand', target }]
  if (event.action === 'destroy') return [{ kind: 'destroy', target }]
  if (event.action === 'modify') return [{ kind: 'buff', target }]
  return []
}

function historyOutcomes(
  before: OpeningMatchState,
  after: OpeningMatchState,
  events: readonly OpeningMatchEvent[],
  includeEffectOutcomes = false
): readonly HistoryActionOutcome[] {
  const outcomes: HistoryActionOutcome[] = []
  for (const event of events) {
    switch (event.type) {
      case 'character-damaged': {
        const target = historySnapshotForCharacter(
          before,
          event.participantId,
          event.character
        )
        outcomes.push({ kind: 'damage', target, amount: event.amount })
        if (event.destroyed) outcomes.push({ kind: 'death', target })
        break
      }
      case 'character-healed':
        outcomes.push({
          kind: 'heal',
          target: historySnapshotForCharacter(
            before,
            event.participantId,
            event.character
          ),
          amount: event.amount
        })
        break
      case 'armor-gained':
        outcomes.push({
          kind: 'armor',
          target: {
            id: `${event.participantId}:hero`,
            participantId: event.participantId,
            kind: 'hero',
            cardId: null,
            heroId: before.players.find(
              (player) => player.participantId === event.participantId
            )?.heroId
          },
          amount: event.amount
        })
        break
      case 'fatigue':
        outcomes.push({
          kind: 'fatigue',
          target: {
            id: `${event.participantId}:hero`,
            participantId: event.participantId,
            kind: 'hero',
            cardId: null,
            heroId: before.players.find(
              (player) => player.participantId === event.participantId
            )?.heroId
          },
          amount: event.amount
        })
        break
      case 'hero-power-minion-summoned':
      case 'dev-minion-summoned':
        outcomes.push({
          kind: 'summon-board',
          target: {
            id: event.minion.instanceId,
            participantId: event.participantId,
            kind: 'minion',
            cardId: event.minion.cardId
          }
        })
        break
      case 'card-drawn':
      case 'opening-card-drawn':
        outcomes.push({
          kind: 'draw',
          target: {
            id: event.card.instanceId,
            participantId: event.participantId,
            kind: 'hidden',
            cardId: null
          }
        })
        break
      case 'minion-combat-resolved':
        outcomes.push({
          kind: 'damage',
          target: historySnapshotForCharacter(before, event.defender.participantId, {
            kind: 'minion',
            instanceId: event.defender.instanceId
          }),
          amount: event.defender.damageDealt
        })
        break
      case 'character-combat-resolved':
        outcomes.push({
          kind: 'damage',
          target: historySnapshotForCombatant(
            before,
            event.defender.participantId,
            event.defender.character
          ),
          amount: event.defender.damageDealt
        })
        break
      case 'effect-resolved': {
        if (includeEffectOutcomes)
          outcomes.push(...historyEffectOutcome(before, after, event))
        break
      }
      default:
        break
    }
  }
  return outcomes
}

function triggerHistoryEvents(
  before: OpeningMatchState,
  after: OpeningMatchState,
  events: readonly OpeningMatchEvent[]
): readonly HistoryActionResolvedEvent[] {
  const entries = new Map<
    string,
    {
      readonly participantId: PlayerId
      readonly source: HistoryEntitySnapshot
      readonly outcomes: HistoryActionOutcome[]
    }
  >()
  for (const event of events) {
    if (event.type !== 'effect-resolved') continue
    const outcomes = historyEffectOutcome(before, after, event)
    if (outcomes.length === 0 || !event.sourceCardId) continue
    const source = historySnapshotForEffectTarget(
      before,
      event.controllerId,
      event.sourceInstanceId,
      event.sourceCardId
    )
    if (source.kind !== 'minion') continue
    const existing = entries.get(source.id)
    if (existing) existing.outcomes.push(...outcomes)
    else
      entries.set(source.id, {
        participantId: event.controllerId,
        source,
        outcomes: [...outcomes]
      })
  }
  return [...entries.values()].map((entry) => ({
    type: 'history-action-resolved',
    participantId: entry.participantId,
    action: 'trigger',
    source: entry.source,
    outcomes: entry.outcomes
  }))
}

function fatigueHistoryEvents(
  before: OpeningMatchState,
  events: readonly OpeningMatchEvent[]
): readonly HistoryActionResolvedEvent[] {
  return events.flatMap((event) => {
    if (event.type !== 'fatigue') return []
    const target = historySnapshotForCharacter(before, event.participantId, {
      kind: 'hero'
    })
    return [
      {
        type: 'history-action-resolved' as const,
        participantId: event.participantId,
        action: 'fatigue' as const,
        source: {
          id: `${event.participantId}:fatigue`,
          participantId: event.participantId,
          kind: 'hidden' as const,
          cardId: null
        },
        outcomes: [{ kind: 'fatigue' as const, target, amount: event.amount }]
      }
    ]
  })
}

function cardHistoryEvent(
  before: OpeningMatchState,
  after: OpeningMatchState,
  command: PlayCardCommand,
  events: readonly OpeningMatchEvent[]
): HistoryActionResolvedEvent | null {
  const card = before.players
    .find((player) => player.participantId === command.participantId)
    ?.hand.find((candidate) => candidate.instanceId === command.cardInstanceId)
  if (!card) return null
  return {
    type: 'history-action-resolved',
    participantId: command.participantId,
    action: 'card',
    source: {
      id: card.instanceId,
      participantId: command.participantId,
      kind: 'card',
      cardId: card.cardId,
      baseCost: card.baseCost,
      currentCost: card.currentCost
    },
    outcomes: historyOutcomes(before, after, events, true)
  }
}

function heroPowerHistoryEvent(
  before: OpeningMatchState,
  after: OpeningMatchState,
  command: UseHeroPowerCommand,
  events: readonly OpeningMatchEvent[]
): HistoryActionResolvedEvent {
  const playerBefore = before.players.find(
    (player) => player.participantId === command.participantId
  )
  return {
    type: 'history-action-resolved',
    participantId: command.participantId,
    action: 'hero-power',
    source: {
      id: `${command.participantId}:hero-power`,
      participantId: command.participantId,
      kind: 'hero',
      cardId: null,
      heroPowerId: playerBefore?.heroPower.id,
      heroId: playerBefore?.heroId,
      baseCost: playerBefore?.heroPower.baseCost ?? playerBefore?.heroPower.cost,
      currentCost: playerBefore?.heroPower.cost
    },
    outcomes: historyOutcomes(before, after, events)
  }
}

function combatHistoryEvent(
  before: OpeningMatchState,
  after: OpeningMatchState,
  command: AttackCharacterCommand,
  events: readonly OpeningMatchEvent[]
): HistoryActionResolvedEvent {
  return {
    type: 'history-action-resolved',
    participantId: command.participantId,
    action: 'combat',
    source: historySnapshotForCombatant(
      before,
      command.participantId,
      command.attacker
    ),
    outcomes: historyOutcomes(before, after, events)
  }
}

export function hasSummoningSickness(
  minion: BoardMinion,
  currentTurn: number
): boolean {
  return minion.summonedOnTurn >= currentTurn
}

export function canBoardMinionAttack(
  minion: BoardMinion,
  state: OpeningMatchState,
  ownerId: PlayerId
): boolean {
  return getMatchLegality(state, ownerId).legalAttackerInstanceIds.includes(
    minion.instanceId
  )
}

/** Effective Attack shown on a hero during that hero's own turn. */
export function getHeroAttack(
  player: Pick<OpeningPlayerState, 'hero' | 'weapon'>
): number {
  return Math.max(0, player.hero.attack) + (player.weapon?.attack ?? 0)
}

export function canHeroAttack(
  _player: Pick<OpeningPlayerState, 'hero' | 'weapon'>,
  state: OpeningMatchState,
  ownerId: PlayerId
): boolean {
  return (
    getMatchLegality(state, ownerId).legalAttackTargets[`${ownerId}:hero`] !== undefined
  )
}

/** Resolves the stat-only result used both by targeting previews and combat. */
export function previewMinionCombat(
  attacker: Pick<BoardMinion, 'attack' | 'health'>,
  defender: Pick<BoardMinion, 'attack' | 'health'>
): MinionCombatPreview {
  const attackerHealthAfter = Math.max(0, attacker.health - defender.attack)
  const defenderHealthAfter = Math.max(0, defender.health - attacker.attack)
  return {
    attackerHealthAfter,
    defenderHealthAfter,
    attackerDestroyed: attackerHealthAfter === 0,
    defenderDestroyed: defenderHealthAfter === 0
  }
}

export function cloneOpeningMatchState(state: OpeningMatchState): OpeningMatchState {
  return cloneUnknown(state)
}
/** Masks private card identity while preserving immutable public snapshot data. */
function maskPublicCard(
  card: OpeningCard,
  viewerId: PlayerId,
  forceVisible = false
): OpeningPublicCard {
  const { knownTo: _knownTo, ...withoutKnowledge } = cloneCard(card)
  const visible =
    forceVisible ||
    (card.zone !== 'deck' &&
      (card.knownTo?.includes(viewerId) === true ||
        (card.zone === 'hand' && card.controllerId === viewerId)))
  if (visible) return withoutKnowledge as OpeningPublicCard
  return {
    ...withoutKnowledge,
    cardId: null,
    baseCost: null,
    currentCost: null,
    attack: null,
    health: null,
    costAdjustments: [],
    enchantments: []
  }
}

export function getOpeningMatchPublicState(
  state: OpeningMatchState,
  viewerId: PlayerId
): OpeningMatchPublicState {
  const snapshot = cloneOpeningMatchState(state)
  const {
    history: _history,
    effectTrace: _effectTrace,
    scheduledEffects: _scheduledEffects,
    pendingDiscover: _pendingDiscover,
    pendingCardChoice: _pendingCardChoice,
    ...publicSnapshot
  } = snapshot
  const players = snapshot.players.map((player) => ({
    ...player,
    // Deck order and identity are private even to its owner in a public snapshot.
    deck: player.deck.map((card) => maskPublicCard(card, viewerId)),
    hand: player.hand.map((card) => maskPublicCard(card, viewerId)),
    ...(player.revealedCards
      ? {
          revealedCards: player.revealedCards.map((card) =>
            maskPublicCard(card, viewerId)
          )
        }
      : {}),
    ...(player.discardedCards
      ? {
          discardedCards: player.discardedCards.map((card) =>
            maskPublicCard(card, viewerId)
          )
        }
      : {}),
    secrets: (player.secrets ?? []).map((secret) => ({
      ...secret,
      cardId: secret.controllerId === viewerId || secret.revealed ? secret.cardId : null
    }))
  })) as unknown as [OpeningPublicPlayerState, OpeningPublicPlayerState]
  void _history
  void _effectTrace
  void _scheduledEffects
  void _pendingDiscover
  void _pendingCardChoice
  const pendingDiscover =
    snapshot.pendingDiscover?.participantId === viewerId
      ? {
          ...snapshot.pendingDiscover,
          candidates: snapshot.pendingDiscover.candidates.map((card) =>
            maskPublicCard(card, viewerId, true)
          )
        }
      : undefined
  const pendingCardChoice =
    snapshot.pendingCardChoice?.participantId === viewerId
      ? snapshot.pendingCardChoice
      : undefined
  return {
    ...publicSnapshot,
    players,
    ...(pendingDiscover ? { pendingDiscover } : {}),
    ...(pendingCardChoice ? { pendingCardChoice } : {})
  }
}

function maskPublicEffectData(value: unknown, viewerId: PlayerId): unknown {
  if (Array.isArray(value))
    return value.map((entry) => maskPublicEffectData(entry, viewerId))
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'cardId' || key === 'sourceCardId') {
      result[key] = null
    } else if (
      key === 'card' &&
      isRecord(nested) &&
      typeof nested.cardId === 'string'
    ) {
      result[key] = maskPublicCard(nested as unknown as OpeningCard, viewerId)
    } else if (key === 'cardIds' && Array.isArray(nested)) {
      result[key] = nested.map(() => null)
    } else {
      result[key] = maskPublicEffectData(nested, viewerId)
    }
  }
  return result
}

function maskPublicEffectEvent(
  event: EffectDomainEvent,
  viewerId: PlayerId
): OpeningMatchPublicEvent {
  if (event.controllerId === viewerId) return { ...event }
  const data = event.data
    ? (maskPublicEffectData(event.data, viewerId) as Readonly<Record<string, unknown>>)
    : undefined
  return {
    ...event,
    sourceCardId: null,
    ...(data ? { data } : {})
  }
}

/** Projects card-bearing events without exposing identities unknown to the viewer. */
export function getOpeningMatchPublicEvents(
  events: readonly OpeningMatchEvent[],
  viewerId: PlayerId
): readonly OpeningMatchPublicEvent[] {
  return events.map((event) => {
    switch (event.type) {
      case 'effect-resolved':
        return maskPublicEffectEvent(event, viewerId)
      case 'mulligan-resolved':
        return {
          ...event,
          returnedCards: event.returnedCards.map((card) =>
            maskPublicCard(card, viewerId, event.participantId === viewerId)
          ),
          replacementCards: event.replacementCards.map((card) =>
            maskPublicCard(card, viewerId, event.participantId === viewerId)
          )
        }
      case 'discover-started':
        return {
          ...event,
          candidates: event.candidates.map((card) =>
            maskPublicCard(card, viewerId, event.participantId === viewerId)
          )
        }
      case 'card-choice-started':
        return event.participantId === viewerId ? event : { ...event, options: [] }
      case 'coin-granted':
      case 'opening-card-drawn':
      case 'card-drawn':
      case 'dev-card-added':
        return {
          ...event,
          card: maskPublicCard(
            cardForEvent(event),
            viewerId,
            event.participantId === viewerId
          )
        }
      case 'card-burned':
        return {
          ...event,
          card: maskPublicCard(cardForEvent(event), viewerId, true)
        }
      case 'history-action-resolved':
        return projectHistoryAction(event, viewerId)
      default:
        return event
    }
  }) as readonly OpeningMatchPublicEvent[]
}

function cardForEvent(
  event:
    | CoinGrantedEvent
    | OpeningCardDrawnEvent
    | CardDrawnEvent
    | CardGeneratedEvent
    | CardBurnedEvent
    | DevCardAddedEvent
): OpeningCard {
  return event.card
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseHeroPowerTarget(value: unknown): HeroPowerTargetRef | null {
  if (!isRecord(value) || typeof value.participantId !== 'string') return null
  if (value.kind === 'hero') {
    return { kind: 'hero', participantId: value.participantId as PlayerId }
  }
  if (value.kind === 'minion' && typeof value.instanceId === 'string') {
    return {
      kind: 'minion',
      participantId: value.participantId as PlayerId,
      instanceId: value.instanceId
    }
  }
  return null
}

function parseCardPlayTarget(value: unknown): CardPlayTargetRef | null {
  if (
    !isRecord(value) ||
    typeof value.kind !== 'string' ||
    typeof value.participantId !== 'string'
  )
    return null
  if (value.kind === 'hero')
    return { kind: 'hero', participantId: value.participantId as PlayerId }
  if (
    (value.kind === 'minion' ||
      value.kind === 'weapon' ||
      value.kind === 'card' ||
      value.kind === 'secret') &&
    typeof value.instanceId === 'string'
  ) {
    return {
      kind: value.kind,
      participantId: value.participantId as PlayerId,
      instanceId: value.instanceId
    } as CardPlayTargetRef
  }
  return null
}

function parseCommand(value: unknown): OpeningMatchCommand | null {
  if (!isRecord(value) || typeof value.participantId !== 'string') return null

  if (value.type === 'confirm-mulligan') {
    if (!Array.isArray(value.replaceInstanceIds)) return null
    if (!value.replaceInstanceIds.every((id) => typeof id === 'string')) return null
    return {
      type: 'confirm-mulligan',
      participantId: value.participantId as PlayerId,
      replaceInstanceIds: value.replaceInstanceIds
    }
  }

  if (value.type === 'end-turn') {
    return { type: 'end-turn', participantId: value.participantId as PlayerId }
  }

  if (value.type === 'use-hero-power') {
    const target =
      value.target === undefined ? undefined : parseHeroPowerTarget(value.target)
    if (value.target !== undefined && !target) return null
    return {
      type: 'use-hero-power',
      participantId: value.participantId as PlayerId,
      ...(target ? { target } : {})
    }
  }

  if (value.type === 'play-card') {
    if (typeof value.cardInstanceId !== 'string') return null
    if (
      value.position !== undefined &&
      (typeof value.position !== 'number' || !Number.isInteger(value.position))
    )
      return null
    if (
      value.choice !== undefined &&
      (typeof value.choice !== 'number' || !Number.isInteger(value.choice))
    )
      return null
    let targets: CardPlayTargetRef[] | undefined
    if (value.targets !== undefined) {
      if (!Array.isArray(value.targets)) return null
      targets = []
      for (const targetValue of value.targets) {
        const target = parseCardPlayTarget(targetValue)
        if (!target) return null
        targets.push(target)
      }
    }
    return {
      type: 'play-card',
      participantId: value.participantId as PlayerId,
      cardInstanceId: value.cardInstanceId,
      ...(value.position === undefined ? {} : { position: value.position }),
      ...(targets === undefined ? {} : { targets }),
      ...(value.choice === undefined ? {} : { choice: value.choice })
    }
  }

  if (value.type === 'choose-discover-card') {
    if (typeof value.cardInstanceId !== 'string') return null
    return {
      type: 'choose-discover-card',
      participantId: value.participantId as PlayerId,
      cardInstanceId: value.cardInstanceId
    }
  }
  if (value.type === 'choose-card-option') {
    if (
      typeof value.sourceCardInstanceId !== 'string' ||
      typeof value.choice !== 'number' ||
      !Number.isInteger(value.choice)
    )
      return null
    return {
      type: 'choose-card-option',
      participantId: value.participantId as PlayerId,
      sourceCardInstanceId: value.sourceCardInstanceId,
      choice: value.choice
    }
  }
  if (value.type === 'timeout') {
    if (
      value.elapsedSeconds !== undefined &&
      (typeof value.elapsedSeconds !== 'number' || value.elapsedSeconds < 0)
    )
      return null
    return {
      type: 'timeout',
      participantId: value.participantId as PlayerId,
      ...(value.elapsedSeconds === undefined
        ? {}
        : { elapsedSeconds: value.elapsedSeconds })
    }
  }

  if (value.type === 'attack-character') {
    const parseRef = (ref: unknown): AttackCharacterRef | null => {
      if (!isRecord(ref) || typeof ref.kind !== 'string') return null
      if (ref.kind === 'hero') return { kind: 'hero' }
      if (ref.kind === 'minion' && typeof ref.instanceId === 'string') {
        return { kind: 'minion', instanceId: ref.instanceId }
      }
      return null
    }
    const attacker = parseRef(value.attacker)
    const defender = parseRef(value.defender)
    if (!attacker || !defender) return null
    return {
      type: 'attack-character',
      participantId: value.participantId as PlayerId,
      attacker,
      defender
    }
  }

  if (value.type === 'dev-add-card') {
    if (typeof value.cardId !== 'string') return null
    return {
      type: 'dev-add-card',
      participantId: value.participantId as PlayerId,
      cardId: value.cardId as CardId
    }
  }

  if (value.type === 'dev-set-mana') {
    if (typeof value.available !== 'number' || !Number.isInteger(value.available))
      return null
    if (typeof value.maximum !== 'number' || !Number.isInteger(value.maximum))
      return null
    return {
      type: 'dev-set-mana',
      participantId: value.participantId as PlayerId,
      available: value.available,
      maximum: value.maximum
    }
  }

  if (value.type === 'dev-modify-deck') {
    if (value.action !== 'destroy' && value.action !== 'refill') return null
    return {
      type: 'dev-modify-deck',
      participantId: value.participantId as PlayerId,
      action: value.action
    }
  }

  if (value.type === 'dev-summon-minion') {
    if (typeof value.cardId !== 'string') return null
    return {
      type: 'dev-summon-minion',
      participantId: value.participantId as PlayerId,
      cardId: value.cardId as CardId
    }
  }

  if (value.type === 'dev-end-match') {
    if (typeof value.winnerId !== 'string') return null
    return {
      type: 'dev-end-match',
      participantId: value.participantId as PlayerId,
      winnerId: value.winnerId as PlayerId
    }
  }

  if (value.type === 'dev-set-hero') {
    const health = value.health
    const armor = value.armor
    const attack = value.attack
    if (
      ![health, armor, attack].some(
        (entry) => typeof entry === 'number' && Number.isInteger(entry)
      )
    )
      return null
    return {
      type: 'dev-set-hero',
      participantId: value.participantId as PlayerId,
      ...(typeof health === 'number' ? { health } : {}),
      ...(typeof armor === 'number' ? { armor } : {}),
      ...(typeof attack === 'number' ? { attack } : {})
    }
  }
  if (value.type === 'dev-set-hero-power') {
    const cost = value.cost
    const available = value.available
    if (typeof cost !== 'number' && typeof available !== 'boolean') return null
    return {
      type: 'dev-set-hero-power',
      participantId: value.participantId as PlayerId,
      ...(typeof cost === 'number' ? { cost } : {}),
      ...(typeof available === 'boolean' ? { available } : {})
    }
  }
  if (
    value.type === 'dev-clear-zone' &&
    (value.zone === 'hand' || value.zone === 'board')
  )
    return {
      type: 'dev-clear-zone',
      participantId: value.participantId as PlayerId,
      zone: value.zone
    }
  if (
    value.type === 'dev-set-fatigue' &&
    typeof value.nextDamage === 'number' &&
    Number.isInteger(value.nextDamage)
  )
    return {
      type: 'dev-set-fatigue',
      participantId: value.participantId as PlayerId,
      nextDamage: value.nextDamage
    }
  if (value.type === 'dev-remove-weapon')
    return {
      type: 'dev-remove-weapon',
      participantId: value.participantId as PlayerId
    }
  if (value.type === 'dev-draw')
    return { type: 'dev-draw', participantId: value.participantId as PlayerId }

  return null
}

void applyUseHeroPower
void applyAttackCharacter
void applyAttackMinion

function shuffle<T>(items: readonly T[], random: DeterministicRng): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random.next() * (index + 1))
    const current = result[index]
    const replacement = result[swapIndex]
    if (current === undefined || replacement === undefined) continue
    result[index] = replacement
    result[swapIndex] = current
  }
  return result
}

function expandDeck(
  deck: Deck,
  participant: MatchParticipantSetup,
  ordinalOffset = 0
): OpeningCard[] {
  if (countDeckCards(deck) !== 30) {
    throw new Error(`Deck ${deck.id} must contain exactly 30 cards.`)
  }

  const cards: OpeningCard[] = []
  let ordinal = 0
  for (const [cardId, count] of Object.entries(deck.cards)) {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(`Deck ${deck.id} contains an invalid count for ${cardId}.`)
    }
    const definition = CARD_CATALOG.get(cardId)
    if (!definition)
      throw new Error(`Deck ${deck.id} references unknown card ${cardId}.`)

    for (let copy = 0; copy < count; copy += 1) {
      cards.push({
        instanceId: `${participant.participantId}:deck:${ordinal}`,
        cardId: definition.id,
        ownerId: participant.participantId,
        controllerId: participant.participantId,
        creationOrdinal: ordinalOffset + ordinal,
        baseCost: definition.cost,
        currentCost: definition.cost,
        zone: 'deck',
        revealed: false
      })
      ordinal += 1
    }
  }
  return cards
}

function findPlayerIndex(
  players: readonly [OpeningPlayerState, OpeningPlayerState],
  participantId: PlayerId
): 0 | 1 | -1 {
  if (players[0].participantId === participantId) return 0
  if (players[1].participantId === participantId) return 1
  return -1
}

function growMana(mana: PlayerMana): PlayerMana {
  const maximum = Math.min(MAX_MANA, mana.maximum + 1)
  return {
    available: maximum,
    maximum,
    overloadLocked: 0,
    overloadNextTurn: mana.overloadNextTurn ?? 0
  }
}

function drawCards(
  player: OpeningPlayerState,
  count: number
): { player: OpeningPlayerState; cards: OpeningCard[] } {
  const cards = player.deck.slice(0, count).map((card) => ({
    ...cloneCard(card),
    zone: 'hand' as const,
    revealed: true
  }))
  return {
    cards,
    player: {
      ...player,
      deck: player.deck.slice(cards.length),
      hand: [...player.hand, ...cards]
    }
  }
}

interface HeroDamageResult {
  readonly hero: PlayerHeroState
  readonly event: CharacterDamagedEvent
}

function damageHero(
  player: OpeningPlayerState,
  amount: number,
  source: CharacterDamagedEvent['source']
): HeroDamageResult {
  const armorDamage = Math.min(player.hero.armor, amount)
  const healthDamage = Math.max(0, amount - armorDamage)
  const hero = {
    ...player.hero,
    armor: player.hero.armor - armorDamage,
    health: Math.max(0, player.hero.health - healthDamage),
    damageTaken: Math.max(
      0,
      player.hero.maxHealth - Math.max(0, player.hero.health - healthDamage)
    )
  }
  return {
    hero,
    event: {
      type: 'character-damaged',
      source,
      participantId: player.participantId,
      character: { kind: 'hero' },
      amount,
      healthBefore: player.hero.health,
      healthAfter: hero.health,
      armorBefore: player.hero.armor,
      armorAfter: hero.armor,
      destroyed: hero.health === 0
    }
  }
}

function withLethalResult(
  state: OpeningMatchState,
  events: OpeningMatchEvent[]
): OpeningAcceptedResult {
  const loserIndex = state.players.findIndex((player) => player.hero.health <= 0)
  if (loserIndex < 0) {
    return { accepted: true, state: cloneOpeningMatchState(state), events }
  }
  const winnerIndex: 0 | 1 = loserIndex === 0 ? 1 : 0
  const winnerId = state.players[winnerIndex].participantId
  const loserId = state.players[loserIndex as 0 | 1].participantId
  const endedState: OpeningMatchState = {
    ...state,
    phase: 'ended',
    activePlayerId: null,
    winnerId,
    loserId
  }
  events.push({
    type: 'match-ended',
    winnerId,
    loserId,
    reason: 'hero-health-depleted'
  })
  return { accepted: true, state: cloneOpeningMatchState(endedState), events }
}

function createBoardMinion(
  cardId: CardId,
  instanceId: string,
  turnNumber: number
): BoardMinion {
  const definition = CARD_CATALOG.require(cardId)
  if (definition.type !== 'Minion') throw new Error(`${cardId} is not a minion.`)
  return {
    instanceId,
    cardId: definition.id,
    attack: definition.attack,
    health: definition.health,
    maxHealth: definition.health,
    summonedOnTurn: turnNumber,
    lastAttackedOnTurn: null
  }
}

function reject(
  state: OpeningMatchState,
  code: OpeningRejectionCode,
  message: string
): OpeningRejectedResult {
  return {
    accepted: false,
    code,
    message,
    state: cloneOpeningMatchState(state),
    events: []
  }
}

function applyUseHeroPower(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: UseHeroPowerCommand,
  rng: DeterministicRng,
  counter: number
): OpeningCommandResult & { nextCounter?: number } {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }
  const player = state.players[playerIndex]
  if (state.activePlayerId !== player.participantId) {
    return reject(
      state,
      'not-active-player',
      'Only the active player can use their hero power.'
    )
  }
  if (!player.heroPower.available) {
    return reject(
      state,
      'hero-power-unavailable',
      'The hero power was already used this turn.'
    )
  }
  if (player.mana.available < player.heroPower.cost) {
    return reject(state, 'insufficient-mana', 'Not enough mana to use the hero power.')
  }
  const definition = HERO_POWER_CATALOG.require(player.heroPower.id)
  if (definition.targeting === 'any-character' && !command.target) {
    return reject(state, 'invalid-target', 'This hero power requires a target.')
  }
  if (definition.targeting === 'none' && command.target) {
    return reject(state, 'invalid-target', 'This hero power does not accept a target.')
  }

  let targetIndex: 0 | 1 | null = null
  if (command.target) {
    const found = findPlayerIndex(state.players, command.target.participantId)
    if (found === -1) {
      return reject(
        state,
        'invalid-target',
        'The selected hero power target is invalid.'
      )
    }
    targetIndex = found
    const targetPlayer = state.players[found]
    if (command.target.kind === 'hero') {
      if (targetPlayer.hero.health <= 0) {
        return reject(state, 'invalid-target', 'The selected hero is not alive.')
      }
    } else {
      const instanceId = command.target.instanceId
      const minion = targetPlayer.board.find(
        (candidate) => candidate.instanceId === instanceId
      )
      if (!minion || minion.health <= 0) {
        return reject(state, 'invalid-target', 'The selected minion is not in play.')
      }
    }
  }

  if (
    (definition.effect.kind === 'summon' ||
      definition.effect.kind === 'summon-random-totem') &&
    player.board.length >= MAX_BOARD_SIZE
  ) {
    return reject(state, 'board-full', 'The board is full.')
  }

  let selectedTotem: CardId | null = null
  if (definition.effect.kind === 'summon-random-totem') {
    const controlled = new Set(player.board.map((minion) => minion.cardId))
    const eligible = definition.effect.cardIds.filter(
      (cardId) => !controlled.has(cardId)
    )
    if (eligible.length === 0) {
      return reject(
        state,
        'hero-power-unavailable',
        'All four basic Totems are in play.'
      )
    }
    selectedTotem =
      eligible[Math.floor(rng.next() * eligible.length)] ?? eligible[0] ?? null
  }

  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = {
    ...player,
    mana: {
      ...player.mana,
      available: player.mana.available - player.heroPower.cost
    },
    heroPower: { ...player.heroPower, available: false }
  }
  const events: OpeningMatchEvent[] = [
    {
      type: 'hero-power-used',
      participantId: player.participantId,
      heroPowerId: definition.id,
      ...(command.target ? { target: command.target } : {}),
      cost: player.heroPower.cost,
      mana: nextPlayers[playerIndex].mana
    }
  ]

  const gainArmor = (amount: number): void => {
    const current = nextPlayers[playerIndex]
    const armorBefore = current.hero.armor
    nextPlayers[playerIndex] = {
      ...current,
      hero: { ...current.hero, armor: armorBefore + amount }
    }
    events.push({
      type: 'armor-gained',
      participantId: current.participantId,
      amount,
      armorBefore,
      armorAfter: armorBefore + amount
    })
  }

  switch (definition.effect.kind) {
    case 'gain-attack-and-armor': {
      const current = nextPlayers[playerIndex]
      nextPlayers[playerIndex] = {
        ...current,
        hero: {
          ...current.hero,
          attack: current.hero.attack + definition.effect.attack
        }
      }
      gainArmor(definition.effect.armor)
      break
    }
    case 'gain-armor':
      gainArmor(definition.effect.amount)
      break
    case 'damage-enemy-hero': {
      const opponentIndex: 0 | 1 = playerIndex === 0 ? 1 : 0
      const opponent = nextPlayers[opponentIndex]
      const damaged = damageHero(opponent, definition.effect.amount, 'hero-power')
      nextPlayers[opponentIndex] = { ...opponent, hero: damaged.hero }
      events.push(damaged.event)
      break
    }
    case 'damage-random-enemy': {
      const opponentIndex: 0 | 1 = playerIndex === 0 ? 1 : 0
      const opponent = nextPlayers[opponentIndex]
      const candidates: readonly HeroPowerTargetRef[] = [
        { kind: 'hero', participantId: opponent.participantId },
        ...opponent.board.map((minion) => ({
          kind: 'minion' as const,
          participantId: opponent.participantId,
          instanceId: minion.instanceId
        }))
      ]
      const target = candidates[Math.floor(rng.next() * candidates.length)]
      if (!target) break
      if (target.kind === 'hero') {
        const damaged = damageHero(opponent, definition.effect.amount, 'hero-power')
        nextPlayers[opponentIndex] = { ...opponent, hero: damaged.hero }
        events.push(damaged.event)
      } else {
        const minion = opponent.board.find(
          (entry) => entry.instanceId === target.instanceId
        )
        if (!minion) break
        const healthAfter = Math.max(0, minion.health - definition.effect.amount)
        nextPlayers[opponentIndex] = {
          ...opponent,
          board: opponent.board
            .map((entry) =>
              entry.instanceId === minion.instanceId
                ? { ...entry, health: healthAfter }
                : cloneBoardMinion(entry)
            )
            .filter((entry) => entry.health > 0)
        }
        events.push({
          type: 'character-damaged',
          source: 'hero-power',
          participantId: opponent.participantId,
          character: { kind: 'minion', instanceId: minion.instanceId },
          amount: definition.effect.amount,
          healthBefore: minion.health,
          healthAfter,
          armorBefore: 0,
          armorAfter: 0,
          destroyed: healthAfter === 0
        })
      }
      break
    }
    case 'damage-character': {
      if (targetIndex === null || !command.target) break
      const targetPlayer = nextPlayers[targetIndex]
      if (command.target.kind === 'hero') {
        const damaged = damageHero(targetPlayer, definition.effect.amount, 'hero-power')
        nextPlayers[targetIndex] = { ...targetPlayer, hero: damaged.hero }
        events.push(damaged.event)
      } else {
        const instanceId = command.target.instanceId
        const minion = targetPlayer.board.find(
          (candidate) => candidate.instanceId === instanceId
        )!
        const healthAfter = Math.max(0, minion.health - definition.effect.amount)
        nextPlayers[targetIndex] = {
          ...targetPlayer,
          board: targetPlayer.board
            .map((candidate) =>
              candidate.instanceId === minion.instanceId
                ? { ...candidate, health: healthAfter }
                : cloneBoardMinion(candidate)
            )
            .filter((candidate) => candidate.health > 0)
        }
        events.push({
          type: 'character-damaged',
          source: 'hero-power',
          participantId: targetPlayer.participantId,
          character: { kind: 'minion', instanceId: minion.instanceId },
          amount: definition.effect.amount,
          healthBefore: minion.health,
          healthAfter,
          armorBefore: 0,
          armorAfter: 0,
          destroyed: healthAfter === 0
        })
      }
      break
    }
    case 'restore-character': {
      if (targetIndex === null || !command.target) break
      const targetPlayer = nextPlayers[targetIndex]
      if (command.target.kind === 'hero') {
        const healthAfter = Math.min(
          targetPlayer.hero.maxHealth,
          targetPlayer.hero.health + definition.effect.amount
        )
        nextPlayers[targetIndex] = {
          ...targetPlayer,
          hero: {
            ...targetPlayer.hero,
            health: healthAfter,
            damageTaken: Math.max(0, targetPlayer.hero.maxHealth - healthAfter)
          }
        }
        events.push({
          type: 'character-healed',
          participantId: targetPlayer.participantId,
          character: { kind: 'hero' },
          amount: healthAfter - targetPlayer.hero.health,
          attemptedAmount: definition.effect.amount,
          healthBefore: targetPlayer.hero.health,
          healthAfter
        })
      } else {
        const instanceId = command.target.instanceId
        const minion = targetPlayer.board.find(
          (candidate) => candidate.instanceId === instanceId
        )!
        const healthAfter = Math.min(
          minion.maxHealth,
          minion.health + definition.effect.amount
        )
        nextPlayers[targetIndex] = {
          ...targetPlayer,
          board: targetPlayer.board.map((candidate) =>
            candidate.instanceId === minion.instanceId
              ? { ...candidate, health: healthAfter }
              : cloneBoardMinion(candidate)
          )
        }
        events.push({
          type: 'character-healed',
          participantId: targetPlayer.participantId,
          character: { kind: 'minion', instanceId: minion.instanceId },
          amount: healthAfter - minion.health,
          attemptedAmount: definition.effect.amount,
          healthBefore: minion.health,
          healthAfter
        })
      }
      break
    }
    case 'summon':
    case 'summon-random-totem': {
      const cardId =
        definition.effect.kind === 'summon' ? definition.effect.cardId : selectedTotem
      if (!cardId) break
      const current = nextPlayers[playerIndex]
      const minion = createBoardMinion(
        cardId,
        `${current.participantId}:hero-power:${counter}`,
        state.turnNumber
      )
      const position = current.board.length
      nextPlayers[playerIndex] = {
        ...current,
        board: [...current.board.map(cloneBoardMinion), minion]
      }
      events.push({
        type: 'hero-power-minion-summoned',
        participantId: current.participantId,
        minion: cloneBoardMinion(minion),
        position
      })
      counter += 1
      break
    }
    case 'equip-weapon': {
      const current = nextPlayers[playerIndex]
      const weaponDefinition = CARD_CATALOG.require(definition.effect.cardId)
      if (weaponDefinition.type !== 'Weapon') {
        throw new Error(`${definition.effect.cardId} is not a weapon.`)
      }
      const weapon: BoardWeapon = {
        instanceId: `${current.participantId}:hero-power:${counter}`,
        cardId: weaponDefinition.id,
        attack: weaponDefinition.attack,
        durability: weaponDefinition.durability,
        maxDurability: weaponDefinition.durability
      }
      nextPlayers[playerIndex] = { ...current, weapon }
      events.push({
        type: 'weapon-equipped',
        participantId: current.participantId,
        weapon: cloneBoardWeapon(weapon),
        replacedWeapon: current.weapon ? cloneBoardWeapon(current.weapon) : null
      })
      counter += 1
      break
    }
    case 'draw-and-self-damage': {
      for (let draw = 0; draw < definition.effect.count; draw += 1) {
        let current = nextPlayers[playerIndex]
        const card = current.deck[0]
        if (card) {
          current = { ...current, deck: current.deck.slice(1) }
          if (current.hand.length >= MAX_HAND_SIZE) {
            events.push({
              type: 'card-burned',
              participantId: current.participantId,
              card: cloneCard(card)
            })
          } else {
            current = {
              ...current,
              hand: [
                ...current.hand,
                { ...cloneCard(card), zone: 'hand', revealed: true }
              ]
            }
            events.push({
              type: 'card-drawn',
              participantId: current.participantId,
              card: cloneCard(card)
            })
          }
          nextPlayers[playerIndex] = current
        } else {
          const damaged = damageHero(current, current.fatigueDamage, 'fatigue')
          nextPlayers[playerIndex] = {
            ...current,
            hero: damaged.hero,
            fatigueDamage: current.fatigueDamage + 1
          }
          events.push({
            type: 'fatigue',
            participantId: current.participantId,
            amount: current.fatigueDamage,
            nextDamage: current.fatigueDamage + 1
          })
          events.push(damaged.event)
        }
      }
      const current = nextPlayers[playerIndex]
      const damaged = damageHero(current, definition.effect.amount, 'hero-power')
      nextPlayers[playerIndex] = { ...current, hero: damaged.hero }
      events.push(damaged.event)
      break
    }
  }

  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1
  }
  return {
    ...withLethalResult(nextState, events),
    nextCounter: counter
  }
}

/** Resolves direct combat between any two opposing characters. */
function applyAttackCharacter(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: AttackCharacterCommand
): OpeningCommandResult {
  return resolveAttackCharacter(state, playerIndex, command, false)
}

/** Compatibility adapter for the original minion-only command contract. */
function applyAttackMinion(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: {
    readonly participantId: PlayerId
    readonly attackerInstanceId: string
    readonly defenderInstanceId: string
  }
): OpeningCommandResult {
  return resolveAttackCharacter(
    state,
    playerIndex,
    {
      type: 'attack-character',
      participantId: command.participantId,
      attacker: { kind: 'minion', instanceId: command.attackerInstanceId },
      defender: { kind: 'minion', instanceId: command.defenderInstanceId }
    },
    true
  )
}

function resolveAttackCharacter(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: AttackCharacterCommand,
  legacyMinionEvent: boolean
): OpeningCommandResult {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }

  const attackerPlayer = state.players[playerIndex]
  if (state.activePlayerId !== attackerPlayer.participantId) {
    return reject(state, 'not-active-player', 'Only the active player can attack.')
  }

  const attackerLookupId =
    command.attacker.kind === 'minion' ? command.attacker.instanceId : null
  const attackerMinion =
    attackerLookupId === null
      ? undefined
      : attackerPlayer.board.find(
          (candidate) => candidate.instanceId === attackerLookupId
        )
  if (command.attacker.kind === 'minion' && !attackerMinion) {
    return reject(
      state,
      'invalid-attacker',
      'The selected attacker is not on your board.'
    )
  }
  if (command.attacker.kind === 'hero') {
    if (!canHeroAttack(attackerPlayer, state, attackerPlayer.participantId)) {
      return reject(state, 'hero-cannot-attack', 'Your hero cannot attack right now.')
    }
  } else if (
    attackerMinion &&
    !canBoardMinionAttack(attackerMinion, state, attackerPlayer.participantId)
  ) {
    return reject(state, 'minion-cannot-attack', 'That minion cannot attack right now.')
  }

  const defenderIndex: 0 | 1 = playerIndex === 0 ? 1 : 0
  const defenderPlayer = state.players[defenderIndex]
  const defenderLookupId =
    command.defender.kind === 'minion' ? command.defender.instanceId : null
  const defenderMinion =
    defenderLookupId === null
      ? undefined
      : defenderPlayer.board.find(
          (candidate) => candidate.instanceId === defenderLookupId
        )
  if (command.defender.kind === 'minion' && !defenderMinion) {
    return reject(
      state,
      'invalid-target',
      'The selected target is not an opposing minion.'
    )
  }

  const attackerAttack =
    command.attacker.kind === 'hero'
      ? getHeroAttack(attackerPlayer)
      : (attackerMinion?.attack ?? 0)
  const defenderAttack =
    command.defender.kind === 'minion' ? (defenderMinion?.attack ?? 0) : 0
  const attackerHealth =
    command.attacker.kind === 'hero'
      ? attackerPlayer.hero.health
      : (attackerMinion?.health ?? 0)
  const defenderHealth =
    command.defender.kind === 'hero'
      ? defenderPlayer.hero.health
      : (defenderMinion?.health ?? 0)
  const attackerArmor = command.attacker.kind === 'hero' ? attackerPlayer.hero.armor : 0
  const defenderArmor = command.defender.kind === 'hero' ? defenderPlayer.hero.armor : 0
  const attackerArmorAfter = Math.max(0, attackerArmor - defenderAttack)
  const defenderArmorAfter = Math.max(0, defenderArmor - attackerAttack)
  const attackerHealthAfter = Math.max(
    0,
    attackerHealth - Math.max(0, defenderAttack - attackerArmor)
  )
  const defenderHealthAfter = Math.max(
    0,
    defenderHealth - Math.max(0, attackerAttack - defenderArmor)
  )
  const attackerDestroyed = attackerHealthAfter === 0
  const defenderDestroyed = defenderHealthAfter === 0

  let weaponResult: CharacterCombatResolvedEvent['weapon'] = null
  let nextAttackerWeapon = attackerPlayer.weapon
  if (command.attacker.kind === 'hero' && attackerPlayer.weapon) {
    const weapon = attackerPlayer.weapon
    const durabilityAfter = Math.max(0, weapon.durability - 1)
    weaponResult = {
      participantId: attackerPlayer.participantId,
      durabilityBefore: weapon.durability,
      durabilityAfter,
      destroyed: durabilityAfter === 0
    }
    nextAttackerWeapon =
      durabilityAfter > 0 ? { ...weapon, durability: durabilityAfter } : null
  }

  const attackerInstanceId =
    command.attacker.kind === 'minion' ? command.attacker.instanceId : null
  const defenderInstanceId =
    command.defender.kind === 'minion' ? command.defender.instanceId : null
  const nextAttackerBoard = attackerPlayer.board
    .map((candidate) => {
      if (attackerInstanceId === null || candidate.instanceId !== attackerInstanceId) {
        return cloneBoardMinion(candidate)
      }
      if (attackerDestroyed) return null
      return {
        ...cloneBoardMinion(candidate),
        health: attackerHealthAfter,
        lastAttackedOnTurn: state.turnNumber
      }
    })
    .filter((candidate): candidate is BoardMinion => candidate !== null)
  const nextDefenderBoard = defenderPlayer.board
    .map((candidate) => {
      if (defenderInstanceId === null || candidate.instanceId !== defenderInstanceId) {
        return cloneBoardMinion(candidate)
      }
      if (defenderDestroyed) return null
      return { ...cloneBoardMinion(candidate), health: defenderHealthAfter }
    })
    .filter((candidate): candidate is BoardMinion => candidate !== null)

  const nextAttackerHero =
    command.attacker.kind === 'hero'
      ? {
          ...attackerPlayer.hero,
          health: attackerHealthAfter,
          armor: attackerArmorAfter,
          lastAttackedOnTurn: state.turnNumber
        }
      : attackerPlayer.hero
  const nextDefenderHero =
    command.defender.kind === 'hero'
      ? {
          ...defenderPlayer.hero,
          health: defenderHealthAfter,
          armor: defenderArmorAfter
        }
      : defenderPlayer.hero
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = {
    ...attackerPlayer,
    hero: nextAttackerHero,
    board: nextAttackerBoard,
    weapon: nextAttackerWeapon
  }
  nextPlayers[defenderIndex] = {
    ...defenderPlayer,
    hero: nextDefenderHero,
    board: nextDefenderBoard
  }

  const attackerHeroDead = nextAttackerHero.health <= 0
  const defenderHeroDead = nextDefenderHero.health <= 0
  const matchEnded = attackerHeroDead || defenderHeroDead
  const winnerId = matchEnded
    ? attackerHeroDead
      ? defenderPlayer.participantId
      : attackerPlayer.participantId
    : null
  const loserId = matchEnded
    ? attackerHeroDead
      ? attackerPlayer.participantId
      : defenderPlayer.participantId
    : null
  const nextState: OpeningMatchState = {
    ...state,
    phase: matchEnded ? 'ended' : state.phase,
    activePlayerId: matchEnded ? null : state.activePlayerId,
    winnerId,
    loserId,
    players: nextPlayers,
    revision: state.revision + 1
  }

  const attackerResult = {
    participantId: attackerPlayer.participantId,
    character: command.attacker,
    attack: attackerAttack,
    damageDealt: attackerAttack,
    attemptedDamage: defenderAttack,
    healthBefore: attackerHealth,
    healthAfter: attackerHealthAfter,
    armorBefore: attackerArmor,
    armorAfter: attackerArmorAfter,
    destroyed: attackerDestroyed
  } satisfies CharacterCombatantResult
  const defenderResult = {
    participantId: defenderPlayer.participantId,
    character: command.defender,
    attack: defenderAttack,
    damageDealt: defenderAttack,
    attemptedDamage: attackerAttack,
    healthBefore: defenderHealth,
    healthAfter: defenderHealthAfter,
    armorBefore: defenderArmor,
    armorAfter: defenderArmorAfter,
    destroyed: defenderDestroyed
  } satisfies CharacterCombatantResult

  if (legacyMinionEvent) {
    const attacker = attackerMinion
    const defender = defenderMinion
    if (!attacker || !defender) {
      return reject(
        state,
        'invalid-target',
        'The selected target is not an opposing minion.'
      )
    }
    const legacyState: OpeningMatchState = {
      ...nextState,
      winnerId: null,
      loserId: null
    }
    return {
      accepted: true,
      state: cloneOpeningMatchState(legacyState),
      events: [
        {
          type: 'minion-combat-resolved',
          attacker: {
            participantId: attackerPlayer.participantId,
            instanceId: attacker.instanceId,
            attack: attacker.attack,
            damageDealt: attacker.attack,
            attemptedDamage: defender.attack,
            healthBefore: attacker.health,
            healthAfter: attackerHealthAfter,
            destroyed: attackerDestroyed
          },
          defender: {
            participantId: defenderPlayer.participantId,
            instanceId: defender.instanceId,
            attack: defender.attack,
            damageDealt: defender.attack,
            attemptedDamage: attacker.attack,
            healthBefore: defender.health,
            healthAfter: defenderHealthAfter,
            destroyed: defenderDestroyed
          }
        }
      ]
    }
  }

  const events: OpeningMatchEvent[] = [
    {
      type: 'character-combat-resolved',
      attacker: attackerResult,
      defender: defenderResult,
      weapon: weaponResult
    }
  ]
  if (winnerId && loserId) {
    events.push({
      type: 'match-ended',
      winnerId,
      loserId,
      reason: 'hero-health-depleted'
    })
  }
  return { accepted: true, state: cloneOpeningMatchState(nextState), events }
}

function applyDevAddCard(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: DevAddCardCommand,
  counter: number
): OpeningCommandResult & { nextEntityOrdinal?: number } {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }
  const player = state.players[playerIndex]
  if (player.hand.length >= MAX_HAND_SIZE) {
    return reject(state, 'hand-full', 'The hand is full.')
  }

  const definition = CARD_CATALOG.get(command.cardId)
  if (!definition) {
    return reject(state, 'unknown-card', `Unknown card ${command.cardId}.`)
  }

  const card: OpeningCard = {
    instanceId: `${player.participantId}:dev:${counter}`,
    cardId: definition.id,
    ownerId: player.participantId,
    controllerId: player.participantId,
    creationOrdinal: counter,
    baseCost: definition.cost,
    currentCost: definition.cost,
    zone: 'hand',
    revealed: true
  }

  const nextPlayer: OpeningPlayerState = {
    ...player,
    hand: [...player.hand, card]
  }
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = nextPlayer
  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1,
    nextEntityOrdinal: counter + 1
  }

  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [
      {
        type: 'dev-card-added',
        participantId: player.participantId,
        card: cloneCard(card)
      }
    ],
    nextEntityOrdinal: counter + 1
  }
}

function applyDevSummonMinion(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: DevSummonMinionCommand,
  counter: number
): OpeningCommandResult & { nextEntityOrdinal?: number } {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }

  const player = state.players[playerIndex]
  if (player.board.length >= MAX_BOARD_SIZE) {
    return reject(state, 'board-full', 'The board is full.')
  }
  const definition = CARD_CATALOG.get(command.cardId)
  if (!definition) {
    return reject(state, 'unknown-card', `Unknown card ${command.cardId}.`)
  }
  if (definition.type !== 'Minion') {
    return reject(state, 'not-a-minion', 'Only minion cards can be summoned.')
  }

  const minion: BoardMinion = {
    instanceId: `${player.participantId}:dev:${counter}`,
    cardId: definition.id,
    attack: definition.attack,
    health: definition.health,
    maxHealth: definition.health,
    summonedOnTurn: state.turnNumber,
    lastAttackedOnTurn: null,
    ownerId: player.participantId,
    controllerId: player.participantId,
    creationOrdinal: counter,
    playOrder: counter,
    baseAttack: definition.attack,
    baseHealth: definition.health,
    keywords: [...definition.keywords],
    enchantments: [],
    grantedTriggers: [],
    deathrattles: definition.effects.filter(
      (effect) => effect.trigger === 'deathrattle'
    ),
    silenced: false,
    frozenUntilTurn: null,
    divineShield: definition.keywords.includes('divine-shield'),
    stealth: definition.keywords.includes('stealth'),
    immune: definition.keywords.includes('immune'),
    spellImmune: definition.keywords.includes('spell-immune'),
    attacksUsedThisTurn: 0,
    maxAttacksPerTurn: definition.keywords.includes('mega-windfury')
      ? 4
      : definition.keywords.includes('windfury')
        ? 2
        : 1,
    damageTaken: 0
  }
  const position = player.board.length
  const nextPlayer: OpeningPlayerState = {
    ...player,
    board: [...player.board.map(cloneBoardMinion), minion]
  }
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = nextPlayer
  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1,
    nextEntityOrdinal: counter + 1
  }
  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [
      {
        type: 'dev-minion-summoned',
        participantId: player.participantId,
        minion: cloneBoardMinion(minion),
        position
      }
    ],
    nextEntityOrdinal: counter + 1
  }
}

function applyDevEndMatch(
  state: OpeningMatchState,
  command: DevEndMatchCommand
): OpeningCommandResult {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }
  const winnerIndex = findPlayerIndex(state.players, command.winnerId)
  if (winnerIndex === -1) {
    return reject(
      state,
      'unknown-participant',
      `Unknown participant: ${command.winnerId}`
    )
  }
  const loserIndex: 0 | 1 = winnerIndex === 0 ? 1 : 0
  const winnerId = state.players[winnerIndex].participantId
  const loserId = state.players[loserIndex].participantId
  const nextState: OpeningMatchState = {
    ...state,
    phase: 'ended',
    activePlayerId: null,
    winnerId,
    loserId,
    revision: state.revision + 1
  }
  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [{ type: 'match-ended', winnerId, loserId, reason: 'dev-forced' }]
  }
}

function applyDevSetMana(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: DevSetManaCommand
): OpeningCommandResult {
  if (
    !Number.isInteger(command.available) ||
    command.available < 0 ||
    command.available > MAX_MANA
  ) {
    return reject(state, 'invalid-mana', 'Available mana must be between 0 and 10.')
  }
  if (
    !Number.isInteger(command.maximum) ||
    command.maximum < 0 ||
    command.maximum > MAX_MANA
  ) {
    return reject(state, 'invalid-mana', 'Maximum mana must be between 0 and 10.')
  }
  if (command.available > command.maximum) {
    return reject(state, 'invalid-mana', 'Available mana cannot exceed maximum.')
  }

  const player = state.players[playerIndex]
  const nextMana: PlayerMana = {
    available: command.available,
    maximum: command.maximum
  }
  const nextPlayer: OpeningPlayerState = { ...player, mana: nextMana }
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = nextPlayer
  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1
  }

  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [
      {
        type: 'dev-mana-set',
        participantId: player.participantId,
        mana: nextMana
      }
    ]
  }
}

function applyDevModifyDeck(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: DevModifyDeckCommand,
  refillDeck: () => readonly OpeningCard[]
): OpeningCommandResult {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }

  const player = state.players[playerIndex]
  const deck = command.action === 'destroy' ? [] : refillDeck()
  const nextPlayer: OpeningPlayerState = { ...player, deck }
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = nextPlayer
  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1
  }

  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [
      {
        type: 'dev-deck-modified',
        participantId: player.participantId,
        action: command.action,
        deckCount: deck.length
      }
    ]
  }
}

function applyDevStateChange(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  player: OpeningPlayerState
): OpeningAcceptedResult {
  const players = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  players[playerIndex] = player
  const nextState = { ...state, players, revision: state.revision + 1 }
  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [{ type: 'dev-state-changed', participantId: player.participantId }]
  }
}

/**
 * Creates the platform-neutral opening sequence used by GameScene.
 *
 * Deck contents are supplied as snapshots so the game process owns all card
 * movement while the renderer remains responsible only for presentation.
 */
export function createOpeningMatch(
  setup: MatchSetup,
  deckSnapshots: readonly Deck[],
  rng: DeterministicRng = createSeededRng(setup.seed),
  checkpoint?: OpeningMatchCheckpoint
): OpeningMatchInstance {
  const recordEffectTrace = setup.recordEffectTrace === true
  const decksById = new Map(deckSnapshots.map((deck) => [deck.id, deck]))
  const playerOneIndex: 0 | 1 = rng.next() < 0.5 ? 0 : 1
  const playerTwoIndex: 0 | 1 = playerOneIndex === 0 ? 1 : 0
  const order = [playerOneIndex, playerTwoIndex] as const
  let initialEntityOrdinal = 0

  const createPlayer = (
    participantIndex: 0 | 1,
    seatIndex: 0 | 1
  ): OpeningPlayerState => {
    const participant = setup.participants[participantIndex]
    const deck = decksById.get(participant.deckId)
    if (!deck) throw new Error(`Deck ${participant.deckId} is not available.`)
    const hero = HERO_CATALOG.require(participant.heroId)
    const heroPower = HERO_POWER_CATALOG.require(hero.heroPowerId)
    const expanded = expandDeck(deck, participant, initialEntityOrdinal)
    initialEntityOrdinal += expanded.length
    const shuffled = shuffle(expanded, rng)
    const initialCount = seatIndex === 0 ? 3 : 4
    const initialCards = shuffled.slice(0, initialCount).map((card) => ({
      ...card,
      zone: 'hand' as const,
      revealed: true
    }))
    return {
      participantId: participant.participantId,
      controllerKind: participant.controllerKind,
      heroId: participant.heroId,
      hero: {
        health: hero.startingHealth,
        maxHealth: hero.startingHealth,
        armor: 0,
        attack: 0,
        lastAttackedOnTurn: null,
        instanceId: `${participant.participantId}:hero`,
        creationOrdinal: initialEntityOrdinal++,
        baseAttack: 0,
        baseMaxHealth: hero.startingHealth,
        baseKeywords: [],
        keywords: [],
        enchantments: [],
        frozenUntilTurn: null,
        immune: false,
        spellImmune: false,
        attacksUsedThisTurn: 0,
        maxAttacksPerTurn: 1,
        damageTaken: 0
      },
      playerNumber: (seatIndex + 1) as 1 | 2,
      deck: shuffled.slice(initialCount),
      hand: initialCards,
      board: [],
      weapon: null,
      mana: { available: 0, maximum: 0 },
      heroPower: {
        id: heroPower.id,
        creationOrdinal: initialEntityOrdinal++,
        cost: heroPower.cost,
        baseCost: heroPower.cost,
        available: false,
        targetType: heroPower.targeting,
        targetingGranted: null,
        enchantments: []
      },
      fatigueDamage: 1,
      mulliganConfirmed: false,
      secrets: [],
      graveyard: [],
      discardedCards: [],
      overload: 0
    } satisfies OpeningPlayerState
  }
  const players = [createPlayer(order[0], 0), createPlayer(order[1], 1)] as [
    OpeningPlayerState,
    OpeningPlayerState
  ]

  let state: OpeningMatchState = {
    phase: 'mulligan',
    playerOneId: players[0].participantId,
    playerTwoId: players[1].participantId,
    activePlayerId: null,
    turnNumber: 0,
    winnerId: null,
    loserId: null,
    players,
    revision: 0,
    history: {
      cardsPlayedThisTurn: [],
      cardsCastThisTurn: [],
      cardsDrawnThisTurn: [],
      minionsSummonedThisTurn: [],
      minionsDiedThisTurn: [],
      damageDealtThisTurn: 0,
      damageTakenThisTurn: 0,
      healingThisTurn: 0,
      armorGainedThisTurn: 0,
      cardsPlayedThisGame: [],
      cardsDiedThisGame: [],
      beastsSummonedByPlayer: {},
      heroPowersUsedByPlayer: {}
    },
    ...(recordEffectTrace ? { effectTrace: [] } : {}),
    nextEntityOrdinal: initialEntityOrdinal,
    turnLimitSeconds: null,
    turnStartedAtRevision: null,
    pendingResolution: false,
    scheduledEffects: []
  }
  assertOpeningMatchInvariants(state)
  let nextEntityOrdinal = state.nextEntityOrdinal ?? 0

  const commitState = (nextState: OpeningMatchState): void => {
    const transaction = new StateTransaction(
      state,
      cloneOpeningMatchState,
      assertOpeningMatchInvariants
    )
    transaction.replace(nextState)
    state = transaction.commit()
  }
  let devDeckRefillCounter = 0
  let queryRuntime: EffectRuntime | null = null
  let queryRevision = -1
  let queryState: OpeningMatchState | null = null
  let derivedStateCache: OpeningMatchState | null = null
  const playInputCache = new Map<string, PlayCardInput | null>()
  const legalityCache = new Map<PlayerId, MatchLegality>()

  /** Reuses the expensive derived-state setup across pure queries at one revision. */
  const getQueryRuntime = (): EffectRuntime => {
    if (queryRuntime && queryRevision === state.revision && queryState === state)
      return queryRuntime
    queryRuntime = new EffectRuntime(state)
    queryRevision = state.revision
    queryState = state
    derivedStateCache = null
    playInputCache.clear()
    legalityCache.clear()
    return queryRuntime
  }

  const getDerivedSnapshot = (): OpeningMatchState => {
    getQueryRuntime()
    derivedStateCache ??= queryRuntime!.getDerivedState()
    return derivedStateCache
  }

  if (checkpoint) {
    if (checkpoint.schemaVersion !== 1) {
      throw new Error(
        `Unsupported match checkpoint schema ${checkpoint.schemaVersion}.`
      )
    }
    state = cloneOpeningMatchState(checkpoint.state)
    assertOpeningMatchInvariants(state)
    rng.restore(checkpoint.rngState)
    nextEntityOrdinal = checkpoint.nextEntityOrdinal
    devDeckRefillCounter = checkpoint.devDeckRefillCounter
  }

  const refillDeckFor = (participantId: PlayerId): readonly OpeningCard[] => {
    const participant = setup.participants.find(
      (candidate) => candidate.participantId === participantId
    )
    if (!participant) throw new Error(`Unknown participant: ${participantId}`)
    const deck = decksById.get(participant.deckId)
    if (!deck) throw new Error(`Deck ${participant.deckId} is not available.`)
    const refillId = devDeckRefillCounter
    devDeckRefillCounter += 1
    const expanded = expandDeck(deck, participant, nextEntityOrdinal)
    nextEntityOrdinal += expanded.length
    return shuffle(expanded, rng).map((card, ordinal) => ({
      ...card,
      instanceId: `${participant.participantId}:dev-refill:${refillId}:${ordinal}`
    }))
  }

  const dispatchPlayCard = (command: PlayCardCommand): OpeningCommandResult => {
    const before = state
    const rngSnapshot = rng.snapshot()
    const input = getPlayInput(
      state,
      command.participantId,
      command.cardInstanceId,
      command.choice
    )
    const deferChoice =
      command.choice === undefined && input?.choiceTiming === 'after-placement'
    const result = resolveCardPlay({
      state,
      rng,
      participantId: command.participantId,
      cardInstanceId: command.cardInstanceId,
      ...(command.position === undefined ? {} : { position: command.position }),
      ...(command.targets === undefined ? {} : { targets: command.targets }),
      ...(command.choice === undefined ? {} : { choice: command.choice }),
      ...(deferChoice ? { deferChoice: true } : {}),
      nextEntityOrdinal,
      recordTrace: recordEffectTrace
    })
    if (!result.accepted) {
      rng.restore(rngSnapshot)
      return {
        accepted: false,
        code: result.code as OpeningRejectionCode,
        message: result.message,
        state: cloneOpeningMatchState(result.state),
        events: [],
        diagnostic: result.diagnostic
      }
    }
    commitState(result.state)
    nextEntityOrdinal = result.nextEntityOrdinal
    const history = cardHistoryEvent(before, result.state, command, result.events)
    return {
      accepted: true,
      state: cloneOpeningMatchState(state),
      events: [
        ...result.events,
        ...(history ? [history] : []),
        ...fatigueHistoryEvents(before, result.events)
      ]
    }
  }

  const dispatchCardChoice = (
    command: ChooseCardOptionCommand
  ): OpeningCommandResult => {
    const rngSnapshot = rng.snapshot()
    const result = resolvePendingCardChoice({
      state,
      rng,
      participantId: command.participantId,
      sourceCardInstanceId: command.sourceCardInstanceId,
      choice: command.choice,
      nextEntityOrdinal,
      recordTrace: recordEffectTrace
    })
    if (!result.accepted) {
      rng.restore(rngSnapshot)
      return {
        accepted: false,
        code: result.code as OpeningRejectionCode,
        message: result.message,
        state: cloneOpeningMatchState(result.state),
        events: [],
        diagnostic: result.diagnostic
      }
    }
    commitState(result.state)
    nextEntityOrdinal = result.nextEntityOrdinal
    return {
      accepted: true,
      state: cloneOpeningMatchState(state),
      events: result.events
    }
  }

  const dispatchDiscoverChoice = (
    command: ChooseDiscoverCardCommand
  ): OpeningCommandResult => {
    const pending = state.pendingDiscover
    if (!pending)
      return reject(state, 'invalid-command', 'No Discover choice is pending.')
    if (pending.participantId !== command.participantId)
      return reject(
        state,
        'wrong-controller',
        'Only the Discover owner may choose a card.'
      )
    if (!pending.candidates.some((card) => card.instanceId === command.cardInstanceId))
      return reject(
        state,
        'invalid-target',
        'The selected card is not a Discover candidate.'
      )

    const playerIndex = findPlayerIndex(state.players, command.participantId)
    if (playerIndex === -1)
      return reject(state, 'unknown-participant', 'Unknown participant.')
    let player = state.players[playerIndex]
    const events: OpeningMatchEvent[] = []
    for (const candidate of pending.candidates) {
      if (
        pending.origin === 'generated' &&
        candidate.instanceId !== command.cardInstanceId
      ) {
        const removed = removeCardFromPlayer(player, candidate.instanceId)
        if (!removed || removed.zone !== 'revealed')
          return reject(
            state,
            'stale-target',
            'A Discover candidate is no longer available.'
          )
        player = removed.player
        continue
      }
      const destination =
        candidate.instanceId === command.cardInstanceId ? 'hand' : 'discarded'
      const moved = moveCardForPlayer(player, candidate.instanceId, destination)
      if (!moved || moved.from !== 'revealed')
        return reject(
          state,
          'stale-target',
          'A Discover candidate is no longer available.'
        )
      player = moved.player
      if (destination === 'hand') {
        events.push({
          type: 'card-drawn',
          participantId: command.participantId,
          card: moved.card
        })
      }
    }
    const players = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
    players[playerIndex] = player
    const nextPending =
      pending.queued && pending.queued.length > 0
        ? {
            ...pending.queued[0]!,
            ...(pending.queued.length > 1 ? { queued: pending.queued.slice(1) } : {})
          }
        : undefined
    if (nextPending)
      events.push({
        type: 'discover-started',
        participantId: nextPending.participantId,
        sourceCardInstanceId: nextPending.sourceCardInstanceId,
        candidates: nextPending.candidates
      })
    const nextState: OpeningMatchState = {
      ...state,
      players,
      pendingDiscover: nextPending,
      revision: state.revision + 1
    }
    assertOpeningMatchInvariants(nextState)
    commitState(nextState)
    return { accepted: true, state: cloneOpeningMatchState(state), events }
  }
  const dispatchTurnTransition = (participantId: PlayerId): OpeningCommandResult => {
    const before = state
    const rngSnapshot = rng.snapshot()
    const result = resolveTurnTransition({
      state,
      rng,
      participantId,
      nextEntityOrdinal,
      recordTrace: recordEffectTrace
    })
    if (!result.accepted) {
      rng.restore(rngSnapshot)
      return {
        accepted: false,
        code: result.code as OpeningRejectionCode,
        message: result.message,
        state: cloneOpeningMatchState(result.state),
        events: [],
        diagnostic: result.diagnostic
      }
    }
    commitState(result.state)
    nextEntityOrdinal = result.nextEntityOrdinal
    const history = [
      ...triggerHistoryEvents(before, result.state, result.events),
      ...fatigueHistoryEvents(before, result.events)
    ]
    return {
      accepted: true,
      state: cloneOpeningMatchState(state),
      events: [...result.events, ...history]
    }
  }

  const instance: OpeningMatchInstance = {
    setup,
    getState(): OpeningMatchState {
      return cloneOpeningMatchState(getDerivedSnapshot())
    },
    getCheckpoint(): OpeningMatchCheckpoint {
      return {
        schemaVersion: 1,
        setup,
        decks: deckSnapshots,
        state: cloneOpeningMatchState(state),
        rngState: rng.snapshot(),
        nextEntityOrdinal,
        devDeckRefillCounter
      }
    },
    getPlayInput(
      participantId: PlayerId,
      cardInstanceId: string,
      choice?: number
    ): PlayCardInput | null {
      const runtime = getQueryRuntime()
      const key = `${participantId}\u0000${cardInstanceId}\u0000${choice ?? ''}`
      if (playInputCache.has(key)) return playInputCache.get(key) ?? null
      const input = runtime.getPlayInput(participantId, cardInstanceId, choice)
      playInputCache.set(key, input)
      return input
    },
    getLegality(participantId: PlayerId): MatchLegality {
      const runtime = getQueryRuntime()
      const cached = legalityCache.get(participantId)
      if (cached) return cached
      const legality = runtime.getMatchLegality(participantId)
      legalityCache.set(participantId, legality)
      return legality
    },
    getEffectTrace(): readonly EffectTraceEntry[] {
      return state.effectTrace ? state.effectTrace.map((entry) => ({ ...entry })) : []
    },
    getPublicState(participantId: PlayerId): OpeningMatchPublicState {
      return getOpeningMatchPublicState(getDerivedSnapshot(), participantId)
    },
    getAiObservation(participantId, policy) {
      if (policy !== 'fair') {
        throw new Error(`Unsupported AI information policy: ${String(policy)}`)
      }
      return createAiObservation(
        getDerivedSnapshot(),
        setup,
        deckSnapshots,
        participantId
      )
    },
    getPublicEvents(
      participantId: PlayerId,
      events: readonly OpeningMatchEvent[]
    ): readonly OpeningMatchPublicEvent[] {
      return getOpeningMatchPublicEvents(events, participantId)
    },
    preview(commandValue: unknown): OpeningCommandResult {
      const stateSnapshot = cloneOpeningMatchState(state)
      const rngSnapshot = rng.snapshot()
      const nextEntityOrdinalSnapshot = nextEntityOrdinal
      const devDeckRefillCounterSnapshot = devDeckRefillCounter
      try {
        return instance.dispatch(commandValue)
      } finally {
        state = stateSnapshot
        rng.restore(rngSnapshot)
        nextEntityOrdinal = nextEntityOrdinalSnapshot
        devDeckRefillCounter = devDeckRefillCounterSnapshot
      }
    },
    previewSequence(commandValues: readonly unknown[]): OpeningCommandResult {
      return instance.analyze((fork) => {
        let result: OpeningCommandResult | null = null
        for (const command of commandValues) {
          result = fork.dispatch(command)
          if (!result.accepted) return result
        }
        return (
          result ??
          reject(state, 'invalid-command', 'A preview sequence must contain a command.')
        )
      })
    },
    analyze<T>(
      operation: (fork: import('./opening-match-types').OpeningMatchAnalysis) => T
    ): T {
      const stateSnapshot = cloneOpeningMatchState(state)
      const rngSnapshot = rng.snapshot()
      const nextEntityOrdinalSnapshot = nextEntityOrdinal
      const devDeckRefillCounterSnapshot = devDeckRefillCounter
      try {
        return operation({
          getState: () => instance.getState(),
          dispatch: (command: unknown) => instance.dispatch(command),
          getPlayInput: (participantId, cardInstanceId, choice) =>
            instance.getPlayInput!(participantId, cardInstanceId, choice),
          getLegality: (participantId) => instance.getLegality!(participantId)
        })
      } finally {
        state = stateSnapshot
        rng.restore(rngSnapshot)
        nextEntityOrdinal = nextEntityOrdinalSnapshot
        devDeckRefillCounter = devDeckRefillCounterSnapshot
      }
    },
    dispatch(commandValue: unknown): OpeningCommandResult {
      const command = parseCommand(commandValue)
      if (!command)
        return reject(state, 'invalid-command', 'The match command is invalid.')

      const playerIndex = findPlayerIndex(state.players, command.participantId)
      if (playerIndex === -1) {
        return reject(
          state,
          'unknown-participant',
          `Unknown participant: ${command.participantId}`
        )
      }

      if (state.pendingDiscover && command.type !== 'choose-discover-card') {
        return reject(
          state,
          'discover-pending',
          'Resolve the pending Discover choice first.'
        )
      }
      if (command.type === 'choose-discover-card')
        return dispatchDiscoverChoice(command)
      if (state.pendingCardChoice && command.type !== 'choose-card-option') {
        return reject(
          state,
          'invalid-command',
          'Resolve the pending card choice first.'
        )
      }
      if (command.type === 'choose-card-option') return dispatchCardChoice(command)
      if (state.phase === 'ended') {
        return reject(state, 'match-ended', 'The match has already ended.')
      }

      if (command.type === 'end-turn') {
        return dispatchTurnTransition(command.participantId)
      }

      if (command.type === 'use-hero-power') {
        const before = state
        const rngSnapshot = rng.snapshot()
        const result = resolveHeroPower({
          state,
          rng,
          participantId: command.participantId,
          ...(command.target ? { target: command.target } : {}),
          nextEntityOrdinal,
          recordTrace: recordEffectTrace
        })
        if (!result.accepted) {
          rng.restore(rngSnapshot)
          return {
            accepted: false,
            code: result.code as OpeningRejectionCode,
            message: result.message,
            state: cloneOpeningMatchState(result.state),
            events: [],
            diagnostic: result.diagnostic
          }
        }
        commitState(result.state)
        nextEntityOrdinal = result.nextEntityOrdinal
        const history = heroPowerHistoryEvent(
          before,
          result.state,
          command,
          result.events
        )
        return {
          accepted: true,
          state: cloneOpeningMatchState(state),
          events: [
            ...result.events,
            history,
            ...fatigueHistoryEvents(before, result.events)
          ]
        }
      }

      if (command.type === 'timeout') {
        if (state.phase !== 'turns' || state.activePlayerId !== command.participantId) {
          return reject(
            state,
            'timeout-unavailable',
            'A timeout can only be resolved for the active turn.'
          )
        }
        const turnLimitSeconds = getDerivedState(state).turnLimitSeconds
        if (
          turnLimitSeconds === null ||
          turnLimitSeconds === undefined ||
          turnLimitSeconds <= 0
        ) {
          return reject(
            state,
            'timeout-unavailable',
            'This match has no active turn limit.'
          )
        }
        if (
          command.elapsedSeconds === undefined ||
          command.elapsedSeconds < turnLimitSeconds
        ) {
          return reject(state, 'timeout-unavailable', 'The turn limit has not elapsed.')
        }
        return dispatchTurnTransition(command.participantId)
      }

      if (command.type === 'play-card') return dispatchPlayCard(command)

      if (command.type === 'attack-character') {
        const before = state
        const rngSnapshot = rng.snapshot()
        const result = resolveAttack({
          state,
          rng,
          participantId: command.participantId,
          attacker: command.attacker,
          defender: command.defender,
          nextEntityOrdinal,
          recordTrace: recordEffectTrace
        })
        if (!result.accepted) {
          rng.restore(rngSnapshot)
          return {
            accepted: false,
            code: result.code as OpeningRejectionCode,
            message: result.message,
            state: cloneOpeningMatchState(result.state),
            events: [],
            diagnostic: result.diagnostic
          }
        }
        commitState(result.state)
        nextEntityOrdinal = result.nextEntityOrdinal
        const history = combatHistoryEvent(before, result.state, command, result.events)
        return {
          accepted: true,
          state: cloneOpeningMatchState(state),
          events: [...result.events, history]
        }
      }

      if (command.type === 'dev-add-card') {
        const result = applyDevAddCard(state, playerIndex, command, nextEntityOrdinal)
        if (result.accepted) {
          commitState(result.state)
          if (result.nextEntityOrdinal !== undefined)
            nextEntityOrdinal = result.nextEntityOrdinal
        }
        return result
      }

      if (command.type === 'dev-set-mana') {
        const result = applyDevSetMana(state, playerIndex, command)
        if (result.accepted) commitState(result.state)
        return result
      }

      if (command.type === 'dev-set-hero') {
        if (state.phase !== 'turns')
          return reject(state, 'wrong-phase', 'Turns have not started yet.')
        const player = state.players[playerIndex]
        const health =
          command.health === undefined ? player.hero.health : command.health
        const armor = command.armor === undefined ? player.hero.armor : command.armor
        const attack =
          command.attack === undefined ? player.hero.attack : command.attack
        if (
          !Number.isInteger(health) ||
          health < 1 ||
          health > player.hero.maxHealth ||
          !Number.isInteger(armor) ||
          armor < 0 ||
          !Number.isInteger(attack) ||
          attack < 0
        )
          return reject(state, 'invalid-command', 'Invalid hero state.')
        const result = applyDevStateChange(state, playerIndex, {
          ...player,
          hero: {
            ...player.hero,
            health,
            damageTaken: Math.max(0, player.hero.maxHealth - health),
            armor,
            attack,
            baseAttack: attack
          }
        })
        commitState(result.state)
        return result
      }
      if (command.type === 'dev-set-hero-power') {
        if (state.phase !== 'turns')
          return reject(state, 'wrong-phase', 'Turns have not started yet.')
        const player = state.players[playerIndex]
        const cost = command.cost === undefined ? player.heroPower.cost : command.cost
        const available =
          command.available === undefined
            ? player.heroPower.available
            : command.available
        if (!Number.isInteger(cost) || cost < 0 || cost > MAX_MANA)
          return reject(state, 'invalid-command', 'Invalid hero power cost.')
        const result = applyDevStateChange(state, playerIndex, {
          ...player,
          heroPower: { ...player.heroPower, cost, baseCost: cost, available }
        })
        commitState(result.state)
        return result
      }
      if (command.type === 'dev-clear-zone') {
        if (state.phase !== 'turns')
          return reject(state, 'wrong-phase', 'Turns have not started yet.')
        const player = state.players[playerIndex]
        const result = applyDevStateChange(
          state,
          playerIndex,
          command.zone === 'hand' ? { ...player, hand: [] } : { ...player, board: [] }
        )
        commitState(result.state)
        return result
      }
      if (command.type === 'dev-set-fatigue') {
        if (state.phase !== 'turns' || command.nextDamage < 1)
          return reject(state, 'invalid-command', 'Invalid fatigue damage.')
        const player = state.players[playerIndex]
        const result = applyDevStateChange(state, playerIndex, {
          ...player,
          fatigueDamage: command.nextDamage
        })
        commitState(result.state)
        return result
      }
      if (command.type === 'dev-remove-weapon') {
        if (state.phase !== 'turns')
          return reject(state, 'wrong-phase', 'Turns have not started yet.')
        const result = applyDevStateChange(state, playerIndex, {
          ...state.players[playerIndex],
          weapon: null
        })
        commitState(result.state)
        return result
      }
      if (command.type === 'dev-draw') {
        if (state.phase !== 'turns')
          return reject(state, 'wrong-phase', 'Turns have not started yet.')
        const player = state.players[playerIndex]
        if (player.deck.length === 0) {
          const before = state
          const damaged = damageHero(player, player.fatigueDamage, 'fatigue')
          const result = applyDevStateChange(state, playerIndex, {
            ...player,
            hero: damaged.hero,
            fatigueDamage: player.fatigueDamage + 1
          })
          commitState(result.state)
          const fatigue = {
            type: 'fatigue' as const,
            participantId: player.participantId,
            amount: player.fatigueDamage,
            nextDamage: player.fatigueDamage + 1
          }
          return {
            ...result,
            events: [fatigue, damaged.event, ...fatigueHistoryEvents(before, [fatigue])]
          }
        }
        const card = cloneCard(player.deck[0]!)
        const nextPlayer =
          player.hand.length >= MAX_HAND_SIZE
            ? { ...player, deck: player.deck.slice(1) }
            : drawCards(player, 1).player
        const result = applyDevStateChange(state, playerIndex, nextPlayer)
        commitState(result.state)
        return {
          ...result,
          events: [
            player.hand.length >= MAX_HAND_SIZE
              ? {
                  type: 'card-burned',
                  participantId: player.participantId,
                  card
                }
              : {
                  type: 'card-drawn',
                  participantId: player.participantId,
                  card
                }
          ]
        }
      }

      if (command.type === 'dev-modify-deck') {
        const result = applyDevModifyDeck(state, playerIndex, command, () =>
          refillDeckFor(command.participantId)
        )
        if (result.accepted) {
          commitState({ ...result.state, nextEntityOrdinal })
          return { ...result, state: cloneOpeningMatchState(state) }
        }
        return result
      }

      if (command.type === 'dev-summon-minion') {
        const result = applyDevSummonMinion(
          state,
          playerIndex,
          command,
          nextEntityOrdinal
        )
        if (result.accepted) {
          commitState(result.state)
          if (result.nextEntityOrdinal !== undefined)
            nextEntityOrdinal = result.nextEntityOrdinal
        }
        return result
      }

      if (command.type === 'dev-end-match') {
        const result = applyDevEndMatch(state, command)
        if (result.accepted) commitState(result.state)
        return result
      }

      if (command.type !== 'confirm-mulligan')
        return reject(state, 'invalid-command', 'The match command is invalid.')

      if (state.phase !== 'mulligan') {
        return reject(state, 'wrong-phase', 'Mulligan has already ended.')
      }

      const player = state.players[playerIndex]
      if (player.mulliganConfirmed) {
        return reject(
          state,
          'already-confirmed',
          'This participant already confirmed mulligan.'
        )
      }

      const selectedIds = command.replaceInstanceIds
      if (new Set(selectedIds).size !== selectedIds.length) {
        return reject(
          state,
          'invalid-card-selection',
          'A card cannot be selected twice.'
        )
      }
      const selected = player.hand.filter((card) =>
        selectedIds.includes(card.instanceId)
      )
      if (selected.length !== selectedIds.length) {
        return reject(
          state,
          'invalid-card-selection',
          'Every selected card must be in hand.'
        )
      }

      const selectedSet = new Set(selectedIds)
      const kept = player.hand.filter((card) => !selectedSet.has(card.instanceId))
      const replacementCount = selected.length
      const replacementCards = player.deck.slice(0, replacementCount).map((card) => ({
        ...cloneCard(card),
        zone: 'hand' as const,
        revealed: true
      }))
      const remainingDeck = player.deck.slice(replacementCount)
      const returnedCards = selected.map((card) => ({
        ...cloneCard(card),
        zone: 'deck' as const,
        revealed: false
      }))
      const nextPlayer: OpeningPlayerState = {
        ...player,
        deck: shuffle([...remainingDeck, ...returnedCards], rng),
        hand: [...kept, ...replacementCards],
        mulliganConfirmed: true
      }
      const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
      nextPlayers[playerIndex] = nextPlayer
      state = { ...state, players: nextPlayers, revision: state.revision + 1 }

      const events: OpeningMatchEvent[] = [
        {
          type: 'mulligan-resolved',
          participantId: player.participantId,
          returnedCards: returnedCards.map(cloneCard),
          replacementCards: replacementCards.map(cloneCard)
        }
      ]

      if (nextPlayers.every((candidate) => candidate.mulliganConfirmed)) {
        const playerTwo = nextPlayers[1]
        const coin: OpeningCard = {
          instanceId: `${playerTwo.participantId}:coin`,
          cardId: COIN_CARD_ID,
          ownerId: playerTwo.participantId,
          controllerId: playerTwo.participantId,
          creationOrdinal: nextEntityOrdinal++,
          baseCost: CARD_CATALOG.require(COIN_CARD_ID).cost,
          currentCost: CARD_CATALOG.require(COIN_CARD_ID).cost,
          zone: 'hand',
          revealed: true
        }
        const playerTwoWithCoin: OpeningPlayerState = {
          ...playerTwo,
          hand: [...playerTwo.hand, coin]
        }
        nextPlayers[1] = playerTwoWithCoin
        state = { ...state, players: nextPlayers }
        events.push({
          type: 'coin-granted',
          participantId: playerTwo.participantId,
          card: cloneCard(coin)
        })

        const playerOne = nextPlayers[0]
        const drawn = drawCards(playerOne, 1)
        const playerOneMana = growMana(playerOne.mana)
        nextPlayers[0] = {
          ...drawn.player,
          mana: playerOneMana,
          heroPower: { ...drawn.player.heroPower, available: true }
        }
        state = {
          ...state,
          phase: 'turns',
          activePlayerId: playerOne.participantId,
          turnNumber: 1,
          players: nextPlayers,
          revision: state.revision + 1,
          turnStartedAtRevision: state.revision + 1,
          nextEntityOrdinal
        }
        events.push({
          type: 'opening-turn-started',
          participantId: playerOne.participantId,
          playerNumber: 1,
          mana: playerOneMana
        })
        const card = drawn.cards[0]
        if (card) {
          events.push({
            type: 'opening-card-drawn',
            participantId: playerOne.participantId,
            card: cloneCard(card)
          })
        }
      }

      assertOpeningMatchInvariants(state)
      return { accepted: true, state: cloneOpeningMatchState(state), events }
    }
  }
  return instance
}

/** Restores an independent match instance from a structured-cloned checkpoint. */
export function createOpeningMatchFromCheckpoint(
  checkpoint: OpeningMatchCheckpoint
): OpeningMatchInstance {
  return createOpeningMatch(
    checkpoint.setup,
    checkpoint.decks,
    createSeededRng(checkpoint.setup.seed),
    checkpoint
  )
}
