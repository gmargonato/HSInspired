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
  it('starts with no last played deck when no file exists', async () => {
    const { repository } = await createRepository()

    expect(await repository.get()).toEqual({ lastPlayedDeckId: null, aiMode: 'api' })
  })

  it('persists the last played deck id across repository reloads', async () => {
    const { repository, filePath } = await createRepository()

    await repository.set({ lastPlayedDeckId: 'deck-123', aiMode: 'api' })
    expect(await new PreferencesRepository(filePath).get()).toEqual({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'api'
    })
  })

  it('clears the last played deck id back to null', async () => {
    const { repository, filePath } = await createRepository()

    await repository.set({ lastPlayedDeckId: 'deck-123', aiMode: 'hardware' })
    await repository.set({ lastPlayedDeckId: null, aiMode: 'hardware' })

    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    expect(persisted.version).toBe(2)
    expect(await new PreferencesRepository(filePath).get()).toEqual({
      lastPlayedDeckId: null,
      aiMode: 'hardware'
    })
  })

  it('persists Expert AI mode across repository reloads', async () => {
    const { repository, filePath } = await createRepository()

    await repository.set({ lastPlayedDeckId: 'deck-123', aiMode: 'hardware-v2' })

    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({
      version: 2,
      aiMode: 'hardware-v2'
    })
    expect(await new PreferencesRepository(filePath).get()).toEqual({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'hardware-v2'
    })
  })

  it('rejects invalid deck ids without modifying the saved file', async () => {
    const { repository, filePath } = await createRepository()
    await repository.set({ lastPlayedDeckId: 'deck-123', aiMode: 'api' })
    const saved = await readFile(filePath, 'utf8')

    await expect(
      repository.set({ lastPlayedDeckId: '', aiMode: 'api' })
    ).rejects.toThrow()
    await expect(
      repository.set({ lastPlayedDeckId: '   ' as string, aiMode: 'api' })
    ).rejects.toThrow()
    expect(await repository.get()).toEqual({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'api'
    })
    expect(await readFile(filePath, 'utf8')).toBe(saved)
  })

  it('falls back to safe defaults when saved data is malformed', async () => {
    const { filePath, repository } = await createRepository()
    await writeFile(filePath, '{not valid json', 'utf8')

    expect(await repository.get()).toEqual({ lastPlayedDeckId: null, aiMode: 'api' })
    await repository.set({ lastPlayedDeckId: 'deck-123', aiMode: 'api' })
    expect(await new PreferencesRepository(filePath).get()).toEqual({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'api'
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
      aiMode: 'api'
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
      aiMode: 'api'
    })
    await repository.set({ lastPlayedDeckId: 'deck-123', aiMode: 'hardware' })
    expect(await new PreferencesRepository(filePath).get()).toEqual({
      lastPlayedDeckId: 'deck-123',
      aiMode: 'hardware'
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
      aiMode: 'api'
    })
  })

  it('accepts all AI modes in preferences requests and responses', () => {
    for (const aiMode of ['hardware', 'hardware-v2', 'api'] as const) {
      expect(parsePreferencesUpdateRequest({ aiMode })).toEqual({ aiMode })
      expect(parsePreferences({ lastPlayedDeckId: null, aiMode })).toEqual({
        lastPlayedDeckId: null,
        aiMode
      })
    }
    expect(() => parsePreferencesUpdateRequest({ aiMode: 'unknown' })).toThrow()
    expect(() =>
      parsePreferences({ lastPlayedDeckId: null, aiMode: 'unknown' })
    ).toThrow()
  })
})
