import { describe, expect, it } from 'vitest'
import { createMatchScenario } from '../testing/match-scenario-builder'
import {
  insertCardIntoPlayer,
  moveCardForPlayer,
  removeCardFromPlayer
} from './zone-state'

describe('authoritative card zones', () => {
  it('moves cards without mutating the source player or changing identity', () => {
    const player = createMatchScenario({ seed: 12 }).match.getState().players[0]
    const card = player.deck[0]!
    const moved = moveCardForPlayer(player, card.instanceId, 'hand')

    expect(moved?.card.instanceId).toBe(card.instanceId)
    expect(moved?.from).toBe('deck')
    expect(player.deck.some((entry) => entry.instanceId === card.instanceId)).toBe(true)
    expect(
      moved?.player.deck.some((entry) => entry.instanceId === card.instanceId)
    ).toBe(false)
    expect(
      moved?.player.hand.find((entry) => entry.instanceId === card.instanceId)?.zone
    ).toBe('hand')
    expect(
      moved?.player.hand.find((entry) => entry.instanceId === card.instanceId)?.revealed
    ).toBe(true)
  })

  it('returns null for stale references and normalizes deck visibility', () => {
    const player = createMatchScenario({ seed: 13 }).match.getState().players[0]
    expect(removeCardFromPlayer(player, 'missing-card')).toBeNull()
    const card = player.hand[0]!
    const updated = insertCardIntoPlayer(
      player,
      { ...card, zone: 'hand', revealed: true },
      'deck',
      0
    )
    expect(updated.deck[0]?.instanceId).toBe(card.instanceId)
    expect(updated.deck[0]?.zone).toBe('deck')
    expect(updated.deck[0]?.revealed).toBe(false)
  })
})
