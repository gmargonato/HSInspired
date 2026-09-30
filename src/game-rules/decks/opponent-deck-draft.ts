import type { CardDefinition } from '../content/cards'
import { getCardCopyLimit, MAX_DECK_CARDS, type Deck } from './deck'
import {
  assessCuratedCard,
  OPPONENT_CURVE_TAGS,
  type OpponentTag
} from './opponent-curated-assessment'
import type { OpponentFloorRule } from './opponent-floors'

/** A floor filled first from the archetype's package pool. */
export interface ResolvedOpponentFloor extends OpponentFloorRule {
  readonly packageMinQuality?: number
}

const CURVE_TAGS = new Set<OpponentTag>(OPPONENT_CURVE_TAGS)
const tagCache = new WeakMap<CardDefinition, readonly OpponentTag[]>()

/**
 * Tags a card contributes to the floors. Quests start outside the drawable deck, so
 * they occupy a slot without shaping the curve; Hero cards count like any other card.
 */
export function opponentDeckTags(card: CardDefinition): readonly OpponentTag[] {
  if (card.type === 'Spell' && card.quest !== undefined) return []
  let tags = tagCache.get(card)
  if (!tags) {
    tags = assessCuratedCard(card).tags
    tagCache.set(card, tags)
  }
  return tags
}

/** Mutable list under construction with the counters every phase consults. */
export class OpponentDeckDraft {
  readonly cards: CardDefinition[] = []
  private readonly copies = new Map<string, number>()
  private readonly tagCounts = new Map<OpponentTag, number>()

  constructor(readonly floors: readonly ResolvedOpponentFloor[]) {}

  get size(): number {
    return this.cards.length
  }

  copiesOf(card: CardDefinition): number {
    return this.copies.get(card.id) ?? 0
  }

  count(tag: OpponentTag): number {
    return this.tagCounts.get(tag) ?? 0
  }

  deficit(floor: OpponentFloorRule): number {
    return Math.max(0, floor.min - this.count(floor.tag))
  }

  unmetFloors(): ResolvedOpponentFloor[] {
    return this.floors.filter((floor) => this.deficit(floor) > 0)
  }

  add(card: CardDefinition): void {
    this.cards.push(card)
    this.bump(card, 1)
  }

  removeAt(index: number): CardDefinition {
    const [removed] = this.cards.splice(index, 1)
    this.bump(removed, -1)
    return removed
  }

  /**
   * A card may join only if it respects its copy limit and every ceiling, and the
   * remaining slots can still satisfy every minimum. Curve buckets are disjoint, so
   * their combined shortfall must also fit.
   */
  accepts(card: CardDefinition): boolean {
    if (this.copiesOf(card) >= getCardCopyLimit(card)) return false
    const tags = opponentDeckTags(card)
    const remaining = MAX_DECK_CARDS - this.cards.length - 1
    let curveShortfall = 0
    for (const floor of this.floors) {
      const after = this.count(floor.tag) + Number(tags.includes(floor.tag))
      if (after > floor.max) return false
      const shortfall = Math.max(0, floor.min - after)
      if (shortfall > remaining) return false
      if (CURVE_TAGS.has(floor.tag)) curveShortfall += shortfall
    }
    return curveShortfall <= remaining
  }

  /** Whether swapping `removed` for `added` keeps every floor inside its window. */
  keepsFloorsAfterSwap(removed: CardDefinition, added: CardDefinition): boolean {
    const removedTags = opponentDeckTags(removed)
    const addedTags = opponentDeckTags(added)
    return this.floors.every((floor) => {
      const after =
        this.count(floor.tag) -
        Number(removedTags.includes(floor.tag)) +
        Number(addedTags.includes(floor.tag))
      return after >= floor.min && after <= floor.max
    })
  }

  record(): Deck['cards'] {
    const cards: Record<string, number> = {}
    for (const card of this.cards) cards[card.id] = (cards[card.id] ?? 0) + 1
    return cards
  }

  private bump(card: CardDefinition, delta: number): void {
    this.copies.set(card.id, this.copiesOf(card) + delta)
    for (const tag of opponentDeckTags(card))
      this.tagCounts.set(tag, this.count(tag) + delta)
  }
}
