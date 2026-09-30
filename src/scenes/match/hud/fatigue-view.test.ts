import { describe, expect, it } from 'vitest'
import { formatFatigueMessage } from './fatigue-view'

describe('fatigue presentation', () => {
  it('renders the failed draw damage in the requested message', () => {
    expect(formatFatigueMessage(4)).toBe('Out of Cards! Take 4 damage.')
  })
})
