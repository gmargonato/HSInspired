import {
  Container,
  Graphics,
  PerspectiveMesh,
  Rectangle,
  type Renderer,
  type Texture
} from 'pixi.js'
import { Burn } from '../../../visual-components/effects/burn'
import { isArtworkVisible } from '../../../visual-components/effects/premium-artwork-breath'
import {
  getShadowCaster,
  shadowBodyCorners
} from '../../../visual-components/effects/shadow-caster'
import { MATCH_SHADOW_CONFIG } from '../board/match-shadow-config'
import type { MotionCorners, MotionPose } from './card-motion'

/** Shared snapshot, projection mesh, clipping, shadow and effect lifetime for card flights. */
export class CardFlightVisual {
  readonly mesh: PerspectiveMesh
  readonly frame: Rectangle
  readonly corners: MotionCorners
  private readonly texture?: Texture
  private readonly wasVisible: boolean
  private readonly shadow
  private readonly oldShadowVisual
  private readonly oldShadowMinimum: number
  private readonly destinationMagnification: number
  private readonly oldShadowMagnification: number | null
  private readonly oldShadowCorners
  private readonly maskShape = new Graphics()
  private maskEnabled = true
  private ghost?: PerspectiveMesh
  private showHidden = false
  private burn?: Burn
  private disposed = false

  constructor(
    renderer: Renderer,
    layer: Container,
    private readonly body: Container,
    private readonly back: Texture,
    private readonly options: {
      face: Container
      capture?: (frame: Rectangle, active: () => boolean) => Texture
      hidden?: boolean
      additiveLift?: boolean
      label: string
    }
  ) {
    const bounds = options.face.getLocalBounds()
    this.frame = new Rectangle(bounds.x, bounds.y, bounds.width, bounds.height)
    this.corners = [
      { x: this.frame.x, y: this.frame.y },
      { x: this.frame.right, y: this.frame.y },
      { x: this.frame.right, y: this.frame.bottom },
      { x: this.frame.x, y: this.frame.bottom }
    ].map((p) => layer.toLocal(options.face.toGlobal(p))) as unknown as MotionCorners
    if (!options.hidden) {
      this.texture = options.capture
        ? options.capture(
            this.frame,
            () =>
              !this.disposed &&
              isArtworkVisible(this.mesh) &&
              this.mesh.texture === this.texture
          )
        : renderer.generateTexture({ target: options.face, frame: this.frame })
    }
    this.mesh = new PerspectiveMesh({ texture: back, verticesX: 10, verticesY: 10 })
    const geometry = this.mesh.geometry
    this.mesh.once('destroyed', () => geometry.destroy(true))
    this.mesh.eventMode = 'none'
    this.mesh.label = options.label
    this.maskShape.label = options.label + '.slot-mask'
    this.maskShape.eventMode = 'none'
    this.maskShape.visible = false
    layer.addChild(this.mesh, this.maskShape)
    this.wasVisible = body.visible
    this.shadow = getShadowCaster(body)
    this.oldShadowVisual = this.shadow?.visual
    this.oldShadowMinimum = this.shadow?.minimumHeight ?? 0
    this.oldShadowMagnification = this.shadow?.magnification ?? null
    this.oldShadowCorners = this.shadow?.corners ?? null
    this.destinationMagnification =
      Math.abs(body.scale.y) / (this.shadow?.restingScale ?? 1)
    body.visible = false
    if (this.shadow) this.shadow.visual = this.mesh
  }

  setOcclusionEnabled(enabled: boolean): void {
    this.maskEnabled = enabled
  }

  /** Viewer-only overlay: reveal the whole rigid card behind the exposed portion. */
  setHiddenPortionVisible(enabled: boolean): void {
    this.showHidden = enabled
    if (enabled && !this.ghost && !this.disposed) {
      const layer = this.mesh.parent
      if (!layer) return
      this.ghost = new PerspectiveMesh({
        texture: this.back,
        verticesX: 10,
        verticesY: 10
      })
      const geometry = this.ghost.geometry
      this.ghost.once('destroyed', () => geometry.destroy(true))
      this.ghost.label = this.options.label + '.hidden-portion'
      this.ghost.eventMode = 'none'
      this.ghost.alpha = 0.25
      layer.addChildAt(this.ghost, layer.getChildIndex(this.mesh))
    }
  }

  update(pose: MotionPose, progress: number, scale = 1, front = this.texture): void {
    if (this.disposed) return
    const center = {
      x: pose.corners.reduce((s, p) => s + p.x, 0) / 4,
      y: pose.corners.reduce((s, p) => s + p.y, 0) / 4
    }
    const corners =
      scale === 1
        ? pose.corners
        : (pose.corners.map((p) => ({
            x: center.x + (p.x - center.x) * scale,
            y: center.y + (p.y - center.y) * scale
          })) as unknown as MotionCorners)
    const [a, b, c, d] = corners
    this.mesh.texture = pose.front ? (front ?? this.back) : this.back
    // Project the complete card unchanged, then mask its visibility independently.
    this.mesh.setCorners(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)
    const crop = this.maskEnabled ? pose.visibleCorners : undefined
    if (crop) {
      const scaled = crop.map((p) => ({
        x: center.x + (p.x - center.x) * scale,
        y: center.y + (p.y - center.y) * scale
      }))
      this.maskShape.clear().poly(scaled).fill(0xffffff)
      this.maskShape.visible = true
      this.mesh.mask = this.maskShape
    } else {
      this.mesh.mask = null
      this.maskShape.visible = false
    }
    this.mesh.visible = !pose.edgeOn
    if (this.ghost) {
      this.ghost.texture = this.mesh.texture
      this.ghost.setCorners(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)
      this.ghost.visible = this.showHidden && !!pose.visibleCorners && !pose.edgeOn
    }
    if (this.shadow) {
      // The board's shadow caster is a complete quadrilateral. Once behind the lip,
      // suppress that silhouette instead of leaving a full-card shadow over the stack.
      const occluded = !!crop
      this.shadow.visual = this.burn || occluded ? this.body : this.mesh
      this.shadow.corners = shadowBodyCorners(corners, this.frame, this.shadow.bounds)
      this.shadow.magnification = pose.plane
        ? pose.plane.height / this.frame.height / this.shadow.restingScale
        : pose.magnification * this.destinationMagnification
      const lift =
        MATCH_SHADOW_CONFIG.heldCardHeight *
        Math.sin(Math.PI * Math.max(0, Math.min(1, progress)))
      this.shadow.minimumHeight = this.options.additiveLift
        ? this.oldShadowMinimum + lift
        : Math.max(this.oldShadowMinimum, lift)
    }
  }

  updateBurn(progress: number, noise: Texture): void {
    if (this.disposed) return
    if (!this.burn) {
      this.burn = new Burn(noise)
      this.mesh.filters = [...(this.mesh.filters ?? []), this.burn.filter]
      if (this.shadow) this.shadow.visual = this.body
    }
    this.burn.setProgress(progress)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (!this.body.destroyed) this.body.visible = this.wasVisible
    if (
      this.shadow &&
      (this.shadow.visual === this.mesh || this.shadow.visual === this.body)
    ) {
      this.shadow.visual = this.oldShadowVisual!
      this.shadow.corners = this.oldShadowCorners
      this.shadow.magnification = this.oldShadowMagnification
      this.shadow.minimumHeight = this.oldShadowMinimum
    }
    if (!this.mesh.destroyed) {
      this.mesh.mask = null
      this.mesh.removeFromParent()
      if (this.burn)
        this.mesh.filters = (this.mesh.filters ?? []).filter(
          (f) => f !== this.burn!.filter
        )
      this.mesh.destroy()
    }
    this.burn?.destroy()
    if (this.ghost && !this.ghost.destroyed) this.ghost.destroy()
    if (!this.maskShape.destroyed) {
      this.maskShape.removeFromParent()
      this.maskShape.destroy()
    }
    this.texture?.destroy(true)
  }
}
