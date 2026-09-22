import { describe, expect, it } from 'vitest'
import { asPlayerId } from '../../../game/match/match-types'
import { forcedLegalCommand } from './ai-forced-command'

const ai = asPlayerId('ai')

describe('forcedLegalCommand', () => {
  it('returns the only command when pass is the sole option', () => {
    expect(forcedLegalCommand([{ type: 'end-turn', participantId: ai }])?.type).toBe(
      'end-turn'
    )
  })

  it('keeps pass as a decision when another command is also legal', () => {
    expect(
      forcedLegalCommand([
        {
          type: 'play-card',
          participantId: ai,
          cardInstanceId: 'ai-player:deck:18',
          position: 0
        },
        { type: 'end-turn', participantId: ai }
      ])
    ).toBeNull()
  })

  it('returns null when multiple actionable commands remain', () => {
    expect(
      forcedLegalCommand([
        {
          type: 'attack-character',
          participantId: ai,
          attacker: { kind: 'minion', instanceId: 'ai-player:deck:10' },
          defender: { kind: 'minion', instanceId: 'human-player:deck:8' }
        },
        {
          type: 'attack-character',
          participantId: ai,
          attacker: { kind: 'minion', instanceId: 'ai-player:deck:10' },
          defender: { kind: 'hero' }
        },
        { type: 'end-turn', participantId: ai }
      ])
    ).toBeNull()
  })
})
