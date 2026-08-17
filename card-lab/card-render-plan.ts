import type { CardType } from './card-catalog'
import {
  buildCardRenderTree,
  CARD_CANVAS,
  CARD_PROFILES,
  visualTemplateFor
} from './card-minion-template'
import { flattenCardRenderTree, type CardRenderTree } from './card-render-tree'
export { markHearthstoneKeywords } from './card-text-markup'
export { CARD_CANVAS, CARD_PROFILES, visualTemplateFor }

export type CardTemplate = 'minion' | 'spell' | 'weapon' | 'hero' | 'hero-power'
export type CardLayerKind = 'texture' | 'text' | 'placeholder'
export type CardShape = 'ellipse' | 'circle' | 'rounded-rectangle' | 'arch'

export interface CardPoint {
  readonly x: number
  readonly y: number
}

export interface CardBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface CardTextStyle {
  readonly fontFamily: string
  readonly fontSize: number
  readonly fill: number
  readonly align: 'left' | 'center'
  readonly fontWeight?: 'normal' | 'bold'
  readonly stroke?: { readonly color: number; readonly width: number }
  readonly wordWrap?: boolean
  readonly wordWrapWidth?: number
  readonly lineHeight?: number
  readonly breakWords?: boolean
  readonly tagStyles?: Readonly<
    Record<string, { readonly fontWeight?: 'normal' | 'bold' }>
  >
}

/** Retained for compatibility with the renderer's optional curved-text support. */
export interface CardTextCurve {
  readonly startY: number
  readonly control1Y: number
  readonly control2Y: number
  readonly endY: number
}

export interface CardArtworkPlacement {
  readonly offset: CardPoint
  readonly overscan: number
}

export interface CardTextureLayer {
  readonly kind: 'texture'
  readonly id: string
  readonly assetName: string
  readonly position: CardPoint
  readonly anchor?: CardPoint
  readonly scale?: CardPoint
  readonly zIndex: number
}

export interface CardTextLayer {
  readonly kind: 'text'
  readonly id: string
  readonly text: string
  readonly position: CardPoint
  readonly anchor?: CardPoint
  readonly style: CardTextStyle
  readonly curve?: CardTextCurve
  readonly zIndex: number
}

export interface CardPlaceholderLayer {
  readonly kind: 'placeholder'
  readonly id: string
  readonly bounds: CardBounds
  readonly shape: CardShape
  readonly color: number
  readonly artwork?: CardArtworkPlacement
  readonly zIndex: number
}

export type CardLayer = CardTextureLayer | CardTextLayer | CardPlaceholderLayer

export interface CardNodeOverride {
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly visible?: boolean
  readonly fontSize?: number
  readonly lineHeight?: number
}

export type CardNodeOverrides = Readonly<Record<string, CardNodeOverride>>

export interface CardRenderOptions {
  readonly premium?: boolean
  /** Kept for API compatibility; Hero Power now uses the spell profile. */
  readonly opponent?: boolean
  readonly debug?: boolean
  /** Elite overlays are intentionally ignored in the simplified design. */
  readonly elite?: boolean
  readonly silenced?: boolean
  readonly nodeOverrides?: CardNodeOverrides
}

export interface CardRenderPlan {
  readonly cardId: string
  readonly cardType: CardType
  readonly template: CardTemplate
  readonly width: number
  readonly height: number
  readonly renderScaleY: number
  readonly tree: CardRenderTree
  readonly layers: readonly CardLayer[]
  readonly diagnostics: readonly string[]
}

export function buildCardRenderPlan(
  card: import('./card-catalog').CardDefinition,
  options: CardRenderOptions = {}
): CardRenderPlan {
  const visualTemplate = visualTemplateFor(card.type)
  const tree = buildCardRenderTree(card, options)
  const diagnostics = [
    `Uses the ${visualTemplate} profile on the canonical ${CARD_CANVAS.width} × ${CARD_CANVAS.height} canvas.`,
    'Frame, name, rules, stats, and rarity are rendered as semantic nodes.',
    'Card class does not affect visual asset selection.'
  ]

  if (card.type === 'Hero Power') {
    diagnostics.push('Hero Power temporarily uses the spell profile.')
  }
  if (card.type === 'Hero') {
    diagnostics.push('Hero uses the dedicated standard or premium hero frame.')
  }
  if (options.elite) {
    diagnostics.push('Elite overlay request ignored by the simplified card design.')
  }
  if (card.rarity === 'Free' || card.rarity === 'None') {
    diagnostics.push(`Rarity ${card.rarity} intentionally has no rarity gem.`)
  }

  return {
    cardId: card.id,
    cardType: card.type,
    template: visualTemplate,
    width: CARD_CANVAS.width,
    height: CARD_CANVAS.height,
    renderScaleY: 1,
    tree,
    layers: flattenCardRenderTree(tree),
    diagnostics
  }
}

/** Exposes the active profile table for Card Lab calibration tools. */
export { CARD_PROFILES as CARD_LAYOUTS }
