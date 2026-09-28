import { Container, Sprite, type Texture } from 'pixi.js'

import { GHOST_WIND_DIRECTIONS } from '../../../shared/ipc/outline-tuning'
import type { GhostMistValues } from './ghost-mist-filter'

// Preserve the saved movement baseline without coupling it to mist width.
const PARTICLE_MOTION_SPREAD = 14

const random = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

// Read the silhouette only when the asset changes. Particles then move
// independently of the artwork and are never clipped back to its alpha.
export function createMistParticles(
  target: Sprite,
  values: GhostMistValues,
  texture: Texture
) {
  const container = new Container()
  container.label = 'ghost-mist.particles'
  container.eventMode = 'none'
  const sprites = Array.from({ length: 120 }, () => {
    const sprite = new Sprite({ texture, anchor: 0.5, blendMode: 'add' })
    sprite.label = 'ghost-mist.particle'
    sprite.visible = false
    container.addChild(sprite)
    return sprite
  })
  let burstSequence = 0
  let wasDisappearing = false
  let sourceTexture: Texture | undefined
  type Point = { x: number; y: number }
  type Edge = Point & { nx: number; ny: number }
  let edges: Edge[] = []
  let surface: Point[] = []
  const births = Array.from({ length: sprites.length }, () => ({
    key: '',
    expired: false
  }))

  function refresh() {
    if (target.texture === sourceTexture) return
    sourceTexture = target.texture
    const mask = document.createElement('canvas')
    const ratio = Math.min(1, 384 / sourceTexture.width)
    mask.width = Math.max(1, Math.round(sourceTexture.width * ratio))
    mask.height = Math.max(1, Math.round(sourceTexture.height * ratio))
    const context = mask.getContext('2d', { willReadFrequently: true })!
    context.drawImage(
      sourceTexture.source.resource as CanvasImageSource,
      0,
      0,
      mask.width,
      mask.height
    )
    const { data } = context.getImageData(0, 0, mask.width, mask.height)
    const alpha = (x: number, y: number) =>
      x < 0 || y < 0 || x >= mask.width || y >= mask.height
        ? 0
        : data[(y * mask.width + x) * 4 + 3] / 255
    edges = []
    surface = []
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
        if (alpha(x, y) < 0.5) continue
        const point = {
          x: (x + 0.5) / mask.width - 0.5,
          y: (y + 0.5) / mask.height - 0.5
        }
        surface.push(point)
        if (
          Math.min(
            alpha(x - 1, y),
            alpha(x + 1, y),
            alpha(x, y - 1),
            alpha(x, y + 1)
          ) >= 0.5
        )
          continue
        let nx = alpha(x - 1, y) - alpha(x + 1, y)
        let ny = alpha(x, y - 1) - alpha(x, y + 1)
        const length = Math.hypot(nx, ny)
        if (length < 0.01) {
          nx = point.x
          ny = point.y
        }
        const norm = Math.hypot(nx, ny) || 1
        edges.push({ ...point, nx: nx / norm, ny: ny / norm })
      }
    }
  }

  function update(time: number) {
    if (!container.parent || target.destroyed) return
    const targetTransform = target.getGlobalTransform()
    const parentTransform = container.parent.getGlobalTransform()
    const toParent = parentTransform.clone().invert()
    const direction = GHOST_WIND_DIRECTIONS[values.windDirection]
    const allDirections = values.windDirection === 0
    const windX = direction.x,
      windY = direction.y
    const progress = values.progress
    if (progress > 0 && !wasDisappearing) burstSequence += 1
    wasDisappearing = progress > 0
    const color = values.particleColor
    for (let i = 0; i < sprites.length; i++) {
      const sprite = sprites[i]
      sprite.visible =
        values.particlesEnabled &&
        i < values.particleCount &&
        edges.length > 0 &&
        progress < 1 &&
        values.particleIntensity > 0
      if (!sprite.visible) continue
      const lifetime = 1.3 + random(i + 4) * 1.1
      const phase = time / lifetime + random(i + 10)
      const cycle = Math.floor(phase)
      // The surface burst follows the white flash. Staggered births keep it
      // from looking like a particle overlay switched on across the button.
      const birth = 0.18 + random(i + 45) * 0.22
      const age =
        progress > 0
          ? Math.max(0, Math.min(1, (progress - birth) / (1 - birth)))
          : phase - cycle
      const seed = i * 31 + (progress > 0 ? burstSequence : cycle) * 157
      const spawn = births[i]
      const birthKey = progress > 0 ? 'burst:' + burstSequence : 'idle:' + cycle
      if (spawn.key !== birthKey) {
        spawn.key = birthKey
        spawn.expired = false
      }
      if (spawn.expired) {
        sprite.visible = false
        continue
      }
      const edge = edges[Math.floor(random(seed) * edges.length)]
      const origin =
        progress > 0 ? surface[Math.floor(random(seed + 7) * surface.length)] : edge
      const outward = age * (14 + PARTICLE_MOTION_SPREAD * (0.8 + random(seed + 3)))
      const drift =
        values.particleWindStrength *
        age *
        age *
        lifetime *
        (25 + PARTICLE_MOTION_SPREAD * 0.7)
      const swirl =
        Math.sin(age * 6 + random(seed + 9) * 6) * Math.sin(age * Math.PI) * 7
      const originGlobal = targetTransform.apply({
        x: (origin.x + 0.5 - target.anchor.x) * target.texture.width,
        y: (origin.y + 0.5 - target.anchor.y) * target.texture.height
      })
      // Full-surface bursts expand radially in All directions mode.
      const radial =
        allDirections && progress > 0 && Math.hypot(origin.x, origin.y) > 1e-6
      const localX = radial ? origin.x * target.texture.width : edge.nx
      const localY = radial ? origin.y * target.texture.height : edge.ny
      const nx = targetTransform.a * localX + targetTransform.c * localY
      const ny = targetTransform.b * localX + targetTransform.d * localY
      const normalLength = Math.hypot(nx, ny) || 1
      // Bound the complete displacement, including outward motion and swirl.
      const travelX = allDirections ? nx / normalLength : windX
      const travelY = allDirections ? ny / normalLength : windY
      const offsetX = (nx / normalLength) * outward + travelX * drift - travelY * swirl
      const offsetY = (ny / normalLength) * outward + travelY * drift + travelX * swirl
      const distance = Math.hypot(offsetX, offsetY)
      const limit = values.particleTravelDistance
      if (distance >= limit) {
        spawn.expired = true
        sprite.visible = false
        continue
      }
      // Smoothly fade through the final 30% of the permitted distance.
      const fade = Math.min(1, Math.max(0, (distance / limit - 0.7) / 0.3))
      const distanceOpacity = 1 - fade * fade * (3 - 2 * fade)
      const position = toParent.apply({
        x: originGlobal.x + offsetX,
        y: originGlobal.y + offsetY
      })
      sprite.position.copyFrom(position)
      // Each spawn keeps its chosen direction: half a turn over its lifetime.
      const spinDirection = random(seed + 71) < 0.5 ? -1 : 1
      sprite.rotation = random(seed + 83) * Math.PI * 2 + spinDirection * age * Math.PI
      // Fixed lifetime diameter, distributed around the requested pixel average.
      const size = values.particleSize * (0.4 + random(i + 20) * 1.2)
      const transform = parentTransform
      sprite.width = size / (Math.hypot(transform.a, transform.b) || 1)
      sprite.height = size / (Math.hypot(transform.c, transform.d) || 1)
      const envelope = Math.min(1, age * 12) * (1 - age) ** 1.4
      sprite.alpha =
        Math.min(1, envelope * values.particleIntensity * (progress > 0 ? 2 : 0.9)) *
        distanceOpacity
      sprite.tint = progress > 0 ? 0xffffff : color
    }
  }
  return {
    container,
    refresh,
    update,
    destroy() {
      container.destroy({ children: true })
    }
  }
}
