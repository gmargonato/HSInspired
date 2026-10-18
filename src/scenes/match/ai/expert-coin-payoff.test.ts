import { describe, expect, it } from 'vitest'
import { enumerateLegalCommands } from '../../../game-rules/match/ai'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import {
  createAiFixture,
  type AiFixtureOptions
} from '../../../game-rules/match/testing/ai-scenario-builder'
import { aiActions } from './ai-context'
import { GameBoardSession } from '../game-board-session'
import { LocalAiDecisionApi } from './local-ai-decision-api'

async function decide(options: AiFixtureOptions, requestId: string) {
  const fixture = createAiFixture(options)
  const fair = createFairHypothesisCheckpoint(
    fixture.checkpoint,
    fixture.aiParticipantId,
    options.seed ^ 0x7204
  )
  const session = new GameBoardSession({
    setup: fair.setup,
    decks: fair.decks,
    checkpoint: fair
  })
  const api = new LocalAiDecisionApi(session, undefined, {
    profile: 'expert',
    fairHypothesis: true,
    workBudget: 750,
    budgetMs: 2000
  })
  const state = session.getState()
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
  const response = await api.decide({
    matchId: requestId,
    requestId,
    expectedRevision: state.revision,
    phase: 'action',
    allowInspection: false,
    messages: [{ role: 'user', content: '{}' }],
    actionIds: actions.map((action) => action.id)
  })
  const selected = actions.find(
    (action) => 'actionId' in response.choice && action.id === response.choice.actionId
  )
  const coin = actions.find((action) => {
    const command = action.command
    return (
      command.type === 'play-card' &&
      session
        .findPlayer(state, session.remoteParticipantId)
        .hand.some(
          (card) =>
            card.instanceId === command.cardInstanceId &&
            card.cardId === 'basic_the_coin'
        )
    )
  })
  expect(coin).toBeDefined()
  expect(selected).toBeDefined()
  expect(session.getState()).toEqual(state)
  return { selected, coin, trace: api.getLastTrace() }
}

describe('Expert supported Coin payoff ranking', () => {
  it('uses the repeatedly sampled Coin continuation that enables quest completion', async () => {
    const { selected, coin, trace } = await decide(
      {
        seed: 610144,
        aiHeroId: 'valeera',
        opponentHeroId: 'jaina',
        aiMana: 2,
        aiMaximumMana: 2,
        aiHeroPowerAvailable: false,
        opponentHeroPowerAvailable: false,
        aiQuest: {
          cardId: 'journey_to_ungoro_the_caverns_below',
          progress: 4,
          playedNames: { 'Fire Fly': 4 }
        },
        aiBoard: [{ cardId: 'journey_to_ungoro_fire_fly', ready: false }],
        aiHand: ['basic_the_coin', 'mean_streets_of_gadgetzan_gadgetzan_ferryman'],
        aiDeck: [
          'journey_to_ungoro_fire_fly',
          'classic_shadowstep',
          'classic_youthful_brewmaster',
          'basic_stonetusk_boar',
          'journey_to_ungoro_flame_elemental',
          'basic_novice_engineer'
        ],
        opponentDeck: ['basic_chillwind_yeti', 'basic_bloodfen_raptor'],
        turnNumber: 9
      },
      'quest-tuning-ferryman-coin-setup-0'
    )
    expect(selected?.id).toBe(coin?.id)
    expect(
      trace?.candidates.find((candidate) => candidate.actionId === coin?.id)?.visits
    ).toBeGreaterThan(1)
  }, 30_000)

  it('does not promote a sampled random Coin payoff that can kill its own hero', async () => {
    const { selected, coin, trace } = await decide(
      {
        seed: 610415,
        aiHeroId: 'jaina',
        opponentHeroId: 'valeera',
        aiHealth: 1,
        aiMana: 1,
        aiMaximumMana: 1,
        aiHeroPowerAvailable: true,
        opponentHeroPowerAvailable: false,
        aiHand: ['basic_the_coin', 'classic_mad_bomber'],
        aiDeck: Array(6).fill('basic_chillwind_yeti'),
        opponentDeck: Array(6).fill('basic_chillwind_yeti'),
        turnNumber: 2
      },
      'coin-stochastic-guard-0'
    )
    const candidate = trace?.candidates.find(
      (candidate) => candidate.actionId === coin?.id
    )
    expect(candidate?.visits).toBeGreaterThan(1)
    expect(candidate?.provenWin).not.toBe(true)
    expect(selected?.id).not.toBe(coin?.id)
  }, 30_000)
})
