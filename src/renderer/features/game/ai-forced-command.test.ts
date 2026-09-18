import { describe, expect, it } from 'vitest'
import { forcedLegalCommand } from './ai-forced-command'

describe('forcedLegalCommand', () => {
  it('returns the only command when pass is the sole option', () => {
    expect(
      forcedLegalCommand([{ type: 'end-turn', participantId: 'ai' }])?.type
    ).toBe('end-turn')
  })

  it('returns the unique non-pass command when pass is also legal', () => {
    expect(
      forcedLegalCommand([
        {
          type: 'play-card',
          participantId: 'ai',
          cardInstanceId: 'ai-player:deck:18',
          position: 0
        },
        { type: 'end-turn', participantId: 'ai' }
      ])
    ).toMatchObject({ type: 'play-card', position: 0 })
  })

  it('returns null when multiple actionable commands remain', () => {
    expect(
      forcedLegalCommand([
        {
          type: 'attack-character',
          participantId: 'ai',
          attacker: { kind: 'minion', instanceId: 'ai-player:deck:10' },
          defender: { kind: 'minion', instanceId: 'human-player:deck:8' }
        },
        {
          type: 'attack-character',
          participantId: 'ai',
          attacker: { kind: 'minion', instanceId: 'ai-player:deck:10' },
          defender: { kind: 'hero' }
        },
        { type: 'end-turn', participantId: 'ai' }
      ])
    ).toBeNull()
  })
})
