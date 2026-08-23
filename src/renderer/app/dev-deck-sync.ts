import { HERO_CATALOG } from '../../game/content/heroes'
import { MAX_DECK_CARDS, countDeckCards, type Deck } from '../../game/decks'
import type { DeckStore } from '../features/deck-builder/deck-store'
import type { AppLogger } from './logger'
import type { DevDeckEntry } from '../../shared/dev-menu'

type DevMenuBridge = {
  syncDecks?: (entries: readonly DevDeckEntry[]) => void
}

function getDevMenuBridge(): DevMenuBridge | null {
  const api = (window as unknown as { api?: { devMenu?: DevMenuBridge } }).api
  return api?.devMenu ?? null
}

function toDevDeckEntry(deck: Deck): DevDeckEntry {
  const hero = HERO_CATALOG.get(deck.heroId)
  const classId = (hero?.classId as string | undefined) ?? 'Unknown'
  return { id: deck.id, heroId: deck.heroId as unknown as string, classId }
}

function buildCompleteDeckEntries(decks: readonly Deck[]): readonly DevDeckEntry[] {
  return decks
    .filter((deck) => countDeckCards(deck) === MAX_DECK_CARDS)
    .map(toDevDeckEntry)
}

/**
 * Mirrors the renderer's complete decks to the main process for the native
 * `Scenes > Match` submenu. The renderer is the source of truth for
 * completeness (MAX_DECK_CARDS) and class mapping.
 *
 * No-op in production or when the preload bridge is unavailable (tests/headless).
 */
export function installDevDeckSync(
  deckStore: DeckStore,
  logger: AppLogger
): () => void {
  const bridge = getDevMenuBridge()
  const syncDecks = bridge?.syncDecks
  if (!syncDecks) {
    logger.info('[DevMenu] deck sync bridge unavailable')
    return () => undefined
  }

  let lastPayload: string | null = null
  const sync = (): void => {
    try {
      const entries = buildCompleteDeckEntries(deckStore.getDecks())
      const payload = JSON.stringify(entries)
      if (payload === lastPayload) return
      lastPayload = payload
      syncDecks(entries)
      logger.info('[DevMenu] synced decks', entries)
    } catch (error) {
      logger.warn('[DevMenu] failed to sync decks', error)
    }
  }

  const unsubscribe = deckStore.subscribe(sync)

  // Initial sync after store load. subscribe covers future mutations.
  void deckStore
    .load()
    .then(sync)
    .catch(() => sync())

  // Immediate sync if decks are already cached (e.g. hot reload)
  sync()

  return () => {
    unsubscribe()
  }
}
