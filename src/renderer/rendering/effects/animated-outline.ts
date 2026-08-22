import { BlurFilter, Filter, UniformGroup } from 'pixi.js'
import type { Container } from 'pixi.js'
import { Actor } from '../../ui/components/actor'
import {
  createAnimatedOutlineGlProgram,
  createAnimatedOutlineGpuProgram
} from './animated-outline-shader'

export const OUTLINE_COLORS = {
  blue: 0x2383fc,
  green: 0x57fc38,
  orange: 0xff8c00,
  red: 0xff2b2b,
  white: 0xffffff
} as const

export type OutlineColorName = keyof typeof OUTLINE_COLORS

const OUTLINE_INTENSITY = 2.2
export interface OutlineProfile {
  /** Width of the ribbon in logical screen pixels. */
  readonly thickness: number
  /** Soft transition around the ribbon in logical screen pixels. */
  readonly edgeSoftness: number
  /** Width of the bright inner core in logical screen pixels. */
  readonly coreWidth: number
  /** Width of the colored outer lip in logical screen pixels. */
  readonly lipWidth: number
  /** Maximum animated expansion in logical screen pixels. */
  readonly blobExpansion: number
  /** Gaussian blur strength in logical screen pixels. */
  readonly blurStrength: number
  /** Number of blur passes. */
  readonly blurQuality: number
}

/** Separate visual budgets keep small cards from inheriting the button's halo. */
export const OUTLINE_PROFILES = {
  card: {
    thickness: 6,
    edgeSoftness: 2,
    coreWidth: 2,
    lipWidth: 2,
    blobExpansion: 3,
    blurStrength: 0.5,
    blurQuality: 2
  },
  button: {
    thickness: 10,
    edgeSoftness: 10,
    coreWidth: 3,
    lipWidth: 3,
    blobExpansion: 9,
    blurStrength: 1,
    blurQuality: 2
  }
} as const satisfies Record<'card' | 'button', OutlineProfile>

function outlinePadding(profile: OutlineProfile): number {
  return (
    profile.thickness +
    profile.edgeSoftness +
    profile.blobExpansion +
    profile.blurStrength * 2 +
    4
  )
}

function toRgb01(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
}

/** Scattered light shows the hue fully saturated, so the halo strips the white component. */
function deriveGlowRgb([r, g, b]: readonly number[]): [number, number, number] {
  const maximum = Math.max(r, g, b)
  const minimum = Math.min(r, g, b)
  const chroma = maximum - minimum

  if (chroma === 0 || maximum === 0) return [maximum, maximum, maximum]
  const saturate = (channel: number): number => ((channel - minimum) / chroma) * maximum

  return [saturate(r), saturate(g), saturate(b)]
}

/** Asset-agnostic animated ribbon applied to the alpha silhouette of a display object. */
export class AnimatedOutline extends Actor {
  private readonly target: Container
  private readonly filter: Filter
  private readonly blurFilter: BlurFilter
  private readonly uniforms: UniformGroup
  private readonly timeState = { value: 0 }
  private timeTween?: gsap.core.Tween
  private enabled = true

  constructor(
    target: Container,
    color: OutlineColorName | number,
    profile: OutlineProfile = OUTLINE_PROFILES.button
  ) {
    super()
    this.target = target

    this.uniforms = new UniformGroup({
      uBaseColor: { value: [0, 0, 0, 1], type: 'vec4<f32>' },
      uEdgeColor: { value: [0, 0, 0, 1], type: 'vec4<f32>' },
      uShape: {
        value: [
          profile.thickness,
          profile.edgeSoftness,
          profile.coreWidth,
          profile.lipWidth
        ],
        type: 'vec4<f32>'
      },
      uAtmosphere: {
        value: [1, profile.blobExpansion, 0, 0],
        type: 'vec4<f32>'
      },
      uSurface: {
        value: [0.26, 32, 0.58, 3.2],
        type: 'vec4<f32>'
      },
      uMotion: {
        value: [0.32, 34, 0.85, 1],
        type: 'vec4<f32>'
      },
      uTime: { value: 0, type: 'f32' }
    })

    this.filter = new Filter({
      glProgram: createAnimatedOutlineGlProgram(),
      gpuProgram: createAnimatedOutlineGpuProgram(),
      resources: { outlineUniforms: this.uniforms },
      padding: outlinePadding(profile),
      resolution: 'inherit',
      antialias: 'inherit'
    })
    this.blurFilter = new BlurFilter({
      strength: profile.blurStrength,
      quality: profile.blurQuality,
      resolution: 'inherit',
      antialias: 'inherit',
      kernelSize: 5
    })
    this.label = 'animated-outline'
    target.filters = [...(target.filters ?? []), this.filter, this.blurFilter]

    this.setColor(color)

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

  setColor(color: OutlineColorName | number): void {
    const hex = typeof color === 'number' ? color : OUTLINE_COLORS[color]
    const baseRgb = toRgb01(hex)
    this.writeRgb('uBaseColor', baseRgb)
    this.writeRgb('uEdgeColor', deriveGlowRgb(baseRgb))
  }

  override dispose(): void {
    this.target.filters = (this.target.filters ?? []).filter(
      (filter) => filter !== this.filter && filter !== this.blurFilter
    )
    this.blurFilter.destroy()
    this.filter.destroy()
    super.dispose()
  }

  private writeRgb(
    uniformName: 'uBaseColor' | 'uEdgeColor',
    [r, g, b]: readonly number[]
  ): void {
    const value = this.uniforms.uniforms[uniformName] as unknown as number[]
    value[0] = r * OUTLINE_INTENSITY
    value[1] = g * OUTLINE_INTENSITY
    value[2] = b * OUTLINE_INTENSITY
    value[3] = 1
  }

  private syncTime(): void {
    if (!this.timeTween) return
    this.uniforms.uniforms.uTime = this.timeTween.totalTime()
  }
}
