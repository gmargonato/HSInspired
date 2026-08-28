import { describe, expect, it } from 'vitest'
import { asPlayerId, type OpeningCommandResult } from '../../../game/match'
import type { DevCommand } from '../../../shared/dev-menu'
import { dispatchDevMatchCommand } from './dev-match-command-dispatch'

describe('development match command dispatch', () => {
  it('maps each state-editing menu command through the canonical match boundary', () => {
    const commands: readonly DevCommand[] = [
      { type: 'game:draw', target: 'local' },
      { type: 'game:set-mana', target: 'remote', available: 3, maximum: 7 },
      { type: 'game:set-hero', target: 'local', health: 12, armor: 4, attack: 2 },
      { type: 'game:set-hero-power', target: 'remote', cost: 1, action: 'consume' },
      { type: 'game:set-fatigue', target: 'local', nextDamage: 5 },
      { type: 'game:clear-zone', target: 'remote', zone: 'board' },
      { type: 'game:remove-weapon', target: 'local' }
    ]
    const calls: unknown[] = []
    const rejected = {
      accepted: false,
      code: 'invalid-command',
      message: 'test',
      state: {},
      events: []
    } as unknown as OpeningCommandResult
    const participantIdForTarget = (target: 'local' | 'remote') =>
      asPlayerId(target + '-player')

    for (const command of commands) {
      expect(
        dispatchDevMatchCommand(
          (matchCommand) => {
            calls.push(matchCommand)
            return rejected
          },
          command,
          participantIdForTarget
        )
      ).toBe(rejected)
    }

    expect(calls).toEqual([
      { type: 'dev-draw', participantId: asPlayerId('local-player') },
      {
        type: 'dev-set-mana',
        participantId: asPlayerId('remote-player'),
        available: 3,
        maximum: 7
      },
      {
        type: 'dev-set-hero',
        participantId: asPlayerId('local-player'),
        health: 12,
        armor: 4,
        attack: 2
      },
      {
        type: 'dev-set-hero-power',
        participantId: asPlayerId('remote-player'),
        cost: 1,
        available: false
      },
      {
        type: 'dev-set-fatigue',
        participantId: asPlayerId('local-player'),
        nextDamage: 5
      },
      {
        type: 'dev-clear-zone',
        participantId: asPlayerId('remote-player'),
        zone: 'board'
      },
      { type: 'dev-remove-weapon', participantId: asPlayerId('local-player') }
    ])
  })

  it('leaves non-state menu commands to their dedicated handlers', () => {
    expect(
      dispatchDevMatchCommand(
        () => {
          throw new Error('dispatch should not be called')
        },
        { type: 'game:toggle-tracker' },
        () => asPlayerId('local-player')
      )
    ).toBeNull()
  })
})
