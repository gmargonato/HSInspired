import { replaceFileAtomically } from './atomic-file'
import { SerialOperationQueue } from './serial-operation-queue'
import { randomUUID } from 'node:crypto'
import { readFile, rename } from 'node:fs/promises'
import { CARD_CATALOG } from '../../game/content/cards'
import {
  createArenaRewards,
  type ArenaRewardReceipt
} from '../../game/arena/arena-rewards'
import { createSeededRng } from '../../game/match'
import {
  parseArenaRewardReceipt,
  parseArenaRunId
} from '../../shared/ipc/arena-rewards'
import { premiumUpgradeCost, WIN_DUST_REWARD } from '../../game/progression/arcane-dust'
import {
  parseDustAmount,
  parseDustRewardRequest,
  parseProgressionCardId,
  parseProgressionSnapshot,
  type ProgressionSnapshot,
  type DustRewardRequest,
  type DustRewardReceipt
} from '../../shared/ipc/progression'
import {
  createEmptyClassWinTotals,
  parseConstructedMatchResult,
  parseConstructedRankResultRequest,
  parseConstructedRankSnapshot,
  parsePlayableClassId,
  parsePlayerStatsSnapshot,
  type ClassWinTotals,
  type ConstructedRankSnapshot,
  type ConstructedRankResultRequest,
  type PlayerStatsSnapshot
} from '../../shared/ipc/player-stats'
import {
  applyConstructedResult,
  applySeasonReset,
  createInitialRankState,
  type ConstructedRankState
} from '../../game/ranking/constructed-ranking'
import type { ClassId, DeckClass } from '../../game/content/cards'

const PLAYER_STATS_FILE_VERSION = 5

interface PersistedPlayerStats {
  readonly version: typeof PLAYER_STATS_FILE_VERSION
  readonly winsByClass: ClassWinTotals
  readonly tavernBrawlWins: number
  readonly progression: ProgressionSnapshot
  readonly dustRewards: Readonly<Record<string, number>>
  readonly arenaRewards: Readonly<Record<string, ArenaRewardReceipt>>
  readonly rank: ConstructedRankState
  readonly rankResults: Readonly<Record<string, ConstructedRankResultRequest['result']>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function cloneRank(rank: ConstructedRankSnapshot): ConstructedRankSnapshot {
  return { ...rank }
}

function cloneSnapshot(snapshot: PlayerStatsSnapshot): PlayerStatsSnapshot {
  return {
    winsByClass: { ...snapshot.winsByClass },
    tavernBrawlWins: snapshot.tavernBrawlWins,
    rank: cloneRank(snapshot.rank)
  }
}

/** Atomic main-process persistence for the player's win totals. */
export class PlayerStatsRepository {
  private progression: ProgressionSnapshot = { dust: 0, premiumPurchases: {} }
  private dustRewards: Record<string, number> = {}
  private arenaRewards: Record<string, ArenaRewardReceipt> = {}
  private rankState: ConstructedRankState = createInitialRankState()
  private rankResults: Record<string, ConstructedRankResultRequest['result']> = {}
  private snapshot: PlayerStatsSnapshot = {
    winsByClass: createEmptyClassWinTotals(),
    tavernBrawlWins: 0,
    rank: createInitialRankState()
  }
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private readonly mutations = new SerialOperationQueue()

  constructor(private readonly filePath: string) {}

  awardArena(runId: string, wins: number, seed: number): Promise<ArenaRewardReceipt> {
    parseArenaRunId(runId)
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      const previous = Object.hasOwn(this.arenaRewards, runId)
        ? this.arenaRewards[runId]
        : undefined
      if (previous) {
        if (previous.wins !== wins)
          throw new Error('Arena reward wins do not match the saved claim.')
        return parseArenaRewardReceipt(previous)
      }
      const receipt = createArenaRewards(
        runId,
        wins,
        this.progression.premiumPurchases,
        createSeededRng(seed)
      )
      const purchases = { ...this.progression.premiumPurchases }
      let dust = this.progression.dust
      for (const prize of receipt.prizes) {
        if (prize.kind === 'dust') dust += prize.amount
        else purchases[prize.cardId] = prize.refundValue
      }
      const progression = { dust: parseDustAmount(dust), premiumPurchases: purchases }
      const receipts = { ...this.arenaRewards, [runId]: receipt }
      await this.persist(this.snapshot, progression, this.dustRewards, receipts)
      this.progression = progression
      this.arenaRewards = receipts
      return parseArenaRewardReceipt(receipt)
    })
  }

  async getProgression(): Promise<ProgressionSnapshot> {
    await this.ensureLoaded()
    await this.mutations.settled
    return parseProgressionSnapshot(this.progression)
  }

  rewardDust(input: DustRewardRequest): Promise<DustRewardReceipt> {
    const request = parseDustRewardRequest(input)
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      const previous = Object.hasOwn(this.dustRewards, request.matchId)
        ? this.dustRewards[request.matchId]
        : undefined
      if (previous !== undefined)
        return {
          snapshot: parseProgressionSnapshot(this.progression),
          earned: previous
        }
      const earned =
        request.result === 'win' &&
        request.mode !== 'tavern-brawl' &&
        request.reason === 'hero-health-depleted'
          ? WIN_DUST_REWARD
          : 0
      if (!earned)
        return { snapshot: parseProgressionSnapshot(this.progression), earned: 0 }
      const next = {
        ...this.progression,
        dust: parseDustAmount(this.progression.dust + earned)
      }
      const receipts = { ...this.dustRewards, [request.matchId]: earned }
      await this.persist(this.snapshot, next, receipts)
      this.progression = next
      this.dustRewards = receipts
      return { snapshot: parseProgressionSnapshot(next), earned }
    })
  }

  changePremium(
    cardId: string,
    action: 'upgrade' | 'refund'
  ): Promise<ProgressionSnapshot> {
    parseProgressionCardId(cardId)
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      const card = CARD_CATALOG.require(cardId)
      const price = premiumUpgradeCost(card)
      const paid = this.progression.premiumPurchases[cardId]
      if (action === 'upgrade' && price === null)
        throw new Error(
          'This card cannot be upgraded: it is uncollectible or has no premium format.'
        )
      if (action === 'upgrade' && paid !== undefined)
        throw new Error('This card is already premium.')
      if (action === 'refund' && paid === undefined)
        throw new Error('This card is not premium.')
      if (action === 'upgrade' && this.progression.dust < price!)
        throw new Error('Not enough Arcane Dust.')
      const purchases = { ...this.progression.premiumPurchases }
      if (action === 'upgrade') purchases[cardId] = price!
      else delete purchases[cardId]
      const next = {
        dust: parseDustAmount(
          this.progression.dust + (action === 'upgrade' ? -price! : paid!)
        ),
        premiumPurchases: purchases
      }
      await this.persist(this.snapshot, next)
      this.progression = next
      return parseProgressionSnapshot(next)
    })
  }

  async get(): Promise<PlayerStatsSnapshot> {
    await this.ensureLoaded()
    return this.mutations.enqueue(async () => {
      await this.refreshSeason()
      return cloneSnapshot(this.snapshot)
    })
  }

  /**
   * Applies one constructed match result to the ladder. Results are
   * idempotent: replaying the same match id never changes the rank again.
   */
  recordConstructedResult(
    input: ConstructedRankResultRequest
  ): Promise<PlayerStatsSnapshot> {
    const request = parseConstructedRankResultRequest(input)
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      const previous = Object.hasOwn(this.rankResults, request.matchId)
        ? this.rankResults[request.matchId]
        : undefined
      if (previous !== undefined) return cloneSnapshot(this.snapshot)
      await this.refreshSeason()
      const nextRank = applyConstructedResult(this.rankState, request.result)
      const next: PlayerStatsSnapshot = { ...this.snapshot, rank: cloneRank(nextRank) }
      const receipts = { ...this.rankResults, [request.matchId]: request.result }
      await this.persist(
        next,
        this.progression,
        this.dustRewards,
        this.arenaRewards,
        nextRank,
        receipts
      )
      this.rankState = nextRank
      this.rankResults = receipts
      this.snapshot = next
      return cloneSnapshot(next)
    })
  }

  setDust(amount: number): Promise<ProgressionSnapshot> {
    const dust = parseDustAmount(amount)
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      const next = { ...this.progression, dust }
      await this.persist(this.snapshot, next)
      this.progression = next
      return parseProgressionSnapshot(next)
    })
  }

  async recordWin(classId: ClassId): Promise<PlayerStatsSnapshot> {
    return this.mutations.enqueue(async () => {
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
    return this.mutations.enqueue(async () => {
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

  /**
   * Overrides the constructed rank outright. Development-only support for the
   * dev menu's Set Rank entry.
   */
  setRank(input: ConstructedRankSnapshot): Promise<PlayerStatsSnapshot> {
    const rank = parseConstructedRankSnapshot(input)
    return this.mutations.enqueue(async () => {
      await this.ensureLoaded()
      const next: PlayerStatsSnapshot = { ...this.snapshot, rank: cloneRank(rank) }
      await this.persist(
        next,
        this.progression,
        this.dustRewards,
        this.arenaRewards,
        rank,
        this.rankResults
      )
      this.rankState = rank
      this.snapshot = next
      return cloneSnapshot(next)
    })
  }

  /**
   * Applies the monthly season reset when the persisted rank belongs to a
   * previous season, sending the player back to rank 25.
   */
  private async refreshSeason(): Promise<void> {
    const next = applySeasonReset(this.rankState)
    if (next === this.rankState) return
    await this.persist(
      this.snapshot,
      this.progression,
      this.dustRewards,
      this.arenaRewards,
      next,
      this.rankResults
    )
    this.rankState = next
    this.snapshot = { ...this.snapshot, rank: cloneRank(next) }
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
      const source = await readFile(this.filePath, 'utf8')
      try {
        parsed = JSON.parse(source) as unknown
      } catch {
        await this.preserveCorruptSave()
        this.loaded = true
        return
      }
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        this.loaded = true
        return
      }
      throw error
    }

    try {
      if (
        !isRecord(parsed) ||
        (parsed.version !== 1 &&
          parsed.version !== 2 &&
          parsed.version !== 3 &&
          parsed.version !== PLAYER_STATS_FILE_VERSION)
      ) {
        throw new Error('Unsupported player stats version')
      }
      const rank =
        parsed.version === PLAYER_STATS_FILE_VERSION
          ? parseConstructedRankSnapshot(parsed.rank)
          : createInitialRankState()
      this.snapshot = parsePlayerStatsSnapshot({
        winsByClass: parsed.winsByClass,
        tavernBrawlWins: parsed.version === 1 ? 0 : parsed.tavernBrawlWins,
        rank
      })
      this.rankState = rank
      if (parsed.version === 3 || parsed.version === PLAYER_STATS_FILE_VERSION) {
        const progression = parseProgressionSnapshot(parsed.progression)
        if (!isRecord(parsed.dustRewards))
          throw new Error('Invalid dust reward receipts')
        const receipts: Record<string, number> = {}
        for (const [id, amount] of Object.entries(parsed.dustRewards)) {
          parseDustRewardRequest({
            matchId: id,
            mode: 'constructed',
            result: 'win',
            reason: 'hero-health-depleted'
          })
          receipts[id] = parseDustAmount(amount)
        }
        this.progression = progression
        this.dustRewards = receipts
      }
      if (parsed.version === PLAYER_STATS_FILE_VERSION) {
        if (!isRecord(parsed.arenaRewards)) throw new Error('Invalid Arena receipts.')
        const receipts: Record<string, ArenaRewardReceipt> = {}
        for (const [id, value] of Object.entries(parsed.arenaRewards)) {
          const receipt = parseArenaRewardReceipt(value)
          if (id !== receipt.runId) throw new Error('Invalid Arena receipt ID.')
          receipts[id] = receipt
        }
        this.arenaRewards = receipts
        if (!isRecord(parsed.rankResults)) {
          throw new Error('Invalid constructed rank receipts')
        }
        const rankReceipts: Record<string, ConstructedRankResultRequest['result']> = {}
        for (const [id, result] of Object.entries(parsed.rankResults)) {
          if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) {
            throw new Error('Invalid constructed rank receipt ID.')
          }
          rankReceipts[id] = parseConstructedMatchResult(result)
        }
        this.rankResults = rankReceipts
      }
    } catch (error) {
      // Future-version saves must not be replaced by an older application.
      if (
        isRecord(parsed) &&
        typeof parsed.version === 'number' &&
        parsed.version > PLAYER_STATS_FILE_VERSION
      )
        throw error
      await this.preserveCorruptSave()
      this.snapshot = {
        winsByClass: createEmptyClassWinTotals(),
        tavernBrawlWins: 0,
        rank: createInitialRankState()
      }
      this.rankState = createInitialRankState()
      this.rankResults = {}
      this.progression = { dust: 0, premiumPurchases: {} }
      this.dustRewards = {}
      this.arenaRewards = {}
    }
    this.loaded = true
  }

  private async preserveCorruptSave(): Promise<void> {
    await rename(this.filePath, `${this.filePath}.corrupt-${randomUUID()}`)
  }

  private async persist(
    snapshot: PlayerStatsSnapshot,
    progression = this.progression,
    dustRewards = this.dustRewards,
    arenaRewards = this.arenaRewards,
    rank: ConstructedRankState = this.rankState,
    rankResults: Readonly<Record<string, ConstructedRankResultRequest['result']>> = this
      .rankResults
  ): Promise<void> {
    const payload: PersistedPlayerStats = {
      version: PLAYER_STATS_FILE_VERSION,
      winsByClass: { ...snapshot.winsByClass },
      tavernBrawlWins: snapshot.tavernBrawlWins,
      progression,
      dustRewards,
      arenaRewards,
      rank,
      rankResults
    }
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    await replaceFileAtomically(
      this.filePath,
      temporaryPath,
      () => JSON.stringify(payload, null, 2) + '\n'
    )
  }
}
