type EffectPresentationData = Readonly<Record<string, unknown>>

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null
}

/** Amount shown for one damage effect, independent of effective Health loss. */
export function effectDamageIndicatorAmount(data: EffectPresentationData): number {
  if (data.shieldConsumed === true || data.prevented === true) return 0
  return (
    nonNegativeNumber(data.displayAmount) ??
    nonNegativeNumber(data.amount) ??
    (nonNegativeNumber(data.actualDamage) ?? 0) +
      (nonNegativeNumber(data.armorDamage) ?? 0)
  )
}

/** Amount shown for one restore effect, independent of effective Health gain. */
export function effectHealIndicatorAmount(data: EffectPresentationData): number {
  return nonNegativeNumber(data.displayAmount) ?? nonNegativeNumber(data.amount) ?? 0
}
