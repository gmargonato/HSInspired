import { describe, expect, it } from 'vitest'
import { enumerateLegalCommands } from '../../../game/match/ai'
import type { TurnMatchCommand } from '../../../game/match'
import { createMatchScenario } from '../../../game/match/testing/match-scenario-builder'
import { createAiFixture } from '../../../game/match/testing/ai-scenario-builder'
import { parseAiDecisionResponse, type AiDecisionRequest } from '../../../shared/ipc/ai'
import type { AiActionIntent } from '../../../shared/ipc/ai-deliberation'
import { aiActionIntent } from './ai-action-intent'
import { aiActions } from './ai-context'
import { AiTurnController } from './ai-turn-controller'
import { GameBoardSession } from './game-board-session'
import { LocalAiDecisionApi } from './local-ai-decision-api'
import { expertCoinHeroPowerSequencePenalty } from './expert-coin-hero-power-policy'

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

function simulateLine(
  session: GameBoardSession,
  commands: readonly TurnMatchCommand[]
) {
  return session.match.analyze((fork) => {
    for (const command of commands) {
      const result = fork.dispatch(command)
      if (!result.accepted) throw new Error(result.message)
    }
    return fork.getState()
  })
}

function firstTurnCoinFixture(
  overrides: Partial<Parameters<typeof createAiFixture>[0]> = {}
) {
  const fixture = createAiFixture({
    seed: 0xc01,
    aiHeroId: 'jaina',
    opponentHeroId: 'rexxar',
    aiHand: ['basic_the_coin'],
    aiMana: 1,
    aiMaximumMana: 1,
    aiHeroPowerAvailable: true,
    turnNumber: 2,
    aiDeck: ['basic_acidic_swamp_ooze'],
    opponentDeck: ['basic_acidic_swamp_ooze'],
    opponentBoard: [{ cardId: 'basic_murloc_scout' }],
    ...overrides
  })
  return new GameBoardSession({
    setup: fixture.setup,
    decks: fixture.decks,
    checkpoint: fixture.checkpoint
  })
}

describe('hardware local AI', () => {
  it('rejects the Coin root when its only recurring turn line is Hunter hero power', async () => {
    const fixture = createAiFixture({
      seed: 0xc02,
      aiHeroId: 'rexxar',
      opponentHeroId: 'jaina',
      aiHand: ['basic_the_coin'],
      aiMana: 1,
      aiMaximumMana: 1,
      aiHeroPowerAvailable: true,
      turnNumber: 2,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentBoard: []
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
    const actions = aiActions(session, legal(session))
    const coinInstanceId = session
      .findPlayer(session.getState(), session.remoteParticipantId)
      .hand.find((card) => card.cardId === 'basic_the_coin')?.instanceId
    const coinAction = actions.find(
      (action) =>
        action.command.type === 'play-card' &&
        action.command.cardInstanceId === coinInstanceId
    )
    if (!coinAction) throw new Error('Expected The Coin to be a legal action.')
    const api = new LocalAiDecisionApi(session, undefined, {
      profile: 'expert',
      workBudget: 160
    })
    const response = await api.decide(
      request(
        session,
        'action',
        actions.map((action) => action.id)
      )
    )
    const coinTrace = api
      .getLastTrace()
      ?.candidates.find((candidate) => candidate.actionId === coinAction.id)

    expect(
      coinTrace?.recommendationTacticalPenalty,
      JSON.stringify({
        workUnits: api.getLastTrace()?.workUnits,
        candidates: api.getLastTrace()?.candidates.map((candidate) => ({
          actionId: candidate.actionId,
          description: candidate.description,
          recommendationTacticalPenalty: candidate.recommendationTacticalPenalty,
          sequenceIntents: candidate.sequenceIntents
        }))
      })
    ).toBe(3)
    if (!('actionId' in response.choice))
      throw new Error('Expected an Expert action selection.')
    expect(response.choice.actionId).not.toBe(coinAction.id)
  })

  it('penalizes first-turn Coin into a hero power except for a Mage kill or immediate win', () => {
    const session = firstTurnCoinFixture()
    const participantId = session.remoteParticipantId
    const opponentId = session.localParticipantId
    const before = session.getState()
    const coin = session
      .findPlayer(before, participantId)
      .hand.find((card) => card.cardId === 'basic_the_coin')
    const enemyMinion = session.findPlayer(before, opponentId).board[0]
    if (!coin || !enemyMinion) throw new Error('Expected the Coin and enemy minion.')
    const coinCommand: TurnMatchCommand = {
      type: 'play-card',
      participantId,
      cardInstanceId: coin.instanceId
    }
    const facePower: TurnMatchCommand = {
      type: 'use-hero-power',
      participantId,
      target: { kind: 'hero', participantId: opponentId }
    }
    const endTurn: TurnMatchCommand = { type: 'end-turn', participantId }
    const wastefulLine = [coinCommand, facePower, endTurn]
    const afterWastefulLine = simulateLine(session, wastefulLine.slice(0, 2))
    expect(
      expertCoinHeroPowerSequencePenalty(
        wastefulLine,
        before,
        afterWastefulLine,
        participantId
      )
    ).toBe(3)

    const selfFaceLine = [
      coinCommand,
      {
        ...facePower,
        target: { kind: 'hero', participantId }
      },
      endTurn
    ] satisfies TurnMatchCommand[]
    expect(
      expertCoinHeroPowerSequencePenalty(
        selfFaceLine,
        before,
        simulateLine(session, selfFaceLine.slice(0, 2)),
        participantId
      )
    ).toBe(3)

    const clearLine: TurnMatchCommand[] = [
      coinCommand,
      {
        type: 'use-hero-power',
        participantId,
        target: {
          kind: 'minion',
          participantId: opponentId,
          instanceId: enemyMinion.instanceId
        }
      },
      endTurn
    ]
    const afterClear = simulateLine(session, clearLine.slice(0, 2))
    expect(session.findPlayer(afterClear, opponentId).board).toHaveLength(0)
    expect(
      expertCoinHeroPowerSequencePenalty(clearLine, before, afterClear, participantId)
    ).toBe(0)

    const nonlethalMinion = firstTurnCoinFixture({
      opponentBoard: [{ cardId: 'basic_ironfur_grizzly' }]
    })
    const nonlethalBefore = nonlethalMinion.getState()
    const nonlethalParticipantId = nonlethalMinion.remoteParticipantId
    const nonlethalCoin = nonlethalMinion
      .findPlayer(nonlethalBefore, nonlethalParticipantId)
      .hand.find((card) => card.cardId === 'basic_the_coin')
    const nonlethalTarget = nonlethalMinion.findPlayer(
      nonlethalBefore,
      nonlethalMinion.localParticipantId
    ).board[0]
    if (!nonlethalCoin || !nonlethalTarget)
      throw new Error('Expected The Coin and a durable enemy minion.')
    const nonlethalLine: TurnMatchCommand[] = [
      {
        type: 'play-card',
        participantId: nonlethalParticipantId,
        cardInstanceId: nonlethalCoin.instanceId
      },
      {
        type: 'use-hero-power',
        participantId: nonlethalParticipantId,
        target: {
          kind: 'minion',
          participantId: nonlethalMinion.localParticipantId,
          instanceId: nonlethalTarget.instanceId
        }
      }
    ]
    expect(
      expertCoinHeroPowerSequencePenalty(
        nonlethalLine,
        nonlethalBefore,
        simulateLine(nonlethalMinion, nonlethalLine),
        nonlethalParticipantId
      )
    ).toBe(3)

    const priest = firstTurnCoinFixture({
      aiHeroId: 'anduin',
      opponentBoard: [{ cardId: 'basic_murloc_scout' }]
    })
    const priestBefore = priest.getState()
    const priestParticipantId = priest.remoteParticipantId
    const priestCoin = priest
      .findPlayer(priestBefore, priestParticipantId)
      .hand.find((card) => card.cardId === 'basic_the_coin')
    const priestTarget = priest.findPlayer(priestBefore, priest.localParticipantId)
      .board[0]
    if (!priestCoin || !priestTarget)
      throw new Error('Expected The Coin and an enemy target for Priest.')
    const priestLine: TurnMatchCommand[] = [
      {
        type: 'play-card',
        participantId: priestParticipantId,
        cardInstanceId: priestCoin.instanceId
      },
      {
        type: 'use-hero-power',
        participantId: priestParticipantId,
        target: {
          kind: 'minion',
          participantId: priest.localParticipantId,
          instanceId: priestTarget.instanceId
        }
      }
    ]
    expect(
      expertCoinHeroPowerSequencePenalty(
        priestLine,
        priestBefore,
        simulateLine(priest, priestLine),
        priestParticipantId
      )
    ).toBe(3)

    const synergyAfter = {
      ...afterWastefulLine,
      players: afterWastefulLine.players.map((player) =>
        player.participantId === participantId
          ? { ...player, hero: { ...player.hero, armor: player.hero.armor + 1 } }
          : player
      ) as unknown as typeof afterWastefulLine.players
    }
    expect(
      expertCoinHeroPowerSequencePenalty(
        wastefulLine,
        before,
        synergyAfter,
        participantId
      )
    ).toBe(3)
  })

  it('does not penalize Coin into a hero power after the first turn', () => {
    const session = firstTurnCoinFixture({
      aiMana: 2,
      aiMaximumMana: 2,
      turnNumber: 3,
      opponentBoard: []
    })
    const before = session.getState()
    const participantId = session.remoteParticipantId
    const coin = session
      .findPlayer(before, participantId)
      .hand.find((card) => card.cardId === 'basic_the_coin')
    if (!coin) throw new Error('Expected The Coin in hand.')
    const line: TurnMatchCommand[] = [
      { type: 'play-card', participantId, cardInstanceId: coin.instanceId },
      {
        type: 'use-hero-power',
        participantId,
        target: { kind: 'hero', participantId: session.localParticipantId }
      }
    ]
    expect(
      expertCoinHeroPowerSequencePenalty(
        line,
        before,
        simulateLine(session, line),
        participantId
      )
    ).toBe(0)
  })

  it('penalizes untargeted Hunter hero power and still permits its immediate lethal', () => {
    const session = firstTurnCoinFixture({
      aiHeroId: 'rexxar',
      opponentHeroId: 'jaina',
      opponentBoard: [],
      aiHand: ['basic_the_coin', 'basic_innervate'],
      opponentHealth: 30
    })
    const before = session.getState()
    const participantId = session.remoteParticipantId
    const coin = session
      .findPlayer(before, participantId)
      .hand.find((card) => card.cardId === 'basic_the_coin')
    const innervate = session
      .findPlayer(before, participantId)
      .hand.find((card) => card.cardId === 'basic_innervate')
    if (!coin || !innervate) throw new Error('Expected Coin and Innervate in hand.')
    const line: TurnMatchCommand[] = [
      { type: 'play-card', participantId, cardInstanceId: coin.instanceId },
      { type: 'use-hero-power', participantId },
      { type: 'play-card', participantId, cardInstanceId: innervate.instanceId }
    ]
    const afterHeroPower = simulateLine(session, line.slice(0, 2))
    expect(
      expertCoinHeroPowerSequencePenalty(line, before, afterHeroPower, participantId)
    ).toBe(3)
    expect(simulateLine(session, line).history?.cardsPlayedThisTurn).toContain(
      'basic_innervate'
    )

    const lethal = firstTurnCoinFixture({
      aiHeroId: 'rexxar',
      opponentHeroId: 'jaina',
      opponentBoard: [],
      opponentHealth: 2
    })
    const lethalBefore = lethal.getState()
    const lethalParticipantId = lethal.remoteParticipantId
    const lethalCoin = lethal
      .findPlayer(lethalBefore, lethalParticipantId)
      .hand.find((card) => card.cardId === 'basic_the_coin')
    if (!lethalCoin) throw new Error('Expected The Coin in the Hunter hand.')
    const lethalLine: TurnMatchCommand[] = [
      {
        type: 'play-card',
        participantId: lethalParticipantId,
        cardInstanceId: lethalCoin.instanceId
      },
      { type: 'use-hero-power', participantId: lethalParticipantId }
    ]
    const lethalAfter = simulateLine(lethal, lethalLine)
    expect(lethalAfter.winnerId).toBe(lethalParticipantId)
    expect(
      expertCoinHeroPowerSequencePenalty(
        lethalLine,
        lethalBefore,
        lethalAfter,
        lethalParticipantId
      )
    ).toBe(0)
  })

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
          continuationPreference: candidate.scoreComponents.continuationPreference
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
