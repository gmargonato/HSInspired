import { afterEach, describe, expect, it, vi } from 'vitest'
import { asHeroId } from '../../../game/content/cards'
import type { Deck } from '../../../game/decks'
import { asPlayerId, type MatchSetup, type TurnMatchCommand } from '../../../game/match'
import type {
  AiSearchWorkerRequest,
  AiSearchWorkerResult
} from '../../../game/match/ai'
import { AiTurnController } from './ai-turn-controller'
import { GameBoardSession } from './game-board-session'

class AutoReplyWorker {
  onmessage: ((event: MessageEvent<AiSearchWorkerResult>) => void) | null = null
  onerror: (() => void) | null = null

  postMessage(message: AiSearchWorkerRequest | { readonly type: string }): void {
    if (message.type !== 'search') return
    const request = message as AiSearchWorkerRequest
    const command: TurnMatchCommand = {
      type: 'end-turn',
      participantId: request.perspectivePlayerId
    }
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: 'search-result',
          requestId: request.requestId,
          observationRevision: request.observationRevision,
          roots: [{ actionId: 'action-0', command }],
          candidateDossiers: [],
          exploredNodes: 1,
          cacheHits: 0,
          partial: true,
          elapsedMs: 1
        }
      } as unknown as MessageEvent<AiSearchWorkerResult>)
    })
  }

  terminate(): void {}
}

function deck(id: string, heroId: string): Deck {
  return {
    id,
    name: id,
    heroId: asHeroId(heroId),
    cards: { basic_acidic_swamp_ooze: 30 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('strategic AI renderer offload', () => {
  it('does not enumerate turn commands through the renderer match instance', async () => {
    vi.stubGlobal('Worker', AutoReplyWorker)
    const humanId = asPlayerId('offload-human')
    const aiId = asPlayerId('offload-ai')
    const decks = [
      deck('offload-human-deck', 'jaina'),
      deck('offload-ai-deck', 'guldan')
    ]
    const setup: MatchSetup = {
      seed: 91,
      participants: [
        {
          participantId: humanId,
          controllerKind: 'human',
          heroId: decks[0]!.heroId,
          deckId: decks[0]!.id
        },
        {
          participantId: aiId,
          controllerKind: 'ai',
          heroId: decks[1]!.heroId,
          deckId: decks[1]!.id
        }
      ]
    }
    const session = new GameBoardSession({ setup, decks })
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
    expect(session.getState().activePlayerId).toBe(aiId)
    const legality = vi.spyOn(session.match, 'getLegality')
    const controller = new AiTurnController({
      session,
      decks,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      policy: 'strategic-v3'
    })

    const decision = await controller.chooseTurnAction()

    expect(decision.command).toEqual({ type: 'end-turn', participantId: aiId })
    expect(legality).not.toHaveBeenCalled()
    controller.dispose()
  })
})
