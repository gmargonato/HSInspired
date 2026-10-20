import { describe, expect, it, vi } from 'vitest'
import { CARD_CATALOG } from '../../../game-rules/content/cards'
import {
  findExpertTimeoutCombatRescue,
  EXPERT_TIMEOUT_COMBAT_RESCUE_MAX_DISPATCHES
} from './expert-timeout-combat-rescue'
import type { PlayCardInput } from '../../../game-rules/match/opening-match-types'
import { createAiFixture } from '../../../game-rules/match/testing/ai-scenario-builder'
import {
  enumerateLegalCommands,
  type TurnMatchCommand
} from '../../../game-rules/match'
import { GameBoardSession } from '../game-board-session'
import { ExpertAiDecisionApi } from './expert-ai-decision-api'
import { AiTurnController } from './ai-turn-controller'
import { EXPERT_AI_DEFAULT_BUDGET } from './expert-ai-worker-protocol'
import {
  selectExpertTimeoutFallbackAction,
  immediateExpertTimeoutActions
} from './expert-ai-timeout-fallback'

function createSession(
  options: Parameters<typeof createAiFixture>[0]
): GameBoardSession {
  const fixture = createAiFixture(options)
  return new GameBoardSession({
    setup: fixture.setup,
    decks: fixture.decks,
    checkpoint: fixture.checkpoint
  })
}

function legalCommands(session: GameBoardSession) {
  return enumerateLegalCommands(
    {
      getState: () => session.getState(),
      getPlayInput: session.match.getPlayInput!,
      getLegality: session.match.getLegality!
    },
    session.remoteParticipantId
  )
}

function playCoin(session: GameBoardSession): void {
  const participantId = session.remoteParticipantId
  const coin = session
    .findPlayer(session.getState(), participantId)
    .hand.find((card) => card.cardId === 'basic_the_coin')
  if (!coin) throw new Error('Expected The Coin in the AI hand.')
  const result = session.match.dispatch({
    type: 'play-card',
    participantId,
    cardInstanceId: coin.instanceId
  })
  if (!result.accepted) throw new Error(result.message)
}

describe('Expert timeout fallback', () => {
  it('ends the turn instead of using Hunter hero power after first-turn Coin', () => {
    const session = createSession({
      seed: 0xfab0,
      aiHeroId: 'rexxar',
      opponentHeroId: 'jaina',
      aiHand: ['basic_the_coin'],
      aiMana: 1,
      aiMaximumMana: 1,
      turnNumber: 2,
      opponentHealth: 30,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze']
    })
    playCoin(session)
    expect(session.getState().history?.cardsPlayedThisTurn).toContain('basic_the_coin')

    const action = selectExpertTimeoutFallbackAction(session, legalCommands(session))

    expect(action?.command.type).toBe('end-turn')
  })

  it('allows Mage hero power when it kills an opposing minion after Coin', () => {
    const session = createSession({
      seed: 0xfab4,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHand: ['basic_the_coin'],
      aiMana: 1,
      aiMaximumMana: 1,
      turnNumber: 2,
      opponentBoard: [{ cardId: 'basic_murloc_scout' }],
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze']
    })
    playCoin(session)

    const action = selectExpertTimeoutFallbackAction(session, legalCommands(session))

    expect(action?.command).toMatchObject({
      type: 'use-hero-power',
      target: { kind: 'minion', participantId: session.localParticipantId }
    })
  })

  it('allows a non-Mage Coin hero power when it immediately wins the match', () => {
    const session = createSession({
      seed: 0xfab5,
      aiHeroId: 'rexxar',
      opponentHeroId: 'jaina',
      aiHand: ['basic_the_coin'],
      aiMana: 1,
      aiMaximumMana: 1,
      turnNumber: 2,
      opponentHealth: 2,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze']
    })
    playCoin(session)

    const action = selectExpertTimeoutFallbackAction(session, legalCommands(session))

    expect(action?.command).toMatchObject({ type: 'use-hero-power' })
    if (action?.command.type !== 'use-hero-power')
      throw new Error('Expected Hunter Steady Shot to take immediate lethal.')
    const result = session.match.dispatch(action.command)
    expect(result.accepted).toBe(true)
    expect(session.getState().winnerId).toBe(session.remoteParticipantId)
  })

  it('uses a playable minion instead of passing with an empty board', () => {
    const session = createSession({
      seed: 0xfab1,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHand: ['basic_stonetusk_boar'],
      aiMana: 1,
      aiMaximumMana: 1,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      aiHeroPowerAvailable: false
    })
    const legal = legalCommands(session)

    const action = selectExpertTimeoutFallbackAction(session, legal)

    expect(legal.some((command) => command.type === 'end-turn')).toBe(true)
    expect(action?.command.type).toBe('play-card')
    if (action?.command.type !== 'play-card')
      throw new Error('Expected the fallback to develop Stonetusk Boar.')
    const command = action.command
    const card = session
      .findPlayer(session.getState(), session.remoteParticipantId)
      .hand.find((entry) => entry.instanceId === command.cardInstanceId)
    expect(card?.cardId).toBe('basic_stonetusk_boar')
  })

  it('plays a Taunt minion to address visible lethal pressure', () => {
    const session = createSession({
      seed: 0xfab2,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHand: ['basic_senjin_shieldmasta'],
      aiMana: 4,
      aiMaximumMana: 4,
      aiHealth: 8,
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', ready: true },
        { cardId: 'basic_boulderfist_ogre', ready: true }
      ],
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      aiHeroPowerAvailable: false
    })
    const action = selectExpertTimeoutFallbackAction(session, legalCommands(session))

    expect(action?.command.type).toBe('play-card')
    if (action?.command.type !== 'play-card')
      throw new Error('Expected a defensive Taunt play.')
    const command = action.command
    const card = session
      .findPlayer(session.getState(), session.remoteParticipantId)
      .hand.find((entry) => entry.instanceId === command.cardInstanceId)
    expect(card?.cardId).toBe('basic_senjin_shieldmasta')
  })

  it('takes an available face lethal before spending resources', () => {
    const session = createSession({
      seed: 0xfab3,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHand: ['basic_river_crocolisk'],
      aiBoard: [{ cardId: 'basic_stonetusk_boar', ready: true }],
      opponentHealth: 1,
      aiMana: 2,
      aiMaximumMana: 2,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      aiHeroPowerAvailable: false
    })
    const action = selectExpertTimeoutFallbackAction(session, legalCommands(session))
    expect(action?.command).toMatchObject({
      type: 'attack-character',
      attacker: { kind: 'minion' },
      defender: { kind: 'hero' }
    })
  })
})

describe('Generic immediate-effect fallback semantics', () => {
  function fixture(
    hand: readonly string[],
    extra: Partial<Parameters<typeof createAiFixture>[0]> = {}
  ) {
    return createSession({
      seed: 0xfa110,
      aiHeroId: 'uther',
      opponentHeroId: 'thrall',
      aiMana: 10,
      aiHeroPowerAvailable: false,
      aiHand: hand,
      aiDeck: ['basic_chillwind_yeti'],
      opponentDeck: ['basic_chillwind_yeti'],
      ...extra
    })
  }
  function onlyCardAndPass(
    session: GameBoardSession,
    predicate: (
      command: Extract<ReturnType<typeof legalCommands>[number], { type: 'play-card' }>
    ) => boolean = () => true
  ) {
    return legalCommands(session).filter(
      (command) =>
        command.type === 'end-turn' ||
        (command.type === 'play-card' && predicate(command))
    )
  }

  it('does not buff the enemy on the exact saved C6 root and leaves selection state untouched', async () => {
    const { default: raw } = await import('./fixtures/timeout-fallback-paladin.json')
    const checkpoint =
      raw as unknown as import('../../../game-rules/match').OpeningMatchCheckpoint
    const session = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
    const before = JSON.stringify(session.match.getCheckpoint())
    const legal = legalCommands(session)
    expect(legal).toHaveLength(16)
    const face = legal.filter(
      (c) => c.type === 'attack-character' && c.defender.kind === 'hero'
    )
    expect(face.length).toBeGreaterThan(0)
    const selected = selectExpertTimeoutFallbackAction(session, legal)!
    expect(JSON.stringify(session.match.getCheckpoint())).toBe(before)
    expect(legal).toContainEqual(selected.command)
    expect(selected.command.type).not.toBe('end-turn')
    if (selected.command.type === 'play-card')
      expect(
        selected.command.targets?.every(
          (target) => target.participantId === session.remoteParticipantId
        )
      ).toBe(true)
    const applied = session.match.dispatch(selected.command)
    expect(applied.accepted).toBe(true)
    const enemy = session
      .getState()
      .players.find((p) => p.participantId !== session.remoteParticipantId)!
    expect(
      enemy.board.find((m) => m.cardId === 'the_grand_tournament_totem_golem')
    ).toMatchObject({ attack: 3, health: 4 })
    expect(
      legalCommands(session).some(
        (c) => c.type === 'attack-character' && c.defender.kind === 'hero'
      )
    ).toBe(true)
  })

  it.each([
    'journey_to_ungoro_spikeridged_steed',
    'basic_blessing_of_kings',
    'basic_power_word_shield'
  ])('prefers the friendly recipient of %s', (cardId) => {
    const session = fixture([cardId], {
      aiBoard: [{ cardId: 'basic_chillwind_yeti' }],
      opponentBoard: [{ cardId: 'basic_chillwind_yeti' }]
    })
    const action = selectExpertTimeoutFallbackAction(session, onlyCardAndPass(session))!
    expect(action.command.type).toBe('play-card')
    if (action.command.type === 'play-card')
      expect(action.command.targets?.[0]?.participantId).toBe(
        session.remoteParticipantId
      )
  })

  it('preserves literal set-stat enemy debuffs without a blanket enemy-target veto', () => {
    const session = fixture(['basic_humility'], {
      opponentBoard: [{ cardId: 'basic_boulderfist_ogre', attack: 8 }]
    })
    const action = selectExpertTimeoutFallbackAction(session, onlyCardAndPass(session))!
    expect(action.command.type).toBe('play-card')
    if (action.command.type === 'play-card')
      expect(action.command.targets?.[0]?.participantId).toBe(
        session.localParticipantId
      )
  })

  it('does not erase a harmful chosen buff with a separate draw benefit', () => {
    const session = fixture(['basic_power_word_shield'], {
      opponentBoard: [{ cardId: 'basic_chillwind_yeti' }]
    })
    expect(
      selectExpertTimeoutFallbackAction(session, onlyCardAndPass(session))?.command.type
    ).toBe('end-turn')
  })

  it.each([
    'classic_blessing_of_wisdom',
    'classic_ancestral_spirit',
    'classic_soul_of_the_forest'
  ])('does not credit an installed future payload as immediate for %s', (cardId) => {
    const session = fixture([cardId], {
      aiBoard: [{ cardId: 'basic_chillwind_yeti' }],
      opponentBoard: [{ cardId: 'basic_chillwind_yeti' }]
    })
    expect(
      selectExpertTimeoutFallbackAction(session, onlyCardAndPass(session))?.command.type
    ).toBe('end-turn')
  })

  it('scores the selected choose-one summon without borrowing it for the buff choice', () => {
    const session = fixture(['classic_power_of_the_wild'], { aiHeroId: 'malfurion' })
    expect(
      selectExpertTimeoutFallbackAction(
        session,
        onlyCardAndPass(session, (c) => c.choice === 0)
      )?.command.type
    ).toBe('end-turn')
    const summon = selectExpertTimeoutFallbackAction(
      session,
      onlyCardAndPass(session, (c) => c.choice === 1)
    )!
    expect(summon.command).toMatchObject({ type: 'play-card', choice: 1 })
  })

  it('retains a real immediate self summon', () => {
    const session = fixture(['basic_mirror_image'], { aiHeroId: 'jaina' })
    expect(
      selectExpertTimeoutFallbackAction(session, onlyCardAndPass(session))?.command.type
    ).toBe('play-card')
  })

  it('retains supported own-drawback Silence plus draw without inventing a new silence evaluator', () => {
    const session = fixture(['one_night_in_karazhan_purify'], {
      aiHeroId: 'anduin',
      aiBoard: [{ cardId: 'classic_ancient_watcher' }]
    })
    const action = selectExpertTimeoutFallbackAction(session, onlyCardAndPass(session))!
    expect(action.command.type).toBe('play-card')
    if (action.command.type === 'play-card')
      expect(action.command.targets?.[0]?.participantId).toBe(
        session.remoteParticipantId
      )
  })

  it('preserves a current lethal ahead of nonlethal buff value', () => {
    const session = fixture(['basic_blessing_of_kings'], {
      aiBoard: [{ cardId: 'basic_chillwind_yeti', ready: true }],
      opponentHealth: 4
    })
    expect(
      selectExpertTimeoutFallbackAction(session, legalCommands(session))?.command.type
    ).toBe('attack-character')
  })
})

describe('Immediate fallback traversal boundaries', () => {
  function collect(
    effects: unknown[],
    input: Partial<PlayCardInput> = {},
    choice?: number
  ) {
    const original = CARD_CATALOG.get.bind(CARD_CATALOG)
    const definition = original('basic_fireball')!
    const mock = vi
      .spyOn(CARD_CATALOG, 'get')
      .mockImplementation((id) =>
        id === definition.id
          ? ({ ...definition, effects } as unknown as typeof definition)
          : original(id)
      )
    try {
      return immediateExpertTimeoutActions(
        definition.id,
        {
          type: 'play-card',
          participantId: 'test' as never,
          cardInstanceId: 'source',
          ...(choice === undefined ? {} : { choice })
        },
        input as PlayCardInput
      )
    } finally {
      mock.mockRestore()
    }
  }

  it.each(['grant-deathrattle', 'grant-trigger', 'schedule'])(
    'leaves %s nested damage/summon payloads opaque',
    (action) => {
      expect(
        collect([
          {
            trigger: 'cast',
            actions: [
              {
                action,
                actions: [
                  { action: 'summon', cardId: 'basic_chillwind_yeti' },
                  { action: 'damage', amount: 100 }
                ]
              }
            ]
          }
        ]).map((a) => a.action)
      ).toEqual([action])
    }
  )

  it('uses only the selected valid branch, including engine-certified combined choices', () => {
    const effects = [
      {
        trigger: 'cast',
        choice: {
          options: [
            { actions: [{ action: 'draw' }] },
            { actions: [{ action: 'summon' }] }
          ]
        }
      }
    ]
    expect(collect(effects, { legalChoices: [0, 1] }, 0).map((a) => a.action)).toEqual([
      'draw'
    ])
    expect(collect(effects, { legalChoices: [0, 1] }, 1).map((a) => a.action)).toEqual([
      'summon'
    ])
    expect(collect(effects, { legalChoices: [0, 1] }, -1)).toEqual([])
    expect(collect(effects, { legalChoices: [-1] }, -1).map((a) => a.action)).toEqual([
      'draw',
      'summon'
    ])
  })

  it('does not borrow readiness from a different conditioned effect or assume unknown conditions', () => {
    const effects = [0, 1].map((index) => ({
      trigger: 'battlecry',
      condition: { type: 'unsupported' },
      actions: [{ action: index ? 'draw' : 'summon' }]
    }))
    expect(collect(effects)).toEqual([])
    expect(
      collect(effects, {
        battlecryConditions: [{ effectIndex: 1, status: 'met', requirement: 'fixture' }]
      }).map((a) => a.action)
    ).toEqual(['draw'])
    expect(
      collect(effects, {
        battlecryConditions: [
          { effectIndex: 0, status: 'not-met', requirement: 'fixture' }
        ]
      })
    ).toEqual([])
  })

  it.each(['discover', 'unknown-runtime-instruction'])(
    'does not credit later actions/then after %s can pause or invalidate static knowledge',
    (action) => {
      expect(
        collect([
          {
            trigger: 'cast',
            actions: [{ action }, { action: 'summon' }],
            then: { actions: [{ action: 'damage', amount: 100 }] }
          }
        ]).map((a) => a.action)
      ).toEqual([action])
    }
  )

  it('does not infer post-action conditional branches from pre-play readiness', () => {
    const effects = [
      {
        trigger: 'cast',
        actions: [{ action: 'draw' }],
        then: { condition: { type: 'target-died' }, actions: [{ action: 'summon' }] }
      }
    ]
    expect(
      collect(effects, {
        battlecryConditions: [{ effectIndex: 0, status: 'met', requirement: 'fixture' }]
      }).map((a) => a.action)
    ).toEqual(['draw'])
  })

  it('recognizes only immediate damage-group members, without recursively flattening their payloads', () => {
    expect(
      collect([
        {
          trigger: 'cast',
          actions: [
            {
              action: 'damage-group',
              actions: [
                { action: 'damage', amount: 2 },
                { action: 'grant-trigger', actions: [{ action: 'summon' }] }
              ]
            }
          ]
        }
      ]).map((a) => a.action)
    ).toEqual(['damage'])
  })

  it('counts an immediate opponent summon as a liability rather than self development', () => {
    const session = createSession({
      seed: 0xfa111,
      aiHeroId: 'uther',
      opponentHeroId: 'thrall',
      aiMana: 5,
      aiHeroPowerAvailable: false,
      aiHand: ['classic_leeroy_jenkins', 'basic_senjin_shieldmasta'],
      aiDeck: ['basic_chillwind_yeti'],
      opponentDeck: ['basic_chillwind_yeti']
    })
    const action = selectExpertTimeoutFallbackAction(session, legalCommands(session))!
    expect(action.command.type).toBe('play-card')
    const command = action.command
    if (command.type === 'play-card')
      expect(
        session
          .getState()
          .players.find((p) => p.participantId === session.remoteParticipantId)
          ?.hand.find((c) => c.instanceId === command.cardInstanceId)?.cardId
      ).toBe('basic_senjin_shieldmasta')
  })

  it('does not borrow a chosen target for an unrelated dynamic selector', () => {
    const session = createSession({
      seed: 0xfa112,
      aiHeroId: 'uther',
      opponentHeroId: 'thrall',
      aiMana: 10,
      aiHeroPowerAvailable: false,
      aiHand: ['basic_blessing_of_kings'],
      aiBoard: [{ cardId: 'basic_chillwind_yeti' }]
    })
    const legal = legalCommands(session).filter(
      (c) => c.type === 'play-card' || c.type === 'end-turn'
    )
    const original = CARD_CATALOG.get.bind(CARD_CATALOG)
    const definition = original('basic_blessing_of_kings')!
    const mock = vi.spyOn(CARD_CATALOG, 'get').mockImplementation((id) =>
      id === definition.id
        ? ({
            ...definition,
            effects: [
              {
                trigger: 'cast',
                actions: [
                  {
                    action: 'modify',
                    target: {
                      controller: 'self',
                      type: 'minion',
                      selection: 'random'
                    },
                    attack: 4,
                    health: 4
                  }
                ]
              }
            ]
          } as unknown as typeof definition)
        : original(id)
    )
    try {
      expect(selectExpertTimeoutFallbackAction(session, legal)?.command.type).toBe(
        'end-turn'
      )
    } finally {
      mock.mockRestore()
    }
  })
})

describe('Fallback signed and fair public effects', () => {
  it('keeps a known friendly damage cost outside the draw maximum', () => {
    const session = createSession({
      seed: 0xfa113,
      aiHeroId: 'malfurion',
      opponentHeroId: 'jaina',
      aiMana: 2,
      aiHand: ['classic_wrath'],
      aiBoard: [{ cardId: 'basic_chillwind_yeti' }],
      aiDeck: ['basic_chillwind_yeti']
    })
    const scope = legalCommands(session).filter(
      (c) => c.type === 'end-turn' || (c.type === 'play-card' && c.choice === 1)
    )
    expect(selectExpertTimeoutFallbackAction(session, scope)?.command.type).toBe(
      'end-turn'
    )
  })

  it.each([false, true])(
    'credits a keyword only when it is newly granted (existing=%s)',
    (divineShield) => {
      const session = createSession({
        seed: 0xfa114,
        aiHeroId: 'uther',
        opponentHeroId: 'jaina',
        aiMana: 1,
        aiHand: ['basic_hand_of_protection'],
        aiBoard: [
          {
            cardId: 'basic_chillwind_yeti',
            divineShield,
            keywords: divineShield ? ['divine-shield'] : []
          }
        ]
      })
      const scope = legalCommands(session).filter(
        (c) => c.type === 'end-turn' || c.type === 'play-card'
      )
      expect(selectExpertTimeoutFallbackAction(session, scope)?.command.type).toBe(
        divineShield ? 'end-turn' : 'play-card'
      )
    }
  )

  it('does not use hidden opponent hand or deck ordering and starts no worker', async () => {
    const { default: raw } = await import('./fixtures/timeout-fallback-paladin.json')
    const checkpoint =
      raw as unknown as import('../../../game-rules/match').OpeningMatchCheckpoint
    const permuted = {
      ...checkpoint,
      state: {
        ...checkpoint.state,
        players: checkpoint.state.players.map((p) =>
          p.participantId === 'candidate'
            ? { ...p, hand: [...p.hand].reverse(), deck: [...p.deck].reverse() }
            : p
        ) as unknown as typeof checkpoint.state.players
      }
    }
    const worker = vi.fn(() => {
      throw new Error('Fallback must not start a worker')
    })
    vi.stubGlobal('Worker', worker)
    try {
      const decisions = [checkpoint, permuted].map((cp) => {
        const session = new GameBoardSession({
          setup: cp.setup,
          decks: cp.decks,
          checkpoint: cp
        })
        const before = JSON.stringify(session.match.getCheckpoint())
        const action = selectExpertTimeoutFallbackAction(
          session,
          legalCommands(session)
        )
        expect(JSON.stringify(session.match.getCheckpoint())).toBe(before)
        return action?.command
      })
      expect(decisions[0]).toEqual(decisions[1])
      expect(worker).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('Expert timeout plain-combat rescue', () => {
  const fixture = {
    seed: 20801,
    aiHeroId: 'jaina',
    opponentHeroId: 'garrosh',
    aiHealth: 3,
    opponentHealth: 30,
    aiMana: 0,
    aiMaximumMana: 4,
    aiHand: [],
    aiBoard: [
      { cardId: 'basic_bloodfen_raptor', ready: true },
      { cardId: 'basic_bloodfen_raptor', ready: true }
    ],
    opponentBoard: [{ cardId: 'basic_senjin_shieldmasta' }],
    aiDeck: ['basic_acidic_swamp_ooze', 'basic_acidic_swamp_ooze'],
    opponentDeck: ['basic_acidic_swamp_ooze', 'basic_acidic_swamp_ooze'],
    turnNumber: 8
  }
  const inspect = (session: GameBoardSession) =>
    findExpertTimeoutCombatRescue(
      session.match.getCheckpoint(),
      session.getAiObservation(),
      legalCommands(session)
    )
  const select = (session: GameBoardSession) =>
    selectExpertTimeoutFallbackAction(session, legalCommands(session))!.command

  it('rescues a lethal pass with both accepted Raptor trades, without live mutation', () => {
    const session = createSession(fixture)
    const checkpoint = session.match.getCheckpoint()
    expect(
      session
        .getAiObservation()
        .players.find((player) => player.role === 'self')!
        .board.map((minion) => [minion.attack, minion.health])
    ).toEqual([
      [3, 2],
      [3, 2]
    ])
    expect(
      session
        .getAiObservation()
        .players.find((player) => player.role === 'opponent')!
        .board.map((minion) => [minion.attack, minion.health])
    ).toEqual([[3, 5]])
    const proof = inspect(session)
    expect(proof.status).toBe('rescued')
    expect(proof.simulations).toBe(5)
    expect(session.match.getCheckpoint()).toEqual(checkpoint)
    for (let index = 0; index < 2; index++) {
      const command = select(session)
      expect(command).toMatchObject({
        type: 'attack-character',
        attacker: { kind: 'minion' },
        defender: { kind: 'minion' }
      })
      expect(session.match.dispatch(command).accepted).toBe(true)
    }
    expect(
      session.getState().players.every((player) => player.board.length === 0)
    ).toBe(true)
    expect(select(session).type).toBe('end-turn')
    expect(session.match.dispatch(select(session)).accepted).toBe(true)
    expect(session.getState().phase).toBe('turns')
    expect(
      session
        .getState()
        .players.find((p) => p.participantId === session.remoteParticipantId)!.hero
        .health
    ).toBe(3)
  })

  it.each([
    ['classic_lord_of_the_arena', 6, 3],
    ['classic_fen_creeper', 3, 3],
    ['basic_ironfur_grizzly', 3, 2]
  ] as const)(
    'generalizes the two-hit rescue to %s without card-specific scoring',
    (cardId, aiHealth, attack) => {
      const session = createSession({
        ...fixture,
        aiHealth,
        aiBoard: fixture.aiBoard.map((minion) => ({ ...minion, attack })),
        opponentBoard: [{ cardId }]
      })
      for (let index = 0; index < 2; index++) {
        const command = select(session)
        expect(command).toMatchObject({
          type: 'attack-character',
          defender: { kind: 'minion' }
        })
        expect(session.match.dispatch(command).accepted).toBe(true)
      }
      expect(
        session
          .getState()
          .players.find(
            (player) => player.participantId === session.localParticipantId
          )!.board
      ).toHaveLength(0)
    }
  )

  it('keeps a safe-health pass instead of retuning every losing trade', () => {
    const session = createSession({ ...fixture, aiHealth: 4 })
    expect(inspect(session).status).toBe('not-found')
    expect(select(session).type).toBe('end-turn')
  })

  it('does not start an insufficient two-hit line', () => {
    const session = createSession({
      ...fixture,
      opponentBoard: [{ cardId: 'basic_senjin_shieldmasta', health: 7, maxHealth: 7 }]
    })
    expect(inspect(session)).toMatchObject({ status: 'not-found', simulations: 6 })
    expect(select(session).type).toBe('end-turn')
  })

  it.each([
    ['exhausted', { ready: false }],
    ['frozen', { ready: true, frozen: true }]
  ] as const)(
    'requires both legal attacks when one Raptor is %s',
    (_name, readiness) => {
      const session = createSession({
        ...fixture,
        aiBoard: [
          fixture.aiBoard[0]!,
          { cardId: 'basic_bloodfen_raptor', ...readiness }
        ]
      })
      expect(inspect(session).status).toBe('not-found')
      expect(select(session).type).toBe('end-turn')
    }
  )

  it('does not claim two ordinary hits remove Divine Shield plus five health', () => {
    const session = createSession({
      ...fixture,
      opponentBoard: [
        {
          cardId: 'basic_senjin_shieldmasta',
          keywords: ['taunt', 'divine-shield'],
          divineShield: true
        }
      ]
    })
    expect(inspect(session).status).toBe('not-found')
    // The existing scorer can still choose a positive shield pop; rescue does not override it.
    expect(select(session).type).toBe('attack-character')
  })

  it('does not invent a threat from an opponent frozen through its next turn', () => {
    const session = createSession({
      ...fixture,
      opponentBoard: [{ cardId: 'basic_senjin_shieldmasta', frozenUntilTurn: 9 }]
    })
    expect(inspect(session).status).toBe('not-found')
    expect(select(session).type).toBe('end-turn')
  })

  it('does not invent a face attack through a friendly Taunt', () => {
    const session = createSession({
      ...fixture,
      aiBoard: fixture.aiBoard.map((minion) => ({
        ...minion,
        keywords: ['taunt'] as const
      }))
    })
    expect(inspect(session).status).toBe('not-found')
    expect(select(session).type).toBe('end-turn')
  })

  it('preserves useful Fireball removal rather than sacrificing both friendly minions', () => {
    const session = createSession({ ...fixture, aiMana: 4, aiHand: ['basic_fireball'] })
    const command = select(session)
    expect(command).toMatchObject({ type: 'play-card', targets: [{ kind: 'minion' }] })
    expect(session.match.dispatch(command).accepted).toBe(true)
    expect(
      session
        .getState()
        .players.find((p) => p.participantId === session.remoteParticipantId)!.board
    ).toHaveLength(2)
    expect(
      session
        .getState()
        .players.find((p) => p.participantId === session.localParticipantId)!.board
    ).toHaveLength(0)
  })

  it('preserves a verified own immediate win before defensive rescue', () => {
    const session = createSession({
      ...fixture,
      aiMana: 4,
      aiHand: ['basic_fireball'],
      opponentHealth: 6
    })
    const command = select(session)
    expect(command).toMatchObject({
      type: 'play-card',
      targets: [{ kind: 'hero', participantId: session.localParticipantId }]
    })
    expect(session.match.dispatch(command).accepted).toBe(true)
    expect(session.getState().winnerId).toBe(session.remoteParticipantId)
  })

  it.each([
    [
      'multiple public attackers',
      { opponentBoard: [...fixture.opponentBoard, { cardId: 'basic_bloodfen_raptor' }] }
    ],
    [
      'Windfury',
      {
        opponentBoard: [
          { cardId: 'basic_senjin_shieldmasta', keywords: ['taunt', 'windfury'] }
        ]
      }
    ],
    ['opposing hero attack', { opponentAttack: 1 }],
    ['weapon', { opponentWeapon: { cardId: 'basic_fiery_war_axe' } }],
    [
      'hidden Secret',
      { opponentHeroId: 'jaina', opponentSecrets: [{ cardId: 'classic_ice_barrier' }] }
    ],
    [
      'boundary trigger',
      { aiBoard: [...fixture.aiBoard, { cardId: 'basic_healing_totem' }] }
    ],
    [
      'Deathrattle',
      { aiBoard: [...fixture.aiBoard, { cardId: 'classic_leper_gnome' }] }
    ]
  ] satisfies readonly [string, Partial<Parameters<typeof createAiFixture>[0]>][])(
    'returns unknown for unsupported %s',
    (_name, changes) => {
      const session = createSession({ ...fixture, ...changes })
      expect(inspect(session)).toEqual({ status: 'unknown', simulations: 0 })
    }
  )

  it('does not use hidden opponent identities or either deck order to choose a rescue', () => {
    const first = createSession({
      ...fixture,
      opponentHand: ['basic_execute'],
      aiDeck: ['basic_fireball', 'basic_acidic_swamp_ooze']
    })
    const second = createSession({
      ...fixture,
      opponentHand: ['basic_arcanite_reaper'],
      opponentDeck: ['basic_execute', 'basic_arcanite_reaper'],
      aiDeck: ['basic_acidic_swamp_ooze', 'basic_fireball']
    })
    expect(inspect(first)).toEqual(inspect(second))
    expect(select(first)).toEqual(select(second))
  })

  it('returns unknown exactly at its deterministic work cap without dispatching live', () => {
    const session = createSession({
      ...fixture,
      aiBoard: Array.from({ length: 7 }, () => ({
        cardId: 'basic_bloodfen_raptor',
        ready: true
      })),
      opponentBoard: [
        { cardId: 'basic_senjin_shieldmasta', health: 100, maxHealth: 100 }
      ]
    })
    const before = session.match.getCheckpoint()
    const expected = {
      status: 'unknown',
      simulations: EXPERT_TIMEOUT_COMBAT_RESCUE_MAX_DISPATCHES
    }
    expect(inspect(session)).toEqual(expected)
    expect(inspect(session)).toEqual(expected)
    expect(select(session).type).toBe('end-turn')
    expect(session.match.getCheckpoint()).toEqual(before)
  })

  it('recomputes and completes both trades through the actual zero-allowance controller', async () => {
    const session = createSession(fixture)
    const before = session.match.getCheckpoint()
    const workerFactory = vi.fn(() => {
      throw new Error('No worker should start after exhaustion')
    })
    const api = new ExpertAiDecisionApi(
      session,
      workerFactory,
      () => performance.now(),
      session.remoteParticipantId,
      1,
      { ...EXPERT_AI_DEFAULT_BUDGET, searchBudgetMs: 0 }
    )
    const controller = new AiTurnController({
      session,
      api,
      online: () => true,
      logger: { info() {}, warn() {}, error() {} }
    })
    const commands: TurnMatchCommand[] = []
    try {
      for (const type of ['attack-character', 'attack-character', 'end-turn']) {
        const decision = await controller.chooseTurnAction()
        expect(decision).not.toBeNull()
        expect(controller.isCurrent(decision!)).toBe(true)
        expect(decision!.command.type).toBe(type)
        expect(legalCommands(session)).toContainEqual(decision!.command)
        if (commands.length === 0) expect(decision!.source).toBe('safe-fallback')
        const result = session.match.dispatch(decision!.command)
        expect(result.accepted).toBe(true)
        commands.push(decision!.command)
        controller.recordExecution(decision!, result)
      }
      expect(session.getState().phase).toBe('turns')
      expect(session.getState().activePlayerId).toBe(session.localParticipantId)
      expect(
        session.getState().players.every((player) => player.board.length === 0)
      ).toBe(true)
      const replay = new GameBoardSession({
        setup: before.setup,
        decks: before.decks,
        checkpoint: before
      })
      for (const command of commands)
        expect(replay.match.dispatch(command).accepted).toBe(true)
      expect(replay.match.getCheckpoint()).toEqual(session.match.getCheckpoint())
    } finally {
      controller.dispose()
      api.dispose()
    }
    expect(workerFactory).not.toHaveBeenCalled()
  })

  it('holds no-payoff Holy Light while keeping the useful recruit selected', () => {
    const session = createSession({
      ...fixture,
      aiHeroId: 'uther',
      aiHealth: 30,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['basic_holy_light'],
      aiBoard: [],
      opponentBoard: []
    })
    const command = select(session)
    expect(command.type).toBe('use-hero-power')
    expect(session.match.dispatch(command).accepted).toBe(true)
    expect(
      session
        .getState()
        .players.find((p) => p.participantId === session.remoteParticipantId)!
        .hand.map((card) => card.cardId)
    ).toEqual(['basic_holy_light'])
  })

  it('does not treat an opponent fatigue death after passing as a combat threat', () => {
    const session = createSession({
      ...fixture,
      opponentDeck: [],
      opponentHealth: 1,
      opponentFatigueDamage: 1
    })
    expect(inspect(session)).toMatchObject({ status: 'unknown', simulations: 1 })
  })

  it('rejects oversized supplied attack candidates rather than truncating', () => {
    const session = createSession(fixture)
    const attack = legalCommands(session).find(
      (command) => command.type === 'attack-character'
    )!
    expect(
      findExpertTimeoutCombatRescue(
        session.match.getCheckpoint(),
        session.getAiObservation(),
        Array.from({ length: 9 }, () => attack)
      )
    ).toEqual({ status: 'unknown', simulations: 0 })
  })
})

describe('opponent Health payment timeout fallback', () => {
  it('finds a zero-mana lethal payment through Armor without a damage effect', () => {
    const fixture = createAiFixture({
      seed: 0xa6a7,
      aiHeroId: 'guldan',
      opponentHeroId: 'jaina',
      aiHand: ['basic_boulderfist_ogre'],
      aiMana: 0,
      aiMaximumMana: 10,
      opponentHealth: 6,
      opponentArmor: 100,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze']
    })
    const checkpoint = {
      ...fixture.checkpoint,
      state: {
        ...fixture.checkpoint.state,
        players: fixture.checkpoint.state.players.map((player) =>
          player.participantId === fixture.aiParticipantId
            ? { ...player, nextCardCostsOpponentHealth: true }
            : player
        ) as unknown as typeof fixture.checkpoint.state.players
      }
    }
    const session = new GameBoardSession({ ...fixture, checkpoint })
    const action = selectExpertTimeoutFallbackAction(session, legalCommands(session))
    expect(action?.command.type).toBe('play-card')
    const result = session.match.dispatch(action!.command)
    expect(result.accepted).toBe(true)
    expect(result.state.phase).toBe('ended')
    expect(result.state.winnerId).toBe(session.remoteParticipantId)
  })
})
