/** Session-only presentation preference; never part of card or match data. */
let premiumEnabled = false
const listeners = new Set<(enabled: boolean) => void>()

export function isPremiumEnabled(): boolean {
  return premiumEnabled
}

export function setPremiumEnabled(enabled: boolean): void {
  if (premiumEnabled === enabled) return
  premiumEnabled = enabled
  for (const listener of listeners) listener(enabled)
}

export function subscribeToPremiumAppearance(
  listener: (enabled: boolean) => void
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
