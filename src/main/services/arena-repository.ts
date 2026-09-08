import { replaceFileAtomically } from './atomic-file'
import { SerialOperationQueue } from './serial-operation-queue'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, rename } from 'node:fs/promises'
import {
  ARENA_DECK_ID,
  ARENA_DECK_SIZE,
  createArenaCardChoices,
  createArenaHeroChoices,
  createSeededRng,
  isArenaRunComplete,
  type ArenaMatchResult,
  type ArenaRunSnapshot,
  type CardId,
  type HeroId
} from '../../game'
import { parseArenaRunSnapshot } from '../../shared/ipc/arena'

const ARENA_FILE_VERSION = 1 as const
interface PersistedArenaFile {
  readonly version: typeof ARENA_FILE_VERSION
  readonly run: ArenaRunSnapshot
}

function cloneRun(run: ArenaRunSnapshot): ArenaRunSnapshot {
  return {
    ...run,
    heroChoices: [...run.heroChoices] as [HeroId, HeroId, HeroId],
    cardChoices: run.cardChoices
      ? ([...run.cardChoices] as [CardId, CardId, CardId])
      : null,
    cards: { ...run.cards }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

export class ArenaRepository {
  private run: ArenaRunSnapshot | null = null
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private readonly mutations = new SerialOperationQueue()

  constructor(private readonly filePath: string) {}

  async get(): Promise<ArenaRunSnapshot> {
    await this.ensureLoaded()
    await this.mutations.settled
    return cloneRun(this.requireRun())
  }

  async selectHero(heroId: HeroId): Promise<ArenaRunSnapshot> {
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      const current = this.requireRun()
      if (current.phase !== 'choosing-hero' || !current.heroChoices.includes(heroId)) {
        throw new Error('That hero is not in the current Arena offer.')
      }
      const now = new Date().toISOString()
      const next: ArenaRunSnapshot = {
        ...current,
        phase: 'drafting',
        heroId,
        cardChoices: createArenaCardChoices(heroId, this.createRng()),
        updatedAt: now
      }
      await this.persist(next)
      this.run = next
      return cloneRun(next)
    })
  }

  async pickCard(cardId: CardId): Promise<ArenaRunSnapshot> {
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      const current = this.requireRun()
      if (
        current.phase !== 'drafting' ||
        !current.heroId ||
        !current.cardChoices?.includes(cardId)
      ) {
        throw new Error('That card is not in the current Arena offer.')
      }
      const picksCompleted = current.picksCompleted + 1
      const cards = {
        ...current.cards,
        [cardId]: (current.cards[cardId] ?? 0) + 1
      }
      const ready = picksCompleted === ARENA_DECK_SIZE
      const next: ArenaRunSnapshot = {
        ...current,
        phase: ready ? 'ready' : 'drafting',
        cards,
        picksCompleted,
        cardChoices: ready
          ? null
          : createArenaCardChoices(current.heroId, this.createRng()),
        updatedAt: new Date().toISOString()
      }
      await this.persist(next)
      this.run = next
      return cloneRun(next)
    })
  }

  async retire(): Promise<ArenaRunSnapshot> {
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      const next = this.createFreshRun(this.requireRun().heroChoices)
      await this.persist(next)
      this.run = next
      this.loaded = true
      return cloneRun(next)
    })
  }

  async recordResult(result: ArenaMatchResult): Promise<ArenaRunSnapshot> {
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      const current = this.requireRun()
      if (current.phase !== 'ready') throw new Error('Arena deck is not complete.')
      if (isArenaRunComplete(current)) {
        throw new Error('The Arena run is complete and must be retired.')
      }
      const next: ArenaRunSnapshot = {
        ...current,
        gamesPlayed: current.gamesPlayed + 1,
        wins: current.wins + (result === 'win' ? 1 : 0),
        defeats: current.defeats + (result === 'defeat' ? 1 : 0),
        updatedAt: new Date().toISOString()
      }
      await this.persist(next)
      this.run = next
      return cloneRun(next)
    })
  }

  private createFreshRun(
    previousChoices?: ArenaRunSnapshot['heroChoices']
  ): ArenaRunSnapshot {
    const now = new Date().toISOString()
    let heroChoices = createArenaHeroChoices(this.createRng())
    const previousKey = previousChoices ? [...previousChoices].sort().join('|') : null
    while (previousKey && [...heroChoices].sort().join('|') === previousKey) {
      heroChoices = createArenaHeroChoices(this.createRng())
    }
    return {
      id: ARENA_DECK_ID,
      phase: 'choosing-hero',
      heroChoices,
      heroId: null,
      cardChoices: null,
      cards: {},
      picksCompleted: 0,
      gamesPlayed: 0,
      wins: 0,
      defeats: 0,
      createdAt: now,
      updatedAt: now
    }
  }

  private createRng() {
    return createSeededRng(randomBytes(4).readUInt32LE(0))
  }

  private requireRun(): ArenaRunSnapshot {
    if (!this.run) throw new Error('Arena run is unavailable.')
    return this.run
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.load().finally(() => {
      this.loadPromise = null
    })
    return this.loadPromise
  }

  private async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        (parsed as { version?: unknown }).version !== ARENA_FILE_VERSION
      ) {
        throw new Error('Unsupported Arena data version.')
      }
      this.run = parseArenaRunSnapshot((parsed as { run?: unknown }).run)
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        const backup = `${this.filePath}.corrupt-${Date.now()}.bak`
        await rename(this.filePath, backup).catch(() => undefined)
        console.warn(`Invalid Arena data was moved to ${backup}.`, error)
      }
      this.run = this.createFreshRun()
      await this.persist(this.run)
    }
    this.loaded = true
  }

  private async persist(run: ArenaRunSnapshot): Promise<void> {
    const payload: PersistedArenaFile = { version: ARENA_FILE_VERSION, run }
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    await replaceFileAtomically(
      this.filePath,
      temporaryPath,
      () => JSON.stringify(payload, null, 2) + '\n'
    )
  }
}
