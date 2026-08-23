import { describe, expect, it } from 'vitest'
import { asCardId } from '../../../game/content/cards'
import type { OpeningCard } from '../../../game/match'
import { buildDeckTrackerEntries } from './deck-tracker-model'

function card(instanceId: string, cardId: string): OpeningCard {
  return { instanceId, cardId: asCardId(cardId) }
}

describe('buildDeckTrackerEntries', () => {
  it('groups remaining copies and sorts them by cost, then name', () => {
    const entries = buildDeckTrackerEntries([
      card('one', 'basic_boulderfist_ogre'),
      card('two', 'basic_frostbolt'),
      card('three', 'basic_arcane_intellect'),
      card('four', 'basic_frostbolt')
    ])

    expect(
      entries.map((entry) => ({ cardId: entry.cardId, count: entry.count }))
    ).toEqual([
      { cardId: 'basic_frostbolt', count: 2 },
      { cardId: 'basic_arcane_intellect', count: 1 },
      { cardId: 'basic_boulderfist_ogre', count: 1 }
    ])
  })

  it('returns an empty list when the deck is empty', () => {
    expect(buildDeckTrackerEntries([])).toEqual([])
  })
})
