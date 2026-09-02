import { describe, expect, it } from 'vitest'
import type { Deck } from '../../../game/decks'
import { asHeroId } from '../../../game/content/cards'
import {
  createFallbackDeckPlan,
  createMatchupPlanRequest,
  deriveDeckSynergies,
  reservedCardIds,
  validateDeckPlanForDeck
} from './ai-deck-strategy'

const freezeDeck: Deck = {
  id: 'freeze-mage',
  name: 'Freeze Mage',
  heroId: asHeroId('jaina'),
  cards: {
    basic_frostbolt: 2,
    classic_ice_lance: 2,
    basic_chillwind_yeti: 26
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('AI deck strategy', () => {
  it('derives freeze setup relationships and preserves their resources', () => {
    expect(deriveDeckSynergies(freezeDeck)).toContainEqual({
      producerCardId: 'basic_frostbolt',
      consumerCardId: 'classic_ice_lance',
      signal: 'frozen'
    })

    const plan = createFallbackDeckPlan(freezeDeck)
    expect(plan.archetype).toBe('combo')
    expect(reservedCardIds(plan)).toEqual(
      new Set(['basic_frostbolt', 'classic_ice_lance'])
    )
  })

  it('rejects a model plan that references a card outside the deck', () => {
    const plan = createFallbackDeckPlan(freezeDeck)
    expect(() =>
      validateDeckPlanForDeck(
        { ...plan, mulliganPriorityCardIds: ['classic_mirror_entity'] },
        freezeDeck
      )
    ).toThrow('outside its deck')
  })

  it('sends compact matchup card facts without the verbose effect AST', () => {
    const request = createMatchupPlanRequest(freezeDeck, freezeDeck, Date.now() + 1_000)
    const serialized = JSON.stringify(request)

    expect(serialized).toContain('rulesText')
    expect(serialized).toContain('structuredSynergies')
    expect(serialized).not.toContain('"effects"')
  })
})
