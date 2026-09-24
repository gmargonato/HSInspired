import { PerspectiveMesh, Rectangle, type Renderer } from 'pixi.js'
import { gsap } from '../../animation/animations'
import type { MinionView } from '../../rendering/minions/minion-view'
import { shadowBodyCorners } from '../../rendering/shadows/shadow-caster'
import { resolvePerspectiveCorners } from './hand-card-perspective'
import {
  COMBAT_DRAG_ROTATOR,
  MAX_TILT_X_DEG,
  MAX_TILT_Y_DEG,
  resetDragRotator,
  scaleDragRotatorForce,
  stepDragRotator,
  type DragRotatorConfig,
  type DragRotatorState
} from './drag-rotator'

/** Extra room around the minion snapshot for status rings and the warp's blur. */
const WARP_SNAPSHOT_PADDING = 24

/**
 * A temporary perspective-warp stand-in for an attacking minion's return leg,
 * reusing the selected-card drag projection: the live view is baked into a
 * texture, shown through a PerspectiveMesh, and tilted by the same DragRotator
 * physics fed with the minion's motion instead of pointer deltas.
 */
export class CombatAttackWarp {
  private readonly mesh: PerspectiveMesh
  private readonly texture: ReturnType<Renderer['generateTexture']>
  private readonly frame: Rectangle
  private readonly baseScale: { x: number; y: number }
  private readonly rotatorConfig: DragRotatorConfig
  private rotator: DragRotatorState
  private readonly tick: (time: number, deltaMS: number) => void
  private disposed = false

  constructor(
    renderer: Renderer,
    private readonly view: MinionView,
    tiltScale = 1
  ) {
    const parent = view.parent
    if (!parent) {
      throw new Error('A warping attacker must have a combat layer parent.')
    }
    this.rotatorConfig = scaleDragRotatorForce(COMBAT_DRAG_ROTATOR, tiltScale)
    const bounds = view.getLocalBounds()
    const frame = new Rectangle(
      bounds.minX - WARP_SNAPSHOT_PADDING,
      bounds.minY - WARP_SNAPSHOT_PADDING,
      bounds.width + WARP_SNAPSHOT_PADDING * 2,
      bounds.height + WARP_SNAPSHOT_PADDING * 2
    )
    this.frame = frame
    this.texture = renderer.generateTexture({
      target: view,
      frame,
      antialias: true
    })
    this.baseScale = { x: view.scale.x, y: view.scale.y }
    this.mesh = new PerspectiveMesh({
      texture: this.texture,
      verticesX: 10,
      verticesY: 10,
      x0: 0,
      y0: 0,
      x1: frame.width,
      y1: 0,
      x2: frame.width,
      y2: frame.height,
      x3: 0,
      y3: frame.height
    })
    this.mesh.position.copyFrom(this.resolveSnapshotPosition())
    this.mesh.scale.copyFrom(view.scale)
    this.mesh.zIndex = view.zIndex
    this.mesh.eventMode = 'none'
    this.mesh.label = `game.combat-warp.${view.instanceId ?? 'unknown'}`
    parent.addChildAt(
      this.mesh,
      Math.min(parent.getChildIndex(view) + 1, parent.children.length)
    )
    view.visible = false
    this.view.shadow.visual = this.mesh
    this.rotator = resetDragRotator(view.x, view.y)
    this.tick = (_time: number, deltaMS: number): void => this.step(deltaMS)
    gsap.ticker.add(this.tick)
    this.applyTilt()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    gsap.ticker.remove(this.tick)
    const shadow = this.view.shadow
    if (shadow.visual === this.mesh) {
      shadow.visual = this.view
      shadow.corners = null
    }
    if (!this.view.destroyed) this.view.visible = true
    this.mesh.removeFromParent()
    this.mesh.destroy()
    this.texture.destroy(true)
  }

  /** Advances the tilt physics from the tweening minion's movement deltas. */
  private step(deltaMS: number): void {
    if (this.disposed || this.view.destroyed) return
    this.rotator = stepDragRotator(
      this.rotator,
      this.view.x,
      this.view.y,
      deltaMS,
      this.rotatorConfig
    )
    this.mesh.position.copyFrom(this.resolveSnapshotPosition())
    this.applyTilt()
  }

  private applyTilt(): void {
    const corners = resolvePerspectiveCorners(
      {
        // Leading edge of motion enlarges: descending returns swell the bottom
        // edge toward the camera, matching the Hearthstone reference.
        x: -this.rotator.rollDeg / MAX_TILT_Y_DEG,
        y: this.rotator.pitchDeg / MAX_TILT_X_DEG
      },
      this.texture.width,
      this.texture.height
    )
    this.mesh.setCorners(
      corners.topLeft.x,
      corners.topLeft.y,
      corners.topRight.x,
      corners.topRight.y,
      corners.bottomRight.x,
      corners.bottomRight.y,
      corners.bottomLeft.x,
      corners.bottomLeft.y
    )
    const shadow = this.view.shadow
    if (shadow.visual === this.mesh) {
      shadow.corners = shadowBodyCorners(
        [
          { x: corners.topLeft.x, y: corners.topLeft.y },
          { x: corners.topRight.x, y: corners.topRight.y },
          { x: corners.bottomRight.x, y: corners.bottomRight.y },
          { x: corners.bottomLeft.x, y: corners.bottomLeft.y }
        ],
        this.frame,
        shadow.bounds
      )
    }
  }

  /** Keeps the mesh glued to the tweening minion (position only; scale is fixed). */
  private resolveSnapshotPosition(): { x: number; y: number } {
    return {
      x: this.view.x + (this.frame.x - this.view.pivot.x) * this.baseScale.x,
      y: this.view.y + (this.frame.y - this.view.pivot.y) * this.baseScale.y
    }
  }
}
