import type { FireAoeTuning } from '../../desktop/contracts/ipc/vfx-templates'
import authored from './fire-aoe-authored.json'
import { FIRE_AOE_LAYOUT as L, type FireAoeCoverage } from './fire-aoe-layout'

/** Unity keys retain both tangents; replacing these with smoothstep changes the effect. */
export type FireCurve = readonly (readonly number[])[]
interface MinMaxCurve {
  mode: number
  min: number
  max: number
  lower: FireCurve
  upper: FireCurve
}
interface Gradient {
  rgb: FireCurve
  alpha: FireCurve
}
interface ParticleColor {
  mode: number
  min: readonly number[]
  max: readonly number[]
  lower: Gradient
  upper: Gradient
}
interface ParticleProfile {
  duration: number
  delay: MinMaxCurve
  life: MinMaxCurve
  speed: MinMaxCurve
  size: MinMaxCurve
  rotation: MinMaxCurve
  spin: MinMaxCurve | null
  initialColor: ParticleColor
  color: ParticleColor
  sizeOverLife: MinMaxCurve | null
  rate: MinMaxCurve
  bursts: number[][]
  limit: MinMaxCurve | null
  dampen: number
  mesh: string | null
  radius: number
  position: number[]
  quaternion: number[]
  renderMode: number
}
export type FireParticleKind =
  'fire' | 'dark' | 'fieldSmoke' | 'embers' | 'smoke' | 'burst' | 'sparks'
const profiles: Record<
  string,
  Partial<Record<FireParticleKind, ParticleProfile>>
> = authored.profiles
const meshes: Record<string, { vertices: number[][] }> = authored.meshes

export function fireRandom(seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}
export function fireCurve(keys: FireCurve, time: number): number {
  if (!keys.length) return 1
  if (time <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1],
      b = keys[i]
    if (time > b[0]) continue
    const span = b[0] - a[0],
      t = (time - a[0]) / span
    const t2 = t * t,
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
function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
function sample(c: MinMaxCurve, t: number, random: number): number {
  if (c.mode === 0) return c.max
  if (c.mode === 3) return mix(c.min, c.max, random)
  const upper = fireCurve(c.upper, t) * c.max
  return c.mode === 1 ? upper : mix(fireCurve(c.lower, t) * c.max, upper, random)
}
function gradient(keys: FireCurve, t: number, channel: number): number {
  if (t <= keys[0][0]) return keys[0][channel]
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1],
      b = keys[i]
    if (t <= b[0]) return mix(a[channel], b[channel], (t - a[0]) / (b[0] - a[0]))
  }
  return keys[keys.length - 1][channel]
}
function color(c: ParticleColor, t: number, random: number): number[] {
  if (c.mode === 0) return [...c.max]
  if (c.mode === 2) return c.max.map((v, i) => mix(c.min[i], v, random))
  const evaluate = (g: Gradient) =>
    [1, 2, 3].map((i) => gradient(g.rgb, t, i)).concat(gradient(g.alpha, t, 1))
  const upper = evaluate(c.upper)
  if (c.mode === 1) return upper
  const lower = evaluate(c.lower)
  return upper.map((v, i) => mix(lower[i], v, random))
}
function rotate(v: readonly number[], q: readonly number[]): number[] {
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
export function fireAoePhases(coverage: FireAoeCoverage) {
  const action = L.presets[coverage].action
  // ParticlePlayAction finishes immediately. There is no additional ember-state wait.
  const envelopeEnd = Math.max(
    L.dimFade,
    L.curves.alphaOut.at(-1)![0],
    L.curves.intensityOut.at(-1)![0],
    L.curves.glowOut.at(-1)![0]
  )
  return { action, fade: action, end: action + envelopeEnd }
}
export function fireAoeEnvelope(seconds: number, coverage: FireAoeCoverage) {
  const { fade } = fireAoePhases(coverage),
    t = seconds - fade
  const alphaAtTransition = fireCurve(L.curves.alphaIn, fade)
  return {
    alpha:
      t < 0 ? fireCurve(L.curves.alphaIn, seconds) : fireCurve(L.curves.alphaOut, t),
    intensity: t < 0 ? 1 : fireCurve(L.curves.intensityOut, t) / 2,
    glow: t < 0 ? fireCurve(L.curves.glowIn, seconds) : fireCurve(L.curves.glowOut, t),
    dim:
      t < 0
        ? fireCurve(L.curves.alphaIn, seconds)
        : alphaAtTransition * (1 - Math.min(1, t / L.dimFade))
  }
}
export interface FireParticle {
  readonly kind: FireParticleKind
  readonly birth: number
  readonly life: number
  readonly position: readonly number[]
  readonly direction: readonly number[]
  readonly size: number
  readonly rotation: number
  readonly spin: number
  readonly row: number
  readonly initialColor: readonly number[]
  readonly profile: ParticleProfile
  readonly travel: readonly number[]
  readonly turbulence: number
  readonly noisePhase: number
}

function emit(
  profile: ParticleProfile,
  kind: FireParticleKind,
  start: number,
  tuning: FireAoeTuning,
  seed: number,
  tail?: {
    emissionDuration: number
    lifetime: number
    density?: number
    speed?: number
  }
): FireParticle[] {
  const particles: FireParticle[] = []
  const delay = sample(profile.delay, 0, fireRandom(seed))
  const dynamics = tuning.dynamics
  const persistence =
    kind === 'smoke'
      ? (dynamics?.smokePersistence ?? 1)
      : kind === 'embers'
        ? (dynamics?.emberPersistence ?? 1)
        : 1
  const amount =
    kind === 'smoke'
      ? (dynamics?.smokeAmount ?? 1)
      : kind === 'embers'
        ? (dynamics?.emberAmount ?? 1)
        : 1
  const durationScale = (tail?.emissionDuration ?? 1) * persistence
  const duration = profile.duration * durationScale
  // Persistence changes timing, not the number of emitted clouds/embers.
  const density = tuning.density * (tail?.density ?? 1) * amount
  const add = (emissionTime: number) => {
    const key = seed * 104729 + particles.length * 47
    const rand = (offset: number) => fireRandom(key + offset)
    const t = emissionTime / duration
    let vertex: number[]
    if (profile.mesh) {
      const vertices = meshes[profile.mesh].vertices
      // Serialized placementMode=Vertex. Preserve duplicates and their authored normals/colors.
      vertex = vertices[Math.floor(rand(0) * vertices.length)]
    } else {
      // Impact emitters randomize their direction completely (randomDirectionAmount=1).
      const angle = rand(0) * Math.PI * 2,
        radius = Math.sqrt(rand(10)) * profile.radius
      const z = rand(11) * 2 - 1,
        r = Math.sqrt(1 - z * z),
        a = rand(12) * Math.PI * 2
      vertex = [
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        0,
        r * Math.cos(a),
        r * Math.sin(a),
        z
      ]
    }
    const position = rotate(vertex, profile.quaternion).map(
      (v, i) => v + profile.position[i]
    )
    const direction = rotate(vertex.slice(3, 6), profile.quaternion)
    const life = sample(profile.life, t, rand(1)) * (tail?.lifetime ?? 1) * persistence,
      speed = sample(profile.speed, t, rand(2)) * (tail?.speed ?? 1)
    const steps = profile.limit ? Math.ceil(life * L.simulationHz) : 1,
      dt = life / steps
    const travel = [0]
    let velocity = speed
    for (let i = 1; i <= steps; i++) {
      if (profile.limit) {
        const limit = Math.max(0, sample(profile.limit, (i - 1) / steps, rand(3)))
        // Native Unity damping is unavailable; fixed-step integration keeps this approximation seekable.
        velocity = mix(
          velocity,
          Math.min(velocity, limit),
          1 - Math.pow(1 - profile.dampen, dt * 60)
        )
      }
      travel.push(travel[i - 1] + velocity * dt)
    }
    particles.push({
      kind,
      birth: start + delay + emissionTime,
      life,
      position,
      direction,
      size: sample(profile.size, t, rand(4)) * tuning.particleScale,
      rotation: sample(profile.rotation, t, rand(5)),
      spin: profile.spin ? sample(profile.spin, 0, rand(6)) : 0,
      row: Math.floor(rand(7) * 4),
      profile,
      travel,
      turbulence: (dynamics?.turbulence ?? 0) * (kind === 'smoke' ? 0.2 : 1),
      noisePhase: rand(13) * Math.PI * 2,
      initialColor: color(profile.initialColor, t, rand(8)).map(
        (v, i) => v * (vertex[i + 6] ?? 1)
      )
    })
  }
  for (const [time, count] of profile.bursts)
    for (let i = 0; i < Math.round(count * density); i++) add(time * durationScale)
  let accumulated = 0
  const steps = Math.ceil(duration * L.simulationHz)
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps
    accumulated +=
      (Math.max(0, sample(profile.rate, t, 0.5)) * density * duration) /
      (steps * persistence)
    while (accumulated >= 1) {
      add(t * duration)
      accumulated--
    }
  }
  return particles
}
export function createFireParticles(
  coverage: FireAoeCoverage,
  tuning: FireAoeTuning,
  seed = 1
): FireParticle[] {
  const { action, fade } = fireAoePhases(coverage)
  return (['fire', 'dark', 'fieldSmoke', 'embers', 'smoke'] as const).flatMap(
    (kind, i) =>
      emit(
        profiles[coverage][kind]!,
        kind,
        kind === 'embers' ? action : kind === 'smoke' ? fade : 0,
        tuning,
        seed + i * 97,
        kind === 'smoke' ? L.smoke.board : kind === 'embers' ? L.embers : undefined
      )
  )
}
export function createFireImpactParticles(
  tuning: FireAoeTuning,
  seed = 1
): FireParticle[] {
  const start = mix(L.impact.delay[0], L.impact.delay[1], fireRandom(seed))
  return (['burst', 'sparks', 'smoke'] as const).flatMap((kind, i) =>
    emit(
      profiles.impact[kind]!,
      kind,
      start,
      tuning,
      seed + i * 97,
      kind === 'smoke' ? L.smoke.impact : undefined
    )
  )
}
export function fireParticleAt(p: FireParticle, time: number, motion: number) {
  const elapsed = time - p.birth,
    age = Math.max(0, Math.min(1, elapsed / p.life))
  const step = age * (p.travel.length - 1),
    index = Math.floor(step)
  const distance =
    mix(
      p.travel[index],
      p.travel[Math.min(index + 1, p.travel.length - 1)],
      step - index
    ) * motion
  const tint = color(p.profile.color, age, 0.5).map((v, i) => v * p.initialColor[i])
  // Smooth bounded displacement, evaluated from cast time so replay/seek is deterministic.
  const drift = p.turbulence * 0.25 * Math.min(1, Math.max(0, elapsed) * 3)
  const driftX =
    drift * (Math.sin(elapsed * 2.3 + p.noisePhase) - Math.sin(p.noisePhase))
  const driftZ =
    drift * (Math.cos(elapsed * 1.7 + p.noisePhase) - Math.cos(p.noisePhase))
  return {
    visible: elapsed >= 0 && elapsed < p.life,
    x: p.position[0] + p.direction[0] * distance + driftX,
    y: p.position[1] + p.direction[1] * distance,
    z: p.position[2] + p.direction[2] * distance + driftZ,
    size: Math.max(
      0,
      p.size * (p.profile.sizeOverLife ? sample(p.profile.sizeOverLife, age, 0.5) : 1)
    ),
    rotation: p.rotation + p.spin * Math.max(0, elapsed) * motion,
    color: tint,
    tint:
      ((Math.round(tint[0] * 255) << 16) |
        (Math.round(tint[1] * 255) << 8) |
        Math.round(tint[2] * 255)) >>>
      0,
    alpha: tint[3]
  }
}
