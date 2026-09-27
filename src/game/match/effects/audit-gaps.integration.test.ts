import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, asCardId } from '../../content/cards'
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

function ready(options: Parameters<typeof createMatchScenario>[0] = {}) {
  const scenario = createMatchScenario(options)
  scenario.confirmBothMulligans()
  return scenario
}

function addCard(scenario: Scenario, participantId: string, cardId: string): void {
  const result = scenario.match.dispatch({
    type: 'dev-add-card',
    participantId,
    cardId: asCardId(cardId)
  })
  if (!result.accepted) throw new Error(result.message)
}

function setMana(
  scenario: Scenario,
  participantId: string,
  available = 10,
  maximum = 10
): void {
  const result = scenario.match.dispatch({
    type: 'dev-set-mana',
    participantId,
    available,
    maximum
  })
  if (!result.accepted) throw new Error(result.message)
}

function summon(scenario: Scenario, participantId: string, cardId: string) {
  const result = scenario.match.dispatch({
    type: 'dev-summon-minion',
    participantId,
    cardId: asCardId(cardId)
  })
  if (!result.accepted) throw new Error(result.message)
  return player(scenario, participantId).board.at(-1)!
}

function targetOf(participantId: string, instanceId: string) {
  return { kind: 'minion' as const, participantId, instanceId }
}

function play(
  scenario: Scenario,
  participantId: string,
  cardId: string,
  extra: Record<string, unknown> = {}
) {
  const card = player(scenario, participantId).hand.find(
    (candidate) => candidate.cardId === cardId
  )
  expect(card).toBeDefined()
  const definition = CARD_CATALOG.require(card!.cardId)
  const result = scenario.match.dispatch({
    type: 'play-card',
    participantId,
    cardInstanceId: card!.instanceId,
    ...(definition.type === 'Minion' && extra.position === undefined
      ? { position: player(scenario, participantId).board.length }
      : {}),
    ...extra
  })
  if (!result.accepted) throw new Error(result.message)
  return result
}

function endTurn(scenario: Scenario, participantId: string): void {
  const result = scenario.match.dispatch({ type: 'end-turn', participantId })
  if (!result.accepted) throw new Error(result.message)
}

function cycleTurn(scenario: Scenario, participantId: string, opponentId: string) {
  endTurn(scenario, participantId)
  endTurn(scenario, opponentId)
}

describe('Catalog gap remediation', () => {
  it('DOOM! destroys all minions and draws one card for each', () => {
    const scenario = ready()
    const [own, enemy] = activePlayers(scenario)
    summon(scenario, own, 'basic_chillwind_yeti')
    summon(scenario, own, 'basic_boulderfist_ogre')
    summon(scenario, enemy, 'basic_kobold_geomancer')
    addCard(scenario, own, 'whispers_of_the_old_gods_doom')
    setMana(scenario, own)
    const handBefore = player(scenario, own).hand.length
    play(scenario, own, 'whispers_of_the_old_gods_doom')
    expect(player(scenario, own).board).toHaveLength(0)
    expect(player(scenario, enemy).board).toHaveLength(0)
    expect(player(scenario, own).hand).toHaveLength(handBefore - 1 + 3)
  })

  it.each([
    [0.4, true],
    [0.9, false]
  ])(
    'Nat, the Darkfisher draws an extra card for the opponent (roll %s)',
    (roll, expectDraw) => {
      const scenario = ready()
      const [own, enemy] = activePlayers(scenario)
      addCard(scenario, own, 'whispers_of_the_old_gods_nat_the_darkfisher')
      setMana(scenario, own)
      play(scenario, own, 'whispers_of_the_old_gods_nat_the_darkfisher')
      const enemyHandBefore = player(scenario, enemy).hand.length
      scenario.rng.next = () => roll
      endTurn(scenario, own)
      expect(player(scenario, enemy).hand.length - enemyHandBefore).toBe(
        expectDraw ? 2 : 1
      )
    }
  )

  it('Shifter Zerus transforms in hand at the start of its controller turn only', () => {
    const scenario = ready()
    const [own, enemy] = activePlayers(scenario)
    addCard(scenario, own, 'whispers_of_the_old_gods_shifter_zerus')
    const zerus = player(scenario, own).hand.find(
      (candidate) => candidate.cardId === 'whispers_of_the_old_gods_shifter_zerus'
    )!
    endTurn(scenario, own)
    expect(
      player(scenario, own).hand.find(
        (candidate) => candidate.instanceId === zerus.instanceId
      )!.cardId
    ).toBe('whispers_of_the_old_gods_shifter_zerus')
    cycleTurn(scenario, enemy, own)
    const transformed = player(scenario, own).hand.find(
      (candidate) => candidate.instanceId === zerus.instanceId
    )!
    expect(transformed.cardId).not.toBe('whispers_of_the_old_gods_shifter_zerus')
    const definition = CARD_CATALOG.require(transformed.cardId)
    expect(definition.type).toBe('Minion')
    expect(transformed.currentCost).toBe(definition.cost)
  })

  it('Nerubian Prophet reduces its own cost each turn while in hand', () => {
    const scenario = ready()
    const [own, enemy] = activePlayers(scenario)
    addCard(scenario, own, 'whispers_of_the_old_gods_nerubian_prophet')
    const prophet = () =>
      player(scenario, own).hand.find(
        (candidate) => candidate.cardId === 'whispers_of_the_old_gods_nerubian_prophet'
      )!
    expect(prophet().currentCost).toBe(6)
    cycleTurn(scenario, own, enemy)
    expect(prophet().currentCost).toBe(5)
    cycleTurn(scenario, own, enemy)
    expect(prophet().currentCost).toBe(4)
  })

  it('A Light in the Darkness discovers a minion and gives it +1/+1', () => {
    const scenario = ready({ firstHeroId: 'uther' })
    const [own] = activePlayers(scenario)
    setMana(scenario, own)
    addCard(scenario, own, 'whispers_of_the_old_gods_a_light_in_the_darkness')
    play(scenario, own, 'whispers_of_the_old_gods_a_light_in_the_darkness')
    const pending = scenario.match.getState().pendingDiscover
    expect(pending?.candidates).toHaveLength(3)
    expect(
      pending!.candidates.every(
        (candidate) => CARD_CATALOG.require(candidate.cardId).type === 'Minion'
      )
    ).toBe(true)
    const chosen = pending!.candidates[0]!
    const definition = CARD_CATALOG.require(chosen.cardId)
    if (definition.type !== 'Minion') throw new Error('Expected a minion.')
    const result = scenario.match.dispatch({
      type: 'choose-discover-card',
      participantId: own,
      cardInstanceId: chosen.instanceId
    })
    expect(result.accepted).toBe(true)
    const added = player(scenario, own).hand.find(
      (candidate) => candidate.cardId === chosen.cardId
    )!
    expect(added).toBeDefined()
    expect(added.attack).toBe(definition.attack + 1)
    expect(added.health).toBe(definition.health + 1)
  })

  it('Blood of The Ancient One merges two copies into The Ancient One', () => {
    const scenario = ready()
    const [own, enemy] = activePlayers(scenario)
    summon(scenario, own, 'whispers_of_the_old_gods_blood_of_the_ancient_one')
    summon(scenario, own, 'whispers_of_the_old_gods_blood_of_the_ancient_one')
    summon(scenario, enemy, 'basic_chillwind_yeti')
    endTurn(scenario, own)
    const board = player(scenario, own).board
    expect(board).toHaveLength(1)
    expect(board[0]!.cardId).toBe('whispers_of_the_old_gods_the_ancient_one')
    expect(board[0]!.attack).toBe(30)
    expect(board[0]!.health).toBe(30)
    expect(player(scenario, enemy).board).toHaveLength(1)
  })

  it('Bomb Squad deals 5 damage to the enemy minion and to its own hero on death', () => {
    const scenario = ready()
    const [own, enemy] = activePlayers(scenario)
    const victim = summon(scenario, enemy, 'basic_boulderfist_ogre')
    addCard(scenario, own, 'mean_streets_of_gadgetzan_bomb_squad')
    setMana(scenario, own)
    play(scenario, own, 'mean_streets_of_gadgetzan_bomb_squad', {
      targets: [targetOf(enemy, victim.instanceId)]
    })
    expect(player(scenario, enemy).board[0]!.health).toBe(2)
    const bomb = player(scenario, own).board.find(
      (candidate) => candidate.cardId === 'mean_streets_of_gadgetzan_bomb_squad'
    )!
    addCard(scenario, own, 'basic_fireball')
    play(scenario, own, 'basic_fireball', {
      targets: [targetOf(own, bomb.instanceId)]
    })
    const heroHealthBefore = 30
    expect(player(scenario, own).hero.health).toBe(heroHealthBefore - 5)
    expect(
      player(scenario, own).board.some(
        (candidate) => candidate.cardId === 'mean_streets_of_gadgetzan_bomb_squad'
      )
    ).toBe(false)
  })

  it('Twin Emperor Veknilash summons Veklor only with a 10-Attack Cthun', () => {
    const buffed = ready()
    const [own, enemy] = activePlayers(buffed)
    const victim = summon(buffed, enemy, 'basic_chillwind_yeti')
    const secondVictim = summon(buffed, enemy, 'basic_boulderfist_ogre')
    addCard(buffed, own, 'whispers_of_the_old_gods_cthun')
    addCard(buffed, own, 'whispers_of_the_old_gods_disciple_of_cthun')
    addCard(buffed, own, 'whispers_of_the_old_gods_disciple_of_cthun')
    setMana(buffed, own)
    play(buffed, own, 'whispers_of_the_old_gods_disciple_of_cthun', {
      targets: [targetOf(enemy, victim.instanceId)]
    })
    play(buffed, own, 'whispers_of_the_old_gods_disciple_of_cthun', {
      targets: [targetOf(enemy, secondVictim.instanceId)]
    })
    expect(player(buffed, own).cthun?.attack).toBe(4)
    addCard(buffed, own, 'whispers_of_the_old_gods_twin_emperor_veknilash')
    setMana(buffed, own)
    play(buffed, own, 'whispers_of_the_old_gods_twin_emperor_veknilash')
    expect(
      player(buffed, own).board.some(
        (candidate) =>
          candidate.cardId === 'whispers_of_the_old_gods_twin_emperor_veklor'
      )
    ).toBe(true)

    const weak = ready({ seed: 0x4e2b })
    const [weakOwn] = activePlayers(weak)
    addCard(weak, weakOwn, 'whispers_of_the_old_gods_twin_emperor_veknilash')
    setMana(weak, weakOwn)
    play(weak, weakOwn, 'whispers_of_the_old_gods_twin_emperor_veknilash')
    expect(
      player(weak, weakOwn).board.some(
        (candidate) =>
          candidate.cardId === 'whispers_of_the_old_gods_twin_emperor_veklor'
      )
    ).toBe(false)
  })

  it('Madam Goya swaps the chosen minion with a minion from the deck', () => {
    const scenario = ready()
    const [own] = activePlayers(scenario)
    const chosen = summon(scenario, own, 'basic_chillwind_yeti')
    addCard(scenario, own, 'mean_streets_of_gadgetzan_madam_goya')
    setMana(scenario, own)
    const deckBefore = player(scenario, own).deck.length
    play(scenario, own, 'mean_streets_of_gadgetzan_madam_goya', {
      targets: [targetOf(own, chosen.instanceId)]
    })
    const board = player(scenario, own).board
    expect(
      board.some((candidate) => candidate.cardId === 'basic_acidic_swamp_ooze')
    ).toBe(true)
    expect(board.some((candidate) => candidate.instanceId === chosen.instanceId)).toBe(
      false
    )
    expect(
      player(scenario, own).deck.some(
        (candidate) => candidate.cardId === 'basic_chillwind_yeti'
      )
    ).toBe(true)
    expect(player(scenario, own).deck).toHaveLength(deckBefore)
  })

  it('Moat Lurker resummons its destroyed victim on the side it was destroyed on', () => {
    const scenario = ready()
    const [own, enemy] = activePlayers(scenario)
    const victim = summon(scenario, enemy, 'basic_chillwind_yeti')
    addCard(scenario, own, 'one_night_in_karazhan_moat_lurker')
    setMana(scenario, own)
    play(scenario, own, 'one_night_in_karazhan_moat_lurker', {
      targets: [targetOf(enemy, victim.instanceId)]
    })
    expect(player(scenario, enemy).board).toHaveLength(0)
    const lurker = player(scenario, own).board.find(
      (candidate) => candidate.cardId === 'one_night_in_karazhan_moat_lurker'
    )!
    expect(lurker).toBeDefined()
    addCard(scenario, own, 'basic_fireball')
    play(scenario, own, 'basic_fireball', {
      targets: [targetOf(own, lurker.instanceId)]
    })
    expect(
      player(scenario, own).board.some(
        (candidate) => candidate.cardId === 'basic_chillwind_yeti'
      )
    ).toBe(false)
    const resummoned = player(scenario, enemy).board[0]!
    expect(resummoned.cardId).toBe('basic_chillwind_yeti')
    expect(resummoned.instanceId).not.toBe(victim.instanceId)
    expect(resummoned.attack).toBe(4)
    expect(resummoned.health).toBe(5)
  })
})
