import { describe, expect, it } from 'vitest'
import { asCardId } from '../../content/cards'
import { createMatchScenario } from '../testing/match-scenario-builder'
import { evaluatePosition } from './evaluator'
import { canonicalCommandKey, enumerateLegalCommands } from './legal-commands'
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

  it('distinguishes nested target variants in canonical command keys', () => {
    const scenario = createMatchScenario({ seed: 103 })
    scenario.confirmBothMulligans()
    const perspective = scenario.match.getState().activePlayerId!
    const opponent = scenario.participants.find(
      (participantId) => participantId !== perspective
    )!

    expect(
      canonicalCommandKey({
        type: 'use-hero-power',
        participantId: perspective,
        target: { kind: 'hero', participantId: perspective }
      })
    ).not.toBe(
      canonicalCommandKey({
        type: 'use-hero-power',
        participantId: perspective,
        target: { kind: 'hero', participantId: opponent }
      })
    )
  })

  it('gives every legal root a baseline even after the time and node budgets expire', () => {
    const scenario = createMatchScenario({ seed: 104 })
    scenario.confirmBothMulligans()
    const perspective = scenario.match.getState().activePlayerId!
    const roots = scenario.match
      .analyze((fork) => enumerateLegalCommands(fork, perspective))
      .map((command, index) => ({ actionId: `root-${index}`, command }))

    const result = searchCompetitiveTurn(
      scenario.match,
      perspective,
      roots,
      {
        timeBudgetMs: 0,
        nodeLimit: 0,
        atomicDepth: 1,
        ownTurnBeam: 1,
        opponentTurnBeam: 1,
        determinizations: 1,
        randomOutcomeSamples: 1,
        transpositionCapacity: 10
      },
      undefined,
      undefined,
      { baselineOnly: true }
    )

    expect(result.dossiers.map((dossier) => dossier.actionId).sort()).toEqual(
      roots.map((root) => root.actionId).sort()
    )
  })

  it('prunes dominated direct damage to the acting player', () => {
    const scenario = createMatchScenario({
      seed: 105,
      cardId: 'goblins_vs_gnomes_darkbomb'
    })
    scenario.confirmBothMulligans()
    const perspective = scenario.match.getState().activePlayerId!
    const opponent = scenario.participants.find(
      (participantId) => participantId !== perspective
    )!
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId: perspective,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: perspective,
        cardId: asCardId('goblins_vs_gnomes_darkbomb')
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: perspective,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const commands = scenario.match.analyze((fork) =>
      enumerateLegalCommands(fork, perspective)
    )
    const ownHero = commands.find(
      (command) =>
        command.type === 'play-card' &&
        command.targets?.[0]?.kind === 'hero' &&
        command.targets[0].participantId === perspective
    )!
    const enemyHero = commands.find(
      (command) =>
        command.type === 'play-card' &&
        command.targets?.[0]?.kind === 'hero' &&
        command.targets[0].participantId === opponent
    )!
    const endTurn = commands.find((command) => command.type === 'end-turn')!
    const roots = [ownHero, enemyHero, endTurn].map((command, index) => ({
      actionId: `root-${index}`,
      command
    }))

    const result = searchCompetitiveTurn(
      scenario.match,
      perspective,
      roots,
      {
        timeBudgetMs: 100,
        nodeLimit: 100,
        atomicDepth: 2,
        ownTurnBeam: 4,
        opponentTurnBeam: 2,
        determinizations: 1,
        randomOutcomeSamples: 1,
        transpositionCapacity: 20
      },
      undefined,
      undefined,
      { baselineOnly: true }
    )

    expect(result.dossiers.map((dossier) => dossier.actionId)).not.toContain('root-0')
    expect(result.dossiers.map((dossier) => dossier.actionId)).toContain('root-1')
  })

  it('values setting up a hero-power kill above equivalent face damage', () => {
    const scenario = createMatchScenario({
      seed: 106,
      firstHeroId: 'jaina',
      secondHeroId: 'jaina'
    })
    scenario.confirmBothMulligans()
    const perspective = scenario.match.getState().activePlayerId!
    const opponent = scenario.participants.find(
      (participantId) => participantId !== perspective
    )!
    for (const command of [
      { type: 'dev-clear-zone', participantId: perspective, zone: 'hand' } as const,
      { type: 'dev-clear-zone', participantId: opponent, zone: 'board' } as const,
      {
        type: 'dev-summon-minion',
        participantId: opponent,
        cardId: asCardId('basic_war_golem')
      } as const,
      {
        type: 'dev-summon-minion',
        participantId: opponent,
        cardId: asCardId('classic_wisp')
      } as const,
      {
        type: 'dev-add-card',
        participantId: perspective,
        cardId: asCardId('basic_fireball')
      } as const,
      {
        type: 'dev-set-mana',
        participantId: perspective,
        available: 10,
        maximum: 10
      } as const
    ])
      expect(scenario.match.dispatch(command).accepted).toBe(true)
    const state = scenario.match.getState()
    const golemId = state.players
      .find((player) => player.participantId === opponent)!
      .board.find((minion) => minion.cardId === 'basic_war_golem')!.instanceId
    const fireballs = scenario.match
      .analyze((fork) => enumerateLegalCommands(fork, perspective))
      .filter((command) => command.type === 'play-card')
    const golemTarget = fireballs.find(
      (command) =>
        command.targets?.[0]?.kind === 'minion' &&
        command.targets[0].instanceId === golemId
    )!
    const faceTarget = fireballs.find(
      (command) =>
        command.targets?.[0]?.kind === 'hero' &&
        command.targets[0].participantId === opponent
    )!
    const golemPreview = scenario.match.preview(golemTarget)
    const facePreview = scenario.match.preview(faceTarget)

    expect(golemPreview.accepted).toBe(true)
    expect(facePreview.accepted).toBe(true)
    expect(evaluatePosition(golemPreview.state, perspective).score).toBeGreaterThan(
      evaluatePosition(facePreview.state, perspective).score
    )
  })
})
