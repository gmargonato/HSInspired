import { asCardId, type CardId } from '../content/cards'
import type { PlayerId } from './match-types'
import type {
  OpeningMatchState,
  AttackCharacterRef,
  HistoryEntitySnapshot,
  EffectDomainEvent,
  HistoryActionOutcome,
  OpeningMatchEvent,
  HistoryActionResolvedEvent,
  PlayCardCommand,
  UseHeroPowerCommand,
  AttackCharacterCommand
} from './opening-match-types'

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

export function triggerHistoryEvents(
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

export function fatigueHistoryEvents(
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

export function cardHistoryEvent(
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

export function heroPowerHistoryEvent(
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

export function combatHistoryEvent(
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
