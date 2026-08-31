import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  createEmptyClassWinTotals,
  parsePlayableClassId,
  parsePlayerStatsSnapshot,
  type ClassWinTotals,
  type PlayerStatsSnapshot
} from '../../shared/ipc/player-stats'
import type { ClassId, DeckClass } from '../../game/content/cards'

const PLAYER_STATS_FILE_VERSION = 2

interface PersistedPlayerStats {
  readonly version: typeof PLAYER_STATS_FILE_VERSION
  readonly winsByClass: ClassWinTotals
  readonly tavernBrawlWins: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function cloneSnapshot(snapshot: PlayerStatsSnapshot): PlayerStatsSnapshot {
  return {
    winsByClass: { ...snapshot.winsByClass },
    tavernBrawlWins: snapshot.tavernBrawlWins
  }
}

/** Atomic main-process persistence for the player's win totals. */
export class PlayerStatsRepository {
  private snapshot: PlayerStatsSnapshot = {
    winsByClass: createEmptyClassWinTotals(),
    tavernBrawlWins: 0
  }
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async get(): Promise<PlayerStatsSnapshot> {
    await this.ensureLoaded()
    await this.mutationQueue
    return cloneSnapshot(this.snapshot)
  }

  async recordWin(classId: ClassId): Promise<PlayerStatsSnapshot> {
    return this.enqueueMutation(async () => {
      await this.ensureLoaded()
      const validatedClassId = parsePlayableClassId(classId) as DeckClass
      const currentWins = this.snapshot.winsByClass[validatedClassId]
      if (currentWins === Number.MAX_SAFE_INTEGER) {
        throw new Error(`Win total for ${validatedClassId} cannot be incremented`)
      }

      const next: PlayerStatsSnapshot = {
        ...this.snapshot,
        winsByClass: {
          ...this.snapshot.winsByClass,
          [validatedClassId]: currentWins + 1
        }
      }
      await this.persist(next)
      this.snapshot = next
      return cloneSnapshot(next)
    })
  }

  async recordTavernBrawlWin(): Promise<PlayerStatsSnapshot> {
    return this.enqueueMutation(async () => {
      await this.ensureLoaded()
      if (this.snapshot.tavernBrawlWins === Number.MAX_SAFE_INTEGER) {
        throw new Error('Tavern Brawl win total cannot be incremented')
      }

      const next: PlayerStatsSnapshot = {
        ...this.snapshot,
        tavernBrawlWins: this.snapshot.tavernBrawlWins + 1
      }
      await this.persist(next)
      this.snapshot = next
      return cloneSnapshot(next)
    })
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.readPersistedStats().finally(() => {
      this.loadPromise = null
    })
    return this.loadPromise
  }

  private async readPersistedStats(): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        this.loaded = true
        return
      }
      console.warn('Could not read saved player stats; using zero totals.', error)
      this.loaded = true
      return
    }

    try {
      if (
        !isRecord(parsed) ||
        (parsed.version !== 1 && parsed.version !== PLAYER_STATS_FILE_VERSION)
      ) {
        throw new Error('Unsupported player stats version')
      }
      this.snapshot = parsePlayerStatsSnapshot({
        winsByClass: parsed.winsByClass,
        tavernBrawlWins: parsed.version === 1 ? 0 : parsed.tavernBrawlWins
      })
    } catch (error) {
      console.warn('Saved player stats were invalid; using zero totals.', error)
    }
    this.loaded = true
  }

  private async persist(snapshot: PlayerStatsSnapshot): Promise<void> {
    const payload: PersistedPlayerStats = {
      version: PLAYER_STATS_FILE_VERSION,
      winsByClass: { ...snapshot.winsByClass },
      tavernBrawlWins: snapshot.tavernBrawlWins
    }
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    await mkdir(dirname(this.filePath), { recursive: true })
    try {
      await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, this.filePath)
    } finally {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }
}
