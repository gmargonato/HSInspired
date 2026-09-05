import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArenaRepository } from './arena-repository'

const temporaryDirectories: string[] = []

async function createRepository(): Promise<{
  repository: ArenaRepository
  filePath: string
}> {
  const directory = await mkdtemp(join(tmpdir(), 'hsinspired-arena-'))
  temporaryDirectories.push(directory)
  const filePath = join(directory, 'arena.json')
  return { repository: new ArenaRepository(filePath), filePath }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('ArenaRepository', () => {
  it('persists the exact current draft offer after every selection', async () => {
    const { repository, filePath } = await createRepository()
    const initial = await repository.get()
    const drafting = await repository.selectHero(initial.heroChoices[0])
    const afterPick = await repository.pickCard(drafting.cardChoices![1])

    const reloaded = await new ArenaRepository(filePath).get()
    expect(reloaded).toEqual(afterPick)
    expect(reloaded.picksCompleted).toBe(1)
    expect(JSON.parse(await readFile(filePath, 'utf8')).version).toBe(1)
  })

  it('completes a draft, records results, and resets on retirement', async () => {
    const { repository } = await createRepository()
    const initial = await repository.get()
    let run = await repository.selectHero(initial.heroChoices[0])
    while (run.phase === 'drafting') {
      run = await repository.pickCard(run.cardChoices![0])
    }

    expect(run.picksCompleted).toBe(30)
    await repository.recordResult('win')
    await repository.recordResult('defeat')
    const recorded = await repository.recordResult('draw')
    expect(recorded).toMatchObject({ gamesPlayed: 3, wins: 1, defeats: 1 })

    const retired = await repository.retire()
    expect(retired).toMatchObject({
      phase: 'choosing-hero',
      heroId: null,
      picksCompleted: 0,
      gamesPlayed: 0,
      wins: 0,
      defeats: 0
    })
    expect(new Set(retired.heroChoices)).toHaveLength(3)
    expect([...retired.heroChoices].sort()).not.toEqual([...initial.heroChoices].sort())
  })

  it('stops accepting results after twelve wins', async () => {
    const { repository } = await createRepository()
    const initial = await repository.get()
    let run = await repository.selectHero(initial.heroChoices[0])
    while (run.phase === 'drafting') {
      run = await repository.pickCard(run.cardChoices![0])
    }

    for (let win = 0; win < 12; win += 1) {
      run = await repository.recordResult('win')
    }

    expect(run).toMatchObject({ gamesPlayed: 12, wins: 12, defeats: 0 })
    await expect(repository.recordResult('defeat')).rejects.toThrow(
      'The Arena run is complete and must be retired.'
    )
    await expect(repository.get()).resolves.toMatchObject({
      gamesPlayed: 12,
      wins: 12,
      defeats: 0
    })
  })

  it('stops accepting results after three defeats while draws remain non-terminal', async () => {
    const { repository } = await createRepository()
    const initial = await repository.get()
    let run = await repository.selectHero(initial.heroChoices[0])
    while (run.phase === 'drafting') {
      run = await repository.pickCard(run.cardChoices![0])
    }

    await repository.recordResult('draw')
    for (let defeat = 0; defeat < 3; defeat += 1) {
      run = await repository.recordResult('defeat')
    }

    expect(run).toMatchObject({ gamesPlayed: 4, wins: 0, defeats: 3 })
    await expect(repository.recordResult('draw')).rejects.toThrow(
      'The Arena run is complete and must be retired.'
    )
  })
})
