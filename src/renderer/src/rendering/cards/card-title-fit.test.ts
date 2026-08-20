import { describe, expect, it } from 'vitest'
import { resolveCardTitleFit } from './card-title-fit'

describe('Card title fitting', () => {
  it('selects the largest font size that fits the available width', () => {
    const result = resolveCardTitleFit({
      maxFontSize: 47,
      minFontSize: 30,
      maxWidth: 400,
      measureWidth: (fontSize) => fontSize * 10
    })

    expect(result).toEqual({ fontSize: 40, scale: 1 })
  })

  it('uses uniform scale when the minimum font size still overflows', () => {
    const result = resolveCardTitleFit({
      maxFontSize: 47,
      minFontSize: 30,
      maxWidth: 400,
      measureWidth: (fontSize) => fontSize * 20
    })

    expect(result.fontSize).toBe(30)
    expect(result.scale).toBeCloseTo(2 / 3)
  })
})
