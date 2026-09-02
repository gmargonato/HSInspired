import { describe, expect, it, vi } from 'vitest'
import {
  clearMatchResultCombatViews,
  type MatchResultCombatView
} from './match-result-state'

describe('match result combat state', () => {
  it('clears attack-ready and targeting visuals from every board combatant', () => {
    const views = Array.from({ length: 3 }, () => ({
      setCanAttack: vi.fn(),
      setTargetable: vi.fn(),
      setTargetingOutline: vi.fn()
    })) satisfies MatchResultCombatView[]

    clearMatchResultCombatViews(views)

    for (const view of views) {
      expect(view.setCanAttack).toHaveBeenCalledExactlyOnceWith(false)
      expect(view.setTargetable).toHaveBeenCalledExactlyOnceWith(false)
      expect(view.setTargetingOutline).toHaveBeenCalledExactlyOnceWith(false)
    }
  })
})
