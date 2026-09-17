import type { ProgressionApi, ProgressionSnapshot } from '../../shared/ipc/progression'

export interface ProgressionStore extends Omit<ProgressionApi, 'get'> {
  setDust(amount: number): Promise<ProgressionSnapshot>
  load(): Promise<void>
  refresh(): Promise<void>
  getSnapshot(): ProgressionSnapshot
  subscribe(listener: () => void): () => void
}
