import { asCardId, asClassId, asExpansionId } from '../../../game/content/cards'
import type { CardClass, CardDefinition } from '../../../game/content/cards'
import { describe, expect, it } from 'vitest'
import { buildCollectionPages } from './collection-pages'

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

describe('collection pages', () => {
  it('places Neutral after every class group', () => {
    const pages = buildCollectionPages([
      card('Neutral', 'Neutral Card'),
      card('Mage', 'Mage Card'),
      card('Warrior', 'Warrior Card')
    ])

    expect(pages.map((page) => page.cardClass)).toEqual(['Mage', 'Warrior', 'Neutral'])
  })
})
