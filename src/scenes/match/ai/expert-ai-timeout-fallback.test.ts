import { describe, expect, it, vi } from 'vitest'
import { CARD_CATALOG } from '../../../game-rules/content/cards'
import type { PlayCardInput } from '../../../game-rules/match/opening-match-types'
import { createAiFixture } from '../../../game-rules/match/testing/ai-scenario-builder'
import { enumerateLegalCommands } from '../../../game-rules/match'
import { GameBoardSession } from '../game-board-session'
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
