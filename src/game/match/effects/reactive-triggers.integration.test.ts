import { describe, expect, it } from 'vitest'
import { createMatchScenario } from '../testing/match-scenario-builder'
import type { PlayCardCommand } from '../opening-match-types'

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

  it('grants Warsong Commander Charge only to summoned minions with 3 or less Attack', () => {
    for (const [cardId, shouldCharge] of [
      ['basic_goldshire_footman', true],
      ['basic_ironfur_grizzly', true],
      ['basic_magma_rager', false]
    ] as const) {
      const scenario = createMatchScenario({ seed: 1110 })
      scenario.confirmBothMulligans()
      const [participantId, opponentId] = activePlayers(scenario)
      expect(
        scenario.match.dispatch({
          type: 'dev-clear-zone',
          participantId,
          zone: 'hand'
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId: 'basic_warsong_commander'
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({ type: 'dev-add-card', participantId, cardId })
          .accepted
      ).toBe(true)
      setMana(scenario, participantId)

      const card = player(scenario, participantId).hand[0]!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId,
          cardInstanceId: card.instanceId,
          position: 1
        }).accepted
      ).toBe(true)

      const summoned = player(scenario, participantId).board.find(
        (minion) => minion.cardId === cardId
      )!
      expect(
        summoned.enchantments?.some((enchantment) =>
          enchantment.keywords?.includes('charge')
        ) ?? false
      ).toBe(shouldCharge)
      const attack = scenario.match.dispatch({
        type: 'attack-character',
        participantId,
        attacker: { kind: 'minion', instanceId: summoned.instanceId },
        defender: { kind: 'hero', participantId: opponentId }
      })
      expect(attack.accepted).toBe(shouldCharge)
      if (!shouldCharge && !attack.accepted)
        expect(attack.code).toBe('minion-cannot-attack')
    }
  })

  it('grants Warsong Commander Charge to both a played summoner and its token', () => {
    const scenario = createMatchScenario({ seed: 1111 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_warsong_commander'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'basic_murloc_tidehunter'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)

    const tidehunterCard = player(scenario, participantId).hand[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: tidehunterCard.instanceId,
        position: 1
      }).accepted
    ).toBe(true)

    const board = player(scenario, participantId).board
    const warsong = board.find((minion) => minion.cardId === 'basic_warsong_commander')!
    const tidehunter = board.find(
      (minion) => minion.cardId === 'basic_murloc_tidehunter'
    )!
    const scout = board.find((minion) => minion.cardId === 'basic_murloc_scout')!
    const hasGrantedCharge = (minion: (typeof board)[number]) =>
      minion.enchantments?.some((enchantment) =>
        enchantment.keywords?.includes('charge')
      ) ?? false

    expect(hasGrantedCharge(warsong)).toBe(false)
    expect(hasGrantedCharge(tidehunter)).toBe(true)
    expect(hasGrantedCharge(scout)).toBe(true)
    for (const minion of [tidehunter, scout]) {
      expect(
        scenario.match.dispatch({
          type: 'attack-character',
          participantId,
          attacker: { kind: 'minion', instanceId: minion.instanceId },
          defender: { kind: 'hero', participantId: opponentId }
        }).accepted
      ).toBe(true)
    }
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

describe('original after-spell timing', () => {
  type Command = Parameters<Scenario['match']['dispatch']>[0]

  function dispatch(scenario: Scenario, command: Command) {
    const result = scenario.match.dispatch(command)
    expect(result.accepted, JSON.stringify(result)).toBe(true)
    if (!result.accepted) throw new Error(result.message)
    return result
  }

  function setup(cardId?: string) {
    const scenario = createMatchScenario({ cardId })
    scenario.confirmBothMulligans()
    return scenario
  }

  function summon(
    scenario: Scenario,
    cardId: string,
    participantId = activePlayers(scenario)[0]
  ) {
    dispatch(scenario, { type: 'dev-summon-minion', participantId, cardId })
    return player(scenario, participantId).board.at(-1)!
  }

  function play(
    scenario: Scenario,
    cardId: string,
    targets: PlayCardCommand['targets'] = []
  ) {
    const [participantId] = activePlayers(scenario)
    setMana(scenario, participantId)
    dispatch(scenario, { type: 'dev-add-card', participantId, cardId })
    const card = player(scenario, participantId).hand.find(
      (card) => card.cardId === cardId
    )!
    return dispatch(scenario, {
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId,
      targets
    })
  }

  function target(scenario: Scenario, instanceId: string) {
    return {
      kind: 'minion' as const,
      participantId: activePlayers(scenario)[0],
      instanceId
    }
  }

  function counter(scenario: Scenario) {
    const [caster, opponent] = activePlayers(scenario)
    dispatch(scenario, { type: 'end-turn', participantId: caster })
    play(scenario, 'classic_counterspell')
    dispatch(scenario, { type: 'end-turn', participantId: opponent })
  }

  it('resolves Equality before Pyromancer, clearing both boards', () => {
    const s = setup()
    const [caster, opponent] = activePlayers(s)
    summon(s, 'classic_wild_pyromancer')
    summon(s, 'basic_bloodfen_raptor', opponent)
    play(s, 'classic_equality')
    expect(player(s, caster).board).toHaveLength(0)
    expect(player(s, opponent).board).toHaveLength(0)
  })

  it('does not trigger a Pyromancer killed by the spell', () => {
    const s = setup()
    const [, opponent] = activePlayers(s)
    const pyro = summon(s, 'classic_wild_pyromancer')
    const raptor = summon(s, 'basic_bloodfen_raptor', opponent)
    play(s, 'basic_frostbolt', [target(s, pyro.instanceId)])
    expect(player(s, opponent).board[0].health).toBe(raptor.health)
  })

  it('heals before the Pyromancer damage', () => {
    const s = setup()
    const pyro = summon(s, 'classic_wild_pyromancer')
    play(s, 'basic_the_coin')
    expect(player(s, activePlayers(s)[0]).board[0].health).toBe(1)
    play(s, 'basic_holy_light', [target(s, pyro.instanceId)])
    expect(player(s, activePlayers(s)[0]).board[0].health).toBe(1)
  })

  it('does not trigger a Pyromancer silenced by the spell', () => {
    const s = setup()
    const pyro = summon(s, 'classic_wild_pyromancer')
    play(s, 'classic_silence', [target(s, pyro.instanceId)])
    expect(player(s, activePlayers(s)[0]).board[0].health).toBe(pyro.health)
  })

  it('lets a Pyromancer summoned by Mindgames trigger under the original rules', () => {
    const s = setup('classic_wild_pyromancer')
    play(s, 'classic_mindgames')
    expect(player(s, activePlayers(s)[0]).board[0]).toMatchObject({
      cardId: 'classic_wild_pyromancer',
      health: 1
    })
  })

  it('draws both cards before Flamewaker deals damage', () => {
    const s = setup()
    summon(s, 'blackrock_mountain_flamewaker')
    const result = play(s, 'basic_arcane_intellect')
    const actions = result.events.flatMap((e) =>
      e.type === 'effect-resolved' ? [e.action] : []
    )
    expect(actions).toEqual(['draw', 'draw', 'damage', 'damage'])
  })

  it('keeps Violet Teacher before the spell and Pyromancer after it', () => {
    const s = setup()
    summon(s, 'classic_violet_teacher')
    summon(s, 'classic_wild_pyromancer')
    play(s, 'basic_bloodlust')
    expect(player(s, activePlayers(s)[0]).board.map((m) => m.cardId)).not.toContain(
      'classic_violet_apprentice'
    )
    const teacher = player(s, activePlayers(s)[0]).board.find(
      (m) => m.cardId === 'classic_violet_teacher'
    )!
    expect(teacher.attack).toBe(6)
  })

  it('runs early and late cast listeners for a Secret spell', () => {
    const s = setup()
    summon(s, 'classic_wild_pyromancer')
    const wyrm = summon(s, 'classic_mana_wyrm')
    play(s, 'classic_mirror_entity')
    const p = player(s, activePlayers(s)[0])
    expect(p.secrets).toHaveLength(1)
    expect(p.board[0].health).toBe(1)
    expect(p.board[1].attack).toBe(wyrm.attack + 1)
  })

  it.each(['classic_mirror_entity', 'basic_arcane_intellect'])(
    'counters %s without an after-spell trigger',
    (cardId) => {
      const s = setup()
      summon(s, 'classic_wild_pyromancer')
      counter(s)
      const result = play(s, cardId)
      const [caster, opponent] = activePlayers(s)
      expect(player(s, caster).board[0].health).toBe(2)
      expect(player(s, caster).secrets ?? []).toHaveLength(0)
      expect(player(s, opponent).secrets ?? []).toHaveLength(0)
      expect(
        result.events.filter(
          (e) =>
            e.type === 'effect-resolved' &&
            (e.action === 'damage' || e.action === 'draw')
        )
      ).toHaveLength(0)
    }
  )

  it('copies the buff onto Djinni after the original target', () => {
    const s = setup()
    const djinni = summon(s, 'league_of_explorers_djinni_of_zephyrs')
    const raptor = summon(s, 'basic_bloodfen_raptor')
    const result = play(s, 'basic_blessing_of_kings', [target(s, raptor.instanceId)])
    const buffs = result.events.flatMap((e) =>
      e.type === 'effect-resolved' && e.action === 'modify' ? [e.data?.target] : []
    )
    expect(buffs).toEqual([raptor.instanceId, djinni.instanceId])
  })

  it('does not let a Djinni copy consume Counterspell before the original spell', () => {
    const s = setup()
    summon(s, 'league_of_explorers_djinni_of_zephyrs')
    const raptor = summon(s, 'basic_bloodfen_raptor')
    counter(s)
    const result = play(s, 'basic_blessing_of_kings', [target(s, raptor.instanceId)])
    expect(
      result.events.filter((e) => e.type === 'effect-resolved' && e.action === 'modify')
    ).toHaveLength(0)
    expect(player(s, activePlayers(s)[0]).board[1].attack).toBe(raptor.attack)
  })

  it('copies the full spell once per Djinni without recursive copies', () => {
    const s = setup()
    summon(s, 'league_of_explorers_djinni_of_zephyrs')
    summon(s, 'league_of_explorers_djinni_of_zephyrs')
    const raptor = summon(s, 'basic_bloodfen_raptor')
    const result = play(s, 'basic_power_word_shield', [target(s, raptor.instanceId)])
    expect(result.events.filter((e) => e.type === 'card-drawn')).toHaveLength(3)
  })

  it('keeps early and late cast effects on a Djinni copy', () => {
    const s = setup()
    summon(s, 'classic_wild_pyromancer')
    const wyrm = summon(s, 'classic_mana_wyrm')
    summon(s, 'league_of_explorers_djinni_of_zephyrs')
    const raptor = summon(s, 'basic_bloodfen_raptor')
    const result = play(s, 'basic_blessing_of_kings', [target(s, raptor.instanceId)])
    const p = player(s, activePlayers(s)[0])
    expect(p.board.find((m) => m.instanceId === wyrm.instanceId)?.attack).toBe(
      wyrm.attack + 2
    )
    expect(
      result.events.filter(
        (e) =>
          e.type === 'trigger-activated' &&
          e.source.cardId === 'classic_wild_pyromancer'
      )
    ).toHaveLength(2)
  })

  it('copies Shadowstep after the original target has left the board', () => {
    const s = setup()
    const djinni = summon(s, 'league_of_explorers_djinni_of_zephyrs')
    const raptor = summon(s, 'basic_bloodfen_raptor')
    play(s, 'classic_shadowstep', [target(s, raptor.instanceId)])
    const p = player(s, activePlayers(s)[0])
    expect(p.board).toHaveLength(0)
    expect(p.hand.map((card) => card.instanceId)).toEqual(
      expect.arrayContaining([djinni.instanceId, raptor.instanceId])
    )
  })

  it('checks Djinni target ownership after Mind Control under the original rules', () => {
    const s = setup()
    const [, opponent] = activePlayers(s)
    const djinni = summon(s, 'league_of_explorers_djinni_of_zephyrs')
    const raptor = summon(s, 'basic_bloodfen_raptor', opponent)
    const result = play(s, 'basic_mind_control', [
      { kind: 'minion', participantId: opponent, instanceId: raptor.instanceId }
    ])
    expect(
      result.events.some(
        (e) =>
          e.type === 'trigger-activated' && e.source.instanceId === djinni.instanceId
      )
    ).toBe(true)
  })
})
