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
