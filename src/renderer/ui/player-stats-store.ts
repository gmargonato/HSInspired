import type { ClassId } from '../../game/content/cards'

/** Renderer-facing persistence port for player-wide win statistics. */
export interface PlayerStatsStore {
  load(): Promise<void>
  getWins(classId: ClassId): number
  getTavernBrawlWins(): number
  recordWin(classId: ClassId): Promise<number>
  recordTavernBrawlWin(): Promise<number>
}
