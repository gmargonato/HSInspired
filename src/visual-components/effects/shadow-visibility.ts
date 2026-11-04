import type { Container } from 'pixi.js'

let enabled = true
const listeners = new Set<(enabled: boolean) => void>()

export function areShadowsEnabled(): boolean {
  return enabled
}

/** Presentation state supplied by startup and successful preference saves. */
export function setShadowsEnabled(value: boolean): void {
  if (enabled === value) return
  enabled = value
  for (const listener of listeners) listener(enabled)
}

/** Applies immediately and releases the subscription with its visual owner. */
export function observeShadows(
  owner: Container,
  listener: (enabled: boolean) => void
): void {
  listener(enabled)
  listeners.add(listener)
  owner.once('destroyed', () => listeners.delete(listener))
}
