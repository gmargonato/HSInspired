import type {
  ArenaApi,
  ArenaScoreRequest,
  ArenaMatchResult,
  ArenaRunSnapshot
} from '../../shared/ipc/arena'
import type { CardId, HeroId } from '../../game'
import type { ArenaStore } from '../ui/arena-store'

function getArenaApi(): ArenaApi {
  if (typeof window === 'undefined' || !window.api?.arena) {
    throw new Error('Arena persistence is unavailable outside Electron.')
  }
  return window.api.arena
}

export class PersistentArenaStore implements ArenaStore {
  private snapshot: ArenaRunSnapshot | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly apiProvider: () => ArenaApi = getArenaApi) {}

  async load(): Promise<ArenaRunSnapshot> {
    return this.enqueue(() => this.apiProvider().get())
  }

  getSnapshot(): ArenaRunSnapshot | null {
    return this.snapshot
  }

  devSetScore(request: ArenaScoreRequest): Promise<ArenaRunSnapshot> {
    return this.enqueue(() => {
      const api = this.apiProvider()
      if (!api.devSetScore) throw new Error('Arena score editing is unavailable.')
      return api.devSetScore(request)
    })
  }

  selectHero(heroId: HeroId): Promise<ArenaRunSnapshot> {
    return this.enqueue(() => this.apiProvider().selectHero(heroId))
  }

  pickCard(cardId: CardId): Promise<ArenaRunSnapshot> {
    return this.enqueue(() => this.apiProvider().pickCard(cardId))
  }

  retire(runId: string): Promise<ArenaRunSnapshot> {
    return this.enqueue(() => this.apiProvider().retire(runId))
  }

  acknowledgeRewards(runId: string): Promise<ArenaRunSnapshot> {
    return this.enqueue(() => this.apiProvider().acknowledgeRewards(runId))
  }

  recordResult(result: ArenaMatchResult): Promise<ArenaRunSnapshot> {
    return this.enqueue(() => this.apiProvider().recordResult(result))
  }

  private enqueue(
    operation: () => Promise<ArenaRunSnapshot>
  ): Promise<ArenaRunSnapshot> {
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.then(
      (snapshot) => {
        this.snapshot = snapshot
      },
      () => undefined
    )
    return next
  }
}
