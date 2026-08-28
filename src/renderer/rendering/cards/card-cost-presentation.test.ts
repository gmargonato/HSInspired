import { describe, expect, it } from 'vitest'
import { cardCostColor } from './card-cost-presentation'

describe('card cost presentation', () => {
  it('keeps an unchanged cost neutral', () => {
    expect(cardCostColor(3, 3)).toBe('normal')
  })

  it('tints a reduced cost green and an increased cost red', () => {
    expect(cardCostColor(3, 2)).toBe('reduced')
    expect(cardCostColor(3, 4)).toBe('increased')
  })
})
