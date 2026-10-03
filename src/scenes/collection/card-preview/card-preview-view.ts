import { Container, Graphics, Rectangle } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import type { CardDefinition } from '../../../game-rules/content/cards'
import { AssetScope } from '../../../visual-components/assets/asset-scope'
import { CardAssetResolver } from '../../../visual-components/assets/card-asset-resolver'
import {
  CardView,
  type CardPieceMotion
} from '../../../visual-components/cards/card-view'
import { GAME_HEIGHT, GAME_WIDTH } from '../../../visual-components/layout'
import {
  cardDetailRows,
  createCardDetailPanel,
  type CardDetailRow
} from './card-detail-panel'
import { CARD_PREVIEW_LAYOUT } from './card-preview-layout'
import { resolveGeneratedPreviewCard } from './generated-card-preview'
import { applyPlacement } from '../../../visual-components/layout'
import {
  CardParallaxEffect,
  resolveParallaxTarget
} from '../../../visual-components/cards/card-parallax'
import {
  ASSET_BUNDLE_IDS,
  type CardPreviewAssets
} from '../../../visual-components/assets'
import { Actor } from '../../../visual-components/lifecycle/actor'
import type { ProgressionStore } from '../../../application/contracts/progression-store'
import { PremiumUpgradePanel } from './premium-upgrade-panel'
import { CARD_ASSEMBLY } from './card-assembly-layout'
import { CardAssemblyEffects } from './card-assembly-effects'

export { cardDetailRows }
export type { CardDetailRow }

export interface CardPreviewSourceBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface CardPreviewViewOptions {
  readonly card: CardDefinition
  readonly sourceBounds: CardPreviewSourceBounds
  readonly resolver?: CardAssetResolver
  readonly assetScope: AssetScope
  readonly onClose: () => Promise<void> | void
  readonly progression?: ProgressionStore
  readonly onMessage?: (message: string) => void
  readonly onPresentationOffset?: (x: number, y: number) => void
}

// Optional backdrop tint (disabled; collection blur remains active).
// const COLORS = {
//   backdrop: 0x080b12
// } as const

const RARITY_GEM_ASSET_FILES: Partial<Record<CardDefinition['rarity'], string>> = {
  Common: 'rarity-common.png',
  Rare: 'rarity-rare.png',
  Epic: 'rarity-epic.png',
  Legendary: 'rarity-legendary.png'
}

const PREVIEW = CARD_PREVIEW_LAYOUT

// The preview effect is intentionally controlled here so it can be disabled
// without touching the shared CardView renderer or collection interactions.
const CARD_PREVIEW_PARALLAX_ENABLED = true

/** Contextual enlarged card preview opened from the Collection scene. */
export class CardPreviewView extends Actor {
  private readonly card: CardDefinition
  private readonly sourceBounds: CardPreviewSourceBounds
  private readonly resolver: CardAssetResolver
  private readonly assetScope: AssetScope
  private readonly onClose: () => Promise<void> | void

  private backdrop!: Graphics
  private detailsPanel!: Container
  private cardMotion!: Container
  private cardView!: CardView
  private generatedCardView: CardView | null = null
  private parallax: CardParallaxEffect | null = null
  private activeTimeline: { kill: () => void } | null = null
  private closing = false
  private changing = false
  private cancelAssembly: (() => void) | null = null
  private readonly progression?: ProgressionStore
  private readonly onMessage?: (message: string) => void
  private upgradePanel?: PremiumUpgradePanel
  private assemblyEffects?: CardAssemblyEffects
  private readonly onPresentationOffset: (x: number, y: number) => void

  constructor(options: CardPreviewViewOptions) {
    super()
    this.card = options.card
    this.sourceBounds = options.sourceBounds
    this.resolver = options.resolver ?? new CardAssetResolver()
    this.assetScope = options.assetScope
    this.onClose = options.onClose
    this.progression = options.progression
    this.onMessage = options.onMessage
    this.onPresentationOffset = options.onPresentationOffset ?? (() => undefined)
  }

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<CardPreviewAssets>(
      ASSET_BUNDLE_IDS.cardPreview
    )
    await this.waitForFonts()

    this.backdrop = new Graphics()
    // Restore these calls and COLORS above to re-enable the dark overlay.
    // this.backdrop
    //   .rect(0, 0, GAME_WIDTH, GAME_HEIGHT)
    //   .fill({ color: COLORS.backdrop, alpha: 0.78 })
    this.backdrop.label = 'card-preview.backdrop'
    this.backdrop.alpha = 0
    this.backdrop.eventMode = 'static'
    this.backdrop.cursor = 'default'
    this.backdrop.hitArea = new Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT)
    this.backdrop.on('pointertap', this.handleBackdropTap)
    this.addChild(this.backdrop)

    const rarityGemAsset = RARITY_GEM_ASSET_FILES[this.card.rarity]
    const rarityGem = rarityGemAsset
      ? await this.resolver.load(rarityGemAsset)
      : undefined
    this.detailsPanel = createCardDetailPanel(
      this.card,
      assets.detailContainer,
      rarityGem
    )
    this.detailsPanel.label = 'card-preview.details-panel'
    this.detailsPanel.alpha = 0
    this.addChild(this.detailsPanel)

    const artwork = await this.resolver.loadArtwork(this.card.id)
    this.cardView = await CardView.create(this.card, this.resolver, {
      artwork,
      animatePremiumArtwork: true
    })
    this.cardView.eventMode = 'static'

    this.cardMotion = new Container()
    this.cardMotion.label = 'card-preview.card-motion'
    this.cardMotion.addChild(this.cardView)
    this.cardView.label = 'card-preview.card'
    if (CARD_PREVIEW_PARALLAX_ENABLED) {
      this.parallax = new CardParallaxEffect(this.cardView)
      this.backdrop.on('globalpointermove', this.handlePointerMove)
    }
    this.positionAtSource()
    this.addChild(this.cardMotion)

    const generatedCard = resolveGeneratedPreviewCard(this.card)
    if (generatedCard) {
      const generatedArtwork = await this.resolver.loadArtwork(generatedCard.id)
      const generatedView = await CardView.create(generatedCard, this.resolver, {
        artwork: generatedArtwork
      })
      generatedView.label = 'card-preview.generated-card'
      generatedView.eventMode = 'none'
      const generatedPlacement = PREVIEW.generatedCard
      applyPlacement(generatedView, generatedPlacement)
      generatedView.pivot.set(
        generatedView.plan.width / 2,
        generatedView.renderedHeight / 2
      )
      generatedView.alpha = 0
      this.generatedCardView = generatedView
      this.addChild(generatedView)
    }

    if (this.progression) {
      await this.progression.load()
      this.upgradePanel = new PremiumUpgradePanel(
        this.card,
        assets,
        this.progression,
        (action) => this.changePremium(action),
        this.onMessage
      )
      this.upgradePanel.alpha = 0
      this.addChild(this.upgradePanel)
    }
    this.assemblyEffects = new CardAssemblyEffects(
      assets.assemblySpark,
      this.onPresentationOffset
    )
    this.addChild(this.assemblyEffects)
  }

  update(deltaMS: number): void {
    this.parallax?.update(deltaMS)
    this.assemblyEffects?.update(deltaMS)
  }

  enter(canvas: HTMLCanvasElement): void {
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('blur', this.handlePointerExit)
    canvas.addEventListener('pointerleave', this.handlePointerExit)
    this.playOpenAnimation()
  }

  exit(canvas: HTMLCanvasElement): void {
    this.closing = true
    this.cancelAssembly?.()
    this.assemblyEffects?.clear()
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('blur', this.handlePointerExit)
    canvas.removeEventListener('pointerleave', this.handlePointerExit)
    this.activeTimeline?.kill()
    this.activeTimeline = null
    this.killTweensOf(this.backdrop)
    this.killTweensOf(this.detailsPanel)
    this.killTweensOf(this.cardMotion)
    this.killTweensOf(this.cardMotion.scale)
    this.parallax?.destroy()
    this.parallax = null
  }

  private async changePremium(action: 'upgrade' | 'refund'): Promise<void> {
    if (this.closing || this.changing || !this.progression) return
    this.changing = true
    this.assemblyEffects?.clear()
    this.cardView.setPremiumPresentation(this.cardView.isPremium)
    this.parallax?.destroy()
    this.parallax = null
    const card = this.cardView
    const motions: CardPieceMotion[] = []
    let animation: gsap.core.Timeline | null = null
    let resolveAnimation: (() => void) | null = null
    let cancelled = false
    const restore = (): void => {
      for (const motion of motions) motion.restore()
      if (!card.destroyed) {
        card.scale.set(1)
        card.pivot.set(0)
        card.position.set(0)
        card.setPremiumPresentation(null)
      }
    }
    this.cancelAssembly = () => {
      cancelled = true
      animation?.kill()
      this.assemblyEffects?.clear()
      restore()
      resolveAnimation?.()
    }
    try {
      await this.progression[action](this.card.id)
      if (cancelled || this.closing || this.destroyed) return
      // Finish the opening placement before rotating around the card's center.
      this.activeTimeline?.kill()
      this.activeTimeline = null
      const target = this.positionAtPreview()
      this.cardMotion.position.set(target.x, target.y)
      this.cardMotion.scale.set(target.scale)
      this.detailsPanel.alpha = 1
      this.backdrop.alpha = 1
      if (this.upgradePanel) this.upgradePanel.alpha = 1
      card.pivot.set(card.plan.width / 2, card.renderedHeight / 2)
      card.position.copyFrom(card.pivot)
      await new Promise<void>((resolve) => {
        resolveAnimation = resolve
        const timeline = this.timeline({ paused: true, onComplete: resolve })
        animation = timeline
        timeline.to(card.scale, {
          x: 0,
          duration: CARD_ASSEMBLY.flipHalfDuration,
          ease: 'power2.in'
        })
        timeline.call(() => {
          card.setPremiumPresentation(action === 'upgrade')
          for (const stage of stages) {
            for (const piece of stage) {
              piece.motion = card.createPieceMotion(piece.paths)
              motions.push(piece.motion)
              piece.motion.set({ ...piece.state, visible: false })
            }
          }
        })
        timeline.to(card.scale, {
          x: 1,
          duration: CARD_ASSEMBLY.flipHalfDuration,
          ease: 'power2.out'
        })
        const stages = CARD_ASSEMBLY.stages
          .map((stage) =>
            stage
              .filter((piece) => piece.paths.every((path) => card.hasLayer(path)))
              .map((piece) => ({
                paths: piece.paths,
                impact: piece.impact,
                state: {
                  x: Number(piece.x),
                  y: Number(piece.y),
                  scale: Number(CARD_ASSEMBLY.initialScale),
                  rotation: (piece.rotation * Math.PI) / 180
                },
                motion: null as CardPieceMotion | null
              }))
          )
          .filter((stage) => stage.length > 0)
        let start = CARD_ASSEMBLY.flipHalfDuration * 2
        for (const stage of stages) {
          for (const piece of stage) {
            const update = (): void =>
              piece.motion?.set({ ...piece.state, visible: true })
            const travel = (): void => {
              update()
              if (piece.motion) this.assemblyEffects?.trail(piece.motion)
            }
            timeline.to(
              piece.state,
              {
                x: 0,
                y: 0,
                scale: CARD_ASSEMBLY.landingScale,
                rotation:
                  (-Math.sign(piece.state.rotation) *
                    CARD_ASSEMBLY.rotationOvershoot *
                    Math.PI) /
                  180,
                duration: CARD_ASSEMBLY.travelDuration,
                ease: 'power2.out',
                onStart: travel,
                onUpdate: travel,
                onComplete: () => {
                  if (piece.motion) this.assemblyEffects?.land(piece.motion)
                }
              },
              start
            )
            timeline.to(
              piece.state,
              {
                scale: 1,
                rotation: 0,
                duration: CARD_ASSEMBLY.settleDuration,
                ease: 'power2.out',
                onUpdate: update
              },
              start + CARD_ASSEMBLY.travelDuration
            )
          }
          timeline.call(
            () =>
              this.assemblyEffects?.impact(
                Math.max(...stage.map((piece) => piece.impact))
              ),
            [],
            start + CARD_ASSEMBLY.travelDuration
          )
          start += CARD_ASSEMBLY.travelDuration + CARD_ASSEMBLY.settleDuration
        }
        // Let the last burst and kick finish before releasing the action buttons.
        timeline.to(
          {},
          {
            duration: CARD_ASSEMBLY.particles.lifetimeMax - CARD_ASSEMBLY.settleDuration
          }
        )
        timeline.play()
      })
    } finally {
      restore()
      this.assemblyEffects?.clear()
      this.cancelAssembly = null
      this.changing = false
      if (!this.closing && !this.destroyed && CARD_PREVIEW_PARALLAX_ENABLED)
        this.parallax = new CardParallaxEffect(card)
    }
  }

  override destroy(options?: Parameters<Actor['destroy']>[0]): void {
    this.closing = true
    this.cancelAssembly?.()
    this.assemblyEffects?.clear()
    this.parallax?.destroy()
    this.parallax = null
    this.killAnimations()
    super.destroy(options)
  }

  private async waitForFonts(): Promise<void> {
    if (!document.fonts) return

    await Promise.all([
      document.fonts.load('700 24px Belwe'),
      document.fonts.load('700 16px Belwe')
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
      PREVIEW.cardMaxSize.height / this.cardView.renderedHeight,
      PREVIEW.cardMaxSize.width / this.cardView.plan.width
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
    if (this.upgradePanel)
      timeline.to(
        this.upgradePanel,
        { alpha: 1, duration: PREVIEW.animationDuration },
        0.08
      )
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
    if (this.generatedCardView)
      timeline.to(
        this.generatedCardView,
        { alpha: 1, duration: PREVIEW.animationDuration, ease: 'power2.out' },
        0.12
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

    const pointer = this.toLocal(event.global)
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
    this.cancelAssembly?.()
    this.parallax?.release()

    this.activeTimeline?.kill()
    const timeline = this.timeline()
    if (this.upgradePanel)
      timeline.to(
        this.upgradePanel,
        { alpha: 0, duration: PREVIEW.animationDuration },
        0
      )
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
    if (this.generatedCardView)
      timeline.to(
        this.generatedCardView,
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
          void this.onClose()
        }
      },
      0
    )
  }
}
