import { asCardId, asClassId, asExpansionId } from '../../game-rules/content/cards'
import type { CardClass, CardDefinition } from '../../game-rules/content/cards'
import { describe, expect, it } from 'vitest'
import { queryCollectionCards, type CollectionQueryState } from './collection-query'
import { filterCollectionCards, formatManaFilterLabel } from './collection-filters'

function card(cardClass: CardClass, name: string): CardDefinition {
  return {
    id: asCardId(`test_${name.toLowerCase()}`),
    expansionId: asExpansionId('classic'),
    set: asExpansionId('classic'),
    name,
    rarity: 'Common',
    cardClass: asClassId(cardClass),
    subtype: null,
    spellSchool: null,
    cost: 1,
    rulesText: '',
    keywords: [],
    effects: [],
    collectible: true,
    deckLegal: true,
    type: 'Spell'
  }
}

function queryState(
  classFilter: CollectionQueryState['classFilter']
): CollectionQueryState {
  return {
    classFilter,
    searchQuery: '',
    manaFilter: null,
    hiddenExpansionIds: [],
    collectibleMode: 'all'
  }
}

describe('collection class query', () => {
  const cards = [
    card('Mage', 'Arcane Burst'),
    card('Neutral', 'Boulderfist Ogre'),
    card('Warrior', 'Shield Slam')
  ]

  it('returns all classes without a selected marker', () => {
    expect(queryCollectionCards(cards, queryState(null))).toEqual(cards)
  })

  it('shows only the selected class', () => {
    expect(
      queryCollectionCards(cards, queryState('Mage')).map(({ name }) => name)
    ).toEqual(['Arcane Burst'])
  })

  it('returns only Neutral cards for the Neutral marker', () => {
    expect(
      queryCollectionCards(cards, queryState('Neutral')).map(({ name }) => name)
    ).toEqual(['Boulderfist Ogre'])
  })

  it('restricts All to the deck class and Neutral while editing', () => {
    expect(
      queryCollectionCards(cards, queryState(null), 'Mage').map(({ name }) => name)
    ).toEqual(['Arcane Burst', 'Boulderfist Ogre'])
    expect(
      queryCollectionCards(cards, queryState('Neutral'), 'Mage').map(({ name }) => name)
    ).toEqual(['Boulderfist Ogre'])
    expect(queryCollectionCards(cards, queryState('Warrior'), 'Mage')).toEqual([])
  })

  it('intersects structured search with class and deck restrictions', () => {
    expect(
      queryCollectionCards(
        cards,
        { ...queryState(null), searchQuery: 'class:warrior' },
        'Mage'
      )
    ).toEqual([])
    expect(
      queryCollectionCards(cards, {
        ...queryState('Mage'),
        searchQuery: 'class:neutral'
      })
    ).toEqual([])
    expect(
      queryCollectionCards(cards, { ...queryState(null), searchQuery: 'class:mage' })
    ).toEqual([cards[0]])
  })
})

describe('collection filters', () => {
  it('labels and matches the seven-or-more mana range', () => {
    const cards = [6, 7, 10].map((cost) => ({ ...card('Mage', `Cost ${cost}`), cost }))
    expect(formatManaFilterLabel('7+')).toBe('7')
    expect(
      filterCollectionCards(cards, { manaCost: '7+' }).map((entry) => entry.cost)
    ).toEqual([7, 10])
  })

  it.each([
    'cost:',
    'attack:',
    'health:',
    'class:',
    'cost:abc',
    'cost:-1',
    'cost:3.5',
    'class:unknown'
  ])('rejects invalid structured search %s', (query) => {
    expect(filterCollectionCards([card('Mage', 'Example')], { query })).toEqual([])
  })
})
