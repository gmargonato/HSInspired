import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, type CardDefinition, type CardId } from '../../content/cards'
import { createMatchScenario } from '../testing/match-scenario-builder'
import { getDerivedState, getMatchLegality, resolveCardPlay } from './effect-runtime'

describe('shared effect runtime', () => {
  const player = (
    scenario: ReturnType<typeof createMatchScenario>,
    participantId: string
  ) =>
    scenario.match
      .getState()
      .players.find((candidate) => candidate.participantId === participantId)!

  const activeParticipants = (scenario: ReturnType<typeof createMatchScenario>) => {
    const active = scenario.match.getState().activePlayerId!
    return [
      active,
      scenario.participants.find((participantId) => participantId !== active)!
    ] as const
  }

  it("draws each of Ysera's five Dream cards, including Nightmare", () => {
    const dreamIds = new Set([
      'classic_dream',
      'classic_emerald_drake',
      'classic_laughing_sister',
      'classic_nightmare',
      'classic_ysera_awakens'
    ])
    const drawnDreamIds = new Set<string>()

    for (let seed = 1; seed <= 128 && drawnDreamIds.size < dreamIds.size; seed += 1) {
      const scenario = createMatchScenario({ seed, cardId: 'classic_ysera' })
      scenario.confirmBothMulligans()
      const participantId = scenario.match.getState().activePlayerId!
      expect(
        scenario.match.dispatch({
          type: 'dev-clear-zone',
          participantId,
          zone: 'hand'
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId,
          cardId: 'classic_ysera'
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      const ysera = player(scenario, participantId).hand[0]!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId,
          cardInstanceId: ysera.instanceId,
          position: 0
        }).accepted
      ).toBe(true)
      const endTurn = scenario.match.dispatch({ type: 'end-turn', participantId })
      expect(endTurn.accepted).toBe(true)
      if (!endTurn.accepted) return
      expect(endTurn.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'card-generated',
            participantId,
            origin: { kind: 'minion', instanceId: ysera.instanceId }
          })
        ])
      )

      const dream = player(scenario, participantId).hand.find((card) =>
        dreamIds.has(card.cardId)
      )
      expect(dream).toBeDefined()
      if (dream) drawnDreamIds.add(dream.cardId)
    }

    expect(drawnDreamIds).toEqual(dreamIds)
  })

  it("summons Pip Quickwit when The Beast's Deathrattle resolves", () => {
    const scenario = createMatchScenario({ seed: 129, cardId: 'classic_the_beast' })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_the_beast'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'basic_shadow_word_death'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)

    const beast = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_the_beast'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: beast.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    const beastOnBoard = player(scenario, participantId).board[0]!
    const deathSpell = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'basic_shadow_word_death'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: deathSpell.instanceId,
        targets: [
          {
            kind: 'minion',
            participantId,
            instanceId: beastOnBoard.instanceId
          }
        ]
      }).accepted
    ).toBe(true)

    expect(player(scenario, opponentId).board).toContainEqual(
      expect.objectContaining({
        cardId: 'classic_pip_quickwit',
        attack: 3,
        health: 3,
        maxHealth: 3
      })
    )
  })

  it('resolves a real targeted spell through the canonical play-card command', () => {
    const scenario = createMatchScenario({ seed: 41, cardId: 'basic_arcane_shot' })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    const opponentId = scenario.participants.find(
      (participantId) => participantId !== playerId
    )!
    const before = scenario.match.getState()
    const mana = scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId: playerId,
      available: 10,
      maximum: 10
    })
    expect(mana.accepted).toBe(true)
    const card = scenario.match
      .getState()
      .players.find((player) => player.participantId === playerId)!.hand[0]
    expect(card).toBeDefined()
    const input = scenario.match.getPlayInput?.(playerId, card!.instanceId)
    expect(input?.targetSelectors).toHaveLength(1)
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: playerId,
      cardInstanceId: card!.instanceId,
      targets: [{ kind: 'hero', participantId: opponentId }]
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const resultPlayer = result.state.players.find(
      (player) => player.participantId === playerId
    )!
    const resultOpponent = result.state.players.find(
      (player) => player.participantId === opponentId
    )!
    const beforeOpponent = before.players.find(
      (player) => player.participantId === opponentId
    )!
    expect(resultPlayer.mana.available).toBe(9)
    expect(resultOpponent.hero.health).toBe(beforeOpponent.hero.health - 2)
    expect(
      resultPlayer.hand.some((entry) => entry.instanceId === card!.instanceId)
    ).toBe(false)
    expect(result.events.some((event) => event.type === 'effect-resolved')).toBe(true)
  })

  it('allows unsided damage to target a friendly character', () => {
    const scenario = createMatchScenario({ seed: 411, cardId: 'basic_arcane_shot' })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)

    const beforeHealth = player(scenario, playerId).hero.health
    const card = player(scenario, playerId).hand[0]!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: playerId,
      cardInstanceId: card.instanceId,
      targets: [{ kind: 'hero', participantId: playerId }]
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, playerId).hero.health).toBe(beforeHealth - 2)
  })

  it('allows an unsided restore to target an enemy character', () => {
    const scenario = createMatchScenario({
      seed: 412,
      cardId: 'goblins_vs_gnomes_light_of_the_naaru'
    })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    const opponentId = scenario.participants.find(
      (participantId) => participantId !== playerId
    )!
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)

    const card = player(scenario, playerId).hand[0]!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: playerId,
      cardInstanceId: card.instanceId,
      targets: [{ kind: 'hero', participantId: opponentId }]
    })

    expect(result.accepted).toBe(true)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'effect-resolved',
        action: 'restore',
        data: expect.objectContaining({
          amount: 0,
          target: `${opponentId}:hero`
        })
      })
    )
  })

  it('projects a conditional spell preview from the current board state', () => {
    const scenario = createMatchScenario({
      seed: 42,
      cardId: 'classic_kill_command'
    })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    const killCommand = player(scenario, playerId).hand[0]!

    expect(
      scenario.match.getPlayInput?.(playerId, killCommand.instanceId)?.effectPreview
    ).toEqual({
      conditionallyEnhanced: false
    })
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'naxxramas_haunted_creeper'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.getPlayInput?.(playerId, killCommand.instanceId)?.effectPreview
    ).toEqual({
      conditionallyEnhanced: true
    })
  })

  it('moves Alarm-o-Bot and its hand minion as identity-preserving instances', () => {
    const scenario = createMatchScenario({ seed: 117, cardId: 'classic_alarm_o_bot' })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    const opponentId = scenario.participants.find(
      (participantId) => participantId !== playerId
    )!
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId: playerId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: playerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const handWisp = player(scenario, playerId).hand[0]!
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'classic_alarm_o_bot'
      }).accepted
    ).toBe(true)
    const alarm = player(scenario, playerId).board[0]!
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: playerId }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)

    const after = player(scenario, playerId)
    expect(after.board).toHaveLength(1)
    expect(after.board[0]?.instanceId).toBe(handWisp.instanceId)
    expect(after.board[0]?.cardId).toBe('basic_acidic_swamp_ooze')
    expect(after.hand.some((card) => card.instanceId === alarm.instanceId)).toBe(true)
    expect(
      after.hand.find((card) => card.instanceId === alarm.instanceId)?.cardId
    ).toBe('classic_alarm_o_bot')
  })

  it('returns an enemy minion to its owner hand with the same identity', () => {
    const scenario = createMatchScenario({ seed: 118, cardId: 'basic_sap' })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    for (const participantId of [playerId, opponentId])
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, opponentId).board[0]!
    const sap = player(scenario, playerId).hand[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: sap.instanceId,
        targets: [
          { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).board).toHaveLength(0)
    expect(player(scenario, opponentId).hand).toContainEqual(
      expect.objectContaining({
        instanceId: target.instanceId,
        cardId: 'basic_acidic_swamp_ooze',
        currentCost: 2
      })
    )
  })

  it('transforms and permanently steals real minions without changing their instance IDs', () => {
    const transform = createMatchScenario({ seed: 119, cardId: 'basic_polymorph' })
    transform.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(transform)
    expect(
      transform.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      transform.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(transform, opponentId).board[0]!
    expect(
      transform.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: player(transform, playerId).hand[0]!.instanceId,
        targets: [
          { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(player(transform, opponentId).board[0]).toMatchObject({
      instanceId: target.instanceId,
      cardId: 'basic_sheep',
      attack: 1,
      health: 1,
      enchantments: []
    })

    const control = createMatchScenario({ seed: 120, cardId: 'basic_mind_control' })
    control.confirmBothMulligans()
    const [controllerId, originalControllerId] = activeParticipants(control)
    expect(
      control.match.dispatch({
        type: 'dev-set-mana',
        participantId: controllerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      control.match.dispatch({
        type: 'dev-summon-minion',
        participantId: originalControllerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const stolen = player(control, originalControllerId).board[0]!
    expect(
      control.match.dispatch({
        type: 'play-card',
        participantId: controllerId,
        cardInstanceId: player(control, controllerId).hand[0]!.instanceId,
        targets: [
          {
            kind: 'minion',
            participantId: originalControllerId,
            instanceId: stolen.instanceId
          }
        ]
      }).accepted
    ).toBe(true)
    expect(player(control, originalControllerId).board).toHaveLength(0)
    expect(player(control, controllerId).board[0]).toMatchObject({
      instanceId: stolen.instanceId,
      ownerId: originalControllerId,
      controllerId
    })
  })

  it('returns Shadow Madness control to the original controller at end of turn', () => {
    const scenario = createMatchScenario({
      seed: 121,
      cardId: 'classic_shadow_madness'
    })
    scenario.confirmBothMulligans()
    const [controllerId, ownerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: controllerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: ownerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, ownerId).board[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: controllerId,
        cardInstanceId: player(scenario, controllerId).hand[0]!.instanceId,
        targets: [
          { kind: 'minion', participantId: ownerId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(player(scenario, controllerId).board[0]?.instanceId).toBe(target.instanceId)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: controllerId })
        .accepted
    ).toBe(true)
    expect(player(scenario, ownerId).board[0]).toMatchObject({
      instanceId: target.instanceId,
      controllerId: ownerId,
      ownerId
    })
  })

  it('resurrects Reincarnate targets as fresh, full-health board instances', () => {
    const scenario = createMatchScenario({ seed: 122, cardId: 'naxxramas_reincarnate' })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, opponentId).board[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: player(scenario, playerId).hand[0]!.instanceId,
        targets: [
          { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    const resurrected = player(scenario, opponentId).board[0]!
    expect(resurrected).toMatchObject({
      cardId: 'basic_acidic_swamp_ooze',
      attack: 3,
      health: 2,
      maxHealth: 2,
      enchantments: []
    })
    expect(resurrected.instanceId).not.toBe(target.instanceId)
    expect(player(scenario, opponentId).graveyard ?? []).toHaveLength(0)
  })

  it('keeps a minion with its controller when Mind Control has no board slot', () => {
    const scenario = createMatchScenario({ seed: 123, cardId: 'basic_mind_control' })
    scenario.confirmBothMulligans()
    const [controllerId, ownerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: controllerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    for (let index = 0; index < 7; index += 1)
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: controllerId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: ownerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, ownerId).board[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: controllerId,
        cardInstanceId: player(scenario, controllerId).hand[0]!.instanceId,
        targets: [
          { kind: 'minion', participantId: ownerId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(player(scenario, controllerId).board).toHaveLength(7)
    expect(player(scenario, ownerId).board[0]).toMatchObject({
      instanceId: target.instanceId,
      controllerId: ownerId
    })
  })

  it('burns a bounced minion when its owner hand is full', () => {
    const scenario = createMatchScenario({ seed: 124, cardId: 'basic_sap' })
    scenario.confirmBothMulligans()
    const [playerId, ownerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId: ownerId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    for (let index = 0; index < 10; index += 1)
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId: ownerId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: ownerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, ownerId).board[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: player(scenario, playerId).hand[0]!.instanceId,
        targets: [
          { kind: 'minion', participantId: ownerId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(player(scenario, ownerId).board).toHaveLength(0)
    expect(player(scenario, ownerId).hand).toHaveLength(10)
    expect(player(scenario, ownerId).discardedCards).toContainEqual(
      expect.objectContaining({ instanceId: target.instanceId, cardId: target.cardId })
    )
  })

  it('replays a seeded command with identical state, events, trace, ids, and RNG path', () => {
    const first = createMatchScenario({ seed: 91, cardId: 'basic_fireball' })
    const second = createMatchScenario({ seed: 91, cardId: 'basic_fireball' })
    first.confirmBothMulligans()
    second.confirmBothMulligans()
    const firstPlayerId = first.match.getState().activePlayerId!
    const secondPlayerId = second.match.getState().activePlayerId!
    expect(secondPlayerId).toBe(firstPlayerId)
    const firstOpponentId = first.participants.find(
      (participantId) => participantId !== firstPlayerId
    )!
    const secondOpponentId = second.participants.find(
      (participantId) => participantId !== secondPlayerId
    )!
    for (const scenario of [first, second])
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId: scenario.match.getState().activePlayerId!,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
    const firstCard = first.match
      .getState()
      .players.find((player) => player.participantId === firstPlayerId)!.hand[0]!
    const secondCard = second.match
      .getState()
      .players.find((player) => player.participantId === secondPlayerId)!.hand[0]!
    const firstResult = first.match.dispatch({
      type: 'play-card',
      participantId: firstPlayerId,
      cardInstanceId: firstCard.instanceId,
      targets: [{ kind: 'hero', participantId: firstOpponentId }]
    })
    const secondResult = second.match.dispatch({
      type: 'play-card',
      participantId: secondPlayerId,
      cardInstanceId: secondCard.instanceId,
      targets: [{ kind: 'hero', participantId: secondOpponentId }]
    })
    expect(firstResult).toEqual(secondResult)
    expect(first.match.getState()).toEqual(second.match.getState())
    expect(first.match.getEffectTrace?.()).toEqual(second.match.getEffectTrace?.())
    expect(
      firstResult.accepted &&
        firstResult.events
          .filter((event) => event.type === 'effect-resolved')
          .every((event) => event.correlation?.resolutionId)
    ).toBe(true)
    expect(
      first.match
        .getState()
        .players.flatMap((player) => [
          ...player.hand.map((card) => card.instanceId),
          ...player.deck.map((card) => card.instanceId),
          ...player.board.map((minion) => minion.instanceId)
        ])
    ).toEqual(
      second.match
        .getState()
        .players.flatMap((player) => [
          ...player.hand.map((card) => card.instanceId),
          ...player.deck.map((card) => card.instanceId),
          ...player.board.map((minion) => minion.instanceId)
        ])
    )
  })
  it('replays random effects with identical RNG consumption', () => {
    const first = createMatchScenario({ seed: 93, cardId: 'basic_arcane_missiles' })
    const second = createMatchScenario({ seed: 93, cardId: 'basic_arcane_missiles' })
    first.confirmBothMulligans()
    second.confirmBothMulligans()
    const firstPlayerId = first.match.getState().activePlayerId!
    const secondPlayerId = second.match.getState().activePlayerId!
    const firstState = first.match.getState()
    const secondState = second.match.getState()
    const firstCard = firstState.players
      .find((player) => player.participantId === firstPlayerId)!
      .hand.find((card) => card.cardId === 'basic_arcane_missiles')!
    const secondCard = secondState.players
      .find((player) => player.participantId === secondPlayerId)!
      .hand.find((card) => card.cardId === 'basic_arcane_missiles')!
    const makeRng = () => {
      let calls = 0
      return {
        rng: {
          next(): number {
            calls += 1
            return 0.25
          },
          snapshot(): number {
            return calls
          },
          restore(snapshot: unknown): void {
            calls = typeof snapshot === 'number' ? snapshot : calls
          }
        },
        get calls(): number {
          return calls
        }
      }
    }
    const firstRng = makeRng()
    const secondRng = makeRng()
    const firstResult = resolveCardPlay({
      state: firstState,
      rng: firstRng.rng,
      participantId: firstPlayerId,
      cardInstanceId: firstCard.instanceId,
      nextEntityOrdinal: firstState.nextEntityOrdinal
    })
    const secondResult = resolveCardPlay({
      state: secondState,
      rng: secondRng.rng,
      participantId: secondPlayerId,
      cardInstanceId: secondCard.instanceId,
      nextEntityOrdinal: secondState.nextEntityOrdinal
    })
    expect(firstResult).toEqual(secondResult)
    expect(firstRng.calls).toBeGreaterThan(0)
    expect(firstRng.calls).toBe(secondRng.calls)
  })
  it('rolls a resolver failure back across state, counters, events, trace, and RNG', () => {
    const scenario = createMatchScenario({ seed: 92, cardId: 'basic_arcane_missiles' })
    scenario.confirmBothMulligans()
    const state = scenario.match.getState()
    const participantId = state.activePlayerId!
    const card = state.players.find((player) => player.participantId === participantId)!
      .hand[0]!
    let restored: unknown
    const rng = {
      next(): number {
        throw new Error('deterministic test failure')
      },
      snapshot(): number {
        return 17
      },
      restore(snapshot: unknown): void {
        restored = snapshot
      }
    }
    const result = resolveCardPlay({
      state,
      rng,
      participantId,
      cardInstanceId: card.instanceId,
      nextEntityOrdinal: state.nextEntityOrdinal
    })
    expect(result.accepted).toBe(false)
    if (result.accepted) return
    expect(result.code).toBe('resolution-failed')
    expect(result.state).toEqual(state)
    expect(result.events).toEqual([])
    expect(result.trace).toEqual([])
    expect(result.triggerEvents).toEqual([])
    expect(result.nextEntityOrdinal).toBe(state.nextEntityOrdinal)
    expect(restored).toBe(17)
    expect(result.diagnostic.recentQueue.length).toBeGreaterThan(0)
  })

  it('preserves while-damaged enchantments while inactive and reapplies them after damage', () => {
    const scenario = createMatchScenario({ seed: 94, cardId: 'basic_arcane_shot' })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)

    const fullHealthState = scenario.match.getState()
    const playerIndex = fullHealthState.players.findIndex(
      (player) => player.participantId === participantId
    )
    const minion = fullHealthState.players[playerIndex]!.board[0]!
    const inactiveState = {
      ...fullHealthState,
      players: fullHealthState.players.map((player, index) =>
        index !== playerIndex
          ? player
          : {
              ...player,
              board: player.board.map((entry) =>
                entry.instanceId !== minion.instanceId
                  ? entry
                  : {
                      ...entry,
                      enchantments: [
                        {
                          id: 'while-damaged-test',
                          sourceInstanceId: entry.instanceId,
                          sourceCardId: null,
                          attackDelta: 2,
                          duration: 'while-damaged'
                        }
                      ]
                    }
              )
            }
      )
    } as unknown as typeof fullHealthState
    const firstCard = inactiveState.players[playerIndex]!.hand[0]!
    const inactiveResult = resolveCardPlay({
      state: inactiveState,
      rng: scenario.rng,
      participantId,
      cardInstanceId: firstCard.instanceId,
      targets: [{ kind: 'hero', participantId: opponentId }],
      nextEntityOrdinal: inactiveState.nextEntityOrdinal
    })
    expect(inactiveResult.accepted).toBe(true)
    if (!inactiveResult.accepted) return
    const inactiveMinion = inactiveResult.state.players[playerIndex]!.board[0]!
    expect(inactiveMinion.attack).toBe(3)
    expect(inactiveMinion.enchantments).toHaveLength(1)

    const damagedState = {
      ...inactiveResult.state,
      players: inactiveResult.state.players.map((player, index) =>
        index !== playerIndex
          ? player
          : {
              ...player,
              board: player.board.map((entry) =>
                entry.instanceId !== minion.instanceId
                  ? entry
                  : { ...entry, health: entry.maxHealth - 1 }
              )
            }
      )
    } as unknown as typeof inactiveResult.state
    const secondCard = damagedState.players[playerIndex]!.hand[0]!
    const damagedResult = resolveCardPlay({
      state: damagedState,
      rng: scenario.rng,
      participantId,
      cardInstanceId: secondCard.instanceId,
      targets: [{ kind: 'hero', participantId: opponentId }],
      nextEntityOrdinal: damagedState.nextEntityOrdinal
    })
    expect(damagedResult.accepted).toBe(true)
    if (!damagedResult.accepted) return
    expect(damagedResult.state.players[playerIndex]!.board[0]).toMatchObject({
      attack: 5,
      health: 1,
      maxHealth: 2
    })
  })
  it('keeps delayed keywords out of combat legality until their start turn', () => {
    const scenario = createMatchScenario({ seed: 98 })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const state = scenario.match.getState()
    const playerIndex = state.players.findIndex(
      (player) => player.participantId === participantId
    )
    const minion = state.players[playerIndex]!.board[0]!
    const delayedState = {
      ...state,
      players: state.players.map((player, index) =>
        index !== playerIndex
          ? player
          : {
              ...player,
              board: player.board.map((entry) =>
                entry.instanceId !== minion.instanceId
                  ? entry
                  : {
                      ...entry,
                      summonedOnTurn: state.turnNumber - 1,
                      enchantments: [
                        {
                          id: 'next-turn-cannot-attack',
                          sourceInstanceId: entry.instanceId,
                          sourceCardId: null,
                          keywords: ['cannot-attack'],
                          duration: 'next-turn',
                          startsOnTurn: state.turnNumber + 1,
                          expiresOnTurn: state.turnNumber + 1
                        }
                      ]
                    }
              )
            }
      )
    } as unknown as typeof state
    expect(
      getMatchLegality(delayedState, participantId).legalAttackerInstanceIds
    ).toContain(minion.instanceId)
    expect(
      getMatchLegality(
        { ...delayedState, turnNumber: state.turnNumber + 1 },
        participantId
      ).legalAttackerInstanceIds
    ).not.toContain(minion.instanceId)
  })
  it("expires a real this-attack keyword after Gladiator's Longbow combat", () => {
    const scenario = createMatchScenario({
      seed: 97,
      firstHeroId: 'rexxar',
      cardId: 'classic_gladiators_longbow'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const longbow = player(scenario, playerId).hand.find(
      (card) => card.cardId === 'classic_gladiators_longbow'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: longbow.instanceId
      }).accepted
    ).toBe(true)
    const before = player(scenario, playerId).hero.health
    const attack = scenario.match.dispatch({
      type: 'attack-character',
      participantId: playerId,
      attacker: { kind: 'hero' },
      defender: { kind: 'hero', participantId: opponentId }
    })
    expect(attack.accepted).toBe(true)
    const hero = player(scenario, playerId).hero
    expect(hero.health).toBe(before)
    expect(hero.immune).toBe(false)
    expect(hero.enchantments ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ duration: 'this-attack' })])
    )
  })
  it('retains delayed stat enchantments and removes source-bound effects after the source leaves play', () => {
    const scenario = createMatchScenario({ seed: 96 })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    for (let index = 0; index < 2; index += 1) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
    }
    const state = scenario.match.getState()
    const playerIndex = state.players.findIndex(
      (player) => player.participantId === participantId
    )
    const source = state.players[playerIndex]!.board[0]!
    const target = state.players[playerIndex]!.board[1]!
    const baseAttack = target.attack
    const delayedState = {
      ...state,
      players: state.players.map((player, index) =>
        index !== playerIndex
          ? player
          : {
              ...player,
              board: player.board.map((minion) =>
                minion.instanceId !== target.instanceId
                  ? minion
                  : {
                      ...minion,
                      enchantments: [
                        {
                          id: 'next-turn-stat',
                          sourceInstanceId: source.instanceId,
                          sourceCardId: null,
                          attackDelta: 2,
                          duration: 'next-turn',
                          startsOnTurn: state.turnNumber + 1,
                          expiresOnTurn: state.turnNumber + 1
                        },
                        {
                          id: 'source-bound-stat',
                          sourceInstanceId: source.instanceId,
                          sourceCardId: null,
                          attackDelta: 3,
                          duration: 'while-source-in-play'
                        }
                      ]
                    }
              )
            }
      )
    } as unknown as typeof state
    const dormant = getDerivedState(delayedState)
    expect(dormant.players[playerIndex]!.board[1]).toMatchObject({
      attack: baseAttack + 3,
      enchantments: expect.arrayContaining([
        expect.objectContaining({ id: 'next-turn-stat' })
      ])
    })
    const active = getDerivedState({
      ...delayedState,
      turnNumber: state.turnNumber + 1
    })
    expect(active.players[playerIndex]!.board[1]!.attack).toBe(baseAttack + 5)
    const expired = getDerivedState({
      ...delayedState,
      turnNumber: state.turnNumber + 2
    })
    expect(expired.players[playerIndex]!.board[1]!.attack).toBe(baseAttack + 3)

    const sourceInHand = getDerivedState({
      ...expired,
      players: expired.players.map((player, index) =>
        index !== playerIndex
          ? player
          : {
              ...player,
              board: player.board.filter(
                (minion) => minion.instanceId !== source.instanceId
              ),
              hand: player.hand.map((card, handIndex) =>
                handIndex === 0 ? { ...card, instanceId: source.instanceId } : card
              )
            }
      )
    } as unknown as typeof state)
    expect(sourceInHand.players[playerIndex]!.board[0]!.attack).toBe(baseAttack)
  })
  it('retains a real next-turn cost modifier until it becomes active and expires', () => {
    const scenario = createMatchScenario({ seed: 95, cardId: 'naxxramas_loatheb' })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: opponentId,
        cardId: 'basic_arcane_shot'
      }).accepted
    ).toBe(true)
    const loatheb = player(scenario, playerId).hand.find(
      (card) => card.cardId === 'naxxramas_loatheb'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: loatheb.instanceId,
        position: 0
      }).accepted
    ).toBe(true)

    const spellCost = () =>
      player(scenario, opponentId).hand.find(
        (card) => card.cardId === 'basic_arcane_shot'
      )!.currentCost
    expect(spellCost()).toBe(1)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: playerId }).accepted
    ).toBe(true)
    expect(spellCost()).toBe(6)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)
    expect(spellCost()).toBe(1)
  })
  it('projects branch-specific choices and targets through canonical input', () => {
    const first = createMatchScenario({
      seed: 60,
      cardId: 'classic_keeper_of_the_grove'
    })
    first.confirmBothMulligans()
    const firstPlayerId = first.match.getState().activePlayerId!
    const firstOpponentId = first.participants.find(
      (participantId) => participantId !== firstPlayerId
    )!
    expect(
      first.match.dispatch({
        type: 'dev-set-mana',
        participantId: firstPlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const firstCard = first.match
      .getState()
      .players.find((player) => player.participantId === firstPlayerId)!
      .hand.find((card) => card.cardId === 'classic_keeper_of_the_grove')!
    const firstInput = first.match.getPlayInput?.(firstPlayerId, firstCard.instanceId)
    expect(firstInput).toMatchObject({
      choiceCount: 2,
      legalChoices: [0, 1],
      requiresPosition: true
    })
    expect(firstInput?.targetSelectors).toHaveLength(1)
    expect(firstInput?.legalTargetOptions).toEqual([
      [
        { kind: 'hero', participantId: firstPlayerId },
        { kind: 'hero', participantId: firstOpponentId }
      ]
    ])
    const firstSecondChoiceInput = first.match.getPlayInput?.(
      firstPlayerId,
      firstCard.instanceId,
      1
    )
    expect(firstSecondChoiceInput?.targetSelectors).toHaveLength(1)
    expect(firstSecondChoiceInput?.targetSelectors[0]).toMatchObject({
      controller: 'any',
      type: 'minion'
    })
    expect(firstSecondChoiceInput?.legalTargetOptions[0]).toEqual([])
    expect(first.match.getLegality?.(firstPlayerId).playableCardInstanceIds).toContain(
      firstCard.instanceId
    )
    const firstResult = first.match.dispatch({
      type: 'play-card',
      participantId: firstPlayerId,
      cardInstanceId: firstCard.instanceId,
      position: 0,
      targets: [{ kind: 'hero', participantId: firstOpponentId }],
      choice: 0
    })
    expect(firstResult.accepted).toBe(true)

    const second = createMatchScenario({
      seed: 61,
      cardId: 'classic_keeper_of_the_grove'
    })
    second.confirmBothMulligans()
    const secondPlayerId = second.match.getState().activePlayerId!
    const secondOpponentId = second.participants.find(
      (participantId) => participantId !== secondPlayerId
    )!
    expect(
      second.match.dispatch({
        type: 'dev-set-mana',
        participantId: secondPlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      second.match.dispatch({
        type: 'dev-summon-minion',
        participantId: secondOpponentId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const targetMinion = second.match
      .getState()
      .players.find((player) => player.participantId === secondOpponentId)!.board[0]!
    const secondCard = second.match
      .getState()
      .players.find((player) => player.participantId === secondPlayerId)!
      .hand.find((card) => card.cardId === 'classic_keeper_of_the_grove')!
    const secondChoiceInput = second.match.getPlayInput?.(
      secondPlayerId,
      secondCard.instanceId,
      1
    )
    expect(secondChoiceInput?.legalTargetOptions[0]).toEqual([
      {
        kind: 'minion',
        participantId: secondOpponentId,
        instanceId: targetMinion.instanceId
      }
    ])
    const secondResult = second.match.dispatch({
      type: 'play-card',
      participantId: secondPlayerId,
      cardInstanceId: secondCard.instanceId,
      position: 0,
      targets: [
        {
          kind: 'minion',
          participantId: secondOpponentId,
          instanceId: targetMinion.instanceId
        }
      ],
      choice: 1
    })
    expect(secondResult.accepted).toBe(true)
  })

  it('returns stable target rejection codes without mutating the match', () => {
    const setup = (seed: number, cardId = 'basic_arcane_shot') => {
      const scenario = createMatchScenario({
        seed,
        cardId
      })
      scenario.confirmBothMulligans()
      const playerId = scenario.match.getState().activePlayerId!
      const opponentId = scenario.participants.find(
        (participantId) => participantId !== playerId
      )!
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId: playerId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      return { scenario, playerId, opponentId, cardId }
    }
    const assertRejected = (
      seed: number,
      target: unknown,
      expectedCode: string
    ): void => {
      const { scenario, playerId, cardId } = setup(seed)
      const before = scenario.match.getState()
      const card = before.players
        .find((player) => player.participantId === playerId)!
        .hand.find((entry) => entry.cardId === cardId)!
      const result = scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: card.instanceId,
        targets: [target]
      })
      expect(result.accepted).toBe(false)
      if (result.accepted) return
      expect(result.code).toBe(expectedCode)
      expect(result.state).toEqual(before)
    }

    const wrongController = setup(62, 'basic_frost_shock')
    const wrongControllerBefore = wrongController.scenario.match.getState()
    const wrongControllerCard = wrongControllerBefore.players
      .find((player) => player.participantId === wrongController.playerId)!
      .hand.find((entry) => entry.cardId === wrongController.cardId)!
    const wrongControllerResult = wrongController.scenario.match.dispatch({
      type: 'play-card',
      participantId: wrongController.playerId,
      cardInstanceId: wrongControllerCard.instanceId,
      targets: [{ kind: 'hero', participantId: wrongController.playerId }]
    })
    expect(wrongControllerResult.accepted).toBe(false)
    if (!wrongControllerResult.accepted) {
      expect(wrongControllerResult.code).toBe('wrong-controller')
      expect(wrongControllerResult.state).toEqual(wrongControllerBefore)
    }

    assertRejected(
      63,
      { kind: 'minion', participantId: 'scenario-player-two', instanceId: 'stale' },
      'stale-target'
    )

    const illegal = setup(64)
    const illegalBefore = illegal.scenario.match.getState()
    const illegalCard = illegalBefore.players
      .find((player) => player.participantId === illegal.playerId)!
      .hand.find((entry) => entry.cardId === 'basic_arcane_shot')!
    const illegalTarget = illegalBefore.players.find(
      (player) => player.participantId === illegal.opponentId
    )!.hand[0]!
    const illegalResult = illegal.scenario.match.dispatch({
      type: 'play-card',
      participantId: illegal.playerId,
      cardInstanceId: illegalCard.instanceId,
      targets: [
        {
          kind: 'card',
          participantId: illegal.opponentId,
          instanceId: illegalTarget.instanceId
        }
      ]
    })
    expect(illegalResult.accepted).toBe(false)
    if (!illegalResult.accepted) {
      expect(illegalResult.code).toBe('illegal-target')
      expect(illegalResult.state).toEqual(illegalBefore)
    }

    const wrongZone = setup(65)
    const wrongZoneBefore = wrongZone.scenario.match.getState()
    const wrongZoneCard = wrongZoneBefore.players
      .find((player) => player.participantId === wrongZone.playerId)!
      .hand.find((entry) => entry.cardId === 'basic_arcane_shot')!
    const handTarget = wrongZoneBefore.players.find(
      (player) => player.participantId === wrongZone.opponentId
    )!.hand[0]!
    const wrongZoneResult = wrongZone.scenario.match.dispatch({
      type: 'play-card',
      participantId: wrongZone.playerId,
      cardInstanceId: wrongZoneCard.instanceId,
      targets: [
        {
          kind: 'minion',
          participantId: wrongZone.opponentId,
          instanceId: handTarget.instanceId
        }
      ]
    })
    expect(wrongZoneResult.accepted).toBe(false)
    if (!wrongZoneResult.accepted) {
      expect(wrongZoneResult.code).toBe('wrong-zone')
      expect(wrongZoneResult.state).toEqual(wrongZoneBefore)
    }

    const immune = setup(66)
    expect(
      immune.scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: immune.opponentId,
        cardId: 'classic_faerie_dragon'
      }).accepted
    ).toBe(true)
    const immuneBefore = immune.scenario.match.getState()
    const immuneCard = immuneBefore.players
      .find((player) => player.participantId === immune.playerId)!
      .hand.find((entry) => entry.cardId === 'basic_arcane_shot')!
    const immuneTarget = immuneBefore.players.find(
      (player) => player.participantId === immune.opponentId
    )!.board[0]!
    const immuneResult = immune.scenario.match.dispatch({
      type: 'play-card',
      participantId: immune.playerId,
      cardInstanceId: immuneCard.instanceId,
      targets: [
        {
          kind: 'minion',
          participantId: immune.opponentId,
          instanceId: immuneTarget.instanceId
        }
      ]
    })
    expect(immuneResult.accepted).toBe(false)
    if (!immuneResult.accepted) {
      expect(immuneResult.code).toBe('immune-target')
      expect(immuneResult.state).toEqual(immuneBefore)
    }
  })

  it('rejects extra card input and invalid choices atomically', () => {
    const extra = createMatchScenario({ seed: 67, cardId: 'basic_the_coin' })
    extra.confirmBothMulligans()
    const extraPlayerId = extra.match.getState().activePlayerId!
    expect(
      extra.match.dispatch({
        type: 'dev-set-mana',
        participantId: extraPlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const extraBefore = extra.match.getState()
    const extraCard = extraBefore.players.find(
      (player) => player.participantId === extraPlayerId
    )!.hand[0]!
    const extraResult = extra.match.dispatch({
      type: 'play-card',
      participantId: extraPlayerId,
      cardInstanceId: extraCard.instanceId,
      targets: [{ kind: 'hero', participantId: extraPlayerId }]
    })
    expect(extraResult.accepted).toBe(false)
    if (!extraResult.accepted) {
      expect(extraResult.code).toBe('extra-input')
      expect(extraResult.state).toEqual(extraBefore)
    }

    const duplicate = createMatchScenario({
      seed: 68,
      cardId: 'classic_keeper_of_the_grove'
    })
    duplicate.confirmBothMulligans()
    const duplicatePlayerId = duplicate.match.getState().activePlayerId!
    const duplicateOpponentId = duplicate.participants.find(
      (participantId) => participantId !== duplicatePlayerId
    )!
    expect(
      duplicate.match.dispatch({
        type: 'dev-set-mana',
        participantId: duplicatePlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const duplicateBefore = duplicate.match.getState()
    const duplicateCard = duplicateBefore.players
      .find((player) => player.participantId === duplicatePlayerId)!
      .hand.find((entry) => entry.cardId === 'classic_keeper_of_the_grove')!
    const duplicateResult = duplicate.match.dispatch({
      type: 'play-card',
      participantId: duplicatePlayerId,
      cardInstanceId: duplicateCard.instanceId,
      position: 0,
      targets: [
        { kind: 'hero', participantId: duplicateOpponentId },
        { kind: 'hero', participantId: duplicateOpponentId }
      ],
      choice: 0
    })
    expect(duplicateResult.accepted).toBe(false)
    if (!duplicateResult.accepted) {
      expect(duplicateResult.code).toBe('duplicate-target')
      expect(duplicateResult.state).toEqual(duplicateBefore)
    }
    const choice = createMatchScenario({
      seed: 68,
      cardId: 'classic_power_of_the_wild'
    })
    choice.confirmBothMulligans()
    const choicePlayerId = choice.match.getState().activePlayerId!
    expect(
      choice.match.dispatch({
        type: 'dev-set-mana',
        participantId: choicePlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const choiceBefore = choice.match.getState()
    const choiceCard = choiceBefore.players.find(
      (player) => player.participantId === choicePlayerId
    )!.hand[0]!
    const missingChoice = choice.match.dispatch({
      type: 'play-card',
      participantId: choicePlayerId,
      cardInstanceId: choiceCard.instanceId
    })
    expect(missingChoice.accepted).toBe(false)
    if (!missingChoice.accepted) {
      expect(missingChoice.code).toBe('missing-input')
      expect(missingChoice.state).toEqual(choiceBefore)
    }
    const invalidChoice = choice.match.dispatch({
      type: 'play-card',
      participantId: choicePlayerId,
      cardInstanceId: choiceCard.instanceId,
      choice: 2
    })
    expect(invalidChoice.accepted).toBe(false)
    if (!invalidChoice.accepted) {
      expect(invalidChoice.code).toBe('extra-input')
      expect(invalidChoice.state).toEqual(choiceBefore)
    }
  })
  it('projects card type, resource, turn, board, and source-zone legality', () => {
    const scenario = createMatchScenario({
      seed: 69,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    const opponentId = scenario.participants.find(
      (participantId) => participantId !== playerId
    )!
    const minion = scenario.match
      .getState()
      .players.find((player) => player.participantId === playerId)!
      .hand.find((card) => card.cardId === 'basic_acidic_swamp_ooze')!
    expect(scenario.match.getPlayInput?.(playerId, minion.instanceId)).toMatchObject({
      requiresPosition: true,
      legalPositions: [0]
    })
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 0,
        maximum: 0
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.getLegality?.(playerId).playableCardInstanceIds
    ).not.toContain(minion.instanceId)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    for (const cardId of [
      'basic_arcanite_reaper',
      'classic_lord_jaraxxus',
      'basic_the_coin'
    ]) {
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId: playerId,
          cardId
        }).accepted
      ).toBe(true)
    }
    expect(scenario.match.getLegality?.(playerId).playableCardInstanceIds).toContain(
      minion.instanceId
    )
    for (let index = 0; index < 7; index += 1) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: playerId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
    }
    expect(
      scenario.match.getLegality?.(playerId).playableCardInstanceIds
    ).not.toContain(minion.instanceId)
    expect(
      scenario.match.getPlayInput?.(playerId, minion.instanceId)?.legalPositions
    ).toEqual([])
    expect(scenario.match.getLegality?.(opponentId)).toMatchObject({
      canEndTurn: false,
      playableCardInstanceIds: []
    })

    const staleBefore = scenario.match.getState()
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId: playerId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    const staleState = scenario.match.getState()
    const staleResult = scenario.match.dispatch({
      type: 'play-card',
      participantId: playerId,
      cardInstanceId: minion.instanceId,
      position: 0
    })
    expect(staleResult.accepted).toBe(false)
    if (!staleResult.accepted) {
      expect(staleResult.code).toBe('stale-target')
      expect(staleResult.state).toEqual(staleState)
    }
    expect(staleBefore.revision).toBeLessThan(staleState.revision)
  })

  it('rejects missing input atomically without consuming mana or the card', () => {
    const scenario = createMatchScenario({ seed: 42, cardId: 'basic_arcane_shot' })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    const setMana = scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId: playerId,
      available: 10,
      maximum: 10
    })
    expect(setMana.accepted).toBe(true)
    const before = scenario.match.getState()
    const card = before.players.find((player) => player.participantId === playerId)!
      .hand[0]!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: playerId,
      cardInstanceId: card.instanceId
    })
    expect(result.accepted).toBe(false)
    if (result.accepted) return
    expect(result.code).toBe('missing-input')
    expect(result.state).toEqual(before)
    expect(result.events).toEqual([])
  })

  it('uses identical legality and mana payment for human and temporary-opponent controllers', () => {
    const humanFirst = createMatchScenario({
      seed: 49,
      cardId: 'basic_acidic_swamp_ooze',
      firstController: 'human',
      secondController: 'ai'
    })
    const aiFirst = createMatchScenario({
      seed: 49,
      cardId: 'basic_acidic_swamp_ooze',
      firstController: 'ai',
      secondController: 'human'
    })

    const playActiveCard = (scenario: ReturnType<typeof createMatchScenario>) => {
      scenario.confirmBothMulligans()
      const participantId = scenario.match.getState().activePlayerId!
      const mana = scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      })
      expect(mana.accepted).toBe(true)
      const legality = scenario.match.getLegality?.(participantId)
      const card = scenario.match
        .getState()
        .players.find((candidate) => candidate.participantId === participantId)!
        .hand[0]!
      expect(legality?.playableCardInstanceIds).toContain(card.instanceId)
      const result = scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        position: 0
      })
      expect(result.accepted).toBe(true)
      if (!result.accepted) return null
      const playerState = result.state.players.find(
        (candidate) => candidate.participantId === participantId
      )!
      return {
        participantId,
        mana: playerState.mana.available,
        hand: playerState.hand.length,
        board: playerState.board.map((minion) => ({
          cardId: minion.cardId,
          attack: minion.attack,
          health: minion.health
        }))
      }
    }

    expect(playActiveCard(humanFirst)).toEqual(playActiveCard(aiFirst))
  })
  it('resolves secret-played listeners against the canonical secret event', () => {
    const scenario = createMatchScenario({ seed: 43 })
    scenario.confirmBothMulligans()
    const [playerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'classic_secretkeeper'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: playerId,
        cardId: 'classic_ice_block'
      }).accepted
    ).toBe(true)
    const secret = scenario.match
      .getState()
      .players[0].hand.find((card) => card.cardId === 'classic_ice_block')
    expect(secret).toBeDefined()

    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: playerId,
      cardInstanceId: secret!.instanceId
    })
    expect(result.accepted).toBe(true)
    expect(player(scenario, playerId).board[0]).toMatchObject({
      cardId: 'classic_secretkeeper',
      attack: 2,
      health: 3
    })
  })

  it('returns an attacking minion with Freezing Trap and applies the hand cost increase', () => {
    const scenario = createMatchScenario({ seed: 44 })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: opponentId,
        cardId: 'classic_freezing_trap'
      }).accepted
    ).toBe(true)

    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: playerId }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: opponentId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const trap = player(scenario, opponentId).hand.find(
      (card) => card.cardId === 'classic_freezing_trap'
    )
    expect(trap).toBeDefined()
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: opponentId,
        cardInstanceId: trap!.instanceId
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)

    const attacker = player(scenario, playerId).board[0]
    expect(attacker).toBeDefined()
    const attackerInstanceId = attacker!.instanceId
    const result = scenario.match.dispatch({
      type: 'attack-character',
      participantId: playerId,
      attacker: { kind: 'minion', instanceId: attackerInstanceId },
      defender: { kind: 'hero' }
    })
    expect(result.accepted).toBe(true)
    const returned = player(scenario, playerId).hand.find(
      (card) => card.instanceId === attackerInstanceId
    )
    expect(returned).toMatchObject({ currentCost: 4, zone: 'hand' })
    expect(returned?.costAdjustments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 2, duration: 'while-in-hand' })
      ])
    )
  })

  it('fires armor triggers without treating armor gain as hero damage', () => {
    const scenario = createMatchScenario({ seed: 45, firstHeroId: 'garrosh' })
    scenario.confirmBothMulligans()
    const [playerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'goblins_vs_gnomes_siege_engine'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: playerId,
        cardId: 'classic_eye_for_an_eye'
      }).accepted
    ).toBe(true)
    const eye = player(scenario, playerId).hand.find(
      (card) => card.cardId === 'classic_eye_for_an_eye'
    )
    expect(eye).toBeDefined()
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: eye!.instanceId
      }).accepted
    ).toBe(true)

    const power = scenario.match.dispatch({
      type: 'use-hero-power',
      participantId: playerId
    })
    expect(power.accepted).toBe(true)
    expect(player(scenario, playerId)).toMatchObject({ hero: { armor: 2 } })
    expect(player(scenario, playerId).board[0]).toMatchObject({ attack: 6 })
    expect(player(scenario, playerId).secrets).toHaveLength(1)
  })

  it('applies Eye for an Eye to damage absorbed by armor', () => {
    const scenario = createMatchScenario({
      seed: 46,
      firstHeroId: 'rexxar',
      secondHeroId: 'rexxar'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-hero',
        participantId: playerId,
        health: 30,
        armor: 2
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: playerId,
        cardId: 'classic_eye_for_an_eye'
      }).accepted
    ).toBe(true)
    const eye = player(scenario, playerId).hand.find(
      (card) => card.cardId === 'classic_eye_for_an_eye'
    )
    expect(eye).toBeDefined()
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: eye!.instanceId
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: playerId }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: opponentId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)

    const damage = scenario.match.dispatch({
      type: 'use-hero-power',
      participantId: opponentId
    })
    expect(damage.accepted).toBe(true)
    expect(player(scenario, playerId).hero).toMatchObject({ health: 30, armor: 0 })
    expect(player(scenario, opponentId).hero.health).toBe(28)
  })

  it('limits Auchenai replacement to the controller of the replacement source', () => {
    const scenario = createMatchScenario({
      seed: 47,
      firstHeroId: 'anduin',
      secondHeroId: 'anduin'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-hero',
        participantId: playerId,
        health: 20
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'classic_auchenai_soulpriest'
      }).accepted
    ).toBe(true)

    expect(
      scenario.match.dispatch({
        type: 'use-hero-power',
        participantId: playerId,
        target: { kind: 'hero', participantId: playerId }
      }).accepted
    ).toBe(true)
    expect(player(scenario, playerId).hero.health).toBe(22)
  })

  it('resolves Baron Rivendare deathrattles twice in the captured death batch', () => {
    const scenario = createMatchScenario({
      seed: 48,
      firstHeroId: 'jaina',
      secondHeroId: 'jaina'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'naxxramas_baron_rivendare'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'classic_leper_gnome'
      }).accepted
    ).toBe(true)
    const leper = player(scenario, playerId).board.find(
      (minion) => minion.cardId === 'classic_leper_gnome'
    )
    expect(leper).toBeDefined()

    expect(
      scenario.match.dispatch({
        type: 'use-hero-power',
        participantId: playerId,
        target: {
          kind: 'minion',
          participantId: playerId,
          instanceId: leper!.instanceId
        }
      }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).hero.health).toBe(26)
    expect(
      player(scenario, playerId).graveyard?.some(
        (entry) => entry.minion.cardId === 'classic_leper_gnome'
      )
    ).toBe(true)
  })

  it('does not trigger a living Haunted Creeper when another minion dies in combat', () => {
    const scenario = createMatchScenario({
      seed: 813,
      firstHeroId: 'jaina',
      secondHeroId: 'jaina'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    for (const [participantId, cardId] of [
      [playerId, 'naxxramas_haunted_creeper'],
      [playerId, 'classic_leper_gnome'],
      [opponentId, 'basic_bloodfen_raptor']
    ] as const) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId
        }).accepted
      ).toBe(true)
    }
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: playerId }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)

    const leper = player(scenario, playerId).board.find(
      (minion) => minion.cardId === 'classic_leper_gnome'
    )!
    const raptor = player(scenario, opponentId).board[0]!
    const opponentHeroHealth = player(scenario, opponentId).hero.health
    expect(
      scenario.match.dispatch({
        type: 'attack-character',
        participantId: playerId,
        attacker: { kind: 'minion', instanceId: leper.instanceId },
        defender: { kind: 'minion', instanceId: raptor.instanceId }
      }).accepted
    ).toBe(true)

    expect(player(scenario, opponentId).hero.health).toBe(opponentHeroHealth - 2)
    expect(player(scenario, playerId).board).toEqual([
      expect.objectContaining({ cardId: 'naxxramas_haunted_creeper', health: 2 })
    ])
  })

  it('does not trigger a living Haunted Creeper when it kills another minion', () => {
    const scenario = createMatchScenario({
      seed: 814,
      firstHeroId: 'jaina',
      secondHeroId: 'jaina'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    for (const [participantId, cardId] of [
      [playerId, 'naxxramas_haunted_creeper'],
      [opponentId, 'classic_wisp']
    ] as const) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId
        }).accepted
      ).toBe(true)
    }
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: playerId }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)

    const creeper = player(scenario, playerId).board[0]!
    const wisp = player(scenario, opponentId).board[0]!
    expect(
      scenario.match.dispatch({
        type: 'attack-character',
        participantId: playerId,
        attacker: { kind: 'minion', instanceId: creeper.instanceId },
        defender: { kind: 'minion', instanceId: wisp.instanceId }
      }).accepted
    ).toBe(true)

    expect(player(scenario, playerId).board).toEqual([
      expect.objectContaining({
        cardId: 'naxxramas_haunted_creeper',
        health: 1
      })
    ])
  })

  it('applies permanent buffs, swaps stats, and silences through real card commands', () => {
    const scenario = createMatchScenario({
      seed: 95,
      cardId: 'basic_blessing_of_might'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, participantId).board[0]!
    const blessing = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'basic_blessing_of_might'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: blessing.instanceId,
        targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[0]).toMatchObject({
      attack: 6,
      health: 2
    })
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'basic_blessing_of_might'
      }).accepted
    ).toBe(true)
    const secondBlessing = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'basic_blessing_of_might'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: secondBlessing.instanceId,
        targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[0]).toMatchObject({
      attack: 9,
      health: 2
    })
    const onceDerived = getDerivedState(scenario.match.getState())
    expect(getDerivedState(onceDerived)).toEqual(onceDerived)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_crazed_alchemist'
      }).accepted
    ).toBe(true)
    const alchemist = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_crazed_alchemist'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: alchemist.instanceId,
        position: 1,
        targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === target.instanceId
      )
    ).toMatchObject({ attack: 2, health: 9, maxHealth: 9 })
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_silence'
      }).accepted
    ).toBe(true)
    const silence = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_silence'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: silence.instanceId,
        targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === target.instanceId
      )
    ).toMatchObject({
      attack: 3,
      health: 2,
      maxHealth: 2,
      silenced: true,
      enchantments: []
    })
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_silence'
      }).accepted
    ).toBe(true)
    const repeatedSilence = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_silence'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: repeatedSilence.instanceId,
        targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === target.instanceId
      )
    ).toMatchObject({
      attack: 3,
      health: 2,
      maxHealth: 2,
      silenced: true,
      enchantments: []
    })
  })
  it('recomputes a real while-condition aura as its condition changes', () => {
    const scenario = createMatchScenario({ seed: 102 })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    for (const cardId of [
      'goblins_vs_gnomes_cogmaster',
      'goblins_vs_gnomes_warbot'
    ] as const) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId
        }).accepted
      ).toBe(true)
    }
    const state = scenario.match.getState()
    const playerIndex = state.players.findIndex(
      (player) => player.participantId === participantId
    )
    const cogmaster = state.players[playerIndex]!.board.find(
      (minion) => minion.cardId === 'goblins_vs_gnomes_cogmaster'
    )!
    expect(
      getDerivedState(state).players[playerIndex]!.board.find(
        (minion) => minion.instanceId === cogmaster.instanceId
      )?.attack
    ).toBe(3)
    const withoutMech = {
      ...state,
      players: state.players.map((player, index) =>
        index !== playerIndex
          ? player
          : {
              ...player,
              board: player.board.filter(
                (minion) => minion.cardId !== 'goblins_vs_gnomes_warbot'
              )
            }
      )
    } as unknown as typeof state
    expect(
      getDerivedState(withoutMech).players[playerIndex]!.board.find(
        (minion) => minion.instanceId === cogmaster.instanceId
      )?.attack
    ).toBe(1)
  })
  it('grants a deterministic random keyword through the resolver fixture path', () => {
    const fixtureId = 'phase7_random_keyword_fixture' as CardId
    const fixture = {
      id: fixtureId,
      name: 'Phase 7 Random Keyword Fixture',
      rarity: 'Common',
      cardClass: 'Neutral',
      type: 'Spell',
      subtype: 'General',
      cost: 0,
      attack: null,
      health: null,
      rulesText: '',
      keywords: [],
      effects: [
        {
          trigger: 'cast',
          actions: [
            {
              action: 'grant-random-keyword',
              target: {
                controller: 'self',
                type: 'minion',
                selection: 'chosen'
              },
              keywords: ['taunt', 'windfury'],
              duration: 'permanent'
            }
          ]
        }
      ]
    } as unknown as CardDefinition
    const catalog = CARD_CATALOG as unknown as {
      readonly cardsById: Map<CardId, CardDefinition>
    }
    catalog.cardsById.set(fixtureId, fixture)
    try {
      const scenario = createMatchScenario({ seed: 101 })
      scenario.confirmBothMulligans()
      const [participantId] = activeParticipants(scenario)
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId,
          cardId: fixtureId
        }).accepted
      ).toBe(true)
      const fixtureCard = player(scenario, participantId).hand.find(
        (card) => card.cardId === fixtureId
      )!
      const target = player(scenario, participantId).board[0]!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId,
          cardInstanceId: fixtureCard.instanceId,
          targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
        }).accepted
      ).toBe(true)
      expect(
        player(scenario, participantId).board.find(
          (minion) => minion.instanceId === target.instanceId
        )?.enchantments
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            keywords: expect.arrayContaining([
              expect.stringMatching(/^(taunt|windfury)$/)
            ])
          })
        ])
      )
    } finally {
      catalog.cardsById.delete(fixtureId)
    }
  })
  it('keeps real until-next-turn keyword grants through the opponent turn only', () => {
    const scenario = createMatchScenario({ seed: 100, cardId: 'classic_conceal' })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, participantId).board[0]!
    const conceal = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_conceal'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: conceal.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[0]!.stealth).toBe(true)
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === target.instanceId
      )?.stealth
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === target.instanceId
      )?.stealth
    ).toBe(false)
  })
  it('honors and expires real minimum-Health enchantments at turn boundaries', () => {
    const scenario = createMatchScenario({
      seed: 99,
      firstHeroId: 'garrosh',
      cardId: 'classic_commanding_shout'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, participantId).board[0]!
    const shout = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_commanding_shout'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: shout.instanceId
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'basic_hellfire'
      }).accepted
    ).toBe(true)
    const hellfire = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'basic_hellfire'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: hellfire.instanceId
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === target.instanceId
      )
    ).toMatchObject({ health: 1, maxHealth: 2 })
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === target.instanceId
      )?.enchantments
    ).toEqual([])
  })
  it('expires a real this-turn hero buff at the end-turn boundary', () => {
    const scenario = createMatchScenario({ seed: 96, cardId: 'basic_rockbiter_weapon' })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'basic_rockbiter_weapon'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        targets: [{ kind: 'hero', participantId }]
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).hero.attack).toBe(3)
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(player(scenario, participantId).hero.attack).toBe(0)
  })
  it('ends simultaneous hero lethal as a draw at the match-end checkpoint', () => {
    const scenario = createMatchScenario({
      seed: 808,
      cardId: 'basic_hellfire',
      firstHeroId: 'guldan',
      secondHeroId: 'jaina'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    for (const targetId of [participantId, opponentId])
      expect(
        scenario.match.dispatch({
          type: 'dev-set-hero',
          participantId: targetId,
          health: 3,
          armor: 0
        }).accepted
      ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'basic_hellfire'
    )
    expect(card).toBeDefined()
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card!.instanceId
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state).toMatchObject({
      phase: 'ended',
      activePlayerId: null,
      winnerId: null,
      loserId: null
    })
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'match-ended',
        winnerId: null,
        loserId: null,
        reason: 'simultaneous-hero-lethal'
      })
    )
  })
  it('resolves Shadowflame sacrifice damage through the shared destruction pipeline', () => {
    const scenario = createMatchScenario({
      seed: 809,
      cardId: 'classic_shadowflame',
      firstHeroId: 'guldan'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    for (const [id, cardId] of [
      [participantId, 'basic_boulderfist_ogre'],
      [opponentId, 'basic_chillwind_yeti']
    ] as const)
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: id,
          cardId
        }).accepted
      ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const source = player(scenario, participantId).board[0]!
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'classic_shadowflame'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId,
      targets: [{ kind: 'minion', participantId, instanceId: source.instanceId }]
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(player(scenario, participantId).board).toHaveLength(0)
    expect(player(scenario, opponentId).board).toHaveLength(0)
    expect(
      result.events.some(
        (event) => event.type === 'effect-resolved' && event.action === 'destroy'
      )
    ).toBe(true)
  })

  it('resolves Void Terror adjacent destruction and stat gain atomically', () => {
    const scenario = createMatchScenario({
      seed: 810,
      cardId: 'classic_void_terror',
      firstHeroId: 'guldan'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    for (const cardId of ['basic_acidic_swamp_ooze', 'basic_chillwind_yeti'])
      expect(
        scenario.match.dispatch({ type: 'dev-summon-minion', participantId, cardId })
          .accepted
      ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'classic_void_terror'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId,
      position: 1
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(player(scenario, participantId).board).toHaveLength(1)
    expect(player(scenario, participantId).board[0]).toMatchObject({
      cardId: 'classic_void_terror',
      attack: 10,
      health: 10,
      maxHealth: 10
    })
  })

  it('triggers live deathrattles without destroying their sources', () => {
    const scenario = createMatchScenario({
      seed: 811,
      cardId: 'goblins_vs_gnomes_feign_death',
      firstHeroId: 'rexxar'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'classic_leper_gnome'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'goblins_vs_gnomes_feign_death'
    )!
    const before = player(scenario, opponentId).hero.health
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId
    })
    expect(result.accepted).toBe(true)
    expect(player(scenario, participantId).board).toHaveLength(1)
    expect(player(scenario, opponentId).hero.health).toBe(before - 2)
  })

  it('processes Poison Seeds destruction before replacement summons', () => {
    const scenario = createMatchScenario({
      seed: 812,
      cardId: 'naxxramas_poison_seeds',
      firstHeroId: 'malfurion'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    for (const [id, cardId] of [
      [participantId, 'basic_acidic_swamp_ooze'],
      [opponentId, 'basic_chillwind_yeti']
    ] as const)
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: id,
          cardId
        }).accepted
      ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'naxxramas_poison_seeds'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(
      result.state.players
        .flatMap((entry) => entry.board)
        .every((minion) => minion.cardId === 'naxxramas_treant')
    ).toBe(true)
    expect(result.state.players.flatMap((entry) => entry.board)).toHaveLength(2)
    expect(
      result.state.players
        .flatMap((entry) => entry.graveyard ?? [])
        .map((entry) => entry.minion.cardId)
    ).toEqual(
      expect.arrayContaining(['basic_acidic_swamp_ooze', 'basic_chillwind_yeti'])
    )
  })
})
