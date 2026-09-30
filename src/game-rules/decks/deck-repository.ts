import type { Deck, DeckCreateRequest } from './deck'

/** Platform-neutral persistence port implemented by the Electron main process. */
export interface DeckRepository {
  list(): Promise<readonly Deck[]>
  create(request?: DeckCreateRequest): Promise<Deck>
  update(deck: Deck): Promise<Deck>
  delete(deckId: string): Promise<void>
}
