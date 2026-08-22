import type { DeckClass, ExpansionId } from '../../../../game/content/cards'
import type { ManaFilterValue } from './collection-filters'
import type { CollectionQueryState } from './collection-query'

/** Owns mutable collection query state independently of Pixi controls. */
export class CollectionQueryController {
  private state: CollectionQueryState = {
    classFilter: null,
    searchQuery: '',
    manaFilter: null,
    hiddenExpansionIds: []
  }

  get classFilter(): DeckClass | null {
    return this.state.classFilter
  }

  get searchQuery(): string {
    return this.state.searchQuery
  }

  get manaFilter(): ManaFilterValue | null {
    return this.state.manaFilter
  }

  get hiddenExpansionIds(): readonly ExpansionId[] {
    return this.state.hiddenExpansionIds
  }

  setClassFilter(classFilter: DeckClass | null): void {
    this.state = { ...this.state, classFilter }
  }

  setSearchQuery(searchQuery: string): void {
    this.state = { ...this.state, searchQuery }
  }

  toggleManaFilter(manaFilter: ManaFilterValue): void {
    this.state = {
      ...this.state,
      manaFilter: this.state.manaFilter === manaFilter ? null : manaFilter
    }
  }

  toggleExpansionVisibility(expansionId: ExpansionId): void {
    const hidden = this.state.hiddenExpansionIds.includes(expansionId)
    this.state = {
      ...this.state,
      hiddenExpansionIds: hidden
        ? this.state.hiddenExpansionIds.filter((id) => id !== expansionId)
        : [...this.state.hiddenExpansionIds, expansionId]
    }
  }

  snapshot(): CollectionQueryState {
    return this.state
  }
}
