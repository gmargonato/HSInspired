import { describe, expect, it } from 'vitest'
import { canBoardMinionAttack } from '../opening-match'
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

  it('consumes Divine Shield before health and permits Windfury but not a third attack', () => {
    const scenario = createMatchScenario({ seed: 1002 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    const attacker = summon(scenario, participantId, 'classic_alakir_the_windlord')
    const defender = summon(scenario, opponentId, 'classic_argent_squire')

    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'minion', instanceId: defender.instanceId }
      ).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).board[0]).toMatchObject({
      health: 1,
      divineShield: false
    })
    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'minion', instanceId: defender.instanceId }
      ).accepted
    ).toBe(true)
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
