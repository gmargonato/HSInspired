import { Container, Rectangle, Sprite, type Texture } from 'pixi.js'
import {
  applyAnchoredPlacement,
  applyPlacement,
  placement,
  type LayoutPlacement
} from '../../rendering/layout'
import { DECK_STACK_LAYOUT } from './deck-stack-layout'

type DeckMode = 'dynamic' | 'static'
type DeckTextures = { deck: Texture; deckSliced: Texture; fatigueDeck: Texture }

/** Shared-texture sprites; no filters, render textures, or per-frame updates. */
export class DeckStackView extends Container {
  /** Retains the original sprite's coordinate system for flights and the hover tray. */
  readonly drawOrigin: Sprite
  private readonly stack = new Container()
  private readonly cards: Sprite[] = []
  private count = -1
  private mode: DeckMode

  constructor(
    private readonly textures: DeckTextures,
    private readonly layout: LayoutPlacement,
    private readonly fatigueOffsetX: number,
    mode: DeckMode = import.meta.env.VITE_MATCH_DECK_MODE === 'static'
      ? 'static'
      : DECK_STACK_LAYOUT.mode
  ) {
    super()
    this.mode = mode
    applyPlacement(this, layout)
    this.eventMode = 'static'
    this.interactiveChildren = false
    this.drawOrigin = new Sprite(textures.deck)
    this.drawOrigin.label = 'game.deck-original'
    applyAnchoredPlacement(
      this.drawOrigin,
      placement({ x: 0, y: 0 }, layout.size, { anchor: layout.anchor })
    )
    this.drawOrigin.eventMode = 'none'
    this.stack.label = 'game.deck-stack'
    this.stack.eventMode = 'none'
    this.stack.position.set(
      -layout.anchor.x * layout.size.width,
      -layout.anchor.y * layout.size.height
    )
    this.addChild(this.drawOrigin, this.stack)
  }

  setMode(mode: DeckMode): void {
    if (this.mode === mode) return
    this.mode = mode
    const count = this.count
    this.count = -1
    this.syncCount(Math.max(0, count))
  }

  syncCount(count: number): void {
    if (this.count === count) return
    this.count = count
    const empty = count === 0
    const dynamic = this.mode === 'dynamic' && !empty
    this.drawOrigin.texture = empty ? this.textures.fatigueDeck : this.textures.deck
    this.drawOrigin.visible = !dynamic
    this.stack.visible = dynamic
    this.x = this.layout.position.x + (empty ? this.fatigueOffsetX : 0)

    const visibleCount = dynamic ? count : 0
    while (this.cards.length > visibleCount) this.cards.pop()!.destroy()
    while (this.cards.length < visibleCount) {
      const card = new Sprite(this.textures.deckSliced)
      card.label = `game.deck-card.${this.cards.length}`
      card.eventMode = 'none'
      this.cards.push(card)
      // The exposed card is last in paint order; each new layer sits behind it.
      this.stack.addChildAt(card, 0)
    }

    const depthAt = (index: number): number =>
      index * DECK_STACK_LAYOUT.gap +
      Math.floor(index / DECK_STACK_LAYOUT.groupSize) * DECK_STACK_LAYOUT.groupGap
    const compression = Math.min(
      1,
      DECK_STACK_LAYOUT.maxDepth / Math.max(1, depthAt(count - 1))
    )
    let groupY = 0
    let groupInset = 0
    for (let index = 0; index < this.cards.length; index += 1) {
      const card = this.cards[index]!
      const depth = depthAt(index) * compression
      if (index > 0 && index % DECK_STACK_LAYOUT.groupSize === 0) {
        const group = index / DECK_STACK_LAYOUT.groupSize
        const progress = Math.min(1, depthAt(index) / DECK_STACK_LAYOUT.maxDepth)
        const chance = DECK_STACK_LAYOUT.groupShiftChance
        // Stable per-group hashes, independent of deck count and the game's RNG.
        const roll = (Math.imul(group, 0x9e3779b1) >>> 0) / 0x100000000
        if (roll < chance.front + (chance.rear - chance.front) * progress) {
          const jitter = (Math.imul(group, 0x85ebca6b) >>> 0) / 0x100000000
          groupInset = progress * DECK_STACK_LAYOUT.rearInset
          groupY = groupInset + (jitter * 2 - 1) * DECK_STACK_LAYOUT.groupJitter
        }
      }
      card.position.set(depth, groupY)
      card.width = DECK_STACK_LAYOUT.card.width
      card.height = DECK_STACK_LAYOUT.card.height - groupInset * 2
      card.tint = index === 0 ? 0xffffff : DECK_STACK_LAYOUT.rearTint
    }
    const width = dynamic
      ? DECK_STACK_LAYOUT.card.width + Math.max(0, depthAt(count - 1)) * compression
      : this.drawOrigin.texture.orig.width
    const height = dynamic
      ? this.layout.size.height
      : this.drawOrigin.texture.orig.height
    this.hitArea = new Rectangle(
      -this.layout.anchor.x * (dynamic ? this.layout.size.width : width),
      -this.layout.anchor.y * height,
      width,
      height
    )
  }
}
