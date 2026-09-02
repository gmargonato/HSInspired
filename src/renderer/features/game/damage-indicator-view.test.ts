import { describe, expect, it } from 'vitest'
import { formatDamageAmount } from './damage-indicator-view'
import { formatHealAmount } from './heal-indicator-view'
import {
  effectDamageIndicatorAmount,
  effectHealIndicatorAmount
} from './character-indicator-presentation'

describe('character indicator presentation', () => {
  it('formats the damage amount with a leading minus sign', () => {
    expect(formatDamageAmount(1)).toBe('-1')
    expect(formatDamageAmount(12)).toBe('-12')
  })

  it('formats the healing amount with a leading plus sign', () => {
    expect(formatHealAmount(1)).toBe('+1')
    expect(formatHealAmount(12)).toBe('+12')
  })

  it('uses attempted damage while suppressing Divine Shield hits', () => {
    expect(effectDamageIndicatorAmount({ displayAmount: 6, actualDamage: 3 })).toBe(6)
    expect(
      effectDamageIndicatorAmount({
        displayAmount: 6,
        actualDamage: 0,
        shieldConsumed: true
      })
    ).toBe(0)
    expect(
      effectDamageIndicatorAmount({
        displayAmount: 6,
        actualDamage: 0,
        prevented: true
      })
    ).toBe(6)
  })

  it('uses attempted healing even when no Health was restored', () => {
    expect(effectHealIndicatorAmount({ displayAmount: 4, amount: 0 })).toBe(4)
  })
})
