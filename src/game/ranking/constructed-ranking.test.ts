import { describe, expect, it } from 'vitest'
import {
  applyConstructedResult,
  applySeasonReset,
  CONSTRUCTED_START_RANK,
  createInitialRankState,
  createSeasonKey,
  LEGEND_MAX_RANK,
  LEGEND_TOP_RANK,
  type ConstructedRankState
} from './constructed-ranking'

const legend = (legendRank: number, seasonKey = '2026-09'): ConstructedRankState => ({
  tier: 'legend',
  legendRank,
  seasonKey
})

const rank = (value: number, seasonKey = '2026-09'): ConstructedRankState => ({
  tier: 'rank',
  rank: value,
  seasonKey
})

describe('constructed ranking rules', () => {
  it('creates the season key as YYYY-MM in local time', () => {
    expect(createSeasonKey(new Date(2026, 0, 1))).toBe('2026-01')
    expect(createSeasonKey(new Date(2026, 11, 31))).toBe('2026-12')
  })

  it('starts players without a rank at rank 25 in the current season', () => {
    const state = createInitialRankState(new Date(2026, 8, 24))
    expect(state).toEqual({
      tier: 'rank',
      rank: CONSTRUCTED_START_RANK,
      seasonKey: '2026-09'
    })
  })

  it('climbs one rank per win, entering Legend at 999', () => {
    expect(applyConstructedResult(rank(25), 'win')).toEqual(rank(24))
    expect(applyConstructedResult(rank(2), 'win')).toEqual(rank(1))
    expect(applyConstructedResult(rank(1), 'win')).toEqual(legend(LEGEND_MAX_RANK))
    expect(applyConstructedResult(legend(999), 'win')).toEqual(legend(998))
    expect(applyConstructedResult(legend(2), 'win')).toEqual(legend(1))
  })

  it('drops one rank per defeat with floors at rank 25 and Legend 999', () => {
    expect(applyConstructedResult(rank(25), 'defeat')).toEqual(rank(25))
    expect(applyConstructedResult(rank(12), 'defeat')).toEqual(rank(13))
    expect(applyConstructedResult(legend(999), 'defeat')).toEqual(legend(999))
    expect(applyConstructedResult(legend(500), 'defeat')).toEqual(legend(501))
  })

  it('caps Legend 1 as the absolute maximum', () => {
    expect(applyConstructedResult(legend(LEGEND_TOP_RANK), 'win')).toEqual(
      legend(LEGEND_TOP_RANK)
    )
  })

  it('leaves the rank unchanged on a draw', () => {
    expect(applyConstructedResult(rank(12), 'draw')).toEqual(rank(12))
    expect(applyConstructedResult(legend(500), 'draw')).toEqual(legend(500))
  })

  it('resets to rank 25 only when the saved season differs from the current one', () => {
    const now = new Date(2026, 8, 1)
    expect(applySeasonReset(rank(5, '2026-09'), now)).toEqual(rank(5, '2026-09'))
    expect(applySeasonReset(legend(42, '2026-09'), now)).toEqual(legend(42, '2026-09'))
    expect(applySeasonReset(rank(5, '2026-08'), now)).toEqual(rank(25, '2026-09'))
    expect(applySeasonReset(legend(1, '2025-09'), now)).toEqual(rank(25, '2026-09'))
  })
})
