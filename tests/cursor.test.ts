import { describe, expect, it } from 'vitest'
import {
  CURSOR_BASE_SIZE,
  CURSOR_SCALE_LIMITS,
  DEFAULT_CURSOR_SCALE,
  getCursorSize,
  getCursorVariant,
  normalizeCursorScale,
  resolveCursorVariant
} from '../src/renderer/src/ui/components/cursor'

describe('cursor state helpers', () => {
  it('selects the click variant only while the left button is down', () => {
    expect(getCursorVariant(false)).toBe('default')
    expect(getCursorVariant(true)).toBe('click')
  })

  it('uses a collection page cursor while the pointer is over a page edge', () => {
    expect(resolveCursorVariant(false, 'collection-next-page')).toBe(
      'collection-next-page'
    )
    expect(resolveCursorVariant(false, 'collection-previous-page')).toBe(
      'collection-previous-page'
    )
    expect(resolveCursorVariant(true, 'collection-next-page')).toBe('click')
    expect(resolveCursorVariant(false, null)).toBe('default')
  })

  it('normalizes the shared scale for every cursor variant', () => {
    expect(normalizeCursorScale(Number.NaN)).toBe(DEFAULT_CURSOR_SCALE)
    expect(normalizeCursorScale(CURSOR_SCALE_LIMITS.min - 1)).toBe(
      CURSOR_SCALE_LIMITS.min
    )
    expect(normalizeCursorScale(CURSOR_SCALE_LIMITS.max + 1)).toBe(
      CURSOR_SCALE_LIMITS.max
    )
    expect(getCursorSize(2)).toBe(CURSOR_BASE_SIZE * 2)
  })
})
