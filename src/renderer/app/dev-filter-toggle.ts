import type { Application, FilterSystem } from 'pixi.js'
import { AnimatedOutline } from '../rendering/effects/animated-outline'
import { BakedAnimatedOutline } from '../rendering/effects/baked-animated-outline'

/** A same-scene GPU-effects comparison; normal sprite/mesh rendering stays active. */
export function installDevFilterToggle(
  app: Application,
  container: HTMLElement
): () => void {
  const system = app.renderer.filter as FilterSystem
  const originalPush = system.push
  let effectsEnabled = true
  const status = document.createElement('div')
  status.className = 'fps-counter'
  status.style.top = '44px'
  container.appendChild(status)
  const updateStatus = (): void => {
    status.textContent = `F3: Effects ${effectsEnabled ? 'ON' : 'OFF'}`
  }
  updateStatus()

  // Bypass at push, before offscreen targets or custom filter apply() calls.
  // An empty filter list still pushes a skipped entry, keeping pop balanced.
  // Restore the original list immediately so game-owned effect state is retained.
  const push: FilterSystem['push'] = (instruction) => {
    if (effectsEnabled) {
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
    BakedAnimatedOutline.setDebugSuppressed(!effectsEnabled)
    updateStatus()
  }
  window.addEventListener('keydown', handleKey)

  return () => {
    window.removeEventListener('keydown', handleKey)
    if (system.push === push) system.push = originalPush
    AnimatedOutline.setDebugSuppressed(false)
    BakedAnimatedOutline.setDebugSuppressed(false)
    status.remove()
  }
}
