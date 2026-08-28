import { describe, expect, it } from 'vitest'
import { MINION_STAT_COLORS, minionStatColor } from './minion-stat-presentation'

describe('minion stat presentation', () => {
  it('renders an increased attack in green', () => {
    expect(minionStatColor(4, 2)).toBe(MINION_STAT_COLORS.increased)
  })

  it('uses the established damage and normal colors for reduced and base stats', () => {
    expect(minionStatColor(1, 2)).toBe(MINION_STAT_COLORS.damaged)
    expect(minionStatColor(2, 2)).toBe(MINION_STAT_COLORS.normal)
  })
})
