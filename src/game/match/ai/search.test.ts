import { describe, expect, it } from 'vitest'
import { createMatchScenario } from '../testing/match-scenario-builder'
import { enumerateLegalCommands } from './legal-commands'
import { searchCompetitiveTurn } from './search'

describe('competitive complete-turn search', () => {
  it('is deterministic under node limits and restores the authoritative match', () => {
    const scenario = createMatchScenario({ seed: 101 })
    scenario.confirmBothMulligans()
    const before = scenario.match.getState()
    const perspective = before.activePlayerId!
    const commands = scenario.match.analyze((fork) =>
      enumerateLegalCommands(fork, perspective)
    )
    const roots = commands.slice(0, 4).map((command, index) => ({
      actionId: `root-${index}`,
      command
    }))
    const limits = {
      timeBudgetMs: 10_000,
      nodeLimit: 40,
      atomicDepth: 3,
      ownTurnBeam: 8,
      opponentTurnBeam: 4,
      determinizations: 2,
      randomOutcomeSamples: 2,
      transpositionCapacity: 100
    } as const

    const first = searchCompetitiveTurn(scenario.match, perspective, roots, limits)
    const second = searchCompetitiveTurn(scenario.match, perspective, roots, limits)

    expect(first.dossiers).toEqual(second.dossiers)
    expect(first.exploredNodes).toBe(second.exploredNodes)
    expect(scenario.match.getState()).toEqual(before)
  })

  it('never continues Coin into Flamecannon when the opposing board is empty', () => {
    const scenario = createMatchScenario({
      seed: 102,
      cardId: 'goblins_vs_gnomes_flamecannon'
    })
    scenario.confirmBothMulligans()
    const firstPlayerId = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: firstPlayerId })
        .accepted
    ).toBe(true)
    const state = scenario.match.getState()
    const perspective = state.activePlayerId!
    const player = state.players.find(
      (candidate) => candidate.participantId === perspective
    )!
    const coin = player.hand.find((card) => card.cardId === 'basic_the_coin')!
    const flamecannon = player.hand.find(
      (card) => card.cardId === 'goblins_vs_gnomes_flamecannon'
    )!
    const coinCommand = scenario.match
      .analyze((fork) => enumerateLegalCommands(fork, perspective))
      .find(
        (command) =>
          command.type === 'play-card' && command.cardInstanceId === coin.instanceId
      )!

    const result = searchCompetitiveTurn(
      scenario.match,
      perspective,
      [{ actionId: 'coin', command: coinCommand }],
      {
        timeBudgetMs: 2_000,
        nodeLimit: 500,
        atomicDepth: 4,
        ownTurnBeam: 16,
        opponentTurnBeam: 8,
        determinizations: 1,
        randomOutcomeSamples: 1,
        transpositionCapacity: 100
      }
    )

    expect(result.dossiers).toHaveLength(1)
    expect(result.dossiers[0]?.recommendedContinuation).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'play-card',
          cardInstanceId: flamecannon.instanceId
        })
      ])
    )
  })
})
