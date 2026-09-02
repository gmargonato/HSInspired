import { describe, expect, it } from 'vitest'
import { createMatchScenario } from '../testing/match-scenario-builder'

type Scenario = ReturnType<typeof createMatchScenario>

function activePlayers(scenario: Scenario) {
  const active = scenario.match.getState().activePlayerId!
  return [
    active,
    scenario.participants.find((participantId) => participantId !== active)!
  ] as const
}

function player(scenario: Scenario, participantId: string) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
}

function addCard(scenario: Scenario, participantId: string, cardId: string): void {
  expect(
    scenario.match.dispatch({
      type: 'dev-add-card',
      participantId,
      cardId
    }).accepted
  ).toBe(true)
}

function setMana(scenario: Scenario, participantId: string): void {
  expect(
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId,
      available: 10,
      maximum: 10
    }).accepted
  ).toBe(true)
}

function summon(
  scenario: Scenario,
  participantId: string,
  cardId: string,
  position?: number
): void {
  expect(
    scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId,
      cardId,
      ...(position === undefined ? {} : { position })
    }).accepted
  ).toBe(true)
}

function play(
  scenario: Scenario,
  participantId: string,
  cardId: string,
  targets: readonly { kind: 'minion'; participantId: string; instanceId: string }[]
) {
  const card = player(scenario, participantId).hand.find(
    (candidate) => candidate.cardId === cardId
  )
  expect(card).toBeDefined()
  return scenario.match.dispatch({
    type: 'play-card',
    participantId,
    cardInstanceId: card!.instanceId,
    targets
  })
}

describe('resolution presentation events', () => {
  it('reports Healing Totem full values for undamaged friendly minions', () => {
    const scenario = createMatchScenario({ seed: 1698 })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)
    summon(scenario, participantId, 'basic_healing_totem')
    summon(scenario, participantId, 'basic_boulderfist_ogre')
    const friendlyIds = new Set(
      player(scenario, participantId).board.map((minion) => minion.instanceId)
    )

    const result = scenario.match.dispatch({ type: 'end-turn', participantId })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const restores = result.events.filter(
      (event) =>
        event.type === 'effect-resolved' &&
        event.action === 'restore' &&
        event.sourceCardId === 'basic_healing_totem' &&
        typeof event.data?.target === 'string' &&
        friendlyIds.has(event.data.target)
    )
    expect(restores).toHaveLength(2)
    expect(restores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ amount: 0, displayAmount: 1 })
        }),
        expect.objectContaining({
          data: expect.objectContaining({ amount: 0, displayAmount: 1 })
        })
      ])
    )
  })

  it.each(['classic_molten_giant', 'classic_mountain_giant'])(
    'does not activate %s hand-only cost effect from the board',
    (cardId) => {
      const scenario = createMatchScenario({ seed: 1699 })
      scenario.confirmBothMulligans()
      const [participantId] = activePlayers(scenario)

      const result = scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId
      })

      expect(result.accepted).toBe(true)
      if (!result.accepted) return
      const giant = player(scenario, participantId).board[0]!
      expect(
        result.events.filter(
          (event) =>
            event.type === 'trigger-activated' &&
            event.source.instanceId === giant.instanceId
        )
      ).toHaveLength(0)
    }
  )

  it('emits one trigger cue for every actual Acolyte damage trigger', () => {
    const scenario = createMatchScenario({ seed: 1700 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    summon(scenario, opponentId, 'classic_acolyte_of_pain')
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'basic_fireball')

    const acolyte = player(scenario, opponentId).board[0]!
    const result = play(scenario, participantId, 'basic_fireball', [
      { kind: 'minion', participantId: opponentId, instanceId: acolyte.instanceId }
    ])
    expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
    if (!result.accepted) return

    const cues = result.events.filter(
      (event) =>
        event.type === 'trigger-activated' &&
        event.source.instanceId === acolyte.instanceId
    )
    expect(cues).toHaveLength(1)
    expect(cues[0]).toMatchObject({
      trigger: 'on-damage',
      eventType: 'damage-dealt',
      parentActivationId: null
    })
    const cueIndex = result.events.indexOf(cues[0]!)
    const drawIndex = result.events.findIndex(
      (event, index) => index > cueIndex && event.type === 'card-drawn'
    )
    expect(drawIndex).toBeGreaterThan(cueIndex)
    expect(
      result.events.find(
        (event) =>
          event.type === 'effect-resolved' &&
          event.action === 'damage' &&
          event.data?.target === acolyte.instanceId
      )
    ).toMatchObject({
      data: { actualDamage: 3, displayAmount: 6, healthAfter: 0 }
    })
  })

  it('exposes Frothing attack modifications after each damaged minion', () => {
    const scenario = createMatchScenario({ seed: 1701 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    summon(scenario, participantId, 'classic_frothing_berserker')
    summon(scenario, opponentId, 'basic_acidic_swamp_ooze')
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'basic_fireball')

    const target = player(scenario, opponentId).board[0]!
    const result = play(scenario, participantId, 'basic_fireball', [
      { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
    ])
    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    const frothing = player(scenario, participantId).board[0]!
    expect(frothing.attack).toBe(3)
    const cueIndex = result.events.findIndex(
      (event) =>
        event.type === 'trigger-activated' &&
        event.source.instanceId === frothing.instanceId
    )
    expect(cueIndex).toBeGreaterThanOrEqual(0)
    const modify = result.events.find(
      (event, index) =>
        index > cueIndex &&
        event.type === 'effect-resolved' &&
        event.action === 'modify' &&
        event.data?.target === frothing.instanceId
    )
    expect(modify).toMatchObject({
      type: 'effect-resolved',
      action: 'modify',
      data: { attackBefore: 2, attackAfter: 3 }
    })
  })

  it('starts combat before damage effects so reactive chains can be presented in order', () => {
    const scenario = createMatchScenario({ seed: 1703 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    summon(scenario, participantId, 'classic_acolyte_of_pain')
    summon(scenario, opponentId, 'basic_acidic_swamp_ooze')
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    const attacker = player(scenario, opponentId).board[0]!
    const defender = player(scenario, participantId).board[0]!
    const result = scenario.match.dispatch({
      type: 'attack-character',
      participantId: opponentId,
      attacker: { kind: 'minion', instanceId: attacker.instanceId },
      defender: { kind: 'minion', instanceId: defender.instanceId }
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const startIndex = result.events.findIndex(
      (event) => event.type === 'combat-started'
    )
    const damageIndex = result.events.findIndex(
      (event) => event.type === 'effect-resolved' && event.action === 'damage'
    )
    const resolvedIndex = result.events.findIndex(
      (event) =>
        event.type === 'minion-combat-resolved' ||
        event.type === 'character-combat-resolved'
    )
    expect(startIndex).toBeGreaterThanOrEqual(0)
    expect(damageIndex).toBeGreaterThan(startIndex)
    expect(resolvedIndex).toBeGreaterThan(damageIndex)
  })

  it('brackets simultaneous deaths and repeated Deathrattle activations', () => {
    const scenario = createMatchScenario({ seed: 1702 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    summon(scenario, participantId, 'classic_abomination')
    summon(scenario, participantId, 'naxxramas_baron_rivendare')
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    setMana(scenario, opponentId)
    addCard(scenario, opponentId, 'basic_assassinate')

    const abomination = player(scenario, participantId).board.find(
      (minion) => minion.cardId === 'classic_abomination'
    )!
    const result = play(scenario, opponentId, 'basic_assassinate', [
      { kind: 'minion', participantId, instanceId: abomination.instanceId }
    ])
    expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
    if (!result.accepted) return

    const started = result.events.find((event) => event.type === 'death-batch-started')
    const completed = result.events.find(
      (event) => event.type === 'death-batch-completed'
    )
    expect(started).toBeDefined()
    expect(completed).toBeDefined()
    if (!started || !completed) return
    expect(started.deaths.map((death) => death.instanceId)).toContain(
      abomination.instanceId
    )
    const activations = result.events.filter(
      (event) =>
        event.type === 'trigger-activated' &&
        event.source.instanceId === abomination.instanceId &&
        event.trigger === 'deathrattle'
    )
    expect(activations).toHaveLength(2)
    expect(result.events.indexOf(started)).toBeLessThan(
      result.events.indexOf(activations[0]!)
    )
    expect(result.events.indexOf(activations[1]!)).toBeLessThan(
      result.events.indexOf(completed)
    )
  })

  it('emits paced activation cues for live Deathrattles', () => {
    const scenario = createMatchScenario({
      seed: 1704,
      cardId: 'goblins_vs_gnomes_feign_death',
      firstHeroId: 'rexxar'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    summon(scenario, participantId, 'classic_leper_gnome')
    setMana(scenario, participantId)

    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'goblins_vs_gnomes_feign_death'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId
    })
    expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
    if (!result.accepted) return

    const leper = player(scenario, participantId).board[0]!
    const activationIndex = result.events.findIndex(
      (event) =>
        event.type === 'trigger-activated' &&
        event.source.instanceId === leper.instanceId &&
        event.trigger === 'deathrattle'
    )
    expect(activationIndex).toBeGreaterThanOrEqual(0)
    expect(
      result.events.findIndex(
        (event, index) =>
          index > activationIndex &&
          event.type === 'effect-resolved' &&
          event.action === 'damage' &&
          event.data?.target === `${opponentId}:hero`
      )
    ).toBeGreaterThan(activationIndex)
  })
})
