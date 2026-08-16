import clickCursorImage from '@assets/images/cursor/hearthstone-click.png'
import defaultCursorImage from '@assets/images/cursor/hearthstone-cursor.png'

export type CursorVariant = 'default' | 'click'

/** The source artwork is 32 CSS pixels at the default scale. */
export const CURSOR_BASE_SIZE = 32
export const DEFAULT_CURSOR_SCALE = 1
export const CURSOR_SCALE_LIMITS = {
  min: 0.5,
  max: 4
} as const

const LEFT_BUTTON = 0
const LEFT_BUTTON_MASK = 1
const CUSTOM_CURSOR_CLASS = 'custom-cursor-enabled'

interface CursorAsset {
  image: string
  hotspotX: number
  hotspotY: number
}

/**
 * Keep cursor artwork in one registry so adding a future variant only needs
 * an asset entry and a new CursorVariant value. The grab artwork is
 * intentionally not registered until drag interactions are implemented.
 *
 * The hotspots align the pointer with the visible fingertip in each 32x32
 * image. They are stored per variant so future artwork can opt into a
 * different anchor without changing the positioning code.
 */
const CURSOR_ASSETS: Record<CursorVariant, CursorAsset> = {
  default: {
    image: defaultCursorImage,
    hotspotX: 9,
    hotspotY: 0
  },
  click: {
    image: clickCursorImage,
    hotspotX: 4,
    hotspotY: 0
  }
}

export function normalizeCursorScale(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_CURSOR_SCALE

  return Math.min(CURSOR_SCALE_LIMITS.max, Math.max(CURSOR_SCALE_LIMITS.min, scale))
}

export function getCursorSize(scale: number): number {
  return CURSOR_BASE_SIZE * normalizeCursorScale(scale)
}

export function getCursorVariant(leftButtonDown: boolean): CursorVariant {
  return leftButtonDown ? 'click' : 'default'
}

/**
 * Owns the app-wide cursor visual. It deliberately lives outside scenes so a
 * scene transition cannot reset the pointer image or its pressed state.
 */
export class CursorManager {
  private readonly host: HTMLElement
  private readonly element: HTMLImageElement
  private scale = DEFAULT_CURSOR_SCALE
  private variant: CursorVariant = 'default'
  private leftButtonDown = false
  private pointerX: number | null = null
  private pointerY: number | null = null
  private mounted = false

  constructor(host: HTMLElement) {
    this.host = host
    this.element = document.createElement('img')
    this.element.className = 'game-cursor'
    this.element.alt = ''
    this.element.setAttribute('aria-hidden', 'true')
    this.element.draggable = false
    this.element.style.visibility = 'hidden'

    this.applyVariant()
    this.applyScale()
  }

  mount(): void {
    if (this.mounted) return

    this.mounted = true
    this.host.classList.add(CUSTOM_CURSOR_CLASS)
    this.host.appendChild(this.element)

    // Capture at the window level so Pixi's own event handling cannot prevent
    // the global cursor state from receiving a release outside an actor.
    window.addEventListener('pointermove', this.onPointerMove, true)
    window.addEventListener('pointerdown', this.onPointerDown, true)
    window.addEventListener('pointerup', this.onPointerUp, true)
    window.addEventListener('pointercancel', this.onPointerCancel, true)
    window.addEventListener('blur', this.onWindowBlur)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
  }

  destroy(): void {
    if (!this.mounted) return

    window.removeEventListener('pointermove', this.onPointerMove, true)
    window.removeEventListener('pointerdown', this.onPointerDown, true)
    window.removeEventListener('pointerup', this.onPointerUp, true)
    window.removeEventListener('pointercancel', this.onPointerCancel, true)
    window.removeEventListener('blur', this.onWindowBlur)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)

    this.host.classList.remove(CUSTOM_CURSOR_CLASS)
    this.element.remove()
    this.element.style.visibility = 'hidden'
    this.leftButtonDown = false
    this.setVariant(getCursorVariant(this.leftButtonDown))
    this.mounted = false
  }

  /**
   * Updates the shared size of every cursor variant.
   *
   * The future game settings slider should call this method with its chosen
   * scale. Since the size is applied here, the setting will automatically
   * affect default, click, and any later cursor variants.
   */
  setScale(scale: number): void {
    this.scale = normalizeCursorScale(scale)
    this.applyScale()
    this.updatePosition()
  }

  getScale(): number {
    return this.scale
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.isInsideHost(event)) {
      // A missed pointerup can otherwise leave the pressed artwork active;
      // only clear it once the browser reports that the button is no longer
      // held, so dragging outside the window still preserves the pressed
      // state while the button remains down.
      if (this.leftButtonDown && (event.buttons & LEFT_BUTTON_MASK) === 0) {
        this.releaseLeftButton()
      }
      this.hide()
      return
    }

    this.setPointerPosition(event.clientX, event.clientY)

    // This is a defensive fallback for platform/window transitions where a
    // pointerup event is not delivered to the renderer.
    if (this.leftButtonDown && (event.buttons & LEFT_BUTTON_MASK) === 0) {
      this.releaseLeftButton()
    }

    this.show()
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== LEFT_BUTTON || !this.isInsideHost(event)) return

    this.leftButtonDown = true
    this.setVariant(getCursorVariant(this.leftButtonDown))
    this.setPointerPosition(event.clientX, event.clientY)
    this.show()
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (event.button !== LEFT_BUTTON) return
    this.releaseLeftButton()
  }

  private onPointerCancel = (): void => {
    this.releaseLeftButton()
  }

  private onWindowBlur = (): void => {
    this.releaseLeftButton()
    this.hide()
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') {
      this.releaseLeftButton()
      this.hide()
    }
  }

  private releaseLeftButton(): void {
    if (!this.leftButtonDown) return

    this.leftButtonDown = false
    this.setVariant(getCursorVariant(this.leftButtonDown))
  }

  private isInsideHost(event: Event): boolean {
    const target = event.target
    return target instanceof Node && this.host.contains(target)
  }

  private setVariant(variant: CursorVariant): void {
    if (this.variant === variant) return

    this.variant = variant
    this.applyVariant()
    this.updatePosition()
  }

  private applyVariant(): void {
    this.element.src = CURSOR_ASSETS[this.variant].image
  }

  private applyScale(): void {
    const size = getCursorSize(this.scale)
    this.element.style.width = `${size}px`
    this.element.style.height = `${size}px`
  }

  private setPointerPosition(clientX: number, clientY: number): void {
    this.pointerX = clientX
    this.pointerY = clientY
    this.updatePosition()
  }

  private updatePosition(): void {
    if (this.pointerX === null || this.pointerY === null) return

    const asset = CURSOR_ASSETS[this.variant]
    this.element.style.left = `${this.pointerX - asset.hotspotX * this.scale}px`
    this.element.style.top = `${this.pointerY - asset.hotspotY * this.scale}px`
  }

  private show(): void {
    this.element.style.visibility = 'visible'
  }

  private hide(): void {
    this.element.style.visibility = 'hidden'
  }
}
