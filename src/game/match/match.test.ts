import { describe, expect, it } from 'vitest'
import { asHeroId } from '../content/cards'
import { createMatch } from './match'
import { createHumanVsAiMatchSetup } from './match-setup'
import { createProofSetup, runMatchArchitectureProof } from './proof'
import { collectRandomSequence, createSeededRng } from './rng'

describe('headless match architecture proof', () => {
  it('accepts a serializable human-versus-AI setup and exposes state/events', () => {
    const setup = createProofSetup(17)
    const match = createMatch(JSON.parse(JSON.stringify(setup)))
    const result = match.dispatch({
      type: 'ready',
      participantId: setup.participants[0].participantId
    })

    expect(JSON.parse(JSON.stringify(match.getState()))).toEqual(match.getState())
    expect(result.accepted).toBe(true)
    expect(result.events.length).toBeGreaterThan(1)
    expect(JSON.parse(JSON.stringify(result.events))).toEqual(result.events)
  })

  it('builds a complete setup from the two deck selections', () => {
    const setup = createHumanVsAiMatchSetup(
      {
        humanDeck: { id: 'human-deck', heroId: asHeroId('jaina') },
        aiDeck: { id: 'ai-deck', heroId: asHeroId('guldan') }
      },
      17
    )

    expect(setup.participants).toHaveLength(2)
    expect(setup.participants.map((participant) => participant.controllerKind)).toEqual(
      ['human', 'ai']
    )
    expect(JSON.parse(JSON.stringify(setup))).toEqual(setup)
  })

  it('rejects invalid commands without mutating state', () => {
    const match = createMatch(createProofSetup())
    const before = match.getState()
    const result = match.dispatch({ type: 'invalid' })

    expect(result.accepted).toBe(false)
    expect(result.events).toEqual([])
    expect(match.getState()).toEqual(before)
  })

  it('uses the same command interface regardless of controller kind', () => {
    const setup = createProofSetup()
    const match = createMatch(setup)
    const human = match.dispatch({
      type: 'ready',
      participantId: setup.participants[0].participantId
    })
    const ai = match.dispatch({
      type: 'ready',
      participantId: setup.participants[1].participantId
    })

    expect(human.accepted).toBe(true)
    expect(ai.accepted).toBe(true)
    expect(ai.events.some((event) => event.type === 'match-ready')).toBe(true)
  })

  it('produces deterministic proof-level random output for the same seed', () => {
    expect(collectRandomSequence(createSeededRng(42), 5)).toEqual(
      collectRandomSequence(createSeededRng(42), 5)
    )
    const first = runMatchArchitectureProof(createProofSetup(99))
    const second = runMatchArchitectureProof(createProofSetup(99))
    expect(first.serialized).toBe(second.serialized)
  })
})
