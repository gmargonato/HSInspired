import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { asClassId } from '../../game/content/cards'
import { PlayerStatsRepository } from './player-stats-repository'

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
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('PlayerStatsRepository', () => {
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
    expect(persisted).toMatchObject({ version: 2, tavernBrawlWins: 1 })
  })

  it('falls back to zero totals when saved data is malformed', async () => {
    const { filePath } = await createRepository()
    await writeFile(filePath, '{not valid json', 'utf8')

    const snapshot = await new PlayerStatsRepository(filePath).get()

    expect(snapshot.winsByClass.Mage).toBe(0)
    expect(snapshot.tavernBrawlWins).toBe(0)
  })
})
