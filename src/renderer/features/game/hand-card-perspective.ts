import { Container, PerspectiveMesh, Rectangle, Sprite, type Renderer } from 'pixi.js'
import type { CardView } from '../../rendering/cards/card-view'
import { resolveParallaxSmoothing } from '../../rendering/cards/card-parallax'
import {
  AnimatedOutline,
  OUTLINE_PROFILES,
  type OutlineColorName,
  type OutlineProfile
} from '../../rendering/effects/animated-outline'
import type { Texture } from 'pixi.js'

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
  readonly outlineColor?: OutlineColorName | number
  readonly outlineProfile?: OutlineProfile
}

const MAX_TILT_X = (22 * Math.PI) / 180
const MAX_TILT_Y = (28 * Math.PI) / 180
const PERSPECTIVE_DEPTH = 950
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
  const rotateX = -clampUnit(tilt.y) * MAX_TILT_X
  const rotateY = clampUnit(tilt.x) * MAX_TILT_Y
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
  private readonly target = { x: 0, y: 0 }
  private readonly wasVisible: boolean
  private destroyed = false

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
    this.texture = renderer.generateTexture({
      target: cardView,
      frame,
      antialias: true
    })
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
      this.outlineEffect = new AnimatedOutline(
        this.outlineMesh,
        options.outlineColor ?? 'green',
        options.outlineProfile ?? OUTLINE_PROFILES.card
      )
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
  }

  setTarget(target: PerspectivePoint): void {
    if (this.destroyed) return
    this.target.x = clampUnit(target.x)
    this.target.y = clampUnit(target.y)
  }

  release(): void {
    this.setTarget({ x: 0, y: 0 })
  }

  update(deltaMS: number): void {
    if (this.destroyed) return
    const smoothing = resolveParallaxSmoothing(deltaMS)
    this.current.x += (this.target.x - this.current.x) * smoothing
    this.current.y += (this.target.y - this.current.y) * smoothing

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

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
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
  }
}
