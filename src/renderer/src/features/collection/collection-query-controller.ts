import type { DeckClass } from '../../../../game/content/cards'
import type { ManaFilterValue } from './collection-filters'
import type { CollectionQueryState } from './collection-query'

/** Owns mutable collection query state independently of Pixi controls. */
export class CollectionQueryController {
  private state: CollectionQueryState = {
    classFilter: null,
    searchQuery: '',
    manaFilter: null
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

  snapshot(): CollectionQueryState {
    return this.state
  }
}
