import type {
  DustRewardRequest,
  ProgressionApi,
  ProgressionSnapshot
} from '../desktop/contracts/ipc/progression'
import type { ProgressionStore } from './contracts/progression-store'
import { setPremiumCardIds } from '../visual-components/cards/premium-appearance'

export class PersistentProgressionStore implements ProgressionStore {
  private snapshot: ProgressionSnapshot = { dust: 0, premiumPurchases: {} }
  private loaded = false
  private pending: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly apiProvider: () => ProgressionApi = () => window.api.progression
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return
    this.pending ??= this.apiProvider()
      .get()
      .then((snapshot) => {
        this.accept(snapshot)
        this.loaded = true
      })
      .finally(() => {
        this.pending = null
      })
    await this.pending
  }

  getSnapshot(): ProgressionSnapshot {
    return {
      dust: this.snapshot.dust,
      premiumPurchases: { ...this.snapshot.premiumPurchases }
    }
  }

  refresh(): Promise<void> {
    return this.enqueue(async () => this.accept(await this.apiProvider().get()))
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  reward(request: DustRewardRequest) {
    return this.enqueue(async () => {
      const receipt = await this.apiProvider().reward(request)
      this.accept(receipt.snapshot)
      return receipt
    })
  }

  upgrade(cardId: string): Promise<ProgressionSnapshot> {
    return this.enqueue(async () => {
      this.accept(await this.apiProvider().upgrade(cardId))
      return this.getSnapshot()
    })
  }

  refund(cardId: string): Promise<ProgressionSnapshot> {
    return this.enqueue(async () => {
      this.accept(await this.apiProvider().refund(cardId))
      return this.getSnapshot()
    })
  }

  setDust(amount: number): Promise<ProgressionSnapshot> {
    return this.enqueue(async () => {
      const api = this.apiProvider()
      if (!api.devSetDust)
        throw new Error('Setting Arcane Dust is available only in development.')
      this.accept(await api.devSetDust(amount))
      return this.getSnapshot()
    })
  }

  private accept(snapshot: ProgressionSnapshot): void {
    this.snapshot = {
      dust: snapshot.dust,
      premiumPurchases: { ...snapshot.premiumPurchases }
    }
    setPremiumCardIds(Object.keys(snapshot.premiumPurchases))
    for (const listener of this.listeners) listener()
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      await this.load()
      return operation()
    })
    this.queue = next.catch(() => undefined)
    return next
  }
}
