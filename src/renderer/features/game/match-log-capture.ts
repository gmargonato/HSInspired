import type { JsonObject } from '../../../shared/ipc/ai'
import type {
  MatchLogCommandData,
  MatchLogStartData
} from '../../../shared/ipc/match-logs'
import type { MatchSetup } from '../../../game/match/match-types'
import type {
  OpeningMatchState,
  OpeningCommandResult
} from '../../../game/match/opening-match-types'

/** Small action-time snapshots; no derived-state queries or serialized engine dumps. */
function entities(state: OpeningMatchState) {
  return state.players.flatMap((player) => [
    {
      id: `${player.participantId}:hero`,
      participantId: player.participantId,
      cardId: String(player.heroId),
      attack: player.hero.attack,
      health: player.hero.health,
      armor: player.hero.armor,
      flags: [
        ...(player.hero.frozenUntilTurn == null ? [] : ['frozen']),
        ...(player.hero.immune ? ['immune'] : [])
      ]
    },
    ...player.board.map((minion, position) => ({
      position: position + 1,
      id: minion.instanceId,
      participantId: player.participantId,
      cardId: String(minion.cardId),
      attack: minion.attack,
      health: minion.health,
      armor: 0,
      flags: [
        ...(minion.keywords ?? []),
        ...(minion.divineShield ? ['divine-shield'] : []),
        ...(minion.frozenUntilTurn == null ? [] : ['frozen']),
        ...(minion.silenced ? ['silenced'] : []),
        ...(minion.stealth && !minion.stealthRevealed ? ['stealth'] : []),
        ...(minion.immune ? ['immune'] : []),
        ...(minion.spellImmune ? ['spell-immune'] : [])
      ]
    }))
  ])
}

export function captureMatchStart(
  setup: MatchSetup,
  state: OpeningMatchState
): MatchLogStartData {
  return {
    participants: setup.participants.map((participant) => ({
      participantId: participant.participantId,
      label: participant.controllerKind === 'human' ? 'Local Player' : 'Remote Player',
      heroId: participant.heroId
    })),
    firstPlayerId: state.playerOneId,
    hands: state.players.map((player) => ({
      participantId: player.participantId,
      cards: player.hand.map((card) => card.cardId)
    }))
  }
}

export function captureMatchCommand(
  before: OpeningMatchState,
  result: OpeningCommandResult,
  command: unknown
): MatchLogCommandData {
  const input = (command && typeof command === 'object' ? command : {}) as Record<
    string,
    unknown
  >
  const after = result.state
  const beforeEntities = entities(before)
  const afterEntities = entities(after)
  const previous = new Map(beforeEntities.map((entity) => [entity.id, entity]))
  const current = new Map(afterEntities.map((entity) => [entity.id, entity]))
  const changes = [...new Set([...previous.keys(), ...current.keys()])].flatMap(
    (id) => {
      const old = previous.get(id),
        next = current.get(id)
      if (
        old &&
        next &&
        old.cardId === next.cardId &&
        old.participantId === next.participantId &&
        old.attack === next.attack &&
        old.health === next.health &&
        old.armor === next.armor &&
        old.flags.join('|') === next.flags.join('|')
      )
        return []
      return [{ id, before: old ?? null, after: next ?? null }]
    }
  )
  const actor = before.players.find(
    (player) => player.participantId === input.participantId
  )
  const source = actor?.hand.find((card) => card.instanceId === input.cardInstanceId)
  // Preserve concrete engine event order, excluding duplicate aggregate history.
  const redundantSummary = (event: OpeningCommandResult['events'][number]): boolean => {
    if (event.type === 'hero-power-minion-summoned')
      return result.events.some(
        (other) =>
          other.type === 'minion-summoned' &&
          other.minion.instanceId === event.minion.instanceId
      )
    if (
      event.type === 'character-damaged' ||
      event.type === 'character-healed' ||
      event.type === 'armor-gained'
    ) {
      const target =
        event.type === 'armor-gained' || event.character.kind === 'hero'
          ? `${event.participantId}:hero`
          : event.character.instanceId
      return result.events.some(
        (other) =>
          other.type === 'effect-resolved' &&
          other.data?.target === target &&
          (event.type === 'character-damaged'
            ? other.action === 'damage'
            : event.type === 'character-healed'
              ? other.action === 'restore'
              : other.action === 'gain-armor' ||
                (other.action === 'damage' && other.data.armorAfter !== undefined))
      )
    }
    return false
  }
  const events = result.events
    .filter(
      (event) =>
        !redundantSummary(event) &&
        event.type !== 'history-action-resolved' &&
        event.type !== 'history-effect-recorded' &&
        event.type !== 'random-spell-started' &&
        event.type !== 'random-spell-completed' &&
        event.type !== 'death-batch-completed' &&
        !(
          event.type === 'minion-combat-resolved' &&
          result.events.some(
            (other) =>
              other.type === 'character-combat-resolved' &&
              other.combatId === event.combatId
          )
        )
    )
    .map((event) => {
      // Strip resolver bookkeeping and large runtime minion/card objects.
      if (event.type === 'effect-resolved')
        return {
          type: event.type,
          action: event.action,
          controllerId: event.controllerId,
          sourceInstanceId: event.sourceInstanceId,
          sourceCardId: event.sourceCardId,
          data: event.data ?? {}
        }
      if (event.type === 'trigger-activated')
        return {
          type: event.type,
          participantId: event.participantId,
          source: event.source,
          trigger: event.trigger
        }
      if ('minion' in event)
        return {
          ...event,
          minion: {
            instanceId: event.minion.instanceId,
            cardId: event.minion.cardId,
            attack: event.minion.attack,
            health: event.minion.health
          }
        }
      if ('card' in event)
        return {
          ...event,
          type:
            event.type === 'card-drawn' &&
            before.pendingDiscover?.origin === 'generated' &&
            event.card.instanceId === input.cardInstanceId
              ? 'card-generated'
              : event.type,
          card: {
            instanceId: event.card.instanceId,
            cardId: event.card.cardId
          }
        }
      return event
    }) as unknown as JsonObject[]
  const players = before.players.map((old) => {
    const next = after.players.find(
      (player) => player.participantId === old.participantId
    )!
    return {
      participantId: old.participantId,
      manaBefore: old.mana.available,
      manaAfter: next.mana.available,
      weaponBefore: old.weapon
        ? {
            cardId: old.weapon.cardId,
            attack: old.weapon.attack,
            durability: old.weapon.durability
          }
        : null,
      weaponAfter: next.weapon
        ? {
            cardId: next.weapon.cardId,
            attack: next.weapon.attack,
            durability: next.weapon.durability
          }
        : null
    }
  })
  return {
    command,
    beforeRevision: before.revision,
    afterRevision: after.revision,
    beforeTurnNumber: before.turnNumber,
    afterTurnNumber: after.turnNumber,
    actor: input.participantId,
    accepted: result.accepted,
    source: source
      ? {
          cardId: source.cardId,
          cost: source.currentCost ?? source.baseCost,
          instanceId: source.instanceId
        }
      : null,
    entities: beforeEntities,
    cards: before.players.flatMap((player) =>
      [
        ...player.hand,
        ...(player.secrets ?? []),
        ...(player.weapon ? [player.weapon] : [])
      ].map((card) => ({
        id: card.instanceId,
        cardId: card.cardId,
        participantId: player.participantId
      }))
    ),
    choiceLabel:
      before.pendingCardChoice?.options.find((option) => option.choice === input.choice)
        ?.label ?? null,
    choiceCardId:
      before.pendingDiscover?.candidates.find(
        (card) => card.instanceId === input.cardInstanceId
      )?.cardId ?? null,
    changes,
    players,
    events,
    matchEnded: after.phase === 'ended',
    ...(result.accepted
      ? {}
      : { code: result.code, message: result.message, diagnostic: result.diagnostic }),
    winnerId: after.winnerId,
    turnEnded:
      before.phase === 'turns' &&
      (before.turnNumber !== after.turnNumber || after.phase === 'ended')
  } as unknown as MatchLogCommandData
}
