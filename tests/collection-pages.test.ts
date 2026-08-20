import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, isCollectibleCard } from '../src/game/content/cards'
import {
  buildCollectionPages,
  COLLECTION_CARD_TYPES,
  COLLECTION_PAGE_SIZE
} from '../src/renderer/src/scenes/collectionPages'
import { filterCollectionCards } from '../src/renderer/src/scenes/collectionFilters'

describe('Collection pages', () => {
  const pages = buildCollectionPages(CARD_CATALOG.all)

  it('creates eight-card pages without mixing classes', () => {
    expect(pages.length).toBeGreaterThan(0)

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
      pageNumber: 1
    })
    const hunterPage = pages.find((page) => page.cardClass === 'Hunter')
    expect(hunterPage).toMatchObject({ cardClass: 'Hunter', pageNumber: 1 })
  })

  it('includes every catalog card exactly once', () => {
    const cards = pages.flatMap((page) => page.cards)
    const ids = cards.map((card) => card.id)
    const eligibleCards = CARD_CATALOG.all.filter(
      (card) =>
        COLLECTION_CARD_TYPES.some((cardType) => cardType === card.type) &&
        isCollectibleCard(card)
    )

    expect(cards).toHaveLength(eligibleCards.length)
    expect(new Set(ids).size).toBe(eligibleCards.length)
  })

  it('includes collectible heroes in the collection', () => {
    const cards = pages.flatMap((page) => page.cards)

    expect(cards.map((card) => card.id)).toContain('classic_lord_jaraxxus')
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

  it('paginates filtered cards after applying the search constraints', () => {
    const filteredCards = filterCollectionCards(CARD_CATALOG.all, {
      query: 'cost:4'
    })
    const filteredPages = buildCollectionPages(filteredCards)

    expect(filteredPages.length).toBeGreaterThan(0)
    expect(
      filteredPages.flatMap((page) => page.cards).every((card) => card.cost === 4)
    ).toBe(true)

    for (const page of filteredPages) {
      expect(page.pageNumber).toBeGreaterThanOrEqual(1)
      expect(page.pageNumber).toBeLessThanOrEqual(page.pageCount)
    }
  })
})
