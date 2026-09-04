import {
  Container,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent
} from 'pixi.js'
import type { LayoutPlacement, LayoutPoint } from '../../rendering/layout'
import { AnimatedOutline } from '../../rendering/effects/animated-outline'
import {
  HERO_POWER_ICON_CANVAS,
  HeroPowerIconView
} from '../../rendering/hero-powers/hero-power-presentation'
import { Actor } from '../../ui/components/actor'

/** Feature-local flip timing for the hero power reveal/exhaust animations. */
const FLIP_TIMING = {
  /** First half of the flip: the current face turns edge-on. */
  close: 0.1,
  /** Second half: the other face opens up. */
  open: 0.2
} as const

/** Matches the main-menu centerpiece's 400 ms horizontal identity flip. */
const REPLACEMENT_FLIP_TIMING = {
  close: 0.2,
  open: 0.2
} as const

const UNAVAILABLE_SHAKE = {
  distance: 8,
  duration: 0.24
} as const

const COST_LABEL_STYLE = {
  fontFamily: 'Belwe',
  fontSize: 32,
  fill: 0xffffff,
  stroke: { color: 0x17120f, width: 5 },
  align: 'center'
} as const

/**
 * Cost label tints.
 *
 * Future cards may change the hero power's cost: when a future effect makes it
 * cheaper the label should turn green, and when it makes it more expensive it
 * should turn red. The engine already exposes the effective cost in
 * `PlayerHeroPower.cost`, so rendering these tints is all a future effect
 * needs. Today the cost is always the class default, so the label stays white.
 */
export type HeroPowerCostColor = 'normal' | 'reduced' | 'increased'

const COST_COLOR_VALUES: Record<HeroPowerCostColor, number> = {
  normal: 0xffffff,
  reduced: 0x6cff47,
  increased: 0xff4a4a
}

/** Geometry for one hero power card: placement plus the cost gem overlay. */
export interface HeroPowerLayout {
  /** Where the card sits on the 1920x1080 canvas (both faces anchor here). */
  readonly card: LayoutPlacement
  /** Cost gem center, relative to the card center. */
  readonly crystalOffset: LayoutPoint
  /** Cost label center, relative to the crystal center. */
  readonly costOffset: LayoutPoint
}

export interface HeroPowerViewOptions {
  readonly layout: HeroPowerLayout
  readonly backTexture: Texture
  readonly frontFrameTexture: Texture
  readonly artworkTexture: Texture
  readonly manaTexture: Texture
  /** Effective cost shown on the up face (the engine's `PlayerHeroPower.cost`). */
  readonly cost: number
  /** Starts an optional drag-targeting gesture while the power is enabled. */
  readonly onPointerDown?: (event: FederatedPointerEvent) => void
  /** Left-click action; the view only emits it while enabled. */
  readonly onClick?: (event: FederatedPointerEvent) => void
}

/**
 * One player's hero power card on the board. It starts on the class front.
 * While facing up it renders the cost gem: the mana crystal slightly above the card center plus a
 * labelled cost. While the local player's turn is active, the power is still
 * available, and the local mana can afford it, the card is clickable and
 * wears the green playable outline; clicking hands the action back to the
 * caller (the engine then consumes the mana and the view flips down). The
 * remote card is never clickable and never wears the outline.
 */
export class HeroPowerView extends Actor {
  readonly card: Container
  private readonly frontFace: HeroPowerIconView
  private readonly backFace: Sprite
  private readonly manaCrystal: Sprite
  private readonly costLabel: Text
  private readonly playableOutline: AnimatedOutline
  private readonly outlineTarget: HeroPowerIconView
  private readonly baseScaleX: number
  private readonly interactionRect: Rectangle
  private readonly onPointerDown?: (event: FederatedPointerEvent) => void
  private readonly onClick?: (event: FederatedPointerEvent) => void
  private interactivityEnabled = false
  private facingUp = true

  constructor(options: HeroPowerViewOptions) {
    super()
    this.onPointerDown = options.onPointerDown
    this.onClick = options.onClick
    this.label = 'hero-power'
    this.eventMode = 'none'
    this.cursor = 'default'

    const cardPlacement = options.layout.card
    const cardCenterX = cardPlacement.position.x
    const cardCenterY = cardPlacement.position.y
    // The card's anchor is normalized; the clickable zone and the cost gem must
    // be placed relative to the card sprite's own origin, which sits at
    // `cardPlacement.position` in this view's local space.
    const cardWidth = cardPlacement.size.width * (cardPlacement.scale?.x ?? 1)
    const cardHeight = cardPlacement.size.height * (cardPlacement.scale?.y ?? 1)
    const cardLeft = cardCenterX - cardWidth * cardPlacement.anchor.x
    const cardTop = cardCenterY - cardHeight * cardPlacement.anchor.y
    this.interactionRect = new Rectangle(cardLeft, cardTop, cardWidth, cardHeight)
    this.hitArea = this.interactionRect

    // The playable-outline silhouette: a static copy of the front face behind
    // the flipping card, exactly like the hand cards' playable outlines.
    this.outlineTarget = new HeroPowerIconView(
      options.artworkTexture,
      options.frontFrameTexture
    )
    this.outlineTarget.pivot.set(
      HERO_POWER_ICON_CANVAS.width * cardPlacement.anchor.x,
      HERO_POWER_ICON_CANVAS.height * cardPlacement.anchor.y
    )
    this.outlineTarget.position.set(cardCenterX, cardCenterY)
    this.outlineTarget.scale.set(
      cardPlacement.scale?.x ?? 1,
      cardPlacement.scale?.y ?? 1
    )
    this.outlineTarget.eventMode = 'none'
    this.outlineTarget.label = 'hero-power-outline-target'
    this.addChild(this.outlineTarget)
    this.playableOutline = new AnimatedOutline(this.outlineTarget, 'green', 'board')
    this.playableOutline.setEnabled(false)

    this.card = new Container()
    this.card.position.set(cardCenterX, cardCenterY)
    this.card.scale.set(cardPlacement.scale?.x ?? 1, cardPlacement.scale?.y ?? 1)
    this.card.eventMode = 'none'
    this.card.label = 'hero-power-face'
    this.frontFace = new HeroPowerIconView(
      options.artworkTexture,
      options.frontFrameTexture
    )
    this.frontFace.pivot.set(
      HERO_POWER_ICON_CANVAS.width * cardPlacement.anchor.x,
      HERO_POWER_ICON_CANVAS.height * cardPlacement.anchor.y
    )
    this.backFace = new Sprite(options.backTexture)
    this.backFace.anchor.set(cardPlacement.anchor.x, cardPlacement.anchor.y)
    this.backFace.visible = false
    this.backFace.eventMode = 'none'
    this.backFace.label = 'hero-power-back'
    this.card.addChild(this.frontFace, this.backFace)
    this.addChild(this.card)
    this.baseScaleX = this.card.scale.x

    this.manaCrystal = new Sprite(options.manaTexture)
    this.manaCrystal.anchor.set(0.5)
    this.manaCrystal.position.set(
      cardCenterX + options.layout.crystalOffset.x,
      cardCenterY + options.layout.crystalOffset.y - 10
    )
    this.manaCrystal.visible = true
    this.manaCrystal.eventMode = 'none'
    this.manaCrystal.label = 'hero-power-mana'
    this.addChild(this.manaCrystal)

    this.costLabel = new Text({ text: '', style: COST_LABEL_STYLE })
    this.costLabel.anchor.set(0.5)
    this.costLabel.position.set(
      cardCenterX + options.layout.crystalOffset.x + options.layout.costOffset.x,
      cardCenterY + options.layout.crystalOffset.y + options.layout.costOffset.y - 15
    )
    this.costLabel.visible = true
    this.costLabel.eventMode = 'none'
    this.costLabel.label = 'hero-power-cost'
    this.addChild(this.costLabel)

    this.setCost(options.cost)
    this.setCostColor('normal')
    this.setEnabled(false)
    this.on('pointerdown', this.handlePointerDown)
    this.on('pointertap', this.handleClick)
  }

  /** Refreshes the displayed cost; the future home of cost-changing effects. */
  setCost(cost: number): void {
    this.costLabel.text = String(cost)
  }

  /** Replaces the visible hero-power face without changing its used/up state. */
  setArtwork(texture: Texture): void {
    this.frontFace.setArtwork(texture)
    this.outlineTarget.setArtwork(texture)
  }

  /** Replaces this power through a horizontal flip and refreshes it face-up. */
  replaceArtwork(texture: Texture): Promise<void> {
    const restoreEnabled = this.interactivityEnabled
    this.setEnabled(false)
    this.killTweensOf(this.card.scale)
    const timeline = this.timeline()
    let swapped = false
    const applyReplacement = (): void => {
      if (swapped) return
      swapped = true
      this.setArtwork(texture)
      this.facingUp = true
      this.frontFace.visible = true
      this.backFace.visible = false
      this.manaCrystal.visible = true
      this.costLabel.visible = true
    }
    timeline.to(this.card.scale, {
      x: 0,
      duration: REPLACEMENT_FLIP_TIMING.close,
      ease: 'power2.in'
    })
    timeline.call(applyReplacement)
    timeline.to(this.card.scale, {
      x: this.baseScaleX,
      duration: REPLACEMENT_FLIP_TIMING.open,
      ease: 'power2.out'
    })
    return this.completeTimeline(timeline, () => {
      applyReplacement()
      this.card.scale.x = this.baseScaleX
      this.setEnabled(restoreEnabled)
      this.syncPlayableOutline()
    })
  }

  /**
   * Tints the cost label. Today the cost is always the class default, so the
   * label stays `normal` (white); future cost-changing effects should call
   * `reduced` (green) or `increased` (red).
   */
  setCostColor(color: HeroPowerCostColor): void {
    this.costLabel.style.fill = COST_COLOR_VALUES[color]
  }

  /**
   * Enables or disables local interaction. The card is clickable only while
   * the local player's turn is active, the power is still available, and the
   * local player can afford its cost. The green playable outline follows the
   * same condition and additionally requires the card to be facing up.
   */
  setEnabled(enabled: boolean): void {
    if (this.interactivityEnabled === enabled) return
    this.interactivityEnabled = enabled
    this.eventMode = enabled ? 'static' : 'none'
    this.cursor = enabled ? 'pointer' : 'default'
    this.syncPlayableOutline()
  }

  /**
   * True when a point in this view's local 1920x1080 canvas falls on the card
   * face. The hand layer uses this to leave the hero power's hit area exposed.
   */
  containsCanvasPoint(x: number, y: number): boolean {
    return (
      x >= this.interactionRect.x &&
      x <= this.interactionRect.x + this.interactionRect.width &&
      y >= this.interactionRect.y &&
      y <= this.interactionRect.y + this.interactionRect.height
    )
  }

  /** Flips the card to the class front face and reveals the cost gem. */
  flipUp(): Promise<void> {
    if (this.facingUp) return Promise.resolve()
    return this.flipTo(true)
  }

  /** Flips the card to the back face and hides the cost gem. */
  flipDown(): Promise<void> {
    if (!this.facingUp) return Promise.resolve()
    return this.flipTo(false)
  }

  /** A brief horizontal wobble when the click was rejected. */
  playUnavailable(): void {
    const baseX = this.card.position.x
    const steps = 5
    const stepDuration = UNAVAILABLE_SHAKE.duration / (steps * 2)
    this.killTweensOf(this.card.position)
    const timeline = this.timeline()
    for (let i = 0; i < steps; i += 1) {
      const direction = i % 2 === 0 ? 1 : -1
      timeline.to(this.card.position, {
        x: baseX + direction * UNAVAILABLE_SHAKE.distance,
        duration: stepDuration,
        ease: 'power1.inOut'
      })
      timeline.to(this.card.position, {
        x: baseX - direction * UNAVAILABLE_SHAKE.distance,
        duration: stepDuration,
        ease: 'power1.inOut'
      })
    }
    timeline.to(this.card.position, { x: baseX, duration: stepDuration })
  }

  /**
   * Classic two-half flip: the current face turns edge-on (the sprite's x
   * scale collapses), the face and the cost gem swap, then the new face opens
   * up. A flip that starts while one is running drops the previous flip.
   */
  private flipTo(showMana: boolean): Promise<void> {
    this.facingUp = showMana
    this.killTweensOf(this.card.scale)
    const timeline = this.timeline()
    timeline.to(this.card.scale, {
      x: 0,
      duration: FLIP_TIMING.close,
      ease: 'power2.in'
    })
    timeline.call(() => {
      this.frontFace.visible = showMana
      this.backFace.visible = !showMana
      this.manaCrystal.visible = showMana
      this.costLabel.visible = showMana
    })
    timeline.to(this.card.scale, {
      x: this.baseScaleX,
      duration: FLIP_TIMING.open,
      ease: 'power2.out'
    })
    return this.completeTimeline(timeline, () => this.syncPlayableOutline())
  }

  private syncPlayableOutline(): void {
    this.playableOutline.setEnabled(this.interactivityEnabled && this.facingUp)
  }

  private handlePointerDown = (event: FederatedPointerEvent): void => {
    if (!this.interactivityEnabled || event.button !== 0 || !this.facingUp) return
    event.stopPropagation()
    this.onPointerDown?.(event)
  }

  private handleClick = (event: FederatedPointerEvent): void => {
    if (!this.interactivityEnabled || event.button !== 0 || !this.facingUp) return
    event.stopPropagation()
    this.onClick?.(event)
  }

  private completeTimeline(
    timeline: gsap.core.Timeline,
    onComplete?: () => void
  ): Promise<void> {
    return new Promise((resolve) => {
      timeline.eventCallback('onComplete', () => {
        onComplete?.()
        resolve()
      })
      timeline.eventCallback('onInterrupt', () => {
        onComplete?.()
        resolve()
      })
    })
  }

  override dispose(): void {
    this.playableOutline.dispose()
    super.dispose()
  }
}
