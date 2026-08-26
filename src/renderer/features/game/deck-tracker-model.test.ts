import { asCardId } from '../../../game/content/cards'
import { describe, expect, it } from 'vitest'
import { buildDeckTrackerEntries } from './deck-tracker-model'

const deck = [
  { instanceId: 'first', cardId: asCardId('basic_fireball') },
  { instanceId: 'second', cardId: asCardId('classic_wisp') },
  { instanceId: 'third', cardId: asCardId('basic_fireball') }
] as const

describe('deck tracker entries', () => {
  it('groups normal views and orders them by the requested sort mode', () => {
    expect(buildDeckTrackerEntries(deck, 'cost')).toMatchObject([
      { cardId: 'classic_wisp', count: 1 },
      { cardId: 'basic_fireball', count: 2 }
    ])
    expect(buildDeckTrackerEntries(deck, 'alphabetical')).toMatchObject([
      { cardId: 'basic_fireball', count: 2 },
      { cardId: 'classic_wisp', count: 1 }
    ])
  })

  it('preserves the exact next-draw order for the shuffle cheat', () => {
    expect(buildDeckTrackerEntries(deck, 'draw-order')).toMatchObject([
      { cardId: 'basic_fireball', count: 1, drawPosition: 1 },
      { cardId: 'classic_wisp', count: 1, drawPosition: 2 },
      { cardId: 'basic_fireball', count: 1, drawPosition: 3 }
    ])
  })
})
