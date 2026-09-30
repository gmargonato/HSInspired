import type { ExpansionId } from '../../game-rules/content/cards'
import type { CollectibleMode, ManaFilterValue } from './collection-filters'
import type { CollectionClassFilter, CollectionQueryState } from './collection-query'

/** Owns mutable collection query state independently of Pixi controls. */
export class CollectionQueryController {
  private state: CollectionQueryState = {
    classFilter: null,
    searchQuery: '',
    manaFilter: null,
    hiddenExpansionIds: [],
    collectibleMode: 'collectible'
  }

  get classFilter(): CollectionClassFilter {
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

  get collectibleMode(): CollectibleMode {
    return this.state.collectibleMode
  }

  setClassFilter(classFilter: CollectionClassFilter): void {
    this.state = { ...this.state, classFilter }
  }

  setCollectibleMode(mode: CollectibleMode): void {
    this.state = { ...this.state, collectibleMode: mode }
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
