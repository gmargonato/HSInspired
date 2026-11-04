export const PREFERENCES_IPC_CHANNELS = {
  get: 'preferences:get',
  set: 'preferences:set'
} as const

export interface Preferences {
  readonly lastPlayedDeckId: string | null
  readonly cursorScale: number
  readonly enable3dElements: boolean
  readonly enableShadows: boolean
  readonly aiDifficulty: AiDifficulty
  readonly aiCheatsEnabled: boolean
}

export type AiDifficulty = 'easy' | 'expert'

export interface PreferencesUpdateRequest {
  readonly lastPlayedDeckId?: string | null
  readonly cursorScale?: number
  readonly enable3dElements?: boolean
  readonly enableShadows?: boolean
  readonly aiDifficulty?: AiDifficulty
  readonly aiCheatsEnabled?: boolean
}

export interface PreferencesApi {
  get(): Promise<Preferences>
  set(request: PreferencesUpdateRequest): Promise<Preferences>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseLastPlayedDeckId(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error('Invalid last played deck id')
}

export function parseAiDifficulty(value: unknown): AiDifficulty {
  if (value === 'easy' || value === 'expert') return value
  throw new Error('Invalid AI difficulty')
}

export function parseGraphicsEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid graphics setting')
  return value
}

export function parseAiCheatsEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid AI cheats setting')
  return value
}

export function parseCursorScale(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0.5 ||
    value > 1
  ) {
    throw new Error('Cursor scale must be between 0.5 and 1')
  }
  return value
}

export function parsePreferences(value: unknown): Preferences {
  if (!isRecord(value)) throw new Error('Invalid preferences response')
  return {
    enable3dElements:
      value.enable3dElements === undefined
        ? true
        : parseGraphicsEnabled(value.enable3dElements),
    enableShadows:
      value.enableShadows === undefined
        ? true
        : parseGraphicsEnabled(value.enableShadows),
    lastPlayedDeckId: parseLastPlayedDeckId(value.lastPlayedDeckId),
    cursorScale:
      value.cursorScale === undefined ? 1 : parseCursorScale(value.cursorScale),
    aiCheatsEnabled:
      value.aiCheatsEnabled === undefined
        ? true
        : parseAiCheatsEnabled(value.aiCheatsEnabled),
    aiDifficulty: parseAiDifficulty(value.aiDifficulty)
  }
}

export function parsePreferencesUpdateRequest(
  value: unknown
): PreferencesUpdateRequest {
  if (!isRecord(value)) throw new Error('Invalid preferences update request')
  return {
    ...(value.enable3dElements === undefined
      ? {}
      : { enable3dElements: parseGraphicsEnabled(value.enable3dElements) }),
    ...(value.enableShadows === undefined
      ? {}
      : { enableShadows: parseGraphicsEnabled(value.enableShadows) }),
    ...(value.lastPlayedDeckId === undefined
      ? {}
      : { lastPlayedDeckId: parseLastPlayedDeckId(value.lastPlayedDeckId) }),
    ...(value.cursorScale === undefined
      ? {}
      : { cursorScale: parseCursorScale(value.cursorScale) }),
    ...(value.aiDifficulty === undefined
      ? {}
      : { aiDifficulty: parseAiDifficulty(value.aiDifficulty) }),
    ...(value.aiCheatsEnabled === undefined
      ? {}
      : { aiCheatsEnabled: parseAiCheatsEnabled(value.aiCheatsEnabled) })
  }
}
