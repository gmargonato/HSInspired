import {
  MAX_DECK_CARDS,
  MAX_DECKS,
  countDeckCards,
  type Deck
} from '../../../game/decks'
import { createSeededRng } from '../../../game/match'

export interface DeckSelectionEntry {
  readonly deck: Deck
  readonly index: number
  readonly column: number
  readonly row: number
}

/** Builds the stable 3x3 list of decks that are ready to play. */
export function buildDeckSelectionEntries(
  decks: readonly Deck[]
): readonly DeckSelectionEntry[] {
  return decks
    .filter((deck) => countDeckCards(deck) === MAX_DECK_CARDS)
    .slice(0, MAX_DECKS)
    .map((deck, index) => ({
      deck,
      index,
      column: index % 3,
      row: Math.floor(index / 3)
    }))
}

/** Picks a reproducible opponent from the decks currently ready to play. */
export function chooseOpponentDeck(
  decks: readonly Deck[],
  localDeckId: string,
  seed: number
): Deck | undefined {
  const completeDecks = decks.filter((deck) => countDeckCards(deck) === MAX_DECK_CARDS)
  const alternatives = completeDecks.filter((deck) => deck.id !== localDeckId)
  const candidates = alternatives.length > 0 ? alternatives : completeDecks
  if (candidates.length === 0) return undefined

  const index = Math.floor(createSeededRng(seed ^ 0x51f15e).next() * candidates.length)
  return candidates[Math.min(index, candidates.length - 1)]
}

/** Generates a session seed without making randomness part of game rules. */
export function createMatchSeed(): number {
  const cryptoProvider = globalThis.crypto
  if (cryptoProvider) {
    const values = new Uint32Array(1)
    cryptoProvider.getRandomValues(values)
    return values[0] ?? 0
  }
  return Date.now() >>> 0
}
