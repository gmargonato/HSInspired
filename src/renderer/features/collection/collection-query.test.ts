import { asCardId, asClassId, asExpansionId } from '../../../game/content/cards'
import type { CardClass, CardDefinition } from '../../../game/content/cards'
import { describe, expect, it } from 'vitest'
import { queryCollectionCards, type CollectionQueryState } from './collection-query'

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

  it('includes Neutral cards with a playable class marker', () => {
    expect(
      queryCollectionCards(cards, queryState('Mage')).map(({ name }) => name)
    ).toEqual(['Arcane Burst', 'Boulderfist Ogre'])
  })

  it('returns only Neutral cards for the Neutral marker', () => {
    expect(
      queryCollectionCards(cards, queryState('Neutral')).map(({ name }) => name)
    ).toEqual(['Boulderfist Ogre'])
  })
})
