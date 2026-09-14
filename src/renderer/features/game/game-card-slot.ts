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

export class GameCardSlot extends Container {
  readonly shadow: ShadowCaster
  readonly card: CardView
  readonly instanceId: string
  readonly playableOutlineTexture: Texture
  private playableOutline: AnimatedOutline | BakedAnimatedOutline
  private readonly outlineTarget: Sprite
  private playableOutlineDisposed = false
  private readonly replaceCross: Sprite
  private readonly replacedLabel: Sprite
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
    this.card = card
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
    if (this.playableOutline instanceof BakedAnimatedOutline) {
      this.playableOutline.setAppearance(
        this.playableOutlinePalette,
        this.playableOutlinePreset
      )
      return
    }
    this.playableOutline.setPalette(this.playableOutlinePalette)
    this.playableOutline.setPreset(this.playableOutlinePreset)
  }

  /** Settled hand cards share pre-rendered shader frames instead of ten filters. */
  enableBakedPlayableOutline(displayScale: number): void {
    if (
      this.playableOutlineDisposed ||
      this.playableOutline instanceof BakedAnimatedOutline
    )
      return
    this.playableOutline.dispose()
    this.outlineTarget.visible = false
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
    this.playableOutline = baked
    this.syncPlayableOutline()
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
    this.playableOutline.dispose()
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.disposePlayableOutline()
    super.destroy(options)
  }

  private syncPlayableOutline(): void {
    this.playableOutline.setEnabled(
      this.playableOutlineRequested && !this.playableOutlineSuppressed
    )
  }
}
