import defaultCursorImage from '@assets/images/cursor/cursor-base.png'
import grabCursorImage from '@assets/images/cursor/cursor-grab.png'
import collectionNewPageImage from '@assets/images/cursor/cursor-pass-page.png'
import arrowHeadImage from '@assets/images/match/arrow-head.png'
import arrowCircleImage from '@assets/images/match/arrow-circle.png'

export type CursorVariant =
  'default' | 'grab' | 'collection-next-page' | 'collection-previous-page'
export type CursorContextVariant = Exclude<CursorVariant, 'default'>

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
const TARGET_CIRCLE_SIZE = 112
const TARGET_CIRCLE_OFFSET_Y = -10

interface CursorAsset {
  image: string
  width: number
  height: number
  hotspotX: number
  hotspotY: number
  flipX?: boolean
  scaleWithCursor?: boolean
}

export interface CursorTargetPoint {
  readonly x: number
  readonly y: number
}

/**
 * Keep cursor artwork in one registry so adding a future variant only needs
 * an asset entry and a new CursorVariant value.
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
  grab: {
    image: grabCursorImage,
    width: CURSOR_BASE_SIZE,
    height: CURSOR_BASE_SIZE,
    hotspotX: 9,
    hotspotY: 0
  },
  'collection-next-page': {
    image: collectionNewPageImage,
    width: 59,
    height: 55,
    hotspotX: 29.5,
    hotspotY: 27.5,
    scaleWithCursor: false
  },
  'collection-previous-page': {
    image: collectionNewPageImage,
    width: 59,
    height: 55,
    hotspotX: 29.5,
    hotspotY: 27.5,
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

export function resolveCursorVariant(
  contextVariant: CursorContextVariant | null = null
): CursorVariant {
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
  private readonly arrowHeadElement: HTMLImageElement
  private readonly targetCircleElement: HTMLImageElement
  private scale = DEFAULT_CURSOR_SCALE
  private variant: CursorVariant = 'default'
  private contextVariant: CursorContextVariant | null = null
  private leftButtonDown = false
  private pointerX: number | null = null
  private pointerY: number | null = null
  private pointerInsideHost = false
  private mounted = false
  private targeting = false
  private targetingTargetPoint: CursorTargetPoint | null = null
  private targetingAngle = 0

  constructor(host: HTMLElement) {
    this.host = host
    this.element = document.createElement('img')
    this.element.className = 'game-cursor'
    this.element.alt = ''
    this.element.setAttribute('aria-hidden', 'true')
    this.element.draggable = false
    this.element.style.visibility = 'hidden'
    this.element.style.transformOrigin = '50% 50%'

    this.arrowHeadElement = document.createElement('img')
    this.arrowHeadElement.className = 'game-cursor-arrow-head'
    this.arrowHeadElement.alt = ''
    this.arrowHeadElement.setAttribute('aria-hidden', 'true')
    this.arrowHeadElement.draggable = false
    this.arrowHeadElement.src = arrowHeadImage
    this.arrowHeadElement.style.position = 'fixed'
    this.arrowHeadElement.style.left = '0'
    this.arrowHeadElement.style.top = '0'
    this.arrowHeadElement.style.pointerEvents = 'none'
    this.arrowHeadElement.style.visibility = 'hidden'
    // Tip of the arrow head image is at the top-center (58,0) in the 119x57 source.
    // Keep native 1× scale per spec: 119×57.
    this.arrowHeadElement.style.transformOrigin = '60px 6px'
    this.arrowHeadElement.style.width = '119px'
    this.arrowHeadElement.style.height = '57px'
    this.arrowHeadElement.style.zIndex = '9999'

    this.targetCircleElement = document.createElement('img')
    this.targetCircleElement.className = 'game-cursor-target-circle'
    this.targetCircleElement.alt = ''
    this.targetCircleElement.setAttribute('aria-hidden', 'true')
    this.targetCircleElement.draggable = false
    this.targetCircleElement.src = arrowCircleImage
    this.targetCircleElement.style.position = 'fixed'
    this.targetCircleElement.style.left = '0'
    this.targetCircleElement.style.top = '0'
    this.targetCircleElement.style.width = `${TARGET_CIRCLE_SIZE}px`
    this.targetCircleElement.style.height = `${TARGET_CIRCLE_SIZE}px`
    this.targetCircleElement.style.pointerEvents = 'none'
    this.targetCircleElement.style.visibility = 'hidden'
    this.targetCircleElement.style.zIndex = '9998'

    this.applyVariant()
    this.applyScale()
    this.updateArrowHeadPosition()
    this.updateTargetCirclePosition()
  }

  mount(): void {
    if (this.mounted) return

    this.mounted = true
    this.host.classList.add(CUSTOM_CURSOR_CLASS)
    this.host.appendChild(this.element)
    this.host.appendChild(this.targetCircleElement)
    this.host.appendChild(this.arrowHeadElement)

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
    this.targetCircleElement.remove()
    this.arrowHeadElement.remove()
    this.element.style.visibility = 'hidden'
    this.arrowHeadElement.style.visibility = 'hidden'
    this.targetCircleElement.style.visibility = 'hidden'
    this.contextVariant = null
    this.leftButtonDown = false
    this.pointerInsideHost = false
    this.targeting = false
    this.targetingTargetPoint = null
    this.setVariant(resolveCursorVariant(this.contextVariant))
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
    this.setVariant(resolveCursorVariant(this.contextVariant))
  }

  setTargeting(active: boolean): void {
    if (this.targeting === active) return
    this.targeting = active
    if (active) {
      this.element.style.visibility = 'hidden'
      this.syncTargetingVisibility()
      this.updateArrowHeadPosition()
      this.updateTargetCirclePosition()
    } else {
      this.targetingTargetPoint = null
      this.arrowHeadElement.style.visibility = 'hidden'
      this.targetCircleElement.style.visibility = 'hidden'
      if (this.pointerInsideHost && this.pointerX !== null) this.show()
      else this.hide()
    }
  }

  isTargeting(): boolean {
    return this.targeting
  }

  /** Positions the target indicator at the current valid character hover point. */
  setTargetingTarget(point: CursorTargetPoint | null): void {
    this.targetingTargetPoint = point
    this.updateTargetCirclePosition()
    this.syncTargetingVisibility()
  }

  setTargetingAngle(angleRad: number): void {
    this.targetingAngle = angleRad
    this.updateArrowHeadPosition()
  }

  getTargetingAngle(): number {
    return this.targetingAngle
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
    this.setTargeting(false)
    this.releaseLeftButton()
    this.hide()
  }

  private onWindowFocus = (): void => {
    this.restoreAfterWindowReturn()
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') {
      this.setContextVariant(null)
      this.setTargeting(false)
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
    this.updateArrowHeadPosition()
    this.updateTargetCirclePosition()
  }

  private applyVariant(): void {
    const asset = CURSOR_ASSETS[this.variant]
    this.element.src = asset.image
    this.element.style.transform = asset.flipX ? 'scaleX(-1)' : ''
  }

  private applyScale(): void {
    const asset = CURSOR_ASSETS[this.variant]
    if (asset.scaleWithCursor === false) {
      this.element.style.width = `${asset.width}px`
      this.element.style.height = `${asset.height}px`
      return
    }

    this.element.style.width = `${asset.width * this.scale}px`
    this.element.style.height = `${asset.height * this.scale}px`
  }

  private setPointerPosition(clientX: number, clientY: number): void {
    this.pointerX = clientX
    this.pointerY = clientY
    this.updatePosition()
    this.updateArrowHeadPosition()
  }

  private updatePosition(): void {
    if (this.pointerX === null || this.pointerY === null) return

    const asset = CURSOR_ASSETS[this.variant]
    const assetScale = asset.scaleWithCursor === false ? 1 : this.scale
    this.element.style.left = `${this.pointerX - asset.hotspotX * assetScale}px`
    this.element.style.top = `${this.pointerY - asset.hotspotY * assetScale}px`
  }

  private updateArrowHeadPosition(): void {
    if (this.pointerX === null || this.pointerY === null) return
    // Tip at top-center (60,6) in the native 119×57 head – keep the tip glued to the pointer
    // and rotate so the head points toward the mouse direction.
    this.arrowHeadElement.style.left = `${this.pointerX - 60}px`
    this.arrowHeadElement.style.top = `${this.pointerY - 6}px`
    // Source image points up (-Y). Vector angle 0 = east, so add 90° to align.
    const degrees = ((this.targetingAngle + Math.PI / 2) * 180) / Math.PI
    this.arrowHeadElement.style.transform = `rotate(${degrees}deg)`
  }

  private updateTargetCirclePosition(): void {
    const point = this.targetingTargetPoint
    if (!point) return
    this.targetCircleElement.style.left = `${point.x - TARGET_CIRCLE_SIZE / 2}px`
    this.targetCircleElement.style.top = `${
      point.y + TARGET_CIRCLE_OFFSET_Y - TARGET_CIRCLE_SIZE / 2
    }px`
  }

  private syncTargetingVisibility(): void {
    const showArrowHead =
      this.targeting && this.pointerInsideHost && this.pointerX !== null
    this.arrowHeadElement.style.visibility = showArrowHead ? 'visible' : 'hidden'
    this.targetCircleElement.style.visibility =
      showArrowHead && this.targetingTargetPoint ? 'visible' : 'hidden'
  }

  private show(): void {
    if (this.targeting) {
      this.element.style.visibility = 'hidden'
      this.syncTargetingVisibility()
      return
    }
    this.element.style.visibility = 'visible'
    this.arrowHeadElement.style.visibility = 'hidden'
    this.targetCircleElement.style.visibility = 'hidden'
  }

  private hide(): void {
    this.element.style.visibility = 'hidden'
    this.arrowHeadElement.style.visibility = 'hidden'
    this.targetCircleElement.style.visibility = 'hidden'
  }
}
