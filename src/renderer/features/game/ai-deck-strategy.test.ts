import { describe, expect, it } from 'vitest'
import type { Deck } from '../../../game/decks'
import { asHeroId } from '../../../game/content/cards'
import {
  createFallbackDeckPlan,
  createDeckPlanRequest,
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
    expect(plan.archetype).toBe('detected synergy / combo plan')
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

  it('allows repeated combo pieces only up to the deck copy count', () => {
    const plan = createFallbackDeckPlan(freezeDeck)
    expect(() =>
      validateDeckPlanForDeck(
        {
          ...plan,
          combos: [
            {
              cardIds: ['basic_frostbolt', 'basic_frostbolt'],
              purpose: 'Use both legal copies.'
            }
          ]
        },
        freezeDeck
      )
    ).not.toThrow()
    expect(() =>
      validateDeckPlanForDeck(
        {
          ...plan,
          combos: [
            {
              cardIds: ['basic_frostbolt', 'basic_frostbolt', 'basic_frostbolt'],
              purpose: 'Invent a third copy.'
            }
          ]
        },
        freezeDeck
      )
    ).toThrow('deck has fewer')
  })

  it('sends authored effects so custom-card planning uses mechanical truth', () => {
    const request = createDeckPlanRequest(freezeDeck, Date.now() + 1_000)
    const serialized = JSON.stringify(request)

    expect(serialized).toContain('rulesText')
    expect(serialized).toContain('structuredSynergies')
    expect(serialized).toContain('"effects"')
    expect(serialized).toContain('"action":"freeze"')
  })

  it('does not mistake an action target descriptor for a combo requirement', () => {
    const targetOnlyDeck: Deck = {
      ...freezeDeck,
      id: 'target-only-signals',
      cards: {
        basic_murloc_raider: 15,
        basic_polymorph: 15
      }
    }

    expect(deriveDeckSynergies(targetOnlyDeck)).not.toContainEqual({
      producerCardId: 'basic_murloc_raider',
      consumerCardId: 'basic_polymorph',
      signal: 'minion'
    })
  })

  it('detects friendly resource targets without coupling independent packages', () => {
    const multiPackageDeck: Deck = {
      ...freezeDeck,
      id: 'multiple-packages',
      cards: {
        basic_frostbolt: 2,
        classic_ice_lance: 2,
        basic_fiery_war_axe: 2,
        basic_deadly_poison: 2,
        basic_chillwind_yeti: 22
      }
    }

    expect(deriveDeckSynergies(multiPackageDeck)).toContainEqual({
      producerCardId: 'basic_fiery_war_axe',
      consumerCardId: 'basic_deadly_poison',
      signal: 'weapon'
    })
    const plan = createFallbackDeckPlan(multiPackageDeck)
    expect(plan.resourceRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cardIds: expect.arrayContaining(['basic_frostbolt', 'classic_ice_lance'])
        }),
        expect.objectContaining({
          cardIds: expect.arrayContaining([
            'basic_fiery_war_axe',
            'basic_deadly_poison'
          ])
        })
      ])
    )
    expect(
      plan.resourceRules.some(
        (rule) =>
          rule.cardIds.includes('classic_ice_lance') &&
          rule.cardIds.includes('basic_deadly_poison')
      )
    ).toBe(false)
  })

  it('rejects an incomplete card-role inventory', () => {
    const plan = createFallbackDeckPlan(freezeDeck)
    expect(() =>
      validateDeckPlanForDeck(
        { ...plan, cardRoles: plan.cardRoles.slice(1) },
        freezeDeck
      )
    ).toThrow('every distinct deck card once')
  })
})
