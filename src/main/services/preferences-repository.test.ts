import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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

    expect(await repository.get()).toEqual({ lastPlayedDeckId: null })
  })

  it('persists the last played deck id across repository reloads', async () => {
    const { repository, filePath } = await createRepository()

    await repository.set({ lastPlayedDeckId: 'deck-123' })
    expect(await new PreferencesRepository(filePath).get()).toEqual({
      lastPlayedDeckId: 'deck-123'
    })
  })

  it('clears the last played deck id back to null', async () => {
    const { repository, filePath } = await createRepository()

    await repository.set({ lastPlayedDeckId: 'deck-123' })
    await repository.set({ lastPlayedDeckId: null })

    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    expect(persisted.version).toBe(1)
    expect(await new PreferencesRepository(filePath).get()).toEqual({
      lastPlayedDeckId: null
    })
  })

  it('rejects invalid deck ids without modifying the saved file', async () => {
    const { repository, filePath } = await createRepository()
    await repository.set({ lastPlayedDeckId: 'deck-123' })
    const saved = await readFile(filePath, 'utf8')

    await expect(repository.set({ lastPlayedDeckId: '' })).rejects.toThrow()
    await expect(
      repository.set({ lastPlayedDeckId: '   ' as string })
    ).rejects.toThrow()
    expect(await repository.get()).toEqual({ lastPlayedDeckId: 'deck-123' })
    expect(await readFile(filePath, 'utf8')).toBe(saved)
  })

  it('falls back to safe defaults when saved data is malformed', async () => {
    const { filePath, repository } = await createRepository()
    await writeFile(filePath, '{not valid json', 'utf8')

    expect(await repository.get()).toEqual({ lastPlayedDeckId: null })
    await repository.set({ lastPlayedDeckId: 'deck-123' })
    expect(await new PreferencesRepository(filePath).get()).toEqual({
      lastPlayedDeckId: 'deck-123'
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
      lastPlayedDeckId: null
    })
  })
})
