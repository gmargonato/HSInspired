import { describe, expect, it } from 'vitest'
import { canBoardMinionAttack, canHeroAttack, getHeroAttack } from '../opening-match'
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

function summon(scenario: Scenario, participantId: string, cardId: string) {
  const result = scenario.match.dispatch({
    type: 'dev-summon-minion',
    participantId,
    cardId
  })
  expect(result.accepted).toBe(true)
  return player(scenario, participantId).board.at(-1)!
}

function attack(
  scenario: Scenario,
  participantId: string,
  attacker: { kind: 'hero' } | { kind: 'minion'; instanceId: string },
  defender: { kind: 'hero' } | { kind: 'minion'; instanceId: string }
) {
  return scenario.match.dispatch({
    type: 'attack-character',
    participantId,
    attacker,
    defender
  })
}

function beginNextTurn(scenario: Scenario, participantId: string, opponentId: string) {
  expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
    true
  )
  expect(
    scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
  ).toBe(true)
}

describe('combat keyword matrix', () => {
  it('enforces Taunt and Stealth target legality while allowing a Charge attacker immediately', () => {
    const scenario = createMatchScenario({ seed: 1001 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    const attacker = summon(scenario, participantId, 'basic_stonetusk_boar')
    expect(
      canBoardMinionAttack(attacker, scenario.match.getState(), participantId)
    ).toBe(true)
    const taunt = summon(scenario, opponentId, 'basic_goldshire_footman')
    const stealth = summon(scenario, opponentId, 'classic_worgen_infiltrator')

    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'hero' }
      )
    ).toMatchObject({
      accepted: false,
      code: 'invalid-target'
    })
    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'minion', instanceId: stealth.instanceId }
      )
    ).toMatchObject({
      accepted: false,
      code: 'invalid-target'
    })
    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'minion', instanceId: taunt.instanceId }
      ).accepted
    ).toBe(true)
  })

  it('keeps a Frozen armed hero out of attacker legality until Freeze expires', () => {
    const scenario = createMatchScenario({
      seed: 1008,
      cardId: 'classic_ice_lance'
    })
    scenario.confirmBothMulligans()
    const [freezingPlayerId, frozenPlayerId] = activePlayers(scenario)

    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: freezingPlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const iceLance = player(scenario, freezingPlayerId).hand.find(
      (card) => card.cardId === 'classic_ice_lance'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: freezingPlayerId,
        cardInstanceId: iceLance.instanceId,
        targets: [{ kind: 'hero', participantId: frozenPlayerId }]
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: freezingPlayerId
      }).accepted
    ).toBe(true)

    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: frozenPlayerId,
        cardId: 'basic_fiery_war_axe'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: frozenPlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const weapon = player(scenario, frozenPlayerId).hand.find(
      (card) => card.cardId === 'basic_fiery_war_axe'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: frozenPlayerId,
        cardInstanceId: weapon.instanceId
      }).accepted
    ).toBe(true)

    const frozenPlayer = player(scenario, frozenPlayerId)
    const frozenState = scenario.match.getState()
    const heroAttackerId = `${frozenPlayerId}:hero`
    expect(getHeroAttack(frozenPlayer)).toBeGreaterThan(0)
    expect(frozenPlayer.hero.frozenUntilTurn).toBeGreaterThanOrEqual(
      frozenState.turnNumber
    )
    expect(
      scenario.match.getLegality?.(frozenPlayerId).legalAttackTargets[heroAttackerId]
    ).toBeUndefined()
    expect(canHeroAttack(frozenPlayer, frozenState, frozenPlayerId)).toBe(false)
    expect(
      attack(scenario, frozenPlayerId, { kind: 'hero' }, { kind: 'hero' })
    ).toMatchObject({ accepted: false, code: 'hero-cannot-attack' })

    beginNextTurn(scenario, frozenPlayerId, freezingPlayerId)
    const thawedPlayer = player(scenario, frozenPlayerId)
    const thawedState = scenario.match.getState()
    expect(
      scenario.match.getLegality?.(frozenPlayerId).legalAttackTargets[heroAttackerId]
    ).toBeDefined()
    expect(canHeroAttack(thawedPlayer, thawedState, frozenPlayerId)).toBe(true)
  })

  it('lets a hero with Doomhammer attack twice but not a third time', () => {
    const scenario = createMatchScenario({
      seed: 1009,
      cardId: 'classic_doomhammer',
      firstHeroId: 'thrall',
      secondHeroId: 'thrall'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)

    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const doomhammer = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_doomhammer'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: doomhammer.instanceId
      }).accepted
    ).toBe(true)

    const heroAttackerId = `${participantId}:hero`
    expect(player(scenario, participantId).hero.maxAttacksPerTurn).toBe(2)
    expect(
      scenario.match.getLegality?.(participantId).legalAttackTargets[heroAttackerId]
    ).toBeDefined()
    expect(
      attack(scenario, participantId, { kind: 'hero' }, { kind: 'hero' }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).weapon?.durability).toBe(7)
    expect(
      scenario.match.getLegality?.(participantId).legalAttackTargets[heroAttackerId]
    ).toBeDefined()
    expect(
      attack(scenario, participantId, { kind: 'hero' }, { kind: 'hero' }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).weapon?.durability).toBe(6)
    expect(
      scenario.match.getLegality?.(participantId).legalAttackTargets[heroAttackerId]
    ).toBeUndefined()
    expect(
      attack(scenario, participantId, { kind: 'hero' }, { kind: 'hero' })
    ).toMatchObject({
      accepted: false,
      code: 'hero-cannot-attack'
    })
  })

  it('makes Gorehowl spend Attack instead of durability after hitting a minion', () => {
    const scenario = createMatchScenario({
      seed: 1010,
      cardId: 'classic_gorehowl',
      firstHeroId: 'garrosh',
      secondHeroId: 'garrosh'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)

    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const gorehowl = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_gorehowl'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: gorehowl.instanceId
      }).accepted
    ).toBe(true)

    const friendlyAttacker = summon(scenario, participantId, 'basic_stonetusk_boar')
    const defender = summon(scenario, opponentId, 'classic_malygos')
    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: friendlyAttacker.instanceId },
        { kind: 'minion', instanceId: defender.instanceId }
      ).accepted
    ).toBe(true)
    expect(player(scenario, participantId).weapon).toMatchObject({
      attack: 7,
      durability: 1,
      maxDurability: 1
    })

    const result = attack(
      scenario,
      participantId,
      { kind: 'hero' },
      { kind: 'minion', instanceId: defender.instanceId }
    )
    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    const combat = result.events.find(
      (event) => event.type === 'character-combat-resolved'
    )
    expect(combat).toMatchObject({
      attacker: { attack: 7 },
      defender: { healthBefore: 11, healthAfter: 4 },
      weapon: {
        durabilityBefore: 1,
        durabilityAfter: 1,
        destroyed: false
      }
    })
    expect(player(scenario, participantId).weapon).toMatchObject({
      attack: 6,
      durability: 1,
      maxDurability: 1
    })
  })

  it('makes Gorehowl spend durability normally when hitting a hero', () => {
    const scenario = createMatchScenario({
      seed: 1011,
      cardId: 'classic_gorehowl',
      firstHeroId: 'garrosh',
      secondHeroId: 'garrosh'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)

    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const gorehowl = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_gorehowl'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: gorehowl.instanceId
      }).accepted
    ).toBe(true)

    const result = attack(scenario, participantId, { kind: 'hero' }, { kind: 'hero' })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'character-combat-resolved',
        attacker: expect.objectContaining({ attack: 7 }),
        weapon: {
          participantId,
          durabilityBefore: 1,
          durabilityAfter: 0,
          destroyed: true
        }
      })
    )
    expect(player(scenario, opponentId).hero.health).toBe(23)
    expect(player(scenario, participantId).weapon).toBeNull()
  })

  it('consumes Divine Shield before health and permits Windfury but not a third attack', () => {
    const scenario = createMatchScenario({ seed: 1002 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    const attacker = summon(scenario, participantId, 'classic_alakir_the_windlord')
    const defender = summon(scenario, opponentId, 'classic_argent_squire')

    const shieldedAttack = attack(
      scenario,
      participantId,
      { kind: 'minion', instanceId: attacker.instanceId },
      { kind: 'minion', instanceId: defender.instanceId }
    )
    expect(shieldedAttack.accepted).toBe(true)
    if (!shieldedAttack.accepted) return
    const shieldedResult = shieldedAttack.events.find(
      (event) =>
        event.type === 'minion-combat-resolved' ||
        event.type === 'character-combat-resolved'
    )
    expect(shieldedResult?.defender).toMatchObject({
      attemptedDamage: 3,
      divineShieldConsumed: true,
      healthBefore: 1,
      healthAfter: 1
    })
    expect(player(scenario, opponentId).board[0]).toMatchObject({
      health: 1,
      divineShield: false
    })
    const overkillAttack = attack(
      scenario,
      participantId,
      { kind: 'minion', instanceId: attacker.instanceId },
      { kind: 'minion', instanceId: defender.instanceId }
    )
    expect(overkillAttack.accepted).toBe(true)
    if (!overkillAttack.accepted) return
    const overkillResult = overkillAttack.events.find(
      (event) =>
        event.type === 'minion-combat-resolved' ||
        event.type === 'character-combat-resolved'
    )
    expect(overkillResult?.defender).toMatchObject({
      attemptedDamage: 3,
      healthBefore: 1,
      healthAfter: 0
    })
    expect(player(scenario, opponentId).board).toHaveLength(0)
    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'hero' }
      )
    ).toMatchObject({
      accepted: false,
      code: 'minion-cannot-attack'
    })
  })

  it('rejects Cannot Attack and breaks a weapon exactly once', () => {
    const scenario = createMatchScenario({
      seed: 1003,
      firstHeroId: 'thrall',
      cardId: 'basic_wicked_knife'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    const watcher = summon(scenario, participantId, 'classic_ancient_watcher')
    beginNextTurn(scenario, participantId, opponentId)
    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: watcher.instanceId },
        { kind: 'hero' }
      )
    ).toMatchObject({
      accepted: false,
      code: 'minion-cannot-attack'
    })

    const weapon = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'basic_wicked_knife'
    )!
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
        type: 'play-card',
        participantId,
        cardInstanceId: weapon.instanceId
      }).accepted
    ).toBe(true)
    expect(
      attack(scenario, participantId, { kind: 'hero' }, { kind: 'hero' }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).weapon).toMatchObject({ durability: 1 })
    beginNextTurn(scenario, participantId, opponentId)
    expect(
      attack(scenario, participantId, { kind: 'hero' }, { kind: 'hero' }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).weapon).toBeNull()
  })

  it('blocks spell targets protected by Spell Immune and thaws Freeze after its missed attack', () => {
    const spellScenario = createMatchScenario({
      seed: 1005,
      cardId: 'basic_arcane_shot'
    })
    spellScenario.confirmBothMulligans()
    const [spellPlayerId, spellOpponentId] = activePlayers(spellScenario)
    const spellImmune = summon(spellScenario, spellOpponentId, 'classic_faerie_dragon')
    expect(
      spellScenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: spellPlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const arcaneShot = player(spellScenario, spellPlayerId).hand[0]!
    expect(
      spellScenario.match.dispatch({
        type: 'play-card',
        participantId: spellPlayerId,
        cardInstanceId: arcaneShot.instanceId,
        targets: [
          {
            kind: 'minion',
            participantId: spellOpponentId,
            instanceId: spellImmune.instanceId
          }
        ]
      })
    ).toMatchObject({ accepted: false, code: 'immune-target' })

    const freezeScenario = createMatchScenario({
      seed: 1006,
      cardId: 'basic_frost_nova'
    })
    freezeScenario.confirmBothMulligans()
    const [freezingPlayerId, frozenPlayerId] = activePlayers(freezeScenario)
    const frozen = summon(freezeScenario, frozenPlayerId, 'basic_stonetusk_boar')
    expect(
      freezeScenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: freezingPlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const frostNova = player(freezeScenario, freezingPlayerId).hand[0]!
    expect(
      freezeScenario.match.dispatch({
        type: 'play-card',
        participantId: freezingPlayerId,
        cardInstanceId: frostNova.instanceId
      }).accepted
    ).toBe(true)
    expect(
      freezeScenario.match.dispatch({
        type: 'end-turn',
        participantId: freezingPlayerId
      }).accepted
    ).toBe(true)
    expect(
      attack(
        freezeScenario,
        frozenPlayerId,
        { kind: 'minion', instanceId: frozen.instanceId },
        { kind: 'hero' }
      )
    ).toMatchObject({
      accepted: false,
      code: 'minion-cannot-attack'
    })
    expect(
      freezeScenario.match.dispatch({ type: 'end-turn', participantId: frozenPlayerId })
        .accepted
    ).toBe(true)
    expect(
      freezeScenario.match.dispatch({
        type: 'end-turn',
        participantId: freezingPlayerId
      }).accepted
    ).toBe(true)
    expect(
      attack(
        freezeScenario,
        frozenPlayerId,
        { kind: 'minion', instanceId: frozen.instanceId },
        { kind: 'hero' }
      ).accepted
    ).toBe(true)
  })

  it('allows Mega-Windfury exactly four attacks in a turn', () => {
    const scenario = createMatchScenario({ seed: 1007 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    const attacker = summon(scenario, participantId, 'goblins_vs_gnomes_v_07_tr_0n')
    beginNextTurn(scenario, participantId, opponentId)
    for (let index = 0; index < 4; index += 1)
      expect(
        attack(
          scenario,
          participantId,
          { kind: 'minion', instanceId: attacker.instanceId },
          { kind: 'hero' }
        ).accepted
      ).toBe(true)
    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'hero' }
      )
    ).toMatchObject({
      accepted: false,
      code: 'minion-cannot-attack'
    })
  })

  it('replays wrong-enemy redirection identically with seeded RNG', () => {
    const run = () => {
      const scenario = createMatchScenario({ seed: 1004 })
      scenario.confirmBothMulligans()
      const [participantId, opponentId] = activePlayers(scenario)
      const attacker = summon(scenario, participantId, 'goblins_vs_gnomes_ogre_brute')
      const first = summon(scenario, opponentId, 'basic_goldshire_footman')
      summon(scenario, opponentId, 'basic_frostwolf_grunt')
      beginNextTurn(scenario, participantId, opponentId)
      const result = attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'minion', instanceId: first.instanceId }
      )
      expect(result.accepted).toBe(true)
      return {
        state: scenario.match.getState(),
        events: result.events,
        rng: scenario.rng.snapshot()
      }
    }
    expect(run()).toEqual(run())
  })
})
