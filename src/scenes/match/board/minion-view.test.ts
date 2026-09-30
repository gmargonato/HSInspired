import { describe, expect, it } from 'vitest'
import {
  MINION_STAT_COLORS,
  minionAttackColor,
  minionHealthColor
} from './minion-stat-presentation'

describe('minion stat presentation', () => {
  it('uses green only for attack above the current card base', () => {
    expect(minionAttackColor(4, 2)).toBe(MINION_STAT_COLORS.increased)
    expect(minionAttackColor(2, 2)).toBe(MINION_STAT_COLORS.normal)
    expect(minionAttackColor(1, 2)).toBe(MINION_STAT_COLORS.normal)
  })

  it('uses red for every damaged health value regardless of its relation to base', () => {
    expect(minionHealthColor(4, 5, 3)).toBe(MINION_STAT_COLORS.damaged)
    expect(minionHealthColor(3, 5, 3)).toBe(MINION_STAT_COLORS.damaged)
    expect(minionHealthColor(2, 5, 3)).toBe(MINION_STAT_COLORS.damaged)
  })

  it('uses green only for full health above base', () => {
    expect(minionHealthColor(5, 5, 3)).toBe(MINION_STAT_COLORS.increased)
    expect(minionHealthColor(3, 3, 3)).toBe(MINION_STAT_COLORS.normal)
    expect(minionHealthColor(1, 1, 3)).toBe(MINION_STAT_COLORS.normal)
  })
})
