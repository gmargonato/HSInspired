import { describe, expect, it } from 'vitest'
import { enumerateLegalCommands } from '../../../game/match/ai'
import { createMatchScenario } from '../../../game/match/testing/match-scenario-builder'
import { createAiFixture } from '../../../game/match/testing/ai-scenario-builder'
import { parseAiDecisionResponse, type AiDecisionRequest } from '../../../shared/ipc/ai'
import type { AiActionIntent } from '../../../shared/ipc/ai-deliberation'
import { aiActionIntent } from './ai-action-intent'
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
  it('lets Expert prefer a still-legal step from its planned line', async () => {
    const fixture = createAiFixture({
      seed: 0x393416,
      aiHeroId: 'garrosh',
      opponentHeroId: 'guldan',
      aiHand: [
        'basic_the_coin',
        'classic_faerie_dragon',
        'journey_to_ungoro_golakka_crawler',
        'one_night_in_karazhan_fools_bane',
        'classic_gorehowl'
      ],
      aiMana: 1,
      aiMaximumMana: 1,
      turnNumber: 2,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentHeroPowerAvailable: false,
      opponentBoard: [{ cardId: 'basic_voidwalker', ready: false }]
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
    const initialActions = aiActions(session, legal(session))
    const coinInstanceId = session
      .findPlayer(session.getState(), session.remoteParticipantId)
      .hand.find((card) => card.cardId === 'basic_the_coin')?.instanceId
    const coin = initialActions.find(
      (action) =>
        action.command.type === 'play-card' &&
        action.command.cardInstanceId === coinInstanceId
    )
    if (!coin) throw new Error('Expected The Coin to be legal.')
    const coinResult = session.match.dispatch(coin.command)
    expect(
      coinResult.accepted,
      coinResult.accepted ? undefined : coinResult.message
    ).toBe(true)

    const actions = aiActions(session, legal(session))
    const faerie = session
      .findPlayer(session.getState(), session.remoteParticipantId)
      .hand.find((card) => card.cardId === 'classic_faerie_dragon')
    if (!faerie) throw new Error('Expected Faerie Dragon in hand after The Coin.')
    const preferredIntent: AiActionIntent = aiActionIntent(
      {
        type: 'play-card',
        participantId: session.remoteParticipantId,
        cardInstanceId: faerie.instanceId,
        position: 0
      },
      session.localParticipantId
    )
    const preferredAction = actions.find(
      (action) =>
        action.command.type === 'play-card' &&
        action.command.cardInstanceId === faerie.instanceId
    )
    if (!preferredAction)
      throw new Error('Expected Faerie Dragon to be a legal follow-up action.')

    const api = new LocalAiDecisionApi(session, undefined, {
      profile: 'expert',
      preferredContinuation: preferredIntent
    })
    const decision = await api.decide(
      request(
        session,
        'action',
        actions.map((action) => action.id)
      )
    )
    const selectedActionId =
      'actionId' in decision.choice ? decision.choice.actionId : null
    expect(
      selectedActionId,
      JSON.stringify(
        api.getLastTrace()?.candidates.map((candidate) => ({
          actionId: candidate.actionId,
          description: candidate.description,
          meanValue: candidate.meanValue,
          prior: candidate.prior,
          continuationPreference:
            candidate.scoreComponents.continuationPreference
        }))
      )
    ).toBe(preferredAction.id)
    const selectedTrace = api
      .getLastTrace()
      ?.candidates.find((candidate) => candidate.actionId === preferredAction.id)
    expect(selectedTrace?.scoreComponents.continuationPreference).toBeGreaterThan(0)
  }, 30_000)

  it('keeps a legal best-so-far action when a fixed work budget cuts search off', async () => {
    const fixture = createAiFixture({
      seed: 0x51a,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHand: ['basic_stonetusk_boar'],
      aiMana: 1,
      aiMaximumMana: 1,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      aiHeroPowerAvailable: false
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
    const actions = aiActions(session, legal(session))
    const api = new LocalAiDecisionApi(session, undefined, {
      profile: 'expert',
      workBudget: 1
    })

    const response = await api.decide(
      request(
        session,
        'action',
        actions.map((action) => action.id)
      )
    )
    if (!('actionId' in response.choice))
      throw new Error('Expected an Expert action decision.')
    const selectedId = response.choice.actionId
    const selected = actions.find((action) => action.id === selectedId)
    const trace = api.getLastTrace()

    expect(selected).toBeDefined()
    expect(trace?.timedOut).toBe(false)
    expect(trace?.workUnits).toBe(1)
    expect(trace?.workBudgetHit).toBe(true)
    expect(selected && session.match.dispatch(selected.command).accepted).toBe(true)
  })

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
        const selectedTrace = trace?.candidates.find(
          (candidate) => candidate.actionId === trace.chosenActionId
        )
        expect(selectedTrace?.scoreComponents).toBeDefined()
        if (selectedTrace) {
          const componentTotal = Object.values(selectedTrace.scoreComponents).reduce(
            (total, component) => total + component,
            0
          )
          expect(componentTotal).toBeCloseTo(selectedTrace.score, 1)
        }
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
