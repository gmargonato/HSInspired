import type {
  ArenaMatchResult,
  ArenaRunSnapshot,
  CardId,
  HeroId
} from '../../game-rules'
import type { ArenaScoreRequest } from '../../desktop/contracts/ipc/arena'

export interface ArenaStore {
  devSetScore?(request: ArenaScoreRequest): Promise<ArenaRunSnapshot>
  load(): Promise<ArenaRunSnapshot>
  getSnapshot(): ArenaRunSnapshot | null
  selectHero(heroId: HeroId): Promise<ArenaRunSnapshot>
  pickCard(cardId: CardId): Promise<ArenaRunSnapshot>
  retire(runId: string): Promise<ArenaRunSnapshot>
  acknowledgeRewards(runId: string): Promise<ArenaRunSnapshot>
  recordResult(result: ArenaMatchResult): Promise<ArenaRunSnapshot>
}
