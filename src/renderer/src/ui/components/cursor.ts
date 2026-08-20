import defaultCursorImage from '@assets/images/cursor/cursor-base.png'
import clickCursorImage from '@assets/images/cursor/cursor-click.png'
import collectionNewPageImage from '@assets/images/cursor/cursor-pass-page.png'

export type CursorVariant =
  'default' | 'click' | 'collection-next-page' | 'collection-previous-page'
export type CursorContextVariant = Exclude<CursorVariant, 'default' | 'click'>

/** The standard cursor artwork is 32 CSS pixels at the default scale. */
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
  width: number
  height: number
  hotspotX: number
  hotspotY: number
  flipX?: boolean
  scaleWithCursor?: boolean
}

/**
 * Keep cursor artwork in one registry so adding a future variant only needs
 * an asset entry and a new CursorVariant value. The grab artwork is
 * intentionally not registered until drag interactions are implemented.
 *
 * The standard cursor hotspots align the pointer with the visible fingertip
 * in each 32x32 image. They are stored per variant so future artwork can opt
 * into a different anchor without changing the positioning code.
 */
const CURSOR_ASSETS: Record<CursorVariant, CursorAsset> = {
  default: {
    image: defaultCursorImage,
    width: CURSOR_BASE_SIZE,
    height: CURSOR_BASE_SIZE,
    hotspotX: 9,
    hotspotY: 0
  },
  click: {
    image: clickCursorImage,
    width: CURSOR_BASE_SIZE,
    height: CURSOR_BASE_SIZE,
    hotspotX: 4,
    hotspotY: 0
  },
  'collection-next-page': {
    image: collectionNewPageImage,
    width: 87,
    height: 81,
    hotspotX: 43.5,
    hotspotY: 40.5,
    scaleWithCursor: false
  },
  'collection-previous-page': {
    image: collectionNewPageImage,
    width: 87,
    height: 81,
    hotspotX: 43.5,
    hotspotY: 40.5,
    flipX: true,
    scaleWithCursor: false
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

export function resolveCursorVariant(
  leftButtonDown: boolean,
  contextVariant: CursorContextVariant | null = null
): CursorVariant {
  if (leftButtonDown) return 'click'
  return contextVariant ?? 'default'
}

export function shouldRestoreCursor(
  documentIsVisible: boolean,
  windowIsFocused: boolean,
  pointerIsInsideHost: boolean,
  hasPointerPosition: boolean
): boolean {
  return (
    documentIsVisible && windowIsFocused && pointerIsInsideHost && hasPointerPosition
  )
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
  private contextVariant: CursorContextVariant | null = null
  private leftButtonDown = false
  private pointerX: number | null = null
  private pointerY: number | null = null
  private pointerInsideHost = false
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
    window.addEventListener('focus', this.onWindowFocus)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
  }

  destroy(): void {
    if (!this.mounted) return

    window.removeEventListener('pointermove', this.onPointerMove, true)
    window.removeEventListener('pointerdown', this.onPointerDown, true)
    window.removeEventListener('pointerup', this.onPointerUp, true)
    window.removeEventListener('pointercancel', this.onPointerCancel, true)
    window.removeEventListener('blur', this.onWindowBlur)
    window.removeEventListener('focus', this.onWindowFocus)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)

    this.host.classList.remove(CUSTOM_CURSOR_CLASS)
    this.element.remove()
    this.element.style.visibility = 'hidden'
    this.contextVariant = null
    this.leftButtonDown = false
    this.pointerInsideHost = false
    this.setVariant(resolveCursorVariant(this.leftButtonDown, this.contextVariant))
    this.mounted = false
  }

  /**
   * Updates the shared size of the standard cursor variants.
   *
   * The collection page cursor deliberately keeps its source dimensions so
   * the artwork remains at the size it was authored for.
   */
  setScale(scale: number): void {
    this.scale = normalizeCursorScale(scale)
    this.applyScale()
    this.updatePosition()
  }

  getScale(): number {
    return this.scale
  }

  setContextVariant(variant: CursorContextVariant | null): void {
    this.contextVariant = variant
    this.setVariant(resolveCursorVariant(this.leftButtonDown, this.contextVariant))
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.isInsideHost(event)) {
      this.pointerInsideHost = false
      // A missed pointerup can otherwise leave the pressed artwork active;
      // only clear it once the browser reports that the button is no longer
      // held, so dragging outside the window still preserves the pressed
      // state while the button remains down.
      if (this.leftButtonDown && (event.buttons & LEFT_BUTTON_MASK) === 0) {
        this.releaseLeftButton()
      }
      this.setContextVariant(null)
      this.hide()
      return
    }

    this.pointerInsideHost = true
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

    this.pointerInsideHost = true
    this.leftButtonDown = true
    this.setVariant(resolveCursorVariant(this.leftButtonDown, this.contextVariant))
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
    this.setContextVariant(null)
    this.releaseLeftButton()
    this.hide()
  }

  private onWindowFocus = (): void => {
    this.restoreAfterWindowReturn()
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') {
      this.setContextVariant(null)
      this.releaseLeftButton()
      this.hide()
      return
    }

    this.restoreAfterWindowReturn()
  }

  private restoreAfterWindowReturn(): void {
    if (
      !shouldRestoreCursor(
        document.visibilityState === 'visible',
        document.hasFocus(),
        this.pointerInsideHost,
        this.pointerX !== null && this.pointerY !== null
      )
    ) {
      return
    }

    this.show()
  }

  private releaseLeftButton(): void {
    if (!this.leftButtonDown) return

    this.leftButtonDown = false
    this.setVariant(resolveCursorVariant(this.leftButtonDown, this.contextVariant))
  }

  private isInsideHost(event: Event): boolean {
    const target = event.target
    return target instanceof Node && this.host.contains(target)
  }

  private setVariant(variant: CursorVariant): void {
    if (this.variant === variant) return

    this.variant = variant
    this.applyVariant()
    this.applyScale()
    this.updatePosition()
  }

  private applyVariant(): void {
    const asset = CURSOR_ASSETS[this.variant]
    this.element.src = asset.image
    this.element.style.transform = asset.flipX ? 'scaleX(-1)' : ''
  }

  private applyScale(): void {
    const asset = CURSOR_ASSETS[this.variant]
    if (asset.scaleWithCursor === false) {
      this.element.style.width = ''
      this.element.style.height = ''
      return
    }

    this.element.style.width = `${asset.width * this.scale}px`
    this.element.style.height = `${asset.height * this.scale}px`
  }

  private setPointerPosition(clientX: number, clientY: number): void {
    this.pointerX = clientX
    this.pointerY = clientY
    this.updatePosition()
  }

  private updatePosition(): void {
    if (this.pointerX === null || this.pointerY === null) return

    const asset = CURSOR_ASSETS[this.variant]
    const assetScale = asset.scaleWithCursor === false ? 1 : this.scale
    this.element.style.left = `${this.pointerX - asset.hotspotX * assetScale}px`
    this.element.style.top = `${this.pointerY - asset.hotspotY * assetScale}px`
  }

  private show(): void {
    this.element.style.visibility = 'visible'
  }

  private hide(): void {
    this.element.style.visibility = 'hidden'
  }
}
