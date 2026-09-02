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
  participantId: string
): void {
  const added = scenario.match.dispatch({
    type: 'dev-add-card',
    participantId,
    cardId: asCardId('the_grand_tournament_justicar_trueheart')
  })
  expect(added.accepted).toBe(true)
  const mana = scenario.match.dispatch({
    type: 'dev-set-mana',
    participantId,
    available: 10,
    maximum: 10
  })
  expect(mana.accepted).toBe(true)
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
}

describe('The Grand Tournament', () => {
  it('upgrades a basic Hero Power but leaves Jaraxxus unchanged', () => {
    const basic = createMatchScenario({ firstHeroId: 'jaina' })
    basic.confirmBothMulligans()
    const basicPlayer = basic.match.getState().activePlayerId!
    playJusticar(basic, basicPlayer)
    expect(player(basic, basicPlayer).heroPower.id).toBe('mage-fireblast-rank-2')

    const jaraxxus = createMatchScenario({ firstHeroId: 'jaraxxus' })
    jaraxxus.confirmBothMulligans()
    const jaraxxusPlayer = jaraxxus.match.getState().activePlayerId!
    playJusticar(jaraxxus, jaraxxusPlayer)
    expect(player(jaraxxus, jaraxxusPlayer).heroPower.id).toBe('jaraxxus-inferno')
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
    expect(value.match.dispatch({ type: 'use-hero-power', participantId })).toMatchObject({
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
