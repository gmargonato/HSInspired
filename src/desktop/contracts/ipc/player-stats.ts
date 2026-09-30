import {
  PLAYABLE_CLASSES,
  asClassId,
  type ClassId,
  type DeckClass
} from '../../../game-rules/content/cards'
import {
  CONSTRUCTED_START_RANK,
  CONSTRUCTED_TOP_RANK,
  LEGEND_MAX_RANK,
  LEGEND_TOP_RANK,
  type ConstructedMatchResult
} from '../../../game-rules/ranking/constructed-ranking'

export const PLAYER_STATS_IPC_CHANNELS = {
  get: 'player-stats:get',
  recordWin: 'player-stats:record-win',
  recordTavernBrawlWin: 'player-stats:record-tavern-brawl-win',
  recordConstructedResult: 'player-stats:record-constructed-result',
  devSetRank: 'player-stats:dev-set-rank'
} as const

export type ClassWinTotals = Readonly<Record<DeckClass, number>>

export type ConstructedRankSnapshot =
  | {
      readonly tier: 'rank'
      /** Numeric ladder rank (25..1). */
      readonly rank: number
      /** `'YYYY-MM'` season the rank was earned in; stale keys trigger a reset. */
      readonly seasonKey: string
    }
  | {
      readonly tier: 'legend'
      /** Legend position counted down from 999. */
      readonly legendRank: number
      /** `'YYYY-MM'` season the rank was earned in; stale keys trigger a reset. */
      readonly seasonKey: string
    }

export interface ConstructedRankResultRequest {
  readonly matchId: string
  readonly result: ConstructedMatchResult
}

export interface PlayerStatsSnapshot {
  readonly winsByClass: ClassWinTotals
  readonly tavernBrawlWins: number
  readonly rank: ConstructedRankSnapshot
}

export interface PlayerStatsApi {
  get(): Promise<PlayerStatsSnapshot>
  recordWin(classId: ClassId): Promise<PlayerStatsSnapshot>
  recordTavernBrawlWin(): Promise<PlayerStatsSnapshot>
  recordConstructedResult(
    request: ConstructedRankResultRequest
  ): Promise<PlayerStatsSnapshot>
  /** Exposed only in development; the main process independently checks dev mode. */
  devSetRank?(rank: ConstructedRankSnapshot): Promise<PlayerStatsSnapshot>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createEmptyClassWinTotals(): ClassWinTotals {
  return Object.fromEntries(PLAYABLE_CLASSES.map((classId) => [classId, 0])) as Record<
    DeckClass,
    number
  >
}

export function parsePlayableClassId(value: unknown): ClassId {
  if (
    typeof value !== 'string' ||
    !PLAYABLE_CLASSES.some((classId) => classId === value)
  ) {
    throw new Error('Invalid playable class id')
  }
  return asClassId(value)
}

export function parseConstructedMatchResult(value: unknown): ConstructedMatchResult {
  if (typeof value !== 'string' || !['win', 'defeat', 'draw'].includes(value)) {
    throw new Error('Invalid constructed match result')
  }
  return value as ConstructedMatchResult
}

export function parseConstructedRankSnapshot(value: unknown): ConstructedRankSnapshot {
  if (!isRecord(value) || typeof value.seasonKey !== 'string') {
    throw new Error('Invalid constructed rank snapshot')
  }
  if (!/^\d{4}-\d{2}$/.test(value.seasonKey)) {
    throw new Error('Invalid constructed rank season key')
  }
  if (value.tier === 'rank') {
    const rank = value.rank
    if (
      typeof rank !== 'number' ||
      !Number.isSafeInteger(rank) ||
      rank < CONSTRUCTED_TOP_RANK ||
      rank > CONSTRUCTED_START_RANK
    ) {
      throw new Error('Invalid constructed rank')
    }
    return { tier: 'rank', rank, seasonKey: value.seasonKey }
  }
  if (value.tier === 'legend') {
    const legendRank = value.legendRank
    if (
      typeof legendRank !== 'number' ||
      !Number.isSafeInteger(legendRank) ||
      legendRank < LEGEND_TOP_RANK ||
      legendRank > LEGEND_MAX_RANK
    ) {
      throw new Error('Invalid constructed legend rank')
    }
    return { tier: 'legend', legendRank, seasonKey: value.seasonKey }
  }
  throw new Error('Invalid constructed rank tier')
}

export function parseConstructedRankResultRequest(
  value: unknown
): ConstructedRankResultRequest {
  if (
    !isRecord(value) ||
    typeof value.matchId !== 'string' ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(value.matchId)
  ) {
    throw new Error('Invalid constructed rank result request')
  }
  return {
    matchId: value.matchId,
    result: parseConstructedMatchResult(value.result)
  }
}

export function parsePlayerStatsSnapshot(value: unknown): PlayerStatsSnapshot {
  if (
    !isRecord(value) ||
    !isRecord(value.winsByClass) ||
    typeof value.tavernBrawlWins !== 'number' ||
    !Number.isSafeInteger(value.tavernBrawlWins) ||
    value.tavernBrawlWins < 0
  ) {
    throw new Error('Invalid player stats response')
  }

  const winsByClass = createEmptyClassWinTotals() as Record<DeckClass, number>
  for (const classId of PLAYABLE_CLASSES) {
    const wins = value.winsByClass[classId]
    if (typeof wins !== 'number' || !Number.isSafeInteger(wins) || wins < 0) {
      throw new Error(`Invalid win total for ${classId}`)
    }
    winsByClass[classId] = wins
  }

  return {
    winsByClass,
    tavernBrawlWins: value.tavernBrawlWins,
    rank: parseConstructedRankSnapshot(value.rank)
  }
}
