import { Container, type Sprite } from 'pixi.js'
import { GHOST_WIND_DIRECTIONS } from '../../desktop/contracts/ipc/outline-tuning'
import type { GhostMistValues } from './ghost-mist-filter'
import {
  GhostMaterialMesh,
  configureGhostTextures,
  type GhostTextures
} from './ghost-materials'
import {
  GHOST_LAYOUT,
  GHOST_TIMING,
  GHOST_BUTTON_ECHO,
  type GhostProfile
} from './ghost-layout'
import authored from './ghost-authored.json'

const random = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
const sample = (range: readonly number[], seed: number): number =>
  range[0] + (range[1] - range[0]) * random(seed)
const rgb = (color: number): number[] => [
  (color >>> 16) / 255,
  ((color >>> 8) & 255) / 255,
  (color & 255) / 255
]

/** Unity AnimationCurve's unweighted cubic Hermite interpolation. */
export function ghostCurve(keys: readonly (readonly number[])[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1],
      b = keys[i]
    if (t > b[0]) continue
    const span = b[0] - a[0],
      u = (t - a[0]) / span
    if (a.length === 2) return a[1] + (b[1] - a[1]) * u
    return (
      (2 * u ** 3 - 3 * u * u + 1) * a[1] +
      (u ** 3 - 2 * u * u + u) * span * a[3] +
      (-2 * u ** 3 + 3 * u * u) * b[1] +
      (u ** 3 - u * u) * span * b[2]
    )
  }
  return keys[keys.length - 1][1]
}

/** Fixed-step adaptation of Unity's velocity limiter; deterministic when seeking. */
export function ghostDisplacement(
  vx: number,
  vy: number,
  fx: number,
  fy: number,
  seconds: number,
  limit: number,
  dampen: number
): [number, number] {
  if (!limit)
    return [
      vx * seconds + (fx * seconds * seconds) / 2,
      vy * seconds + (fy * seconds * seconds) / 2
    ]
  let x = 0,
    y = 0
  for (let t = 0; t < seconds; t += 1 / 60) {
    const dt = Math.min(1 / 60, seconds - t)
    vx += fx * dt
    vy += fy * dt
    const speed = Math.hypot(vx, vy)
    if (speed > limit) {
      const damping = 1 - (1 - dampen) ** (dt * 60)
      const factor = (speed - (speed - limit) * damping) / speed
      vx *= factor
      vy *= factor
    }
    x += vx * dt
    y += vy * dt
  }
  return [x, y]
}

/** Authored light motes, additive gas, alpha smoke, and the death burst. */
export function createMistParticles(
  target: Sprite,
  values: GhostMistValues,
  textures: GhostTextures,
  profile: GhostProfile
) {
  configureGhostTextures(textures)
  const container = new Container()
  container.label = 'ghost-mist.layers'
  container.eventMode = 'none'
  const foreground = new Container()
  foreground.label = 'ghost-mist.foreground'
  foreground.eventMode = 'none'
  const layout = GHOST_LAYOUT[profile]
  const glowTint =
    profile === 'banner'
      ? [0.06415994, 0.18876508, 0.58431375, 1]
      : [0.05382545, 0.11775625, 0.27450982, 0.7019608]
  const glow = new GhostMaterialMesh(
    profile === 'banner' ? textures.ghostBannerAtlas : textures.ghostButtonAtlas,
    textures.ghostClouds,
    1,
    profile === 'banner' ? 0 : 1,
    glowTint,
    layout.uv
  )
  glow.label = 'ghost-mist.glow'
  container.addChild(glow)
  const echo =
    profile === 'button'
      ? new GhostMaterialMesh(
          textures.ghostButtonAtlas,
          textures.ghostClouds,
          1,
          1,
          [...GHOST_BUTTON_ECHO.tint],
          GHOST_BUTTON_ECHO.uv
        )
      : null
  if (echo) {
    echo.label = 'ghost-mist.death-echo'
    foreground.addChild(echo)
  }
  const streams = [
    ...authored[profile],
    ...(profile === 'button' ? authored.evaporate : [])
  ].map((source, index) => {
    const kind = source.kind
    const texture =
      kind === 'mote'
        ? textures.ghostMote
        : kind === 'smokeAdd'
          ? textures.ghostSmokeAdd
          : kind === 'smoke'
            ? textures.ghostSmoke
            : textures.ghostEvaporate
    const count =
      kind === 'evaporate' ? 250 : Math.ceil(source.rate * source.lifetime[1]) + 1
    const tint =
      kind === 'mote'
        ? [1, 1, 1, 1]
        : kind === 'evaporate'
          ? [0.9218608, 0.9433612, 0.9960784, 1]
          : [0.5, 0.5, 0.5, 0.5]
    const mesh = new GhostMaterialMesh(
      texture,
      textures.ghostClouds,
      count,
      kind === 'smoke' ? 3 : 2,
      tint
    )
    mesh.label = 'ghost-mist.' + kind
    ;(kind === 'mote' || kind === 'evaporate' ? foreground : container).addChild(mesh)
    return { source, mesh, count, index }
  })
  let exitTime: number | null = null
  let clock = 0,
    previousTime = 0

  function refresh(): void {
    if (!container.parent || target.destroyed) return
    const transform = target.getGlobalTransform()
    transform.prepend(container.parent.getGlobalTransform().invert())
    container.setFromMatrix(transform)
    foreground.setFromMatrix(transform)
  }
  function update(time: number): void {
    if (!container.parent || target.destroyed) return
    refresh()
    const dt = Math.max(0, time - previousTime)
    previousTime = time
    clock += dt * values.mistAnimationSpeed
    if (values.progress === 0 || profile === 'banner') exitTime = null
    else exitTime ??= time
    const exiting = exitTime !== null
    const elapsed = values.progress * GHOST_TIMING.duration
    // Death State hides GameObjectContainer at 0.2s. Only UberText fades.
    const idleFade = exiting && elapsed >= GHOST_TIMING.burstDelay ? 0 : 1
    const body = layout.body
    const width = target.texture.width * body.width,
      height = target.texture.height * body.height
    const x = (body.x - target.anchor.x) * target.texture.width
    const y = (body.y - target.anchor.y) * target.texture.height
    const pixelsPerUnit = width / layout.worldWidth
    const opacity = container.getGlobalAlpha()
    const primary = rgb(values.mistPrimaryColor),
      secondary = rgb(values.mistHighlightColor)
    const gu = glow.shader!.resources.ghostUniforms.uniforms
    gu.uIntensity = values.mistIntensity * (profile === 'banner' ? 2.22 : 1)
    gu.uTextureScale = values.mistTextureScale
    gu.uScroll.set([clock / 20, clock / 20])
    gu.uOpacity = opacity * idleFade
    glow.visible = values.mistEnabled && idleFade > 0
    glow.quad(0, x, y, width * layout.glow.width, height * layout.glow.height, 0, [
      ...primary,
      1
    ])
    glow.upload()
    if (echo) {
      echo.visible = values.mistEnabled && exiting && idleFade > 0
      if (echo.visible) {
        const eu = echo.shader!.resources.ghostUniforms.uniforms
        eu.uTint[3] = ghostCurve(GHOST_BUTTON_ECHO.alpha, elapsed * 2)
        eu.uOpacity = opacity
        eu.uIntensity = values.mistIntensity
        echo.quad(
          0,
          x,
          y,
          width * GHOST_BUTTON_ECHO.width,
          height * GHOST_BUTTON_ECHO.height,
          0,
          [...primary, 1]
        )
        echo.upload()
      }
    }
    const direction = GHOST_WIND_DIRECTIONS[values.windDirection]
    const angle = values.windDirection === 0 ? 0 : Math.atan2(-direction.y, direction.x)
    const cos = Math.cos(angle),
      sin = Math.sin(angle)
    for (const { source, mesh, count, index } of streams) {
      const burst = source.kind === 'evaporate'
      const smoke = source.kind === 'smoke' || source.kind === 'smokeAdd'
      mesh.visible =
        (smoke ? values.mistEnabled : values.particlesEnabled) &&
        (burst ? exiting && elapsed >= GHOST_TIMING.burstDelay : idleFade > 0)
      if (!mesh.visible) continue
      const u = mesh.shader!.resources.ghostUniforms.uniforms
      u.uOpacity = opacity * (burst ? 1 : idleFade)
      u.uIntensity = smoke ? values.mistIntensity : values.particleIntensity
      u.uSoftness = smoke ? values.mistSoftness : 1
      const tint = smoke
        ? source.kind === 'smokeAdd'
          ? primary
          : secondary
        : rgb(values.particleColor)
      const density = values.particleCount / 120
      const rate = source.rate * density
      const now =
        (exiting ? exitTime! + elapsed : smoke ? clock : time) +
        (source.prewarm ? source.lifetime[1] : 0)
      const latest = Math.floor(now * rate)
      mesh.colors.fill(0)
      for (let i = 0; i < count; i++) {
        if ((!burst && rate <= 0) || (burst && i >= Math.round(250 * density))) continue
        const birth = latest - i,
          seed = (burst ? i : birth) * 31 + index * 7919
        if (!burst && birth < 0) continue
        const lifetime = sample(source.lifetime, seed + 4)
        const seconds = burst ? elapsed - GHOST_TIMING.burstDelay : now - birth / rate
        const age = seconds / lifetime
        if (age < 0 || age >= 1) continue
        const shapeScale = pixelsPerUnit * layout.emitterScale
        const sx = (random(seed + 7) - 0.5) * source.shape[0] * shapeScale
        const sy = (random(seed + 8) - 0.5) * source.shape[1] * shapeScale
        const vx = sample(source.velocity.x, seed + 11),
          vy = sample(source.velocity.y, seed + 12)
        const fx = sample(source.force.x, seed + 13),
          fy = sample(source.force.y, seed + 14)
        let [dx, dy] = ghostDisplacement(
          vx,
          vy,
          fx,
          fy,
          seconds,
          source.speedLimit,
          source.dampen
        )
        dx *= pixelsPerUnit * values.particleWindStrength
        dy *= pixelsPerUnit * values.particleWindStrength
        const rotatedX = dx * cos - dy * sin
        dy = dx * sin + dy * cos
        dx = rotatedX
        const distance = Math.hypot(dx, dy)
        const travelFade = Math.min(
          1,
          Math.max(
            0,
            (values.particleTravelDistance - distance) /
              (values.particleTravelDistance * 0.3)
          )
        )
        const size =
          sample(source.size, seed + 15) *
          pixelsPerUnit *
          ghostCurve(source.sizeCurve, age) *
          (smoke ? values.mistWidth / 16 : values.particleSize / 15)
        const alpha = source.color[3] * ghostCurve(source.alphaCurve, age) * travelFade
        const color = source.color.slice(0, 3).map((c, channel) => c * tint[channel])
        const rotation =
          random(seed + 16) * Math.PI * 2 + sample(source.rotation, seed + 17) * seconds
        mesh.quad(
          i,
          x + sx + dx,
          y + sy - dy,
          Math.max(0, size),
          Math.max(0, size),
          rotation,
          [...color, alpha]
        )
      }
      mesh.upload()
    }
  }
  return {
    container,
    foreground,
    refresh,
    update,
    destroy() {
      container.destroy({ children: true })
      foreground.destroy({ children: true })
    }
  }
}
