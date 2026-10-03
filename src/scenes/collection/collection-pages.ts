import {
  CARD_CLASSES,
  type CardClass,
  type CardDefinition,
  type CardId,
  type CardType
} from '../../game-rules/content/cards'

export const COLLECTION_PAGE_SIZE = 8
export const COLLECTION_CARD_TYPES = ['Spell', 'Minion', 'Weapon', 'Hero'] as const

const COLLECTION_CARD_TYPE_SET = new Set<CardType>(COLLECTION_CARD_TYPES)
const COLLECTION_CLASS_ORDER: readonly CardClass[] = [
  ...CARD_CLASSES.filter((cardClass) => cardClass !== 'Neutral'),
  'Neutral'
]

export interface CollectionPage {
  readonly cardClass: CardClass
  readonly cards: readonly CardDefinition[]
  readonly pageNumber: number
  readonly pageCount: number
}

export interface CollectionPageAnchor {
  readonly cardId: CardId | null
  readonly cardClass: CardClass
  readonly pageNumber: number
}

export function capturePageAnchor(
  page: CollectionPage | undefined
): CollectionPageAnchor | null {
  return page
    ? {
        cardId: page.cards[0]?.id ?? null,
        cardClass: page.cardClass,
        pageNumber: page.pageNumber
      }
    : null
}

export function resolvePageAnchor(
  pages: readonly CollectionPage[],
  anchor: CollectionPageAnchor | null
): number {
  if (!anchor) return 0
  const cardIndex = pages.findIndex((page) =>
    page.cards.some((card) => card.id === anchor.cardId)
  )
  if (cardIndex >= 0) return cardIndex
  const classPages = pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => page.cardClass === anchor.cardClass)
  return classPages[Math.min(anchor.pageNumber - 1, classPages.length - 1)]?.index ?? 0
}

/** Builds deterministic, single-class pages for the collection view. */
export function buildCollectionPages(
  cards: readonly CardDefinition[],
  allowedClasses?: readonly CardClass[]
): readonly CollectionPage[] {
  const pages: CollectionPage[] = []
  const allowedClassSet = allowedClasses ? new Set(allowedClasses) : null

  for (const cardClass of COLLECTION_CLASS_ORDER) {
    if (allowedClassSet && !allowedClassSet.has(cardClass)) continue

    const classCards = cards
      .filter(
        (card) =>
          card.cardClass === cardClass && COLLECTION_CARD_TYPE_SET.has(card.type)
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
