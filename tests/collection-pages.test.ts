import { describe, expect, it } from 'vitest'
import { CARD_CATALOG } from '../card-lab/card-catalog'
import {
  buildCollectionPages,
  COLLECTION_CARD_TYPES,
  COLLECTION_PAGE_SIZE
} from '../src/renderer/src/scenes/collectionPages'

describe('Collection pages', () => {
  const pages = buildCollectionPages(CARD_CATALOG.all)

  it('creates eight-card pages without mixing classes', () => {
    expect(pages).toHaveLength(62)

    for (const page of pages) {
      expect(page.cards.length).toBeLessThanOrEqual(COLLECTION_PAGE_SIZE)
      expect(page.cards.every((card) => card.cardClass === page.cardClass)).toBe(true)
      expect(
        page.cards.every((card) =>
          COLLECTION_CARD_TYPES.some((cardType) => cardType === card.type)
        )
      ).toBe(true)
    }
  })

  it('keeps the class page numbering local to each class', () => {
    expect(pages[0]).toMatchObject({
      cardClass: 'Druid',
      pageNumber: 1,
      pageCount: 5
    })
    expect(pages[5]).toMatchObject({
      cardClass: 'Hunter',
      pageNumber: 1,
      pageCount: 4
    })
  })

  it('includes every catalog card exactly once', () => {
    const cards = pages.flatMap((page) => page.cards)
    const ids = cards.map((card) => card.id)
    const eligibleCards = CARD_CATALOG.all.filter((card) =>
      COLLECTION_CARD_TYPES.some((cardType) => cardType === card.type)
    )

    expect(cards).toHaveLength(eligibleCards.length)
    expect(new Set(ids).size).toBe(eligibleCards.length)
  })

  it('can restrict the collection to Neutral and one selected class', () => {
    const hunterPages = buildCollectionPages(CARD_CATALOG.all, ['Neutral', 'Hunter'])
    const visibleClasses = new Set(hunterPages.map((page) => page.cardClass))

    expect(visibleClasses).toEqual(new Set(['Neutral', 'Hunter']))
    expect(
      hunterPages
        .flatMap((page) => page.cards)
        .every((card) => card.cardClass === 'Neutral' || card.cardClass === 'Hunter')
    ).toBe(true)
  })
})
