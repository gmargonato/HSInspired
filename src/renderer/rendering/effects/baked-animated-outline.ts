import {
  AnimatedSprite,
  Container,
  Rectangle,
  Sprite,
  type Renderer,
  type Texture
} from 'pixi.js'
import { Actor } from '../../ui/components/actor'
import {
  AnimatedOutline,
  OUTLINE_PALETTES,
  type OutlinePalette,
  type OutlinePaletteInput,
  type OutlinePresetName
} from './animated-outline'
import { getExperimentalOutlineDirectionId } from '@outline-directions'
import { getOutlineTuning } from './outline-tuning'

const FRAME_DURATION_MS = 1_000 / 12
const FRAME_TIMES = [
  0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1, 0.875, 0.75, 0.625, 0.5, 0.375,
  0.25, 0.125
] as const

interface BakedOutlineCacheEntry {
  readonly key: string
  readonly frames: Texture[]
  readonly padding: number
  references: number
}

const rendererCaches = new WeakMap<Renderer, Map<string, BakedOutlineCacheEntry>>()

function resolvePalette(input: OutlinePaletteInput): OutlinePalette {
  return typeof input === 'string' ? OUTLINE_PALETTES[input] : input
}

function paletteKey(input: OutlinePaletteInput): string {
  const palette = resolvePalette(input)
  return `${palette.baseColor}:${palette.outerColor}:${palette.highlightColor}`
}

function cacheKey(options: {
  readonly texture: Texture
  readonly width: number
  readonly height: number
  readonly palette: OutlinePaletteInput
  readonly preset: OutlinePresetName
  readonly resolution: number
}): string {
  const texture = options.texture
  const tuning = getOutlineTuning(options.preset)
  return [
    texture.uid,
    texture.source.uid,
    texture.frame.x,
    texture.frame.y,
    texture.frame.width,
    texture.frame.height,
    options.width,
    options.height,
    options.preset,
    paletteKey(options.palette),
    options.resolution,
    JSON.stringify(tuning),
    import.meta.env.DEV ? (getExperimentalOutlineDirectionId() ?? '') : ''
  ].join('|')
}

function createEntry(
  renderer: Renderer,
  options: {
    readonly texture: Texture
    readonly width: number
    readonly height: number
    readonly palette: OutlinePaletteInput
    readonly preset: OutlinePresetName
    readonly resolution: number
  },
  key: string
): BakedOutlineCacheEntry {
  const target = new Sprite(options.texture)
  target.width = options.width
  target.height = options.height
  target.eventMode = 'none'
  const stage = new Container()
  stage.addChild(target)
  const outline = new AnimatedOutline(target, {
    palette: options.palette,
    preset: options.preset,
    cacheDistance: true,
    resolution: options.resolution
  })
  const padding = outline.getPadding()
  const frame = new Rectangle(
    -padding,
    -padding,
    options.width + padding * 2,
    options.height + padding * 2
  )
  const frames: Texture[] = []

  try {
    for (const time of FRAME_TIMES) {
      outline.setAnimationTime(time)
      frames.push(
        renderer.generateTexture({
          target: stage,
          frame,
          resolution: options.resolution,
          antialias: true
        })
      )
    }
  } catch (error) {
    for (const texture of frames) texture.destroy(true)
    throw error
  } finally {
    outline.dispose()
    target.removeFromParent()
    target.destroy({ texture: false })
    stage.destroy()
  }

  return { key, frames, padding, references: 0 }
}

function acquireEntry(
  renderer: Renderer,
  options: {
    readonly texture: Texture
    readonly width: number
    readonly height: number
    readonly palette: OutlinePaletteInput
    readonly preset: OutlinePresetName
    readonly resolution: number
  }
): BakedOutlineCacheEntry {
  let cache = rendererCaches.get(renderer)
  if (!cache) {
    cache = new Map()
    rendererCaches.set(renderer, cache)
  }
  const key = cacheKey(options)
  let entry = cache.get(key)
  if (!entry) {
    entry = createEntry(renderer, options, key)
    cache.set(key, entry)
  }
  entry.references += 1
  return entry
}

function releaseEntry(renderer: Renderer, entry: BakedOutlineCacheEntry): void {
  entry.references -= 1
  if (entry.references > 0) return
  const cache = rendererCaches.get(renderer)
  if (cache?.get(entry.key) === entry) cache.delete(entry.key)
  for (const texture of entry.frames) texture.destroy(true)
}

/**
 * A shader-authored outline animation baked once and shared by settled hand cards.
 * The ping-pong frame sequence keeps the material moving without per-card filters.
 */
export class BakedAnimatedOutline extends Actor {
  private static readonly debugInstances = new Set<BakedAnimatedOutline>()
  private static debugSuppressed = false

  static setDebugSuppressed(suppressed: boolean): void {
    if (!import.meta.env.DEV) return
    this.debugSuppressed = suppressed
    for (const outline of this.debugInstances) outline.syncVisibility()
  }

  private animation: AnimatedSprite | null = null
  private entry: BakedOutlineCacheEntry | null = null
  private palette: OutlinePaletteInput
  private preset: OutlinePresetName
  private enabled = true
  private disposed = false

  constructor(
    private readonly renderer: Renderer,
    private readonly texture: Texture,
    private readonly displayWidth: number,
    private readonly displayHeight: number,
    private readonly displayScale: number,
    palette: OutlinePaletteInput = 'green',
    preset: OutlinePresetName = 'card'
  ) {
    super()
    this.palette = palette
    this.preset = preset
    this.eventMode = 'none'
    this.label = 'baked-animated-outline'
    this.rebuild()
    if (import.meta.env.DEV) {
      BakedAnimatedOutline.debugInstances.add(this)
      this.syncVisibility()
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.syncVisibility()
  }

  setPalette(palette: OutlinePaletteInput): void {
    const previous = paletteKey(this.palette)
    this.palette = palette
    if (paletteKey(palette) !== previous) this.rebuild()
  }

  setPreset(preset: OutlinePresetName): void {
    if (this.preset === preset) return
    this.preset = preset
    this.rebuild()
  }

  setAppearance(palette: OutlinePaletteInput, preset: OutlinePresetName): void {
    const changed =
      paletteKey(this.palette) !== paletteKey(palette) || this.preset !== preset
    this.palette = palette
    this.preset = preset
    if (changed) this.rebuild()
  }

  override dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (import.meta.env.DEV) BakedAnimatedOutline.debugInstances.delete(this)
    const entry = this.entry
    this.entry = null
    this.animation?.stop()
    this.animation = null
    if (entry) releaseEntry(this.renderer, entry)
    super.dispose()
  }

  private rebuild(): void {
    const resolution = Math.max(0.25, this.renderer.resolution * this.displayScale)
    const nextEntry = acquireEntry(this.renderer, {
      texture: this.texture,
      width: this.displayWidth,
      height: this.displayHeight,
      palette: this.palette,
      preset: this.preset,
      resolution
    })
    if (nextEntry === this.entry) {
      releaseEntry(this.renderer, nextEntry)
      return
    }

    const previousEntry = this.entry
    const previousAnimation = this.animation
    const animation = new AnimatedSprite({
      textures: nextEntry.frames.map((texture) => ({
        texture,
        time: FRAME_DURATION_MS
      })),
      autoPlay: true,
      loop: true
    })
    animation.position.set(-nextEntry.padding, -nextEntry.padding)
    animation.eventMode = 'none'
    animation.label = 'baked-animated-outline.frames'
    this.addChild(animation)
    this.entry = nextEntry
    this.animation = animation
    this.syncVisibility()

    previousAnimation?.removeFromParent()
    previousAnimation?.destroy({ texture: false })
    if (previousEntry) releaseEntry(this.renderer, previousEntry)
  }

  private syncVisibility(): void {
    const visible = this.enabled && !BakedAnimatedOutline.debugSuppressed
    this.visible = visible
    if (visible) this.animation?.play()
    else this.animation?.stop()
  }
}
