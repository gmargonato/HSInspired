import { describe, expect, it } from 'vitest'
import { parseAiDecisionRequest, parseAiDecisionResponse } from './ai'

describe('AI IPC contracts', () => {
  it('accepts a structured request and response', () => {
    const request = parseAiDecisionRequest({
      decisionId: 'turn-4-0',
      phase: 'turn',
      matchRevision: 4,
      strategySummary: 'Control the board.',
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
      rationale: 'No useful action remains.',
      strategicIntent: 'Preserve resources.',
      strategySummary: 'Control the board.',
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
        matchRevision: 1,
        strategySummary: '',
        gameState: {},
        legalActions: [action, action]
      })
    ).toThrow('action ids must be unique')
  })
})
