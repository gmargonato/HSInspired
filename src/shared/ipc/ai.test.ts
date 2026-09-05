import { describe, expect, it } from 'vitest'
import {
  aiIpcFailure,
  aiIpcSuccess,
  parseAiDeckPlanRequest,
  parseAiDeckPlanResponse,
  parseAiCriticDecisionResponse,
  parseAiDecisionRequest,
  parseAiDecisionResponse,
  parseAiRankDecisionResponse,
  parseAiStrategyReviewRequest,
  parseAiStrategyReviewResponse,
  unwrapAiIpcResult
} from './ai'

describe('AI IPC contracts', () => {
  it('accepts a structured request and response', () => {
    const request = parseAiDecisionRequest({
      decisionId: 'turn-4-0',
      phase: 'turn',
      decisionClass: 'turn',
      matchRevision: 4,
      promptVersion: 'test-v1',
      contextVersion: 3,
      schemaVersion: 2,
      deadlineAtMs: 1,
      gameState: { turnNumber: 2 },
      legalActions: [
        {
          id: 'action-0',
          kind: 'end-turn',
          description: 'End the current turn.',
          details: {}
        }
      ]
    })
    expect(request.legalActions[0]?.id).toBe('action-0')

    const response = parseAiDecisionResponse({
      actionId: 'action-0',
      decisionClass: 'turn',
      rationale: 'No useful action remains.',
      modelId: 'test-model'
    })
    expect(response.actionId).toBe('action-0')
  })

  it('rejects duplicate action ids before crossing IPC', () => {
    const action = {
      id: 'duplicate',
      kind: 'end-turn',
      description: 'End turn.',
      details: {}
    }
    expect(() =>
      parseAiDecisionRequest({
        decisionId: 'turn-1-0',
        phase: 'turn',
        decisionClass: 'turn',
        matchRevision: 1,
        promptVersion: 'test-v1',
        contextVersion: 3,
        schemaVersion: 2,
        deadlineAtMs: 1,
        gameState: {},
        legalActions: [action, action]
      })
    ).toThrow('action ids must be unique')
  })

  it('rejects decision classes that do not belong to the request phase', () => {
    expect(() =>
      parseAiDecisionRequest({
        decisionId: 'turn-1-0',
        phase: 'turn',
        decisionClass: 'deck-plan',
        matchRevision: 1,
        promptVersion: 'test-v1',
        contextVersion: 3,
        schemaVersion: 2,
        deadlineAtMs: 1,
        gameState: {},
        legalActions: [
          {
            id: 'action-0',
            kind: 'end-turn',
            description: 'End turn.',
            details: {}
          }
        ]
      })
    ).toThrow('phase and decisionClass are inconsistent')
  })

  it('unwraps serializable IPC successes and failures', () => {
    expect(unwrapAiIpcResult(aiIpcSuccess({ value: 7 }), (value) => value)).toEqual({
      value: 7
    })
    expect(() =>
      unwrapAiIpcResult(aiIpcFailure(new Error('provider timed out')), () => null)
    ).toThrow('provider timed out')
  })

  it('validates complete rank and critic passes against the supplied ids', () => {
    const allowed = new Set(['action-a', 'action-b'])
    const rank = parseAiRankDecisionResponse(
      {
        pass: 'rank',
        preferredActionId: 'action-b',
        orderedActionIds: ['action-b', 'action-a'],
        confidence: 0.8,
        rationale: 'The second action has the safer response tree.'
      },
      allowed
    )
    expect(rank.orderedActionIds).toEqual(['action-b', 'action-a'])
    expect(
      parseAiCriticDecisionResponse(
        {
          pass: 'critic',
          finalActionId: 'action-a',
          retainedFirstChoice: false,
          identifiedRisks: ['The first choice releases a reserved resource.'],
          rationale: 'Override after downside review.'
        },
        allowed
      ).finalActionId
    ).toBe('action-a')
    expect(() =>
      parseAiRankDecisionResponse(
        {
          pass: 'rank',
          preferredActionId: 'action-a',
          orderedActionIds: ['action-a'],
          confidence: 1,
          rationale: 'Incomplete ordering.'
        },
        allowed
      )
    ).toThrow('complete supplied shortlist')
    expect(() =>
      parseAiRankDecisionResponse(
        {
          pass: 'rank',
          preferredActionId: 'action-a',
          orderedActionIds: ['action-a', 'action-a'],
          confidence: 1,
          rationale: 'Duplicate ordering.'
        },
        allowed
      )
    ).toThrow('must not contain duplicates')
  })

  it('validates bounded match-scoped deck plans', () => {
    const verboseStrategy = 'Keep advancing the primary winning line. '.repeat(20)
    const verboseRule =
      'Release this resource when the winning line requires it. '.repeat(10)
    const request = parseAiDeckPlanRequest({
      planId: 'plan-1',
      decisionClass: 'deck-plan',
      promptVersion: 'plan-v1',
      schemaVersion: 1,
      deadlineAtMs: 1,
      mode: { id: 'constructed' },
      deck: { id: 'freeze-mage' }
    })
    expect(request.decisionClass).toBe('deck-plan')

    const response = parseAiDeckPlanResponse({
      plan: {
        planVersion: 1,
        archetype: 'freeze setup into delayed burst',
        primaryWinCondition: verboseStrategy,
        secondaryWinCondition: 'Control the board.',
        earlyGamePriority: 'Draw.',
        midGamePriority: 'Survive.',
        lateGamePriority: 'Combo.',
        cardRoles: [{ cardId: 'basic_frostbolt', roles: ['combo-piece', 'removal'] }],
        combos: [
          {
            cardIds: ['basic_frostbolt', 'classic_ice_lance'],
            purpose: verboseRule
          }
        ],
        resourceRules: [
          {
            cardIds: ['basic_frostbolt', 'classic_ice_lance'],
            preserveUntil: verboseRule,
            releaseWhen: verboseRule,
            releaseTriggers: ['lethal', 'forced-survival', 'combo-ready']
          }
        ],
        mulliganPriorityCardIds: ['basic_frostbolt']
      },
      rationale: verboseStrategy,
      modelId: 'test-model'
    })
    expect(response.plan.resourceRules[0]?.cardIds).toContain('classic_ice_lance')
    expect(response.plan.archetype).toBe('freeze setup into delayed burst')
    expect(response.plan.primaryWinCondition).toHaveLength(500)
    expect(response.plan.combos[0]?.purpose).toHaveLength(240)
    expect(response.plan.resourceRules[0]?.preserveUntil).toHaveLength(240)
    expect(response.plan.resourceRules[0]?.releaseWhen).toHaveLength(240)
    expect(response.plan.resourceRules[0]?.releaseTriggers).toContain('lethal')
    expect(response.rationale).toHaveLength(500)
  })

  it('requires evidence reasons for a changed strategy review', () => {
    const request = parseAiStrategyReviewRequest({
      reviewId: 'review-4',
      decisionClass: 'strategy-review',
      promptVersion: 'review-v1',
      schemaVersion: 1,
      deadlineAtMs: 1,
      previousPlan: { planVersion: 1 },
      strategicMemory: { reviewReasons: ['Opponent revealed a finisher.'] },
      gameState: { informationPolicy: 'fair' }
    })
    expect(request.decisionClass).toBe('strategy-review')
    const unchangedPlan = {
      planVersion: 1,
      archetype: 'tempo',
      primaryWinCondition: 'Keep initiative.',
      secondaryWinCondition: 'Win through value.',
      earlyGamePriority: 'Develop.',
      midGamePriority: 'Pressure.',
      lateGamePriority: 'Finish.',
      cardRoles: [],
      combos: [],
      resourceRules: [],
      mulliganPriorityCardIds: []
    }
    expect(() =>
      parseAiStrategyReviewResponse({
        review: {
          reviewVersion: 1,
          changed: true,
          revisedPlan: unchangedPlan,
          changeReasons: [],
          opponentAssessment: 'Control is increasingly likely.'
        },
        rationale: 'Change without evidence.',
        modelId: 'gpt-5.4-nano'
      })
    ).toThrow('requires a public-evidence reason')
  })
})
