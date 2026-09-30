import { Filter } from 'pixi.js'
import { godRaysVertex, godRaysFragment } from './god-rays-shader'
import type { GodRaysTuning } from '../../desktop/contracts/ipc/god-rays-tuning'
export type { GodRaysTuning } from '../../desktop/contracts/ipc/god-rays-tuning'

export interface GodRaysEffect {
  readonly filter: Filter
  setTuning(tuning: GodRaysTuning): void
  update(deltaMS: number): void
  destroy(): void
}

/** Apply to a full-size white carrier sprite, above the artwork to light. */
export function createGodRaysFilter(tuning: GodRaysTuning): GodRaysEffect {
  const filter = Filter.from({
    gl: {
      vertex: godRaysVertex,
      fragment: godRaysFragment,
      name: 'god-rays',
      preferredFragmentPrecision: 'highp'
    },
    blendMode: 'screen',
    resolution: 1,
    padding: 0,
    // Cropping the filter quad would change the effect's normalized coordinates.
    clipToViewport: false,
    resources: {
      godRaysUniforms: {
        uTime: { value: 0, type: 'f32' },
        uAngle: { value: tuning.angle, type: 'f32' },
        uPosition: { value: tuning.position, type: 'f32' },
        uSpread: { value: tuning.spread, type: 'f32' },
        uCutoff: { value: tuning.cutoff, type: 'f32' },
        uFalloff: { value: tuning.falloff, type: 'f32' },
        uEdgeFade: { value: tuning.edgeFade, type: 'f32' },
        uSpeed: { value: tuning.speed, type: 'f32' },
        uRay1Density: { value: tuning.ray1Density, type: 'f32' },
        uRay2Density: { value: tuning.ray2Density, type: 'f32' },
        uRay2Intensity: { value: tuning.ray2Intensity, type: 'f32' },
        uColor: { value: new Float32Array(tuning.color), type: 'vec4<f32>' },
        uHdr: { value: tuning.hdr ? 1 : 0, type: 'f32' },
        uSeed: { value: tuning.seed, type: 'f32' }
      }
    }
  })
  const uniforms = filter.resources.godRaysUniforms.uniforms
  return {
    filter,
    setTuning(value): void {
      uniforms.uAngle = value.angle
      uniforms.uPosition = value.position
      uniforms.uSpread = value.spread
      uniforms.uCutoff = value.cutoff
      uniforms.uFalloff = value.falloff
      uniforms.uEdgeFade = value.edgeFade
      uniforms.uSpeed = value.speed
      uniforms.uRay1Density = value.ray1Density
      uniforms.uRay2Density = value.ray2Density
      uniforms.uRay2Intensity = value.ray2Intensity
      uniforms.uColor.set(value.color)
      uniforms.uHdr = value.hdr ? 1 : 0
      uniforms.uSeed = value.seed
    },
    update(deltaMS): void {
      uniforms.uTime += deltaMS / 1000
    },
    destroy(): void {
      filter.destroy()
    }
  }
}
