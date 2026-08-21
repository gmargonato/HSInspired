import { BlurFilter, Filter, UniformGroup } from 'pixi.js'
import type { Container } from 'pixi.js'
import { Actor } from '../../ui/components/Actor'
import {
  createAnimatedOutlineGlProgram,
  createAnimatedOutlineGpuProgram
} from './animated-outline-shader'

export const OUTLINE_COLORS = {
  blue: 0x00a2ff,
  green: 0x57fc38,
  orange: 0xff8c00,
  red: 0xff2b2b,
  white: 0xffffff
} as const

export type OutlineColorName = keyof typeof OUTLINE_COLORS

const OUTLINE_THICKNESS = 12
const OUTLINE_EDGE_SOFTNESS = 0
const OUTLINE_BLOB_EXPANSION = 7
const OUTLINE_BLUR_STRENGTH = 2
const OUTLINE_BLUR_QUALITY = 2

function toRgb01(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
}

/** Preserves hue while producing a darker, slightly less saturated material edge. */
function deriveEdgeRgb([r, g, b]: readonly number[]): [number, number, number] {
  const maximum = Math.max(r, g, b)
  const minimum = Math.min(r, g, b)
  const chroma = maximum - minimum
  const edgeMaximum = maximum * 0.67

  if (chroma === 0 || maximum === 0) return [edgeMaximum, edgeMaximum, edgeMaximum]

  const saturation = chroma / maximum
  const edgeMinimum = edgeMaximum * (1 - saturation * 0.96)
  const edgeChroma = edgeMaximum - edgeMinimum
  const remap = (channel: number): number =>
    edgeMinimum + ((channel - minimum) / chroma) * edgeChroma

  return [remap(r), remap(g), remap(b)]
}

/** Asset-agnostic animated ribbon applied to the alpha silhouette of a display object. */
export class AnimatedOutline extends Actor {
  private readonly target: Container
  private readonly filter: Filter
  private readonly blurFilter: BlurFilter
  private readonly uniforms: UniformGroup
  private readonly timeState = { value: 0 }
  private timeTween?: gsap.core.Tween

  constructor(target: Container, color: OutlineColorName | number) {
    super()
    this.target = target

    this.uniforms = new UniformGroup({
      uBaseColor: { value: [0, 0, 0, 1], type: 'vec4<f32>' },
      uEdgeColor: { value: [0, 0, 0, 1], type: 'vec4<f32>' },
      uShape: {
        value: [OUTLINE_THICKNESS, OUTLINE_EDGE_SOFTNESS, 2, 3],
        type: 'vec4<f32>'
      },
      uAtmosphere: {
        value: [0.98, OUTLINE_BLOB_EXPANSION, 0, 0],
        type: 'vec4<f32>'
      },
      uSurface: {
        value: [0.26, 32, 0.58, 3.2],
        type: 'vec4<f32>'
      },
      uMotion: {
        value: [0.32, 34, 0.74, 0],
        type: 'vec4<f32>'
      },
      uTime: { value: 0, type: 'f32' }
    })

    this.filter = new Filter({
      glProgram: createAnimatedOutlineGlProgram(),
      gpuProgram: createAnimatedOutlineGpuProgram(),
      resources: { outlineUniforms: this.uniforms },
      padding: OUTLINE_THICKNESS + OUTLINE_EDGE_SOFTNESS + OUTLINE_BLOB_EXPANSION + 4
    })
    this.blurFilter = new BlurFilter({
      strength: OUTLINE_BLUR_STRENGTH,
      quality: OUTLINE_BLUR_QUALITY,
      resolution: 1,
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
    this.target.visible = enabled
  }

  setColor(color: OutlineColorName | number): void {
    const hex = typeof color === 'number' ? color : OUTLINE_COLORS[color]
    const baseRgb = toRgb01(hex)
    this.writeRgb('uBaseColor', baseRgb)
    this.writeRgb('uEdgeColor', deriveEdgeRgb(baseRgb))
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
    value[0] = r
    value[1] = g
    value[2] = b
    value[3] = 1
  }

  private syncTime(): void {
    if (!this.timeTween) return
    this.uniforms.uniforms.uTime = this.timeTween.totalTime()
  }
}
