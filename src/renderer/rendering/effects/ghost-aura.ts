import { Filter, Sprite, UniformGroup } from 'pixi.js'
import type { Container } from 'pixi.js'
import { Actor } from '../../ui/components/actor'
import { CachedOutlineFilter } from './cached-ghost-aura-filter'
import { sampleOutlineLoop } from './outline-animation-loop'
import {
  createGhostAuraGlProgram,
  createGhostAuraGpuProgram
} from './ghost-aura-shader'
import { GHOST_AURA_CONFIG } from './outline-tuning'
import type {
  GhostAuraTuning as OutlineTuning,
  GhostAuraPalette as OutlinePalette
} from '../../../shared/ipc/outline-tuning'
type OutlinePaletteInput = OutlinePalette
export interface GhostAuraOptions {
  readonly palette?: OutlinePaletteInput
  /** Set false to force the live distance search for a sprite silhouette. */
  readonly cacheDistance?: boolean
  /** Explicit offscreen resolution for one-time baking; live effects inherit DPI. */
  readonly resolution?: number | 'inherit'
  /** Offstage cache baking must remain active during the F3 comparison. */
  readonly debugSuppressible?: boolean
}

type Rgb = readonly [number, number, number]

function toRgb01(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
}

function saturateRgb(rgb: Rgb, saturation: number): [number, number, number] {
  if (saturation === 1) return [...rgb]
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  return rgb.map((channel) =>
    Math.min(1, Math.max(0, luminance + (channel - luminance) * saturation))
  ) as [number, number, number]
}

function resolvePalette(input: OutlinePaletteInput): OutlinePalette {
  return input
}

function writeColor(
  uniforms: UniformGroup,
  name: 'uBaseColor' | 'uRimColor' | 'uGlowColor' | 'uHotColor',
  rgb: Rgb
): void {
  const value = uniforms.uniforms[name] as unknown as number[]
  value[0] = rgb[0]
  value[1] = rgb[1]
  value[2] = rgb[2]
  value[3] = 1
}

function writeVector(
  uniforms: UniformGroup,
  name: 'uGeometry' | 'uDetail' | 'uMotion' | 'uOrganic',
  values: readonly [number, number, number, number]
): void {
  const target = uniforms.uniforms[name] as unknown as number[]
  target[0] = values[0]
  target[1] = values[1]
  target[2] = values[2]
  target[3] = values[3]
}

function outlinePadding(tuning: OutlineTuning): number {
  const widthReach =
    (tuning.ribbonWidth + tuning.rimWidth + tuning.glowWidth) *
    (1 + (tuning.contourVariation / 10) * 0.55)
  return widthReach + tuning.edgeWobble * 1.5 + 4
}

/** Asset-agnostic animated ribbon applied to the alpha silhouette of a display object. */
export class GhostAura extends Actor {
  private static readonly debugInstances = new Set<GhostAura>()
  private static debugSuppressed = false
  private debugRenderable: boolean | null = null

  /** Hide outline-only proxies while the developer filter bypass is active. */
  static setDebugSuppressed(suppressed: boolean): void {
    if (!import.meta.env.DEV) return
    this.debugSuppressed = suppressed
    for (const outline of this.debugInstances) outline.syncDebugSuppression()
  }

  private readonly target: Container
  private readonly filter: Filter
  private readonly uniforms: UniformGroup
  private tuning: OutlineTuning
  private paletteInput: OutlinePaletteInput = GHOST_AURA_CONFIG.palette
  private readonly timeState = { value: 0 }
  private timeTween?: gsap.core.Tween
  private enabled = true

  constructor(target: Container, options: GhostAuraOptions = {}) {
    super()
    this.target = target
    this.tuning = GHOST_AURA_CONFIG.tuning
    const usesDistanceCache =
      target instanceof Sprite && options.cacheDistance !== false

    this.uniforms = new UniformGroup({
      uBaseColor: { value: [0, 0, 0, 1], type: 'vec4<f32>' },
      uRimColor: { value: [0, 0, 0, 1], type: 'vec4<f32>' },
      uGlowColor: { value: [0, 0, 0, 1], type: 'vec4<f32>' },
      uHotColor: { value: [1, 1, 1, 1], type: 'vec4<f32>' },
      uGeometry: {
        value: [
          this.tuning.ribbonWidth,
          this.tuning.rimWidth,
          this.tuning.glowWidth,
          this.tuning.glowStrength
        ],
        type: 'vec4<f32>'
      },
      uDetail: {
        value: [
          this.tuning.highlightStrength,
          this.tuning.hotspotScale,
          this.tuning.hotspotDensity,
          this.tuning.edgeWobble
        ],
        type: 'vec4<f32>'
      },
      uMotion: {
        value: [
          this.tuning.motionSpeed,
          this.tuning.edgeSoftness,
          this.tuning.innerEdgeWidth,
          this.tuning.pulseRate
        ],
        type: 'vec4<f32>'
      },
      uOrganic: {
        value: [this.tuning.contourVariation, 0, 0, 0],
        type: 'vec4<f32>'
      },
      uTime: { value: 0, type: 'f32' },
      uLoop: { value: [0, 0, 0, 0], type: 'vec4<f32>' }
    })

    const filterOptions = {
      glProgram: createGhostAuraGlProgram(),
      gpuProgram: createGhostAuraGpuProgram(),
      resources: { outlineUniforms: this.uniforms },
      padding: this.resolvePadding(options.resolution),
      resolution: options.resolution ?? ('inherit' as const),
      antialias: 'inherit' as const
    }
    // Sprite distances are reprojected through safe transforms; material noise
    // and opacity remain live. Deforming meshes and composed containers retain
    // the full distance search.
    this.filter = usesDistanceCache
      ? new CachedOutlineFilter(target, filterOptions, this.uniforms)
      : new Filter(filterOptions)
    this.label = 'ghost-aura'
    target.filters = [...(target.filters ?? []), this.filter]

    this.setPalette(options.palette ?? GHOST_AURA_CONFIG.palette)

    this.timeTween = this.tweenTo(this.timeState, {
      value: 1,
      duration: 1,
      ease: 'none',
      repeat: -1,
      onUpdate: () => this.syncTime()
    })
    if (import.meta.env.DEV && options.debugSuppressible !== false) {
      GhostAura.debugInstances.add(this)
      this.syncDebugSuppression()
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.target.visible = enabled
    if (enabled) this.timeTween?.resume()
    else this.timeTween?.pause()
    if (!enabled && this.filter instanceof CachedOutlineFilter) this.filter.resetCache()
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setPalette(input: OutlinePaletteInput): void {
    this.paletteInput = input
    const palette = resolvePalette(input)
    const saturation = this.tuning.saturation
    writeColor(
      this.uniforms,
      'uBaseColor',
      saturateRgb(toRgb01(palette.baseColor), saturation)
    )
    writeColor(
      this.uniforms,
      'uRimColor',
      saturateRgb(toRgb01(palette.outerColor), saturation)
    )
    writeColor(
      this.uniforms,
      'uGlowColor',
      saturateRgb(toRgb01(palette.glowColor ?? palette.outerColor), saturation)
    )
    writeColor(
      this.uniforms,
      'uHotColor',
      saturateRgb(toRgb01(palette.highlightColor), saturation)
    )
  }

  getPadding(): number {
    return this.filter.padding
  }

  /** Optional loop duration closes the noise path for seamless frame baking. */
  setAnimationTime(time: number, loopDuration = 0): void {
    this.timeTween?.pause()
    this.uniforms.uniforms.uTime = time
    this.uniforms.uniforms.uLoop = sampleOutlineLoop(
      time,
      loopDuration,
      this.tuning.pulseRate
    )
  }

  /** Applies an in-memory tuning draft without changing the registered preset. */
  setTuning(tuning: OutlineTuning): void {
    this.tuning = tuning
    writeVector(this.uniforms, 'uGeometry', [
      this.tuning.ribbonWidth,
      this.tuning.rimWidth,
      this.tuning.glowWidth,
      this.tuning.glowStrength
    ])
    writeVector(this.uniforms, 'uDetail', [
      this.tuning.highlightStrength,
      this.tuning.hotspotScale,
      this.tuning.hotspotDensity,
      this.tuning.edgeWobble
    ])
    writeVector(this.uniforms, 'uMotion', [
      this.tuning.motionSpeed,
      this.tuning.edgeSoftness,
      this.tuning.innerEdgeWidth,
      this.tuning.pulseRate
    ])
    writeVector(this.uniforms, 'uOrganic', [this.tuning.contourVariation, 0, 0, 0])
    this.setPalette(this.paletteInput)
    this.filter.padding = this.resolvePadding(this.filter.resolution)
  }

  override dispose(): void {
    if (import.meta.env.DEV) {
      GhostAura.debugInstances.delete(this)
      // Some callers reuse the silhouette sprite as a summon ghost.
      if (this.debugRenderable !== null && !this.target.destroyed)
        this.target.renderable = this.debugRenderable
      this.debugRenderable = null
    }
    if (!this.target.destroyed) {
      this.target.filters = (this.target.filters ?? []).filter(
        (filter) => filter !== this.filter
      )
    }
    this.filter.destroy()
    super.dispose()
  }

  private syncTime(): void {
    if (!this.timeTween) return
    this.uniforms.uniforms.uTime = this.timeTween.totalTime()
  }

  private resolvePadding(resolution: number | 'inherit' | undefined): number {
    return (
      outlinePadding(this.tuning) / (typeof resolution === 'number' ? resolution : 1)
    )
  }

  private syncDebugSuppression(): void {
    if (GhostAura.debugSuppressed) {
      this.debugRenderable ??= this.target.renderable
      this.target.renderable = false
    } else if (this.debugRenderable !== null) {
      this.target.renderable = this.debugRenderable
      this.debugRenderable = null
    }
  }
}
