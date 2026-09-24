import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MatchLogRepository } from './match-log-repository'

describe('match log model attribution', () => {
  it('records the responding model, not the configured API model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
    try {
      const repository = new MatchLogRepository(root)
      await repository.initialize()
      const matchId = await repository.start(7, {
        aiConfig: { modelId: 'gpt-5.4-nano' }
      })
      const directoryName = (await readdir(root))[0]!
      const summaryPath = join(root, directoryName, 'ai.json')
      const started = JSON.parse(await readFile(summaryPath, 'utf8')) as Record<
        string,
        unknown
      >
      expect(started).toMatchObject({
        model: null,
        configuredModel: 'gpt-5.4-nano'
      })

      await repository.append(matchId, {
        stream: 'decisions',
        kind: 'response-received',
        timestamp: new Date().toISOString(),
        data: { modelId: 'hardware-local-v2' }
      })
      await repository.finish(matchId, 'abandoned')

      const finished = JSON.parse(await readFile(summaryPath, 'utf8')) as Record<
        string,
        unknown
      >
      expect(finished).toMatchObject({
        model: 'hardware-local-v2',
        modelsUsed: ['hardware-local-v2'],
        configuredModel: 'gpt-5.4-nano'
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not claim an AI model when no response was received', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
    try {
      const repository = new MatchLogRepository(root)
      await repository.initialize()
      const matchId = await repository.start(7, {
        aiConfig: { modelId: 'gpt-5.4-nano' }
      })
      const directoryName = (await readdir(root))[0]!
      await repository.finish(matchId, 'abandoned')
      const summary = JSON.parse(
        await readFile(join(root, directoryName, 'ai.json'), 'utf8')
      ) as Record<string, unknown>
      expect(summary).toMatchObject({ model: null, configuredModel: 'gpt-5.4-nano' })
      expect(summary).not.toHaveProperty('modelsUsed')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
