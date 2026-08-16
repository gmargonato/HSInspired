import { ColorMatrixFilter, Sprite, Texture } from 'pixi.js'
import { Actor } from './Actor'

export interface ButtonOptions {
  pressedScale?: number
  idleBrightness?: number
  hoverBrightness?: number
  pressedBrightness?: number
  sinkPx?: number
  onClick?: () => void | Promise<void>
}

/** A single-texture button with scoped hover and pressed animations. */
export class Button extends Actor {
  readonly sprite: Sprite
  private readonly pressedScale: number
  private readonly idleBrightness: number
  private readonly hoverBrightness: number
  private readonly pressedBrightness: number
  private readonly sinkPx: number
  private readonly myFilter = new ColorMatrixFilter()
  private readonly brightnessState = { value: 1 }
  private baseY = 0
  private hovered = false
  private pressed = false
  private enabled = true
  private readonly onClick?: () => void | Promise<void>

  constructor(texture: Texture, options: ButtonOptions = {}) {
    super()

    this.pressedScale = options.pressedScale ?? 0.95
    this.idleBrightness = options.idleBrightness ?? 1
    this.hoverBrightness = options.hoverBrightness ?? 1.15
    this.pressedBrightness = options.pressedBrightness ?? 0.8
    this.sinkPx = options.sinkPx ?? 6
    this.onClick = options.onClick
    this.brightnessState.value = this.idleBrightness

    this.sprite = new Sprite(texture)
    this.sprite.anchor.set(0.5)
    this.sprite.position.set(0, 0)
    this.sprite.filters = [this.myFilter]
    this.addChild(this.sprite)
    this.setBrightness(this.idleBrightness)

    this.eventMode = 'static'
    this.cursor = 'pointer'

    this.on('pointerover', this.onHoverStart)
    this.on('pointerout', this.onHoverEnd)
    this.on('pointerdown', this.onPressStart)
    this.on('pointerup', this.onPressEnd)
    this.on('pointerupoutside', this.onPressOutside)
    this.on('pointercancel', this.onPressOutside)
    this.on('pointertap', this.handleClick)
  }

  setBaseY(y: number): void {
    this.baseY = y
  }

  getBaseY(): number {
    return this.baseY
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.eventMode = enabled ? 'static' : 'none'
    this.cursor = enabled ? 'pointer' : 'default'

    if (!enabled) {
      this.hovered = false
      this.pressed = false
      this.killTweensOf(this.sprite.scale)
      this.killTweensOf(this)
      this.killTweensOf(this.brightnessState)
      this.sprite.scale.set(1)
      this.y = this.baseY
      this.setBrightness(this.idleBrightness)
    }
  }

  private setBrightness(brightness: number): void {
    this.myFilter.brightness(brightness, false)
  }

  private tweenBrightness(to: number, duration: number): void {
    this.killTweensOf(this.brightnessState)
    this.tweenTo(this.brightnessState, {
      value: to,
      duration,
      ease: 'power2.out',
      onUpdate: () => this.setBrightness(this.brightnessState.value)
    })
  }

  private onHoverStart = (): void => {
    if (!this.enabled) return
    this.hovered = true
    if (!this.pressed) this.tweenBrightness(this.hoverBrightness, 0.15)
  }

  private onHoverEnd = (): void => {
    if (!this.enabled) return
    this.hovered = false
    if (!this.pressed) this.tweenBrightness(this.idleBrightness, 0.15)
  }

  private onPressStart = (): void => {
    if (!this.enabled) return
    this.pressed = true
    this.killTweensOf(this.sprite.scale)
    this.killTweensOf(this)
    this.tweenTo(this.sprite.scale, {
      x: this.pressedScale,
      y: this.pressedScale,
      duration: 0.08,
      ease: 'power2.out'
    })
    this.tweenBrightness(this.pressedBrightness, 0.08)
    this.tweenTo(this, {
      y: this.baseY + this.sinkPx,
      duration: 0.08,
      ease: 'power2.out'
    })
  }

  private onPressEnd = (): void => {
    this.endPress()
  }

  private onPressOutside = (): void => {
    this.hovered = false
    this.endPress()
  }

  private endPress(): void {
    if (!this.enabled) return
    this.pressed = false
    this.killTweensOf(this.sprite.scale)
    this.killTweensOf(this)
    this.tweenTo(this.sprite.scale, {
      x: 1,
      y: 1,
      duration: 0.12,
      ease: 'power2.out'
    })
    this.tweenBrightness(
      this.hovered ? this.hoverBrightness : this.idleBrightness,
      0.12
    )
    this.tweenTo(this, {
      y: this.baseY,
      duration: 0.12,
      ease: 'power2.out'
    })
  }

  private handleClick = (): void => {
    if (!this.enabled) return

    const result = this.onClick?.()
    if (result) {
      void Promise.resolve(result).catch((error: unknown) => {
        console.error('Button action failed:', error)
      })
    }
  }
}
