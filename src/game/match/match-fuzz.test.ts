import { describe, expect, it } from 'vitest'
import { assertOpeningMatchInvariants } from './rules/invariants'
import { createMatchScenario } from './testing/match-scenario-builder'

describe('bounded command rejection fuzz', () => {
  it('preserves seeded state, RNG, and invariants for malformed commands', () => {
    for (let seed = 0; seed < 32; seed += 1) {
      const scenario = createMatchScenario({ seed })
      scenario.confirmBothMulligans()
      const participantId = scenario.match.getState().activePlayerId!
      const before = scenario.match.getState()
      const rngBefore = scenario.rng.snapshot()
      const commands: readonly unknown[] = [
        null,
        {},
        { type: 'play-card', participantId, cardInstanceId: 'missing-card' },
        {
          type: 'attack-character',
          participantId,
          attacker: { kind: 'minion', instanceId: 'missing-minion' },
          defender: { kind: 'hero' }
        },
        { type: 'end-turn', participantId: 'missing-player' }
      ]
      for (const command of commands) {
        const result = scenario.match.dispatch(command)
        expect(result.accepted).toBe(false)
        expect(scenario.match.getState()).toEqual(before)
        expect(scenario.rng.snapshot()).toEqual(rngBefore)
        expect(() =>
          assertOpeningMatchInvariants(scenario.match.getState())
        ).not.toThrow()
      }
    }
  })

  it('preserves invariants across seeded random pools, transforms, control changes, and death chains', () => {
    for (let seed = 0; seed < 16; seed += 1) {
      const randomEquip = createMatchScenario({
        seed,
        cardId: 'goblins_vs_gnomes_blingtron_3000'
      })
      randomEquip.confirmBothMulligans()
      const randomPlayerId = randomEquip.match.getState().activePlayerId!
      expect(
        randomEquip.match.dispatch({
          type: 'dev-set-mana',
          participantId: randomPlayerId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      const blingtron = randomEquip.match
        .getState()
        .players.find((player) => player.participantId === randomPlayerId)!.hand[0]!
      expect(
        randomEquip.match.dispatch({
          type: 'play-card',
          participantId: randomPlayerId,
          cardInstanceId: blingtron.instanceId,
          position: 0
        }).accepted
      ).toBe(true)
      expect(
        randomEquip.match.getState().players.every((player) => player.weapon !== null)
      ).toBe(true)
      expect(() =>
        assertOpeningMatchInvariants(randomEquip.match.getState())
      ).not.toThrow()

      const transformControl = createMatchScenario({
        seed,
        cardId: 'basic_polymorph'
      })
      transformControl.confirmBothMulligans()
      const playerId = transformControl.match.getState().activePlayerId!
      const opponentId = transformControl.participants.find((id) => id !== playerId)!
      for (const participantId of [playerId, opponentId]) {
        expect(
          transformControl.match.dispatch({
            type: 'dev-set-mana',
            participantId,
            available: 10,
            maximum: 10
          }).accepted
        ).toBe(true)
      }
      expect(
        transformControl.match.dispatch({
          type: 'dev-add-card',
          participantId: playerId,
          cardId: 'basic_mind_control'
        }).accepted
      ).toBe(true)
      expect(
        transformControl.match.dispatch({
          type: 'dev-summon-minion',
          participantId: opponentId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
      const target = transformControl.match
        .getState()
        .players.find((player) => player.participantId === opponentId)!.board[0]!
      const polymorph = transformControl.match
        .getState()
        .players.find((player) => player.participantId === playerId)!
        .hand.find((card) => card.cardId === 'basic_polymorph')!
      expect(
        transformControl.match.dispatch({
          type: 'play-card',
          participantId: playerId,
          cardInstanceId: polymorph.instanceId,
          targets: [
            { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
          ]
        }).accepted
      ).toBe(true)
      expect(
        transformControl.match.dispatch({
          type: 'dev-set-mana',
          participantId: playerId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      const mindControl = transformControl.match
        .getState()
        .players.find((player) => player.participantId === playerId)!
        .hand.find((card) => card.cardId === 'basic_mind_control')!
      expect(
        transformControl.match.dispatch({
          type: 'play-card',
          participantId: playerId,
          cardInstanceId: mindControl.instanceId,
          targets: [
            { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
          ]
        }).accepted
      ).toBe(true)
      const transformedState = transformControl.match.getState()
      expect(
        transformedState.players
          .find((player) => player.participantId === playerId)!
          .board.some((minion) => minion.instanceId === target.instanceId)
      ).toBe(true)
      expect(
        transformedState.players
          .find((player) => player.participantId === opponentId)!
          .board.some((minion) => minion.instanceId === target.instanceId)
      ).toBe(false)
      expect(() => assertOpeningMatchInvariants(transformedState)).not.toThrow()

      const deaths = createMatchScenario({ seed, cardId: 'basic_flamestrike' })
      deaths.confirmBothMulligans()
      const deathPlayerId = deaths.match.getState().activePlayerId!
      const deathOpponentId = deaths.participants.find((id) => id !== deathPlayerId)!
      expect(
        deaths.match.dispatch({
          type: 'dev-set-mana',
          participantId: deathPlayerId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      for (const cardId of ['naxxramas_haunted_creeper', 'naxxramas_nerubian_egg']) {
        expect(
          deaths.match.dispatch({
            type: 'dev-summon-minion',
            participantId: deathOpponentId,
            cardId
          }).accepted
        ).toBe(true)
      }
      const flamestrike = deaths.match
        .getState()
        .players.find((player) => player.participantId === deathPlayerId)!.hand[0]!
      expect(
        deaths.match.dispatch({
          type: 'play-card',
          participantId: deathPlayerId,
          cardInstanceId: flamestrike.instanceId
        }).accepted
      ).toBe(true)
      expect(
        deaths.match
          .getState()
          .players.find((player) => player.participantId === deathOpponentId)!.board
      ).toHaveLength(3)
      expect(() => assertOpeningMatchInvariants(deaths.match.getState())).not.toThrow()
    }
  }, 120_000)
})
