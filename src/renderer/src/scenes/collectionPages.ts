import {
  CARD_CLASSES,
  isCollectibleCard,
  type CardClass,
  type CardDefinition,
  type CardType
} from '../../../../card-lab/card-catalog'

export const COLLECTION_PAGE_SIZE = 8
export const COLLECTION_CARD_TYPES = ['Spell', 'Minion', 'Weapon', 'Hero'] as const

const COLLECTION_CARD_TYPE_SET = new Set<CardType>(COLLECTION_CARD_TYPES)

export interface CollectionPage {
  readonly cardClass: CardClass
  readonly cards: readonly CardDefinition[]
  readonly pageNumber: number
  readonly pageCount: number
}

/**
 * Builds deterministic, single-class pages for the collection view.
 *
 * The catalog remains the source of truth for the card data. This helper only
 * chooses the display order and chunks the cards so the scene can mount one
 * eight-card page at a time. An optional class allow-list keeps deck creation
 * filtering in the same place as normal collection pagination.
 */
export function buildCollectionPages(
  cards: readonly CardDefinition[],
  allowedClasses?: readonly CardClass[]
): readonly CollectionPage[] {
  const pages: CollectionPage[] = []
  const allowedClassSet = allowedClasses ? new Set(allowedClasses) : null

  for (const cardClass of CARD_CLASSES) {
    if (allowedClassSet && !allowedClassSet.has(cardClass)) continue

    const classCards = cards
      .filter(
        (card) =>
          card.cardClass === cardClass &&
          COLLECTION_CARD_TYPE_SET.has(card.type) &&
          isCollectibleCard(card)
      )
      .sort(compareCards)

    const pageCount = Math.ceil(classCards.length / COLLECTION_PAGE_SIZE)
    for (let start = 0; start < classCards.length; start += COLLECTION_PAGE_SIZE) {
      pages.push({
        cardClass,
        cards: classCards.slice(start, start + COLLECTION_PAGE_SIZE),
        pageNumber: start / COLLECTION_PAGE_SIZE + 1,
        pageCount
      })
    }
  }

  return pages
}

function compareCards(left: CardDefinition, right: CardDefinition): number {
  return (
    left.cost - right.cost ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  )
}
