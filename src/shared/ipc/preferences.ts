export const PREFERENCES_IPC_CHANNELS = {
  get: 'preferences:get',
  set: 'preferences:set'
} as const

export interface Preferences {
  readonly lastPlayedDeckId: string | null
  readonly aiMode: AiMode
}

export type AiMode = 'hardware' | 'api'

export interface PreferencesUpdateRequest {
  readonly lastPlayedDeckId?: string | null
  readonly aiMode?: AiMode
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

export function parseAiMode(value: unknown): AiMode {
  if (value === 'hardware' || value === 'api') return value
  throw new Error('Invalid AI mode')
}

export function parsePreferences(value: unknown): Preferences {
  if (!isRecord(value)) throw new Error('Invalid preferences response')
  return {
    lastPlayedDeckId: parseLastPlayedDeckId(value.lastPlayedDeckId),
    aiMode: parseAiMode(value.aiMode)
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
    ...(value.aiMode === undefined ? {} : { aiMode: parseAiMode(value.aiMode) })
  }
}
