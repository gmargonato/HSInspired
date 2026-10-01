import type { ConstructedRankState } from './constructed-ranking'

/** Arena prize tier awarded for the final rank of a completed season. */
export function seasonArenaWins(rank: ConstructedRankState): number {
  if (rank.tier === 'legend') return 12
  if (rank.rank <= 5) return 11
  if (rank.rank <= 10) return 9
  if (rank.rank <= 15) return 6
  if (rank.rank <= 20) return 3
  return 0
}
