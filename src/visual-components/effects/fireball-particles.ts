import source from './fireball-authored.json'
import { FIREBALL_LAYOUT as L } from './fireball-layout'

export type FireballCurve = readonly (readonly number[])[]
export interface FireballMinMax {
  mode: number
  min: number
  max: number
  lower: FireballCurve
  upper: FireballCurve
}
interface Gradient {
  rgb: FireballCurve
  alpha: FireballCurve
}
interface ParticleColor {
  mode: number
  min: number[]
  max: number[]
  lower: Gradient
  upper: Gradient
}
interface RawCurve {
  minMaxState: number
  scalar: number
  minScalar: number
  maxCurve: {
    m_Curve: { time: number; value: number; inSlope: number; outSlope: number }[]
  }
  minCurve: {
    m_Curve: { time: number; value: number; inSlope: number; outSlope: number }[]
  }
}
export interface FireballProfile {
  duration: number
  loop: boolean
  localSpace: boolean
  delay: FireballMinMax
  life: FireballMinMax
  speed: FireballMinMax
  size: FireballMinMax
  rotation: FireballMinMax
  spin: FireballMinMax | null
  initialColor: ParticleColor
  color: ParticleColor | null
  sizeOverLife: FireballMinMax | null
  rate: FireballMinMax
  bursts: [number, FireballMinMax][]
  shape: {
    type: number
    angle: number
    length: number
    radius: { value: number }
    [key: string]: unknown
  }
  force: {
    enabled: number
    worldSpace: number
    x: FireballMinMax
    y: FireballMinMax
    z: FireballMinMax
  }
  inherit: { enabled: number; m_Mode: number; m_Curve: RawCurve }
  limit: { enabled: number; magnitude: RawCurve; dampen: number }
  gravity: FireballMinMax
  renderMode: number
  lengthScale: number
  material: string
  position: number[]
  scale: number[]
  quaternion: number[]
}
export const FIREBALL_PROFILES = {
  birth: source.birth.profiles,
  missile: source.missile.profiles,
  impact: source.impact.profiles
} as unknown as Record<FireballPhase, Record<string, FireballProfile>>

export type FireballPhase = 'birth' | 'missile' | 'impact'

export function fireballRandom(seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}
export function fireballCurve(keys: FireballCurve, time: number): number {
  if (!keys.length) return 1
  if (time <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1],
      b = keys[i]
    if (time > b[0]) continue
    const span = b[0] - a[0],
      t = (time - a[0]) / span,
      t2 = t * t,
      t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * a[1] +
      (t3 - 2 * t2 + t) * span * a[3] +
      (-2 * t3 + 3 * t2) * b[1] +
      (t3 - t2) * span * b[2]
    )
  }
  return keys[keys.length - 1][1]
}
const mix = (a: number, b: number, t: number): number => a + (b - a) * t
/** Installed Blizzard.T5.iTween EaseType 0 is easeInQuad. */
export function fireballTravel(progress: number): number {
  const t = Math.max(0, Math.min(1, progress))
  return t * t
}
export function fireballSample(c: FireballMinMax, t: number, random: number): number {
  if (c.mode === 0) return c.max
  if (c.mode === 3) return mix(c.min, c.max, random)
  const upper = fireballCurve(c.upper, t) * c.max
  return c.mode === 1 ? upper : mix(fireballCurve(c.lower, t) * c.max, upper, random)
}
function raw(c: RawCurve): FireballMinMax {
  const curve = (keys: RawCurve['maxCurve']['m_Curve']): number[][] =>
    keys.map((k) => [k.time, k.value, k.inSlope, k.outSlope])
  return {
    mode: c.minMaxState,
    min: c.minScalar,
    max: c.scalar,
    upper: curve(c.maxCurve.m_Curve),
    lower: curve(c.minCurve.m_Curve)
  }
}
function gradient(keys: FireballCurve, t: number, channel: number): number {
  if (t <= keys[0][0]) return keys[0][channel]
  for (let i = 1; i < keys.length; i++)
    if (t <= keys[i][0])
      return mix(
        keys[i - 1][channel],
        keys[i][channel],
        (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0])
      )
  return keys[keys.length - 1][channel]
}
function color(c: ParticleColor, t: number, r: number): number[] {
  if (c.mode === 0) return [...c.max]
  if (c.mode === 2) return c.max.map((v, i) => mix(c.min[i], v, r))
  const evaluate = (g: Gradient): number[] =>
    [1, 2, 3].map((i) => gradient(g.rgb, t, i)).concat(gradient(g.alpha, t, 1))
  const upper = evaluate(c.upper)
  return c.mode === 1 ? upper : upper.map((v, i) => mix(evaluate(c.lower)[i], v, r))
}
export function fireballRotate(v: readonly number[], q: readonly number[]): number[] {
  const [x, y, z] = v,
    [qx, qy, qz, qw] = q
  const tx = 2 * (qy * z - qz * y),
    ty = 2 * (qz * x - qx * z),
    tz = 2 * (qx * y - qy * x)
  return [
    x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx
  ]
}
export interface FireballParticle {
  phase: FireballPhase
  name: string
  profile: FireballProfile
  birth: number
  life: number
  size: number
  rotation: number
  spin: number
  initialColor: number[]
  position: number[]
  velocity: number[]
  random: number
  inherit: number
  motion?: { flight: number; distance: number; states: Float32Array; steps: number }
}

/** Fixed emission integrals give reproducible birth times independently of frame rate. */
export function createFireballParticles(
  phase: FireballPhase,
  flight: number,
  seed = 1
): FireballParticle[] {
  const particles: FireballParticle[] = []
  for (const [stream, [name, p]] of Object.entries(
    FIREBALL_PROFILES[phase]
  ).entries()) {
    const start = phase === 'impact' ? flight : 0,
      emission = p.loop ? flight : p.duration
    const delay = fireballSample(p.delay, 0, fireballRandom(seed + stream * 101))
    const births: number[] = []
    for (const [t, c] of p.bursts)
      for (
        let i = 0;
        i < Math.round(fireballSample(c, t, fireballRandom(seed + i)));
        i++
      )
        births.push(t)
    let integral = 0,
      count = 0
    for (let t = 0; t < emission; t += L.step) {
      const step = Math.min(L.step, emission - t),
        rate = Math.max(0, fireballSample(p.rate, (t % p.duration) / p.duration, 0.5))
      integral += rate * step
      while (count + 1 <= integral + 1e-7) {
        count++
        births.push(
          Math.min(emission, t + step - (integral - count) / Math.max(rate, 0.0001))
        )
      }
    }
    for (const [index, t] of births.entries()) {
      const key = seed + stream * 100003 + index * 97,
        r = (offset: number): number => fireballRandom(key + offset)
      const age = (t % p.duration) / p.duration,
        angle = r(1) * Math.PI * 2,
        radius = Math.sqrt(r(2)) * p.shape.radius.value
      const cone = Math.tan((p.shape.angle * Math.PI) / 180)
      const direction = fireballRotate(
        [
          Math.cos(angle) * cone * Math.sqrt(r(3)),
          Math.sin(angle) * cone * Math.sqrt(r(3)),
          1
        ],
        p.quaternion
      )
      const norm = Math.hypot(...direction),
        speed = fireballSample(p.speed, age, r(4))
      const offset = fireballRotate(
        [Math.cos(angle) * radius, Math.sin(angle) * radius, 0],
        p.quaternion
      )
      particles.push({
        phase,
        name,
        profile: p,
        birth: start + delay + t,
        life: Math.max(0.001, fireballSample(p.life, age, r(5))),
        size: fireballSample(p.size, age, r(6)),
        rotation: fireballSample(p.rotation, age, r(7)),
        spin: p.spin ? fireballSample(p.spin, 0, r(8)) : 0,
        initialColor: color(p.initialColor, age, r(9)),
        position: offset.map((v, i) => v + p.position[i]),
        velocity: direction.map((v) => (v / norm) * speed),
        random: r(10),
        inherit: p.inherit.enabled
          ? fireballSample(raw(p.inherit.m_Curve), age, r(11))
          : 0
      })
    }
  }
  return particles
}

/** Source cone motion, force curves and velocity limiter, projected later by the view. */
export function fireballParticleAt(
  p: FireballParticle,
  time: number,
  flight: number,
  distance: number
): {
  visible: boolean
  position: number[]
  velocity: number[]
  size: number
  rotation: number
  color: number[]
} {
  const elapsed = Math.min(p.life, Math.max(0, time - p.birth)),
    age = Math.min(1, elapsed / p.life),
    q = p.profile
  if (!p.motion || p.motion.flight !== flight || p.motion.distance !== distance) {
    const position = [...p.position],
      velocity = [...p.velocity]
    if (p.phase === 'missile') {
      position[2] += distance * fireballTravel(p.birth / flight)
      velocity[2] +=
        ((2 * distance) / flight) * Math.min(1, p.birth / flight) * p.inherit
    }
    const states = new Float32Array((Math.ceil(p.life / L.step) + 1) * 7)
    states.set([...position, ...velocity, p.rotation])
    p.motion = { flight, distance, states, steps: 0 }
  }
  const states = p.motion.states,
    limitCurve = q.limit.enabled ? raw(q.limit.magnitude) : null
  const last = Math.ceil(elapsed / L.step)
  while (p.motion.steps < last) {
    const t = p.motion.steps * L.step,
      u = t / p.life,
      step = L.step
    const offset = p.motion.steps * 7,
      position = Array.from(states.subarray(offset, offset + 3)),
      velocity = Array.from(states.subarray(offset + 3, offset + 6))
    if (q.force.enabled)
      for (let i = 0; i < 3; i++)
        velocity[i] +=
          fireballSample([q.force.x, q.force.y, q.force.z][i], u, p.random) * step
    velocity[1] -= 9.81 * fireballSample(q.gravity, u, p.random) * step
    if (limitCurve) {
      const limit = fireballSample(limitCurve, u, p.random),
        speed = Math.hypot(...velocity)
      if (speed > limit) {
        const factor =
          (limit + (speed - limit) * Math.pow(1 - q.limit.dampen, step * 60)) /
          Math.max(speed, 0.00001)
        for (let i = 0; i < 3; i++) velocity[i] *= factor
      }
    }
    for (let i = 0; i < 3; i++) position[i] += velocity[i] * step
    const rotation =
      states[offset + 6] + (q.spin ? fireballSample(q.spin, u, p.random) * step : 0)
    p.motion.steps++
    states.set([...position, ...velocity, rotation], p.motion.steps * 7)
  }
  const index = Math.floor(elapsed / L.step),
    fraction = elapsed / L.step - index
  const a = index * 7,
    b = Math.min(index + 1, p.motion.steps) * 7
  const position = [0, 1, 2].map((i) => mix(states[a + i], states[b + i], fraction)),
    velocity = [3, 4, 5].map((i) => mix(states[a + i], states[b + i], fraction))
  const over = q.color ? color(q.color, age, p.random) : [1, 1, 1, 1]
  return {
    visible: time >= p.birth && time < p.birth + p.life,
    position,
    velocity,
    size: p.size * (q.sizeOverLife ? fireballSample(q.sizeOverLife, age, p.random) : 1),
    rotation: mix(states[a + 6], states[b + 6], fraction),
    color: p.initialColor.map((v, i) => v * over[i])
  }
}
