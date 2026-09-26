import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { asClassId, CARD_CATALOG } from '../../game/content/cards'
import { premiumUpgradeCost } from '../../game/progression/arcane-dust'
import { supportsPremiumFormat } from '../../game/progression/premium-support'
import { createSeasonKey } from '../../game/ranking/constructed-ranking'
import * as atomicFile from './atomic-file'
import type { DustRewardRequest } from '../../shared/ipc/progression'
import { PlayerStatsRepository } from './player-stats-repository'
import { createArenaRewards } from '../../game/arena/arena-rewards'
import { createSeededRng } from '../../game/match'

const temporaryDirectories: string[] = []

async function createRepository(): Promise<{
  readonly directory: string
  readonly filePath: string
  readonly repository: PlayerStatsRepository
}> {
  const directory = await mkdtemp(join(tmpdir(), 'hsinspired-player-stats-'))
  temporaryDirectories.push(directory)
  const filePath = join(directory, 'player-stats.json')
  return {
    directory,
    filePath,
    repository: new PlayerStatsRepository(filePath)
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('PlayerStatsRepository', () => {
  it('credits Arena rewards once alongside win dust and preserves their refund values', async () => {
    const { repository, filePath } = await createRepository()
    await repository.rewardDust({
      matchId: 'arena-win',
      mode: 'arena',
      result: 'win',
      reason: 'hero-health-depleted'
    })
    let seed = 0
    while (
      !createArenaRewards('arena-run', 12, {}, createSeededRng(seed)).prizes.some(
        (prize) => prize.kind === 'premium'
      )
    )
      seed++
    const [first, duplicate] = await Promise.all([
      repository.awardArena('arena-run', 12, seed),
      repository.awardArena('arena-run', 12, seed + 1)
    ])
    expect(duplicate).toEqual(first)
    const progression = await repository.getProgression()
    expect(progression.dust).toBe(
      25 +
        first.prizes.reduce(
          (sum, prize) => sum + (prize.kind === 'dust' ? prize.amount : 0),
          0
        )
    )
    const reloaded = new PlayerStatsRepository(filePath)
    expect(await reloaded.awardArena('arena-run', 12, seed + 2)).toEqual(first)
    expect(await reloaded.getProgression()).toEqual(progression)
    for (const prize of first.prizes) {
      if (prize.kind !== 'premium') continue
      expect(progression.premiumPurchases[prize.cardId]).toBe(prize.refundValue)
      const before = (await reloaded.getProgression()).dust
      expect((await reloaded.changePremium(prize.cardId, 'refund')).dust).toBe(
        before + prize.refundValue
      )
    }
    const refunded = await reloaded.getProgression()
    await reloaded.awardArena('arena-run', 12, seed)
    expect(await reloaded.getProgression()).toEqual(refunded)
  })

  it('selects against ownership at the serialized credit operation', async () => {
    const { repository } = await createRepository()
    let seed = 0
    let candidate = createArenaRewards(
      'run',
      12,
      {},
      createSeededRng(seed)
    ).prizes.find((prize) => prize.kind === 'premium')
    while (!candidate)
      candidate = createArenaRewards(
        'run',
        12,
        {},
        createSeededRng(++seed)
      ).prizes.find((prize) => prize.kind === 'premium')
    if (candidate.kind !== 'premium') throw new Error('Expected premium')
    await repository.setDust(1000)
    const upgrade = repository.changePremium(candidate.cardId, 'upgrade')
    const credit = repository.awardArena('run', 12, seed)
    await upgrade
    expect(
      (await credit).prizes.some(
        (prize) => prize.kind === 'premium' && prize.cardId === candidate.cardId
      )
    ).toBe(false)
  })

  it('preserves version 3 balances, premiums and victory receipts on migration', async () => {
    const { repository, filePath } = await createRepository()
    const request: DustRewardRequest = {
      matchId: 'legacy-win',
      mode: 'arena',
      result: 'win',
      reason: 'hero-health-depleted'
    }
    await repository.rewardDust(request)
    const saved = JSON.parse(await readFile(filePath, 'utf8'))
    saved.version = 3
    delete saved.arenaRewards
    await writeFile(filePath, JSON.stringify(saved))
    const reloaded = new PlayerStatsRepository(filePath)
    expect(await reloaded.getProgression()).toEqual(saved.progression)
    await reloaded.rewardDust(request)
    expect((await reloaded.getProgression()).dust).toBe(25)
    await reloaded.awardArena('new-run', 0, 1)
    const migrated = JSON.parse(await readFile(filePath, 'utf8'))
    expect(migrated.version).toBe(5)
    expect(migrated.dustRewards).toEqual(saved.dustRewards)
  })
  it('starts every playable class at zero when no file exists', async () => {
    const { repository } = await createRepository()

    const snapshot = await repository.get()

    expect(snapshot.winsByClass.Mage).toBe(0)
    expect(snapshot.winsByClass.Warlock).toBe(0)
    expect(snapshot.tavernBrawlWins).toBe(0)
  })

  it('persists increments and preserves totals for other classes', async () => {
    const { filePath, repository } = await createRepository()

    await Promise.all([
      repository.recordWin(asClassId('Mage')),
      repository.recordWin(asClassId('Mage')),
      repository.recordWin(asClassId('Warlock'))
    ])

    const reloaded = await new PlayerStatsRepository(filePath).get()
    expect(reloaded.winsByClass.Mage).toBe(2)
    expect(reloaded.winsByClass.Warlock).toBe(1)
    expect(reloaded.winsByClass.Druid).toBe(0)
    expect(reloaded.tavernBrawlWins).toBe(0)
  })

  it('persists Tavern Brawl wins without changing class wins', async () => {
    const { filePath, repository } = await createRepository()

    await Promise.all([
      repository.recordTavernBrawlWin(),
      repository.recordTavernBrawlWin()
    ])

    const reloaded = await new PlayerStatsRepository(filePath).get()
    expect(reloaded.tavernBrawlWins).toBe(2)
    expect(reloaded.winsByClass.Mage).toBe(0)
  })

  it('loads version 1 class wins with a zero Tavern total and upgrades on mutation', async () => {
    const { filePath, repository } = await createRepository()
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        winsByClass: {
          Druid: 0,
          Hunter: 0,
          Mage: 4,
          Paladin: 0,
          Priest: 0,
          Rogue: 0,
          Shaman: 0,
          Warlock: 0,
          Warrior: 0
        }
      }),
      'utf8'
    )

    expect((await repository.get()).tavernBrawlWins).toBe(0)
    await repository.recordTavernBrawlWin()

    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as {
      version: number
      tavernBrawlWins: number
    }
    expect(persisted).toMatchObject({ version: 5, tavernBrawlWins: 1 })
  })

  it('falls back to zero totals when saved data is malformed', async () => {
    const { filePath, directory } = await createRepository()
    await writeFile(filePath, '{not valid json', 'utf8')

    const snapshot = await new PlayerStatsRepository(filePath).get()

    expect(snapshot.winsByClass.Mage).toBe(0)
    expect(snapshot.tavernBrawlWins).toBe(0)
    const backup = (await readdir(directory)).find((name) =>
      name.startsWith('player-stats.json.corrupt-')
    )!
    expect(await readFile(join(directory, backup), 'utf8')).toBe('{not valid json')
  })
})

const reward = (
  matchId: string,
  overrides: Partial<DustRewardRequest> = {}
): DustRewardRequest => ({
  matchId,
  mode: 'constructed',
  result: 'win',
  reason: 'hero-health-depleted',
  ...overrides
})

describe('Arcane Dust and premium ownership', () => {
  it('sets an absolute dust balance without changing ownership, receipts, or class wins', async () => {
    const { repository, filePath } = await createRepository()
    await repository.rewardDust(reward('already-paid'))
    await repository.recordWin(asClassId('Mage'))
    await repository.setDust(1875)
    expect((await repository.getProgression()).dust).toBe(1875)
    await repository.rewardDust(reward('already-paid'))
    expect((await repository.getProgression()).dust).toBe(1875)
    expect((await repository.get()).winsByClass.Mage).toBe(1)
    const card = CARD_CATALOG.all.find(
      (card) => card.collectible && card.type === 'Minion' && card.rarity === 'Common'
    )!
    await repository.changePremium(card.id, 'upgrade')
    await repository.setDust(0)
    expect(await new PlayerStatsRepository(filePath).getProgression()).toEqual({
      dust: 0,
      premiumPurchases: { [card.id]: 50 }
    })
    for (const invalid of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => repository.setDust(invalid)).toThrow()
  })

  it('allows premium Hero purchases and permits refunding them', async () => {
    const { repository } = await createRepository()
    await repository.setDust(2000)
    const hero = CARD_CATALOG.all.find(
      (card) => card.type === 'Hero' && card.collectible
    )!
    expect(hero).toBeDefined()
    const price = premiumUpgradeCost(hero)
    expect(price).toBe(200)
    expect(supportsPremiumFormat('Hero')).toBe(true)
    expect(supportsPremiumFormat('HeroPower')).toBe(true)
    expect(await repository.changePremium(hero.id, 'upgrade')).toEqual({
      dust: 2000 - price!,
      premiumPurchases: { [hero.id]: price }
    })
    expect(await repository.changePremium(hero.id, 'refund')).toEqual({
      dust: 2000,
      premiumPurchases: {}
    })
  })

  it('allows premium Sir Finley and premium hero power visuals', () => {
    const finley = CARD_CATALOG.all.find(
      (card) => card.name === 'Sir Finley Mrrgglton'
    )!
    expect(finley).toBeDefined()
    expect(premiumUpgradeCost(finley)).toBe(200)
    expect(supportsPremiumFormat(finley.type)).toBe(true)
    expect(supportsPremiumFormat('HeroPower')).toBe(true)
  })
  it('awards constructed and arena victories exactly once, including after reloading', async () => {
    const { repository, filePath } = await createRepository()
    await Promise.all([
      repository.rewardDust(reward('match-1')),
      repository.rewardDust(reward('match-1')),
      repository.rewardDust(reward('match-2', { mode: 'arena' }))
    ])
    const reloaded = new PlayerStatsRepository(filePath)
    expect((await reloaded.rewardDust(reward('match-1'))).earned).toBe(25)
    expect((await reloaded.getProgression()).dust).toBe(50)
  })

  it('excludes Tavern, defeats, draws, and developer-forced wins', async () => {
    const { repository } = await createRepository()
    for (const overrides of [
      { mode: 'tavern-brawl' },
      { result: 'defeat' },
      { result: 'draw' },
      { reason: 'dev-forced' }
    ] as Partial<DustRewardRequest>[]) {
      expect((await repository.rewardDust(reward('excluded', overrides))).earned).toBe(
        0
      )
    }
    expect((await repository.getProgression()).dust).toBe(0)
  })

  it.each([
    ['Free', 50],
    ['Common', 50],
    ['Rare', 100],
    ['Epic', 150],
    ['Legendary', 200]
  ] as const)(
    'charges %s once for all copies and returns the full price',
    async (rarity, cost) => {
      const { repository, filePath } = await createRepository()
      const card = CARD_CATALOG.all.find(
        (card) => card.collectible && card.rarity === rarity
      )!
      expect(premiumUpgradeCost(card)).toBe(cost)
      for (let index = 0; index < 8; index++)
        await repository.rewardDust(reward(`match-${index}`))
      const upgraded = await repository.changePremium(card.id, 'upgrade')
      expect(upgraded).toEqual({
        dust: 200 - cost,
        premiumPurchases: { [card.id]: cost }
      })
      await expect(repository.changePremium(card.id, 'upgrade')).rejects.toThrow(
        'already premium'
      )
      const reloaded = new PlayerStatsRepository(filePath)
      expect(await reloaded.changePremium(card.id, 'refund')).toEqual({
        dust: 200,
        premiumPurchases: {}
      })
      await expect(reloaded.changePremium(card.id, 'refund')).rejects.toThrow(
        'not premium'
      )
    }
  )

  it('rejects insufficient dust and uncollectible cards without modifying the save', async () => {
    const { repository } = await createRepository()
    const card = CARD_CATALOG.all.find(
      (card) => card.collectible && card.rarity === 'Common'
    )!
    await expect(repository.changePremium(card.id, 'upgrade')).rejects.toThrow(
      'Not enough'
    )
    const token = CARD_CATALOG.all.find((card) => !card.collectible)!
    await expect(repository.changePremium(token.id, 'upgrade')).rejects.toThrow(
      'cannot be upgraded'
    )
    expect(await repository.getProgression()).toEqual({ dust: 0, premiumPurchases: {} })
  })

  it('serializes competing purchases and preserves progression when recording statistics', async () => {
    const { repository, filePath } = await createRepository()
    const card = CARD_CATALOG.all.find(
      (card) => card.collectible && card.rarity === 'Common'
    )!
    await repository.rewardDust(reward('one'))
    await repository.rewardDust(reward('two'))
    const results = await Promise.allSettled([
      repository.changePremium(card.id, 'upgrade'),
      repository.changePremium(card.id, 'upgrade')
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    await repository.recordWin(asClassId('Mage'))
    await repository.recordTavernBrawlWin()
    expect(await new PlayerStatsRepository(filePath).getProgression()).toEqual({
      dust: 0,
      premiumPurchases: { [card.id]: 50 }
    })
  })

  it('keeps balances and receipts unchanged on failed writes and permits retry', async () => {
    const { repository } = await createRepository()
    await repository.getProgression()
    const write = vi
      .spyOn(atomicFile, 'replaceFileAtomically')
      .mockRejectedValueOnce(new Error('disk full'))
    await expect(repository.rewardDust(reward('retry'))).rejects.toThrow('disk full')
    expect((await repository.getProgression()).dust).toBe(0)
    await repository.rewardDust(reward('retry'))
    await repository.rewardDust(reward('second'))
    const card = CARD_CATALOG.all.find(
      (card) => card.collectible && card.rarity === 'Common'
    )!
    write.mockRejectedValueOnce(new Error('disk full'))
    await expect(repository.changePremium(card.id, 'upgrade')).rejects.toThrow(
      'disk full'
    )
    expect(await repository.getProgression()).toEqual({
      dust: 50,
      premiumPurchases: {}
    })
    await repository.changePremium(card.id, 'upgrade')
    write.mockRejectedValueOnce(new Error('disk full'))
    await expect(repository.changePremium(card.id, 'refund')).rejects.toThrow(
      'disk full'
    )
    expect(await repository.getProgression()).toEqual({
      dust: 0,
      premiumPurchases: { [card.id]: 50 }
    })
  })

  it('refunds the historical paid price even when current prices differ', async () => {
    const { repository, filePath } = await createRepository()
    await repository.recordWin(asClassId('Mage'))
    const saved = JSON.parse(await readFile(filePath, 'utf8'))
    const card = CARD_CATALOG.all.find(
      (card) => card.collectible && card.rarity === 'Legendary'
    )!
    saved.progression = { dust: 0, premiumPurchases: { [card.id]: 800 } }
    await writeFile(filePath, JSON.stringify(saved))
    expect(
      (await new PlayerStatsRepository(filePath).changePremium(card.id, 'refund')).dust
    ).toBe(800)
  })

  it('migrates version 2 saves without retroactive dust and refuses future versions', async () => {
    const { repository, filePath } = await createRepository()
    await repository.recordWin(asClassId('Mage'))
    const saved = JSON.parse(await readFile(filePath, 'utf8'))
    saved.version = 2
    delete saved.progression
    delete saved.dustRewards
    await writeFile(filePath, JSON.stringify(saved))
    const reloaded = new PlayerStatsRepository(filePath)
    expect(await reloaded.getProgression()).toEqual({ dust: 0, premiumPurchases: {} })
    expect((await reloaded.get()).winsByClass.Mage).toBe(1)
    saved.version = 99
    const source = JSON.stringify(saved)
    await writeFile(filePath, source)
    await expect(
      new PlayerStatsRepository(filePath).rewardDust(reward('future'))
    ).rejects.toThrow('Unsupported')
    expect(await readFile(filePath, 'utf8')).toBe(source)
  })
})

describe('Constructed ladder', () => {
  it('starts at rank 25 and applies one ladder step per result, idempotently per match', async () => {
    const { repository, filePath } = await createRepository()
    const initial = await repository.get()
    expect(initial.rank).toEqual({
      tier: 'rank',
      rank: 25,
      seasonKey: createSeasonKey(new Date())
    })

    await repository.recordConstructedResult({ matchId: 'm1', result: 'win' })
    await repository.recordConstructedResult({ matchId: 'm2', result: 'win' })
    await repository.recordConstructedResult({ matchId: 'm2', result: 'win' })
    expect((await repository.get()).rank).toEqual({
      tier: 'rank',
      rank: 23,
      seasonKey: createSeasonKey(new Date())
    })

    const reloaded = new PlayerStatsRepository(filePath)
    await reloaded.recordConstructedResult({ matchId: 'm2', result: 'win' })
    expect((await reloaded.get()).rank).toMatchObject({ tier: 'rank', rank: 23 })
    await reloaded.recordConstructedResult({ matchId: 'm3', result: 'draw' })
    expect((await reloaded.get()).rank).toMatchObject({ tier: 'rank', rank: 23 })
  })

  it('crosses into Legend and caps it, with defeat floors at rank 25 and Legend 999', async () => {
    const { repository } = await createRepository()
    for (let index = 0; index < 24; index++) {
      await repository.recordConstructedResult({ matchId: `w${index}`, result: 'win' })
    }
    expect((await repository.get()).rank).toEqual({
      tier: 'rank',
      rank: 1,
      seasonKey: createSeasonKey(new Date())
    })
    await repository.recordConstructedResult({ matchId: 'promo', result: 'win' })
    expect((await repository.get()).rank).toEqual({
      tier: 'legend',
      legendRank: 999,
      seasonKey: createSeasonKey(new Date())
    })
    await repository.recordConstructedResult({
      matchId: 'floor-loss',
      result: 'defeat'
    })
    expect((await repository.get()).rank).toMatchObject({
      tier: 'legend',
      legendRank: 999
    })
    await repository.recordConstructedResult({ matchId: 'climb', result: 'win' })
    expect((await repository.get()).rank).toMatchObject({
      tier: 'legend',
      legendRank: 998
    })
  })

  it('migrates version 4 saves with the default rank 25 entry state', async () => {
    const { repository, filePath, directory } = await createRepository()
    await repository.recordWin(asClassId('Mage'))
    const card = CARD_CATALOG.all.find(
      (entry) => entry.collectible && entry.rarity === 'Legendary'
    )!
    const saved = JSON.parse(await readFile(filePath, 'utf8'))
    saved.version = 4
    saved.progression = { dust: 490, premiumPurchases: { [card.id]: 200 } }
    saved.dustRewards = { 'legacy-win': 25 }
    saved.arenaRewards = {
      'legacy-run': {
        runId: 'legacy-run',
        wins: 6,
        prizes: [{ kind: 'dust', amount: 35 }]
      }
    }
    delete saved.rank
    delete saved.rankResults
    await writeFile(filePath, JSON.stringify(saved))
    const reloaded = new PlayerStatsRepository(filePath)
    expect((await reloaded.get()).rank).toMatchObject({ tier: 'rank', rank: 25 })
    expect((await reloaded.get()).winsByClass.Mage).toBe(1)
    expect(await reloaded.getProgression()).toEqual(saved.progression)
    await reloaded.recordConstructedResult({ matchId: 'm1', result: 'win' })
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    expect(persisted.version).toBe(5)
    expect(persisted.rank).toEqual({
      tier: 'rank',
      rank: 24,
      seasonKey: createSeasonKey(new Date())
    })
    expect(persisted.winsByClass.Mage).toBe(1)
    expect(persisted.tavernBrawlWins).toBe(saved.tavernBrawlWins)
    expect(persisted.progression).toEqual(saved.progression)
    expect(persisted.dustRewards).toEqual({ 'legacy-win': 25 })
    expect(persisted.arenaRewards).toEqual(saved.arenaRewards)
    const corruptBackup = (await readdir(directory)).find((name) =>
      name.startsWith('player-stats.json.corrupt-')
    )
    expect(corruptBackup).toBeUndefined()
  })

  it('resets a stale season back to rank 25 on read', async () => {
    const { repository, filePath } = await createRepository()
    await repository.recordConstructedResult({ matchId: 'm1', result: 'win' })
    const saved = JSON.parse(await readFile(filePath, 'utf8'))
    saved.rank = { tier: 'rank', rank: 5, seasonKey: '2000-01' }
    await writeFile(filePath, JSON.stringify(saved))
    expect(await new PlayerStatsRepository(filePath).get()).toMatchObject({
      rank: { tier: 'rank', rank: 25, seasonKey: createSeasonKey(new Date()) }
    })
  })

  it('overrides the rank outright in development and persists the override', async () => {
    const { repository, filePath } = await createRepository()
    await repository.setRank({ tier: 'legend', legendRank: 2, seasonKey: '2026-09' })
    expect((await repository.get()).rank).toEqual({
      tier: 'legend',
      legendRank: 2,
      seasonKey: '2026-09'
    })
    expect(await new PlayerStatsRepository(filePath).get().then((s) => s.rank)).toEqual(
      { tier: 'legend', legendRank: 2, seasonKey: '2026-09' }
    )
    expect(() =>
      repository.setRank({ tier: 'rank', rank: 26, seasonKey: '2026-09' })
    ).toThrow('Invalid constructed rank')
  })
})
