import rawConfig from './opponent-generation.json'

import { asCardId, type CardId } from '../content/cards'

export interface OpponentGenerationConfig {
  readonly version: 1
  readonly alwaysIncludeQuest: boolean
  readonly alwaysIncludeHero: boolean
  readonly archetypeExtraCardIds: Readonly<Record<string, readonly CardId[]>>
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function requiredBoolean(value: unknown, key: string): boolean {
  if (typeof value !== 'boolean')
    throw new Error(`Opponent generation config field ${key} must be a boolean.`)
  return value
}

export function parseOpponentGenerationConfig(
  value: unknown
): OpponentGenerationConfig {
  const config = record(value)
  if (config.version !== 1)
    throw new Error('Opponent generation config version must be 1.')

  const rawAnchors = config.archetypeExtraCardIds
  if (!rawAnchors || typeof rawAnchors !== 'object' || Array.isArray(rawAnchors)) {
    throw new Error(
      'Opponent generation config field archetypeExtraCardIds must be an object.'
    )
  }

  const archetypeExtraCardIds: Record<string, readonly CardId[]> = {}
  for (const [archetypeId, valueForArchetype] of Object.entries(
    rawAnchors as Record<string, unknown>
  )) {
    if (!Array.isArray(valueForArchetype))
      throw new Error(
        `Opponent generation anchors for ${archetypeId} must be an array of Card IDs.`
      )
    archetypeExtraCardIds[archetypeId] = valueForArchetype.map((cardId) => {
      if (typeof cardId !== 'string' || !cardId.trim())
        throw new Error(
          `Opponent generation anchor for ${archetypeId} must be a non-empty Card ID.`
        )
      return asCardId(cardId)
    })
  }

  return {
    version: 1,
    alwaysIncludeQuest: requiredBoolean(
      config.alwaysIncludeQuest,
      'alwaysIncludeQuest'
    ),
    alwaysIncludeHero: requiredBoolean(config.alwaysIncludeHero, 'alwaysIncludeHero'),
    archetypeExtraCardIds
  }
}

export const OPPONENT_GENERATION_CONFIG = parseOpponentGenerationConfig(rawConfig)
