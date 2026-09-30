import type { ClassId } from '../../game-rules/content/cards'
import type {
  ConstructedRankResultRequest,
  ConstructedRankSnapshot
} from '../../desktop/contracts/ipc/player-stats'

/** Renderer-facing persistence port for player-wide win statistics. */
export interface PlayerStatsStore {
  load(): Promise<void>
  getWins(classId: ClassId): number
  getTavernBrawlWins(): number
  getRank(): ConstructedRankSnapshot
  recordWin(classId: ClassId): Promise<number>
  recordTavernBrawlWin(): Promise<number>
  recordConstructedResult(
    request: ConstructedRankResultRequest
  ): Promise<ConstructedRankSnapshot>
  /** Exposed only in development; the production bridge omits it. */
  devSetRank?(rank: ConstructedRankSnapshot): Promise<ConstructedRankSnapshot>
}
