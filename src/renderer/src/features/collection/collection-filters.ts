import {
  CARD_CLASSES,
  type CardDefinition,
  type ExpansionId
} from '../../../../game/content/cards'

export const MANA_FILTER_VALUES = [0, 1, 2, 3, 4, 5, 6, '7+'] as const

export type ManaFilterValue = (typeof MANA_FILTER_VALUES)[number]

export function formatManaFilterLabel(value: ManaFilterValue): string {
  return value === '7+' ? '7' : String(value)
}

export interface CollectionFilterState {
  readonly query?: string
  readonly manaCost?: ManaFilterValue | null
  readonly hiddenExpansionIds?: readonly ExpansionId[]
}

interface NumericConstraint {
  readonly field: 'attack' | 'cost' | 'health'
  readonly value: number | '7+'
}

interface ParsedCollectionQuery {
  readonly textTokens: readonly string[]
  readonly numericConstraints: readonly NumericConstraint[]
  readonly classConstraints: readonly string[]
  readonly hasInvalidConstraint: boolean
}

const STRUCTURED_FIELDS = new Set(['attack', 'cost', 'health', 'class'])

/** Applies collection search and structured mana/class constraints. */
export function filterCollectionCards(
  cards: readonly CardDefinition[],
  state: CollectionFilterState = {}
): readonly CardDefinition[] {
  const parsedQuery = parseCollectionQuery(state.query ?? '')
  const manaCost = state.manaCost ?? null
  const hiddenExpansionIds = new Set(state.hiddenExpansionIds ?? [])

  if (
    parsedQuery.hasInvalidConstraint ||
    !hasKnownClasses(parsedQuery.classConstraints)
  ) {
    return []
  }

  return cards.filter((card) => {
    if (hiddenExpansionIds.has(card.expansionId)) return false
    if (manaCost !== null && !matchesCost(card.cost, manaCost)) return false

    if (
      parsedQuery.numericConstraints.some(
        (constraint) => !matchesNumericConstraint(card, constraint)
      )
    ) {
      return false
    }

    if (
      parsedQuery.classConstraints.some(
        (className) => normalizeSearchText(card.cardClass) !== className
      )
    ) {
      return false
    }

    const searchableText = normalizeSearchText(
      `${card.name} ${card.rulesText} ${card.rarity}`
    )
    return parsedQuery.textTokens.every((token) => searchableText.includes(token))
  })
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9+]+/gu, ' ')
    .trim()
}

function parseCollectionQuery(query: string): ParsedCollectionQuery {
  const textTokens: string[] = []
  const numericConstraints: NumericConstraint[] = []
  const classConstraints: string[] = []
  let hasInvalidConstraint = false

  for (const rawToken of query.trim().split(/\s+/u).filter(Boolean)) {
    const separatorIndex = rawToken.indexOf(':')
    if (separatorIndex === -1) {
      const normalizedToken = normalizeSearchText(rawToken)
      if (normalizedToken) textTokens.push(normalizedToken)
      continue
    }

    const rawField = rawToken.slice(0, separatorIndex).toLowerCase()
    const rawValue = rawToken.slice(separatorIndex + 1)
    if (!STRUCTURED_FIELDS.has(rawField)) {
      const normalizedToken = normalizeSearchText(rawToken)
      if (normalizedToken) textTokens.push(normalizedToken)
      continue
    }

    const normalizedValue = normalizeSearchText(rawValue)
    if (!normalizedValue) {
      hasInvalidConstraint = true
      continue
    }

    if (rawField === 'class') {
      classConstraints.push(normalizedValue)
      continue
    }

    const numericValue = parseNumericFilterValue(normalizedValue)
    if (numericValue === null) {
      hasInvalidConstraint = true
      continue
    }

    numericConstraints.push({
      field: rawField as NumericConstraint['field'],
      value: numericValue
    })
  }

  return {
    textTokens,
    numericConstraints,
    classConstraints,
    hasInvalidConstraint
  }
}

function parseNumericFilterValue(value: string): number | '7+' | null {
  if (value === '7+') return '7+'
  if (!/^\d+$/u.test(value)) return null

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function hasKnownClasses(classConstraints: readonly string[]): boolean {
  const normalizedClasses = new Set(CARD_CLASSES.map(normalizeSearchText))
  return classConstraints.every((className) => normalizedClasses.has(className))
}

function matchesNumericConstraint(
  card: CardDefinition,
  constraint: NumericConstraint
): boolean {
  if (constraint.field === 'attack') {
    if (card.type !== 'Minion' && card.type !== 'Weapon') return false
    return matchesCost(card.attack, constraint.value)
  }
  if (constraint.field === 'health') {
    if (card.type !== 'Minion') return false
    return matchesCost(card.health, constraint.value)
  }
  return matchesCost(card.cost, constraint.value)
}

function matchesCost(value: number, filter: number | '7+'): boolean {
  return filter === '7+' ? value >= 7 : value === filter
}
