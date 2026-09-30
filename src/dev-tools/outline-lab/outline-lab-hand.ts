import {
  Container,
  Graphics,
  Point,
  Text,
  type FederatedPointerEvent,
  type Renderer
} from 'pixi.js'
import { CARD_CATALOG } from '../../game-rules/content/cards/card-catalog'
import { AnimationScope } from '../../visual-components/animation/animations'
import { CardView } from '../../visual-components/cards/card-view'
import { CARD_PROFILES } from '../../visual-components/cards/card-layout'
import type {
  OutlinePalette,
  OutlineTuning
} from '../../visual-components/effects/animated-outline'
import { applyPlacement } from '../../visual-components/layout'
import { BoardShadowLayer } from '../../scenes/match/board/board-shadow-layer'
import { CardAssetResolver, type GameAssets } from '../../visual-components/assets'
import type { CursorManager } from '../../visual-components/controls/cursor'
import { GameCardSlot } from '../../scenes/match/hand/game-card-slot'
import { GameHandView } from '../../scenes/match/hand/game-hand-view'
import {
  DEFAULT_HAND_LAYOUT,
  resolveHandHover,
  type HandPointer
} from '../../scenes/match/hand/hand-layout'
import { OUTLINE_LAB_LAYOUT, isInsideHandDropZone } from './outline-lab-layout'

const CARD_IDS = [
  'basic_chillwind_yeti',
  'basic_fireball',
  'basic_fiery_war_axe',
  'basic_river_crocolisk',
  'basic_frostbolt'
] as const

export function clampHandCount(count: number): number {
  return Math.max(1, Math.min(10, Math.round(Number.isFinite(count) ? count : 5)))
}

/** A presentation-only host for the actual match hand. All gestures stay in GameHandView. */
export class OutlineLabHand extends Container {
  private readonly animations = new AnimationScope()
  private readonly shadows: BoardShadowLayer
  private readonly hand: GameHandView
  private generation = 0
  private disposed = false
  private loading = false
  private enhanced = false
  private palette?: OutlinePalette
  private tuning?: OutlineTuning
  private dropPalette?: OutlinePalette
  private readonly dropZone = new Graphics()
  private dropAllowed = false

  constructor(
    private readonly renderer: Renderer,
    private readonly canvas: HTMLCanvasElement,
    private readonly assets: GameAssets,
    private readonly resolver: CardAssetResolver,
    private readonly cursorManager?: CursorManager | null
  ) {
    super()
    this.label = 'outline-lab.hand'
    applyPlacement(this, OUTLINE_LAB_LAYOUT.hand)
    const zone = OUTLINE_LAB_LAYOUT.handDropZone
    this.dropZone.label = 'outline-lab.hand.valid-drop-zone'
    this.dropZone.eventMode = 'none'
    applyPlacement(this.dropZone, zone)
    this.drawDropZone()
    this.addChild(this.dropZone)
    const caption = new Text({
      text: 'Valid drop zone · release returns to hand',
      style: { fontFamily: 'Arial', fontSize: 18, fill: 0x9db5d1 }
    })
    caption.label = 'outline-lab.hand.valid-drop-caption'
    caption.anchor.set(0.5, 0)
    caption.position.set(zone.size.width / 2, 16)
    caption.eventMode = 'none'
    this.dropZone.addChild(caption)
    this.shadows = new BoardShadowLayer(this, renderer)
    this.addChild(this.shadows)
    this.hand = new GameHandView(
      renderer,
      this.animations,
      {
        beginTargetGesture: () => {},
        tryTarget: () => false,
        updateBoardPreview: (pointer) => this.updateDropZone(pointer),
        clearBoardPreview: () => this.updateDropZone(null),
        syncMana: () => {},
        onReturned: () => this.hand.setReflowing(false),
        onPointerDown: (event) => this.pickUp(event),
        isHoverBlocked: () => this.loading || !this.visible,
        allowsHandHit: () => false,
        activateWindowInput: () => {}
      },
      { hasDrawOrigin: () => false, departDeck: async () => {} },
      cursorManager
    )
    this.addChild(this.hand.layer)
    this.hand.activate()
    window.addEventListener('pointerup', this.release, true)
    window.addEventListener('pointercancel', this.cancel)
    window.addEventListener('blur', this.cancel)
  }

  async setCount(value: number): Promise<void> {
    const generation = ++this.generation
    this.loading = true
    this.clearCards()
    const slots: GameCardSlot[] = []
    try {
      for (let index = 0; index < clampHandCount(value); index += 1) {
        const definition = CARD_CATALOG.require(CARD_IDS[index % CARD_IDS.length])
        const artwork = await this.resolver.loadArtwork(definition.id)
        if (this.disposed || generation !== this.generation) return
        const card = await CardView.create(definition, this.resolver, {
          artwork,
          premium: false
        })
        if (this.disposed || generation !== this.generation) {
          card.destroy({ children: true })
          return
        }
        let slot: GameCardSlot
        try {
          const frame = await this.resolver.load(
            CARD_PROFILES[card.plan.template].frame
          )
          if (this.disposed || generation !== this.generation) {
            card.destroy({ children: true })
            return
          }
          slot = new GameCardSlot(
            card,
            `lab-${generation}-${index}`,
            this.assets.mulliganReplaceCross,
            this.assets.mulliganReplacedLabel,
            frame,
            this.renderer
          )
        } catch (error) {
          card.destroy({ children: true })
          throw error
        }
        slots.push(slot)
      }
      for (const [index, slot] of slots.entries()) {
        const definition = CARD_CATALOG.require(CARD_IDS[index % CARD_IDS.length])
        this.hand.layer.addChild(slot)
        this.hand.append({
          card: { instanceId: slot.instanceId, cardId: definition.id, zone: 'hand' },
          slot,
          restTransform: undefined,
          displaced: false
        })
        slot.setPlayableOutlineEnhanced(this.enhanced)
        if (this.palette && this.tuning)
          slot.setPlayableOutlineAppearance(this.palette, this.tuning)
        this.hand.configureSlot(slot)
        slot.setPlayableOutlineEnabled(true)
      }
      slots.length = 0 // The hand now owns these slots.
      await this.hand.applyLayout({ positionDuration: 0, scaleDuration: 0 })
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.clearCards()
      throw error
    } finally {
      for (const slot of slots) if (!slot.destroyed) slot.dispose()
      if (generation === this.generation) this.loading = false
    }
  }

  setAppearance(
    enhanced: boolean,
    palette: OutlinePalette,
    tuning: OutlineTuning,
    dropPalette: OutlinePalette
  ): void {
    this.enhanced = enhanced
    this.palette = palette
    this.tuning = tuning
    this.dropPalette = dropPalette
    for (const { slot } of this.hand.entries) {
      if ((slot.getPlayableOutlinePreset() === 'bonus-card') !== enhanced)
        slot.setPlayableOutlineEnhanced(enhanced)
      slot.setPlayableOutlineAppearance(palette, tuning)
    }
    this.hand.drag.refreshOutlineAppearance()
    this.updateDropZone(this.hand.drag.pointer)
    this.drawDropZone()
  }

  private updateDropZone(pointer: HandPointer | null): void {
    const allowed =
      pointer !== null &&
      this.hand.drag.index !== null &&
      !this.hand.drag.returning &&
      isInsideHandDropZone(pointer)
    this.hand.drag.setDropAllowed(allowed, this.dropPalette)
    if (allowed === this.dropAllowed) return
    this.dropAllowed = allowed
    this.drawDropZone()
  }

  private drawDropZone(): void {
    const { width, height } = OUTLINE_LAB_LAYOUT.handDropZone.size
    const color = this.dropAllowed
      ? (this.dropPalette?.baseColor ?? 0x4488ff)
      : 0x637398
    this.dropZone
      .clear()
      .roundRect(0, 0, width, height, 18)
      .fill({ color, alpha: this.dropAllowed ? 0.15 : 0.04 })
      .stroke({ color, width: 2, alpha: this.dropAllowed ? 0.9 : 0.5 })
  }

  update(deltaMS: number): void {
    if (!this.visible || this.disposed) return
    this.hand.drag.update(deltaMS)
    this.shadows.update(deltaMS)
  }

  cancel = (): void => {
    this.hand.drag.end()
    this.hand.clearHover()
    this.cursorManager?.setContextVariant(null)
  }

  pause(): void {
    this.cancel()
    this.animations.pause()
  }

  resume(): void {
    this.animations.resume()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    window.removeEventListener('pointerup', this.release, true)
    window.removeEventListener('pointercancel', this.cancel)
    window.removeEventListener('blur', this.cancel)
    this.clearCards()
    this.hand.dispose()
    this.destroy({ children: true })
  }

  private clearCards(): void {
    this.cancel()
    // Release the perspective before destroying its source card, even mid-return.
    const held =
      this.hand.drag.index === null
        ? undefined
        : this.hand.entries[this.hand.drag.index]
    if (held) this.hand.drag.releaseForTargeting(held)
    this.hand.drag.presentationSettled()
    this.animations.kill()
    this.hand.resetHover()
    let entry = this.hand.takeLast()
    while (entry) {
      entry.slot.dispose()
      entry = this.hand.takeLast()
    }
  }

  private pickUp(event: FederatedPointerEvent): void {
    if (
      this.loading ||
      !this.visible ||
      event.button !== 0 ||
      this.hand.drag.index !== null
    )
      return
    const local = event.getLocalPosition(this.hand.layer)
    const index = resolveHandHover(local, this.hand.restTransforms, DEFAULT_HAND_LAYOUT)
    if (index !== null) this.hand.drag.begin(index, local, event.pointerId)
  }

  private release = (event: PointerEvent): void => {
    if (!this.hand.drag.ownsPointer(event.pointerId)) return
    const bounds = this.canvas.getBoundingClientRect()
    const point = new Point(
      ((event.clientX - bounds.left) * this.renderer.screen.width) / bounds.width,
      ((event.clientY - bounds.top) * this.renderer.screen.height) / bounds.height
    )
    this.hand.drag.flushPointer(this.hand.layer.toLocal(point), event.pointerId)
    this.hand.drag.end()
  }
}
