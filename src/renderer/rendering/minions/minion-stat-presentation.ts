export const MINION_STAT_COLORS = {
  normal: 0xffffff,
  damaged: 0xff4a4a,
  increased: 0x6cff47
} as const

export function minionStatColor(value: number, original: number): number {
  if (value < original) return MINION_STAT_COLORS.damaged
  if (value > original) return MINION_STAT_COLORS.increased
  return MINION_STAT_COLORS.normal
}
