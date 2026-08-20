import { Container, Graphics, Rectangle } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import type { CardDefinition } from '../../../game/content/cards'
import { CardAssetResolver } from '../ui/asset-registry/card-asset-resolver'
import { CardView } from '../rendering/cards/card-view'
import { GAME_HEIGHT, GAME_WIDTH } from '../app/config'
import {
  cardDetailRows,
  createCardDetailPanel,
  type CardDetailRow
} from '../features/collection/card-detail-panel'
import { CardPreviewParallax, resolveParallaxTarget } from './cardPreviewParallax'
import { Scene } from './Scene'

export { cardDetailRows }
export type { CardDetailRow }

export interface CardPreviewSourceBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface CardViewSceneOptions {
  readonly card: CardDefinition
  readonly sourceBounds: CardPreviewSourceBounds
  readonly resolver?: CardAssetResolver
}

const COLORS = {
  backdrop: 0x080b12
} as const

const PREVIEW = {
  cardCenter: { x: 1080, y: GAME_HEIGHT / 2 },
  pointerRange: { x: 480, y: 440 },
  maxScale: 0.86,
  animationDuration: 0.28
} as const

// The preview effect is intentionally controlled here so it can be disabled
// without touching the shared CardView renderer or collection interactions.
const CARD_PREVIEW_PARALLAX_ENABLED = true

/** Contextual enlarged card preview opened from the Collection scene. */
export class CardViewScene extends Scene {
  private readonly card: CardDefinition
  private readonly sourceBounds: CardPreviewSourceBounds
  private readonly resolver: CardAssetResolver

  private backdrop!: Graphics
  private detailsPanel!: Container
  private cardMotion!: Container
  private cardView!: CardView
  private parallax: CardPreviewParallax | null = null
  private activeTimeline: { kill: () => void } | null = null
  private closing = false

  constructor(options: CardViewSceneOptions) {
    super()
    this.card = options.card
    this.sourceBounds = options.sourceBounds
    this.resolver = options.resolver ?? new CardAssetResolver()
  }

  async init(): Promise<void> {
    await this.waitForFonts()

    this.backdrop = new Graphics()
      .rect(0, 0, GAME_WIDTH, GAME_HEIGHT)
      .fill({ color: COLORS.backdrop, alpha: 0.78 })
    this.backdrop.alpha = 0
    this.backdrop.eventMode = 'static'
    this.backdrop.cursor = 'default'
    this.backdrop.hitArea = new Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT)
    this.backdrop.on('pointertap', this.handleBackdropTap)
    this.root.addChild(this.backdrop)

    this.detailsPanel = createCardDetailPanel(this.card)
    this.detailsPanel.alpha = 0
    this.root.addChild(this.detailsPanel)

    const artwork = await this.resolver.loadArtwork(this.card.id)
    this.cardView = await CardView.create(this.card, this.resolver, { artwork })
    this.cardView.eventMode = 'static'

    this.cardMotion = new Container()
    this.cardMotion.addChild(this.cardView)
    if (CARD_PREVIEW_PARALLAX_ENABLED) {
      this.parallax = new CardPreviewParallax(this.cardView)
      this.backdrop.on('globalpointermove', this.handlePointerMove)
    }
    this.positionAtSource()
    this.root.addChild(this.cardMotion)
  }

  update(deltaMS: number): void {
    this.parallax?.update(deltaMS)
  }

  protected onEnter(): void {
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('blur', this.handlePointerExit)
    this.appInstance.canvas.addEventListener('pointerleave', this.handlePointerExit)
    this.playOpenAnimation()
  }

  protected onExit(): void {
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('blur', this.handlePointerExit)
    this.appInstance.canvas.removeEventListener('pointerleave', this.handlePointerExit)
    this.activeTimeline?.kill()
    this.activeTimeline = null
    this.killTweensOf(this.backdrop)
    this.killTweensOf(this.detailsPanel)
    this.killTweensOf(this.cardMotion)
    this.killTweensOf(this.cardMotion.scale)
    this.parallax?.destroy()
    this.parallax = null
  }

  private async waitForFonts(): Promise<void> {
    if (!document.fonts) return

    await Promise.all([
      document.fonts.load('28px Belwe'),
      document.fonts.load('400 22px "Franklin Gothic Condensed"'),
      document.fonts.load('700 22px "Franklin Gothic Condensed"')
    ])
  }

  private positionAtSource(): void {
    const sourceScale = Math.min(
      this.sourceBounds.width / this.cardView.plan.width,
      this.sourceBounds.height / this.cardView.renderedHeight
    )
    this.cardMotion.scale.set(Math.max(0.001, sourceScale))
    this.cardMotion.position.set(this.sourceBounds.x, this.sourceBounds.y)
  }

  private positionAtPreview(): { scale: number; x: number; y: number } {
    const scale = Math.min(
      PREVIEW.maxScale,
      (GAME_HEIGHT - 80) / this.cardView.renderedHeight,
      (GAME_WIDTH - 760) / this.cardView.plan.width
    )
    return {
      scale,
      x: PREVIEW.cardCenter.x - (this.cardView.plan.width * scale) / 2,
      y: PREVIEW.cardCenter.y - (this.cardView.renderedHeight * scale) / 2
    }
  }

  private playOpenAnimation(): void {
    const target = this.positionAtPreview()
    this.activeTimeline?.kill()
    const timeline = this.timeline()
    this.activeTimeline = timeline
    timeline.to(
      this.backdrop,
      { alpha: 1, duration: PREVIEW.animationDuration, ease: 'power2.out' },
      0
    )
    timeline.to(
      this.cardMotion,
      {
        x: target.x,
        y: target.y,
        duration: PREVIEW.animationDuration,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      this.cardMotion.scale,
      {
        x: target.scale,
        y: target.scale,
        duration: PREVIEW.animationDuration,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      this.detailsPanel,
      { alpha: 1, duration: PREVIEW.animationDuration, ease: 'power2.out' },
      0.08
    )
  }

  private readonly handleBackdropTap = (event: FederatedPointerEvent): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    void this.close()
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    void this.close()
  }

  private readonly handlePointerMove = (event: FederatedPointerEvent): void => {
    if (this.closing || !this.parallax) return

    const pointer = this.root.toLocal(event.global)
    this.parallax.setTarget(
      resolveParallaxTarget(pointer, PREVIEW.cardCenter, PREVIEW.pointerRange)
    )
  }

  private readonly handlePointerExit = (): void => {
    this.parallax?.release()
  }

  private async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    this.parallax?.release()

    this.activeTimeline?.kill()
    const timeline = this.timeline()
    this.activeTimeline = timeline
    timeline.to(
      this.backdrop,
      { alpha: 0, duration: PREVIEW.animationDuration, ease: 'power2.in' },
      0
    )
    timeline.to(
      this.detailsPanel,
      { alpha: 0, duration: PREVIEW.animationDuration, ease: 'power2.in' },
      0
    )
    timeline.to(
      this.cardMotion,
      {
        x: this.sourceBounds.x,
        y: this.sourceBounds.y,
        duration: PREVIEW.animationDuration,
        ease: 'power2.in'
      },
      0
    )
    const sourceScale = Math.min(
      this.sourceBounds.width / this.cardView.plan.width,
      this.sourceBounds.height / this.cardView.renderedHeight
    )
    timeline.to(
      this.cardMotion.scale,
      {
        x: Math.max(0.001, sourceScale),
        y: Math.max(0.001, sourceScale),
        duration: PREVIEW.animationDuration,
        ease: 'power2.in',
        onComplete: () => {
          this.activeTimeline = null
          void this.sceneManager.pop()
        }
      },
      0
    )
  }
}
