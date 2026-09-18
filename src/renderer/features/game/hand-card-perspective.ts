import { Container, PerspectiveMesh, Rectangle, Sprite, type Renderer } from 'pixi.js'
import type { CardView } from '../../rendering/cards/card-view'
import { MAX_TILT_X_DEG, MAX_TILT_Y_DEG } from './drag-rotator'
import {
  AnimatedOutline,
  type OutlinePaletteInput,
  type OutlinePresetName
} from '../../rendering/effects/animated-outline'
import type { Texture } from 'pixi.js'
import { isArtworkVisible } from '../../rendering/effects/premium-artwork-breath'
import {
  getShadowCaster,
  shadowBodyCorners,
  type ShadowCaster
} from '../../rendering/shadows/shadow-caster'
import { MATCH_SHADOW_CONFIG } from '../../rendering/shadows/match-shadow-config'

export interface PerspectivePoint {
  readonly x: number
  readonly y: number
}

export interface PerspectiveCorners {
  readonly topLeft: PerspectivePoint
  readonly topRight: PerspectivePoint
  readonly bottomRight: PerspectivePoint
  readonly bottomLeft: PerspectivePoint
}

export interface HandCardPerspectiveOptions {
  /** Raw card-frame texture used to keep the outline outside the card snapshot. */
  readonly outlineTexture?: Texture
  readonly outlineEnabled?: boolean
  readonly outlinePalette?: OutlinePaletteInput
  readonly outlinePreset?: OutlinePresetName
}

/** Far fake camera: large tilt angles render as a clean rigid bank, Hearthstone-style. */
const PERSPECTIVE_DEPTH = 3000
/** Leaves room for the playable-card outline and its blur when snapshotting. */
const SNAPSHOT_PADDING = 40

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

/** Projects a centred card rectangle into the four corners of a perspective plane. */
export function resolvePerspectiveCorners(
  tilt: PerspectivePoint,
  width: number,
  height: number
): PerspectiveCorners {
  const rotateX = -clampUnit(tilt.y) * ((MAX_TILT_X_DEG * Math.PI) / 180)
  const rotateY = clampUnit(tilt.x) * ((MAX_TILT_Y_DEG * Math.PI) / 180)
  const cosX = Math.cos(rotateX)
  const sinX = Math.sin(rotateX)
  const cosY = Math.cos(rotateY)
  const sinY = Math.sin(rotateY)

  const project = (x: number, y: number): PerspectivePoint => {
    const rotatedX = x * cosY
    const depthAfterY = -x * sinY
    const rotatedY = y * cosX - depthAfterY * sinX
    const depth = y * sinX + depthAfterY * cosX
    const perspective = PERSPECTIVE_DEPTH / (PERSPECTIVE_DEPTH + depth)
    return {
      x: width / 2 + rotatedX * perspective,
      y: height / 2 + rotatedY * perspective
    }
  }

  const halfWidth = width / 2
  const halfHeight = height / 2
  return {
    topLeft: project(-halfWidth, -halfHeight),
    topRight: project(halfWidth, -halfHeight),
    bottomRight: project(halfWidth, halfHeight),
    bottomLeft: project(-halfWidth, halfHeight)
  }
}

/** A temporary, visibly perspective-warped snapshot of one attached hand card. */
export class HandCardPerspective {
  private readonly mesh: PerspectiveMesh
  private readonly texture: ReturnType<Renderer['generateTexture']>
  private readonly outlineMesh: PerspectiveMesh | null
  private readonly outlineMaskTexture: ReturnType<Renderer['generateTexture']> | null
  private readonly outlineEffect: AnimatedOutline | null
  private readonly current = { x: 0, y: 0 }
  private readonly wasVisible: boolean
  private destroyed = false
  private readonly shadow: ShadowCaster | undefined
  private readonly shadowFrame: Rectangle
  private readonly previousShadowMinimum: number
  private readonly previousShadowDepth: number

  constructor(
    renderer: Renderer,
    private readonly cardView: CardView,
    options: HandCardPerspectiveOptions = {}
  ) {
    const bounds = cardView.getLocalBounds()
    const frame = new Rectangle(
      bounds.minX - SNAPSHOT_PADDING,
      bounds.minY - SNAPSHOT_PADDING,
      bounds.width + SNAPSHOT_PADDING * 2,
      bounds.height + SNAPSHOT_PADDING * 2
    )
    const width = frame.width
    const height = frame.height
    this.shadowFrame = frame
    this.texture = cardView.createAppearanceSnapshot(
      renderer,
      frame,
      () => !this.destroyed && isArtworkVisible(this.mesh)
    )
    this.mesh = new PerspectiveMesh({
      texture: this.texture,
      verticesX: 10,
      verticesY: 10,
      x0: 0,
      y0: 0,
      x1: width,
      y1: 0,
      x2: width,
      y2: height,
      x3: 0,
      y3: height
    })
    this.mesh.position.set(cardView.position.x + frame.x, cardView.position.y + frame.y)
    this.mesh.eventMode = 'none'
    const parent = cardView.parent
    if (!parent) throw new Error('Attached hand card must have a parent container.')
    this.shadow = getShadowCaster(parent)
    this.previousShadowMinimum = this.shadow?.minimumHeight ?? 0
    this.previousShadowDepth = this.shadow?.depthMultiplier ?? 1
    const cardIndex = parent.getChildIndex(cardView)

    if (options.outlineTexture) {
      const maskContainer = new Container()
      const maskSprite = new Sprite(options.outlineTexture)
      maskSprite.position.set(-frame.x, -frame.y)
      maskSprite.width = cardView.plan.width
      maskSprite.height = cardView.renderedHeight
      maskSprite.eventMode = 'none'
      maskContainer.addChild(maskSprite)
      this.outlineMaskTexture = renderer.generateTexture({
        target: maskContainer,
        frame: new Rectangle(0, 0, width, height),
        antialias: true
      })
      maskSprite.removeFromParent()
      maskSprite.destroy({ texture: false })
      maskContainer.destroy()

      this.outlineMesh = new PerspectiveMesh({
        texture: this.outlineMaskTexture,
        verticesX: 10,
        verticesY: 10,
        x0: 0,
        y0: 0,
        x1: width,
        y1: 0,
        x2: width,
        y2: height,
        x3: 0,
        y3: height
      })
      this.outlineMesh.position.copyFrom(this.mesh.position)
      this.outlineMesh.eventMode = 'none'
      this.outlineEffect = new AnimatedOutline(this.outlineMesh, {
        palette: options.outlinePalette ?? 'green',
        preset: options.outlinePreset ?? 'card'
      })
      this.outlineEffect.setEnabled(options.outlineEnabled ?? true)
    } else {
      this.outlineMesh = null
      this.outlineMaskTexture = null
      this.outlineEffect = null
    }

    if (this.outlineMesh) parent.addChildAt(this.outlineMesh, cardIndex)
    parent.addChildAt(this.mesh, cardIndex + (this.outlineMesh ? 1 : 0))
    this.wasVisible = cardView.visible
    cardView.visible = false
    if (this.shadow) {
      this.shadow.visual = this.mesh
      this.shadow.minimumHeight = MATCH_SHADOW_CONFIG.heldCardHeight
      this.shadow.depthMultiplier = MATCH_SHADOW_CONFIG.draggedCardDepth
    }
    this.update()
  }

  /**
   * Applies the tilt for this frame directly; all smoothing lives in the drag
   * rotator that feeds it, so the displayed warp never lags behind its input.
   */
  setTarget(target: PerspectivePoint): void {
    if (this.destroyed) return
    this.current.x = clampUnit(target.x)
    this.current.y = clampUnit(target.y)
  }

  /** Snapshot the displayed warp in normalized texture coordinates. */
  captureCorners(): PerspectiveCorners {
    const width = this.texture.width
    const height = this.texture.height
    const corners = resolvePerspectiveCorners(this.current, width, height)
    const normalize = (point: PerspectivePoint): PerspectivePoint => ({
      x: point.x / width,
      y: point.y / height
    })
    return {
      topLeft: normalize(corners.topLeft),
      topRight: normalize(corners.topRight),
      bottomRight: normalize(corners.bottomRight),
      bottomLeft: normalize(corners.bottomLeft)
    }
  }

  update(): void {
    if (this.destroyed) return
    const corners = resolvePerspectiveCorners(
      this.current,
      this.texture.width,
      this.texture.height
    )
    this.setCorners(
      corners.topLeft.x,
      corners.topLeft.y,
      corners.topRight.x,
      corners.topRight.y,
      corners.bottomRight.x,
      corners.bottomRight.y,
      corners.bottomLeft.x,
      corners.bottomLeft.y
    )
  }

  setOutlineEnabled(enabled: boolean): void {
    this.outlineEffect?.setEnabled(enabled)
  }

  setOutlinePalette(palette: OutlinePaletteInput): void {
    this.outlineEffect?.setPalette(palette)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.shadow?.visual === this.mesh) {
      this.shadow.visual = this.cardView
      this.shadow.corners = null
      this.shadow.minimumHeight = this.previousShadowMinimum
      this.shadow.depthMultiplier = this.previousShadowDepth
    }
    this.cardView.visible = this.wasVisible
    this.outlineEffect?.dispose()
    this.outlineMesh?.removeFromParent()
    this.outlineMesh?.destroy()
    this.outlineMaskTexture?.destroy(true)
    this.mesh.removeFromParent()
    this.mesh.destroy()
    this.texture.destroy(true)
  }

  private setCorners(
    topLeftX: number,
    topLeftY: number,
    topRightX: number,
    topRightY: number,
    bottomRightX: number,
    bottomRightY: number,
    bottomLeftX: number,
    bottomLeftY: number
  ): void {
    this.mesh.setCorners(
      topLeftX,
      topLeftY,
      topRightX,
      topRightY,
      bottomRightX,
      bottomRightY,
      bottomLeftX,
      bottomLeftY
    )
    this.outlineMesh?.setCorners(
      topLeftX,
      topLeftY,
      topRightX,
      topRightY,
      bottomRightX,
      bottomRightY,
      bottomLeftX,
      bottomLeftY
    )
    if (this.shadow?.visual === this.mesh) {
      this.shadow.corners = shadowBodyCorners(
        [
          { x: topLeftX, y: topLeftY },
          { x: topRightX, y: topRightY },
          { x: bottomRightX, y: bottomRightY },
          { x: bottomLeftX, y: bottomLeftY }
        ],
        this.shadowFrame,
        this.shadow.bounds
      )
    }
  }
}
