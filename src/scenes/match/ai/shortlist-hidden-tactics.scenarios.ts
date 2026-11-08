import { expect, it } from 'vitest'
import { createAiFixture } from '../../../game-rules/match/testing/ai-scenario-builder'
import { enumerateLegalCommands } from '../../../game-rules/match'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { GameBoardSession } from '../game-board-session'
import { aiActions } from './ai-context'
import { ExpertAiDecisionApi } from './expert-ai-decision-api'
import { runExpertAiWorkerDecision } from './expert-ai.worker'
import { evaluateExpertAiWorld } from './expert-ai-world-runner'
import type {
  ExpertAiWorkerRequest,
  ExpertAiWorkerResponse
} from './expert-ai-worker-protocol'

it.each(['healing', 'classic_counterspell', 'classic_mirror_entity'])(
  'live hidden production consensus: %s (Mirror Entity is unscored)',
  async (kind) => {
    const report: unknown[] = []
    const fixture = createAiFixture(
      kind === 'healing'
        ? {
            seed: 0xde0120,
            aiHeroId: 'thrall',
            opponentHeroId: 'garrosh',
            aiHealth: 3,
            aiMana: 3,
            aiMaximumMana: 3,
            aiHand: ['the_grand_tournament_healing_wave'],
            aiDeck: ['basic_boulderfist_ogre'],
            opponentDeck: ['basic_river_crocolisk'],
            opponentBoard: [
              { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true },
              { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
            ]
          }
        : {
            seed: 0xde0144,
            aiHeroId: 'jaina',
            opponentHeroId: 'jaina',
            aiHealth: 20,
            opponentHealth: 8,
            aiMana: 10,
            aiMaximumMana: 10,
            aiHand: [
              'league_of_explorers_murloc_tinyfin',
              'classic_ragnaros_the_firelord'
            ],
            opponentSecrets: [{ cardId: kind }]
          }
    )
    const session = new GameBoardSession({ ...fixture, checkpoint: fixture.checkpoint })
    let hash = 0x811c9dc5
    for (const char of `artifact-${session.getState().revision}-0`)
      hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193)
    const sampled = createFairHypothesisCheckpoint(
      session.match.getCheckpoint(),
      session.remoteParticipantId,
      hash >>> 0
    )
    report.push([
      'HIDDEN_SAMPLE',
      kind,
      sampled.state.players.map((p) => ({
        id: p.participantId,
        deck: p.deck.map((c) => c.cardId),
        secrets: p.secrets?.map((c) => c.cardId)
      }))
    ])
    let receive: ((event: MessageEvent<ExpertAiWorkerResponse>) => void) | undefined
    const worker = {
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') receive = listener as typeof receive
      },
      postMessage(message: ExpertAiWorkerRequest) {
        if (message.type !== 'decide') return
        void runExpertAiWorkerDecision(message, {
          evaluateWorld: (request, index, budget, onProgress) =>
            evaluateExpertAiWorld(request, index, budget, {
              workBudget: 256,
              onProgress
            })
        })
          .then((response) => {
            if (response)
              receive?.({
                data: {
                  type: 'decision',
                  requestId: message.request.requestId,
                  response
                }
              } as MessageEvent<ExpertAiWorkerResponse>)
          })
          .catch((error) =>
            receive?.({
              data: {
                type: 'failure',
                requestId: message.request.requestId,
                error: String(error)
              }
            } as MessageEvent<ExpertAiWorkerResponse>)
          )
      },
      terminate() {}
    } as unknown as Worker
    const api = new ExpertAiDecisionApi(
      session,
      () => worker,
      () => 0,
      session.remoteParticipantId,
      20
    )
    for (let step = 0; step < 10; step++) {
      const state = session.getState()
      if (
        state.phase !== 'turns' ||
        state.activePlayerId !== session.remoteParticipantId
      )
        break
      const actions = aiActions(
        session,
        enumerateLegalCommands(
          {
            getState: session.match.getState,
            getPlayInput: session.match.getPlayInput!,
            getLegality: session.match.getLegality!
          },
          session.remoteParticipantId
        )
      )
      const before = session.match.getCheckpoint()
      const response = await api.decide({
        matchId: 'shortlist-hidden',
        requestId: `artifact-${state.revision}-${step}`,
        phase: 'action',
        expectedRevision: state.revision,
        actionIds: actions.map((a) => a.id),
        allowInspection: false,
        messages: []
      })
      expect(session.match.getCheckpoint()).toEqual(before)
      if (!('actionId' in response.choice)) throw new Error('Expected action')
      const selectedId = response.choice.actionId
      const action = actions.find((a) => a.id === selectedId)
      expect(action).toBeDefined()
      if (!action) throw new Error('AI selected an illegal action')
      report.push([
        'PRODUCTION_CHOICE',
        kind,
        action.description,
        response.reason,
        response.usage?.worldsEvaluated
      ])
      expect(session.dispatch(action.command).accepted).toBe(true)
    }
    report.push([
      'PRODUCTION_RESULT',
      kind,
      session.getState().winnerId,
      session.getState().players.map((p) => ({
        id: p.participantId,
        health: p.hero.health,
        hand: p.hand.map((c) => c.cardId),
        board: p.board.map((c) => c.cardId)
      }))
    ])
    api.dispose()
    const state = session.getState()
    expect(
      state.phase === 'ended' || state.activePlayerId !== session.remoteParticipantId
    ).toBe(true)
    if (kind === 'healing') {
      expect(
        state.players.find((p) => p.participantId === session.remoteParticipantId)!.hero
          .health
      ).toBeGreaterThan(10)
      expect(state.winnerId).not.toBe(session.localParticipantId)
    } else if (kind === 'classic_counterspell') {
      expect(state.winnerId).toBe(session.remoteParticipantId)
    }
    // This third case measures hidden-secret robustness; it is not a win-rate pass.
    // Enable trace explicitly when collecting assessment evidence.
    if (process.env.LOCAL_AI_ARTIFACT_TRACE === '1') console.log(JSON.stringify(report))
  },
  120_000
)
