import { describe, expect, it } from 'vitest'
import { aiActionIntent, validateAiCommitIntent } from './ai-action-intent'
import { asPlayerId, type TurnMatchCommand } from '../../../game-rules/match'

const opponentId = 'human-player'

describe('validateAiCommitIntent', () => {
  const playAtZero: TurnMatchCommand = {
    type: 'play-card',
    participantId: asPlayerId('ai-player'),
    cardInstanceId: 'ai-player:deck:18',
    position: 0
  }
  const expected = aiActionIntent(playAtZero, opponentId)

  it('accepts an exact intent match', () => {
    expect(validateAiCommitIntent(expected, playAtZero, opponentId)).toEqual({
      ok: true,
      intent: expected,
      normalized: false
    })
  })

  it.each([null, 1, 4] as const)(
    'accepts position-only mismatches without remapping the action (%s)',
    (position) => {
      const result = validateAiCommitIntent(
        { ...expected, position },
        playAtZero,
        opponentId
      )
      expect(result).toMatchObject({ ok: true, normalized: true, intent: expected })
    }
  )

  it('accepts extra targets on an untargeted hero power', () => {
    const heroPower: TurnMatchCommand = {
      type: 'use-hero-power',
      participantId: asPlayerId('ai-player')
    }
    const resolved = aiActionIntent(heroPower, opponentId)
    expect(
      validateAiCommitIntent(
        {
          ...resolved,
          targets: ['human-player:deck:29']
        },
        heroPower,
        opponentId
      )
    ).toMatchObject({ ok: true, normalized: true, intent: resolved })
  })

  it('accepts extra and unsorted targets when type, source and option match', () => {
    const targeted: TurnMatchCommand = {
      type: 'play-card',
      participantId: asPlayerId('ai-player'),
      cardInstanceId: 'ai-player:deck:28',
      position: 0,
      targets: [
        {
          kind: 'minion',
          participantId: asPlayerId('human-player'),
          instanceId: 'human-player:deck:8'
        }
      ]
    }
    const resolved = aiActionIntent(targeted, opponentId)
    expect(
      validateAiCommitIntent(
        {
          ...resolved,
          position: 2,
          targets: ['human-player:deck:27', 'human-player:deck:8']
        },
        targeted,
        opponentId
      )
    ).toMatchObject({ ok: true, normalized: true, intent: resolved })
  })

  it('rejects a play with the wrong source even when targets match', () => {
    const targeted: TurnMatchCommand = {
      type: 'play-card',
      participantId: asPlayerId('ai-player'),
      cardInstanceId: 'ai-player:deck:28',
      position: 0,
      targets: [{ kind: 'hero', participantId: asPlayerId('human-player') }]
    }
    const resolved = aiActionIntent(targeted, opponentId)
    expect(
      validateAiCommitIntent(
        { ...resolved, source: 'ai-player:deck:99' },
        targeted,
        opponentId
      ).ok
    ).toBe(false)
  })

  it('rejects a target mismatch on an attack', () => {
    const attack: TurnMatchCommand = {
      type: 'attack-character',
      participantId: asPlayerId('ai-player'),
      attacker: { kind: 'minion', instanceId: 'ai-player:deck:10' },
      defender: { kind: 'minion', instanceId: 'human-player:deck:8' }
    }
    const resolved = aiActionIntent(attack, opponentId)
    expect(
      validateAiCommitIntent(
        { ...resolved, targets: ['human-player:deck:27'] },
        attack,
        opponentId
      ).ok
    ).toBe(false)
  })

  it.each([
    [
      'extra replace ref',
      [
        'ai-player:deck:20',
        'ai-player:deck:27',
        'ai-player:deck:8',
        'ai-player:deck:23'
      ]
    ],
    ['wrong order', ['ai-player:deck:27', 'ai-player:deck:20', 'ai-player:deck:8']],
    ['missing ref', ['ai-player:deck:20']]
  ])(
    'accepts mulligan target-list mismatches when the action ID is already selected (%s)',
    (_label, targets) => {
      const mulligan: TurnMatchCommand = {
        type: 'confirm-mulligan',
        participantId: asPlayerId('ai-player'),
        replaceInstanceIds: [
          'ai-player:deck:20',
          'ai-player:deck:27',
          'ai-player:deck:8'
        ]
      }
      const resolved = aiActionIntent(mulligan, opponentId)
      expect(
        validateAiCommitIntent({ ...resolved, targets }, mulligan, opponentId)
      ).toMatchObject({ ok: true, normalized: true, intent: resolved })
    }
  )

  it('rejects a missing target on a targeted play', () => {
    const targeted: TurnMatchCommand = {
      type: 'play-card',
      participantId: asPlayerId('ai-player'),
      cardInstanceId: 'ai-player:deck:28',
      position: 0,
      targets: [{ kind: 'hero', participantId: asPlayerId('human-player') }]
    }
    const resolved = aiActionIntent(targeted, opponentId)
    expect(
      validateAiCommitIntent({ ...resolved, targets: [] }, targeted, opponentId).ok
    ).toBe(false)
  })
})
