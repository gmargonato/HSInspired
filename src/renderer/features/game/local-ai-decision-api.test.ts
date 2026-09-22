import { describe, expect, it } from 'vitest'
import { enumerateLegalCommands } from '../../../game/match/ai'
import { createMatchScenario } from '../../../game/match/testing/match-scenario-builder'
import { parseAiDecisionResponse, type AiDecisionRequest } from '../../../shared/ipc/ai'
import { aiActions } from './ai-context'
import { AiTurnController } from './ai-turn-controller'
import { GameBoardSession } from './game-board-session'
import { LocalAiDecisionApi } from './local-ai-decision-api'

function request(
  session: GameBoardSession,
  phase: 'action' | 'mulligan',
  actionIds: readonly string[]
): AiDecisionRequest {
  return {
    matchId: 'local-test-match',
    requestId: `local-test-${session.getState().revision}-${phase}`,
    expectedRevision: session.getState().revision,
    phase,
    allowInspection: false,
    messages: [{ role: 'user', content: '{}' }],
    actionIds
  }
}

function legal(session: GameBoardSession) {
  return enumerateLegalCommands(
    {
      getState: session.match.getState,
      getPlayInput: session.match.getPlayInput!,
      getLegality: session.match.getLegality!
    },
    session.remoteParticipantId
  )
}

describe('hardware local AI', () => {
  it('satisfies the existing turn-controller protocol', async () => {
    const scenario = createMatchScenario({ seed: 0x404 })
    const session = new GameBoardSession({
      setup: scenario.setup,
      decks: scenario.decks
    })
    const api = new LocalAiDecisionApi(session)
    const controller = new AiTurnController({
      api,
      session,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    })
    try {
      const mulligan = await controller.chooseMulligan()
      expect(mulligan).not.toBeNull()
      const mulliganResult = session.match.dispatch(mulligan!.command)
      expect(
        mulliganResult.accepted,
        mulliganResult.accepted ? undefined : mulliganResult.message
      ).toBe(true)
      const humanMulligan = session.match.dispatch({
        type: 'confirm-mulligan',
        participantId: session.localParticipantId,
        replaceInstanceIds: []
      })
      expect(
        humanMulligan.accepted,
        humanMulligan.accepted ? undefined : humanMulligan.message
      ).toBe(true)
      if (session.getState().activePlayerId === session.localParticipantId) {
        const endTurn = session.match.dispatch({
          type: 'end-turn',
          participantId: session.localParticipantId
        })
        expect(endTurn.accepted, endTurn.accepted ? undefined : endTurn.message).toBe(
          true
        )
      }
      const decision = await controller.chooseTurnAction()
      expect(decision).not.toBeNull()
      const trace = api.getLastTrace()
      expect(trace).not.toBeNull()
      if (decision!.source === 'model') {
        expect(trace?.chosenActionId).toBe(decision!.actionId)
        expect(trace?.evaluatedActions).toBeGreaterThan(0)
        expect(trace?.candidates.length).toBeGreaterThan(0)
      } else {
        expect(decision!.source).toBe('forced')
      }
      const result = session.match.dispatch(decision!.command)
      expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
      controller.recordExecution(decision!, result)
    } finally {
      controller.dispose()
    }
  }, 30_000)

  it('plays seeded matches without mutating simulations or producing illegal commands', async () => {
    for (const seed of [0x101, 0x202, 0x303]) {
      const scenario = createMatchScenario({ seed })
      const session = new GameBoardSession({
        setup: scenario.setup,
        decks: scenario.decks
      })
      const api = new LocalAiDecisionApi(session)

      const humanMulligan = session.match.dispatch({
        type: 'confirm-mulligan',
        participantId: session.localParticipantId,
        replaceInstanceIds: []
      })
      expect(
        humanMulligan.accepted,
        humanMulligan.accepted ? undefined : humanMulligan.message
      ).toBe(true)

      const openingHand = session
        .findPlayer(session.getState(), session.remoteParticipantId)
        .hand.map((card) => card.instanceId)
      const mulligan = await api.decide(request(session, 'mulligan', openingHand))
      expect('replace' in mulligan.choice).toBe(true)
      if (!('replace' in mulligan.choice)) continue
      const aiMulligan = session.match.dispatch({
        type: 'confirm-mulligan',
        participantId: session.remoteParticipantId,
        replaceInstanceIds: [...mulligan.choice.replace]
      })
      expect(
        aiMulligan.accepted,
        aiMulligan.accepted ? undefined : aiMulligan.message
      ).toBe(true)

      for (let step = 0; step < 120 && session.getState().phase !== 'ended'; step++) {
        const state = session.getState()
        const active = state.activePlayerId
        expect(active).not.toBeNull()
        if (active === session.localParticipantId) {
          const commands = enumerateLegalCommands(
            {
              getState: session.match.getState,
              getPlayInput: session.match.getPlayInput!,
              getLegality: session.match.getLegality!
            },
            active
          )
          expect(commands.length).toBeGreaterThan(0)
          const endTurn = commands.find((command) => command.type === 'end-turn')
          const result = session.match.dispatch(endTurn ?? commands[0]!)
          expect(result.accepted, result.accepted ? undefined : result.message).toBe(
            true
          )
          continue
        }

        const commands = legal(session)
        expect(commands.length).toBeGreaterThan(0)
        const beforeRevision = session.getState().revision
        const actions = aiActions(session, commands)
        const decision = await api.decide(
          request(
            session,
            'action',
            actions.map((action) => action.id)
          )
        )
        const parsedDecision = parseAiDecisionResponse(decision)
        expect(parsedDecision.usage?.mode).toBe('local-search')
        expect(decision.durationMs).toBeLessThan(4_000)
        expect('actionId' in decision.choice).toBe(true)
        if (!('actionId' in decision.choice)) continue
        const actionId = decision.choice.actionId
        const selected = actions.find((action) => action.id === actionId)
        expect(selected).toBeDefined()
        expect(session.getState().revision).toBe(beforeRevision)
        const result = session.match.dispatch(selected!.command)
        expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
      }

      expect(session.getState().phase).toBe('ended')
    }
  }, 120_000)
})
