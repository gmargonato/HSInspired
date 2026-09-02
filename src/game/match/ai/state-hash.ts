const OMITTED_KEYS = new Set([
  'instanceId',
  'creationOrdinal',
  'playOrder',
  'revision',
  'nextEntityOrdinal',
  'effectTrace'
])

function canonicalize(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) {
    const entries = value.map((entry) => canonicalize(entry, parentKey))
    if (parentKey === 'deck' || parentKey === 'hand' || parentKey === 'secrets') {
      return entries.sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      )
    }
    return entries
  }
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !OMITTED_KEYS.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested, key)])
  )
}

/** Stable FNV-1a hash over strategically equivalent state data. */
export function hashAiState(value: unknown): string {
  const text = JSON.stringify(canonicalize(value))
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export class AiTranspositionCache<T> {
  private readonly entries = new Map<string, T>()
  private hits = 0

  constructor(readonly capacity = 50_000) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('AI transposition capacity must be a positive integer.')
    }
  }

  get size(): number {
    return this.entries.size
  }

  get hitCount(): number {
    return this.hits
  }

  get(key: string): T | undefined {
    const value = this.entries.get(key)
    if (value !== undefined) {
      this.hits += 1
      this.entries.delete(key)
      this.entries.set(key, value)
    }
    return value
  }

  set(key: string, value: T): void {
    if (this.entries.has(key)) this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  retainReachable(keys: ReadonlySet<string>): void {
    for (const key of this.entries.keys()) {
      if (!keys.has(key)) this.entries.delete(key)
    }
  }

  clear(): void {
    this.entries.clear()
    this.hits = 0
  }
}
