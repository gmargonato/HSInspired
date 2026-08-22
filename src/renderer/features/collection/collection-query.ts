import type {
  CardDefinition,
  DeckClass,
  ExpansionId
} from '../../../game/content/cards'
import { filterCollectionCards, type ManaFilterValue } from './collection-filters'

export interface CollectionQueryState {
  readonly classFilter: DeckClass | null
  readonly searchQuery: string
  readonly manaFilter: ManaFilterValue | null
  readonly hiddenExpansionIds: readonly ExpansionId[]
}

/** Applies collection-owned query state before the scene builds display pages. */
export function queryCollectionCards(
  cards: readonly CardDefinition[],
  state: CollectionQueryState
): readonly CardDefinition[] {
  const allowedClasses: readonly string[] | undefined = state.classFilter
    ? ['Neutral', state.classFilter]
    : undefined

  const filtered = filterCollectionCards(cards, {
    query: state.searchQuery,
    manaCost: state.manaFilter,
    hiddenExpansionIds: state.hiddenExpansionIds
  })

  return allowedClasses
    ? filtered.filter((card) => allowedClasses.includes(card.cardClass))
    : filtered
}
