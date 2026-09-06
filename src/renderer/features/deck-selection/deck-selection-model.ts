import { MAX_DECK_CARDS, countDeckCards, type Deck } from '../../../game/decks'
import { createSeededRng } from '../../../game/match'

export const DECK_SELECTION_PAGE_SIZE = 9

export interface DeckSelectionEntry {
  readonly deck: Deck
  readonly index: number
  readonly column: number
  readonly row: number
}

export function formatClassWins(wins: number): string {
  return `Wins: ${wins}`
}

/** Returns the number of completed-deck pages, including a stable empty page. */
export function getDeckSelectionPageCount(decks: readonly Deck[]): number {
  const completeDeckCount = decks.filter(
    (deck) => countDeckCards(deck) === MAX_DECK_CARDS
  ).length
  return Math.max(1, Math.ceil(completeDeckCount / DECK_SELECTION_PAGE_SIZE))
}

/** Builds one stable 3x3 page of decks that are ready to play. */
export function buildDeckSelectionEntries(
  decks: readonly Deck[],
  pageIndex: number = 0
): readonly DeckSelectionEntry[] {
  const pageCount = getDeckSelectionPageCount(decks)
  const safePageIndex = Math.max(0, Math.min(pageIndex, pageCount - 1))
  return decks
    .filter((deck) => countDeckCards(deck) === MAX_DECK_CARDS)
    .slice(
      safePageIndex * DECK_SELECTION_PAGE_SIZE,
      (safePageIndex + 1) * DECK_SELECTION_PAGE_SIZE
    )
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
  seed: number,
  preferredOpponentDeckId?: string
): Deck | undefined {
  const completeDecks = decks.filter((deck) => countDeckCards(deck) === MAX_DECK_CARDS)
  const alternatives = completeDecks.filter((deck) => deck.id !== localDeckId)
  const candidates = alternatives.length > 0 ? alternatives : completeDecks
  if (candidates.length === 0) return undefined

  const preferred = preferredOpponentDeckId
    ? candidates.find((deck) => deck.id === preferredOpponentDeckId)
    : undefined
  if (preferred) return preferred

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
