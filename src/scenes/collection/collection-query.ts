import type {
  CardClass,
  CardDefinition,
  ExpansionId
} from '../../game-rules/content/cards'
import {
  filterCollectionCards,
  type CollectibleMode,
  type ManaFilterValue
} from './collection-filters'

export interface CollectionQueryState {
  readonly classFilter: CollectionClassFilter
  readonly searchQuery: string
  readonly manaFilter: ManaFilterValue | null
  readonly hiddenExpansionIds: readonly ExpansionId[]
  readonly collectibleMode: CollectibleMode
}

/** A collection marker selection; `null` represents the unfiltered collection. */
export type CollectionClassFilter = CardClass | null

/** Applies collection-owned query state before the scene builds display pages. */
export function queryCollectionCards(
  cards: readonly CardDefinition[],
  state: CollectionQueryState
): readonly CardDefinition[] {
  const allowedClasses: readonly string[] | undefined =
    state.classFilter === 'Neutral'
      ? ['Neutral']
      : state.classFilter
        ? [state.classFilter, 'Neutral']
        : undefined

  const filtered = filterCollectionCards(cards, {
    query: state.searchQuery,
    manaCost: state.manaFilter,
    hiddenExpansionIds: state.hiddenExpansionIds,
    collectibleMode: state.collectibleMode
  })

  return allowedClasses
    ? filtered.filter((card) => allowedClasses.includes(card.cardClass))
    : filtered
}
