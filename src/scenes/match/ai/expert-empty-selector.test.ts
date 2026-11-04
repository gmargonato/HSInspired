import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AiDecisionRequest,
  AiDecisionResponse,
  JsonObject
} from '../../../desktop/contracts/ipc/ai'
import { enumerateLegalCommands } from '../../../game-rules/match'
import {
  createAiFixture,
  type AiFixtureOptions
} from '../../../game-rules/match/testing/ai-scenario-builder'
import { GameBoardSession } from '../game-board-session'
import { aiActions } from './ai-context'
import { aiActionIntent } from './ai-action-intent'
import {
  createExpertActionInspector,
  expertContinuationPenalty,
  inspectExpertAction
} from './expert-action-outcome'
import { ExpertAiDecisionApi } from './expert-ai-decision-api'
import { selectExpertTimeoutFallbackAction } from './expert-ai-timeout-fallback'
import type {
  ExpertAiWorkerRequest,
  ExpertAiWorkerResponse
} from './expert-ai-worker-protocol'

function fixture(options: Partial<AiFixtureOptions> = {}, spellId = 'basic_vanish') {
  const built = createAiFixture({
    seed: 610091,
    aiHeroId: 'valeera',
    opponentHeroId: 'garrosh',
    turnNumber: 15,
    aiMana: 6,
    aiMaximumMana: 8,
    aiHand: ['basic_vanish'],
    aiHeroPowerAvailable: false,
    aiHeroPowerUsesThisTurn: 1,
    opponentHeroPowerAvailable: false,
    opponentHeroPowerUsesThisTurn: 1,
    aiDeck: ['basic_bloodfen_raptor'],
    opponentDeck: ['basic_bloodfen_raptor'],
    ...options
  })
  // Live cards carry an explicit knowledge list; normalize the fixture's omitted field.
  const knownCards = (player: (typeof built.checkpoint.state.players)[number]) => ({
    ...player,
    hand: player.hand.map((card) => ({ ...card, knownTo: card.knownTo ?? [] }))
  })
  const checkpoint: typeof built.checkpoint = {
    ...built.checkpoint,
    // Match normal gameplay: fair forks discard diagnostic effect traces.
    setup: { ...built.setup, recordEffectTrace: false },
    state: {
      ...built.checkpoint.state,
      effectTrace: undefined,
      players: [
        knownCards(built.checkpoint.state.players[0]),
        knownCards(built.checkpoint.state.players[1])
      ]
    }
  }
  const session = new GameBoardSession({
    setup: checkpoint.setup,
    decks: built.decks,
    checkpoint
  })
  const actor = session.remoteParticipantId
  const commands = () =>
    enumerateLegalCommands(
      {
        getState: session.match.getState,
        getPlayInput: session.match.getPlayInput!,
        getLegality: session.match.getLegality!
      },
      actor
    )
  const vanish = session
    .findPlayer(session.getState(), actor)
    .hand.find((card) => card.cardId === spellId)!
  const command = commands().find(
    (command) =>
      command.type === 'play-card' && command.cardInstanceId === vanish.instanceId
  )!
  expect(command).toBeDefined()
  return { session, actor, commands, command }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Expert empty-selector expenditure', () => {
  it('rejects a quiet last-card Vanish without modifying the live checkpoint', () => {
    const { session, actor, command } = fixture()
    const checkpoint = session.match.getCheckpoint()
    expect(
      session.match.analyze((fork) => inspectExpertAction(fork, actor, command))
    ).toEqual({ penalty: 0.35, reason: 'no-payoff' })
    expect(
      createExpertActionInspector(checkpoint, actor, () => false)(command)
    ).toEqual({ penalty: 0.35, reason: 'no-payoff' })
    expect(session.match.getCheckpoint()).toEqual(checkpoint)
  })

  it('penalizes the wasted suffix while preserving useful hero damage', () => {
    const { session, actor, commands, command } = fixture({
      aiWeapon: { cardId: 'basic_wicked_knife', durability: 2 }
    })
    const attack = commands().find((command) => command.type === 'attack-character')!
    expect(attack).toBeDefined()
    expect(
      session.match.analyze((fork) => inspectExpertAction(fork, actor, attack))
    ).toEqual({ penalty: 0 })
    expect(
      session.match.analyze((fork) =>
        expertContinuationPenalty(fork, actor, [
          attack,
          command,
          { type: 'end-turn', participantId: actor }
        ])
      )
    ).toBe(0.35)
    expect(selectExpertTimeoutFallbackAction(session, commands())?.command.type).toBe(
      'attack-character'
    )
    expect(session.dispatch(attack).accepted).toBe(true)
    expect(selectExpertTimeoutFallbackAction(session, commands())?.command.type).toBe(
      'end-turn'
    )
  })

  it.each<[string, Partial<AiFixtureOptions>]>([
    [
      'held Combo payoff',
      { aiHand: ['basic_vanish', 'mean_streets_of_gadgetzan_gadgetzan_ferryman'] }
    ],
    ['spell trigger', { aiBoard: [{ cardId: 'classic_gadgetzan_auctioneer' }] }],
    [
      'cast quest',
      { aiQuest: { cardId: 'journey_to_ungoro_open_the_waygate', progress: 1 } }
    ],
    ['concealed secret', { opponentSecrets: [{ cardId: 'classic_counterspell' }] }],
    ['temporary mana', { aiTemporaryMana: 1 }],
    [
      'available hero power',
      { aiHeroPowerAvailable: true, aiHeroPowerUsesThisTurn: 0 }
    ],
    [
      'adjusted spell cost',
      {
        aiHand: [
          {
            cardId: 'basic_vanish',
            costAdjustments: [
              {
                id: 'discount',
                sourceInstanceId: 'setup',
                amount: -1,
                duration: 'this-turn'
              }
            ]
          }
        ]
      }
    ],
    [
      'known future spell-history payoff',
      { aiDeck: ['whispers_of_the_old_gods_yogg_saron_hopes_end'] }
    ],
    ['weapon trigger', { aiWeapon: { cardId: 'classic_sword_of_justice' } }],
    ['useful bounce target', { opponentBoard: [{ cardId: 'basic_boulderfist_ogre' }] }]
  ])('abstains when there is %s', (_name, options) => {
    const { session, actor, command } = fixture(options)
    expect(
      createExpertActionInspector(
        session.match.getCheckpoint(),
        actor,
        () => false
      )(command)
    ).toEqual({ penalty: 0 })
  })

  it('keeps a deadline for live callers and honors an explicit fixed-work stop', () => {
    const { session, actor, command } = fixture()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const inspect = createExpertActionInspector(session.match.getCheckpoint(), actor)
    now = 26
    expect(inspect(command)).toEqual({ penalty: 0 })
    expect(
      createExpertActionInspector(
        session.match.getCheckpoint(),
        actor,
        () => true
      )(command)
    ).toEqual({ penalty: 0 })
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 100
      return now
    })
    expect(
      createExpertActionInspector(
        session.match.getCheckpoint(),
        actor,
        () => false
      )(command)
    ).toEqual({ penalty: 0.35, reason: 'no-payoff' })
  })
})

describe('Expert empty enemy transform selector', () => {
  const devolve = 'mean_streets_of_gadgetzan_devolve'
  const settings: Partial<AiFixtureOptions> = {
    aiHeroId: 'thrall',
    turnNumber: 18,
    aiMana: 5,
    aiMaximumMana: 10,
    aiHand: [
      'the_grand_tournament_healing_wave',
      'the_grand_tournament_healing_wave',
      devolve,
      'journey_to_ungoro_tidal_surge',
      'basic_hex',
      'journey_to_ungoro_tidal_surge'
    ],
    aiBoard: [
      { cardId: 'classic_baine_bloodhoof', ready: true, attacksUsedThisTurn: 1 },
      { cardId: 'classic_frog' }
    ],
    opponentHealth: 18,
    opponentWeapon: { cardId: 'classic_gorehowl' },
    opponentQuest: { cardId: 'journey_to_ungoro_enter_the_lost_city', progress: 9 }
  }

  it('retains Devolve on the reconstructed empty enemy board with other cards held', () => {
    const { session, actor, command } = fixture(settings, devolve)
    const checkpoint = session.match.getCheckpoint()
    expect(
      session.match.analyze((fork) => inspectExpertAction(fork, actor, command))
    ).toEqual({ penalty: 0.35, reason: 'no-payoff' })
    expect(
      createExpertActionInspector(checkpoint, actor, () => false)(command)
    ).toEqual({ penalty: 0.35, reason: 'no-payoff' })
    expect(session.match.getCheckpoint()).toEqual(checkpoint)
  })

  it('allows mana to be retained while hero power is still available', () => {
    const { session, actor, command } = fixture(
      {
        ...settings,
        aiHeroPowerAvailable: true,
        aiHeroPowerUsesThisTurn: 0
      },
      devolve
    )
    expect(
      createExpertActionInspector(
        session.match.getCheckpoint(),
        actor,
        () => false
      )(command)
    ).toEqual({ penalty: 0.35, reason: 'no-payoff' })
  })

  it.each<[string, Partial<AiFixtureOptions>]>([
    ['an enemy minion', { opponentBoard: [{ cardId: 'basic_boulderfist_ogre' }] }],
    ['a spell draw trigger', { aiBoard: [{ cardId: 'classic_gadgetzan_auctioneer' }] }],
    [
      'a spell damage trigger',
      {
        aiBoard: [
          { cardId: 'classic_wild_pyromancer' },
          { cardId: 'basic_healing_totem' }
        ]
      }
    ],
    ['a spell growth trigger', { aiBoard: [{ cardId: 'classic_mana_wyrm' }] }],
    [
      'a held Combo payoff',
      { aiHand: [devolve, 'mean_streets_of_gadgetzan_gadgetzan_ferryman'] }
    ],
    [
      'a future spell history payoff',
      { aiDeck: ['whispers_of_the_old_gods_yogg_saron_hopes_end'] }
    ],
    [
      'an active cast quest',
      { aiQuest: { cardId: 'journey_to_ungoro_open_the_waygate', progress: 1 } }
    ],
    [
      'a concealed opponent secret',
      { opponentSecrets: [{ cardId: 'classic_counterspell' }] }
    ],
    [
      'a full hand before a draw',
      { aiHand: [devolve, ...Array<string>(9).fill('basic_bloodfen_raptor')] }
    ],
    ['a resource override', { aiTemporaryMana: 1 }],
    [
      'held card draw before a full hand',
      {
        aiHand: [
          devolve,
          'basic_arcane_intellect',
          ...Array<string>(7).fill('basic_bloodfen_raptor')
        ]
      }
    ],
    ['a held discard follow-up', { aiHand: [devolve, 'basic_soulfire'] }]
  ])('preserves transform when there is %s', (_name, options) => {
    const { session, actor, command } = fixture({ ...settings, ...options }, devolve)
    expect(
      createExpertActionInspector(
        session.match.getCheckpoint(),
        actor,
        () => false
      )(command)
    ).toEqual({ penalty: 0 })
  })

  it('preserves the hand slot needed for Echo of Medivh copies', () => {
    const { session, actor, commands, command } = fixture(
      {
        aiHeroId: 'thrall',
        aiMana: 6,
        aiHand: [
          devolve,
          'goblins_vs_gnomes_echo_of_medivh',
          ...Array<string>(7).fill('basic_boulderfist_ogre')
        ],
        aiBoard: [
          { cardId: 'basic_chillwind_yeti' },
          { cardId: 'basic_senjin_shieldmasta' },
          { cardId: 'basic_stormwind_champion' }
        ]
      },
      devolve
    )
    const before = session.match.getCheckpoint()
    const echo = session
      .findPlayer(session.getState(), actor)
      .hand.find((card) => card.cardId === 'goblins_vs_gnomes_echo_of_medivh')!
    const copy = commands().find(
      (command) =>
        command.type === 'play-card' && command.cardInstanceId === echo.instanceId
    )!
    expect(createExpertActionInspector(before, actor, () => false)(command)).toEqual({
      penalty: 0
    })
    const copiedChampion = (makeRoom: boolean) =>
      session.match.analyze((fork) => {
        if (makeRoom) expect(fork.dispatch(command).accepted).toBe(true)
        const result = fork.dispatch(copy)
        expect(result.accepted).toBe(true)
        return result.state.players
          .find((player) => player.participantId === actor)!
          .hand.some((card) => card.cardId === 'basic_stormwind_champion')
      })
    expect(copiedChampion(false)).toBe(false)
    expect(copiedChampion(true)).toBe(true)
    expect(session.match.getCheckpoint()).toEqual(before)
  })

  it('honors cancellation without modifying the live state', () => {
    const { session, actor, command } = fixture(settings, devolve)
    const checkpoint = session.match.getCheckpoint()
    expect(createExpertActionInspector(checkpoint, actor, () => true)(command)).toEqual(
      { penalty: 0 }
    )
    expect(session.match.getCheckpoint()).toEqual(checkpoint)
  })
})

describe('Expert empty-selector continuation review', () => {
  it.each(
    ['basic_vanish', 'mean_streets_of_gadgetzan_devolve'].flatMap((spellId) =>
      (['waste', 'pass', 'failure', 'timeout'] as const).map(
        (mode) => [spellId, mode] as const
      )
    )
  )('does not replay cached %s after %s', async (spellId, mode) => {
    if (mode === 'timeout') vi.useFakeTimers()
    const { session, actor, commands } = fixture(
      {
        aiHand: [spellId],
        aiWeapon: { cardId: 'basic_wicked_knife', durability: 2 }
      },
      spellId
    )
    const actions = () => aiActions(session, commands())
    let receive: ((event: MessageEvent<ExpertAiWorkerResponse>) => void) | undefined
    let calls = 0,
      now = 0
    const worker = {
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') receive = listener as typeof receive
      },
      postMessage(message: ExpertAiWorkerRequest) {
        if (message.type !== 'decide') return
        calls++
        if (calls > 1 && mode === 'failure') {
          receive?.({
            data: {
              type: 'failure',
              requestId: message.request.requestId,
              error: 'fixture failure'
            }
          } as MessageEvent<ExpertAiWorkerResponse>)
          return
        }
        if (calls > 1 && mode === 'timeout') return
        const selected = actions().find(
          (action) =>
            action.command.type ===
            (calls === 1
              ? 'attack-character'
              : mode === 'waste'
                ? 'play-card'
                : 'end-turn')
        )!
        const line =
          calls === 1
            ? ['attack-character', 'play-card', 'end-turn'].map((type) =>
                actions().find((action) => action.command.type === type)!
              )
            : [selected]
        const response: AiDecisionResponse = {
          matchId: message.request.matchId,
          requestId: message.request.requestId,
          expectedRevision: message.request.expectedRevision,
          modelId: 'hardware-local-v2',
          reason: 'Controlled continuation review.',
          durationMs: 0,
          finishReason: 'fixture-search',
          choice: {
            actionId: selected.id,
            intent: aiActionIntent(selected.command, session.localParticipantId),
            expectedResult: 'Controlled fixture.',
            planUpdate: null
          },
          usage: {
            plannedActionIntents: line.map((action) =>
              aiActionIntent(action.command, session.localParticipantId)
            )
          } as unknown as JsonObject
        }
        receive?.({
          data: { type: 'decision', requestId: message.request.requestId, response }
        } as MessageEvent<ExpertAiWorkerResponse>)
      },
      terminate() {}
    } as unknown as Worker
    const api = new ExpertAiDecisionApi(
      session,
      () => worker,
      () => now
    )
    const request = (): AiDecisionRequest => ({
      matchId: 'empty-selector',
      requestId: `empty-selector-${session.getState().revision}`,
      expectedRevision: session.getState().revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: actions().map((action) => action.id)
    })
    try {
      const first = await api.decide(request())
      const attack = actions().find(
        (action) => 'actionId' in first.choice && action.id === first.choice.actionId
      )!
      expect(attack.command.type).toBe('attack-character')
      expect(session.dispatch(attack.command).accepted).toBe(true)
      const pending = api.decide(request())
      if (mode === 'failure' || mode === 'timeout') {
        const result = pending.then(
          () => ({ rejected: false }),
          () => ({ rejected: true })
        )
        if (mode === 'timeout') {
          now = 60_000
          await vi.advanceTimersByTimeAsync(60_000)
        }
        expect((await result).rejected).toBe(true)
      } else {
        const response = await pending
        const selected = actions().find(
          (action) =>
            'actionId' in response.choice && action.id === response.choice.actionId
        )!
        expect(selected.command.type).toBe('end-turn')
        expect(session.dispatch(selected.command).accepted).toBe(true)
      }
      expect(calls).toBe(2)
      expect(
        session.findPlayer(session.getState(), actor).hand.map((card) => card.cardId)
      ).toEqual([spellId])
    } finally {
      api.dispose()
    }
  })
})
