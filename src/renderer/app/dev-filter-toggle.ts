import type { Application, FilterSystem } from 'pixi.js'
import { AnimatedOutline } from '../rendering/effects/animated-outline'
import { GhostAura } from '../rendering/effects/ghost-aura'
import { MATCH_SHADOW_CONFIG } from '../rendering/shadows/match-shadow-config'

/** Same-scene comparison of GPU filters, outlines, and board shadows. */
export function installDevFilterToggle(app: Application): () => void {
  const system = app.renderer.filter as FilterSystem
  const originalPush = system.push
  const shadowsEnabled = MATCH_SHADOW_CONFIG.enabled
  let effectsEnabled = true

  // Bypass live filters before offscreen allocation. Keep texture baking intact
  // so effects created while disabled still render correctly when re-enabled.
  // An empty list pushes a skipped entry, keeping Pixi's push/pop balanced.
  const push: FilterSystem['push'] = (instruction) => {
    if (effectsEnabled || !app.renderer.renderTarget.renderingToScreen) {
      originalPush.call(system, instruction)
      return
    }
    const effect = instruction.filterEffect
    const filters = effect.filters
    effect.filters = []
    try {
      originalPush.call(system, instruction)
    } finally {
      effect.filters = filters
    }
  }
  system.push = push

  const handleKey = (event: KeyboardEvent): void => {
    if (event.key !== 'F3' || event.repeat || event.defaultPrevented) return
    event.preventDefault()
    effectsEnabled = !effectsEnabled
    AnimatedOutline.setDebugSuppressed(!effectsEnabled)
    GhostAura.setDebugSuppressed(!effectsEnabled)
    MATCH_SHADOW_CONFIG.enabled = effectsEnabled && shadowsEnabled
  }
  window.addEventListener('keydown', handleKey)

  return () => {
    window.removeEventListener('keydown', handleKey)
    if (system.push === push) system.push = originalPush
    AnimatedOutline.setDebugSuppressed(false)
    GhostAura.setDebugSuppressed(false)
    MATCH_SHADOW_CONFIG.enabled = shadowsEnabled
  }
}
