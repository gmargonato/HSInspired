import { Container, Sprite, type Renderer } from 'pixi.js'
import type { GameCardSlot } from '../hand/game-card-slot'
import { CARD_DRAW_LAYOUT } from './card-draw-layout'
import { CardFlightVisual } from './card-flight-visual'
import { deckMotionSlot } from './card-motion-visual'
import { cardDeckSlot, type CardDeckSlot } from './card-deck-slot'
import {
  createCardMotion,
  cardRotation,
  deckCardGeometry,
  exposeCard,
  projectMotionPlane,
  type MotionPose
} from './card-motion'
import { CARD_MOTION_LAYOUT } from './card-motion-layout'

type Point = { x: number; y: number }
type RevealPeak = Point & { scale?: number }
export type DrawCorners = readonly [Point, Point, Point, Point]

const mix = (a: number, b: number, t: number): number => a + (b - a) * t
const smooth = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

export type CardDrawProfile =
  | 'hidden-draw'
  | 'local-reveal'
  | 'remote-reveal'
  | 'mulligan-reveal'
  | 'mulligan-replacement'
  | 'public-reveal'
  | 'remote-public-reveal'
export type FlightPose = MotionPose

/** Shared by playback and captures; local reveal timing and landing remain intact. */
export function createDrawProfileFlight(
  start: DrawCorners,
  end: DrawCorners,
  width: number,
  height: number,
  profile: CardDrawProfile,
  faceVisible: boolean,
  peakPosition?: RevealPeak,
  slot?: CardDeckSlot
): (progress: number) => FlightPose {
  if (
    faceVisible &&
    (profile === 'mulligan-reveal' || profile === 'mulligan-replacement')
  ) {
    const flight = createLocalDrawFlight(
      start,
      end,
      width,
      height,
      peakPosition,
      slot,
      true
    )
    return (progress) => {
      const { approach, settle } = CARD_DRAW_LAYOUT.localMulligan
      const duration = CARD_DRAW_LAYOUT.localReveal.duration
      const time = Math.max(0, Math.min(1, progress)) * (approach + settle)
      return flight(
        (time <= approach
          ? time
          : approach + ((time - approach) * (duration - approach)) / settle) / duration
      )
    }
  }
  if (
    !faceVisible ||
    profile === 'mulligan-reveal' ||
    profile === 'mulligan-replacement'
  ) {
    const motion = createCardMotion(
      profile === 'mulligan-replacement'
        ? 'mulligan-replacement'
        : !faceVisible
          ? 'opponent-draw'
          : 'opening-deal',
      { start, end, hidden: !faceVisible, aspectRatio: width / height, slot }
    )
    return (progress) => motion.sample(progress * motion.duration)
  }
  const layout = CARD_DRAW_LAYOUT.localReveal,
    peakAt = layout.reveal.at(-1)!.at / layout.duration
  if (profile === 'remote-public-reveal' || profile === 'remote-reveal') {
    const peak = peakPosition ?? {
      x: CARD_MOTION_LAYOUT.reveal.x,
      y: CARD_MOTION_LAYOUT.reveal.remoteY,
      scale: 0.35
    }
    const w = (width * (peak.scale ?? 0.35)) / 2,
      h = (height * (peak.scale ?? 0.35)) / 2
    const corners: DrawCorners = [
      { x: peak.x - w, y: peak.y - h },
      { x: peak.x + w, y: peak.y - h },
      { x: peak.x + w, y: peak.y + h },
      { x: peak.x - w, y: peak.y + h }
    ]
    const show = createCardMotion('public-draw', {
      slot,
      start,
      end: corners,
      aspectRatio: width / height
    })
    const hide = createCardMotion('conceal-hand', {
      start: corners,
      end,
      aspectRatio: width / height
    })
    return (progress) =>
      progress <= peakAt
        ? show.sample((progress / peakAt) * show.duration)
        : hide.sample(((progress - peakAt) / (1 - peakAt)) * hide.duration)
  }
  return createLocalDrawFlight(start, end, width, height, peakPosition, slot)
}
type FlightFrame = {
  at: number
  x: number
  y: number
  scale: number
  rotation: number
  planeRotation: number
  yaw: number
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
  peakTangentScale = 0
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
    return current.at === peakAt ? slope * peakTangentScale : slope
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

/** Preserved local reveal choreography; opening and mulligan use the shared recipes. */
export function createLocalDrawFlight(
  start: DrawCorners,
  end: DrawCorners,
  width: number,
  height: number,
  peakPosition?: RevealPeak,
  slot?: CardDeckSlot,
  mulligan = false
): (progress: number) => FlightPose {
  const layout = CARD_DRAW_LAYOUT.localReveal
  const origin = cornerCenter(start)
  const opening =
    slot ??
    cardDeckSlot({
      x: origin.x - CARD_MOTION_LAYOUT.slot.mouthOffset.x,
      y: origin.y - CARD_MOTION_LAYOUT.slot.mouthOffset.y
    })
  const deck = deckCardGeometry(opening, width / height)
  const a = deck.seated
  const b = cornerCenter(end)
  const endHeight = Math.hypot(end[3].x - end[0].x, end[3].y - end[0].y)
  const endRotation = Math.atan2(end[1].y - end[0].y, end[1].x - end[0].x)
  const radians = Math.PI / 180
  const first: FlightFrame = {
    at: 0,
    ...a,
    scale: deck.width / width,
    rotation: deck.rotation,
    planeRotation: Math.PI / 2,
    yaw: CARD_MOTION_LAYOUT.slot.yaw * radians
  }
  const reveal = layout.reveal.map((key): FlightFrame => ({
    at: key.at / layout.duration,
    ...key.pose.position,
    scale: key.pose.scale?.x ?? 1,
    rotation: key.rotation * radians,
    planeRotation: key.planeRotation * radians,
    yaw: key.yaw * radians
  }))
  if (mulligan) {
    const ys = [...CARD_DRAW_LAYOUT.localMulligan.revealY, b.y]
    const rotations = CARD_DRAW_LAYOUT.localMulligan.revealRotation
    reveal.forEach((frame, index) => {
      frame.y = ys[index]
      frame.rotation = rotations[index] * radians
    })
  }
  // Extract a full-size rigid card first. Only then turn and enlarge for the reveal.
  reveal[0].scale = first.scale
  reveal[0].yaw = first.yaw
  reveal[0].rotation = first.rotation
  const peak = reveal[reveal.length - 1]
  if (peakPosition) {
    const dx = peakPosition.x - peak.x
    const dy = peakPosition.y - peak.y
    const scaleRatio = (peakPosition.scale ?? peak.scale) / peak.scale
    for (const frame of reveal) {
      const weight = smooth(
        Math.max(0, (frame.at - reveal[0].at) / (peak.at - reveal[0].at))
      )
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
    yaw: Math.PI
  }
  const frames: FlightFrame[] = [
    first,
    ...reveal,
    ...layout.descent.map((key, index): FlightFrame => ({
      at: key.at / layout.duration,
      x: mix(peak.x, b.x, key.handProgress),
      y: mix(peak.y, b.y, key.handProgress) + (mulligan ? 0 : key.drop),
      scale: mix(peak.scale, last.scale, key.scaleProgress),
      rotation: mulligan
        ? CARD_DRAW_LAYOUT.localMulligan.settleRotation[index] * radians
        : endRotation * key.rotationProgress,
      planeRotation: 0,
      yaw: Math.PI
    })),
    last
  ]

  return (progress): FlightPose => {
    progress = Math.max(0, Math.min(1, progress))
    const index = Math.max(
      0,
      frames.findIndex((_, i) => i < frames.length - 1 && progress < frames[i + 1].at)
    )
    const channel = (key: FlightChannel): number =>
      progress === 1
        ? last[key]
        : sampleFlightChannel(
            frames,
            index,
            key,
            progress,
            peak.at,
            mulligan ? CARD_DRAW_LAYOUT.localMulligan.peakTangentScale : 0
          )
    const plane = {
      center: { x: channel('x'), y: channel('y') },
      width: width * channel('scale'),
      height: height * channel('scale'),
      quaternion: cardRotation(
        channel('yaw') / radians,
        channel('planeRotation') / radians
      ),
      rotation: channel('rotation'),
      cameraDepth: CARD_MOTION_LAYOUT.cameraDepth,
      offset: { x: 0, y: 0 }
    }
    const projected = projectMotionPlane(
      plane.center,
      plane.width,
      plane.height,
      plane.quaternion,
      plane.rotation,
      plane.cameraDepth
    )
    const pose: MotionPose = {
      ...projected,
      plane,
      front: projected.facing > 0,
      edgeOn: Math.abs(projected.facing) < 0.008,
      magnification: channel('scale') / last.scale
    }
    const travel =
      (plane.center.x - a.x) * opening.outward.x +
      (plane.center.y - a.y) * opening.outward.y
    const clearance =
      (deck.gate.x - a.x) * opening.outward.x + (deck.gate.y - a.y) * opening.outward.y
    const exposure =
      progress < reveal[0].at
        ? Math.min(
            1,
            CARD_MOTION_LAYOUT.slot.exposedFraction +
              (1 - CARD_MOTION_LAYOUT.slot.exposedFraction) *
                Math.max(0, travel / clearance)
          )
        : 1
    return exposeCard(pose, opening, exposure)
  }
}

/** Local reveal choreography, using the same full-card geometry as other flights. */
export class CardDrawAnimation {
  private readonly visual: CardFlightVisual
  private readonly flight: (progress: number) => FlightPose

  constructor(
    renderer: Renderer,
    layer: Container,
    deck: Sprite,
    target: GameCardSlot | Sprite,
    backTexture: Sprite['texture'],
    slot?: GameCardSlot,
    profile: CardDrawProfile = 'local-reveal',
    peakPosition?: RevealPeak
  ) {
    const start = CARD_DRAW_LAYOUT.deckFace.map((p) =>
      layer.toLocal(
        deck.toGlobal({
          x: p.x - deck.anchor.x * deck.texture.width,
          y: p.y - deck.anchor.y * deck.texture.height
        })
      )
    ) as unknown as DrawCorners
    this.visual = new CardFlightVisual(renderer, layer, target, backTexture, {
      face: slot?.card ?? target,
      hidden: !slot,
      label: `${target.label || 'game.card-back'}.draw`,
      capture: slot
        ? (frame, active) => slot.card.createAppearanceSnapshot(renderer, frame, active)
        : undefined
    })
    this.flight = createDrawProfileFlight(
      start,
      this.visual.corners,
      this.visual.frame.width,
      this.visual.frame.height,
      profile,
      !!slot,
      peakPosition,
      deckMotionSlot(layer, deck)
    )
    this.update(0)
  }

  update(progress: number, scale = 1): void {
    this.visual.update(this.flight(progress), progress, scale)
  }
  updateBurn(progress: number, noise: Sprite['texture']): void {
    this.visual.updateBurn(progress, noise)
  }
  dispose(): void {
    this.visual.dispose()
  }
}
