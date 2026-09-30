import { describe, expect, it } from 'vitest'
import { describeAiEvents } from './event-narrative'
import type { OpeningMatchPublicEvent } from '../opening-match-types'

const narrate = (events: unknown[]) =>
  describeAiEvents(events as OpeningMatchPublicEvent[], 'ai-player').join('\n')
describe('AI event perspective', () => {
  it('uses the current controller for prose while keeping original instance IDs', () => {
    const text = narrate([
      {
        type: 'history-action-resolved',
        participantId: 'ai-player',
        action: 'combat',
        source: {
          participantId: 'ai-player',
          kind: 'minion',
          cardId: 'classic_loot_hoarder',
          id: 'human-player:deck:9'
        },
        outcomes: []
      }
    ])
    expect(text).toBe('You attacked with your Loot Hoarder [human-player:deck:9].')
  })
  it('names hero powers even when their history source has hero kind', () => {
    const text = narrate([
      {
        type: 'history-action-resolved',
        participantId: 'human-player',
        action: 'hero-power',
        source: {
          participantId: 'human-player',
          kind: 'hero',
          heroPowerId: 'mage-fireblast',
          id: 'human-player:hero-power'
        },
        outcomes: []
      }
    ])
    expect(text).toBe(
      "Your opponent used your opponent's Fireblast [human-player:hero-power]."
    )
  })
  it('keeps concealed secrets hidden and labels turns and mulligans consistently', () => {
    const text = narrate([
      { type: 'turn-started', participantId: 'ai-player', turnNumber: 2 },
      {
        type: 'mulligan-resolved',
        participantId: 'human-player',
        returnedCards: [null],
        replacementCards: []
      },
      {
        type: 'history-action-resolved',
        participantId: 'human-player',
        action: 'card',
        source: {
          participantId: 'human-player',
          kind: 'spell',
          concealedAs: 'secret',
          cardId: 'classic_ice_block',
          id: 'human-player:deck:3'
        },
        outcomes: []
      }
    ])
    expect(text).toContain('Your turn began (global turn 2).')
    expect(text).toContain('Your opponent replaced 1 opening cards')
    expect(text).toContain('unrevealed Secret')
    expect(text).not.toContain('Ice Block')
  })
  it('summarizes combat health and durability without misleading raw damage labels', () => {
    const attacker = {
      participantId: 'ai-player',
      character: { kind: 'hero' },
      attack: 3,
      attemptedDamage: 0,
      healthBefore: 30,
      healthAfter: 30,
      armorBefore: 0,
      armorAfter: 0,
      destroyed: false
    }
    const defender = {
      ...attacker,
      participantId: 'human-player',
      attack: 0,
      attemptedDamage: 3,
      healthAfter: 27
    }
    const text = narrate([
      { type: 'combat-started', combatId: 'c', attacker, defender },
      {
        type: 'character-combat-resolved',
        combatId: 'c',
        attacker,
        defender,
        weapon: { participantId: 'ai-player', durabilityBefore: 2, durabilityAfter: 1 }
      }
    ])
    expect(text.split('\n')).toHaveLength(1)
    expect(text).toContain('health 30 → 27')
    expect(text).toContain('your weapon durability 2 → 1')
    expect(text).not.toContain('damageDealt')
  })
})
