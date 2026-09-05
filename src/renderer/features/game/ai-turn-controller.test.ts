import { describe, expect, it, vi } from 'vitest'
import type { Deck } from '../../../game/decks'
import { asCardId, asHeroId } from '../../../game/content/cards'
import { asPlayerId, type MatchSetup } from '../../../game/match'
import type {
  AiDecisionApi,
  AiDecisionRequest,
  AiStrategyReviewRequest
} from '../../../shared/ipc/ai'
import { GameBoardSession } from './game-board-session'
import { createFallbackDeckPlan } from './ai-deck-strategy'
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
  async function requestsFacingSecret(
    secretId: string,
    policy: 'legacy' | 'strategic-v3' = 'legacy'
  ): Promise<readonly AiDecisionRequest[]> {
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
        if (request.pass === 'rank') {
          const orderedActionIds = [
            action.id,
            ...request.legalActions
              .map((candidate) => candidate.id)
              .filter((actionId) => actionId !== action.id)
          ]
          return {
            actionId: action.id,
            decisionClass: request.decisionClass,
            rationale: 'Rank using only public information.',
            modelId: 'gpt-5.4-nano',
            pass: 'rank',
            orderedActionIds,
            confidence: 0.6
          }
        }
        if (request.pass === 'critic') {
          return {
            actionId: action.id,
            decisionClass: request.decisionClass,
            rationale: 'Retain the fair first-pass choice.',
            modelId: 'gpt-5.4-nano',
            pass: 'critic',
            retainedFirstChoice: true,
            identifiedRisks: ['The facedown secret remains uncertain.']
          }
        }
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
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      policy
    })
    await controller.chooseTurnAction()
    if (requests.length === 0)
      throw new Error('The controller did not issue a decision request.')
    return requests
  }

  it('does not leak a secret identity through context, previews, or shortlisting', async () => {
    const mirrorRequest = (await requestsFacingSecret('classic_mirror_entity'))[0]!
    const counterspellRequest = (await requestsFacingSecret('classic_counterspell'))[0]!
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
      mirrorRequest.legalActions.some((action) => action.analysis?.uncertain === true)
    ).toBe(true)
    expect(
      mirrorRequest.legalActions.find((action) => action.kind === 'end-turn')?.analysis
        ?.uncertain
    ).toBe(true)
    expect(mirrorRequest.gameState).toEqual(counterspellRequest.gameState)
    expect(mirrorRequest.legalActions).toEqual(counterspellRequest.legalActions)
  })

  it('adds a critic pass for a complex fair decision involving a facedown secret', async () => {
    const mirrorRequests = await requestsFacingSecret(
      'classic_mirror_entity',
      'strategic-v3'
    )
    const counterspellRequests = await requestsFacingSecret(
      'classic_counterspell',
      'strategic-v3'
    )

    expect(mirrorRequests.map((request) => request.pass)).toEqual(['rank', 'critic'])
    expect(mirrorRequests.map((request) => request.gameState)).toEqual(
      counterspellRequests.map((request) => request.gameState)
    )
    expect(mirrorRequests.map((request) => request.legalActions)).toEqual(
      counterspellRequests.map((request) => request.legalActions)
    )
    expect(mirrorRequests.map((request) => request.candidateDossiers)).toEqual(
      counterspellRequests.map((request) => request.candidateDossiers)
    )
    for (const request of mirrorRequests) {
      expect(request.gameState['informationPolicy']).toBe('fair')
      const eventLedger = JSON.stringify(request.gameState['publicEventLedger'])
      expect(eventLedger).not.toContain('creationOrdinal')
      expect(eventLedger).not.toContain('human:deck:')
      expect(
        request.candidateDossiers?.every(
          (dossier) => dossier.uncertainty.determinizations === 0
        )
      ).toBe(true)
      expect(
        request.candidateDossiers?.some((dossier) => dossier.uncertainty.incomplete)
      ).toBe(true)
      expect(
        request.candidateDossiers?.some(
          (dossier) => dossier.evaluation.informationValue > 0
        )
      ).toBe(true)
      expect(
        request.candidateDossiers?.some((dossier) => !dossier.uncertainty.incomplete)
      ).toBe(true)
    }
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

  it('uses a fair strategic rank pass without revealing the opponent deck or hand', async () => {
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
      planDeck: async () => ({
        plan: createFallbackDeckPlan(aiDeck),
        rationale: 'Deterministic test plan.',
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
      policy: 'strategic-v3'
    })

    const decision = await controller.chooseMulligan()

    expect(decision.source).toBe('model')
    expect(requests.map((request) => request.pass)).toEqual(['rank'])
    const state = requests[0]?.gameState
    expect(state?.['informationPolicy']).toBe('fair')
    const observation = state?.['observation'] as {
      selfOriginalDeck: { id: string }
      players: Array<{
        role: string
        hand: Array<{ cardId: string }>
        handSize: number
      }>
    }
    expect(observation.selfOriginalDeck.id).toBe(aiDeck.id)
    expect(
      observation.players.find((player) => player.role === 'opponent')
    ).toMatchObject({
      hand: [],
      handSize: 3
    })
    expect(state?.['cardDefinitions']).toHaveProperty('basic_acidic_swamp_ooze')
    expect(state?.['heroPowerDefinitions']).toHaveProperty('warlock-life-tap')
    expect(JSON.stringify(state)).not.toContain(humanDeck.id)
  })

  it('uses the engine proof without provider passes for obvious deterministic lethal', async () => {
    const humanDeck = deck('human-ordinary-turn', 'jaina', 'basic_bloodfen_raptor')
    const aiDeck = deck('ai-ordinary-turn', 'anduin', 'basic_mind_blast')
    const session = new GameBoardSession({
      setup: {
        seed: 89,
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
        type: 'dev-set-mana',
        participantId: aiId,
        available: 2,
        maximum: 2
      }).accepted
    ).toBe(true)
    expect(
      session.dispatch({
        type: 'dev-set-hero',
        participantId: humanId,
        health: 5
      }).accepted
    ).toBe(true)
    const requests: AiDecisionRequest[] = []
    const api: AiDecisionApi = {
      planDeck: async () => ({
        plan: createFallbackDeckPlan(aiDeck),
        rationale: 'Deterministic test plan.',
        modelId: 'gpt-5.4-nano'
      }),
      decide: async (request) => {
        requests.push(request)
        const ids = request.legalActions.map((action) => action.id)
        return {
          actionId: ids[0]!,
          decisionClass: request.decisionClass,
          rationale: 'Rank the ordinary turn once.',
          modelId: 'gpt-5.4-nano',
          pass: 'rank',
          orderedActionIds: ids,
          confidence: 0.8
        }
      }
    }
    const controller = new AiTurnController({
      api,
      session,
      decks: [humanDeck, aiDeck],
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      policy: 'strategic-v3'
    })

    await controller.chooseTurnAction()

    expect(requests).toEqual([])
  })

  it('keeps ranking available after a deck-plan provider failure', async () => {
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
      planDeck: async () => {
        throw new Error('Azure OpenAI returned HTTP 400: invalid deck-plan schema')
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
      policy: 'strategic-v3'
    })

    expect((await controller.chooseMulligan()).source).toBe('model')
    expect(requests.map((request) => request.pass)).toEqual(['rank'])
  })

  it('reviews strategy from new public evidence without sending hidden opponent data', async () => {
    const humanDeck = deck('human-public-evidence-deck', 'jaina', 'basic_murloc_raider')
    const aiDeck = deck('ai-strategy-review-deck', 'guldan')
    const setup: MatchSetup = {
      seed: 87,
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
    const plan = createFallbackDeckPlan(aiDeck)
    const reviews: AiStrategyReviewRequest[] = []
    const decisions: AiDecisionRequest[] = []
    const api: AiDecisionApi = {
      planDeck: async () => ({
        plan,
        rationale: 'Initial self-deck strategy.',
        modelId: 'gpt-5.4-nano'
      }),
      reviewStrategy: async (request) => {
        reviews.push(request)
        return {
          review: {
            reviewVersion: 1,
            changed: false,
            revisedPlan: null,
            changeReasons: [],
            opponentAssessment: 'The revealed one-drop suggests early tempo.'
          },
          rationale: 'Preserve the current plan.',
          modelId: 'gpt-5.4-nano'
        }
      },
      decide: async (request) => {
        decisions.push(request)
        const ids = request.legalActions.map((action) => action.id)
        return {
          actionId: ids[0]!,
          decisionClass: request.decisionClass,
          rationale: 'Ranked fair actions.',
          modelId: 'gpt-5.4-nano',
          pass: 'rank',
          orderedActionIds: ids,
          confidence: 0.7
        }
      }
    }
    const controller = new AiTurnController({
      api,
      session,
      decks: [humanDeck, aiDeck],
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      policy: 'strategic-v3'
    })

    const aiMulligan = await controller.chooseMulligan()
    expect(session.dispatch(aiMulligan.command).accepted).toBe(true)
    expect(
      session.dispatch({
        type: 'confirm-mulligan',
        participantId: humanId,
        replaceInstanceIds: []
      }).accepted
    ).toBe(true)
    if (session.getState().activePlayerId === aiId) {
      expect(session.dispatch({ type: 'end-turn', participantId: aiId }).accepted).toBe(
        true
      )
    }
    expect(
      session.dispatch({
        type: 'dev-set-mana',
        participantId: humanId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const human = session.findPlayer(session.getState(), humanId)
    const oneDrops = human.hand
      .filter((card) => card.cardId === 'basic_murloc_raider')
      .slice(0, 2)
    expect(oneDrops).toHaveLength(2)
    for (const [position, oneDrop] of oneDrops.entries()) {
      expect(
        session.dispatch({
          type: 'play-card',
          participantId: humanId,
          cardInstanceId: oneDrop.instanceId,
          position
        }).accepted
      ).toBe(true)
    }
    expect(
      session.dispatch({ type: 'end-turn', participantId: humanId }).accepted
    ).toBe(true)

    await controller.chooseTurnAction()

    expect(reviews).toHaveLength(1)
    expect(JSON.stringify(reviews[0])).not.toContain(humanDeck.id)
    expect(reviews[0]?.gameState['informationPolicy']).toBe('fair')
    const observation = reviews[0]?.gameState['observation'] as {
      players: Array<{ role: string; hand: unknown[]; handSize: number }>
    }
    expect(
      observation.players.find((player) => player.role === 'opponent')
    ).toMatchObject({
      hand: []
    })
    expect(reviews[0]?.gameState['cardDefinitions']).toHaveProperty(
      'basic_murloc_raider'
    )
    expect(reviews[0]?.gameState['cardDefinitions']).toHaveProperty(
      'basic_acidic_swamp_ooze'
    )
    expect(decisions.at(-1)?.gameState['opponentAssessment']).toBe(
      'The revealed one-drop suggests early tempo.'
    )
    expect(JSON.stringify(reviews[0]?.strategicMemory)).toContain('basic_murloc_raider')
  })
})
