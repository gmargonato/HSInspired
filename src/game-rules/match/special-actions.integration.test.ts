import { describe, expect, it } from 'vitest'
import { HERO_POWER_CATALOG } from '../content/hero-powers'
import { createMatchScenario } from './testing/match-scenario-builder'

describe('special action parity', () => {
  it('restores the hero and refreshes mana when Nozdormu is played', () => {
    const scenario = createMatchScenario({ seed: 1401 })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
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
        cardId: 'classic_nozdormu'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'dev-set-hero', participantId, health: 15 })
        .accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const nozdormu = scenario.match
      .getState()
      .players.find((player) => player.participantId === participantId)!.hand[0]!
    const playResult = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: nozdormu.instanceId,
      position: 0
    })
    expect(playResult.accepted).toBe(true)
    const player = scenario.match
      .getState()
      .players.find((candidate) => candidate.participantId === participantId)!
    expect(player.hero.health).toBe(30)
    expect(player.mana).toMatchObject({ available: 10, maximum: 10 })
    expect(scenario.match.getState().turnLimitSeconds).toBeNull()
  })

  it.each(['jaina', 'anduin', 'garrosh'])(
    'replaces and upgrades Shadowform for %s',
    (heroId) => {
      const scenario = createMatchScenario({
        seed: 1404,
        cardId: 'classic_shadowform',
        firstHeroId: heroId,
        secondHeroId: heroId
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
      ).toMatchObject({
        id: 'priest-mind-spike',
        cost: 2,
        targetingGranted: 'any-character'
      })
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
      expect(
        scenario.match.dispatch({ type: 'end-turn', participantId }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({ type: 'end-turn', participantId: opponentId })
          .accepted
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
      ).toMatchObject({ id: 'priest-mind-shatter', cost: 2 })
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
      ).toBe(healthBefore - 5)

      // Repeated casts must retain Mind Shatter, and replacing a used power refreshes it.
      const thirdShadowform = scenario.match
        .getState()
        .players.find((player) => player.participantId === participantId)!
        .hand.find((card) => card.cardId === 'classic_shadowform')!
      const thirdCast = scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: thirdShadowform.instanceId
      })
      expect(thirdCast.accepted).toBe(true)
      expect(thirdCast.events).toContainEqual(
        expect.objectContaining({
          type: 'hero-power-replaced',
          participantId,
          previousHeroPowerId: 'priest-mind-shatter',
          heroPowerId: 'priest-mind-shatter',
          sourceCardId: 'classic_shadowform'
        })
      )
      expect(
        scenario.match
          .getState()
          .players.find((player) => player.participantId === participantId)!.heroPower
      ).toMatchObject({
        id: 'priest-mind-shatter',
        available: true,
        usesThisTurn: 0
      })
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: opponentId,
          cardId: 'basic_chillwind_yeti'
        }).accepted
      ).toBe(true)
      const target = scenario.match
        .getState()
        .players.find((player) => player.participantId === opponentId)!.board[0]!
      expect(
        scenario.match.dispatch({
          type: 'use-hero-power',
          participantId,
          target: {
            kind: 'minion',
            participantId: opponentId,
            instanceId: target.instanceId
          }
        }).accepted
      ).toBe(true)
      expect(
        scenario.match
          .getState()
          .players.find((player) => player.participantId === opponentId)!.board[0]!
          .health
      ).toBe(target.health - 3)
      for (const [id, name, damage] of [
        ['priest-mind-spike', 'Mind Spike', 2],
        ['priest-mind-shatter', 'Mind Shatter', 3]
      ] as const) {
        expect(HERO_POWER_CATALOG.require(id)).toMatchObject({
          displayName: name,
          rulesText: `Deal ${damage} damage.`,
          targeting: 'any-character'
        })
      }
    }
  )

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
