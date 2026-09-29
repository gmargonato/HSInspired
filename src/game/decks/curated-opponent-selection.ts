import { PLAYABLE_CLASSES, type DeckClass } from '../content/cards'
import { createSeededRng } from '../match/rng'
import {
  CURATED_OPPONENT_CATALOG_VERSION,
  getCuratedOpponentDecksForClass,
  type CuratedOpponentSource
} from './curated-opponent-decks'
import type { Deck } from './deck'
import type { OpponentStrategyBrief } from './opponent-strategy'
import type { ExpertDeckStrategyProfileId } from './expert-deck-strategy'

export interface CuratedOpponentMetadata {
  readonly catalogVersion: number
  readonly seed: number
  readonly deckId: string
  readonly deckName: string
  readonly classId: DeckClass
  readonly source: CuratedOpponentSource
  readonly strategy: OpponentStrategyBrief
  readonly expertStrategyProfileId?: ExpertDeckStrategyProfileId
}

export interface CuratedOpponentSelection {
  readonly deck: Deck
  readonly metadata: CuratedOpponentMetadata
}

const CURATED_OPPONENT_SEED_SALT = 0x63757261

/** Select one class uniformly, then one of its three curated lists uniformly. */
export function selectCuratedConstructedOpponent(
  seed: number,
  /** Explicit development selection; ordinary selection remains seeded. */
  deckId?: string
): CuratedOpponentSelection {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('Curated opponent seed must be uint32.')
  const rng = createSeededRng(seed ^ CURATED_OPPONENT_SEED_SALT)
  const classId = PLAYABLE_CLASSES[Math.floor(rng.next() * PLAYABLE_CLASSES.length)]
  const candidates = getCuratedOpponentDecksForClass(classId)
  if (candidates.length !== 3)
    throw new Error(`Expected three curated ${classId} decks.`)
  const selected = deckId
    ? PLAYABLE_CLASSES.flatMap(getCuratedOpponentDecksForClass).find(
        (candidate) => candidate.definition.id === deckId
      )
    : candidates[Math.floor(rng.next() * candidates.length)]
  if (!selected) throw new Error(`Unknown curated opponent deck: ${deckId}`)
  return {
    deck: selected.deck,
    metadata: {
      catalogVersion: CURATED_OPPONENT_CATALOG_VERSION,
      seed,
      deckId: selected.definition.id,
      deckName: selected.definition.name,
      classId: selected.definition.classId,
      source: selected.definition.source,
      strategy: selected.strategy,
      ...(selected.definition.expertStrategyProfileId
        ? { expertStrategyProfileId: selected.definition.expertStrategyProfileId }
        : {})
    }
  }
}
