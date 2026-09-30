import { CARD_CATALOG } from '../../game-rules/content/cards'
import { supportsPremiumFormat } from '../../game-rules/progression/premium-support'
import type { PremiumMode } from '../../desktop/contracts/dev-menu'

/** Session-only development override; never grants purchased ownership. */
let premiumMode: PremiumMode = 'unlocked'
const listeners = new Set<(mode: PremiumMode) => void>()
let premiumCardIds = new Set<string>()

/** Presentation data supplied by the composition root, with no persistence dependency. */
export function setPremiumCardIds(ids: readonly string[]): void {
  const next = new Set(ids)
  if (
    next.size === premiumCardIds.size &&
    [...next].every((id) => premiumCardIds.has(id))
  )
    return
  premiumCardIds = next
  for (const listener of listeners) listener(premiumMode)
}

export function isPurchasedPremium(cardId: string): boolean {
  const card = CARD_CATALOG.get(cardId)
  return (
    premiumCardIds.has(cardId) && card !== undefined && supportsPremiumFormat(card.type)
  )
}

export function isCardPremium(
  cardId: string,
  side: 'local' | 'remote' = 'local'
): boolean {
  return isPremiumEnabled(side) || isPurchasedPremium(cardId)
}

export function isPremiumEnabled(side: 'local' | 'remote' = 'local'): boolean {
  return premiumMode === 'all' || premiumMode === side
}

/** Compatibility helper for explicit on/off previews and existing callers. */
export function setPremiumEnabled(enabled: boolean): void {
  setPremiumMode(enabled ? 'all' : 'unlocked')
}

export function getPremiumMode(): PremiumMode {
  return premiumMode
}

export function setPremiumMode(mode: PremiumMode): void {
  if (premiumMode === mode) return
  premiumMode = mode
  for (const listener of listeners) listener(mode)
}

export function subscribeToPremiumAppearance(
  listener: (mode: PremiumMode) => void
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
