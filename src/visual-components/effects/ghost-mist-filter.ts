import { Filter } from 'pixi.js'
import { ghostMistVertex, ghostMistFragment } from './ghost-aura-shader'
import type {
  GhostAuraTuning,
  GhostAuraPalette
} from '../../desktop/contracts/ipc/outline-tuning'
import { GHOST_TIMING, type GhostProfile } from './ghost-layout'

export interface GhostMistValues extends GhostAuraTuning, GhostAuraPalette {
  progress: number
}

export function createGhostMistFilter(
  values: GhostMistValues,
  profile: GhostProfile,
  text = false
) {
  const filter = Filter.from({
    gl: {
      vertex: ghostMistVertex,
      fragment: ghostMistFragment,
      name: 'ghost-artwork-fade'
    },
    resources: { ghostUniforms: { uOpacity: { value: 1, type: 'f32' } } }
  })
  function sync(): void {
    const seconds = values.progress * GHOST_TIMING.duration
    filter.resources.ghostUniforms.uniforms.uOpacity =
      profile === 'banner'
        ? 1
        : text
          ? Math.max(0, 1 - seconds / GHOST_TIMING.fade)
          : seconds >= GHOST_TIMING.burstDelay
            ? 0
            : 1
  }
  return { filter, sync, update: sync, destroy: () => filter.destroy() }
}
