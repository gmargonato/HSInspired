import { BlurFilter, Filter, Texture, TexturePool } from 'pixi.js'
import { ghostMistVertex, ghostMistFragment } from './ghost-aura-shader'
import {
  GHOST_WIND_DIRECTIONS,
  type GhostAuraTuning,
  type GhostAuraPalette
} from '../../desktop/contracts/ipc/outline-tuning'
export interface GhostMistValues extends GhostAuraTuning, GhostAuraPalette {
  progress: number
}
const rgb = (n: number): Float32Array =>
  new Float32Array([((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255])
export function createGhostMistFilter(
  noise: Texture,
  dissolve: Texture,
  values: GhostMistValues
) {
  const blur = new BlurFilter({ strength: 20, quality: 6 })
  const copy = Filter.from({
    gl: {
      vertex: ghostMistVertex,
      fragment:
        'in vec2 vTextureCoord; out vec4 finalColor; uniform sampler2D uTexture; void main() { finalColor = texture(uTexture, vTextureCoord); }',
      preferredFragmentPrecision: 'highp'
    }
  })
  const filter = Filter.from({
    // Shared uniforms must have identical precision in both shader stages.
    // High precision also keeps pixel-area math from overflowing mediump.
    gl: {
      vertex: ghostMistVertex,
      fragment: ghostMistFragment,
      name: 'ghost-mist',
      preferredFragmentPrecision: 'highp'
    },
    resolution: 1,
    padding: 400,
    antialias: 'inherit',
    resources: {
      uNoise: noise.source,
      uDissolve: dissolve.source,
      uHalo: Texture.EMPTY.source,
      mistUniforms: {
        uWind: { value: new Float32Array([1, 0]), type: 'vec2<f32>' },
        uFlow: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
        uTime: { value: 0, type: 'f32' },
        uExpansion: { value: values.mistWidth, type: 'f32' },
        uIntensity: {
          value: values.mistEnabled ? values.mistIntensity : 0,
          type: 'f32'
        },
        uTextureScale: { value: values.mistTextureScale, type: 'f32' },
        uProgress: { value: 0, type: 'f32' },
        uPrimary: { value: rgb(values.mistPrimaryColor), type: 'vec3<f32>' },
        uSecondary: { value: rgb(values.mistHighlightColor), type: 'vec3<f32>' }
      }
    }
  })
  const u = filter.resources.mistUniforms.uniforms
  const baseApply = filter.apply.bind(filter)
  filter.apply = (system, input, output, clear) => {
    const halo = TexturePool.getSameSizeTexture(input)
    const work = TexturePool.getSameSizeTexture(input)
    try {
      const dispersion = Math.max(0, (values.progress - 0.18) / 0.82)
      blur.strength =
        values.mistWidth * (0.3 + values.mistSoftness * 0.65) * (1 + dispersion)
      // Blur ping-pongs through its input; preserve the original artwork.
      system.applyFilter(copy, input, work, true)
      blur.apply(system, work, halo, true)
      filter.resources.uHalo = halo.source
      baseApply(system, input, output, clear)
    } finally {
      filter.resources.uHalo = Texture.EMPTY.source
      TexturePool.returnTexture(halo)
      TexturePool.returnTexture(work)
    }
  }
  function sync(): void {
    const direction = GHOST_WIND_DIRECTIONS[values.windDirection]
    u.uWind.set([direction.x, direction.y])
    u.uExpansion = values.mistWidth
    u.uIntensity = values.mistEnabled ? values.mistIntensity : 0
    u.uTextureScale = values.mistTextureScale
    u.uProgress = values.progress
    u.uPrimary.set(rgb(values.mistPrimaryColor))
    u.uSecondary.set(rgb(values.mistHighlightColor))
  }
  sync()
  return {
    filter,
    sync,
    update(dt: number): void {
      const motionDelta = dt * values.mistAnimationSpeed
      u.uTime += motionDelta
      // All-direction mist remains gently animated without shifting its halo.
      const allDirections = values.windDirection === 0
      u.uFlow[0] += (allDirections ? 7.2 : u.uWind[0] * 36) * motionDelta
      u.uFlow[1] += (allDirections ? -9.6 : u.uWind[1] * 36) * motionDelta
      u.uProgress = values.progress
    },
    destroy(): void {
      copy.destroy()
      blur.destroy()
      filter.destroy()
    }
  }
}
