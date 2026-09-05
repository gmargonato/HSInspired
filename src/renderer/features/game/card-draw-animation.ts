import { Container, PerspectiveMesh, Rectangle, Sprite, type Renderer } from 'pixi.js'
import type { GameCardSlot } from './game-card-slot'
import { CARD_DRAW_LAYOUT } from './card-draw-layout'

type Point = { x: number; y: number }
export type DrawCorners = readonly [Point, Point, Point, Point]

const mix = (a: number, b: number, t: number): number => a + (b - a) * t
const smooth = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

/** A rigid plane turning in flight, with an authored departure silhouette. */
export function drawFlightPose(
  start: DrawCorners,
  end: DrawCorners,
  progress: number,
  reveal: boolean
): { corners: DrawCorners; front: boolean; edgeOn: boolean } {
  const t = smooth(Math.max(0, Math.min(1, progress)))
  const center = (corners: DrawCorners): Point => ({
    x: corners.reduce((sum, p) => sum + p.x, 0) / 4,
    y: corners.reduce((sum, p) => sum + p.y, 0) / 4
  })
  const a = center(start)
  const b = center(end)
  const width = Math.hypot(end[1].x - end[0].x, end[1].y - end[0].y)
  const height = Math.hypot(end[3].x - end[0].x, end[3].y - end[0].y)
  const startHeight = Math.hypot(start[3].x - start[0].x, start[3].y - start[0].y)
  const startWidth = Math.hypot(start[1].x - start[0].x, start[1].y - start[0].y)
  const initialYaw = Math.acos(
    Math.min(0.95, startWidth / ((startHeight * width) / height))
  )
  const yaw = mix(initialYaw, reveal ? Math.PI : 0, t)
  const cosine = Math.cos(yaw)
  const finalRotation = Math.atan2(end[1].y - end[0].y, end[1].x - end[0].x)
  const rotation = finalRotation * t
  const scale = mix(startHeight / height, 1, t)
  const arc = Math.sin(Math.PI * t)
  const cx = mix(a.x, b.x, t) + CARD_DRAW_LAYOUT.arc.x * arc
  const cy = mix(a.y, b.y, t) + CARD_DRAW_LAYOUT.arc.y * arc
  const cameraDepth = CARD_DRAW_LAYOUT.perspectiveDepth
  const pitch = CARD_DRAW_LAYOUT.pitch * arc
  const project = (index: number, u: number, v: number): Point => {
    // Reverse the plane's local horizontal axis on its front side, so the
    // artwork stays readable while the physical near/far edges exchange sides.
    const x = u * width * scale * (cosine < 0 ? -1 : 1)
    const y = v * height * scale
    const depthAfterYaw = -x * Math.sin(yaw)
    const depth = depthAfterYaw * Math.cos(pitch) + y * Math.sin(pitch)
    const perspective = cameraDepth / (cameraDepth + depth)
    const px = u * width * scale * Math.max(0.001, Math.abs(cosine)) * perspective
    const py = (y * Math.cos(pitch) - depthAfterYaw * Math.sin(pitch)) * perspective
    const projected = {
      x: cx + px * Math.cos(rotation) - py * Math.sin(rotation),
      y: cy + px * Math.sin(rotation) + py * Math.cos(rotation)
    }
    // Fit the painted trapezoid exactly, releasing its correction during lift-off.
    const initialX = u * width * (startHeight / height)
    const initialPerspective =
      cameraDepth / (cameraDepth - initialX * Math.sin(initialYaw))
    const correction = 1 - smooth(Math.min(1, progress / CARD_DRAW_LAYOUT.liftFraction))
    projected.x +=
      (start[index].x - (a.x + initialX * Math.cos(initialYaw) * initialPerspective)) *
      correction
    projected.y +=
      (start[index].y - (a.y + v * startHeight * initialPerspective)) * correction
    // Parent transforms can also shear the destination; converge to its actual corners.
    projected.x +=
      (end[index].x -
        (b.x +
          u * width * Math.cos(finalRotation) -
          v * height * Math.sin(finalRotation))) *
      t
    projected.y +=
      (end[index].y -
        (b.y +
          u * width * Math.sin(finalRotation) +
          v * height * Math.cos(finalRotation))) *
      t
    return projected
  }
  return {
    corners:
      progress >= 1
        ? end
        : [
            project(0, -0.5, -0.5),
            project(1, 0.5, -0.5),
            project(2, 0.5, 0.5),
            project(3, -0.5, 0.5)
          ],
    front: reveal && cosine < 0,
    edgeOn: Math.abs(cosine) < 0.012
  }
}

/** Owns only flight visuals; the live target already holds its destination pose. */
export class CardDrawAnimation {
  private readonly mesh: PerspectiveMesh
  private readonly frontTexture?: ReturnType<Renderer['generateTexture']>
  private readonly start: DrawCorners
  private readonly end: DrawCorners
  private readonly wasVisible: boolean
  private disposed = false

  constructor(
    renderer: Renderer,
    layer: Container,
    deck: Sprite,
    private readonly target: GameCardSlot | Sprite,
    private readonly backTexture: Sprite['texture'],
    slot?: GameCardSlot
  ) {
    this.start = CARD_DRAW_LAYOUT.deckFace.map((p) =>
      layer.toLocal(
        deck.toGlobal({
          x: p.x - deck.anchor.x * deck.texture.width,
          y: p.y - deck.anchor.y * deck.texture.height
        })
      )
    ) as unknown as DrawCorners
    const face = slot ? slot.card : target
    const bounds = face.getLocalBounds()
    const frame = new Rectangle(bounds.minX, bounds.minY, bounds.width, bounds.height)
    this.end = [
      { x: frame.x, y: frame.y },
      { x: frame.right, y: frame.y },
      { x: frame.right, y: frame.bottom },
      { x: frame.x, y: frame.bottom }
    ].map((p) => layer.toLocal(face.toGlobal(p))) as unknown as DrawCorners
    if (slot)
      this.frontTexture = renderer.generateTexture({
        target: face,
        frame,
        antialias: true
      })
    this.mesh = new PerspectiveMesh({
      texture: backTexture,
      verticesX: 10,
      verticesY: 10
    })
    this.mesh.eventMode = 'none'
    this.mesh.label = `${target.label || 'game.card-back'}.draw`
    this.wasVisible = target.visible
    target.visible = false
    layer.addChild(this.mesh)
    this.update(0)
  }

  update(progress: number): void {
    if (this.disposed) return
    const pose = drawFlightPose(this.start, this.end, progress, !!this.frontTexture)
    this.mesh.texture = pose.front ? this.frontTexture! : this.backTexture
    this.mesh.visible = !pose.edgeOn
    const [a, b, c, d] = pose.corners
    this.mesh.setCorners(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (!this.target.destroyed) this.target.visible = this.wasVisible
    this.mesh.removeFromParent()
    this.mesh.destroy()
    this.frontTexture?.destroy(true)
  }
}
