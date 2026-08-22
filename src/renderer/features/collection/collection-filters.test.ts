import { describe, expect, it } from 'vitest'
import { asExpansionId, CARD_CATALOG } from '../../../game/content/cards'
import {
  filterCollectionCards,
  formatManaFilterLabel,
  normalizeSearchText
} from './collection-filters'

describe('Collection filters', () => {
  it('keeps the seven-plus filter value while displaying the background plus', () => {
    expect(formatManaFilterLabel('7+')).toBe('7')
    expect(formatManaFilterLabel(4)).toBe('4')
  })

  it('normalizes case, accents, punctuation, and whitespace', () => {
    expect(normalizeSearchText("  Can't  Attack! ")).toBe('can t attack')
    expect(normalizeSearchText('\u00c9lite')).toBe('elite')
  })

  it('matches every ordinary token across card names and effects', () => {
    const cards = filterCollectionCards(CARD_CATALOG.all, {
      query: 'taunt ancient'
    })

    expect(cards.map((card) => card.id)).toContain('classic_ancient_of_war')
  })

  it('supports numeric and class constraints', () => {
    const cards = filterCollectionCards(CARD_CATALOG.all, {
      query: 'class:mage cost:4'
    })

    expect(cards.length).toBeGreaterThan(0)
    expect(cards.every((card) => card.cardClass === 'Mage' && card.cost === 4)).toBe(
      true
    )
  })

  it('treats missing stats as non-matches', () => {
    const cards = filterCollectionCards(CARD_CATALOG.all, {
      query: 'attack:6 health:6'
    })

    expect(
      cards.every(
        (card) => card.type === 'Minion' && card.attack === 6 && card.health === 6
      )
    ).toBe(true)
  })

  it('supports the seven-plus cost bucket', () => {
    const cards = filterCollectionCards(CARD_CATALOG.all, {
      manaCost: '7+'
    })

    expect(cards.length).toBeGreaterThan(0)
    expect(cards.every((card) => card.cost >= 7)).toBe(true)
  })

  it('hides cards from excluded expansions', () => {
    const hiddenExpansionIds = [asExpansionId('naxxramas')]
    const cards = filterCollectionCards(CARD_CATALOG.all, { hiddenExpansionIds })

    expect(cards.length).toBeGreaterThan(0)
    expect(cards.every((card) => card.expansionId !== 'naxxramas')).toBe(true)
    expect(cards.some((card) => card.expansionId === 'classic')).toBe(true)
  })

  it('combines expansion, mana, and search constraints with AND semantics', () => {
    const cards = filterCollectionCards(CARD_CATALOG.all, {
      query: 'taunt',
      manaCost: 2,
      hiddenExpansionIds: [asExpansionId('basic')]
    })

    expect(cards.every((card) => card.expansionId !== 'basic')).toBe(true)
    expect(cards.every((card) => card.cost === 2)).toBe(true)
  })

  it('combines mana and search constraints with AND semantics', () => {
    const cards = filterCollectionCards(CARD_CATALOG.all, {
      query: 'taunt',
      manaCost: 2
    })

    expect(cards.length).toBeGreaterThan(0)
    expect(cards.every((card) => card.cost === 2)).toBe(true)
    expect(
      cards.every((card) =>
        `${card.name} ${card.rulesText}`.toLowerCase().includes('taunt')
      )
    ).toBe(true)
  })

  it('matches card rarity as an ordinary search token', () => {
    const cards = filterCollectionCards(CARD_CATALOG.all, {
      query: 'legendary'
    })

    expect(cards.length).toBeGreaterThan(0)
    expect(cards.every((card) => card.rarity === 'Legendary')).toBe(true)
  })

  it('returns no cards for invalid structured terms', () => {
    expect(filterCollectionCards(CARD_CATALOG.all, { query: 'cost:banana' })).toEqual(
      []
    )
    expect(
      filterCollectionCards(CARD_CATALOG.all, { query: 'class:neutralx' })
    ).toEqual([])
  })
})
