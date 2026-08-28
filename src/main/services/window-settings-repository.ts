import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  isWindowResolutionPreset,
  type WindowResolution
} from '../../shared/ipc/window-settings'

const WINDOW_SETTINGS_FILE_VERSION = 1

interface PersistedWindowSettings {
  readonly version: typeof WINDOW_SETTINGS_FILE_VERSION
  readonly resolution: WindowResolution
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function cloneResolution(resolution: WindowResolution): WindowResolution {
  return { width: resolution.width, height: resolution.height }
}

/** Small main-process repository for the player's selected window preset. */
export class WindowSettingsRepository {
  private resolution: WindowResolution | null = null
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async getResolution(): Promise<WindowResolution | null> {
    await this.ensureLoaded()
    return this.resolution ? cloneResolution(this.resolution) : null
  }

  async setResolution(resolution: WindowResolution): Promise<void> {
    if (!isWindowResolutionPreset(resolution)) {
      throw new Error('Cannot persist an unsupported window resolution')
    }
    await this.ensureLoaded()
    await this.persist(resolution)
    this.resolution = cloneResolution(resolution)
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.readPersistedSettings().finally(() => {
      this.loadPromise = null
    })
    return this.loadPromise
  }

  private async readPersistedSettings(): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        this.loaded = true
        return
      }
      console.warn('Could not read saved window settings; using a safe default.', error)
      this.loaded = true
      return
    }

    if (
      isRecord(parsed) &&
      parsed.version === WINDOW_SETTINGS_FILE_VERSION &&
      isWindowResolutionPreset(parsed.resolution)
    ) {
      this.resolution = cloneResolution(parsed.resolution)
    } else {
      console.warn('Saved window settings were invalid; using a safe default.')
    }
    this.loaded = true
  }

  private async persist(resolution: WindowResolution): Promise<void> {
    const payload: PersistedWindowSettings = {
      version: WINDOW_SETTINGS_FILE_VERSION,
      resolution: cloneResolution(resolution)
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
