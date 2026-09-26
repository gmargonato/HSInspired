import { Container, Rectangle, Sprite, Texture, type Renderer } from 'pixi.js'
import { CardView } from '../../rendering/cards/card-view'
import {
  AnimatedOutline,
  type OutlinePaletteInput,
  type OutlinePresetName,
  type OutlineTuning
} from '../../rendering/effects/animated-outline'
import { DEFAULT_HAND_LAYOUT } from './hand-layout'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import { attachShadow, type ShadowCaster } from '../../rendering/shadows/shadow-caster'
import { MATCH_SHADOW_CONFIG } from '../../rendering/shadows/match-shadow-config'
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
  private playableOutline: AnimatedOutline
  private readonly outlineTarget: Sprite
  private playableOutlineDisposed = false
  private readonly replaceCross: Sprite
  private readonly replacedLabel: Sprite
  private pendingCardReplacement: PendingCardReplacement | null = null
  private playableOutlineRequested = false
  private playableOutlineSuppressed = false
  private playableOutlinePreset: OutlinePresetName = 'card'
  private playableOutlinePalette: OutlinePaletteInput = 'green'
  private playableOutlineTuning?: OutlineTuning

  constructor(
    card: CardView,
    instanceId: string,
    replaceCrossTexture: Texture,
    replacedLabelTexture: Texture,
    outlineTexture: Texture,
    _renderer: Renderer
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
  }

  getPlayableOutlinePreset(): OutlinePresetName {
    return this.playableOutlinePreset
  }

  /** Instance-local appearance for previews; never changes the production registry. */
  setPlayableOutlineAppearance(
    palette: OutlinePaletteInput,
    tuning: OutlineTuning
  ): void {
    this.playableOutlinePalette = palette
    this.playableOutlineTuning = tuning
    this.applyOutlineAppearance(this.playableOutline)
  }

  getPlayableOutlineTuning(): OutlineTuning | undefined {
    return this.playableOutlineTuning
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

  beginMinionPlayTransition({
    reversible = false
  }: { reversible?: boolean } = {}): void {
    this.shadow.maximumHeight = Infinity
    this.setMulliganInteractionEnabled(false)
    this.replaceCross.visible = false
    this.replacedLabel.visible = false
    // Targeting previews can return this same slot to the hand.
    if (reversible) this.suppressPlayableOutline(true)
    else {
      this.disposePlayableOutline()
      this.outlineTarget.visible = false
    }
  }

  disposePlayableOutline(): void {
    if (this.playableOutlineDisposed) return
    this.playableOutlineDisposed = true
    this.playableOutline.removeFromParent()
    this.playableOutline.dispose()
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

    this.playableOutline.removeFromParent()
    this.playableOutline.dispose()

    this.outlineTarget.visible = true
    this.playableOutline = new AnimatedOutline(this.outlineTarget, {
      palette: this.playableOutlinePalette,
      preset: this.playableOutlinePreset,
      cacheDistance: true
    })
    this.applyOutlineAppearance(this.playableOutline)
    this.syncPlayableOutline()
  }

  private applyOutlineAppearance(outline: AnimatedOutline | null): void {
    if (!outline) return
    outline.setPalette(this.playableOutlinePalette)
    outline.setPreset(this.playableOutlinePreset)
    if (this.playableOutlineTuning) outline.setTuning(this.playableOutlineTuning)
  }

  private syncPlayableOutline(): void {
    this.playableOutline.setEnabled(
      this.playableOutlineRequested && !this.playableOutlineSuppressed
    )
  }
}
