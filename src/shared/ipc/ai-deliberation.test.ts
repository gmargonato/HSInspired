import { describe, expect, it } from 'vitest'
import {
  aiChoiceSchema,
  parseAiDecisionChoice,
  sameAiIntent,
  validateAiChoicePhase
} from './ai-deliberation'
import { parseAiChoice, parseAiDecisionRequest } from './ai'

const intent = {
  type: 'end-turn',
  source: null,
  targets: [],
  position: null,
  option: null
}
const commit = { actionId: 'a0', intent, expectedResult: 'Pass.', planUpdate: null }
const check = {
  topic: 'action',
  ref: 'a0',
  question: 'What executes?',
  decisionImpact: 'Confirm intent.'
}
const plan = {
  objective: 'End.',
  winCheck: 'Not found.',
  lossRisk: 'Development.',
  candidates: [
    {
      sequence: ['End.'],
      budget: 'Zero.',
      endPosition: 'Same board.',
      opponentReply: 'Develop.'
    }
  ],
  preferred: 0,
  firstActionId: 'a0',
  checks: []
}

describe('bounded AI deliberation contract', () => {
  it('round-trips each choice while rejecting the obsolete bare action contract', () => {
    for (const choice of [commit, { plan }, { inspect: [check] }])
      expect(parseAiChoice({ reason: 'Brief.', choice })).toEqual({
        reason: 'Brief.',
        choice
      })
    expect(() => parseAiDecisionChoice({ actionId: 'a0' })).toThrow()
    expect(() => parseAiDecisionChoice({ plan: 'Old plan' })).toThrow()
    expect(() => parseAiDecisionChoice({ ...commit, inspect: [check] })).toThrow()
  })
  it('enforces array, text, index, and exact-field bounds locally', () => {
    for (const choice of [
      { inspect: [] },
      { inspect: Array(4).fill(check) },
      { inspect: [{ ...check, topic: 'hidden-hand' }] },
      { plan: { ...plan, preferred: 1 } },
      { plan: { ...plan, candidates: [] } },
      { plan: { ...plan, candidates: Array(3).fill(plan.candidates[0]) } },
      {
        plan: {
          ...plan,
          candidates: [{ ...plan.candidates[0], sequence: Array(7).fill('Step.') }]
        }
      },
      { ...commit, expectedResult: 'x'.repeat(601) },
      { ...commit, intent: { ...intent, position: -1 } },
      { ...commit, intent: { ...intent, position: 0.5 } },
      { ...commit, planUpdate: { objective: 'Only one field.' } }
    ])
      expect(() => parseAiDecisionChoice(choice)).toThrow()
  })
  it('permits an inspect branch only before cutoff and validates proposed action IDs', () => {
    const request = { actionIds: ['a0'], allowInspection: false }
    expect(aiChoiceSchema(request)).not.toHaveProperty('anyOf')
    expect(aiChoiceSchema({ ...request, allowInspection: true })).toHaveProperty(
      'anyOf'
    )
    expect(() =>
      validateAiChoicePhase(
        { plan: { ...plan, firstActionId: 'a9' } },
        { ...request, phase: 'plan' }
      )
    ).toThrow()
    expect(() =>
      validateAiChoicePhase(parseAiDecisionChoice({ inspect: [check] }), request)
    ).toThrow()
    expect(() =>
      parseAiDecisionRequest({
        matchId: 'm',
        requestId: 'r',
        expectedRevision: 0,
        actionIds: ['a0'],
        messages: [{ role: 'user', content: 'Go.' }],
        allowInspection: 'yes'
      })
    ).toThrow()
  })
  it('compares complete intent including ordered targets, position and option', () => {
    expect(sameAiIntent(intent, { ...intent })).toBe(true)
    for (const changed of [
      { type: 'play-card' },
      { source: 'card' },
      { targets: ['hero'] },
      { position: 0 },
      { option: 1 }
    ])
      expect(sameAiIntent(intent, { ...intent, ...changed })).toBe(false)
    expect(
      sameAiIntent(
        { ...intent, targets: ['a', 'b'] },
        { ...intent, targets: ['b', 'a'] }
      )
    ).toBe(false)
  })
})
