import {
  countDeckCards,
  DeckRules,
  MAX_DECK_CARDS,
  type Deck
} from '../../game-rules/decks'
import { selectCuratedConstructedOpponent } from '../../game-rules/decks/curated-opponent-selection'
import {
  createHumanVsAiMatchSetup,
  type HumanVsAiMatchOptions,
  type HumanVsAiDeckSelection
} from '../../game-rules/match'
import type { GameRoute } from './game-route'

export type { CardPreviewRouteBounds } from './card-preview-route'
export type { GameRoute } from './game-route'

/** Adapter used by deck selection to hand a complete setup to GameScene. */
export function createHumanVsAiGameRoute(
  selection: HumanVsAiDeckSelection,
  seed?: number,
  options?: HumanVsAiMatchOptions
): GameRoute {
  return {
    id: 'game',
    setup: createHumanVsAiMatchSetup(selection, seed, options)
  }
}

/** Constructed matches snapshot the chosen saved or curated opponent deck. */
export function createConstructedGameRoute(
  humanDeck: Deck,
  seed: number,
  savedDecks: readonly Deck[],
  preferredOpponentDeckId?: string,
  options?: HumanVsAiMatchOptions,
  curatedOpponentDeckId?: string
): GameRoute {
  const rules = new DeckRules()
  if (
    countDeckCards(humanDeck) !== MAX_DECK_CARDS ||
    rules.validate(humanDeck).length
  ) {
    throw new Error('Select a valid 30-card constructed deck to start a game.')
  }
  const preferred =
    preferredOpponentDeckId && !curatedOpponentDeckId
      ? savedDecks.find((deck) => deck.id === preferredOpponentDeckId)
      : undefined
  if (
    preferredOpponentDeckId &&
    !curatedOpponentDeckId &&
    (!preferred ||
      countDeckCards(preferred) !== MAX_DECK_CARDS ||
      rules.validate(preferred).length)
  ) {
    throw new Error(
      `The requested AI deck ${preferredOpponentDeckId} is unavailable or invalid.`
    )
  }
  const curated = preferred
    ? undefined
    : selectCuratedConstructedOpponent(seed, curatedOpponentDeckId)
  const opponent = preferred ?? curated?.deck
  if (!opponent) throw new Error('Unable to select a constructed opponent deck.')
  return {
    ...createHumanVsAiGameRoute(
      {
        humanDeck: { id: humanDeck.id, heroId: humanDeck.heroId },
        aiDeck: { id: opponent.id, heroId: opponent.heroId }
      },
      seed,
      options
    ),
    deckSnapshots: [structuredClone(humanDeck), structuredClone(opponent)],
    ...(curated ? { curatedOpponent: curated.metadata } : {})
  }
}

export type { AppRoute, SceneRouter } from './app-route'
