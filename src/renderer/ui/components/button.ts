import { ColorMatrixFilter, Sprite, Texture } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import { Actor } from './actor'

const DEFAULT_HOVER_BRIGHTNESS = 1.5
const DEFAULT_VERTICAL_FLIP_DURATION = 0.32

export interface ButtonOptions {
  pressedScale?: number
  /** Keep the left edge in place while the button scales down. */
  pressFromLeft?: boolean
  idleBrightness?: number
  highlightOnHover?: boolean
  hoverBrightness?: number
  pressedBrightness?: number
  sinkPx?: number
  onClick?: () => void | Promise<void>
  onError?: (error: unknown) => void
}

/** A single-texture button with scoped hover and pressed animations. */
export class Button extends Actor {
  readonly sprite: Sprite
  private readonly pressedScale: number
  private readonly pressFromLeft: boolean
  private readonly idleBrightness: number
  private readonly highlightOnHover: boolean
  private readonly hoverBrightness: number
  private readonly pressedBrightness: number
  private readonly sinkPx: number
  private readonly myFilter = new ColorMatrixFilter()
  private readonly brightnessState = { value: 1 }
  private baseY = 0
  private hovered = false
  private pressed = false
  private enabled = true
  private interactionEnabled = true
  private flippingTexture = false
  private pendingTexture: Texture | null = null
  private textureFlipPromise: Promise<void> | null = null
  private readonly onClick?: () => void | Promise<void>
  private readonly onError?: (error: unknown) => void

  constructor(texture: Texture, options: ButtonOptions = {}) {
    super()

    this.pressedScale = options.pressedScale ?? 0.95
    this.pressFromLeft = options.pressFromLeft ?? false
    this.idleBrightness = options.idleBrightness ?? 1
    this.highlightOnHover = options.highlightOnHover ?? true
    this.hoverBrightness = options.hoverBrightness ?? DEFAULT_HOVER_BRIGHTNESS
    this.pressedBrightness = options.pressedBrightness ?? 0.8
    this.sinkPx = options.sinkPx ?? 0
    this.onClick = options.onClick
    this.onError = options.onError
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
    this.syncInteractionState()
  }

  /** True while a texture face is collapsing or opening vertically. */
  isTextureFlipping(): boolean {
    return this.flippingTexture
  }

  /**
   * Swaps to a new texture through a top-to-bottom card flip. Requests received
   * mid-flip are coalesced so the last requested face is the one that settles.
   */
  flipTextureVertically(
    texture: Texture,
    duration: number = DEFAULT_VERTICAL_FLIP_DURATION
  ): Promise<void> {
    this.pendingTexture = texture
    if (this.textureFlipPromise) return this.textureFlipPromise
    if (this.sprite.texture === texture) {
      this.pendingTexture = null
      return Promise.resolve()
    }

    const promise = this.runTextureFlip(Math.max(0, duration))
    this.textureFlipPromise = promise
    void promise.finally(() => {
      if (this.textureFlipPromise === promise) this.textureFlipPromise = null
    })
    return promise
  }

  private syncInteractionState(): void {
    const enabled = this.enabled && !this.flippingTexture
    if (this.interactionEnabled === enabled) return
    this.interactionEnabled = enabled
    this.eventMode = enabled ? 'static' : 'none'
    this.cursor = enabled ? 'pointer' : 'default'

    if (!enabled) {
      this.hovered = false
      this.pressed = false
      this.killTweensOf(this.sprite.scale)
      if (this.pressFromLeft) this.killTweensOf(this.sprite)
      this.killTweensOf(this)
      this.killTweensOf(this.brightnessState)
      this.sprite.scale.set(1)
      if (this.pressFromLeft) this.sprite.x = 0
      this.y = this.baseY
      this.setBrightness(this.idleBrightness)
    }
  }

  private async runTextureFlip(duration: number): Promise<void> {
    this.flippingTexture = true
    this.syncInteractionState()
    try {
      while (this.pendingTexture && this.pendingTexture !== this.sprite.texture) {
        const target = this.pendingTexture
        this.pendingTexture = null
        await this.flipToTexture(target, duration)
      }
    } finally {
      this.flippingTexture = false
      this.pendingTexture = null
      this.sprite.scale.y = 1
      this.syncInteractionState()
    }
  }

  private flipToTexture(texture: Texture, duration: number): Promise<void> {
    const halfDuration = duration / 2
    return new Promise((resolve) => {
      let completed = false
      const finish = (): void => {
        if (completed) return
        completed = true
        this.sprite.scale.y = 1
        resolve()
      }

      this.tweenTo(this.sprite.scale, {
        y: 0,
        duration: halfDuration,
        ease: 'power2.in',
        onComplete: () => {
          this.sprite.texture = texture
          this.tweenTo(this.sprite.scale, {
            y: 1,
            duration: halfDuration,
            ease: 'power2.out',
            onComplete: finish,
            onInterrupt: finish
          })
        },
        onInterrupt: finish
      })
    })
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
    if (!this.interactionEnabled) return
    this.hovered = true
    if (!this.pressed && this.highlightOnHover) {
      this.tweenBrightness(this.hoverBrightness, 0.15)
    }
  }

  private onHoverEnd = (): void => {
    if (!this.interactionEnabled) return
    this.hovered = false
    if (!this.pressed && this.highlightOnHover) {
      this.tweenBrightness(this.idleBrightness, 0.15)
    }
  }

  private onPressStart = (event: FederatedPointerEvent): void => {
    if (!this.interactionEnabled || event.button !== 0) return
    this.pressed = true
    this.killTweensOf(this.sprite.scale)
    if (this.pressFromLeft) this.killTweensOf(this.sprite)
    this.killTweensOf(this)
    this.tweenTo(this.sprite.scale, {
      x: this.pressedScale,
      y: this.pressedScale,
      duration: 0.08,
      ease: 'power2.out'
    })
    if (this.pressFromLeft) {
      this.tweenTo(this.sprite, {
        x: (-this.sprite.texture.width * (1 - this.pressedScale)) / 2,
        duration: 0.08,
        ease: 'power2.out'
      })
    }
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
    if (!this.interactionEnabled) return
    this.pressed = false
    this.killTweensOf(this.sprite.scale)
    if (this.pressFromLeft) this.killTweensOf(this.sprite)
    this.killTweensOf(this)
    this.tweenTo(this.sprite.scale, {
      x: 1,
      y: 1,
      duration: 0.12,
      ease: 'power2.out'
    })
    if (this.pressFromLeft) {
      this.tweenTo(this.sprite, {
        x: 0,
        duration: 0.12,
        ease: 'power2.out'
      })
    }
    this.tweenBrightness(
      this.highlightOnHover && this.hovered
        ? this.hoverBrightness
        : this.idleBrightness,
      0.12
    )
    this.tweenTo(this, {
      y: this.baseY,
      duration: 0.12,
      ease: 'power2.out'
    })
  }

  private handleClick = (event: FederatedPointerEvent): void => {
    // Pixi dispatches pointertap for right mouse clicks as well as rightclick.
    // Buttons with a right-click action must not also run their left-click action.
    if (!this.interactionEnabled || event.button !== 0) return

    const result = this.onClick?.()
    if (result) {
      void Promise.resolve(result).catch((error: unknown) => {
        this.onError?.(error)
      })
    }
  }
}
