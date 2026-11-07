import { describe, expect, it } from 'vitest'
import { CARD_CATALOG } from '../content/cards'
import { DeckRules } from './deck-rules'
import { CURATED_OPPONENT_DECKS } from './curated-opponent-decks'
import { selectCuratedConstructedOpponent } from './curated-opponent-selection'
import { SHORTLISTED_OPPONENT_DECK_DEFINITIONS } from './shortlisted-opponent-decks'

const normalize = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]/gu, '')
    .toLowerCase()

describe('approved shortlist AI deck registration', () => {
  it('adds exactly thirteen thirty-card lists without removing the original thirty-six', () => {
    expect(SHORTLISTED_OPPONENT_DECK_DEFINITIONS).toHaveLength(13)
    expect(CURATED_OPPONENT_DECKS).toHaveLength(49)
    expect(
      CURATED_OPPONENT_DECKS.slice(0, 36).every(
        ({ definition }) => !definition.id.startsWith('shortlist-')
      )
    ).toBe(true)
    expect(
      CURATED_OPPONENT_DECKS.slice(36).map(({ definition }) => definition.id)
    ).toEqual(SHORTLISTED_OPPONENT_DECK_DEFINITIONS.map(({ id }) => id))
  })

  for (const definition of SHORTLISTED_OPPONENT_DECK_DEFINITIONS) {
    it(`loads the exact source list and normal selection for ${definition.name}`, () => {
      const selected = selectCuratedConstructedOpponent(20261107, definition.id)
      expect(new DeckRules().validate(selected.deck)).toEqual([])
      expect(
        Object.values(selected.deck.cards).reduce((sum, count) => sum + count, 0)
      ).toBe(30)
      const resolvedNames = Object.fromEntries(
        Object.entries(selected.deck.cards).map(([id, count]) => [
          normalize(CARD_CATALOG.require(id).name),
          count
        ])
      )
      const approvedNames = Object.fromEntries(
        Object.entries(definition.cardList).map(([name, count]) => [
          normalize(name),
          count
        ])
      )
      expect(resolvedNames).toEqual(approvedNames)
      expect(selected.metadata.deckName).toBe(definition.name)
      expect(['Death Knight', 'Demon Hunter']).not.toContain(selected.metadata.classId)
    })
  }

  it('can select every new deck through the ordinary seeded pool', () => {
    const seen = new Set<string>()
    for (let seed = 0; seed < 10000; seed++)
      seen.add(selectCuratedConstructedOpponent(seed).metadata.deckId)
    for (const definition of SHORTLISTED_OPPONENT_DECK_DEFINITIONS)
      expect(seen.has(definition.id), definition.id).toBe(true)
  })
})
