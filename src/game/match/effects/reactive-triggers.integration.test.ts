import { describe, expect, it } from 'vitest'
import { createMatchScenario } from '../testing/match-scenario-builder'

type Scenario = ReturnType<typeof createMatchScenario>

function player(scenario: Scenario, participantId: string) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
}

function activePlayers(scenario: Scenario) {
  const active = scenario.match.getState().activePlayerId!
  return [
    active,
    scenario.participants.find((participantId) => participantId !== active)!
  ] as const
}

function setMana(scenario: Scenario, participantId: string) {
  expect(
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId,
      available: 10,
      maximum: 10
    }).accepted
  ).toBe(true)
}

describe('reactive trigger timing', () => {
  it('resolves Floating Watcher when its controller damages their own hero', () => {
    const scenario = createMatchScenario({
      seed: 1100,
      firstHeroId: 'guldan',
      secondHeroId: 'guldan'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'goblins_vs_gnomes_floating_watcher'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)

    expect(
      scenario.match.dispatch({ type: 'use-hero-power', participantId }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).hero.health).toBe(28)
    expect(player(scenario, participantId).board[0]).toMatchObject({
      attack: 6,
      health: 6
    })
  })

  it("executes Corruption at its caster's next start-of-turn boundary", () => {
    const scenario = createMatchScenario({ seed: 1101, cardId: 'basic_corruption' })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    const summon = scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId: opponentId,
      cardId: 'basic_acidic_swamp_ooze'
    })
    expect(summon.accepted).toBe(true)
    const target = player(scenario, opponentId).board[0]!
    setMana(scenario, participantId)
    const corruption = player(scenario, participantId).hand[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: corruption.instanceId,
        targets: [
          { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(player(scenario, opponentId).board).toHaveLength(1)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).board).toHaveLength(0)
  })

  it("keeps Nightmare's buff through the opponent's turn and destroys the target on the caster's next turn", () => {
    const scenario = createMatchScenario({ seed: 1104, cardId: 'classic_nightmare' })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
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
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_nightmare'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)
    const nightmare = player(scenario, participantId).hand[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: nightmare.instanceId,
        targets: [
          { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).board[0]).toMatchObject({
      attack: 8,
      health: 7,
      maxHealth: 7
    })
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(player(scenario, opponentId).board[0]).toMatchObject({
      attack: 8,
      health: 7,
      maxHealth: 7
    })
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).board).toHaveLength(0)
  })

  it('grants an on-attack trigger that resolves once from the captured minion', () => {
    const scenario = createMatchScenario({
      seed: 1102,
      cardId: 'classic_blessing_of_wisdom',
      firstHeroId: 'uther'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)
    const summon = scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId,
      cardId: 'basic_stonetusk_boar'
    })
    expect(summon.accepted).toBe(true)
    const attacker = player(scenario, participantId).board[0]!
    setMana(scenario, participantId)
    const wisdom = player(scenario, participantId).hand[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: wisdom.instanceId,
        targets: [{ kind: 'minion', participantId, instanceId: attacker.instanceId }]
      }).accepted
    ).toBe(true)
    const before = player(scenario, participantId).hand.length
    expect(
      scenario.match.dispatch({
        type: 'attack-character',
        participantId,
        attacker: { kind: 'minion', instanceId: attacker.instanceId },
        defender: { kind: 'hero' }
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).hand).toHaveLength(before + 1)
    expect(
      scenario.match.dispatch({
        type: 'attack-character',
        participantId,
        attacker: { kind: 'minion', instanceId: attacker.instanceId },
        defender: { kind: 'hero' }
      })
    ).toMatchObject({ accepted: false, code: 'minion-cannot-attack' })
  })

  it('runs end-of-turn scheduled destruction after a temporary Power Overwhelming buff', () => {
    const scenario = createMatchScenario({
      seed: 1103,
      cardId: 'classic_power_overwhelming',
      firstHeroId: 'guldan'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, participantId).board[0]!
    setMana(scenario, participantId)
    const power = player(scenario, participantId).hand[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: power.instanceId,
        targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[0]).toMatchObject({
      attack: 7,
      health: 6
    })
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(player(scenario, participantId).board).toHaveLength(0)
  })

  it('copies a Power Overwhelming Leeroy exactly while preserving fresh attack history', () => {
    const scenario = createMatchScenario({
      seed: 1105,
      cardId: 'classic_power_overwhelming',
      firstHeroId: 'guldan'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    for (const cardId of [
      'classic_leeroy_jenkins',
      'classic_power_overwhelming',
      'classic_faceless_manipulator'
    ] as const) {
      expect(
        scenario.match.dispatch({ type: 'dev-add-card', participantId, cardId })
          .accepted
      ).toBe(true)
    }
    setMana(scenario, participantId)

    const leeroyCard = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_leeroy_jenkins'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: leeroyCard.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).board).toHaveLength(2)

    const leeroy = player(scenario, participantId).board[0]!
    const power = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_power_overwhelming'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: power.instanceId,
        targets: [{ kind: 'minion', participantId, instanceId: leeroy.instanceId }]
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[0]).toMatchObject({
      attack: 10,
      health: 6,
      maxHealth: 6
    })

    expect(
      scenario.match.dispatch({
        type: 'attack-character',
        participantId,
        attacker: { kind: 'minion', instanceId: leeroy.instanceId },
        defender: { kind: 'hero' }
      }).accepted
    ).toBe(true)

    const facelessCard = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_faceless_manipulator'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: facelessCard.instanceId,
        position: 1,
        targets: [{ kind: 'minion', participantId, instanceId: leeroy.instanceId }]
      }).accepted
    ).toBe(true)

    const board = player(scenario, participantId).board
    const original = board.find((minion) => minion.instanceId === leeroy.instanceId)!
    const copy = board.find((minion) => minion.instanceId === facelessCard.instanceId)!
    expect(original).toMatchObject({
      cardId: 'classic_leeroy_jenkins',
      attack: 10,
      health: 6,
      attacksUsedThisTurn: 1
    })
    expect(copy).toMatchObject({
      cardId: 'classic_leeroy_jenkins',
      attack: 10,
      health: 6,
      maxHealth: 6,
      attacksUsedThisTurn: 0
    })
    expect(copy.enchantments).toHaveLength(1)
    expect(copy.attachedEffects).toHaveLength(1)
    expect(copy.enchantments?.[0]?.id).not.toBe(original.enchantments?.[0]?.id)
    expect(copy.attachedEffects?.[0]?.id).not.toBe(original.attachedEffects?.[0]?.id)

    expect(
      scenario.match.dispatch({
        type: 'attack-character',
        participantId,
        attacker: { kind: 'minion', instanceId: copy.instanceId },
        defender: { kind: 'hero' }
      }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).hero.health).toBe(10)

    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(player(scenario, participantId).board).toHaveLength(0)
    expect(
      player(scenario, participantId).graveyard?.filter(
        (entry) => entry.minion.cardId === 'classic_leeroy_jenkins'
      )
    ).toHaveLength(2)
    expect(player(scenario, opponentId).board).toHaveLength(2)
  })

  it('copies the current damage state of a board minion', () => {
    const scenario = createMatchScenario({
      seed: 1108,
      cardId: 'basic_arcane_shot',
      firstHeroId: 'rexxar'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    for (const cardId of [
      'basic_arcane_shot',
      'classic_faceless_manipulator'
    ] as const) {
      expect(
        scenario.match.dispatch({ type: 'dev-add-card', participantId, cardId })
          .accepted
      ).toBe(true)
    }
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_chillwind_yeti'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)

    const yeti = player(scenario, participantId).board[0]!
    const arcaneShot = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'basic_arcane_shot'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: arcaneShot.instanceId,
        targets: [{ kind: 'minion', participantId, instanceId: yeti.instanceId }]
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[0]).toMatchObject({
      health: 3,
      maxHealth: 5,
      damageTaken: 2
    })

    const facelessCard = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_faceless_manipulator'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: facelessCard.instanceId,
        position: 1,
        targets: [{ kind: 'minion', participantId, instanceId: yeti.instanceId }]
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[1]).toMatchObject({
      cardId: 'basic_chillwind_yeti',
      attack: 4,
      health: 3,
      maxHealth: 5,
      damageTaken: 2
    })
  })

  it('removes an attached Power Overwhelming death with Silence or transform', () => {
    for (const removalCardId of ['classic_silence', 'basic_polymorph'] as const) {
      const scenario = createMatchScenario({
        seed: removalCardId === 'classic_silence' ? 1106 : 1107,
        cardId: 'classic_power_overwhelming',
        firstHeroId: 'guldan'
      })
      scenario.confirmBothMulligans()
      const [participantId] = activePlayers(scenario)
      expect(
        scenario.match.dispatch({
          type: 'dev-clear-zone',
          participantId,
          zone: 'hand'
        }).accepted
      ).toBe(true)
      for (const cardId of ['classic_power_overwhelming', removalCardId] as const) {
        expect(
          scenario.match.dispatch({ type: 'dev-add-card', participantId, cardId })
            .accepted
        ).toBe(true)
      }
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
      setMana(scenario, participantId)
      const target = player(scenario, participantId).board[0]!
      const power = player(scenario, participantId).hand.find(
        (card) => card.cardId === 'classic_power_overwhelming'
      )!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId,
          cardInstanceId: power.instanceId,
          targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
        }).accepted
      ).toBe(true)
      const removal = player(scenario, participantId).hand.find(
        (card) => card.cardId === removalCardId
      )!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId,
          cardInstanceId: removal.instanceId,
          targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
        }).accepted
      ).toBe(true)
      expect(player(scenario, participantId).board[0]?.attachedEffects).toEqual([])
      expect(
        scenario.match.dispatch({ type: 'end-turn', participantId }).accepted
      ).toBe(true)
      expect(player(scenario, participantId).board).toHaveLength(1)
      expect(player(scenario, participantId).board[0]?.cardId).toBe(
        removalCardId === 'classic_silence' ? 'basic_acidic_swamp_ooze' : 'basic_sheep'
      )
    }
  })
})
