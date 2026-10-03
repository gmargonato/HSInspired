import { asCardId, asClassId, asExpansionId } from '../../game-rules/content/cards'
import type { CardClass, CardDefinition } from '../../game-rules/content/cards'
import { describe, expect, it } from 'vitest'
import {
  buildCollectionPages,
  capturePageAnchor,
  resolvePageAnchor
} from './collection-pages'

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

  it('follows the first visible card when filters move it to another page', () => {
    const cards = Array.from({ length: 20 }, (_, index) =>
      card('Mage', `Card ${String(index).padStart(2, '0')}`)
    )
    const pages = buildCollectionPages(cards)
    const anchor = capturePageAnchor(pages[1])
    expect(resolvePageAnchor(buildCollectionPages(cards.slice(4)), anchor)).toBe(0)
  })

  it('clamps within the same class when the anchor card disappears', () => {
    const cards = Array.from({ length: 20 }, (_, index) =>
      card('Mage', `Card ${String(index).padStart(2, '0')}`)
    )
    const anchor = capturePageAnchor(buildCollectionPages(cards)[2])
    expect(resolvePageAnchor(buildCollectionPages(cards.slice(0, 10)), anchor)).toBe(1)
    expect(
      resolvePageAnchor(buildCollectionPages([card('Neutral', 'Other')]), anchor)
    ).toBe(0)
    expect(resolvePageAnchor([], anchor)).toBe(0)
  })
})
