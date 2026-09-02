import { describe, expect, it, vi } from 'vitest'
import type { Deck } from '../../../game/decks'
import { asCardId, asHeroId } from '../../../game/content/cards'
import { asPlayerId, type MatchSetup } from '../../../game/match'
import type { AiDecisionApi, AiDecisionRequest } from '../../../shared/ipc/ai'
import { GameBoardSession } from './game-board-session'
import { createFallbackDeckPlan, createFallbackMatchupPlan } from './ai-deck-strategy'
import { AiTurnController } from './ai-turn-controller'

const humanId = asPlayerId('human')
const aiId = asPlayerId('ai')

function deck(id: string, heroId: string, cardId = 'basic_acidic_swamp_ooze'): Deck {
  return {
    id,
    name: id,
    heroId: asHeroId(heroId),
    cards: { [cardId]: 30 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('AiTurnController', () => {
  async function requestFacingSecret(secretId: string): Promise<AiDecisionRequest> {
    const humanDeck = deck('human-secret-deck', 'jaina', 'basic_bloodfen_raptor')
    const aiDeck = deck('ai-secret-deck', 'guldan')
    const setup: MatchSetup = {
      seed: 17,
      participants: [
        {
          participantId: humanId,
          controllerKind: 'human',
          heroId: humanDeck.heroId,
          deckId: humanDeck.id
        },
        {
          participantId: aiId,
          controllerKind: 'ai',
          heroId: aiDeck.heroId,
          deckId: aiDeck.id
        }
      ]
    }
    const session = new GameBoardSession({ setup, decks: [humanDeck, aiDeck] })
    expect(
      session.dispatch({
        type: 'confirm-mulligan',
        participantId: humanId,
        replaceInstanceIds: []
      }).accepted
    ).toBe(true)
    expect(
      session.dispatch({
        type: 'confirm-mulligan',
        participantId: aiId,
        replaceInstanceIds: []
      }).accepted
    ).toBe(true)
    if (session.getState().activePlayerId === aiId) {
      expect(session.dispatch({ type: 'end-turn', participantId: aiId }).accepted).toBe(
        true
      )
    }
    expect(session.getState().activePlayerId).toBe(humanId)
    expect(
      session.dispatch({
        type: 'dev-add-card',
        participantId: humanId,
        cardId: asCardId(secretId)
      }).accepted
    ).toBe(true)
    expect(
      session.dispatch({
        type: 'dev-set-mana',
        participantId: humanId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const secret = session
      .findPlayer(session.getState(), humanId)
      .hand.find((card) => card.cardId === secretId)!
    expect(
      session.dispatch({
        type: 'play-card',
        participantId: humanId,
        cardInstanceId: secret.instanceId
      }).accepted
    ).toBe(true)
    expect(
      session.dispatch({ type: 'end-turn', participantId: humanId }).accepted
    ).toBe(true)

    const requests: AiDecisionRequest[] = []
    const api: AiDecisionApi = {
      decide: async (request) => {
        requests.push(request)
        const action =
          request.legalActions.find((candidate) => candidate.kind === 'end-turn') ??
          request.legalActions[0]!
        return {
          actionId: action.id,
          decisionClass: request.decisionClass,
          rationale: 'Use only public information.',
          modelId: 'test-model'
        }
      }
    }
    const controller = new AiTurnController({
      api,
      session,
      decks: [humanDeck, aiDeck],
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    })
    await controller.chooseTurnAction()
    const captured = requests[0]
    if (!captured) throw new Error('The controller did not issue a decision request.')
    return captured
  }

  it('does not leak a secret identity through context, previews, or shortlisting', async () => {
    const mirrorRequest = await requestFacingSecret('classic_mirror_entity')
    const counterspellRequest = await requestFacingSecret('classic_counterspell')
    const mirrorState = mirrorRequest.gameState['currentState'] as {
      players: Array<{
        participantId: string
        secrets: Array<{ cardId: string | null }>
      }>
    }
    expect(
      mirrorState.players.find((player) => player.participantId === humanId)?.secrets
    ).toEqual([expect.objectContaining({ cardId: null })])
    expect(
      mirrorRequest.legalActions.every((action) => action.analysis?.uncertain === true)
    ).toBe(true)
    expect(mirrorRequest.gameState).toEqual(counterspellRequest.gameState)
    expect(mirrorRequest.legalActions).toEqual(counterspellRequest.legalActions)
  })

  it('marks Frostbolt as a reserved combo resource instead of free face damage', async () => {
    const humanDeck = deck('human-control', 'garrosh', 'basic_bloodfen_raptor')
    const aiDeck: Deck = {
      ...deck('ai-freeze', 'jaina'),
      cards: {
        basic_frostbolt: 2,
        classic_ice_lance: 2,
        basic_chillwind_yeti: 26
      }
    }
    const session = new GameBoardSession({
      setup: {
        seed: 23,
        participants: [
          {
            participantId: humanId,
            controllerKind: 'human',
            heroId: humanDeck.heroId,
            deckId: humanDeck.id
          },
          {
            participantId: aiId,
            controllerKind: 'ai',
            heroId: aiDeck.heroId,
            deckId: aiDeck.id
          }
        ]
      },
      decks: [humanDeck, aiDeck]
    })
    for (const participantId of [humanId, aiId]) {
      expect(
        session.dispatch({
          type: 'confirm-mulligan',
          participantId,
          replaceInstanceIds: []
        }).accepted
      ).toBe(true)
    }
    if (session.getState().activePlayerId === humanId) {
      expect(
        session.dispatch({ type: 'end-turn', participantId: humanId }).accepted
      ).toBe(true)
    }
    expect(
      session.dispatch({
        type: 'dev-clear-zone',
        participantId: aiId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      session.dispatch({
        type: 'dev-add-card',
        participantId: aiId,
        cardId: asCardId('basic_frostbolt')
      }).accepted
    ).toBe(true)
    expect(
      session.dispatch({
        type: 'dev-set-mana',
        participantId: aiId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)

    const requests: AiDecisionRequest[] = []
    const controller = new AiTurnController({
      api: {
        decide: async (request) => {
          requests.push(request)
          const action =
            request.legalActions.find((candidate) => candidate.kind === 'end-turn') ??
            request.legalActions[0]!
          return {
            actionId: action.id,
            decisionClass: request.decisionClass,
            rationale: 'Preserve the combo.',
            modelId: 'test-model'
          }
        }
      },
      session,
      decks: [humanDeck, aiDeck],
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    })
    await controller.chooseTurnAction()
    const captured = requests[0]
    if (!captured) throw new Error('The controller did not issue a decision request.')
    const frostboltLines = captured.legalActions.filter((action) => {
      const card = action.details['card']
      return (
        typeof card === 'object' &&
        card !== null &&
        !Array.isArray(card) &&
        card['cardId'] === 'basic_frostbolt'
      )
    })
    expect(frostboltLines.length).toBeGreaterThan(0)
    expect(
      frostboltLines.every((action) => action.analysis?.planResourceCost === 120)
    ).toBe(true)
  })

  it('sends a fair strategic state and selects only an engine-issued action id', async () => {
    const humanDeck = deck('human-deck', 'jaina', 'basic_bloodfen_raptor')
    const aiDeck = deck('ai-deck', 'guldan', 'basic_murloc_raider')
    const setup: MatchSetup = {
      seed: 3,
      participants: [
        {
          participantId: humanId,
          controllerKind: 'human',
          heroId: humanDeck.heroId,
          deckId: humanDeck.id
        },
        {
          participantId: aiId,
          controllerKind: 'ai',
          heroId: aiDeck.heroId,
          deckId: aiDeck.id
        }
      ]
    }
    const session = new GameBoardSession({ setup, decks: [humanDeck, aiDeck] })
    const requests: AiDecisionRequest[] = []
    const api: AiDecisionApi = {
      decide: async (request) => {
        requests.push(request)
        const action =
          request.legalActions.find((candidate) => candidate.kind === 'end-turn') ??
          request.legalActions[0]!
        return {
          actionId: action.id,
          decisionClass: request.decisionClass,
          rationale: 'Chosen from the legal list.',
          modelId: 'test-model'
        }
      }
    }
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
    const controller = new AiTurnController({
      api,
      session,
      decks: [humanDeck, aiDeck],
      logger
    })

    const mulligan = await controller.chooseMulligan()
    expect(mulligan.command.type).toBe('confirm-mulligan')
    expect(session.getAiObservedEvents()).toEqual([])
    expect(session.dispatch(mulligan.command).accepted).toBe(true)
    expect(
      session.dispatch({
        type: 'confirm-mulligan',
        participantId: humanId,
        replaceInstanceIds: []
      }).accepted
    ).toBe(true)
    if (session.getState().activePlayerId === humanId) {
      expect(
        session.dispatch({ type: 'end-turn', participantId: humanId }).accepted
      ).toBe(true)
    }
    expect(session.getState().activePlayerId).toBe(aiId)

    const decision = await controller.chooseTurnAction()
    const turnRequest = requests.at(-1)!
    const currentState = turnRequest.gameState['currentState'] as {
      players: Array<{
        participantId: string
        hand: Array<{ cardId: string | null }>
        deck: Array<{ instanceId?: string; cardId: string | null }>
      }>
    }
    const human = currentState.players.find(
      (player) => player.participantId === humanId
    )!
    const ai = currentState.players.find((player) => player.participantId === aiId)!

    expect(human.hand.every((card) => card.cardId === null)).toBe(true)
    expect(ai.hand.every((card) => typeof card.cardId === 'string')).toBe(true)
    expect(human.deck.every((card) => card.cardId === null)).toBe(true)
    expect(ai.deck.every((card) => card.cardId === null)).toBe(true)
    expect(
      [...human.deck, ...ai.deck].every((card) => card.instanceId === undefined)
    ).toBe(true)
    expect(turnRequest.gameState['contextVersion']).toBe(4)
    expect(turnRequest.gameState['informationPolicy']).toBe('fair')
    expect(turnRequest.gameState['perspective']).toMatchObject({
      selfParticipantId: aiId,
      opponentParticipantId: humanId,
      hiddenHandsKnown: false,
      hiddenSecretsKnown: false,
      exactRemainingDeckOrderKnown: false
    })
    expect(turnRequest.gameState['selfOriginalDeck']).toMatchObject({
      id: aiDeck.id,
      heroId: aiDeck.heroId
    })
    expect(turnRequest.gameState).not.toHaveProperty('originalDecks')
    expect(turnRequest.gameState['cardDefinitions']).toMatchObject({
      basic_murloc_raider: { name: 'Murloc Raider' }
    })
    expect(turnRequest.gameState['cardDefinitions']).not.toHaveProperty(
      'basic_bloodfen_raptor'
    )
    expect(currentState).not.toHaveProperty('history')
    expect(currentState).not.toHaveProperty('effectTrace')
    expect(currentState).not.toHaveProperty('scheduledEffects')
    expect(turnRequest.gameState['recentPublicEvents']).toBeInstanceOf(Array)
    expect(turnRequest.legalActions.length).toBeLessThanOrEqual(12)
    expect(
      turnRequest.legalActions.every((action) => action.analysis !== undefined)
    ).toBe(true)
    expect(
      turnRequest.legalActions.every(
        (action) => !Object.prototype.hasOwnProperty.call(action.details, 'analysis')
      )
    ).toBe(true)
    expect(
      turnRequest.legalActions.some((action) => action.id === decision.actionId)
    ).toBe(true)
    expect(decision.command.type).toBe('end-turn')
  })

  it('uses the local fallback without retrying a transient provider failure', async () => {
    const humanDeck = deck('human-deck', 'jaina')
    const aiDeck = deck('ai-deck', 'guldan')
    const setup: MatchSetup = {
      seed: 4,
      participants: [
        {
          participantId: humanId,
          controllerKind: 'human',
          heroId: humanDeck.heroId,
          deckId: humanDeck.id
        },
        {
          participantId: aiId,
          controllerKind: 'ai',
          heroId: aiDeck.heroId,
          deckId: aiDeck.id
        }
      ]
    }
    const session = new GameBoardSession({ setup, decks: [humanDeck, aiDeck] })
    let calls = 0
    const api: AiDecisionApi = {
      decide: async () => {
        calls += 1
        throw new Error('Azure OpenAI request timed out after 8ms.')
      }
    }
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
    const controller = new AiTurnController({
      api,
      session,
      decks: [humanDeck, aiDeck],
      logger
    })

    expect((await controller.chooseMulligan()).source).toBe('fallback')
    expect(calls).toBe(1)
  })

  it('gives the action decision a fresh deadline after deck planning', async () => {
    const humanDeck = deck('human-deck', 'jaina')
    const aiDeck = deck('ai-deck', 'guldan')
    const setup: MatchSetup = {
      seed: 41,
      participants: [
        {
          participantId: humanId,
          controllerKind: 'human',
          heroId: humanDeck.heroId,
          deckId: humanDeck.id
        },
        {
          participantId: aiId,
          controllerKind: 'ai',
          heroId: aiDeck.heroId,
          deckId: aiDeck.id
        }
      ]
    }
    const session = new GameBoardSession({ setup, decks: [humanDeck, aiDeck] })
    let now = 100_000
    let decisionRequest: AiDecisionRequest | undefined
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const api: AiDecisionApi = {
      planDeck: async () => {
        now += 16_000
        return {
          plan: createFallbackDeckPlan(aiDeck),
          rationale: 'Prepared after a slow planning request.',
          modelId: 'test-model'
        }
      },
      decide: async (request) => {
        decisionRequest = request
        return {
          actionId: request.legalActions[0]!.id,
          decisionClass: request.decisionClass,
          rationale: 'Used the fresh action budget.',
          modelId: 'test-model'
        }
      }
    }
    const controller = new AiTurnController({
      api,
      session,
      decks: [humanDeck, aiDeck],
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
      }
    })

    try {
      expect((await controller.chooseMulligan()).source).toBe('model')
      expect(decisionRequest?.deadlineAtMs).toBe(now + 20_000)
    } finally {
      dateNow.mockRestore()
    }
  })

  it('runs prewarmed deck planning and mulligan ranking concurrently', async () => {
    const humanDeck = deck('human-deck', 'jaina')
    const aiDeck = deck('ai-deck', 'guldan')
    const setup: MatchSetup = {
      seed: 42,
      participants: [
        {
          participantId: humanId,
          controllerKind: 'human',
          heroId: humanDeck.heroId,
          deckId: humanDeck.id
        },
        {
          participantId: aiId,
          controllerKind: 'ai',
          heroId: aiDeck.heroId,
          deckId: aiDeck.id
        }
      ]
    }
    const session = new GameBoardSession({ setup, decks: [humanDeck, aiDeck] })
    let planCalls = 0
    let finishPlan: (() => void) | undefined
    let mulliganRanked = false
    const api: AiDecisionApi = {
      planDeck: () => {
        planCalls += 1
        return new Promise((resolve) => {
          finishPlan = () =>
            resolve({
              plan: createFallbackDeckPlan(aiDeck),
              rationale: 'Prepared before board mounting.',
              modelId: 'test-model'
            })
        })
      },
      decide: async (request) => {
        mulliganRanked = true
        return {
          actionId: request.legalActions[0]!.id,
          decisionClass: request.decisionClass,
          rationale: 'Used the deterministic strategy while planning continued.',
          modelId: 'test-model'
        }
      }
    }
    const controller = new AiTurnController({
      api,
      session,
      decks: [humanDeck, aiDeck],
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
      }
    })

    controller.prewarmDeckPlan()
    expect(planCalls).toBe(1)
    expect((await controller.chooseMulligan()).source).toBe('model')
    expect(mulliganRanked).toBe(true)
    expect(planCalls).toBe(1)
    finishPlan?.()
  })

  it('disables repeated calls for a permanent provider configuration failure', async () => {
    const humanDeck = deck('human-deck', 'jaina')
    const aiDeck = deck('ai-deck', 'guldan')
    const setup: MatchSetup = {
      seed: 5,
      participants: [
        {
          participantId: humanId,
          controllerKind: 'human',
          heroId: humanDeck.heroId,
          deckId: humanDeck.id
        },
        {
          participantId: aiId,
          controllerKind: 'ai',
          heroId: aiDeck.heroId,
          deckId: aiDeck.id
        }
      ]
    }
    const session = new GameBoardSession({ setup, decks: [humanDeck, aiDeck] })
    let calls = 0
    const api: AiDecisionApi = {
      decide: async () => {
        calls += 1
        throw new Error('The Azure OpenAI key is missing.')
      }
    }
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
    const controller = new AiTurnController({
      api,
      session,
      decks: [humanDeck, aiDeck],
      logger
    })

    expect((await controller.chooseMulligan()).source).toBe('fallback')
    expect((await controller.chooseMulligan()).source).toBe('fallback')
    expect(calls).toBe(1)
  })

  it('uses strict rank and critic passes with privileged sanitized observations', async () => {
    const humanDeck = deck('human-deck-v2', 'jaina', 'basic_bloodfen_raptor')
    const aiDeck = deck('ai-deck-v2', 'guldan')
    const setup: MatchSetup = {
      seed: 85,
      participants: [
        {
          participantId: humanId,
          controllerKind: 'human',
          heroId: humanDeck.heroId,
          deckId: humanDeck.id
        },
        {
          participantId: aiId,
          controllerKind: 'ai',
          heroId: aiDeck.heroId,
          deckId: aiDeck.id
        }
      ]
    }
    const session = new GameBoardSession({ setup, decks: [humanDeck, aiDeck] })
    const requests: AiDecisionRequest[] = []
    const api: AiDecisionApi = {
      planMatchup: async () => ({
        plan: createFallbackMatchupPlan(aiDeck, humanDeck),
        rationale: 'Deterministic test matchup.',
        modelId: 'gpt-5.4-nano'
      }),
      decide: async (request) => {
        requests.push(request)
        const ids = request.legalActions.map((action) => action.id)
        if (request.pass === 'rank') {
          return {
            actionId: ids[0]!,
            decisionClass: request.decisionClass,
            rationale: 'Complete first-pass ranking.',
            modelId: 'gpt-5.4-nano',
            pass: 'rank',
            orderedActionIds: ids,
            confidence: 0.7
          }
        }
        return {
          actionId: ids.at(-1)!,
          decisionClass: request.decisionClass,
          rationale: 'Critic override.',
          modelId: 'gpt-5.4-nano',
          pass: 'critic',
          retainedFirstChoice: false,
          identifiedRisks: ['Curve risk.']
        }
      }
    }
    const controller = new AiTurnController({
      api,
      session,
      decks: [humanDeck, aiDeck],
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      policy: 'competitive-v2'
    })

    const decision = await controller.chooseMulligan()

    expect(decision.source).toBe('model')
    expect(requests.map((request) => request.pass)).toEqual(['rank', 'critic'])
    expect(requests[1]?.firstPassRanking).toEqual(
      requests[0]?.legalActions.map((action) => action.id).slice(0, 4)
    )
    const state = requests[0]?.gameState
    expect(state?.['informationPolicy']).toBe('opponent-deck-and-hand')
    const observation = state?.['observation'] as {
      originalDecks: unknown[]
      players: Array<{ role: string; hand: Array<{ cardId: string }> }>
    }
    expect(observation.originalDecks).toHaveLength(2)
    expect(
      observation.players.find((player) => player.role === 'opponent')?.hand[0]?.cardId
    ).toBe('basic_bloodfen_raptor')
  })

  it('keeps turn ranking available after a matchup-plan HTTP 400', async () => {
    const humanDeck = deck('human-deck-v2-plan-failure', 'jaina')
    const aiDeck = deck('ai-deck-v2-plan-failure', 'guldan')
    const setup: MatchSetup = {
      seed: 86,
      participants: [
        {
          participantId: humanId,
          controllerKind: 'human',
          heroId: humanDeck.heroId,
          deckId: humanDeck.id
        },
        {
          participantId: aiId,
          controllerKind: 'ai',
          heroId: aiDeck.heroId,
          deckId: aiDeck.id
        }
      ]
    }
    const session = new GameBoardSession({ setup, decks: [humanDeck, aiDeck] })
    const requests: AiDecisionRequest[] = []
    const api: AiDecisionApi = {
      planMatchup: async () => {
        throw new Error('Azure OpenAI returned HTTP 400: invalid matchup schema')
      },
      decide: async (request) => {
        requests.push(request)
        const ids = request.legalActions.map((action) => action.id)
        if (request.pass === 'rank') {
          return {
            actionId: ids[0]!,
            decisionClass: request.decisionClass,
            rationale: 'Ranked after planning fallback.',
            modelId: 'gpt-5.4-nano',
            pass: 'rank',
            orderedActionIds: ids,
            confidence: 0.6
          }
        }
        return {
          actionId: ids[0]!,
          decisionClass: request.decisionClass,
          rationale: 'Retained after planning fallback.',
          modelId: 'gpt-5.4-nano',
          pass: 'critic',
          retainedFirstChoice: true,
          identifiedRisks: []
        }
      }
    }
    const controller = new AiTurnController({
      api,
      session,
      decks: [humanDeck, aiDeck],
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      policy: 'competitive-v2'
    })

    expect((await controller.chooseMulligan()).source).toBe('model')
    expect(requests.map((request) => request.pass)).toEqual(['rank', 'critic'])
  })
})
