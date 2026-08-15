import { Container, Texture, Sprite, ColorMatrixFilter } from 'pixi.js'
import { gsap } from 'gsap'

export interface ButtonOptions {
  pressedScale?: number
  idleBrightness?: number
  hoverBrightness?: number
  pressedBrightness?: number
  sinkPx?: number
  onClick?: () => void
}

/**
 * A single-texture button with two code-driven states:
 *  - hover: brightness lifted only (no resize) via GSAP
 *  - pressed: brightness dimmed, scale shrinks, and the sprite sinks
 *            downward a few pixels to read as occluded into the surface.
 */
export class Button extends Container {
  readonly sprite: Sprite
  private readonly pressedScale: number
  private readonly idleBrightness: number
  private readonly hoverBrightness: number
  private readonly pressedBrightness: number
  private readonly sinkPx: number
  private readonly myFilter = new ColorMatrixFilter()
  private baseY: number
  private readonly onClick?: () => void

  constructor(texture: Texture, options: ButtonOptions = {}) {
    super()

    this.pressedScale = options.pressedScale ?? 0.95
    this.idleBrightness = options.idleBrightness ?? 1
    this.hoverBrightness = options.hoverBrightness ?? 1.15
    this.pressedBrightness = options.pressedBrightness ?? 0.8
    this.sinkPx = options.sinkPx ?? 6
    this.onClick = options.onClick

    this.sprite = new Sprite(texture)
    this.sprite.anchor.set(0.5)
    this.sprite.position.set(0, 0)
    this.sprite.filters = [this.myFilter]
    this.addChild(this.sprite)

    this.baseY = 0

    this.eventMode = 'static'
    this.cursor = 'pointer'

    this.on('pointerover', this.onHoverStart)
    this.on('pointerout', this.onHoverEnd)
    this.on('pointerdown', this.onPressStart)
    this.on('pointerup', this.onPressEnd)
    this.on('pointerupoutside', this.onPressEnd)
    this.on('pointertap', this.handleClick)
  }

  setBaseY(y: number): void {
    this.baseY = y
  }

  getBaseY(): number {
    return this.baseY
  }

  private setBrightness(brightness: number): void {
    this.myFilter.brightness(brightness, false)
  }

  private tweenBrightness(to: number, duration: number): void {
    const from = { value: this.idleBrightness }
    gsap.to(from, {
      value: to,
      duration,
      ease: 'power2.out',
      onUpdate: () => this.setBrightness(from.value)
    })
  }

  private onHoverStart = (): void => {
    this.tweenBrightness(this.hoverBrightness, 0.15)
  }

  private onHoverEnd = (): void => {
    this.tweenBrightness(this.idleBrightness, 0.15)
  }

  private onPressStart = (): void => {
    gsap.to(this.sprite.scale, {
      x: this.pressedScale,
      y: this.pressedScale,
      duration: 0.08,
      ease: 'power2.out'
    })
    this.tweenBrightness(this.pressedBrightness, 0.08)
    gsap.to(this, {
      y: this.baseY + this.sinkPx,
      duration: 0.08,
      ease: 'power2.out'
    })
  }

  private onPressEnd = (): void => {
    gsap.to(this.sprite.scale, {
      x: 1,
      y: 1,
      duration: 0.12,
      ease: 'power2.out'
    })
    this.tweenBrightness(this.hoverBrightness, 0.12)
    gsap.to(this, {
      y: this.baseY,
      duration: 0.12,
      ease: 'power2.out'
    })
  }

  private handleClick = (): void => {
    this.onClick?.()
  }
}