import { describe, expect, it } from 'vitest'
import { formatDamageAmount } from './damage-indicator-view'

describe('damage indicator presentation', () => {
  it('formats the damage amount with a leading minus sign', () => {
    expect(formatDamageAmount(1)).toBe('-1')
    expect(formatDamageAmount(12)).toBe('-12')
  })
})
