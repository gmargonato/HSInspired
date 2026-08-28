import { describe, expect, it } from 'vitest'
import { createMatchScenario } from './testing/match-scenario-builder'

describe('special action parity', () => {
  it('derives Nozdormu turn limits in the domain and accepts only an elapsed timeout', () => {
    const scenario = createMatchScenario({ seed: 1401 })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'classic_nozdormu'
      }).accepted
    ).toBe(true)
    expect(scenario.match.getState().turnLimitSeconds).toBe(15)
    expect(
      scenario.match.dispatch({ type: 'timeout', participantId, elapsedSeconds: 14 })
    ).toMatchObject({ accepted: false, code: 'timeout-unavailable' })
    expect(scenario.match.getState().turnLimitSeconds).toBe(15)
    expect(
      scenario.match.dispatch({ type: 'timeout', participantId, elapsedSeconds: 15 })
        .accepted
    ).toBe(true)
    expect(scenario.match.getState().activePlayerId).not.toBe(participantId)
  })

  it('expires Nozdormu turn limits when its aura source leaves the board', () => {
    const scenario = createMatchScenario({ seed: 1403 })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'classic_nozdormu'
      }).accepted
    ).toBe(true)
    expect(scenario.match.getState().turnLimitSeconds).toBe(15)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'board'
      }).accepted
    ).toBe(true)
    expect(scenario.match.getState().turnLimitSeconds).toBeNull()
    expect(
      scenario.match.dispatch({ type: 'timeout', participantId, elapsedSeconds: 15 })
    ).toMatchObject({ accepted: false, code: 'timeout-unavailable' })
  })

  it('replaces and upgrades Shadowform through the shared hero-power runtime', () => {
    const scenario = createMatchScenario({
      seed: 1404,
      cardId: 'classic_shadowform',
      firstHeroId: 'anduin'
    })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    const opponentId = scenario.participants.find((id) => id !== participantId)!
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const shadowform = scenario.match
      .getState()
      .players.find((player) => player.participantId === participantId)!.hand[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: shadowform.instanceId
      }).accepted
    ).toBe(true)
    expect(
      scenario.match
        .getState()
        .players.find((player) => player.participantId === participantId)?.heroPower
        .effectOverride
    ).toEqual({ damage: 2 })
    const healthBefore = scenario.match
      .getState()
      .players.find((player) => player.participantId === opponentId)!.hero.health
    expect(
      scenario.match.dispatch({
        type: 'use-hero-power',
        participantId,
        target: { kind: 'hero', participantId: opponentId }
      }).accepted
    ).toBe(true)
    expect(
      scenario.match
        .getState()
        .players.find((player) => player.participantId === opponentId)!.hero.health
    ).toBe(healthBefore - 2)
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const upgradedShadowform = scenario.match
      .getState()
      .players.find((player) => player.participantId === participantId)!
      .hand.find((card) => card.cardId === 'classic_shadowform')!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: upgradedShadowform.instanceId
      }).accepted
    ).toBe(true)
    expect(
      scenario.match
        .getState()
        .players.find((player) => player.participantId === participantId)?.heroPower
        .effectOverride
    ).toEqual({ damage: 3 })
  })

  it('equips deterministic random weapons for both participants through Blingtron', () => {
    const run = () => {
      const scenario = createMatchScenario({
        seed: 1402,
        cardId: 'goblins_vs_gnomes_blingtron_3000'
      })
      scenario.confirmBothMulligans()
      const participantId = scenario.match.getState().activePlayerId!
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      const card = scenario.match
        .getState()
        .players.find((player) => player.participantId === participantId)!.hand[0]!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId,
          cardInstanceId: card.instanceId,
          position: 0
        }).accepted
      ).toBe(true)
      return scenario.match
        .getState()
        .players.map((player) => player.weapon?.cardId ?? null)
    }
    const equipped = run()
    expect(equipped.every((weapon) => weapon !== null)).toBe(true)
    expect(run()).toEqual(equipped)
  })
})
