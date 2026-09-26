import { Container, PerspectiveMesh, Rectangle, Sprite, type Renderer } from 'pixi.js'
import type { GameCardSlot } from './game-card-slot'
import { CARD_DRAW_LAYOUT } from './card-draw-layout'
import { Burn } from '../../rendering/effects/burn'
import { isArtworkVisible } from '../../rendering/effects/premium-artwork-breath'
import {
  getShadowCaster,
  shadowBodyCorners,
  type ShadowCaster
} from '../../rendering/shadows/shadow-caster'
import { MATCH_SHADOW_CONFIG } from '../../rendering/shadows/match-shadow-config'

type Point = { x: number; y: number }
type RevealPeak = Point & { scale?: number }
export type DrawCorners = readonly [Point, Point, Point, Point]

const mix = (a: number, b: number, t: number): number => a + (b - a) * t
const smooth = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

export type CardDrawProfile =
  | 'direct'
  | 'local-reveal'
  | 'remote-reveal'
  | 'mulligan-reveal'
  | 'public-reveal'
  | 'remote-public-reveal'
type FlightPose = {
  corners: DrawCorners
  front: boolean
  edgeOn: boolean
  magnification: number
}
type FlightFrame = {
  at: number
  x: number
  y: number
  scale: number
  rotation: number
  planeRotation: number
  yaw: number
  taper: number
}
type FlightChannel = Exclude<keyof FlightFrame, 'at'>

const cornerCenter = (corners: DrawCorners): Point => ({
  x: corners.reduce((sum, point) => sum + point.x, 0) / 4,
  y: corners.reduce((sum, point) => sum + point.y, 0) / 4
})

/** Continuous, monotone cubic channels pass checkpoints without stopping at each one. */
function sampleFlightChannel(
  frames: readonly FlightFrame[],
  index: number,
  channel: FlightChannel,
  progress: number,
  peakAt: number,
  peakTangentScale: number
): number {
  const tangent = (i: number): number => {
    if (i === 0 || i === frames.length - 1) return 0
    const previous = frames[i - 1]
    const current = frames[i]
    const next = frames[i + 1]
    const before = current.at - previous.at
    const after = next.at - current.at
    const left = (current[channel] - previous[channel]) / before
    const right = (next[channel] - current[channel]) / after
    if (left * right <= 0) return 0
    const w1 = 2 * after + before
    const w2 = after + 2 * before
    const slope = (w1 + w2) / (w1 / left + w2 / right)
    return slope * (current.at === peakAt ? peakTangentScale : 1)
  }
  const a = frames[index]
  const b = frames[index + 1]
  const duration = b.at - a.at
  const t = (progress - a.at) / duration
  const t2 = t * t
  const t3 = t2 * t
  return (
    (2 * t3 - 3 * t2 + 1) * a[channel] +
    (t3 - 2 * t2 + t) * duration * tangent(index) +
    (-2 * t3 + 3 * t2) * b[channel] +
    (t3 - t2) * duration * tangent(index + 1)
  )
}

/** Prepares a local reveal that settles into a hand or mulligan slot. */
export function createLocalDrawFlight(
  start: DrawCorners,
  end: DrawCorners,
  width: number,
  height: number,
  profile: Exclude<CardDrawProfile, 'direct'> = 'local-reveal',
  peakPosition?: RevealPeak
): (progress: number) => FlightPose {
  const layout = CARD_DRAW_LAYOUT.localReveal
  const mulligan = profile === 'mulligan-reveal'
  // Clockwise landscape orientation maps the texture's top edge to the deck's right edge.
  const departureCorners: DrawCorners = [start[1], start[2], start[3], start[0]]
  const a = cornerCenter(start)
  const b = cornerCenter(end)
  const startHeight = Math.hypot(start[3].x - start[0].x, start[3].y - start[0].y)
  const startWidth = Math.hypot(start[1].x - start[0].x, start[1].y - start[0].y)
  const endHeight = Math.hypot(end[3].x - end[0].x, end[3].y - end[0].y)
  const endRotation = Math.atan2(end[1].y - end[0].y, end[1].x - end[0].x)
  const radians = Math.PI / 180
  const first: FlightFrame = {
    at: 0,
    ...a,
    scale: startHeight / width,
    rotation: 0,
    planeRotation: Math.PI / 2,
    yaw: Math.acos(Math.min(0.95, startWidth / ((startHeight * height) / width))),
    taper: layout.departureTaper
  }
  const reveal = layout.reveal.map((key): FlightFrame => ({
    at: key.at / layout.duration,
    ...key.pose.position,
    y: mulligan
      ? key.mulliganY
      : profile === 'remote-reveal' || profile === 'remote-public-reveal'
        ? CARD_DRAW_LAYOUT.remoteRevealMirrorY - key.pose.position.y
        : key.pose.position.y,
    scale: key.pose.scale?.x ?? 1,
    rotation: (mulligan ? key.mulliganRotation : key.rotation) * radians,
    planeRotation: key.planeRotation * radians,
    yaw: key.yaw * radians,
    taper: key.taper
  }))
  const peak = reveal[reveal.length - 1]
  if (peakPosition) {
    const dx = peakPosition.x - peak.x
    const dy = peakPosition.y - peak.y
    const scaleRatio = (peakPosition.scale ?? peak.scale) / peak.scale
    for (const frame of reveal) {
      const weight = smooth(frame.at / peak.at)
      frame.x += dx * weight
      frame.y += dy * weight
      frame.scale *= mix(1, scaleRatio, weight)
    }
  }
  const last: FlightFrame = {
    at: 1,
    ...b,
    scale: endHeight / height,
    rotation: endRotation,
    planeRotation: 0,
    yaw: Math.PI,
    taper: 1
  }
  const frames: FlightFrame[] = [
    first,
    ...reveal,
    ...layout.descent.map((key): FlightFrame => ({
      at: key.at / layout.duration,
      x: mix(peak.x, b.x, key.handProgress),
      y: mix(peak.y, b.y, key.handProgress) + (mulligan ? 0 : key.drop),
      scale: mix(peak.scale, last.scale, key.scaleProgress),
      rotation: mulligan
        ? key.mulliganRotation * radians
        : endRotation * key.rotationProgress,
      planeRotation: 0,
      yaw: Math.PI,
      taper: 1
    })),
    last
  ]

  const project = (pose: FlightFrame): DrawCorners => {
    const cosine = Math.cos(pose.yaw)
    const planeCosine = Math.cos(pose.planeRotation)
    const planeSine = Math.sin(pose.planeRotation)
    const planeHeight =
      (width * Math.abs(planeSine) + height * Math.abs(planeCosine)) * pose.scale
    const taperDepth = (1 - pose.taper) / (1 + pose.taper)
    const corners = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5]
    ].map(([u, v]): Point => {
      const localX = u * width * pose.scale
      const localY = v * height * pose.scale
      // Turn the card in its own plane before foreshortening its horizontal axis.
      const x = localX * planeCosine - localY * planeSine
      const y = localX * planeSine + localY * planeCosine
      // Exchange the physical near/far edges on the front, keeping text readable.
      const depth = -x * (cosine < 0 ? -1 : 1) * Math.sin(pose.yaw)
      const perspective =
        1 /
        (1 +
          depth / CARD_DRAW_LAYOUT.perspectiveDepth +
          ((2 * y) / planeHeight) * taperDepth)
      const px = x * Math.max(0.001, Math.abs(cosine)) * perspective
      const py = y * perspective
      return {
        x: px * Math.cos(pose.rotation) - py * Math.sin(pose.rotation),
        y: px * Math.sin(pose.rotation) + py * Math.cos(pose.rotation)
      }
    }) as unknown as DrawCorners
    const center = cornerCenter(corners)
    return corners.map((p) => ({
      x: pose.x + p.x - center.x,
      y: pose.y + p.y - center.y
    })) as unknown as DrawCorners
  }

  const finalCorners = project(last)
  return (progress): FlightPose => {
    if (progress <= 0)
      return {
        corners: departureCorners,
        front: false,
        edgeOn: false,
        magnification: first.scale / last.scale
      }
    if (progress >= 1)
      return { corners: end, front: true, edgeOn: false, magnification: 1 }
    const index = frames.findIndex(
      (_, i) => i < frames.length - 1 && progress < frames[i + 1].at
    )
    const channel = (key: FlightChannel): number =>
      sampleFlightChannel(
        frames,
        index,
        key,
        progress,
        peak.at,
        mulligan ? layout.peakTangentScale : 0
      )
    const pose: FlightFrame = {
      at: progress,
      x: channel('x'),
      y: channel('y'),
      scale: channel('scale'),
      rotation: channel('rotation'),
      planeRotation: channel('planeRotation'),
      yaw: channel('yaw'),
      taper: channel('taper')
    }
    const turn = smooth(
      Math.max(
        0,
        Math.min(
          1,
          (progress * layout.duration - layout.departureTurnStart) /
            (layout.departureRelease - layout.departureTurnStart)
        )
      )
    )
    const departureScale = pose.scale / first.scale
    const arrival = smooth(Math.max(0, (progress - peak.at) / (1 - peak.at)))
    const corners = project(pose).map((p, i) => ({
      // Preserve the painted deck's taper and orientation during the rightward slide.
      // Release the scaled silhouette smoothly into the existing rigid-plane turn.
      x:
        mix(pose.x + (departureCorners[i].x - a.x) * departureScale, p.x, turn) +
        (end[i].x - finalCorners[i].x) * arrival,
      y:
        mix(a.y + (departureCorners[i].y - a.y) * departureScale, p.y, turn) +
        (end[i].y - finalCorners[i].y) * arrival
    })) as unknown as DrawCorners
    const cosine = Math.cos(pose.yaw)
    return {
      corners,
      front: cosine < 0,
      edgeOn: Math.abs(cosine) < 0.012,
      magnification: pose.scale / last.scale
    }
  }
}

/** A rigid plane turning in flight, with an authored departure silhouette. */
export function drawFlightPose(
  start: DrawCorners,
  end: DrawCorners,
  progress: number,
  reveal: boolean
): FlightPose {
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
    edgeOn: Math.abs(cosine) < 0.012,
    magnification: scale
  }
}

/** Owns only flight visuals; the live target already holds its destination pose. */
export class CardDrawAnimation {
  private burn?: Burn
  private readonly mesh: PerspectiveMesh
  private readonly frontTexture?: ReturnType<Renderer['generateTexture']>
  private readonly start: DrawCorners
  private readonly end: DrawCorners
  private readonly wasVisible: boolean
  private readonly localFlight?: (progress: number) => FlightPose
  private disposed = false
  private readonly shadow: ShadowCaster | undefined
  private readonly previousShadowVisual: Container | undefined
  private readonly previousShadowMinimum: number
  private readonly destinationMagnification: number
  private readonly shadowFrame: Rectangle

  constructor(
    renderer: Renderer,
    layer: Container,
    deck: Sprite,
    private readonly target: GameCardSlot | Sprite,
    private readonly backTexture: Sprite['texture'],
    slot?: GameCardSlot,
    profile: CardDrawProfile = 'direct',
    peakPosition?: RevealPeak
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
    this.shadow = getShadowCaster(target)
    this.previousShadowVisual = this.shadow?.visual
    this.previousShadowMinimum = this.shadow?.minimumHeight ?? 0
    this.destinationMagnification =
      Math.abs(target.scale.y) / (this.shadow?.restingScale ?? 1)
    const bounds = face.getLocalBounds()
    const frame = new Rectangle(bounds.minX, bounds.minY, bounds.width, bounds.height)
    this.shadowFrame = frame
    this.end = [
      { x: frame.x, y: frame.y },
      { x: frame.right, y: frame.y },
      { x: frame.right, y: frame.bottom },
      { x: frame.x, y: frame.bottom }
    ].map((p) => layer.toLocal(face.toGlobal(p))) as unknown as DrawCorners
    if (profile !== 'direct' && slot)
      this.localFlight = createLocalDrawFlight(
        this.start,
        this.end,
        frame.width,
        frame.height,
        profile,
        peakPosition
      )
    if (slot)
      this.frontTexture = slot.card.createAppearanceSnapshot(
        renderer,
        frame,
        () =>
          !this.disposed &&
          isArtworkVisible(this.mesh) &&
          this.mesh.texture === this.frontTexture
      )
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
    if (this.shadow) this.shadow.visual = this.mesh
    this.update(0)
  }

  update(progress: number, scale = 1): void {
    if (this.disposed) return
    const pose = this.localFlight
      ? this.localFlight(progress)
      : drawFlightPose(this.start, this.end, progress, !!this.frontTexture)
    this.mesh.texture = pose.front ? this.frontTexture! : this.backTexture
    this.mesh.visible = !pose.edgeOn
    const center = cornerCenter(pose.corners)
    const corners =
      scale === 1
        ? pose.corners
        : (pose.corners.map((point) => ({
            x: center.x + (point.x - center.x) * scale,
            y: center.y + (point.y - center.y) * scale
          })) as unknown as DrawCorners)
    const [a, b, c, d] = corners
    this.mesh.setCorners(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)
    if (this.shadow?.visual === this.mesh) {
      this.shadow.corners = shadowBodyCorners(
        corners,
        this.shadowFrame,
        this.shadow.bounds
      )
      this.shadow.magnification = pose.magnification * this.destinationMagnification
      // The existing flight arc also lifts direct draws that do not enlarge.
      this.shadow.minimumHeight = Math.max(
        this.previousShadowMinimum,
        MATCH_SHADOW_CONFIG.heldCardHeight *
          Math.sin(Math.PI * Math.max(0, Math.min(1, progress)))
      )
    }
  }

  updateBurn(progress: number, noise: Sprite['texture']): void {
    if (this.disposed) return
    if (!this.burn) {
      this.burn = new Burn(noise)
      this.mesh.filters = [...(this.mesh.filters ?? []), this.burn.filter]
      // The geometric shadow cannot follow dissolved holes. Hide its original
      // silhouette while burning instead of leaving a solid card-shaped shadow.
      if (this.shadow) this.shadow.visual = this.target
    }
    this.burn.setProgress(progress)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (
      this.shadow &&
      (this.shadow.visual === this.mesh || this.burn) &&
      this.previousShadowVisual
    ) {
      this.shadow.visual = this.previousShadowVisual
      this.shadow.corners = null
      this.shadow.magnification = null
      this.shadow.minimumHeight = this.previousShadowMinimum
    }
    if (!this.target.destroyed) this.target.visible = this.wasVisible
    if (this.burn) {
      this.mesh.filters = (this.mesh.filters ?? []).filter(
        (filter) => filter !== this.burn!.filter
      )
      this.burn.destroy()
    }
    this.mesh.removeFromParent()
    this.mesh.destroy()
    this.frontTexture?.destroy(true)
  }
}
