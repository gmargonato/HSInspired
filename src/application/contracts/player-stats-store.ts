import type { ClassId } from '../../game-rules/content/cards'
import type { SeasonRewardReceipt } from '../../desktop/contracts/ipc/player-stats'
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
  pendingSeasonReward(): Promise<SeasonRewardReceipt | null>
  claimSeasonReward(id: string): Promise<SeasonRewardReceipt>
  acknowledgeSeasonReward(id: string): Promise<void>
  recordWin(classId: ClassId): Promise<number>
  recordTavernBrawlWin(): Promise<number>
  recordConstructedResult(
    request: ConstructedRankResultRequest
  ): Promise<ConstructedRankSnapshot>
  /** Exposed only in development; the production bridge omits it. */
  devSetRank?(rank: ConstructedRankSnapshot): Promise<ConstructedRankSnapshot>
  devResetSeason?(): Promise<SeasonRewardReceipt>
}
