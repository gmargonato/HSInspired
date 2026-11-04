export const PREFERENCES_IPC_CHANNELS = {
  get: 'preferences:get',
  set: 'preferences:set'
} as const

export interface Preferences {
  readonly lastPlayedDeckId: string | null
  readonly cursorScale: number
  readonly aiDifficulty: AiDifficulty
  readonly aiCheatsEnabled: boolean
}

export type AiDifficulty = 'easy' | 'expert'

export interface PreferencesUpdateRequest {
  readonly lastPlayedDeckId?: string | null
  readonly cursorScale?: number
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
