import { describe, expect, it } from 'vitest'
import { asCardId } from '../../content/cards'
import { createMatchScenario } from '../testing/match-scenario-builder'
import { classifyTacticalLine, proveGuaranteedLethal } from './tactics'

describe('competitive AI tactical proofs', () => {
  it('proves a deterministic targeted lethal without mutating the live match', () => {
    const scenario = createMatchScenario({ seed: 91 })
    scenario.confirmBothMulligans()
    const beforeSetup = scenario.match.getState()
    const attackerId = beforeSetup.activePlayerId!
    const defenderId = beforeSetup.players.find(
      (player) => player.participantId !== attackerId
    )!.participantId
    expect(
      scenario.match.dispatch({
        type: 'dev-set-hero',
        participantId: defenderId,
        health: 2,
        armor: 0
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: attackerId,
        cardId: asCardId('basic_frostbolt')
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: attackerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const beforeProof = scenario.match.getState()

    const proof = proveGuaranteedLethal(scenario.match, attackerId, {
      depth: 4,
      nodeLimit: 1_000,
      deadlineAtMs: Date.now() + 2_000
    })

    expect(proof).toMatchObject({
      kind: 'guaranteed-lethal',
      proven: true,
      complete: true
    })
    expect(proof.commands[0]?.type).toBe('play-card')
    expect(scenario.match.getState()).toEqual(beforeProof)
  })

  it('proves a buff, attack, and burn combo lethal within a short search', () => {
    const scenario = createMatchScenario({ seed: 93 })
    scenario.confirmBothMulligans()
    const stagingPlayerId = scenario.match.getState().activePlayerId!
    const attackerId = scenario.participants.find(
      (participantId) => participantId !== stagingPlayerId
    )!
    const dispatch = (command: Parameters<typeof scenario.match.dispatch>[0]): void => {
      expect(scenario.match.dispatch(command).accepted).toBe(true)
    }
    dispatch({ type: 'dev-clear-zone', participantId: attackerId, zone: 'hand' })
    dispatch({ type: 'dev-clear-zone', participantId: attackerId, zone: 'board' })
    dispatch({
      type: 'dev-summon-minion',
      participantId: attackerId,
      cardId: asCardId('classic_wisp')
    })
    dispatch({
      type: 'dev-set-hero',
      participantId: stagingPlayerId,
      health: 8,
      armor: 0
    })
    dispatch({
      type: 'dev-add-card',
      participantId: attackerId,
      cardId: asCardId('classic_power_overwhelming')
    })
    dispatch({
      type: 'dev-add-card',
      participantId: attackerId,
      cardId: asCardId('goblins_vs_gnomes_darkbomb')
    })
    dispatch({ type: 'end-turn', participantId: stagingPlayerId })
    dispatch({
      type: 'dev-set-mana',
      participantId: attackerId,
      available: 10,
      maximum: 10
    })
    const attacker = scenario.match
      .getState()
      .players.find((player) => player.participantId === attackerId)!
    const powerOverwhelming = attacker.hand.find(
      (card) => card.cardId === 'classic_power_overwhelming'
    )!
    const darkbomb = attacker.hand.find(
      (card) => card.cardId === 'goblins_vs_gnomes_darkbomb'
    )!

    const proof = proveGuaranteedLethal(scenario.match, attackerId, {
      depth: 4,
      nodeLimit: 100,
      deadlineAtMs: Date.now() + 500
    })

    expect(proof).toMatchObject({ proven: true, complete: true })
    expect(proof.commands).toEqual([
      expect.objectContaining({
        type: 'play-card',
        cardInstanceId: powerOverwhelming.instanceId
      }),
      expect.objectContaining({ type: 'attack-character' }),
      expect.objectContaining({
        type: 'play-card',
        cardInstanceId: darkbomb.instanceId
      })
    ])
  })

  it('includes a mana-enabling Coin in a lethal line', () => {
    const scenario = createMatchScenario({
      seed: 94,
      firstHeroId: 'jaina',
      secondHeroId: 'jaina'
    })
    scenario.confirmBothMulligans()
    const attackerId = scenario.match.getState().activePlayerId!
    const defenderId = scenario.participants.find(
      (participantId) => participantId !== attackerId
    )!
    const dispatch = (command: Parameters<typeof scenario.match.dispatch>[0]): void => {
      expect(scenario.match.dispatch(command).accepted).toBe(true)
    }
    dispatch({ type: 'dev-clear-zone', participantId: attackerId, zone: 'hand' })
    dispatch({
      type: 'dev-add-card',
      participantId: attackerId,
      cardId: asCardId('basic_the_coin')
    })
    dispatch({
      type: 'dev-add-card',
      participantId: attackerId,
      cardId: asCardId('basic_fireball')
    })
    dispatch({
      type: 'dev-set-mana',
      participantId: attackerId,
      available: 3,
      maximum: 3
    })
    dispatch({
      type: 'dev-set-hero',
      participantId: defenderId,
      health: 6,
      armor: 0
    })
    const attacker = scenario.match
      .getState()
      .players.find((player) => player.participantId === attackerId)!
    const coin = attacker.hand.find((card) => card.cardId === 'basic_the_coin')!
    const fireball = attacker.hand.find((card) => card.cardId === 'basic_fireball')!

    const proof = proveGuaranteedLethal(scenario.match, attackerId, {
      depth: 2,
      nodeLimit: 50,
      deadlineAtMs: Date.now() + 500
    })

    expect(proof).toMatchObject({ proven: true, complete: true })
    expect(proof.commands).toEqual([
      expect.objectContaining({ type: 'play-card', cardInstanceId: coin.instanceId }),
      expect.objectContaining({
        type: 'play-card',
        cardInstanceId: fireball.instanceId
      })
    ])
  })

  it('does not classify mana expenditure alone as unconditionally profitable', () => {
    const scenario = createMatchScenario({ seed: 92 })
    scenario.confirmBothMulligans()
    const before = scenario.match.getState()
    const participantId = before.activePlayerId!
    const after = {
      ...before,
      players: before.players.map((player) =>
        player.participantId === participantId
          ? {
              ...player,
              mana: {
                ...player.mana,
                available: Math.max(0, player.mana.available - 1)
              }
            }
          : player
      ) as unknown as typeof before.players
    }

    const proofs = classifyTacticalLine(before, after, participantId, [
      { type: 'end-turn', participantId }
    ])

    expect(proofs.map((proof) => proof.kind)).not.toContain(
      'unconditionally-profitable'
    )
  })
})
