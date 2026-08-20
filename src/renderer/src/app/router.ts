import type { CardId } from '../../../game/content/cards'
import {
  createHumanVsAiMatchSetup,
  type HumanVsAiDeckSelection,
  type MatchSetup
} from '../../../game/match'

export interface CardPreviewRouteBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type AppRoute =
  | { readonly id: 'main-menu'; readonly entryMode?: 'closed' | 'returning' }
  | { readonly id: 'deck-selection' }
  | { readonly id: 'collection' }
  | { readonly id: 'new-deck' }
  /** Complete match setup handed directly to GameScene; setup is never global state. */
  | { readonly id: 'game'; readonly setup: MatchSetup }
  | {
      readonly id: 'card-preview'
      readonly cardId: CardId
      readonly sourceBounds: CardPreviewRouteBounds
    }

export type GameRoute = Extract<AppRoute, { readonly id: 'game' }>

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
