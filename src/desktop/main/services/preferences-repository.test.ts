import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parsePreferences,
  parsePreferencesUpdateRequest
} from '../../contracts/ipc/preferences'
import { PreferencesRepository } from './preferences-repository'

const temporaryDirectories: string[] = []

async function createRepository(): Promise<{
  readonly directory: string
  readonly filePath: string
  readonly repository: PreferencesRepository
}> {
  const directory = await mkdtemp(join(tmpdir(), 'hsinspired-preferences-'))
  temporaryDirectories.push(directory)
  const filePath = join(directory, 'preferences.json')
  return {
    directory,
    filePath,
    repository: new PreferencesRepository(filePath)
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('PreferencesRepository', () => {
  it('persists cursor size without changing other preferences', async () => {
    const { repository, filePath } = await createRepository()
    await repository.set({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'hardware-v2',
      cursorScale: 0.75
    })
    expect(await new PreferencesRepository(filePath).get()).toEqual({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'hardware-v2',
      cursorScale: 0.75
    })
  })

  it.each([undefined, null, '2', 0.25, 1.5, 2, 3])(
    'defaults invalid stored scale %s without losing preferences',
    async (cursorScale) => {
      const { repository, filePath } = await createRepository()
      await writeFile(
        filePath,
        JSON.stringify({
          version: 2,
          lastPlayedDeckId: 'deck-123',
          aiMode: 'hardware-v2',
          cursorScale
        })
      )
      expect(await repository.get()).toEqual({
        lastPlayedDeckId: 'deck-123',
        aiMode: 'hardware-v2',
        cursorScale: 1
      })
    }
  )

  it('validates cursor scale updates', () => {
    for (const cursorScale of [0.5, 0.75, 1]) {
      expect(parsePreferencesUpdateRequest({ cursorScale })).toEqual({ cursorScale })
    }
    for (const cursorScale of [0.25, 1.5, 2, NaN, Infinity, '2', null]) {
      expect(() => parsePreferencesUpdateRequest({ cursorScale })).toThrow()
    }
  })

  it('starts with no last played deck when no file exists', async () => {
    const { repository } = await createRepository()

    expect(await repository.get()).toEqual({
      lastPlayedDeckId: null,
      aiMode: 'api',
      cursorScale: 1
    })
  })

  it('persists the last played deck id across repository reloads', async () => {
    const { repository, filePath } = await createRepository()

    await repository.set({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'api',
      cursorScale: 1
    })
    expect(await new PreferencesRepository(filePath).get()).toEqual({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'api',
      cursorScale: 1
    })
  })

  it('clears the last played deck id back to null', async () => {
    const { repository, filePath } = await createRepository()

    await repository.set({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'hardware',
      cursorScale: 1
    })
    await repository.set({ lastPlayedDeckId: null, aiMode: 'hardware', cursorScale: 1 })

    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    expect(persisted.version).toBe(2)
    expect(await new PreferencesRepository(filePath).get()).toEqual({
      lastPlayedDeckId: null,
      aiMode: 'hardware',
      cursorScale: 1
    })
  })

  it('persists Expert AI mode across repository reloads', async () => {
    const { repository, filePath } = await createRepository()

    await repository.set({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'hardware-v2',
      cursorScale: 1
    })

    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({
      version: 2,
      aiMode: 'hardware-v2',
      cursorScale: 1
    })
    expect(await new PreferencesRepository(filePath).get()).toEqual({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'hardware-v2',
      cursorScale: 1
    })
  })

  it('ignores the retired deck strategy preference while preserving current settings', async () => {
    const { repository, filePath } = await createRepository()
    await writeFile(
      filePath,
      JSON.stringify({
        version: 2,
        lastPlayedDeckId: 'deck-123',
        aiMode: 'hardware-v2',
        expertDeckStrategyEnabled: false
      }),
      'utf8'
    )

    const preferences = await repository.get()
    expect(preferences).toEqual({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'hardware-v2',
      cursorScale: 1
    })
    expect(parsePreferencesUpdateRequest({ expertDeckStrategyEnabled: false })).toEqual(
      {}
    )
    await repository.set(preferences)
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({
      version: 2,
      ...preferences
    })
  })

  it('rejects invalid deck ids without modifying the saved file', async () => {
    const { repository, filePath } = await createRepository()
    await repository.set({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'api',
      cursorScale: 1
    })
    const saved = await readFile(filePath, 'utf8')

    await expect(
      repository.set({ lastPlayedDeckId: '', aiMode: 'api', cursorScale: 1 })
    ).rejects.toThrow()
    await expect(
      repository.set({
        lastPlayedDeckId: '   ' as string,
        aiMode: 'api',
        cursorScale: 1
      })
    ).rejects.toThrow()
    expect(await repository.get()).toEqual({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'api',
      cursorScale: 1
    })
    expect(await readFile(filePath, 'utf8')).toBe(saved)
  })

  it('falls back to safe defaults when saved data is malformed', async () => {
    const { filePath, repository } = await createRepository()
    await writeFile(filePath, '{not valid json', 'utf8')

    expect(await repository.get()).toEqual({
      lastPlayedDeckId: null,
      aiMode: 'api',
      cursorScale: 1
    })
    await repository.set({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'api',
      cursorScale: 1
    })
    expect(await new PreferencesRepository(filePath).get()).toEqual({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'api',
      cursorScale: 1
    })
  })

  it('falls back to safe defaults when the last played id is not a string', async () => {
    const { filePath } = await createRepository()
    await writeFile(
      filePath,
      JSON.stringify({ version: 1, lastPlayedDeckId: 42 }),
      'utf8'
    )

    expect(await new PreferencesRepository(filePath).get()).toEqual({
      lastPlayedDeckId: null,
      aiMode: 'api',
      cursorScale: 1
    })
  })

  it('migrates version 1 preferences and preserves the deck id', async () => {
    const { filePath, repository } = await createRepository()
    await writeFile(
      filePath,
      JSON.stringify({ version: 1, lastPlayedDeckId: 'deck-123' }),
      'utf8'
    )

    expect(await repository.get()).toEqual({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'api',
      cursorScale: 1
    })
    await repository.set({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'hardware',
      cursorScale: 1
    })
    expect(await new PreferencesRepository(filePath).get()).toEqual({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'hardware',
      cursorScale: 1
    })
  })

  it('falls back to API for an invalid saved AI mode without losing the deck id', async () => {
    const { filePath, repository } = await createRepository()
    await writeFile(
      filePath,
      JSON.stringify({ version: 2, lastPlayedDeckId: 'deck-123', aiMode: 'unknown' }),
      'utf8'
    )

    expect(await repository.get()).toEqual({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'api',
      cursorScale: 1
    })
  })

  it('accepts all AI modes in preferences requests and responses', () => {
    for (const aiMode of ['hardware', 'hardware-v2', 'api'] as const) {
      expect(parsePreferencesUpdateRequest({ aiMode })).toEqual({ aiMode })
      expect(parsePreferences({ lastPlayedDeckId: null, aiMode })).toEqual({
        lastPlayedDeckId: null,
        aiMode,
        cursorScale: 1
      })
    }
    expect(() => parsePreferencesUpdateRequest({ aiMode: 'unknown' })).toThrow()
    expect(() =>
      parsePreferences({ lastPlayedDeckId: null, aiMode: 'unknown' })
    ).toThrow()
  })
})
