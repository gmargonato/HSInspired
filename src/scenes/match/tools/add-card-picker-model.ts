import type { CardDefinition } from '../../../game-rules/content/cards'

export const ALL_ADD_CARD_FILTER_VALUE = ''

export interface AddCardPickerFilters {
  readonly query: string
  readonly cardClass: string
  readonly expansionId: string
  readonly collectibleOnly: boolean
}

/**
 * Returns the cards that match the picker filters, ordered by search
 * relevance and then by the stable cost/name ordering used by the game UI.
 */
export function filterAddCardCards(
  cards: readonly CardDefinition[],
  filters: AddCardPickerFilters
): readonly CardDefinition[] {
  const normalizedQuery = normalizePickerSearchText(filters.query)

  return cards
    .filter((card) => {
      if (filters.cardClass && card.cardClass !== filters.cardClass) return false
      if (filters.expansionId && card.expansionId !== filters.expansionId) {
        return false
      }
      if (filters.collectibleOnly && !card.collectible) return false
      return true
    })
    .map((card) => ({ card, score: scoreCard(card, normalizedQuery) }))
    .filter((entry): entry is RankedCard => entry.score !== null)
    .sort(compareRankedCards)
    .map((entry) => entry.card)
}

export function normalizePickerSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
}

interface RankedCard {
  readonly card: CardDefinition
  readonly score: number
}

function scoreCard(card: CardDefinition, query: string): number | null {
  if (!query) return 0

  const queryCompact = query.replace(/\s+/gu, '')
  const name = normalizePickerSearchText(card.name)
  const id = normalizePickerSearchText(card.id)
  const nameScore = scoreField(name, query, queryCompact)
  const idScore = scoreField(id, query, queryCompact)

  if (nameScore === null && idScore === null) return null
  return Math.min(
    nameScore ?? Number.POSITIVE_INFINITY,
    (idScore ?? Number.POSITIVE_INFINITY) + 6
  )
}

function scoreField(field: string, query: string, queryCompact: string): number | null {
  if (field === query) return 0
  if (field.startsWith(query)) return 10
  if (field.includes(query)) return 20

  const queryTokens = query.split(' ').filter(Boolean)
  const fieldTokens = field.split(' ').filter(Boolean)
  if (
    queryTokens.length > 1 &&
    queryTokens.every((token) =>
      fieldTokens.some((fieldToken) => fieldToken.startsWith(token))
    )
  ) {
    return 28
  }

  const subsequenceGap = findSubsequenceGap(queryCompact, field.replace(/\s+/gu, ''))
  return subsequenceGap === null ? null : 40 + subsequenceGap
}

function findSubsequenceGap(query: string, value: string): number | null {
  if (!query) return 0

  let queryIndex = 0
  let firstMatch = -1

  for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
    if (value[valueIndex] !== query[queryIndex]) continue
    firstMatch = firstMatch === -1 ? valueIndex : firstMatch
    queryIndex += 1
    if (queryIndex === query.length) {
      return valueIndex - firstMatch + 1 - query.length
    }
  }

  return null
}

function compareRankedCards(left: RankedCard, right: RankedCard): number {
  if (left.score !== right.score) return left.score - right.score
  if (left.card.cost !== right.card.cost) return left.card.cost - right.card.cost

  const nameOrder = left.card.name.localeCompare(right.card.name)
  if (nameOrder !== 0) return nameOrder
  return left.card.id.localeCompare(right.card.id)
}
