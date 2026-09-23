import { Container, PerspectiveMesh, Rectangle, Sprite, type Renderer } from 'pixi.js'
import type { CardView } from '../../rendering/cards/card-view'
import { MAX_TILT_X_DEG, MAX_TILT_Y_DEG } from './drag-rotator'
import {
  AnimatedOutline,
  type OutlinePaletteInput,
  type OutlinePresetName,
  type OutlineTuning
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
  readonly outlineTuning?: OutlineTuning
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
  private mesh!: PerspectiveMesh
  private texture!: ReturnType<Renderer['generateTexture']>
  private outlineMesh: PerspectiveMesh | null = null
  private outlineMaskTexture: ReturnType<Renderer['generateTexture']> | null = null
  private outlineEffect: AnimatedOutline | null = null
  private readonly current = { x: 0, y: 0 }
  private readonly applied = { x: Number.NaN, y: Number.NaN }
  private wasVisible = true
  private destroyed = false
  private active = false
  private shadow: ShadowCaster | undefined
  private shadowFrame!: Rectangle
  private previousShadowMinimum = 0
  private previousShadowDepth = 1
  private resolution: number
  private resourcesDirty = false
  private outlineTexture: Texture | undefined
  private options: HandCardPerspectiveOptions
  private observedRevision: number
  private readonly onCardDestroyed = (): void => this.destroy()
  private readonly onResourceLost = (): void => {
    this.resourcesDirty = true
  }

  constructor(
    private readonly renderer: Renderer,
    private readonly cardView: CardView,
    options: HandCardPerspectiveOptions = {},
    activate = true
  ) {
    this.resolution = renderer.resolution
    this.options = options
    this.observedRevision = cardView.appearanceRevision
    try {
      this.createResources(options)
      cardView.once('destroyed', this.onCardDestroyed)
      renderer.runners?.contextChange?.add(this)
      if (activate) this.activate(options)
    } catch (error) {
      this.destroy()
      throw error
    }
  }

  private createResources(options: HandCardPerspectiveOptions): void {
    const { renderer, cardView } = this
    this.outlineTexture = options.outlineTexture
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
      () => this.active && !this.destroyed && isArtworkVisible(this.mesh),
      { deferRefresh: true }
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
    const geometry = this.mesh.geometry
    this.mesh.once('destroyed', () => geometry.destroy(true))

    if (options.outlineTexture) {
      const maskContainer = new Container()
      const maskSprite = new Sprite(options.outlineTexture)
      maskSprite.position.set(-frame.x, -frame.y)
      maskSprite.width = cardView.plan.width
      maskSprite.height = cardView.renderedHeight
      maskSprite.eventMode = 'none'
      maskContainer.addChild(maskSprite)
      try {
        this.outlineMaskTexture = renderer.generateTexture({
          target: maskContainer,
          frame: new Rectangle(0, 0, width, height),
          antialias: true
        })
      } finally {
        maskContainer.destroy({ children: true })
      }
      this.outlineMaskTexture.source.on('unload', this.onResourceLost)

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
      const outlineGeometry = this.outlineMesh.geometry
      this.outlineMesh.once('destroyed', () => outlineGeometry.destroy(true))
      this.outlineEffect = new AnimatedOutline(this.outlineMesh, {
        palette: options.outlinePalette ?? 'green',
        preset: options.outlinePreset ?? 'card',
        silhouette: {
          texture: options.outlineTexture,
          bounds: new Rectangle(
            -frame.x,
            -frame.y,
            cardView.plan.width,
            cardView.renderedHeight
          )
        }
      })
      this.outlineEffect.setEnabled(false)
    } else {
      this.outlineMesh = null
      this.outlineMaskTexture = null
      this.outlineEffect = null
    }

    this.observedRevision = cardView.appearanceRevision
  }

  get isDestroyed(): boolean {
    return this.destroyed || this.mesh?.destroyed || !!this.outlineMesh?.destroyed
  }

  /** Geometry and targets are reusable while their silhouette fits the captured region. */
  isCompatible(options: HandCardPerspectiveOptions): boolean {
    if (this.destroyed || this.cardView.destroyed) return false
    if (this.outlineTexture !== options.outlineTexture) return false
    const bounds = this.cardView.getLocalBounds()
    return (
      this.shadowFrame.x === bounds.minX - SNAPSHOT_PADDING &&
      this.shadowFrame.y === bounds.minY - SNAPSHOT_PADDING &&
      this.shadowFrame.width === bounds.width + SNAPSHOT_PADDING * 2 &&
      this.shadowFrame.height === bounds.height + SNAPSHOT_PADDING * 2
    )
  }

  /** Attach a prepared presentation without allocating another texture or mesh. */
  activate(options: HandCardPerspectiveOptions = {}): void {
    if (this.destroyed || this.active) return
    this.options = options
    this.ensureCurrentBounds()
    const parent = this.cardView.parent
    if (!parent) throw new Error('Attached hand card must have a parent container.')
    // Premium art can have animated on the original card since it was prepared.
    this.refreshSnapshot(this.cardView.isPremium)
    this.shadow = getShadowCaster(parent)
    this.previousShadowMinimum = this.shadow?.minimumHeight ?? 0
    this.previousShadowDepth = this.shadow?.depthMultiplier ?? 1
    this.mesh.position.set(
      this.cardView.position.x + this.shadowFrame.x,
      this.cardView.position.y + this.shadowFrame.y
    )
    this.outlineMesh?.position.copyFrom(this.mesh.position)
    this.outlineEffect?.setPalette(options.outlinePalette ?? 'green')
    this.outlineEffect?.setPreset(options.outlinePreset ?? 'card')
    if (options.outlineTuning) this.outlineEffect?.setTuning(options.outlineTuning)
    this.outlineEffect?.setEnabled(options.outlineEnabled ?? true)
    const cardIndex = parent.getChildIndex(this.cardView)
    if (this.outlineMesh) parent.addChildAt(this.outlineMesh, cardIndex)
    parent.addChildAt(this.mesh, cardIndex + (this.outlineMesh ? 1 : 0))
    this.wasVisible = this.cardView.visible
    this.cardView.visible = false
    this.active = true
    this.current.x = 0
    this.current.y = 0
    this.applied.x = Number.NaN
    this.applied.y = Number.NaN
    if (this.shadow) {
      this.shadow.visual = this.mesh
      this.shadow.minimumHeight = MATCH_SHADOW_CONFIG.heldCardHeight
      this.shadow.depthMultiplier = MATCH_SHADOW_CONFIG.draggedCardDepth
    }
    this.update()
  }

  /** Restore the real card while retaining bounded, offstage drag resources. */
  deactivate(): void {
    if (!this.active) return
    this.active = false
    if (this.shadow?.visual === this.mesh) {
      this.shadow.visual = this.cardView
      this.shadow.corners = null
      this.shadow.minimumHeight = this.previousShadowMinimum
      this.shadow.depthMultiplier = this.previousShadowDepth
    }
    if (!this.cardView.destroyed) this.cardView.visible = this.wasVisible
    this.outlineEffect?.setEnabled(false)
    this.outlineMesh?.removeFromParent()
    this.mesh.removeFromParent()
    this.shadow = undefined
  }

  flushSnapshot(force = false): void {
    if (!this.destroyed && this.active) {
      this.ensureCurrentBounds()
      this.refreshSnapshot(force)
    }
  }

  private ensureCurrentBounds(): void {
    if (this.observedRevision === this.cardView.appearanceRevision) return
    this.observedRevision = this.cardView.appearanceRevision
    if (this.isCompatible(this.options)) return
    const active = this.active
    const tilt = { ...this.current }
    this.deactivate()
    this.destroyResources()
    this.createResources(this.options)
    this.applied.x = Number.NaN
    this.applied.y = Number.NaN
    if (active) {
      this.activate(this.options)
      this.setTarget(tilt)
      this.update()
    }
  }

  /** Restored contexts need the generated mask and card pixels rendered again. */
  contextChange(): void {
    this.resourcesDirty = true
  }

  private refreshSnapshot(force: boolean): void {
    if (this.resolution !== this.renderer.resolution) {
      this.resolution = this.renderer.resolution
      this.texture.source.resize(
        this.texture.width,
        this.texture.height,
        this.resolution
      )
      this.outlineMaskTexture?.source.resize(
        this.outlineMaskTexture.width,
        this.outlineMaskTexture.height,
        this.resolution
      )
      this.resourcesDirty = true
    }
    if (this.resourcesDirty && this.outlineMaskTexture && this.outlineTexture) {
      const mask = new Sprite(this.outlineTexture)
      mask.position.set(-this.shadowFrame.x, -this.shadowFrame.y)
      mask.width = this.cardView.plan.width
      mask.height = this.cardView.renderedHeight
      const container = new Container()
      container.addChild(mask)
      try {
        this.renderer.render({
          container,
          target: this.outlineMaskTexture,
          clear: true
        })
        this.outlineMaskTexture.source.updateMipmaps()
      } finally {
        container.destroy({ children: true })
      }
    }
    if (this.resourcesDirty) this.cardView.updateCacheTexture()
    this.cardView.flushAppearanceSnapshot(this.texture, force || this.resourcesDirty)
    this.resourcesDirty = false
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
    if (this.destroyed || !this.active) return
    this.ensureCurrentBounds()
    if (this.applied.x === this.current.x && this.applied.y === this.current.y) return
    this.applied.x = this.current.x
    this.applied.y = this.current.y
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
    if (this.options.outlineEnabled === enabled) return
    this.options = { ...this.options, outlineEnabled: enabled }
    this.outlineEffect?.setEnabled(enabled)
  }

  setOutlinePalette(palette: OutlinePaletteInput): void {
    if (typeof palette === 'string' && this.options.outlinePalette === palette) return
    this.options = { ...this.options, outlinePalette: palette }
    this.outlineEffect?.setPalette(palette)
  }

  setOutlineAppearance(
    palette: OutlinePaletteInput,
    preset: OutlinePresetName,
    tuning?: OutlineTuning
  ): void {
    this.options = {
      ...this.options,
      outlinePalette: palette,
      outlinePreset: preset,
      outlineTuning: tuning
    }
    this.outlineEffect?.setPalette(palette)
    this.outlineEffect?.setPreset(preset)
    if (tuning) this.outlineEffect?.setTuning(tuning)
  }

  destroy(): void {
    if (this.destroyed) return
    this.deactivate()
    this.destroyed = true
    this.cardView.off('destroyed', this.onCardDestroyed)
    this.renderer.runners?.contextChange?.remove(this)
    this.destroyResources()
  }

  private destroyResources(): void {
    this.outlineEffect?.dispose()
    this.outlineEffect = null
    this.outlineMesh?.removeFromParent()
    this.outlineMesh?.destroy()
    this.outlineMesh = null
    this.outlineMaskTexture?.source?.off('unload', this.onResourceLost)
    this.outlineMaskTexture?.destroy(true)
    this.outlineMaskTexture = null
    this.mesh?.removeFromParent()
    this.mesh?.destroy()
    this.texture?.destroy(true)
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
