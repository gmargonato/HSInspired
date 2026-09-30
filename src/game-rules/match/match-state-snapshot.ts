import type { OpeningMatchState } from './opening-match-types'

export function cloneUnknown<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => cloneUnknown(entry)) as T
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>))
    result[key] = cloneUnknown(nested)
  return result as T
}

export function cloneOpeningMatchState(state: OpeningMatchState): OpeningMatchState {
  return cloneUnknown(state)
}
