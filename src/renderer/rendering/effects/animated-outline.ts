import { Filter, UniformGroup } from 'pixi.js'
import type { Container } from 'pixi.js'
import { Actor } from '../../ui/components/actor'
import {
  createAnimatedOutlineGlProgram,
  createAnimatedOutlineGpuProgram
} from './animated-outline-shader'
import {
  OUTLINE_TUNINGS,
  type OutlinePresetName,
  type OutlineTuning
} from './outline-tuning'
import {
  getExperimentalOutlineDirectionId,
  resolveExperimentalOutlineTuning
} from '@outline-directions'

export interface OutlinePalette {
  /** Dense inner energy body. */
  readonly baseColor: number
  /** Darker exterior body and the bloom cast from it. */
  readonly outerColor: number
  /** Hottest animated regions inside the energy body. */
  readonly highlightColor: number
}

export const OUTLINE_PALETTES = {
  blue: {
    baseColor: 0x6cffff,
    outerColor: 0x188cff,
    highlightColor: 0xffffff
  },
  green: {
    baseColor: 0x6cff46,
    outerColor: 0x219618,
    highlightColor: 0xbfffa1
  },
  orange: {
    baseColor: 0xffff0a,
    outerColor: 0xf9aa11,
    highlightColor: 0xfffc10
  },
  red: {
    baseColor: 0xfffb6b,
    outerColor: 0xdb6c2f,
    highlightColor: 0xffffa4
  },
  white: {
    baseColor: 0xf5f5f5,
    outerColor: 0x4e4e4e,
    highlightColor: 0xffffff
  }
} as const satisfies Record<string, OutlinePalette>

export type OutlinePaletteName = keyof typeof OUTLINE_PALETTES
export type OutlinePaletteInput = OutlinePaletteName | OutlinePalette
export type { OutlinePresetName, OutlineTuning } from './outline-tuning'

type Rgb = readonly [number, number, number]

function toRgb01(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
}

function resolvePalette(input: OutlinePaletteInput): OutlinePalette {
  return typeof input === 'string' ? OUTLINE_PALETTES[input] : input
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

function outlinePadding(tuning: OutlineTuning): number {
  return (
    tuning.ribbonWidth +
    tuning.rimWidth +
    tuning.glowWidth +
    tuning.edgeWobble * 1.5 +
    4
  )
}

function resolveTuning(preset: OutlinePresetName): OutlineTuning {
  const base = OUTLINE_TUNINGS[preset]
  const direction = import.meta.env.DEV
    ? getExperimentalOutlineDirectionId()
    : undefined
  return resolveExperimentalOutlineTuning(direction, preset, base)
}

/** Asset-agnostic animated ribbon applied to the alpha silhouette of a display object. */
export class AnimatedOutline extends Actor {
  private readonly target: Container
  private readonly filter: Filter
  private readonly uniforms: UniformGroup
  private readonly tuning: OutlineTuning
  private readonly timeState = { value: 0 }
  private timeTween?: gsap.core.Tween
  private enabled = true

  constructor(
    target: Container,
    palette: OutlinePaletteInput,
    preset: OutlinePresetName = 'button'
  ) {
    super()
    this.target = target
    this.tuning = resolveTuning(preset)

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
        value: [this.tuning.motionSpeed, this.tuning.edgeSoftness, 0, 0],
        type: 'vec4<f32>'
      },
      uTime: { value: 0, type: 'f32' }
    })

    this.filter = new Filter({
      glProgram: createAnimatedOutlineGlProgram(),
      gpuProgram: createAnimatedOutlineGpuProgram(),
      resources: { outlineUniforms: this.uniforms },
      padding: outlinePadding(this.tuning),
      resolution: 'inherit',
      antialias: 'inherit'
    })
    this.label = 'animated-outline'
    target.filters = [...(target.filters ?? []), this.filter]

    this.setPalette(palette)

    this.timeTween = this.tweenTo(this.timeState, {
      value: 1,
      duration: 1,
      ease: 'none',
      repeat: -1,
      onUpdate: () => this.syncTime()
    })
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.target.visible = enabled
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setPalette(input: OutlinePaletteInput): void {
    const palette = resolvePalette(input)
    writeColor(this.uniforms, 'uBaseColor', toRgb01(palette.baseColor))
    writeColor(this.uniforms, 'uRimColor', toRgb01(palette.outerColor))
    writeColor(this.uniforms, 'uGlowColor', toRgb01(palette.outerColor))
    writeColor(this.uniforms, 'uHotColor', toRgb01(palette.highlightColor))
  }

  override dispose(): void {
    this.target.filters = (this.target.filters ?? []).filter(
      (filter) => filter !== this.filter
    )
    this.filter.destroy()
    super.dispose()
  }

  private syncTime(): void {
    if (!this.timeTween) return
    this.uniforms.uniforms.uTime = this.timeTween.totalTime()
  }
}
