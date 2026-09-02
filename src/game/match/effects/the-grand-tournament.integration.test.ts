import { describe, expect, it } from 'vitest'
import { asCardId } from '../../content/cards'
import { createMatchScenario } from '../testing/match-scenario-builder'

function player(
  scenario: ReturnType<typeof createMatchScenario>,
  participantId: string
) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
}

function playJusticar(
  scenario: ReturnType<typeof createMatchScenario>,
  participantId: string,
  refillMana = true
) {
  const added = scenario.match.dispatch({
    type: 'dev-add-card',
    participantId,
    cardId: asCardId('the_grand_tournament_justicar_trueheart')
  })
  expect(added.accepted).toBe(true)
  if (refillMana) {
    const mana = scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId,
      available: 10,
      maximum: 10
    })
    expect(mana.accepted).toBe(true)
  }
  const card = player(scenario, participantId).hand.find(
    (entry) => entry.cardId === 'the_grand_tournament_justicar_trueheart'
  )!
  const played = scenario.match.dispatch({
    type: 'play-card',
    participantId,
    cardInstanceId: card.instanceId,
    position: player(scenario, participantId).board.length
  })
  expect(played.accepted).toBe(true)
  const after = player(scenario, participantId)
  expect(after.hand.some((entry) => entry.instanceId === card.instanceId)).toBe(false)
  expect(after.board.some((minion) => minion.instanceId === card.instanceId)).toBe(true)
  return played.events
}

describe('The Grand Tournament', () => {
  it('upgrades a basic Hero Power but leaves Jaraxxus unchanged', () => {
    const basic = createMatchScenario({ firstHeroId: 'jaina' })
    basic.confirmBothMulligans()
    const basicPlayer = basic.match.getState().activePlayerId!
    const basicEvents = playJusticar(basic, basicPlayer)
    expect(player(basic, basicPlayer).heroPower.id).toBe('mage-fireblast-rank-2')
    expect(basicEvents).toContainEqual({
      type: 'hero-power-replaced',
      participantId: basicPlayer,
      previousHeroPowerId: 'mage-fireblast',
      heroPowerId: 'mage-fireblast-rank-2'
    })

    const jaraxxus = createMatchScenario({ firstHeroId: 'jaraxxus' })
    jaraxxus.confirmBothMulligans()
    const jaraxxusPlayer = jaraxxus.match.getState().activePlayerId!
    const jaraxxusEvents = playJusticar(jaraxxus, jaraxxusPlayer)
    expect(player(jaraxxus, jaraxxusPlayer).heroPower.id).toBe('jaraxxus-inferno')
    expect(jaraxxusEvents.some((event) => event.type === 'hero-power-replaced')).toBe(
      false
    )
  })

  it('refreshes the upgraded Hero Power after the basic power was used', () => {
    const value = createMatchScenario({ firstHeroId: 'jaina' })
    value.confirmBothMulligans()
    const participantId = value.match.getState().activePlayerId!
    const opponentId = value.participants.find((id) => id !== participantId)!
    expect(
      value.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)

    expect(
      value.match.dispatch({
        type: 'use-hero-power',
        participantId,
        target: { kind: 'hero', participantId: opponentId }
      }).accepted
    ).toBe(true)
    expect(player(value, participantId).heroPower).toMatchObject({
      available: false,
      usesThisTurn: 1
    })

    const events = playJusticar(value, participantId, false)
    expect(player(value, participantId).heroPower).toMatchObject({
      id: 'mage-fireblast-rank-2',
      available: true,
      usesThisTurn: 0
    })
    expect(events.filter((event) => event.type === 'hero-power-replaced')).toHaveLength(
      1
    )

    expect(
      value.match.dispatch({
        type: 'use-hero-power',
        participantId,
        target: { kind: 'hero', participantId: opponentId }
      }).accepted
    ).toBe(true)
    expect(player(value, opponentId).hero.health).toBe(27)
    expect(player(value, participantId).heroPower).toMatchObject({
      available: false,
      usesThisTurn: 1
    })
    expect(value.match.getState().history?.heroPowersUsedByPlayer[participantId]).toBe(
      2
    )
  })

  it('allows the additional Hero Power uses supplied by its board auras', () => {
    const value = createMatchScenario({ firstHeroId: 'garrosh' })
    value.confirmBothMulligans()
    const participantId = value.match.getState().activePlayerId!
    const opponentId = value.participants.find((id) => id !== participantId)!
    expect(
      value.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: asCardId('the_grand_tournament_garrison_commander')
      }).accepted
    ).toBe(true)
    expect(
      value.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)

    expect(
      value.match.dispatch({ type: 'use-hero-power', participantId }).accepted
    ).toBe(true)
    expect(
      value.match.dispatch({ type: 'use-hero-power', participantId }).accepted
    ).toBe(true)
    expect(
      value.match.dispatch({ type: 'use-hero-power', participantId })
    ).toMatchObject({
      accepted: false,
      code: 'hero-power-unavailable'
    })
    expect(player(value, participantId).hero.armor).toBe(4)
    expect(player(value, opponentId).hero.health).toBe(30)
  })

  it('adds Fallen Hero damage to damage-dealing Hero Powers', () => {
    const value = createMatchScenario({ firstHeroId: 'jaina' })
    value.confirmBothMulligans()
    const participantId = value.match.getState().activePlayerId!
    const opponentId = value.participants.find((id) => id !== participantId)!
    expect(
      value.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: asCardId('the_grand_tournament_fallen_hero')
      }).accepted
    ).toBe(true)
    expect(
      value.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      value.match.dispatch({
        type: 'use-hero-power',
        participantId,
        target: { kind: 'hero', participantId: opponentId }
      }).accepted
    ).toBe(true)
    expect(player(value, opponentId).hero.health).toBe(28)
  })
})
