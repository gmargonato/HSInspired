import type { CardId } from '../../game-rules/content/cards'
import type { CardPreviewRouteBounds } from './card-preview-route'
import type { GameRoute } from './game-route'

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

/** Typed renderer navigation port consumed by scenes and feature views. */
export interface SceneRouter {
  navigate(route: AppRoute): Promise<void>
}
