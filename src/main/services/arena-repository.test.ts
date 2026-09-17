import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as atomicFile from './atomic-file'
import { parseArenaRunSnapshot } from '../../shared/ipc/arena'
import { parseArenaRewardReceipt } from '../../shared/ipc/arena-rewards'
import { ArenaRepository } from './arena-repository'
import { PlayerStatsRepository } from './player-stats-repository'

const temporaryDirectories: string[] = []

async function createRepository(): Promise<{
  repository: ArenaRepository
  filePath: string
}> {
  const directory = await mkdtemp(join(tmpdir(), 'hsinspired-arena-'))
  temporaryDirectories.push(directory)
  const filePath = join(directory, 'arena.json')
  return {
    repository: new ArenaRepository(
      filePath,
      new PlayerStatsRepository(join(directory, 'stats.json'))
    ),
    filePath
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

async function playedRun(repository: ArenaRepository) {
  const initial = await repository.get()
  let run = await repository.selectHero(initial.heroChoices[0])
  while (run.phase === 'drafting') run = await repository.pickCard(run.cardChoices![0])
  return repository.recordResult('defeat')
}

describe('Arena claim recovery', () => {
  it('edits scores, preserves draws, persists, and reopens completed runs', async () => {
    const { repository, filePath } = await createRepository()
    const run = await playedRun(repository)
    await repository.recordResult('draw')
    const completed = await repository.devSetScore({
      runId: run.runId,
      counter: 'wins',
      value: 12
    })
    expect(completed).toMatchObject({
      wins: 12,
      defeats: 1,
      gamesPlayed: 14,
      rewards: null
    })
    expect(await new ArenaRepository(filePath).get()).toEqual(completed)
    await expect(repository.recordResult('win')).rejects.toThrow('complete')
    await repository.devSetScore({ runId: run.runId, counter: 'wins', value: 0 })
    await repository.devSetScore({ runId: run.runId, counter: 'defeats', value: 3 })
    await expect(repository.recordResult('win')).rejects.toThrow('complete')
    const reopened = await repository.devSetScore({
      runId: run.runId,
      counter: 'defeats',
      value: 0
    })
    expect(reopened).toMatchObject({ wins: 0, defeats: 0, gamesPlayed: 1 })
    expect((await repository.recordResult('win')).wins).toBe(1)
  })

  it('rejects invalid, stale, drafting, and already-claimed score edits', async () => {
    const { repository } = await createRepository()
    const initial = await repository.get()
    const request = { runId: initial.runId, counter: 'wins' as const, value: 1 }
    await expect(repository.devSetScore(request)).rejects.toThrow('not complete')
    await repository.selectHero(initial.heroChoices[0])
    await expect(repository.devSetScore(request)).rejects.toThrow('not complete')
    for (const value of [-1, 0.5, 13, Infinity])
      await expect(repository.devSetScore({ ...request, value })).rejects.toThrow()
    await expect(
      repository.devSetScore({ ...request, counter: 'defeats', value: 4 })
    ).rejects.toThrow()
    await expect(
      repository.devSetScore({ ...request, runId: 'stale-run' })
    ).rejects.toThrow('no longer current')
    let run = await repository.get()
    while (run.phase === 'drafting')
      run = await repository.pickCard(run.cardChoices![0])
    const scored = await repository.devSetScore({ ...request, value: 12 })
    expect(scored.gamesPlayed).toBe(12)
    const claimed = await repository.retire(run.runId)
    expect(claimed.rewards?.wins).toBe(12)
    await expect(repository.devSetScore(request)).rejects.toThrow('pending')
    expect((await repository.retire(run.runId)).rewards).toEqual(claimed.rewards)
  })

  it('leaves the saved and in-memory run unchanged after a score save failure', async () => {
    const { repository, filePath } = await createRepository()
    const run = await playedRun(repository)
    vi.spyOn(atomicFile, 'replaceFileAtomically').mockRejectedValueOnce(
      new Error('score save failure')
    )
    await expect(
      repository.devSetScore({ runId: run.runId, counter: 'wins', value: 5 })
    ).rejects.toThrow('score save failure')
    expect(await repository.get()).toEqual(run)
    expect(await new ArenaRepository(filePath).get()).toEqual(run)
  })

  it('resets an unplayed draft without rewards and rejects stale claims', async () => {
    const { repository } = await createRepository()
    const initial = await repository.get()
    await repository.selectHero(initial.heroChoices[0])
    const next = await repository.retire(initial.runId)
    expect(next.rewards).toBeNull()
    expect(next.phase).toBe('choosing-hero')
    expect(next.runId).not.toBe(initial.runId)
    await expect(repository.retire(initial.runId)).rejects.toThrow('no longer current')
  })

  it.each(['intent', 'credit', 'receipt'] as const)(
    'recovers after a failed %s save without duplicate rewards',
    async (boundary) => {
      const { filePath } = await createRepository()
      const statsPath = `${filePath}.stats`
      const stats = new PlayerStatsRepository(statsPath)
      const arena = new ArenaRepository(filePath, stats)
      const run = await playedRun(arena)
      const replace = atomicFile.replaceFileAtomically
      let failed = false
      vi.spyOn(atomicFile, 'replaceFileAtomically').mockImplementation(
        async (path, temporary, serialize) => {
          const data = JSON.parse(serialize())
          const shouldFail =
            boundary === 'intent'
              ? path === filePath && data.pendingClaim
              : boundary === 'credit'
                ? path === statsPath
                : path === filePath && data.run?.rewards
          if (shouldFail && !failed) {
            failed = true
            throw new Error('Injected write failure')
          }
          return replace(path, temporary, serialize)
        }
      )
      await expect(arena.retire(run.runId)).rejects.toThrow('Injected')
      if (boundary !== 'intent')
        await expect(arena.recordResult('win')).rejects.toThrow('pending')
      vi.restoreAllMocks()
      const reloadedStats = new PlayerStatsRepository(statsPath)
      const reloaded = new ArenaRepository(filePath, reloadedStats)
      let recovered = await reloaded.get()
      if (boundary === 'intent') {
        expect(recovered.rewards).toBeNull()
        recovered = await reloaded.retire(run.runId)
      }
      expect(recovered.rewards?.prizes).toHaveLength(1)
      const credited = await reloadedStats.getProgression()
      const [first, second] = await Promise.all([
        reloaded.retire(run.runId),
        reloaded.retire(run.runId)
      ])
      expect(first.rewards).toEqual(recovered.rewards)
      expect(second.rewards).toEqual(recovered.rewards)
      expect(await reloadedStats.getProgression()).toEqual(credited)
      await expect(reloaded.recordResult('win')).rejects.toThrow('pending')
      const fresh = await reloaded.acknowledgeRewards(run.runId)
      expect(await reloaded.acknowledgeRewards(run.runId)).toEqual(fresh)
      expect(await reloadedStats.getProgression()).toEqual(credited)
      expect((await new ArenaRepository(filePath, reloadedStats).get()).runId).toBe(
        fresh.runId
      )
    }
  )

  it('keeps the receipt when acknowledgement saving fails', async () => {
    const { repository, filePath } = await createRepository()
    const run = await playedRun(repository)
    const claimed = await repository.retire(run.runId)
    vi.spyOn(atomicFile, 'replaceFileAtomically').mockRejectedValueOnce(
      new Error('ack failure')
    )
    await expect(repository.acknowledgeRewards(run.runId)).rejects.toThrow(
      'ack failure'
    )
    expect((await new ArenaRepository(filePath).get()).rewards).toEqual(claimed.rewards)
    vi.restoreAllMocks()
    expect((await repository.acknowledgeRewards(run.runId)).phase).toBe('choosing-hero')
  })

  it('migrates a legacy draft once and preserves future versions', async () => {
    const { repository, filePath } = await createRepository()
    const run = await repository.get()
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        run: { ...run, runId: undefined, rewards: undefined }
      })
    )
    const migrated = await new ArenaRepository(filePath).get()
    expect(migrated.heroChoices).toEqual(run.heroChoices)
    expect(migrated.runId).not.toBe(run.runId)
    expect(await new ArenaRepository(filePath).get()).toEqual(migrated)
    const future = JSON.stringify({ version: 99, run })
    await writeFile(filePath, future)
    await expect(new ArenaRepository(filePath).get()).rejects.toThrow('Unsupported')
    expect(await readFile(filePath, 'utf8')).toBe(future)
  })

  it('validates reward IPC receipts and copies nested prizes', async () => {
    const { repository } = await createRepository()
    const run = await playedRun(repository)
    const claimed = await repository.retire(run.runId)
    const parsed = parseArenaRunSnapshot(claimed)
    expect(parsed).toEqual(claimed)
    expect(parsed.rewards).not.toBe(claimed.rewards)
    expect(() =>
      parseArenaRunSnapshot({
        ...claimed,
        rewards: { ...claimed.rewards, runId: 'wrong-run' }
      })
    ).toThrow()
    expect(() =>
      parseArenaRewardReceipt({
        runId: 'run',
        wins: 12,
        prizes: [{ kind: 'dust', amount: -1 }]
      })
    ).toThrow()
  })
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
    expect(JSON.parse(await readFile(filePath, 'utf8')).version).toBe(2)
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

    const claimed = await repository.retire(recorded.runId)
    expect(claimed.rewards?.prizes).toHaveLength(2)
    const retired = await repository.acknowledgeRewards(recorded.runId)
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
