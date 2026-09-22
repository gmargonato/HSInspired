import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  parseAiMode,
  parseLastPlayedDeckId,
  type AiMode,
  type Preferences
} from '../../shared/ipc/preferences'

const PREFERENCES_FILE_VERSION = 2

interface PersistedPreferences {
  readonly version: typeof PREFERENCES_FILE_VERSION
  readonly lastPlayedDeckId: string | null
  readonly aiMode: AiMode
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function clonePreferences(preferences: Preferences): Preferences {
  return { lastPlayedDeckId: preferences.lastPlayedDeckId, aiMode: preferences.aiMode }
}

/** Small main-process repository for app-level player preferences. */
export class PreferencesRepository {
  private preferences: Preferences | null = null
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async get(): Promise<Preferences> {
    await this.ensureLoaded()
    return clonePreferences(
      this.preferences ?? { lastPlayedDeckId: null, aiMode: 'api' }
    )
  }

  async set(preferences: Preferences): Promise<void> {
    parseLastPlayedDeckId(preferences.lastPlayedDeckId)
    parseAiMode(preferences.aiMode)
    await this.ensureLoaded()
    await this.persist(preferences)
    this.preferences = clonePreferences(preferences)
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.readPersistedPreferences().finally(() => {
      this.loadPromise = null
    })
    return this.loadPromise
  }

  private async readPersistedPreferences(): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        this.loaded = true
        return
      }
      console.warn('Could not read saved preferences; using safe defaults.', error)
      this.loaded = true
      return
    }

    if (
      isRecord(parsed) &&
      (parsed.version === 1 || parsed.version === PREFERENCES_FILE_VERSION)
    ) {
      try {
        this.preferences = {
          lastPlayedDeckId: parseLastPlayedDeckId(parsed.lastPlayedDeckId),
          aiMode:
            parsed.version === 1
              ? 'api'
              : parsed.aiMode === 'hardware' || parsed.aiMode === 'api'
                ? parsed.aiMode
                : 'api'
        }
      } catch {
        console.warn('Saved preferences were invalid; using safe defaults.')
      }
    } else {
      console.warn('Saved preferences were invalid; using safe defaults.')
    }
    this.loaded = true
  }

  private async persist(preferences: Preferences): Promise<void> {
    const payload: PersistedPreferences = {
      version: PREFERENCES_FILE_VERSION,
      lastPlayedDeckId: preferences.lastPlayedDeckId,
      aiMode: preferences.aiMode
    }
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    const write = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true })
        try {
          await writeFile(
            temporaryPath,
            `${JSON.stringify(payload, null, 2)}\n`,
            'utf8'
          )
          await rename(temporaryPath, this.filePath)
        } finally {
          await unlink(temporaryPath).catch(() => undefined)
        }
      })
    this.writeQueue = write
    await write
  }
}
