import type { ClassId, DeckClass } from '../game-rules/content/cards'
import {
  createEmptyClassWinTotals,
  type ConstructedRankResultRequest,
  type ConstructedRankSnapshot,
  type PlayerStatsApi,
  type PlayerStatsSnapshot
} from '../desktop/contracts/ipc/player-stats'
import { createInitialRankState } from '../game-rules/ranking/constructed-ranking'
import type { PlayerStatsStore } from './contracts/player-stats-store'

function getPlayerStatsApi(): PlayerStatsApi {
  if (typeof window === 'undefined' || !window.api?.playerStats) {
    throw new Error(
      'Player statistics persistence is unavailable outside the Electron renderer'
    )
  }
  return window.api.playerStats
}

/** Renderer cache and command gateway for persisted player win totals. */
export class PersistentPlayerStatsStore implements PlayerStatsStore {
  private snapshot: PlayerStatsSnapshot = {
    winsByClass: createEmptyClassWinTotals(),
    tavernBrawlWins: 0,
    rank: createInitialRankState()
  }
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly apiProvider: () => PlayerStatsApi = getPlayerStatsApi) {}

  async load(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.apiProvider()
      .get()
      .then((snapshot) => {
        this.snapshot = snapshot
        this.loaded = true
      })
      .finally(() => {
        this.loadPromise = null
      })
    return this.loadPromise
  }

  getWins(classId: ClassId): number {
    return this.snapshot.winsByClass[classId as DeckClass] ?? 0
  }

  getTavernBrawlWins(): number {
    return this.snapshot.tavernBrawlWins
  }

  getRank(): ConstructedRankSnapshot {
    return this.snapshot.rank
  }

  recordWin(classId: ClassId): Promise<number> {
    return this.enqueue(async () => {
      await this.load()
      this.snapshot = await this.apiProvider().recordWin(classId)
      return this.getWins(classId)
    })
  }

  recordTavernBrawlWin(): Promise<number> {
    return this.enqueue(async () => {
      await this.load()
      this.snapshot = await this.apiProvider().recordTavernBrawlWin()
      return this.getTavernBrawlWins()
    })
  }

  recordConstructedResult(
    request: ConstructedRankResultRequest
  ): Promise<ConstructedRankSnapshot> {
    return this.enqueue(async () => {
      await this.load()
      this.snapshot = await this.apiProvider().recordConstructedResult(request)
      return this.snapshot.rank
    })
  }

  devSetRank(rank: ConstructedRankSnapshot): Promise<ConstructedRankSnapshot> {
    return this.enqueue(async () => {
      const api = this.apiProvider()
      if (!api.devSetRank) {
        throw new Error('Rank overrides are only available in development')
      }
      await this.load()
      this.snapshot = await api.devSetRank(rank)
      return this.snapshot.rank
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }
}
