import { describe, expect, it } from 'vitest'
import { answerAiChecks } from './ai-fact-checks'
import { aiActionIntent } from './ai-action-intent'
import type { AiFactCheck } from '../../../shared/ipc/ai-deliberation'
import type { JsonObject } from '../../../shared/ipc/ai'
import type { TurnMatchCommand } from '../../../game/match'

const snapshot: JsonObject = {
  remainingDeck: { Voidwalker: 2 },
  players: [
    {
      role: 'self',
      hero: { instanceId: 'ai:hero', health: 3 },
      hand: [
        {
          ref: 'live-copy',
          name: 'Dragon',
          cost: 2,
          battlecryConditions: [{ status: 'not-met', matchingHandRefs: [] }]
        }
      ],
      graveyard: { Dragon: 1 },
      mana: { available: 2 },
      handSize: 1
    },
    {
      role: 'opponent',
      hero: { instanceId: 'human:hero', health: 20 },
      handSize: 5,
      board: [{ ref: 'target', name: 'Tentacle', attack: 2, health: 2 }],
      secrets: [{ unknown: true }]
    }
  ]
}
const check = (topic: AiFactCheck['topic'], ref: string): AiFactCheck => ({
  topic,
  ref,
  question: 'Check the relevant fact.',
  decisionImpact: 'Confirm or revise the line.'
})
const answer = (topic: AiFactCheck['topic'], ref: string) =>
  answerAiChecks([check(topic, ref)], snapshot, [], ['A public event.'], 51)[0]!

describe('AI fair factual inspection', () => {
  it('returns live references and scoped conditions, not a dead copy or a hypothetical effect', () => {
    expect(answer('entity', 'live-copy')).toMatchObject({
      status: 'known',
      revision: 51,
      facts: { zone: 'hand', cost: 2 }
    })
    expect(answer('entity', 'dead-copy')).toMatchObject({ status: 'unknown' })
    expect(answer('condition', 'live-copy')).toMatchObject({
      facts: [{ status: 'not-met' }]
    })
    expect(answer('condition', 'target')).toMatchObject({ status: 'unsupported' })
  })
  it('cannot expose an opponent hidden instance, deck order, or a future draw', () => {
    const before = structuredClone(snapshot)
    for (const ref of ['human:deck:0', 'human:secret:0', 'rng', 'next-draw'])
      expect(answer('entity', ref).status).toBe('unknown')
    expect(answer('resources', 'opponent').facts).not.toHaveProperty('remainingDeck')
    expect(answer('resources', 'self')).toMatchObject({
      facts: { remainingDeck: { Voidwalker: 2 } }
    })
    expect(answer('resources', 'next-draw').status).toBe('unsupported')
    expect(snapshot).toEqual(before)
  })
  it('distinguishes public definitions from current instances and unknown catalog references', () => {
    expect(answer('mechanics', 'catalog:classic_leeroy_jenkins')).toMatchObject({
      status: 'known',
      facts: { name: 'Leeroy Jenkins' }
    })
    expect(answer('mechanics', 'catalog:Does not exist').status).toBe('unsupported')
    expect(answer('mechanics', 'human:deck:0').status).toBe('unknown')
    expect(answer('history', 'self')).toMatchObject({
      facts: { graveyard: { Dragon: 1 }, recentPublicEvents: ['A public event.'] }
    })
  })
  it('maps hero attacks, friendly power targets, grouped positions and mulligan selections exactly', () => {
    const map = (command: unknown) =>
      aiActionIntent(command as TurnMatchCommand, 'human')
    expect(
      map({
        type: 'attack-character',
        participantId: 'ai',
        attacker: { kind: 'hero' },
        defender: { kind: 'hero' }
      })
    ).toMatchObject({ source: 'ai:hero', targets: ['human:hero'] })
    expect(
      map({
        type: 'use-hero-power',
        participantId: 'ai',
        target: { kind: 'hero', participantId: 'ai' }
      })
    ).toMatchObject({ source: 'ai:hero-power', targets: ['ai:hero'] })
    expect(
      map({
        type: 'play-card',
        participantId: 'ai',
        cardInstanceId: 'c',
        position: 0,
        choice: 1,
        targets: [{ kind: 'minion', participantId: 'human', instanceId: 'target' }]
      })
    ).toMatchObject({ source: 'c', position: 0, option: 1, targets: ['target'] })
    expect(
      map({
        type: 'confirm-mulligan',
        participantId: 'ai',
        replaceInstanceIds: ['z', 'a']
      })
    ).toMatchObject({ targets: ['a', 'z'] })
    expect(
      map({ type: 'choose-discover-card', participantId: 'ai', cardInstanceId: 'c' })
    ).toMatchObject({ source: 'c' })
    expect(
      map({
        type: 'choose-card-option',
        participantId: 'ai',
        sourceCardInstanceId: 'c',
        choice: 2
      })
    ).toMatchObject({ source: 'c', option: 2 })
  })
})
