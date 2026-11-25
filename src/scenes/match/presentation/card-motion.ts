import authored from './card-motion-authored.json'
import { CARD_MOTION_LAYOUT as L } from './card-motion-layout'
import { cardDeckSlot, slotPoint, type CardDeckSlot } from './card-deck-slot'

export type MotionPoint = { x: number; y: number }
export type MotionCorners = readonly [
  MotionPoint,
  MotionPoint,
  MotionPoint,
  MotionPoint
]
export type MotionPose = {
  corners: MotionCorners
  front: boolean
  edgeOn: boolean
  magnification: number
  /** Complete card stays intact; this projected crop exposes its top portion. */
  slot?: CardDeckSlot
  exposure?: number
  visibleCorners?: MotionCorners
  plane?: {
    center: MotionPoint
    width: number
    height: number
    quaternion: Quaternion
    rotation: number
    cameraDepth: number
    offset: MotionPoint
  }
}
export interface MotionLaunch {
  center: MotionPoint
  width: number
  height: number
  rotation: number
  tiltX: number
  tiltY: number
  cameraDepth: number
  offset?: MotionPoint
}
export type DeckMotionProfile =
  | 'opponent-draw'
  | 'public-draw'
  | 'conceal-hand'
  | 'insert'
  | 'hand-return'
  | 'trade'
  | 'mulligan-return'
  | 'mulligan-replacement'
  | 'opening-deal'
  | 'deck-to-play'
  | 'reveal-return'
  | 'reveal-only'
  | 'fatigue'
export interface CardMotionContext {
  start: MotionCorners
  end: MotionCorners
  hidden?: boolean
  remote?: boolean
  sequence?: number
  timeScale?: number
  aspectRatio?: number
  launch?: MotionLaunch
  slot?: CardDeckSlot
}
export interface CardMotionPlayback {
  duration: number
  sample(seconds: number): MotionPose
}
type V3 = readonly [number, number, number]
export type Quaternion = readonly [number, number, number, number]
type CurveKey = {
  time: number
  value: number[]
  inSlope: (number | string)[]
  outSlope: (number | string)[]
}
export const clamp = (t: number): number => Math.max(0, Math.min(1, t))
const mix = (a: number, b: number, t: number): number => a + (b - a) * t
const smooth = (t: number): number => {
  t = clamp(t)
  return t * t * (3 - 2 * t)
}
export const motionCenter = (c: MotionCorners): MotionPoint => ({
  x: c.reduce((s, p) => s + p.x, 0) / 4,
  y: c.reduce((s, p) => s + p.y, 0) / 4
})
export const cubicIn = (t: number): number => clamp(t) ** 3
export const cubicOut = (t: number): number => 1 - (1 - clamp(t)) ** 3
export const cubicInOut = (t: number): number => {
  t = clamp(t)
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
}
export const quartInOut = (t: number): number => {
  t = clamp(t)
  return t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2
}
const quintInOut = (t: number): number => {
  t = clamp(t)
  return t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2
}
const expoOut = (t: number): number => (t >= 1 ? 1 : 1 - 2 ** (-10 * clamp(t)))
const quadInOut = (t: number): number => {
  t = clamp(t)
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}
// In the installed iTween, easeInSineOutExpo(0, 1, t) selects expoOut for t > 0.
const drawEase = expoOut
const backOut = (progress: number): number => {
  const t = clamp(progress) - 1
  return 1 + t * t * (2.70158 * t + 1.70158)
}

/** Unity unweighted cubic curves: tangent values are derivatives per second. */
export function sampleMotionCurve(keys: readonly CurveKey[], time: number): number[] {
  if (time <= keys[0].time) return [...keys[0].value]
  if (time >= keys[keys.length - 1].time) return [...keys[keys.length - 1].value]
  const index = keys.findIndex((k) => k.time > time)
  const a = keys[index - 1],
    b = keys[index],
    dt = b.time - a.time,
    t = (time - a.time) / dt
  return a.value.map((v, i) => {
    const out = a.outSlope[i],
      incoming = b.inSlope[i]
    if (typeof out !== 'number' || typeof incoming !== 'number') return v
    return (
      (2 * t ** 3 - 3 * t * t + 1) * v +
      (t ** 3 - 2 * t * t + t) * dt * out +
      (-2 * t ** 3 + 3 * t * t) * b.value[i] +
      (t ** 3 - t * t) * dt * incoming
    )
  })
}

function multiply(a: Quaternion, b: Quaternion): Quaternion {
  const [x, y, z, w] = a,
    [X, Y, Z, W] = b
  return [
    w * X + x * W + y * Z - z * Y,
    w * Y - x * Z + y * W + z * X,
    w * Z + x * Y - y * X + z * W,
    w * W - x * X - y * Y - z * Z
  ]
}
function slerp(a: Quaternion, b: Quaternion, progress: number): Quaternion {
  const t = clamp(progress),
    an = Math.hypot(...a),
    bn = Math.hypot(...b)
  const A = a.map((v) => v / an),
    B = b.map((v) => v / bn)
  let dot = A.reduce((s, v, i) => s + v * B[i], 0)
  if (dot < 0) {
    dot = -dot
    for (let i = 0; i < 4; i++) B[i] = -B[i]
  }
  const angle = Math.acos(Math.min(1, dot)),
    sin = Math.sin(angle)
  const x = sin < 0.00001 ? 1 - t : Math.sin((1 - t) * angle) / sin,
    y = sin < 0.00001 ? t : Math.sin(t * angle) / sin
  return A.map((v, i) => v * x + B[i] * y) as unknown as Quaternion
}
/** Unity Euler order is Z, X, Y, not a sequence of screen-space skews. */
export function motionEuler(x: number, y: number, z: number): Quaternion {
  const r = Math.PI / 360
  x *= r
  y *= r
  z *= r
  return multiply(
    multiply([0, Math.sin(y), 0, Math.cos(y)], [Math.sin(x), 0, 0, Math.cos(x)]),
    [0, 0, Math.sin(z), Math.cos(z)]
  )
}
function rotate(v: V3, q: Quaternion): V3 {
  const length = Math.hypot(...q),
    [x, y, z, w] = q.map((n) => n / length)
  const [a, b, c] = v,
    tx = 2 * (y * c - z * b),
    ty = 2 * (z * a - x * c),
    tz = 2 * (x * b - y * a)
  return [
    a + w * tx + y * tz - z * ty,
    b + w * ty + z * tx - x * tz,
    c + w * tz + x * ty - y * tx
  ]
}
/** A card lies in Unity's X/Z plane. Y is depth, including perspective foreshortening. */
export function projectMotionPlane(
  center: MotionPoint,
  width: number,
  height: number,
  q: Quaternion,
  rotation = 0,
  cameraDepth = L.cameraDepth as number,
  offset: MotionPoint = { x: 0, y: 0 },
  exposure = 1
): { corners: MotionCorners; facing: number } {
  const normal = rotate([0, 1, 0], q),
    cs = Math.cos(L.cameraSideAngle),
    sn = Math.sin(L.cameraSideAngle)
  const facing = normal[0] * sn + normal[1] * cs,
    front = facing >= 0
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, exposure - 0.5],
    [-0.5, exposure - 0.5]
  ].map(([u, v]) => {
    const [worldX, worldY, z] = rotate(
      [u * width * (front ? 1 : -1) + offset.x, 0, -v * height - offset.y],
      q
    )
    const x = worldX * cs - worldY * sn,
      depth = worldX * sn + worldY * cs
    const p = cameraDepth / (cameraDepth - depth),
      y = -z
    return {
      x: center.x + (x * Math.cos(rotation) - y * Math.sin(rotation)) * p,
      y: center.y + (x * Math.sin(rotation) + y * Math.cos(rotation)) * p
    }
  }) as unknown as MotionCorners
  return { corners, facing }
}

/** Back at yaw 0, front at 180; in-plane rotation keeps the card rectangular. */
export function cardRotation(yaw: number, inPlane: number): Quaternion {
  return multiply(
    motionEuler(0, 0, (-L.cameraSideAngle * 180) / Math.PI),
    // Positive camera depth approaches the eye. The exposed top must lean toward
    // it, while the bottom inserted into the deck recedes.
    multiply(motionEuler(0, 0, yaw - 180), motionEuler(0, -inPlane, 0))
  )
}

/** One full card, half seated. Every recipe uses the same physical resting pose. */
export function deckCardGeometry(slot: CardDeckSlot, aspect = 620 / 900) {
  const width = L.slot.fullCardWidth * slot.scale,
    height = width / aspect,
    quaternion = cardRotation(L.slot.yaw, 90),
    rotation = Math.atan2(slot.outward.y, slot.outward.x)
  const corners = projectMotionPlane({ x: 0, y: 0 }, width, height, quaternion).corners
  const bottom = (corners[2].x + corners[3].x) / 2
  return {
    width,
    height,
    quaternion,
    rotation,
    seated: slot.mouth,
    gate: slotPoint(slot, -bottom, -L.slot.approachLift * slot.scale)
  }
}

/** Project the crop using the very same plane and UV coordinates as the full card. */
export function exposeCard(
  pose: MotionPose,
  slot: CardDeckSlot,
  exposure: number
): MotionPose {
  const plane = pose.plane!
  return {
    ...pose,
    slot,
    exposure,
    visibleCorners:
      exposure < 1
        ? projectMotionPlane(
            plane.center,
            plane.width,
            plane.height,
            plane.quaternion,
            plane.rotation,
            plane.cameraDepth,
            plane.offset,
            exposure
          ).corners
        : undefined
  }
}

/** iTween's Catmull-Rom spline with extrapolated endpoint control points. */
export function motionSpline(
  points: readonly MotionPoint[],
  progress: number
): MotionPoint {
  const t = clamp(progress) * (points.length - 1),
    index = Math.min(points.length - 2, Math.floor(t)),
    u = t - index
  const b = points[index],
    c = points[index + 1],
    a = points[index - 1] ?? { x: 2 * b.x - c.x, y: 2 * b.y - c.y },
    d = points[index + 2] ?? { x: 2 * c.x - b.x, y: 2 * c.y - b.y }
  const axis = (key: 'x' | 'y') =>
    0.5 *
    (2 * b[key] +
      (-a[key] + c[key]) * u +
      (2 * a[key] - 5 * b[key] + 4 * c[key] - d[key]) * u * u +
      (-a[key] + 3 * b[key] - 3 * c[key] + d[key]) * u ** 3)
  return { x: axis('x'), y: axis('y') }
}
const dimensions = (c: MotionCorners) => ({
  width: Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y),
  height: Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y),
  rotation: Math.atan2(c[1].y - c[0].y, c[1].x - c[0].x)
})

export function createCardMotion(
  profile: DeckMotionProfile,
  context: CardMotionContext
): CardMotionPlayback {
  const { start, end, hidden = false, remote = false, sequence = 0 } = context
  const launch = context.launch
  let a = launch?.center ?? motionCenter(start),
    b = motionCenter(end)
  const from = { ...dimensions(start), ...launch },
    to = dimensions(end)
  const aspect = context.aspectRatio ?? 620 / 900
  const neutral = motionEuler(0, 0, (-L.cameraSideAngle * 180) / Math.PI)
  const initialRotation = launch
    ? multiply(
        multiply(neutral, motionEuler(-launch.tiltX, 0, 0)),
        motionEuler(0, 0, launch.tiltY)
      )
    : neutral
  const insertion =
    profile === 'insert' || profile === 'hand-return' || profile === 'trade'
  const returning = profile === 'mulligan-return',
    replacement = profile === 'mulligan-replacement'
  const opening = profile === 'opening-deal',
    opponent = profile === 'opponent-draw' || profile === 'public-draw',
    recruit = profile === 'deck-to-play'
  const publicDraw = profile === 'public-draw',
    conceal = profile === 'conceal-hand'
  const revealReturn = profile === 'reveal-return',
    revealOnly = profile === 'reveal-only',
    fatigue = profile === 'fatigue'
  const stage =
    profile === 'hand-return'
      ? L.handReturn.stage + sequence * L.handReturn.stagger
      : profile === 'trade'
        ? L.tradePause
        : 0
  const baseDuration = insertion
    ? stage + L.insertion.approach + L.insertion.descend
    : conceal
      ? L.publicDraw.hide
      : opponent
        ? L.remoteDraw.duration
        : recruit
          ? L.deckToPlay.travelStart + L.deckToPlay.travel
          : opening
            ? L.mulligan.deal + L.mulligan.spread
            : revealReturn
              ? L.revealOnly.hide
              : revealOnly
                ? L.revealOnly.show + L.revealOnly.flip
                : fatigue
                  ? L.fatigue.turnDelay + L.fatigue.turn
                  : L.mulligan.return
  const timeScale = context.timeScale ?? 1
  const duration = baseDuration * timeScale
  const clip = authored.clips.MulliganCardFlipDownToDeck
  const qTrack = clip.tracks.find((t) => t.property === 'quaternion')!,
    sTrack = clip.tracks.find((t) => t.property === 'scale')!
  const usesSlot = !conceal && !fatigue
  const slot =
    context.slot ?? cardDeckSlot(insertion || returning || revealReturn ? b : a)
  const deck = deckCardGeometry(slot, aspect)
  const deckHeight = deck.height,
    seated = deck.seated,
    above = deck.gate
  const extraction = L.slot.extraction
  if (usesSlot) {
    if (insertion || returning || revealReturn) b = seated
    else a = seated
  }
  const raw = (seconds: number): MotionPose => {
    const t = Math.max(0, Math.min(baseDuration, seconds)),
      p = t / baseDuration
    let center: MotionPoint, q: Quaternion, height: number, rotation: number
    let exposure = 1
    const enter = (fraction: number) => {
      const f = cubicInOut(fraction)
      center = { x: mix(above.x, seated.x, f), y: mix(above.y, seated.y, f) }
      q = deck.quaternion
      rotation = deck.rotation
      height = deckHeight
      exposure = mix(1, L.slot.exposedFraction, f)
    }
    if (insertion) {
      const v = t - stage,
        align = cubicInOut(v / L.insertion.align),
        turn = cubicInOut(
          v / (L.insertion.align + (hidden ? L.insertion.hiddenTurn : L.insertion.turn))
        )
      const staged = { x: a.x, y: a.y + (remote ? 1 : -1) * 3 * L.sourceUnit }
      const grow =
        profile === 'hand-return' ? mix(1, L.handReturn.grow, expoOut(t / 1.75)) : 1
      const departure = profile === 'hand-return' ? staged : a
      if (v < 0)
        center = {
          x: mix(a.x, departure.x, expoOut(t / 1.75)),
          y: mix(a.y, departure.y, expoOut(t / 1.75))
        }
      else if (v < L.insertion.approach) {
        const f = cubicInOut(v / L.insertion.approach)
        center = { x: mix(departure.x, above.x, f), y: mix(departure.y, above.y, f) }
      } else center = above // The shared entry below completes the insertion.
      q = slerp(initialRotation, deck.quaternion, turn)
      rotation = mix(from.rotation, deck.rotation, align)
      // Establish full-card size before entry. Visibility never drives card scale.
      height = mix(from.height * grow, deckHeight, cubicInOut(v / L.insertion.approach))
      if (v >= L.insertion.approach)
        enter((v - L.insertion.approach) / L.insertion.descend)
    } else if (returning || replacement) {
      const clock = returning ? t : baseDuration - t,
        approach = baseDuration - L.slot.mulliganEntry,
        u = clamp(clock / approach),
        cp = clock
      // The source clip begins at identity; calibrate it to our flat displayed face.
      q = multiply(neutral, sampleMotionCurve(qTrack.keys, cp) as unknown as Quaternion)
      const scale = sampleMotionCurve(sTrack.keys, cp)[0] / 1.1
      const origin = returning ? a : b
      center = motionSpline(
        [
          origin,
          { x: origin.x + 2 * L.sourceUnit, y: origin.y + 1.7 * L.sourceUnit },
          above
        ],
        cubicOut(u)
      )
      height = (returning ? from.height : to.height) * scale
      const settle = smooth((u - 0.55) / 0.45)
      // Adapt the authored turn to our camera throughout the flight. Waiting until
      // the size settles lets its normal cross back onto the front a second time.
      q = slerp(q, deck.quaternion, smooth(u))
      height = mix(height, deckHeight, settle)
      rotation = mix(returning ? from.rotation : to.rotation, deck.rotation, u)
      if (clock >= approach) enter((clock - approach) / L.slot.mulliganEntry)
    } else if (conceal) {
      const turn = cubicInOut(p),
        move = expoOut(t / 0.5)
      center = { x: mix(a.x, b.x, move), y: mix(a.y, b.y, move) }
      q = multiply(neutral, motionEuler(0, 0, 180 * turn))
      rotation = mix(from.rotation, to.rotation, move)
      height = mix(from.height, to.height, move)
    } else if (opponent) {
      const f = quartInOut((t - extraction) / (baseDuration - extraction)),
        turn = cubicInOut((t - L.remoteDraw.turnStart) / L.remoteDraw.turnDuration),
        size = quintInOut((t - L.remoteDraw.turnStart) / L.remoteDraw.turnDuration)
      const lift = above
      center = motionSpline(
        publicDraw
          ? [lift, { x: mix(lift.x, b.x, 0.5), y: b.y }, b]
          : [lift, { x: mix(a.x, b.x, 0.48), y: mix(a.y, b.y, 0.65) }, b],
        f
      )
      q = slerp(deck.quaternion, neutral, turn)
      rotation = mix(deck.rotation, to.rotation, turn)
      const s = mix(deckHeight / Math.max(1, to.height), 1, size)
      height = to.height * s
    } else if (revealReturn) {
      const approach = baseDuration - L.slot.revealEntry,
        u = clamp(t / approach),
        turn = cubicInOut(u),
        size = quintInOut(u)
      center = motionSpline(
        [a, { x: mix(a.x, above.x, 0.6), y: above.y }, above],
        quadInOut(u)
      )
      q = slerp(neutral, deck.quaternion, turn)
      rotation = mix(from.rotation, deck.rotation, turn)
      height = mix(from.height, deckHeight, size)
      if (t >= approach) enter((t - approach) / L.slot.revealEntry)
    } else if (opening) {
      const table = {
        x: 960 + (b.x - 960) * L.mulligan.tableSpread,
        y: b.y + L.mulligan.tableDrop
      }
      if (t < L.mulligan.deal) {
        center = motionSpline(
          [above, { x: mix(above.x, table.x, 0.5), y: table.y }, table],
          drawEase((t - extraction) / (L.mulligan.deal - extraction))
        )
        const clip = authored.clips.MulliganCardDeck2FlipDown
        q = sampleMotionCurve(
          clip.tracks.find((t) => t.property === 'quaternion')!.keys,
          t
        ) as unknown as Quaternion
        const s =
          sampleMotionCurve(
            clip.tracks.find((t) => t.property === 'scale')!.keys,
            t
          )[0] / 1.1
        height = to.height * s
        const release = smooth((t - extraction) / 0.25)
        q = slerp(deck.quaternion, q, release)
        height = mix(deckHeight, height, release)
      } else {
        const clip = authored.clips.MulliganCardFlipFromFaceDown,
          elapsed = t - L.mulligan.deal
        const f = cubicInOut(elapsed / L.mulligan.spread)
        center = { x: mix(table.x, b.x, f), y: mix(table.y, b.y, f) }
        q = sampleMotionCurve(
          clip.tracks.find((t) => t.property === 'quaternion')!.keys,
          elapsed
        ) as unknown as Quaternion
        const s =
          sampleMotionCurve(
            clip.tracks.find((t) => t.property === 'scale')!.keys,
            elapsed
          )[0] / 1.1
        height = to.height * s
      }
      rotation = mix(deck.rotation, to.rotation, smooth((t - extraction) / 0.25))
    } else if (recruit) {
      const aboveStart = above
      const travel = expoOut((t - L.deckToPlay.travelStart) / L.deckToPlay.travel)
      center = {
        x: mix(aboveStart.x, b.x, travel),
        y: mix(aboveStart.y, b.y, travel)
      }
      const turn = cubicInOut((t - L.deckToPlay.approach) / L.deckToPlay.turn)
      q = slerp(deck.quaternion, neutral, turn)
      rotation = mix(deck.rotation, to.rotation, turn)
      const s = mix(deckHeight / Math.max(1, to.height), 1, travel)
      height = to.height * s
    } else if (revealOnly) {
      const travel = L.revealOnly.show,
        half = travel / 2
      center = motionSpline(
        [above, { x: mix(above.x, b.x, 0.5), y: b.y }, b],
        quartInOut((t - extraction) / (travel - extraction))
      )
      const back = multiply(neutral, motionEuler(0, 0, 180))
      q =
        t < travel
          ? slerp(deck.quaternion, back, cubicInOut((t - half) / half))
          : multiply(
              neutral,
              motionEuler(0, 0, 180 * (1 - backOut((t - travel) / L.revealOnly.flip)))
            )
      const size = quintInOut((t - half) / half)
      height = to.height * mix(deckHeight / Math.max(1, to.height), 1, size)
      rotation = mix(deck.rotation, to.rotation, cubicInOut((t - half) / half))
    } else {
      const travel = L.fatigue.travel
      center = motionSpline(
        [a, { x: a.x + L.aboveDeck.x, y: a.y + L.aboveDeck.y }, b],
        drawEase(t / travel)
      )
      const turn = expoOut((t - L.fatigue.turnDelay) / L.fatigue.turn)
      q = motionEuler(mix(-90, 0, turn), mix(-90, 0, turn), 0)
      rotation = to.rotation
      const s = mix(
        L.deckCardWidth / Math.max(1, to.height * aspect),
        1,
        expoOut(t / L.fatigue.grow)
      )
      height = to.height * s
    }
    if (
      usesSlot &&
      !insertion &&
      !returning &&
      !replacement &&
      !revealReturn &&
      t < extraction
    )
      enter(1 - t / extraction)
    // Every frame is one rigid rectangle. Never interpolate or correct its corners.
    const width = height * aspect
    if (
      !insertion &&
      !returning &&
      !replacement &&
      !revealReturn &&
      !conceal &&
      !revealOnly
    )
      q = slerp(q, neutral, smooth((t - baseDuration + 0.2) / 0.2))
    const depth = mix(
      launch?.cameraDepth ?? L.cameraDepth,
      L.cameraDepth,
      smooth(t / 0.3)
    )
    const offset = {
      x: (launch?.offset?.x ?? 0) * (1 - smooth(t / 0.3)),
      y: (launch?.offset?.y ?? 0) * (1 - smooth(t / 0.3))
    }
    const projected = projectMotionPlane(
      center,
      width,
      height,
      q,
      rotation,
      depth,
      offset
    )
    const pose: MotionPose = {
      ...projected,
      front: !hidden && projected.facing > 0,
      edgeOn: Math.abs(projected.facing) < 0.008,
      magnification: height / Math.max(1, to.height),
      plane: {
        center,
        width,
        height,
        quaternion: q,
        rotation,
        cameraDepth: depth,
        offset
      }
    }
    return usesSlot ? exposeCard(pose, slot, exposure) : pose
  }
  return {
    duration,
    sample(seconds) {
      const t = Math.max(0, Math.min(baseDuration, seconds / timeScale)),
        p = t / baseDuration,
        pose = raw(t)
      return {
        ...pose,
        edgeOn: t > 0 && t < baseDuration && pose.edgeOn,
        front: hidden
          ? false
          : insertion || returning || revealReturn || conceal
            ? p < 0.999 && pose.front
            : p === 1 || pose.front
      }
    }
  }
}
