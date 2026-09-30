/**
 * Pure rules for the constructed-play ladder.
 *
 * The ladder has 25 numbered ranks plus the Legend tier. New players start at
 * rank 25. A win moves one step toward rank 1 (and then into Legend), a defeat
 * moves one step back toward rank 25, and a draw changes nothing. Legend
 * positions are counted down from 999, where Legend 1 is the absolute maximum.
 */

export const CONSTRUCTED_START_RANK = 25
export const CONSTRUCTED_TOP_RANK = 1
export const LEGEND_MAX_RANK = 999
export const LEGEND_TOP_RANK = 1

export type ConstructedMatchResult = 'win' | 'defeat' | 'draw'

export type ConstructedRankState =
  | {
      readonly tier: 'rank'
      readonly rank: number
      readonly seasonKey: string
    }
  | {
      readonly tier: 'legend'
      readonly legendRank: number
      readonly seasonKey: string
    }

/** Builds the `'YYYY-MM'` season key for the given date (local time). */
export function createSeasonKey(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  return `${year}-${month}`
}

/** Creates the ladder entry state for a player without any rank yet. */
export function createInitialRankState(now: Date = new Date()): ConstructedRankState {
  return {
    tier: 'rank',
    rank: CONSTRUCTED_START_RANK,
    seasonKey: createSeasonKey(now)
  }
}

function isSeasonStale(state: ConstructedRankState, now: Date): boolean {
  return state.seasonKey !== createSeasonKey(now)
}

/**
 * Returns the state after the monthly season reset, or the given state when it
 * already belongs to the current season. A reset always sends the player back
 * to rank 25.
 */
export function applySeasonReset(
  state: ConstructedRankState,
  now: Date = new Date()
): ConstructedRankState {
  if (!isSeasonStale(state, now)) return state
  return { tier: 'rank', rank: CONSTRUCTED_START_RANK, seasonKey: createSeasonKey(now) }
}

/** Applies one match outcome to the ladder state. Draws change nothing. */
export function applyConstructedResult(
  state: ConstructedRankState,
  result: ConstructedMatchResult
): ConstructedRankState {
  if (result === 'draw') return state
  if (state.tier === 'legend') {
    const step = result === 'win' ? -1 : 1
    const legendRank = Math.min(
      LEGEND_MAX_RANK,
      Math.max(LEGEND_TOP_RANK, state.legendRank + step)
    )
    if (legendRank === state.legendRank) return state
    return { tier: 'legend', legendRank, seasonKey: state.seasonKey }
  }

  const step = result === 'win' ? -1 : 1
  const next = state.rank + step
  if (next < CONSTRUCTED_TOP_RANK) {
    return { tier: 'legend', legendRank: LEGEND_MAX_RANK, seasonKey: state.seasonKey }
  }
  if (next > CONSTRUCTED_START_RANK) return state
  return { tier: 'rank', rank: next, seasonKey: state.seasonKey }
}
