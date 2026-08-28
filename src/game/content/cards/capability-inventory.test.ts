import { describe, expect, it } from 'vitest'
import {
  CARD_ACTIONS,
  CARD_CATALOG,
  CARD_CONDITIONS,
  CARD_DURATIONS,
  CARD_EVENT_TYPES,
  CARD_KEYWORDS,
  CARD_TRIGGERS,
  CAPABILITY_INVENTORY,
  CAPABILITY_OWNERSHIP,
  GENERATED_CARD_DEFINITIONS,
  assertCapabilityOwnership,
  createCapabilityInventory
} from './index'

describe('card capability inventory', () => {
  it('owns every closed vocabulary item exactly once', () => {
    expect(() => assertCapabilityOwnership()).not.toThrow()

    const keys = CAPABILITY_OWNERSHIP.map((entry) => `${entry.family}:${entry.name}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(
      CAPABILITY_OWNERSHIP.filter((entry) => entry.family === 'action')
    ).toHaveLength(CARD_ACTIONS.length)
  })

  it('derives live catalog counts and recursively sees nested constructs', () => {
    expect(CAPABILITY_INVENTORY.cardCount).toBe(CARD_CATALOG.size)
    expect(CAPABILITY_INVENTORY.effectCardCount).toBeGreaterThan(0)

    for (const family of [
      'action',
      'trigger',
      'event',
      'condition',
      'duration',
      'keyword'
    ] as const) {
      expect(
        CAPABILITY_INVENTORY.usage.filter((entry) => entry.family === family)
      ).toHaveLength(
        family === 'action'
          ? CARD_ACTIONS.length
          : family === 'trigger'
            ? CARD_TRIGGERS.length
            : family === 'event'
              ? CARD_EVENT_TYPES.length
              : family === 'condition'
                ? CARD_CONDITIONS.length
                : family === 'duration'
                  ? CARD_DURATIONS.length
                  : CARD_KEYWORDS.length
      )
    }

    const nested = createCapabilityInventory(CARD_CATALOG.all).usage.find(
      (entry) => entry.family === 'action' && entry.name === 'summon'
    )
    expect(nested?.usageCount).toBeGreaterThan(0)
    expect(nested?.cardIds).toContain('classic_cenarius')
  })

  it('includes generated runtime cards in the catalog and capability audit', () => {
    expect(GENERATED_CARD_DEFINITIONS.length).toBeGreaterThan(0)
    for (const card of GENERATED_CARD_DEFINITIONS)
      expect(CARD_CATALOG.get(card.id)).toBe(card)
    expect(CAPABILITY_INVENTORY.cardCount).toBe(CARD_CATALOG.all.length)
    expect(
      CAPABILITY_INVENTORY.usage.some(
        (entry) =>
          entry.family === 'action' &&
          entry.name === 'modify' &&
          entry.cardIds.some((cardId) =>
            cardId.startsWith('goblins_vs_gnomes_spare_part_')
          )
      )
    ).toBe(true)
    expect(
      CAPABILITY_INVENTORY.usage.find(
        (entry) => entry.family === 'selector-field' && entry.name === 'selection'
      )?.usageCount
    ).toBeGreaterThan(0)
  })
})
