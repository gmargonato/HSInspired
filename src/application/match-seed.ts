/** Generates a session seed without making randomness part of game rules. */
export function createMatchSeed(): number {
  const cryptoProvider = globalThis.crypto
  if (cryptoProvider) {
    const values = new Uint32Array(1)
    cryptoProvider.getRandomValues(values)
    return values[0] ?? 0
  }
  return Date.now() >>> 0
}
