import { Container, Rectangle, Sprite, type Renderer, type Texture } from 'pixi.js'
import { GameCardSlot } from '../hand/game-card-slot'
import { CARD_DRAW_LAYOUT } from './card-draw-layout'
import {
  createCardMotion,
  type CardMotionPlayback,
  type DeckMotionProfile,
  type MotionCorners,
  type MotionLaunch
} from './card-motion'
import { CardFlightVisual } from './card-flight-visual'
import { cardDeckSlot, type CardDeckSlot } from './card-deck-slot'

/** Use the sprite transform only as a placement anchor, never its painted corners. */
export function deckMotionSlot(layer: Container, deck: Sprite): CardDeckSlot {
  const center = layer.toLocal(deck.toGlobal({ x: 0, y: 0 }))
  const axis = layer.toLocal(deck.toGlobal({ x: 1, y: 0 }))
  return cardDeckSlot(
    center,
    Math.hypot(axis.x - center.x, axis.y - center.y),
    Math.atan2(axis.y - center.y, axis.x - center.x)
  )
}

export function deckMotionCorners(layer: Container, deck: Sprite): MotionCorners {
  const corners = CARD_DRAW_LAYOUT.deckFace.map((p) =>
    layer.toLocal(
      deck.toGlobal({
        x: p.x - deck.anchor.x * deck.texture.width,
        y: p.y - deck.anchor.y * deck.texture.height
      })
    )
  )
  // The texture's top edge runs down the painted deck's right edge (landscape).
  return [corners[1], corners[2], corners[3], corners[0]]
}
export function bodyMotionCorners(
  layer: Container,
  body: Container,
  frame: Rectangle
): MotionCorners {
  return [
    { x: frame.x, y: frame.y },
    { x: frame.right, y: frame.y },
    { x: frame.right, y: frame.bottom },
    { x: frame.x, y: frame.bottom }
  ].map((p) => layer.toLocal(body.toGlobal(p))) as unknown as MotionCorners
}

/** Owns a motion recipe; the shared flight visual owns rendering and lifetime. */
export class CardMotionVisual {
  readonly playback: CardMotionPlayback
  private readonly visual: CardFlightVisual
  get mesh() {
    return this.visual.mesh
  }

  constructor(
    renderer: Renderer,
    layer: Container,
    body: Container,
    back: Texture,
    profile: DeckMotionProfile,
    end: MotionCorners,
    options: {
      hidden?: boolean
      remote?: boolean
      sequence?: number
      start?: MotionCorners
      timeScale?: number
      launch?: MotionLaunch
      slot?: CardDeckSlot
    } = {}
  ) {
    const slot =
      body instanceof GameCardSlot
        ? body
        : body.children.find(
            (child): child is GameCardSlot => child instanceof GameCardSlot
          )
    const face = slot?.card ?? body.getChildByLabel('game.deck-addition.back') ?? body
    this.visual = new CardFlightVisual(renderer, layer, body, back, {
      face,
      hidden: options.hidden,
      additiveLift: true,
      label: `${body.label || 'game.card'}.motion`,
      capture: slot
        ? (frame, active) => slot.card.createAppearanceSnapshot(renderer, frame, active)
        : undefined
    })
    this.playback = createCardMotion(profile, {
      start: options.start ?? this.visual.corners,
      end,
      aspectRatio: this.visual.frame.width / this.visual.frame.height,
      ...options
    })
    this.update(0)
  }

  setOcclusionEnabled(enabled: boolean): void {
    this.visual.setOcclusionEnabled(enabled)
  }
  update(seconds: number, scale = 1): void {
    this.visual.update(
      this.playback.sample(seconds),
      seconds / this.playback.duration,
      scale
    )
  }
  dispose(): void {
    this.visual.dispose()
  }
}
