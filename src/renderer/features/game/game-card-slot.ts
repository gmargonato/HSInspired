import { Container, Rectangle, Sprite, Texture, type Renderer } from 'pixi.js'
import { CardView } from '../../rendering/cards/card-view'
import {
  AnimatedOutline,
  type OutlinePaletteInput,
  type OutlinePresetName
} from '../../rendering/effects/animated-outline'
import { BakedAnimatedOutline } from '../../rendering/effects/baked-animated-outline'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import { attachShadow, type ShadowCaster } from '../../rendering/shadows/shadow-caster'
import { MATCH_SHADOW_CONFIG } from '../../rendering/shadows/match-shadow-config'
import { DEFAULT_HAND_LAYOUT } from './hand-layout'
import { completeTimeline } from './game-presentation-animation'
import { Actor } from '../../ui/components/actor'
import { killDisplayTweens } from '../../animation/kill-display-tweens'

interface PendingCardReplacement {
  readonly card: CardView
  readonly outlineTexture: Texture
}

export class GameCardSlot extends Actor {
  readonly shadow: ShadowCaster
  private activeCard: CardView
  readonly instanceId: string
  playableOutlineTexture: Texture
  private playableOutline: AnimatedOutline | BakedAnimatedOutline
  private dormantPlayableOutline: AnimatedOutline | BakedAnimatedOutline | null =
    null
  private readonly outlineTarget: Sprite
  private playableOutlineDisposed = false
  private readonly replaceCross: Sprite
  private readonly replacedLabel: Sprite
  private pendingCardReplacement: PendingCardReplacement | null = null
  private bakedOutlineDisplayScale: number | null = null
  private bakedOutlineNeedsRefresh = false
  private playableOutlineRequested = false
  private playableOutlineSuppressed = false
  private playableOutlinePreset: OutlinePresetName = 'card'
  private playableOutlinePalette: OutlinePaletteInput = 'green'

  constructor(
    card: CardView,
    instanceId: string,
    replaceCrossTexture: Texture,
    replacedLabelTexture: Texture,
    outlineTexture: Texture,
    private readonly renderer: Renderer
  ) {
    super()
    this.activeCard = card
    this.shadow = attachShadow(
      this,
      {
        x: 0,
        y: 0,
        width: card.plan.width,
        height: card.renderedHeight
      },
      {
        visual: card,
        restingScale: DEFAULT_HAND_LAYOUT.cardScale,
        maximumHeight: MATCH_SHADOW_CONFIG.heldCardHeight
      }
    )
    this.instanceId = instanceId
    this.playableOutlineTexture = outlineTexture
    this.setMulliganInteractionEnabled(false)
    const slotLayout = GAME_BOARD_LAYOUT.mulligan.slot
    this.hitArea = new Rectangle(
      slotLayout.hitArea.x,
      slotLayout.hitArea.y,
      slotLayout.hitArea.width,
      slotLayout.hitArea.height
    )
    this.label = `game.card.${instanceId}`

    card.eventMode = 'none'
    card.position.set(slotLayout.cardOffset.x, slotLayout.cardOffset.y)

    this.outlineTarget = new Sprite(outlineTexture)
    this.outlineTarget.width = card.plan.width
    this.outlineTarget.height = card.renderedHeight
    this.outlineTarget.position.set(slotLayout.cardOffset.x, slotLayout.cardOffset.y)
    this.outlineTarget.zIndex = -1
    this.outlineTarget.eventMode = 'none'
    this.outlineTarget.label = `${card.label}.playable-outline-target`
    this.addChild(this.outlineTarget)
    this.playableOutline = new AnimatedOutline(this.outlineTarget, {
      palette: 'green',
      preset: 'card',
      cacheDistance: true
    })
    this.setPlayableOutlineEnabled(false)

    this.addChild(card)
    card.enableTextureCache()

    this.replaceCross = new Sprite(replaceCrossTexture)
    this.replaceCross.anchor.set(0.5)
    this.replaceCross.position.set(
      slotLayout.replaceCrossOffset.x,
      slotLayout.replaceCrossOffset.y
    )
    this.replaceCross.scale.set(slotLayout.overlayScale)
    this.replaceCross.visible = false
    this.replaceCross.eventMode = 'none'
    this.addChild(this.replaceCross)

    this.replacedLabel = new Sprite(replacedLabelTexture)
    this.replacedLabel.anchor.set(0.5, 0)
    this.replacedLabel.position.set(
      slotLayout.replacedLabelOffset.x,
      slotLayout.replacedLabelOffset.y
    )
    this.replacedLabel.scale.set(slotLayout.overlayScale)
    this.replacedLabel.visible = false
    this.replacedLabel.eventMode = 'none'
    this.addChild(this.replacedLabel)
  }

  get card(): CardView {
    return this.activeCard
  }

  /** Preloads a new face while keeping this slot and its hand position intact. */
  prepareCardReplacement(card: CardView, outlineTexture: Texture): void {
    this.discardCardReplacement()
    card.eventMode = 'none'
    card.position.set(
      GAME_BOARD_LAYOUT.mulligan.slot.cardOffset.x,
      GAME_BOARD_LAYOUT.mulligan.slot.cardOffset.y
    )
    card.enableTextureCache()
    card.visible = false
    this.pendingCardReplacement = { card, outlineTexture }
  }

  /** Flips this slot in place and reveals its preloaded replacement at halfway. */
  flipToCardReplacement(duration: number): Promise<void> {
    if (!this.pendingCardReplacement) return Promise.resolve()

    this.setMulliganInteractionEnabled(false)
    this.killTweensOf(this.scale)
    const baseScaleX = this.scale.x
    const halfDuration = Math.max(0, duration) / 2
    const timeline = this.timeline()
    timeline.to(this.scale, {
      x: 0,
      duration: halfDuration,
      ease: 'power2.in'
    })
    timeline.call(() => this.commitCardReplacement())
    timeline.to(this.scale, {
      x: baseScaleX,
      duration: halfDuration,
      ease: 'power2.out'
    })

    return completeTimeline(timeline).then(() => {
      // An interrupted presentation must still settle on the authoritative
      // replacement instead of leaving a hidden pending face behind.
      if (this.pendingCardReplacement) this.commitCardReplacement()
      this.scale.x = baseScaleX
    })
  }

  /** Rebuilds a baked outline after an in-place card face replacement settles. */
  refreshPlayableOutline(): void {
    if (this.playableOutlineDisposed) return
    if (!(this.playableOutline instanceof BakedAnimatedOutline)) {
      // A hover swap left the live outline active while the bake is stale
      // from the replaced face; drop it instead of restoring it on leave.
      if (this.dormantPlayableOutline instanceof BakedAnimatedOutline) {
        this.dormantPlayableOutline.removeFromParent()
        this.dormantPlayableOutline.dispose()
        this.dormantPlayableOutline = null
      }
      return
    }
    if (!this.bakedOutlineNeedsRefresh) return

    const previous = this.playableOutline
    previous.removeFromParent()
    previous.dispose()
    const baked = new BakedAnimatedOutline(
      this.renderer,
      this.playableOutlineTexture,
      this.activeCard.plan.width,
      this.activeCard.renderedHeight,
      this.bakedOutlineDisplayScale ?? DEFAULT_HAND_LAYOUT.cardScale,
      this.playableOutlinePalette,
      this.playableOutlinePreset
    )
    baked.position.copyFrom(this.outlineTarget.position)
    baked.zIndex = this.outlineTarget.zIndex
    this.playableOutline = baked
    this.addChildAt(baked, this.getChildIndex(this.activeCard))
    this.bakedOutlineNeedsRefresh = false
    this.syncPlayableOutline()
  }

  setSelected(selected: boolean): void {
    this.replaceCross.visible = selected
    this.replacedLabel.visible = selected
  }

  setMulliganInteractionEnabled(enabled: boolean): void {
    this.eventMode = enabled ? 'static' : 'none'
    this.cursor = enabled ? 'pointer' : 'default'
  }

  setPlayableOutlineEnabled(enabled: boolean): void {
    this.playableOutlineRequested = enabled
    this.syncPlayableOutline()
  }

  /** Gives conditionally enhanced cards a more agitated outline treatment. */
  setPlayableOutlineEnhanced(enhanced: boolean): void {
    this.playableOutlinePreset = enhanced ? 'bonus-card' : 'card'
    this.playableOutlinePalette = enhanced ? 'orange' : 'green'
    if (this.playableOutlineDisposed) return
    this.applyOutlineAppearance(this.playableOutline)
    this.applyOutlineAppearance(this.dormantPlayableOutline)
  }

  /** Settled hand cards share pre-rendered shader frames instead of ten filters. */
  enableBakedPlayableOutline(displayScale: number): void {
    this.bakedOutlineDisplayScale = displayScale
    if (
      this.playableOutlineDisposed ||
      this.playableOutline instanceof BakedAnimatedOutline
    )
      return
    const baked = new BakedAnimatedOutline(
      this.renderer,
      this.playableOutlineTexture,
      this.card.plan.width,
      this.card.renderedHeight,
      displayScale,
      this.playableOutlinePalette,
      this.playableOutlinePreset
    )
    baked.position.copyFrom(this.outlineTarget.position)
    baked.zIndex = this.outlineTarget.zIndex
    this.addChildAt(baked, this.getChildIndex(this.card))
    // The live filter stays constructed but dormant: hovering swaps back to
    // it so the enlarged card keeps a crisp shader glow instead of a
    // magnified bake.
    this.dormantPlayableOutline = this.playableOutline
    this.playableOutline = baked
    this.syncPlayableOutline()
  }

  /**
   * Hovering enlarges the card, which would magnify baked outline frames.
   * Swapping to the live filter keeps the glow crisp at the hovered scale.
   */
  setOutlineLiveWhileHovered(hovered: boolean): void {
    if (this.playableOutlineDisposed || this.dormantPlayableOutline === null)
      return
    if (hovered === (this.playableOutline instanceof BakedAnimatedOutline)) {
      const active = this.playableOutline
      this.playableOutline = this.dormantPlayableOutline
      this.dormantPlayableOutline = active
      this.syncPlayableOutline()
    }
  }

  getPlayableOutlinePreset(): OutlinePresetName {
    return this.playableOutlinePreset
  }

  getPlayableOutlinePalette(): OutlinePaletteInput {
    return this.playableOutlinePalette
  }

  isPlayableOutlineEnabled(): boolean {
    return this.playableOutlineRequested
  }

  suppressPlayableOutline(suppressed: boolean): void {
    this.playableOutlineSuppressed = suppressed
    this.syncPlayableOutline()
  }

  beginMinionPlayTransition(): void {
    this.shadow.maximumHeight = Infinity
    this.setMulliganInteractionEnabled(false)
    this.replaceCross.visible = false
    this.replacedLabel.visible = false
    this.disposePlayableOutline()
    this.outlineTarget.visible = false
  }

  disposePlayableOutline(): void {
    if (this.playableOutlineDisposed) return
    this.playableOutlineDisposed = true
    this.playableOutline.removeFromParent()
    this.playableOutline.dispose()
    this.dormantPlayableOutline?.removeFromParent()
    this.dormantPlayableOutline?.dispose()
    this.dormantPlayableOutline = null
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    killDisplayTweens(this)
    this.killAnimations()
    this.discardCardReplacement()
    this.disposePlayableOutline()
    super.destroy(options)
  }

  private discardCardReplacement(): void {
    const replacement = this.pendingCardReplacement
    this.pendingCardReplacement = null
    if (!replacement || replacement.card.destroyed) return
    replacement.card.removeFromParent()
    replacement.card.destroy({ children: true })
  }

  private commitCardReplacement(): void {
    const replacement = this.pendingCardReplacement
    if (!replacement) return
    this.pendingCardReplacement = null

    const previousCard = this.activeCard
    const cardIndex = this.getChildIndex(previousCard)
    replacement.card.visible = true
    this.addChildAt(replacement.card, cardIndex)
    this.activeCard = replacement.card
    this.shadow.visual = replacement.card
    this.outlineTarget.label = `${replacement.card.label}.playable-outline-target`
    this.replacePlayableOutline(replacement.outlineTexture)

    previousCard.removeFromParent()
    previousCard.destroy({ children: true })
  }

  private replacePlayableOutline(outlineTexture: Texture): void {
    this.playableOutlineTexture = outlineTexture
    this.outlineTarget.texture = outlineTexture
    this.outlineTarget.width = this.activeCard.plan.width
    this.outlineTarget.height = this.activeCard.renderedHeight

    if (this.playableOutlineDisposed) return

    const wasBaked = this.playableOutline instanceof BakedAnimatedOutline
    if (wasBaked) {
      // Keep the already-baked silhouette visible through the short flip. The
      // replacement bake is intentionally deferred until the reveal settles.
      this.outlineTarget.visible = false
      this.bakedOutlineNeedsRefresh = true
      return
    }

    this.playableOutline.removeFromParent()
    this.playableOutline.dispose()
    this.dormantPlayableOutline?.removeFromParent()
    this.dormantPlayableOutline?.dispose()
    this.dormantPlayableOutline = null

    this.outlineTarget.visible = true
    this.playableOutline = new AnimatedOutline(this.outlineTarget, {
      palette: this.playableOutlinePalette,
      preset: this.playableOutlinePreset,
      cacheDistance: true
    })
    this.syncPlayableOutline()
  }

  private applyOutlineAppearance(
    outline: AnimatedOutline | BakedAnimatedOutline | null
  ): void {
    if (!outline) return
    if (outline instanceof BakedAnimatedOutline) {
      outline.setAppearance(this.playableOutlinePalette, this.playableOutlinePreset)
      return
    }
    outline.setPalette(this.playableOutlinePalette)
    outline.setPreset(this.playableOutlinePreset)
  }

  private syncPlayableOutline(): void {
    this.playableOutline.setEnabled(
      this.playableOutlineRequested && !this.playableOutlineSuppressed
    )
    this.dormantPlayableOutline?.setEnabled(false)
  }
}
