import { describe, expect, it } from 'vitest'
import { PLAYABLE_CLASSES } from '../../../game-rules/content/cards'
import { parseProgressionSnapshot, parseDustRewardRequest } from './progression'
import {
  createEmptyClassWinTotals,
  parseConstructedRankResultRequest,
  parseConstructedRankSnapshot,
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
    const rank = { tier: 'rank', rank: 25, legendRank: 0, seasonKey: '2026-09' }

    expect(Object.keys(winsByClass)).toEqual(PLAYABLE_CLASSES)
    expect(parsePlayerStatsSnapshot({ winsByClass, tavernBrawlWins: 3, rank })).toEqual(
      {
        winsByClass,
        tavernBrawlWins: 3,
        rank: { tier: 'rank', rank: 25, seasonKey: '2026-09' }
      }
    )
  })

  it('accepts only playable class ids', () => {
    expect(parsePlayableClassId('Mage')).toBe('Mage')
    expect(() => parsePlayableClassId('Neutral')).toThrow()
    expect(() => parsePlayableClassId('mage')).toThrow()
  })

  it('rejects missing, negative, fractional, and unsafe win totals', () => {
    const valid = createEmptyClassWinTotals()
    const rank = { tier: 'rank', rank: 25, legendRank: 0, seasonKey: '2026-09' }

    for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        parsePlayerStatsSnapshot({
          winsByClass: { ...valid, Mage: invalid },
          tavernBrawlWins: 0,
          rank
        })
      ).toThrow()
    }
    expect(() =>
      parsePlayerStatsSnapshot({
        winsByClass: Object.fromEntries(
          Object.entries(valid).filter(([classId]) => classId !== 'Mage')
        ),
        tavernBrawlWins: 0,
        rank
      })
    ).toThrow()

    for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        parsePlayerStatsSnapshot({
          winsByClass: valid,
          tavernBrawlWins: invalid,
          rank
        })
      ).toThrow()
    }
  })

  it('validates constructed rank snapshots and result requests', () => {
    expect(
      parseConstructedRankSnapshot({
        tier: 'rank',
        rank: 25,
        seasonKey: '2026-09'
      })
    ).toEqual({ tier: 'rank', rank: 25, seasonKey: '2026-09' })
    expect(
      parseConstructedRankSnapshot({
        tier: 'legend',
        legendRank: 999,
        seasonKey: '2026-12'
      })
    ).toEqual({ tier: 'legend', legendRank: 999, seasonKey: '2026-12' })
    for (const invalid of [
      undefined,
      {},
      { tier: 'rank', rank: 26, seasonKey: '2026-09' },
      { tier: 'rank', rank: 0, seasonKey: '2026-09' },
      { tier: 'rank', rank: 5, seasonKey: '2026-9' },
      { tier: 'legend', legendRank: 1000, seasonKey: '2026-09' },
      { tier: 'legend', legendRank: 0, seasonKey: '2026-09' },
      { tier: 'mythic', rank: 1, seasonKey: '2026-09' }
    ]) {
      expect(() => parseConstructedRankSnapshot(invalid)).toThrow()
    }

    const request = { matchId: 'match-42', result: 'win' }
    expect(parseConstructedRankResultRequest(request)).toEqual(request)
    for (const invalid of [
      undefined,
      {},
      { matchId: '', result: 'win' },
      { matchId: 'match 42', result: 'win' },
      { matchId: 'match-42', result: 'victory' }
    ]) {
      expect(() => parseConstructedRankResultRequest(invalid)).toThrow()
    }
  })
})
