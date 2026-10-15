import { Container, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js'
import type { AoeVfxPalette } from './aoe-vfx-shader'

const MOTE_COUNT = 12
const TAU = Math.PI * 2

function random(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return value - Math.floor(value)
}

function smoothstep(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)))
  return t * t * (3 - 2 * t)
}

function mixColor(from: number, to: number, amount: number): number {
  let color = 0
  for (const shift of [16, 8, 0]) {
    const a = (from >> shift) & 255
    const b = (to >> shift) & 255
    color |= Math.round(a + (b - a) * amount) << shift
  }
  return color
}

/** Owns only the derived mask; the registered, shared spotlight stays untouched. */
export class AoeMoteTexture {
  readonly texture: Texture

  constructor(source: Texture, renderer?: Renderer) {
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('AOE mote texture requires a 2D canvas')
    context.drawImage(
      source.source.resource as CanvasImageSource,
      0,
      0,
      canvas.width,
      canvas.height
    )
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let index = 0; index < pixels.data.length; index += 4) {
      const luminance =
        pixels.data[index] * 0.2126 +
        pixels.data[index + 1] * 0.7152 +
        pixels.data[index + 2] * 0.0722
      pixels.data[index + 3] = Math.round((luminance * pixels.data[index + 3]) / 255)
      pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = 255
    }
    context.putImageData(pixels, 0, 0)
    this.texture = Texture.from(canvas)
    // Synchronous offscreen upload happens at scene construction, never on cast.
    if (renderer) {
      const sample = new Sprite({ texture: this.texture, anchor: 0.5 })
      sample.label = 'aoe-motes.warmup'
      sample.position.set(16, 16)
      sample.width = sample.height = 24
      const target = RenderTexture.create({ width: 32, height: 32, resolution: 1 })
      try {
        renderer.render({ container: sample, target, clear: true })
      } catch (error) {
        this.destroy()
        throw error
      } finally {
        sample.destroy()
        target.destroy(true)
      }
    }
  }

  destroy(): void {
    if (!this.texture.destroyed) this.texture.destroy(true)
  }
}

/** Fixed, replayable pool of late warm-to-soot flecks shared by Lab and match. */
export class AoeMotes {
  readonly container = new Container()
  private readonly motes: {
    sprite: Sprite
    birth: number
    lifetime: number
    originX: number
    originY: number
    driftX: number
    driftY: number
    rotation: number
    spin: number
    size: number
    opacity: number
    phase: number
  }[]
  private colors = { core: 0, flame: 0, red: 0, soot: 0 }

  constructor(
    texture: Texture,
    private readonly size: { readonly width: number; readonly height: number },
    label: string,
    seed = 0
  ) {
    this.container.label = label + '.motes'
    this.container.eventMode = 'none'
    const sizeScale = 0.4 + 0.6 * Math.min(1, size.width / 600)
    this.motes = Array.from({ length: MOTE_COUNT }, (_, index) => {
      const key = seed * 173 + index * 31
      const angle = random(key + 2) * TAU
      const distance = 0.12 + Math.sqrt(random(key + 3)) * 0.56
      const direction = random(key + 4) * TAU
      const travel = 0.06 + random(key + 5) * 0.14
      const birth = 0.48 + ((index + random(key + 1)) / MOTE_COUNT) * 0.22
      const sprite = new Sprite({ texture, anchor: 0.5, blendMode: 'normal' })
      sprite.label = `${this.container.label}.${index}`
      sprite.visible = false
      sprite.alpha = 0
      this.container.addChild(sprite)
      return {
        sprite,
        birth,
        lifetime: Math.min(0.998 - birth, 0.31 + random(key + 6) * 0.12),
        originX: Math.cos(angle) * distance,
        originY: Math.sin(angle) * distance,
        driftX: Math.cos(direction) * travel,
        driftY: Math.sin(direction) * travel - 0.06,
        rotation: random(key + 7) * TAU,
        spin: (random(key + 8) < 0.5 ? -1 : 1) * (0.6 + random(key + 9)) * Math.PI,
        size: (16 + random(key + 10) * 14) * sizeScale,
        opacity: 0.46 + random(key + 11) * 0.14,
        phase: random(key + 12) * TAU
      }
    })
  }

  setPalette(palette: AoeVfxPalette): void {
    const color = (value: string): number => Number.parseInt(value.replace('#', ''), 16)
    const flame = color(palette.flameColor)
    this.colors = {
      core: color(palette.coreColor),
      flame,
      red: color(palette.redColor ?? palette.flameColor),
      // Older templates without soot retain their own hue at a dark value.
      soot: palette.sootColor ? color(palette.sootColor) : mixColor(flame, 0, 0.92)
    }
  }

  update(progress: number, radius: number, intensity: number): void {
    // This is the previous spark ellipse, with room reserved for rotated sprites.
    const halfWidth = this.size.width * 0.396 * radius
    const halfHeight = this.size.height * 0.396 * radius
    for (const mote of this.motes) {
      const age = (progress - mote.birth) / mote.lifetime
      const sprite = mote.sprite
      sprite.visible = progress < 1 && age > 0 && age < 1 && intensity > 0
      if (!sprite.visible) {
        sprite.alpha = 0
        continue
      }
      const diameter = mote.size * (1 - smoothstep(0.65, 1, age) * 0.18)
      sprite.width = sprite.height = diameter
      const swirl = Math.sin(age * Math.PI) * 0.025
      let x = mote.originX + mote.driftX * age + Math.sin(mote.phase + age * 4) * swirl
      let y = mote.originY + mote.driftY * age + Math.cos(mote.phase + age * 3) * swirl
      const limit = Math.max(
        0,
        1 - (diameter * Math.SQRT1_2) / Math.max(1, Math.min(halfWidth, halfHeight))
      )
      const reach = Math.hypot(x, y)
      if (reach > limit) {
        x *= limit / reach
        y *= limit / reach
      }
      sprite.position.set(x * halfWidth, y * halfHeight)
      sprite.rotation = mote.rotation + mote.spin * age
      sprite.alpha =
        mote.opacity *
        Math.min(1, Math.max(0, intensity)) *
        smoothstep(0, 0.12, age) *
        (1 - smoothstep(0.45, 1, age))
      const cooling = Math.max(age, smoothstep(0.72, 0.98, progress))
      const { core, flame, red, soot } = this.colors
      sprite.tint =
        cooling < 0.18
          ? mixColor(core, flame, smoothstep(0, 0.18, cooling))
          : cooling < 0.5
            ? mixColor(flame, red, smoothstep(0.18, 0.5, cooling))
            : mixColor(red, soot, smoothstep(0.5, 0.94, cooling))
    }
  }

  destroy(): void {
    if (!this.container.destroyed) this.container.destroy({ children: true })
  }
}
