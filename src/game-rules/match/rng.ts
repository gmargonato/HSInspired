export interface DeterministicRng {
  next(): number
  /** Transaction hooks are mandatory so every command can roll back randomness. */
  snapshot(): unknown
  restore(snapshot: unknown): void
}

/** Small explicit RNG boundary for deterministic simulation and tests. */
export function createSeededRng(seed = 0x6d2b79f5): DeterministicRng {
  let state = seed >>> 0
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0
      let value = state
      value = Math.imul(value ^ (value >>> 15), value | 1)
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
      return ((value ^ (value >>> 14)) >>> 0) / 0x100000000
    },
    snapshot(): number {
      return state
    },
    restore(snapshot: unknown): void {
      if (
        typeof snapshot !== 'number' ||
        !Number.isInteger(snapshot) ||
        snapshot < 0 ||
        snapshot > 0xffffffff
      ) {
        throw new Error('Invalid seeded RNG snapshot.')
      }
      state = snapshot >>> 0
    }
  }
}

export function collectRandomSequence(
  rng: DeterministicRng,
  length: number
): readonly number[] {
  if (!Number.isInteger(length) || length < 0)
    throw new Error('Sequence length must be non-negative')
  return Array.from({ length }, () => rng.next())
}
