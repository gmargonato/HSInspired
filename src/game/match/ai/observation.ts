import type { CardId } from '../../content/cards'
import type { Deck } from '../../decks'
import type { OpeningCard, OpeningMatchState } from '../opening-match-types'
import type { MatchSetup, PlayerId } from '../match-types'
import type {
  AiObservation,
  AiObservedCard,
  AiObservedDeck,
  AiObservedPlayer
} from './ai-types'

function observedCard(card: OpeningCard, revealCost: boolean): AiObservedCard {
  return {
    instanceId: card.instanceId,
    ...(revealCost
      ? {
          modifications: structuredClone({
            attack: card.attack,
            health: card.health,
            enchantments: card.enchantments,
            costAdjustments: card.costAdjustments
          })
        }
      : {}),
    cardId: card.cardId,
    baseCost: card.baseCost ?? null,
    currentCost: revealCost ? (card.currentCost ?? null) : null
  }
}

function stripOrdering<T extends object>(value: T): T {
  const result = structuredClone(value) as Record<string, unknown>
  delete result['creationOrdinal']
  delete result['playOrder']
  return result as T
}

function observedDeck(deck: Deck): AiObservedDeck {
  return {
    heroId: deck.heroId,
    cards: Object.entries(deck.cards)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([cardId, count]) => ({ cardId: cardId as CardId, count }))
  }
}

/** Builds one fair snapshot: exact self information and public opponent facts. */
export function createAiObservation(
  state: OpeningMatchState,
  setup: MatchSetup,
  decks: readonly Deck[],
  perspectivePlayerId: PlayerId
): AiObservation {
  const players = state.players.map((player): AiObservedPlayer => ({
    participantId: player.participantId,
    role: player.participantId === perspectivePlayerId ? 'self' : 'opponent',
    playerNumber: player.playerNumber,
    heroId: player.heroId,
    hero: stripOrdering(player.hero),
    quest: player.quest
      ? {
          cardId: player.quest.cardId,
          rewardCardId: player.quest.rewardCardId,
          goal: player.quest.goal,
          progress: player.quest.progress,
          target: player.quest.target
        }
      : null,
    hand:
      player.participantId === perspectivePlayerId
        ? player.hand.map((card) => observedCard(card, true))
        : player.hand
            .filter((card) => card.knownTo?.includes(perspectivePlayerId))
            .map((card) => observedCard(card, false)),
    handSize: player.hand.length,
    deckSize: player.deck.length,
    board: player.board.map(stripOrdering),
    weapon: player.weapon ? stripOrdering(player.weapon) : null,
    mana: structuredClone(player.mana),
    heroPower: stripOrdering(player.heroPower),
    effects: structuredClone({
      cthun: player.cthun,
      cthunDied: player.cthunDied,
      overload: player.overload,
      counters: player.counters,
      heroPowerCostOverride: player.heroPowerCostOverride,
      lockAndLoadCount: player.lockAndLoadCount,
      lockAndLoadTurn: player.lockAndLoadTurn,
      ...(player.participantId === perspectivePlayerId
        ? { pendingCostModifiers: player.pendingCostModifiers }
        : {})
    }),
    fatigueDamage: player.fatigueDamage,
    secrets: (player.secrets ?? []).map((secret) => ({
      instanceId: secret.instanceId,
      revealed: secret.revealed,
      cardId:
        secret.revealed || player.participantId === perspectivePlayerId
          ? secret.cardId
          : null
    })),
    graveyardCardIds: (player.graveyard ?? [])
      .map((entry) => entry.minion.cardId)
      .sort((left, right) => String(left).localeCompare(String(right)))
  })) as [AiObservedPlayer, AiObservedPlayer]

  const participant = setup.participants.find(
    (candidate) => candidate.participantId === perspectivePlayerId
  )
  const deck = decks.find((candidate) => candidate.id === participant?.deckId)
  if (!deck)
    throw new Error(`AI observation cannot resolve deck for ${perspectivePlayerId}.`)

  return {
    schemaVersion: 1,
    informationPolicy: 'fair',
    revision: state.revision,
    phase: state.phase,
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId,
    perspectivePlayerId,
    players,
    selfOriginalDeck: observedDeck(deck)
  }
}
