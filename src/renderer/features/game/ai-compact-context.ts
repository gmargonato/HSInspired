import type { JsonValue } from '../../../shared/ipc/ai'

// Compact notation keeps conditions, targets, amounts and timing, including custom rules.
export function mechanicsText(value: JsonValue): string {
  if (Array.isArray(value)) return value.map(mechanicsText).join('; ')
  if (value && typeof value === 'object')
    return Object.entries(value)
      .map(
        ([key, nested]) =>
          key +
          ': ' +
          (nested && typeof nested === 'object'
            ? '(' + mechanicsText(nested) + ')'
            : mechanicsText(nested))
      )
      .join(', ')
  return String(value)
}

/** Remove catalog/presentation metadata, preserving executable mechanics and zero costs/stats. */
export function compactAiFacts(value: unknown): JsonValue {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return value as string | number | boolean
  if (Array.isArray(value)) return value.map(compactAiFacts)
  const entry = value as Record<string, unknown>
  const definition = typeof entry.name === 'string' && typeof entry.id === 'string'
  const metadata = new Set([
    'expansionId',
    'set',
    'collectible',
    'deckLegal',
    'presentationAssetKey',
    'presentationCardId',
    'presentationHeroPowerId',
    'creationOrdinal',
    'playOrder',
    'schemaVersion',
    'informationPolicy'
  ])
  const inactiveNumbers = new Set([
    'spellDamage',
    'damageTaken',
    'overload',
    'overloadLocked',
    'overloadNextTurn',
    'usesThisTurn'
  ])
  const multipliers = new Set([
    'damageTakenMultiplier',
    'spellDamageMultiplier',
    'healingMultiplier',
    'heroPowerMultiplier'
  ])
  return Object.fromEntries(
    Object.entries(entry).flatMap(([key, original]) => {
      if (
        (metadata.has(key) &&
          (definition ||
            !['expansionId', 'set', 'collectible', 'deckLegal'].includes(key))) ||
        (definition && key === 'rarity' && original !== 'Legendary')
      )
        return []
      if (original === undefined || original === null) return []
      if (
        original === false &&
        [
          'immune',
          'spellImmune',
          'silenced',
          'divineShield',
          'divineShieldConsumed',
          'stealth',
          'stealthRevealed'
        ].includes(key)
      )
        return []
      if (inactiveNumbers.has(key) && original === 0) return []
      if (multipliers.has(key) && original === 1) return []
      const nested = compactAiFacts(original)
      if (nested && typeof nested === 'object' && !Object.keys(nested).length) return []
      if (definition && key === 'effects') return [['mechanics', mechanicsText(nested)]]
      return [[key, nested]]
    })
  )
}
