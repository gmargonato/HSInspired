import {
  PLAYABLE_CLASSES,
  asClassId,
  type ClassId,
  type DeckClass
} from '../../game/content/cards'

export const PLAYER_STATS_IPC_CHANNELS = {
  get: 'player-stats:get',
  recordWin: 'player-stats:record-win',
  recordTavernBrawlWin: 'player-stats:record-tavern-brawl-win'
} as const

export type ClassWinTotals = Readonly<Record<DeckClass, number>>

export interface PlayerStatsSnapshot {
  readonly winsByClass: ClassWinTotals
  readonly tavernBrawlWins: number
}

export interface PlayerStatsApi {
  get(): Promise<PlayerStatsSnapshot>
  recordWin(classId: ClassId): Promise<PlayerStatsSnapshot>
  recordTavernBrawlWin(): Promise<PlayerStatsSnapshot>
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

  return { winsByClass, tavernBrawlWins: value.tavernBrawlWins }
}
