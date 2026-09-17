import { describe, expect, it } from 'vitest'
import { PLAYABLE_CLASSES } from '../../game/content/cards'
import { parseProgressionSnapshot, parseDustRewardRequest } from './progression'
import {
  createEmptyClassWinTotals,
  parsePlayableClassId,
  parsePlayerStatsSnapshot
} from './player-stats'

describe('player stats IPC contract', () => {
  it('validates progression balances, paid prices, and reward context at the bridge', () => {
    expect(
      parseProgressionSnapshot({ dust: 25, premiumPurchases: { basic_fireball: 50 } })
    ).toEqual({ dust: 25, premiumPurchases: { basic_fireball: 50 } })
    for (const amount of [-1, 0.5, Infinity, NaN, '50', Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        parseProgressionSnapshot({ dust: amount, premiumPurchases: {} })
      ).toThrow()
      expect(() =>
        parseProgressionSnapshot({
          dust: 0,
          premiumPurchases: { basic_fireball: amount }
        })
      ).toThrow()
    }
    expect(() => parseProgressionSnapshot({ dust: 0, premiumPurchases: [] })).toThrow()
    const valid = {
      matchId: 'match-1',
      mode: 'constructed',
      result: 'win',
      reason: 'hero-health-depleted'
    }
    expect(parseDustRewardRequest(valid)).toEqual(valid)
    for (const patch of [
      { matchId: '' },
      { mode: 'other' },
      { result: 'victory' },
      { reason: 'fake' },
      { mode: { toString: () => 'constructed' } }
    ])
      expect(() => parseDustRewardRequest({ ...valid, ...patch })).toThrow()
  })
  it('creates and parses a zeroed total for every playable class', () => {
    const winsByClass = createEmptyClassWinTotals()

    expect(Object.keys(winsByClass)).toEqual(PLAYABLE_CLASSES)
    expect(parsePlayerStatsSnapshot({ winsByClass, tavernBrawlWins: 3 })).toEqual({
      winsByClass,
      tavernBrawlWins: 3
    })
  })

  it('accepts only playable class ids', () => {
    expect(parsePlayableClassId('Mage')).toBe('Mage')
    expect(() => parsePlayableClassId('Neutral')).toThrow()
    expect(() => parsePlayableClassId('mage')).toThrow()
  })

  it('rejects missing, negative, fractional, and unsafe win totals', () => {
    const valid = createEmptyClassWinTotals()

    for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        parsePlayerStatsSnapshot({
          winsByClass: { ...valid, Mage: invalid },
          tavernBrawlWins: 0
        })
      ).toThrow()
    }
    expect(() =>
      parsePlayerStatsSnapshot({
        winsByClass: Object.fromEntries(
          Object.entries(valid).filter(([classId]) => classId !== 'Mage')
        ),
        tavernBrawlWins: 0
      })
    ).toThrow()

    for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        parsePlayerStatsSnapshot({
          winsByClass: valid,
          tavernBrawlWins: invalid
        })
      ).toThrow()
    }
  })
})
