export const MINION_STAT_COLORS = {
  normal: 0xffffff,
  damaged: 0xff4a4a,
  increased: 0x6cff47
} as const

/** Hearthstone only highlights board Attack when it is above the current card's base. */
export function minionAttackColor(current: number, base: number): number {
  if (current > base) return MINION_STAT_COLORS.increased
  return MINION_STAT_COLORS.normal
}

/** Damage takes precedence over Health buffs; only full, above-base Health is green. */
export function minionHealthColor(
  current: number,
  maximum: number,
  base: number
): number {
  if (current < maximum) return MINION_STAT_COLORS.damaged
  if (maximum > base) return MINION_STAT_COLORS.increased
  return MINION_STAT_COLORS.normal
}
