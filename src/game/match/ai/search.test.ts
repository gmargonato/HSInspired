import { describe, expect, it } from 'vitest'
import { asCardId, asHeroId } from '../../content/cards'
import type { Deck } from '../../decks'
import { createOpeningMatch } from '../opening-match'
import { asPlayerId, type MatchSetup } from '../match-types'
import { createMatchScenario } from '../testing/match-scenario-builder'
import { evaluatePosition } from './evaluator'
import { canonicalCommandKey, enumerateLegalCommands } from './legal-commands'
import { searchStrategicTurn } from './search'
import { commandUsesUncertainty } from './uncertainty'

describe('fair strategic complete-turn search', () => {
  it('is invariant to different hidden opponent hands and decks', () => {
    const selfId = asPlayerId('fair-search-self')
    const opponentId = asPlayerId('fair-search-opponent')
    const setup: MatchSetup = {
      seed: 100,
      participants: [
        {
          participantId: selfId,
          controllerKind: 'ai',
          heroId: asHeroId('jaina'),
          deckId: 'fair-self'
        },
        {
          participantId: opponentId,
          controllerKind: 'human',
          heroId: asHeroId('garrosh'),
          deckId: 'fair-opponent'
        }
      ]
    }
    const makeDeck = (id: string, heroId: string, cardId: string): Deck => ({
      id,
      name: id,
      heroId: asHeroId(heroId),
      cards: { [cardId]: 30 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    const selfDeck = makeDeck('fair-self', 'jaina', 'basic_murloc_raider')
    const first = createOpeningMatch(setup, [
      selfDeck,
      makeDeck('fair-opponent', 'garrosh', 'basic_bloodfen_raptor')
    ])
    const second = createOpeningMatch(setup, [
      selfDeck,
      // Drawing Flame Leviathan changes public state if End Turn is illegally
      // simulated through the opponent's hidden top card.
      makeDeck('fair-opponent', 'garrosh', 'goblins_vs_gnomes_flame_leviathan')
    ])
    for (const match of [first, second]) {
      expect(
        match.dispatch({
          type: 'confirm-mulligan',
          participantId: selfId,
          replaceInstanceIds: []
        }).accepted
      ).toBe(true)
      expect(
        match.dispatch({
          type: 'confirm-mulligan',
          participantId: opponentId,
          replaceInstanceIds: []
        }).accepted
      ).toBe(true)
    }
    const commands = first.analyze((fork) => enumerateLegalCommands(fork, selfId))
    const roots = commands.map((command, index) => ({
      actionId: `fair-root-${index}`,
      command
    }))
    const limits = {
      timeBudgetMs: 500,
      nodeLimit: 200,
      atomicDepth: 3,
      ownTurnBeam: 8,
      opponentTurnBeam: 0,
      determinizations: 0,
      randomOutcomeSamples: 0,
      transpositionCapacity: 100
    } as const

    expect(searchStrategicTurn(first, selfId, roots, limits).dossiers).toEqual(
      searchStrategicTurn(second, selfId, roots, limits).dossiers
    )
  })

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

    const first = searchStrategicTurn(scenario.match, perspective, roots, limits)
    const second = searchStrategicTurn(scenario.match, perspective, roots, limits)

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

    const result = searchStrategicTurn(
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

  it('values early information without observing the authoritative draw result', () => {
    const scenario = createMatchScenario({
      seed: 107,
      cardId: 'basic_arcane_intellect'
    })
    scenario.confirmBothMulligans()
    const perspective = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: perspective,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const before = scenario.match.getState()
    const draw = scenario.match
      .analyze((fork) => enumerateLegalCommands(fork, perspective))
      .find((command) => command.type === 'play-card')!
    const result = searchStrategicTurn(
      scenario.match,
      perspective,
      [{ actionId: 'draw-first', command: draw }],
      {
        timeBudgetMs: 100,
        nodeLimit: 10,
        atomicDepth: 2,
        ownTurnBeam: 2,
        opponentTurnBeam: 0,
        determinizations: 8,
        randomOutcomeSamples: 4,
        transpositionCapacity: 10
      }
    )

    expect(result.dossiers[0]?.evaluation.informationValue).toBeGreaterThan(0)
    expect(result.dossiers[0]?.uncertainty).toMatchObject({
      determinizations: 0,
      randomOutcomeSamples: 0,
      incomplete: true
    })
    expect(scenario.match.getState()).toEqual(before)
  })

  it('does not count cards drawn by the opponent as decision information', () => {
    const scenario = createMatchScenario({ seed: 115 })
    scenario.confirmBothMulligans()
    const perspective = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId: perspective,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    for (const cardId of [
      'classic_coldlight_oracle',
      'naxxramas_dancing_swords'
    ] as const) {
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId: perspective,
          cardId: asCardId(cardId)
        }).accepted
      ).toBe(true)
    }
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: perspective,
        available: 3,
        maximum: 3
      }).accepted
    ).toBe(true)
    const before = scenario.match.getState()
    const roots = scenario.match
      .analyze((fork) => enumerateLegalCommands(fork, perspective))
      .filter((command) => command.type === 'play-card')
      .map((command) => ({
        actionId:
          before.players
            .find((player) => player.participantId === perspective)!
            .hand.find((card) => card.instanceId === command.cardInstanceId)?.cardId ??
          'unknown',
        command
      }))

    const result = searchStrategicTurn(scenario.match, perspective, roots, {
      timeBudgetMs: 100,
      nodeLimit: 20,
      atomicDepth: 2,
      ownTurnBeam: 2,
      opponentTurnBeam: 0,
      determinizations: 0,
      randomOutcomeSamples: 0,
      transpositionCapacity: 20
    })

    expect(result.dossiers[0]?.actionId).toBe('naxxramas_dancing_swords')
    expect(scenario.match.getState()).toEqual(before)
  })

  it('does not inspect the card behind a draw hero power', () => {
    const scenario = createMatchScenario({
      seed: 108,
      firstHeroId: 'guldan',
      secondHeroId: 'guldan'
    })
    scenario.confirmBothMulligans()
    const perspective = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: perspective,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const before = scenario.match.getState()
    const lifeTap = scenario.match
      .analyze((fork) => enumerateLegalCommands(fork, perspective))
      .find((command) => command.type === 'use-hero-power')!

    const result = searchStrategicTurn(
      scenario.match,
      perspective,
      [{ actionId: 'life-tap', command: lifeTap }],
      {
        timeBudgetMs: 100,
        nodeLimit: 10,
        atomicDepth: 2,
        ownTurnBeam: 2,
        opponentTurnBeam: 0,
        determinizations: 0,
        randomOutcomeSamples: 0,
        transpositionCapacity: 10
      }
    )

    expect(result.dossiers[0]?.evaluation.informationValue).toBeGreaterThan(0)
    expect(result.dossiers[0]?.projectedSuccessor.selfEffectiveHealth).toBe(
      before.players.find((player) => player.participantId === perspective)!.hero.health
    )
    expect(result.dossiers[0]?.uncertainty.incomplete).toBe(true)
    expect(scenario.match.getState()).toEqual(before)
  })

  it('does not let an information boundary hide guaranteed lethal self-damage', () => {
    const scenario = createMatchScenario({
      seed: 114,
      firstHeroId: 'guldan',
      secondHeroId: 'guldan'
    })
    scenario.confirmBothMulligans()
    const perspective = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-set-hero',
        participantId: perspective,
        health: 2,
        armor: 0
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: perspective,
        available: 2,
        maximum: 2
      }).accepted
    ).toBe(true)
    const before = scenario.match.getState()
    const commands = scenario.match.analyze((fork) =>
      enumerateLegalCommands(fork, perspective)
    )
    const lifeTap = commands.find((command) => command.type === 'use-hero-power')!
    const endTurn = commands.find((command) => command.type === 'end-turn')!

    const result = searchStrategicTurn(
      scenario.match,
      perspective,
      [
        { actionId: 'life-tap', command: lifeTap },
        { actionId: 'end-turn', command: endTurn }
      ],
      {
        timeBudgetMs: 100,
        nodeLimit: 10,
        atomicDepth: 2,
        ownTurnBeam: 2,
        opponentTurnBeam: 0,
        determinizations: 0,
        randomOutcomeSamples: 0,
        transpositionCapacity: 10
      }
    )

    expect(result.dossiers[0]?.actionId).toBe('end-turn')
    expect(scenario.match.getState()).toEqual(before)
  })

  it('treats a damaging hero power as a possible public Secret trigger', () => {
    const scenario = createMatchScenario({
      seed: 110,
      firstHeroId: 'jaina',
      secondHeroId: 'uther'
    })
    scenario.confirmBothMulligans()
    const perspective = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: perspective,
        available: 2,
        maximum: 2
      }).accepted
    ).toBe(true)
    const state = scenario.match.getState()
    const opponent = state.players.find(
      (player) => player.participantId !== perspective
    )!
    const stateWithFacedownSecret = {
      ...state,
      players: state.players.map((player) =>
        player.participantId === opponent.participantId
          ? {
              ...player,
              secrets: [
                {
                  instanceId: 'facedown-secret',
                  cardId: asCardId('classic_eye_for_an_eye'),
                  ownerId: opponent.participantId,
                  controllerId: opponent.participantId,
                  creationOrdinal: 1,
                  revealed: false
                }
              ]
            }
          : player
      ) as unknown as typeof state.players
    }
    const pingOpponent = scenario.match
      .analyze((fork) => enumerateLegalCommands(fork, perspective))
      .find(
        (command) =>
          command.type === 'use-hero-power' &&
          command.target?.kind === 'hero' &&
          command.target.participantId === opponent.participantId
      )!

    expect(
      commandUsesUncertainty(pingOpponent, stateWithFacedownSecret, perspective)
    ).toBe(true)
  })

  it('crosses an unknown Deathrattle boundary only when public combat can kill it', () => {
    const scenario = createMatchScenario({ seed: 111 })
    scenario.confirmBothMulligans()
    const perspective = scenario.match.getState().activePlayerId!
    const opponent = scenario.participants.find(
      (participantId) => participantId !== perspective
    )!
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: perspective,
        cardId: asCardId('naxxramas_deathlord')
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponent,
        cardId: asCardId('basic_murloc_raider')
      }).accepted
    ).toBe(true)
    const state = scenario.match.getState()
    const deathlord = state.players
      .find((player) => player.participantId === perspective)!
      .board.find((minion) => minion.cardId === 'naxxramas_deathlord')!
    const raider = state.players
      .find((player) => player.participantId === opponent)!
      .board.find((minion) => minion.cardId === 'basic_murloc_raider')!
    const attack = {
      type: 'attack-character' as const,
      participantId: perspective,
      attacker: { kind: 'minion' as const, instanceId: deathlord.instanceId },
      defender: { kind: 'minion' as const, instanceId: raider.instanceId }
    }

    expect(commandUsesUncertainty(attack, state, perspective)).toBe(false)

    const lethalState = {
      ...state,
      players: state.players.map((player) =>
        player.participantId === perspective
          ? {
              ...player,
              board: player.board.map((minion) =>
                minion.instanceId === deathlord.instanceId
                  ? { ...minion, health: 2 }
                  : minion
              )
            }
          : player
      )
    } as unknown as typeof state
    expect(commandUsesUncertainty(attack, lethalState, perspective)).toBe(true)
  })

  it('does not treat a non-damaging target as an on-damage information boundary', () => {
    const scenario = createMatchScenario({ seed: 112 })
    scenario.confirmBothMulligans()
    const perspective = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: perspective,
        cardId: asCardId('classic_acolyte_of_pain')
      }).accepted
    ).toBe(true)
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
        cardId: asCardId('basic_mark_of_the_wild')
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
    const state = scenario.match.getState()
    const acolyte = state.players
      .find((player) => player.participantId === perspective)!
      .board.find((minion) => minion.cardId === 'classic_acolyte_of_pain')!
    const buff = scenario.match
      .analyze((fork) => enumerateLegalCommands(fork, perspective))
      .find(
        (command) =>
          command.type === 'play-card' &&
          command.targets?.some(
            (target) =>
              target.kind === 'minion' && target.instanceId === acolyte.instanceId
          )
      )!

    expect(commandUsesUncertainty(buff, state, perspective)).toBe(false)
  })

  it('plans up to a multi-action draw boundary without observing the drawn card', () => {
    const scenario = createMatchScenario({
      seed: 113,
      firstHeroId: 'jaina',
      secondHeroId: 'jaina'
    })
    scenario.confirmBothMulligans()
    const perspective = scenario.match.getState().activePlayerId!
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
        cardId: asCardId('classic_acolyte_of_pain')
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: perspective,
        available: 5,
        maximum: 5
      }).accepted
    ).toBe(true)
    const before = scenario.match.getState()
    const acolyteCard = before.players
      .find((player) => player.participantId === perspective)!
      .hand.find((card) => card.cardId === 'classic_acolyte_of_pain')!
    const playAcolyte = scenario.match
      .analyze((fork) => enumerateLegalCommands(fork, perspective))
      .find(
        (command) =>
          command.type === 'play-card' &&
          command.cardInstanceId === acolyteCard.instanceId
      )!

    const result = searchStrategicTurn(
      scenario.match,
      perspective,
      [{ actionId: 'play-acolyte', command: playAcolyte }],
      {
        timeBudgetMs: 500,
        nodeLimit: 100,
        atomicDepth: 3,
        ownTurnBeam: 12,
        opponentTurnBeam: 0,
        determinizations: 0,
        randomOutcomeSamples: 0,
        transpositionCapacity: 100
      }
    )

    expect(result.dossiers[0]?.recommendedContinuation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'use-hero-power',
          target: expect.objectContaining({
            kind: 'minion',
            instanceId: acolyteCard.instanceId
          })
        })
      ])
    )
    expect(result.dossiers[0]?.evaluation.informationValue).toBeGreaterThan(0)
    expect(result.dossiers[0]?.uncertainty.incomplete).toBe(true)
    expect(result.dossiers[0]?.tacticalProofs).toEqual([])
    expect(scenario.match.getState()).toEqual(before)
  })

  it('values deliberately damaging an on-damage draw minion as information', () => {
    const scenario = createMatchScenario({
      seed: 109,
      firstHeroId: 'jaina',
      secondHeroId: 'jaina'
    })
    scenario.confirmBothMulligans()
    const perspective = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: perspective,
        cardId: asCardId('classic_acolyte_of_pain')
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
    const before = scenario.match.getState()
    const acolyte = before.players
      .find((player) => player.participantId === perspective)!
      .board.find((minion) => minion.cardId === 'classic_acolyte_of_pain')!
    const ping = scenario.match
      .analyze((fork) => enumerateLegalCommands(fork, perspective))
      .find(
        (command) =>
          command.type === 'use-hero-power' &&
          command.target?.kind === 'minion' &&
          command.target.instanceId === acolyte.instanceId
      )!
    const endTurn = scenario.match
      .analyze((fork) => enumerateLegalCommands(fork, perspective))
      .find((command) => command.type === 'end-turn')!

    const result = searchStrategicTurn(
      scenario.match,
      perspective,
      [
        { actionId: 'ping-acolyte', command: ping },
        { actionId: 'leave-acolyte-alone', command: endTurn }
      ],
      {
        timeBudgetMs: 100,
        nodeLimit: 10,
        atomicDepth: 2,
        ownTurnBeam: 2,
        opponentTurnBeam: 0,
        determinizations: 0,
        randomOutcomeSamples: 0,
        transpositionCapacity: 10
      }
    )

    const pingDossier = result.dossiers.find(
      (dossier) => dossier.actionId === 'ping-acolyte'
    )
    const endTurnDossier = result.dossiers.find(
      (dossier) => dossier.actionId === 'leave-acolyte-alone'
    )
    expect(pingDossier?.evaluation.informationValue).toBeGreaterThan(0)
    expect(pingDossier?.uncertainty.incomplete).toBe(true)
    // Turn handoff is a complete current-turn horizon even though the unknown
    // opponent draw is deliberately outside that horizon.
    expect(endTurnDossier?.uncertainty.incomplete).toBe(false)
    expect(scenario.match.getState()).toEqual(before)
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

    const result = searchStrategicTurn(
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

    const result = searchStrategicTurn(
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

  it('treats publicly visible next-turn board lethal as critical exposure', () => {
    const scenario = createMatchScenario({ seed: 116 })
    scenario.confirmBothMulligans()
    const perspective = scenario.match.getState().activePlayerId!
    const opponent = scenario.participants.find(
      (participantId) => participantId !== perspective
    )!
    expect(
      scenario.match.dispatch({
        type: 'dev-set-hero',
        participantId: perspective,
        health: 4,
        armor: 0
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponent,
        cardId: asCardId('basic_chillwind_yeti')
      }).accepted
    ).toBe(true)

    expect(
      evaluatePosition(scenario.match.getState(), perspective).components.incomingReach
    ).toBe(-4)
  })

  it('prioritizes removing a public persistent board engine', () => {
    const scenario = createMatchScenario({ seed: 117 })
    scenario.confirmBothMulligans()
    const stagingPlayer = scenario.match.getState().activePlayerId!
    const perspective = scenario.participants.find(
      (participantId) => participantId !== stagingPlayer
    )!
    for (const command of [
      {
        type: 'dev-clear-zone',
        participantId: stagingPlayer,
        zone: 'board'
      } as const,
      {
        type: 'dev-clear-zone',
        participantId: perspective,
        zone: 'board'
      } as const,
      {
        type: 'dev-summon-minion',
        participantId: perspective,
        cardId: asCardId('basic_boulderfist_ogre')
      } as const,
      {
        type: 'dev-summon-minion',
        participantId: stagingPlayer,
        cardId: asCardId('basic_stormwind_champion')
      } as const,
      {
        type: 'dev-summon-minion',
        participantId: stagingPlayer,
        cardId: asCardId('basic_chillwind_yeti')
      } as const
    ]) {
      expect(scenario.match.dispatch(command).accepted).toBe(true)
    }
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: stagingPlayer
      }).accepted
    ).toBe(true)
    const state = scenario.match.getState()
    const champion = state.players
      .find((player) => player.participantId === stagingPlayer)!
      .board.find((minion) => minion.cardId === 'basic_stormwind_champion')!
    const attacks = scenario.match
      .analyze((fork) => enumerateLegalCommands(fork, perspective))
      .filter(
        (command) =>
          command.type === 'attack-character' && command.defender.kind === 'minion'
      )
    const roots = attacks.map((command, index) => ({
      actionId: `attack-${index}`,
      command
    }))

    const result = searchStrategicTurn(scenario.match, perspective, roots, {
      timeBudgetMs: 200,
      nodeLimit: 50,
      atomicDepth: 2,
      ownTurnBeam: 4,
      opponentTurnBeam: 0,
      determinizations: 0,
      randomOutcomeSamples: 0,
      transpositionCapacity: 50
    })

    expect(result.dossiers[0]?.firstCommand).toMatchObject({
      type: 'attack-character',
      defender: { kind: 'minion', instanceId: champion.instanceId }
    })
  })
})
