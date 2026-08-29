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
})
