import { describe, expect, it } from 'vitest'
import {
  parseAiDeckPlanRequest,
  parseAiDeckPlanResponse,
  parseAiDecisionRequest,
  parseAiDecisionResponse
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
        archetype: 'combo',
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
            releaseWhen: verboseRule
          }
        ],
        mulliganPriorityCardIds: ['basic_frostbolt']
      },
      rationale: verboseStrategy,
      modelId: 'test-model'
    })
    expect(response.plan.resourceRules[0]?.cardIds).toContain('classic_ice_lance')
    expect(response.plan.primaryWinCondition).toHaveLength(500)
    expect(response.plan.combos[0]?.purpose).toHaveLength(240)
    expect(response.plan.resourceRules[0]?.preserveUntil).toHaveLength(240)
    expect(response.plan.resourceRules[0]?.releaseWhen).toHaveLength(240)
    expect(response.rationale).toHaveLength(500)
  })
})
