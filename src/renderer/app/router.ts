import type { CardId } from '../../game/content/cards'
import { countDeckCards, DeckRules, MAX_DECK_CARDS, type Deck } from '../../game/decks'
import { generateConstructedOpponent } from '../../game/decks/opponent-generator'
import {
  createHumanVsAiMatchSetup,
  type HumanVsAiMatchOptions,
  type HumanVsAiDeckSelection
} from '../../game/match'
import type { CardPreviewRouteBounds } from '../features/card-preview/card-preview-route'
import type { GameRoute } from '../features/game/game-route'

export type { CardPreviewRouteBounds } from '../features/card-preview/card-preview-route'
export type { GameRoute } from '../features/game/game-route'

export type AppRoute =
  | { readonly id: 'main-menu'; readonly entryMode?: 'closed' | 'returning' }
  | { readonly id: 'deck-selection' }
  | { readonly id: 'collection' }
  | { readonly id: 'arena' }
  | { readonly id: 'new-deck' }
  | { readonly id: 'tavern-brawl' }
  /** Complete match setup handed directly to GameScene; setup is never global state. */
  | GameRoute
  | {
      readonly id: 'card-preview'
      readonly cardId: CardId
      readonly sourceBounds: CardPreviewRouteBounds
    }

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

/** Transient constructed decks share the same snapshot route as other generated modes. */
export function createConstructedGameRoute(
  humanDeck: Deck,
  seed: number,
  savedDecks: readonly Deck[],
  preferredOpponentDeckId?: string,
  options?: HumanVsAiMatchOptions
): GameRoute {
  const rules = new DeckRules()
  if (
    countDeckCards(humanDeck) !== MAX_DECK_CARDS ||
    rules.validate(humanDeck).length
  ) {
    throw new Error('Select a valid 30-card constructed deck to start a game.')
  }
  const preferred = preferredOpponentDeckId
    ? savedDecks.find((deck) => deck.id === preferredOpponentDeckId)
    : undefined
  if (
    preferredOpponentDeckId &&
    (!preferred ||
      countDeckCards(preferred) !== MAX_DECK_CARDS ||
      rules.validate(preferred).length)
  ) {
    throw new Error(
      `The requested AI deck ${preferredOpponentDeckId} is unavailable or invalid.`
    )
  }
  const generated = preferred ? undefined : generateConstructedOpponent(seed)
  const opponent = preferred ?? generated!.deck
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
    ...(generated ? { generatedOpponent: generated.metadata } : {})
  }
}

/** Typed renderer navigation port consumed by scenes and feature views. */
export interface SceneRouter {
  navigate(route: AppRoute): Promise<void>
}
