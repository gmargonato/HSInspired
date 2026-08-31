import type { ClassId, DeckClass } from '../../game/content/cards'
import {
  createEmptyClassWinTotals,
  type PlayerStatsApi,
  type PlayerStatsSnapshot
} from '../../shared/ipc/player-stats'
import type { PlayerStatsStore } from '../ui/player-stats-store'

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
    tavernBrawlWins: 0
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

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }
}
