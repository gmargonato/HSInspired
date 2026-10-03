import { describe, expect, it } from 'vitest'
import { hasPendingMinionDestruction } from './minion-status-presentation'
import type { RuntimeAttachedEffect } from '../../../game-rules/match/opening-match-types'
import {
  MINION_STAT_COLORS,
  minionAttackColor,
  minionHealthColor
} from './minion-stat-presentation'

describe('minion stat presentation', () => {
  it('recognizes attached host destruction without predicting other destruction', () => {
    const attached = (
      actions: RuntimeAttachedEffect['actions']
    ): RuntimeAttachedEffect => ({
      id: 'attached',
      sourceInstanceId: 'source',
      sourceCardId: null,
      controllerId: 'player' as RuntimeAttachedEffect['controllerId'],
      trigger: 'start-of-turn',
      executeOnTurn: 3,
      actions
    })
    expect(
      hasPendingMinionDestruction({
        attachedEffects: [
          attached([
            { action: 'destroy', target: { type: 'minion', selection: 'event-target' } }
          ])
        ]
      })
    ).toBe(true)
    expect(
      hasPendingMinionDestruction({
        attachedEffects: [
          attached([
            { action: 'destroy', target: { type: 'minion', selection: 'source' } }
          ])
        ]
      })
    ).toBe(true)
    for (const action of [
      { action: 'damage', target: { type: 'minion', selection: 'event-target' } },
      { action: 'destroy', target: { type: 'minion', selection: 'all' } }
    ])
      expect(
        hasPendingMinionDestruction({ attachedEffects: [attached([action])] })
      ).toBe(false)
    expect(hasPendingMinionDestruction({ attachedEffects: [] })).toBe(false)
  })
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
