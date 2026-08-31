import type { ArenaMatchResult, ArenaRunSnapshot, CardId, HeroId } from '../../game'

export interface ArenaStore {
  load(): Promise<ArenaRunSnapshot>
  getSnapshot(): ArenaRunSnapshot | null
  selectHero(heroId: HeroId): Promise<ArenaRunSnapshot>
  pickCard(cardId: CardId): Promise<ArenaRunSnapshot>
  retire(): Promise<ArenaRunSnapshot>
  recordResult(result: ArenaMatchResult): Promise<ArenaRunSnapshot>
}
