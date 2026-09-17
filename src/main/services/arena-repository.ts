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
import type { ArenaRewardReceipt } from '../../game/arena/arena-rewards'
import {
  parseArenaRunSnapshot,
  parseArenaScoreRequest,
  type ArenaScoreRequest
} from '../../shared/ipc/arena'

const ARENA_FILE_VERSION = 2 as const
interface PendingArenaClaim {
  readonly runId: string
  readonly wins: number
  readonly seed: number
}
interface PersistedArenaFile {
  readonly version: typeof ARENA_FILE_VERSION
  readonly run: ArenaRunSnapshot
  readonly pendingClaim: PendingArenaClaim | null
}

function cloneRun(run: ArenaRunSnapshot): ArenaRunSnapshot {
  return {
    ...run,
    heroChoices: [...run.heroChoices] as [HeroId, HeroId, HeroId],
    cardChoices: run.cardChoices
      ? ([...run.cardChoices] as [CardId, CardId, CardId])
      : null,
    cards: { ...run.cards },
    rewards: run.rewards
      ? { ...run.rewards, prizes: run.rewards.prizes.map((prize) => ({ ...prize })) }
      : null
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
  private pendingClaim: PendingArenaClaim | null = null

  constructor(
    private readonly filePath: string,
    private readonly rewardRepository?: {
      awardArena(runId: string, wins: number, seed: number): Promise<ArenaRewardReceipt>
    }
  ) {}

  async get(): Promise<ArenaRunSnapshot> {
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      await this.recoverClaim()
      return cloneRun(this.requireRun())
    })
  }

  async selectHero(heroId: HeroId): Promise<ArenaRunSnapshot> {
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      const current = this.requireRun()
      this.assertActive()
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
      this.assertActive()
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

  async retire(runId: string): Promise<ArenaRunSnapshot> {
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      const current = this.requireRun()
      if (current.runId !== runId)
        throw new Error('This Arena run is no longer current.')
      if (current.rewards) return cloneRun(current)
      if (this.pendingClaim) {
        await this.recoverClaim()
        return cloneRun(this.requireRun())
      }
      if (current.gamesPlayed > 0) {
        if (!this.rewardRepository) throw new Error('Arena rewards are unavailable.')
        const pending = {
          runId,
          wins: current.wins,
          seed: randomBytes(4).readUInt32LE(0)
        }
        await this.persist(current, pending)
        this.pendingClaim = pending
        await this.recoverClaim()
        return cloneRun(this.requireRun())
      }
      const next = this.createFreshRun(current.heroChoices)
      await this.persist(next)
      this.run = next
      this.loaded = true
      return cloneRun(next)
    })
  }

  async acknowledgeRewards(runId: string): Promise<ArenaRunSnapshot> {
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      const current = this.requireRun()
      if (current.runId !== runId) return cloneRun(current)
      await this.recoverClaim()
      if (!this.requireRun().rewards)
        throw new Error('No Arena rewards to acknowledge.')
      const next = this.createFreshRun(current.heroChoices)
      await this.persist(next, null)
      this.run = next
      return cloneRun(next)
    })
  }

  private assertActive(): void {
    if (this.pendingClaim || this.requireRun().rewards)
      throw new Error('Arena rewards are pending acknowledgement.')
  }

  private async recoverClaim(): Promise<void> {
    const pending = this.pendingClaim
    if (!pending) return
    if (!this.rewardRepository) throw new Error('Arena rewards are unavailable.')
    const rewards = await this.rewardRepository.awardArena(
      pending.runId,
      pending.wins,
      pending.seed
    )
    const next = { ...this.requireRun(), rewards }
    await this.persist(next, null)
    this.run = next
    this.pendingClaim = null
  }

  async devSetScore(request: ArenaScoreRequest): Promise<ArenaRunSnapshot> {
    const { runId, counter, value } = parseArenaScoreRequest(request)
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      const current = this.requireRun()
      if (current.runId !== runId)
        throw new Error('This Arena run is no longer current.')
      this.assertActive()
      if (current.phase !== 'ready') throw new Error('Arena deck is not complete.')
      const draws = current.gamesPlayed - current.wins - current.defeats
      const next = {
        ...current,
        [counter]: value,
        gamesPlayed:
          draws + value + (counter === 'wins' ? current.defeats : current.wins),
        updatedAt: new Date().toISOString()
      }
      await this.persist(next)
      this.run = next
      return cloneRun(next)
    })
  }

  async recordResult(result: ArenaMatchResult): Promise<ArenaRunSnapshot> {
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      const current = this.requireRun()
      this.assertActive()
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
      runId: randomUUID(),
      rewards: null,
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
    let parsed: unknown
    let migrate = false
    try {
      parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        ![1, ARENA_FILE_VERSION].includes((parsed as { version: number }).version)
      ) {
        throw new Error('Unsupported Arena data version.')
      }
      const file = parsed as {
        version: number
        run: Record<string, unknown>
        pendingClaim?: PendingArenaClaim | null
      }
      this.run = parseArenaRunSnapshot(
        file.version === 1
          ? { ...file.run, runId: randomUUID(), rewards: null }
          : file.run
      )
      this.pendingClaim = file.pendingClaim ?? null
      if (
        this.pendingClaim &&
        (this.pendingClaim.runId !== this.run.runId ||
          this.pendingClaim.wins !== this.run.wins ||
          !Number.isInteger(this.pendingClaim.seed) ||
          this.pendingClaim.seed < 0 ||
          this.pendingClaim.seed > 0xffffffff ||
          this.run.phase !== 'ready' ||
          this.run.gamesPlayed < 1 ||
          this.run.rewards)
      )
        throw new Error('Invalid pending Arena claim.')
      migrate = file.version === 1
    } catch (error) {
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as { version?: unknown }).version === 'number' &&
        (parsed as { version: number }).version > ARENA_FILE_VERSION
      )
        throw error
      if (isNodeError(error) && error.code !== 'ENOENT') throw error
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        const backup = `${this.filePath}.corrupt-${Date.now()}.bak`
        await rename(this.filePath, backup).catch(() => undefined)
        console.warn(`Invalid Arena data was moved to ${backup}.`, error)
      }
      this.run = this.createFreshRun()
      this.pendingClaim = null
      await this.persist(this.run)
    }
    if (migrate) await this.persist(this.requireRun())
    this.loaded = true
  }

  private async persist(
    run: ArenaRunSnapshot,
    pendingClaim = this.pendingClaim
  ): Promise<void> {
    const payload: PersistedArenaFile = {
      version: ARENA_FILE_VERSION,
      run,
      pendingClaim
    }
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    await replaceFileAtomically(
      this.filePath,
      temporaryPath,
      () => JSON.stringify(payload, null, 2) + '\n'
    )
  }
}
