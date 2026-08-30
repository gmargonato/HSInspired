import { describe, expect, it } from 'vitest'
import type { Deck } from '../../../game/decks'
import { asHeroId } from '../../../game/content/cards'
import { asPlayerId, type MatchSetup } from '../../../game/match'
import type { AiDecisionApi, AiDecisionRequest } from '../../../shared/ipc/ai'
import { GameBoardSession } from './game-board-session'
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
  it('sends an omniscient state and selects only an engine-issued action id', async () => {
    const humanDeck = deck('human-deck', 'jaina', 'basic_bloodfen_raptor')
    const aiDeck = deck('ai-deck', 'guldan')
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
          rationale: 'Chosen from the legal list.',
          strategicIntent: 'Test intent.',
          strategySummary: 'Develop minions and pressure the opposing hero.',
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
        hand: Array<{ cardId: string }>
        deck: Array<{ instanceId: string; cardId: string }>
      }>
    }
    const human = currentState.players.find(
      (player) => player.participantId === humanId
    )!
    const ai = currentState.players.find((player) => player.participantId === aiId)!

    expect(human.hand.every((card) => typeof card.cardId === 'string')).toBe(true)
    expect(ai.hand.every((card) => typeof card.cardId === 'string')).toBe(true)
    expect(human.deck.map((card) => card.instanceId)).toEqual(
      session
        .findPlayer(session.getState(), humanId)
        .deck.map((card) => card.instanceId)
    )
    expect(turnRequest.gameState['contextVersion']).toBe(2)
    expect(turnRequest.gameState['informationPolicy']).toBe('omniscient')
    expect(turnRequest.gameState['perspective']).toMatchObject({
      selfParticipantId: aiId,
      opponentParticipantId: humanId,
      hiddenHandsKnown: true,
      hiddenSecretsKnown: true,
      exactRemainingDeckOrderKnown: true
    })
    expect(turnRequest.gameState['originalDecks']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantId: humanId,
          role: 'opponent',
          id: humanDeck.id
        }),
        expect.objectContaining({
          participantId: aiId,
          role: 'self',
          id: aiDeck.id
        })
      ])
    )
    expect(turnRequest.gameState['cardDefinitions']).toMatchObject({
      basic_bloodfen_raptor: { name: 'Bloodfen Raptor' },
      basic_acidic_swamp_ooze: { name: 'Acidic Swamp Ooze' }
    })
    expect(currentState).not.toHaveProperty('history')
    expect(currentState).not.toHaveProperty('effectTrace')
    expect(currentState).not.toHaveProperty('scheduledEffects')
    expect(turnRequest.gameState['recentAuthoritativeEvents']).toBeInstanceOf(Array)
    expect(
      turnRequest.legalActions.some((action) => action.id === decision.actionId)
    ).toBe(true)
    expect(decision.command.type).toBe('end-turn')
  })

  it('retries the provider after a transient failure', async () => {
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
      decide: async (request) => {
        calls += 1
        if (calls === 1) throw new Error('Azure OpenAI request timed out after 8ms.')
        return {
          actionId: request.legalActions[0]!.id,
          rationale: 'The provider recovered.',
          strategicIntent: 'Use the opening plan.',
          strategySummary: 'Recovered strategy.',
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

    expect((await controller.chooseMulligan()).source).toBe('fallback')
    expect((await controller.chooseMulligan()).source).toBe('model')
    expect(calls).toBe(2)
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
})
