import type { CardId } from '../../game/content/cards'
import {
  createHumanVsAiMatchSetup,
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
  seed?: number
): GameRoute {
  return { id: 'game', setup: createHumanVsAiMatchSetup(selection, seed) }
}

/** Typed renderer navigation port consumed by scenes and feature views. */
export interface SceneRouter {
  navigate(route: AppRoute): Promise<void>
}
