import { describe, expect, it } from 'vitest'
import {
  ARENA_DECK_ID,
  HERO_CATALOG,
  asCardId,
  type ArenaRunSnapshot
} from '../../../game'
import { buildArenaDeckEntries, buildArenaManaCurve } from './arena-model'

function run(cards: Readonly<Record<string, number>>): ArenaRunSnapshot {
  const timestamp = new Date(0).toISOString()
  return {
    id: ARENA_DECK_ID,
    phase: 'drafting',
    heroChoices: [
      HERO_CATALOG.require('jaina').id,
      HERO_CATALOG.require('guldan').id,
      HERO_CATALOG.require('rexxar').id
    ],
    heroId: HERO_CATALOG.require('jaina').id,
    cardChoices: [
      asCardId('basic_arcane_missiles'),
      asCardId('basic_fireball'),
      asCardId('basic_frostbolt')
    ],
    cards,
    picksCompleted: Object.values(cards).reduce((sum, count) => sum + count, 0),
    gamesPlayed: 0,
    wins: 0,
    defeats: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

describe('Arena presentation model', () => {
  it('sorts grouped deck entries by mana cost then name', () => {
    const entries = buildArenaDeckEntries(
      run({ basic_fireball: 2, basic_arcane_missiles: 1 })
    )
    expect(entries.map((entry) => entry.card.id)).toEqual([
      'basic_arcane_missiles',
      'basic_fireball'
    ])
    expect(entries[1].count).toBe(2)
  })

  it('groups seven-or-more mana cards in the final curve bucket', () => {
    const curve = buildArenaManaCurve(
      run({ basic_arcane_missiles: 2, basic_flamestrike: 3 })
    )
    expect(curve[1]).toBe(2)
    expect(curve[7]).toBe(3)
  })
})
