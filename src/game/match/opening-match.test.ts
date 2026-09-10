import { describe, expect, it } from 'vitest'
import {
  AI_BONUS_SETTINGS,
  createAiBonusChoice,
  eligibleAiBonusSecrets
} from './ai-bonuses'
import { createMatchScenario } from './testing/match-scenario-builder'
import { createSeededRng } from './rng'
import { enumerateLegalCommands } from './ai/legal-commands'
import { CARD_CATALOG, asCardId, asHeroId } from '../content/cards'
import type { Deck } from '../decks'
import { asPlayerId, type MatchSetup, type PlayerId } from './match-types'
import {
  getOpeningMatchPublicEvents,
  createOpeningMatch,
  createOpeningMatchFromCheckpoint,
  type OpeningAcceptedResult,
  type OpeningCommandResult,
  type OpeningMatchEvent,
  type OpeningMatchInstance,
  type HistoryActionResolvedEvent
} from './opening-match'

const HUMAN_ID = asPlayerId('human-player')
const OPPONENT_ID = asPlayerId('opponent-player')

describe('AI turn bonuses', () => {
  it('casts a reproducible free Secret on even turns and conceals its history identity', () => {
    const { match, ai, participants } = ready()
    const checkpoint = match.getCheckpoint()
    const state = { ...checkpoint.state, turnNumber: 7 }
    const game = createOpeningMatchFromCheckpoint({ ...checkpoint, state })
    const replay = createOpeningMatchFromCheckpoint(game.getCheckpoint())
    const before = game.getState().players.find((p) => p.participantId === ai)!
    const command = { type: 'end-turn' as const, participantId: ai }
    const result = accept(game.dispatch(command))
    expect(accept(replay.dispatch(command))).toEqual(result)
    const after = result.state.players.find((p) => p.participantId === ai)!
    expect(after.secrets).toHaveLength((before.secrets?.length ?? 0) + 1)
    expect(after.hand).toEqual(before.hand)
    expect(after.mana).toEqual(before.mana)
    const entry = getOpeningMatchPublicEvents(result.events, participants[1]).find(
      (event) => event.type === 'history-action-resolved' && event.action === 'card'
    )
    expect(entry).toMatchObject({
      source: { cardId: null, concealedAs: 'secret' }
    })
    expect(result.state.activePlayerId).not.toBe(ai)
  })

  it('filters bonus Secrets across classes and seats without a total cap', () => {
    const { match, ai } = ready()
    const base = match.getState()
    for (const seat of [1, 2])
      for (let turn = 1; turn <= 8; turn++) {
        expect(
          eligibleAiBonusSecrets({ ...base, turnNumber: (turn - 1) * 2 + seat }, ai)
            .length > 0
        ).toBe(turn % 2 === 0)
      }
    const state = { ...base, turnNumber: 7 }
    const pool = eligibleAiBonusSecrets(state, ai)
    expect(
      new Set(pool.map((id) => CARD_CATALOG.require(id).cardClass)).size
    ).toBeGreaterThan(1)
    for (const player of state.players)
      for (const secret of player.secrets ?? []) {
        if (player.participantId === ai) expect(pool).not.toContain(secret.cardId)
      }
    const full = {
      ...state,
      players: state.players.map((player) =>
        player.participantId !== ai
          ? player
          : {
              ...player,
              secrets: pool.slice(0, 5).map((cardId, index) => ({
                cardId,
                instanceId: `secret-${index}`,
                ownerId: ai,
                controllerId: ai,
                creationOrdinal: 1000 + index,
                playOrder: 1100 + index,
                revealed: false
              }))
            }
      ) as unknown as typeof state.players
    }
    const remaining = eligibleAiBonusSecrets(full, ai)
    expect(remaining.length).toBeGreaterThan(0)
    expect(remaining).toEqual(expect.arrayContaining(pool.slice(5)))
    for (const cardId of pool.slice(0, 5)) expect(remaining).not.toContain(cardId)
    AI_BONUS_SETTINGS.secretsEnabled = false
    try {
      expect(eligibleAiBonusSecrets(state, ai)).toEqual([])
    } finally {
      AI_BONUS_SETTINGS.secretsEnabled = true
    }
  })

  it('offers bonuses on personal turns 3, 6 and 9 for either seat', () => {
    const { match, ai } = ready()
    for (const seat of [1, 2]) {
      for (let personalTurn = 1; personalTurn <= 10; personalTurn++) {
        const state = {
          ...match.getState(),
          turnNumber: (personalTurn - 1) * 2 + seat
        }
        expect(Boolean(createAiBonusChoice(state, ai, createSeededRng(1)))).toBe(
          [3, 6, 9].includes(personalTurn)
        )
      }
    }
  })
  function ready(seed = 1) {
    const scenario = createMatchScenario({
      seed,
      firstController: 'ai',
      secondController: 'human'
    })
    const ai = scenario.participants[0]
    scenario.confirmBothMulligans()
    while (
      Math.ceil(scenario.match.getState().turnNumber / 2) < 3 ||
      scenario.match.getState().activePlayerId !== ai
    ) {
      const state = scenario.match.getState()
      accept(
        scenario.match.dispatch({
          type: 'end-turn',
          participantId: state.activePlayerId!
        })
      )
      expect(scenario.match.getState().pendingCardChoice).toBeUndefined()
    }
    return { ...scenario, ai }
  }

  it('starts at 1 mana / 30 health with an independently switchable upgraded power', () => {
    const scenario = createMatchScenario({ firstController: 'ai' })
    const initial = scenario.match
      .getState()
      .players.find((p) => p.participantId === scenario.participants[0])!
    expect(initial.mana.maximum).toBe(0)
    expect(initial.hero.health).toBe(30)
    expect(initial.heroPower.id).toBe('mage-fireblast-rank-2')
    scenario.confirmBothMulligans()
    const state = scenario.match.getState()
    expect(
      state.players.find((p) => p.participantId === state.activePlayerId)!.mana
        .available
    ).toBe(1)
    AI_BONUS_SETTINGS.upgradedHeroPower = false
    try {
      expect(
        createMatchScenario({ firstController: 'ai' })
          .match.getState()
          .players.find((p) => p.participantId === scenario.participants[0])!.heroPower
          .id
      ).toBe('mage-fireblast')
    } finally {
      AI_BONUS_SETTINGS.upgradedHeroPower = true
    }
  })

  it('crafts tiered potions into hand, preserves checkpoints, and commits the turn', () => {
    for (const [personalTurn, cost] of [
      [3, 1],
      [6, 5],
      [9, 10],
      [12, 10]
    ]) {
      const { match, ai } = ready()
      const checkpoint = match.getCheckpoint()
      const craftedMatch = createOpeningMatchFromCheckpoint({
        ...checkpoint,
        state: { ...checkpoint.state, turnNumber: personalTurn * 2 - 1 }
      })
      const before = craftedMatch
        .getState()
        .players.find((p) => p.participantId === ai)!
      accept(craftedMatch.dispatch({ type: 'end-turn', participantId: ai }))
      const first = craftedMatch.getState().pendingCardChoice!
      expect(first.options).toHaveLength(3)
      expect(first.resolution).toMatchObject({
        type: 'kazakus-potion',
        stage: 'first-ingredient',
        selectedCostOption: { cost }
      })
      expect(
        createAiBonusChoice(craftedMatch.getState(), ai, createSeededRng(1))
      ).toBeUndefined()
      accept(
        craftedMatch.dispatch({
          type: 'choose-card-option',
          participantId: ai,
          sourceCardInstanceId: first.sourceCardInstanceId,
          choice: 0
        })
      )
      const pending = craftedMatch.getState().pendingCardChoice!
      expect(pending.resolution).toMatchObject({ stage: 'second-ingredient' })
      expect(pending.options.map((o) => o.presentationCardId)).not.toContain(
        first.options[0].presentationCardId
      )
      const restored = createOpeningMatchFromCheckpoint(craftedMatch.getCheckpoint())
      const command = {
        type: 'choose-card-option' as const,
        participantId: ai,
        sourceCardInstanceId: pending.sourceCardInstanceId,
        choice: 0
      }
      const result = accept(craftedMatch.dispatch(command))
      expect(accept(restored.dispatch(command))).toEqual(result)
      const after = result.state.players.find((p) => p.participantId === ai)!
      expect(after.hand).toHaveLength(before.hand.length + 1)
      expect(after.mana).toEqual(before.mana)
      expect(after.board).toEqual(before.board)
      expect(after.hero).toEqual(before.hero)
      const potion = after.hand[after.hand.length - 1]
      expect(potion.cardId).toContain('kazakus_potion_')
      expect(potion.baseCost).toBe(cost)
      expect(potion.currentCost).toBe(cost)
      expect(result.state.pendingCardChoice).toBeUndefined()
      expect(craftedMatch.analyze((fork) => enumerateLegalCommands(fork, ai))).toEqual([
        { type: 'end-turn', participantId: ai }
      ])
      expect(
        craftedMatch.dispatch({
          type: 'play-card',
          participantId: ai,
          cardInstanceId: potion.instanceId
        }).accepted
      ).toBe(false)
      expect(after.secrets).toEqual(before.secrets)
      accept(craftedMatch.dispatch({ type: 'end-turn', participantId: ai }))
      expect(
        craftedMatch.getState().players.find((p) => p.participantId === ai)!.secrets
          ?.length ?? 0
      ).toBe((before.secrets?.length ?? 0) + (personalTurn % 2 === 0 ? 1 : 0))
      expect(craftedMatch.getState().activePlayerId).not.toBe(ai)
    }
  })

  it('crafts targeted damage without choosing a target until a later paid cast', () => {
    const { match, ai } = ready()
    const checkpoint = match.getCheckpoint()
    const heart = asCardId('mean_streets_of_gadgetzan_kazakus_1_heart_of_fire')
    let seed = 1
    while (
      !createAiBonusChoice(checkpoint.state, ai, createSeededRng(seed))!.options.some(
        (option) => option.presentationCardId === heart
      )
    )
      seed++
    const pending = createAiBonusChoice(checkpoint.state, ai, createSeededRng(seed))!
    const game = createOpeningMatchFromCheckpoint({
      ...checkpoint,
      state: {
        ...checkpoint.state,
        pendingCardChoice: pending,
        aiBonusTurn: checkpoint.state.turnNumber
      }
    })
    accept(
      game.dispatch({
        type: 'choose-card-option',
        participantId: ai,
        sourceCardInstanceId: pending.sourceCardInstanceId,
        choice: pending.options.find((option) => option.presentationCardId === heart)!
          .choice
      })
    )
    accept(
      game.dispatch({
        type: 'choose-card-option',
        participantId: ai,
        sourceCardInstanceId: pending.sourceCardInstanceId,
        choice: 0
      })
    )
    const potion = game
      .getState()
      .players.find((p) => p.participantId === ai)!
      .hand.at(-1)!
    accept(game.dispatch({ type: 'end-turn', participantId: ai }))
    accept(
      game.dispatch({
        type: 'end-turn',
        participantId: game.getState().activePlayerId!
      })
    )
    const before = game.getState().players.find((p) => p.participantId === ai)!
    const input = game.getPlayInput!(ai, potion.instanceId)!
    expect(input.legalTargetOptions[0].length).toBeGreaterThan(0)
    expect(
      game.dispatch({
        type: 'play-card',
        participantId: ai,
        cardInstanceId: potion.instanceId
      }).accepted
    ).toBe(false)
    const command = game
      .analyze((fork) => enumerateLegalCommands(fork, ai))
      .find(
        (command) =>
          command.type === 'play-card' && command.cardInstanceId === potion.instanceId
      )!
    expect(command).toBeDefined()
    accept(game.dispatch(command))
    const after = game.getState().players.find((p) => p.participantId === ai)!
    expect(after.hand.some((card) => card.instanceId === potion.instanceId)).toBe(false)
    expect(after.mana.available).toBe(before.mana.available - 1)
  })

  it('uses normal full-hand overflow when crafting finishes', () => {
    const { match, ai } = ready()
    const checkpoint = match.getCheckpoint()
    const game = createOpeningMatchFromCheckpoint({
      ...checkpoint,
      state: {
        ...checkpoint.state,
        players: checkpoint.state.players.map((player) =>
          player.participantId !== ai
            ? player
            : {
                ...player,
                hand: [
                  ...player.hand,
                  ...player.deck
                    .slice(0, 10 - player.hand.length)
                    .map((card) => ({ ...card, zone: 'hand' as const }))
                ],
                deck: player.deck.slice(10 - player.hand.length)
              }
        ) as unknown as typeof checkpoint.state.players
      }
    })
    accept(game.dispatch({ type: 'end-turn', participantId: ai }))
    for (let index = 0; index < 2; index++) {
      const pending = game.getState().pendingCardChoice!
      accept(
        game.dispatch({
          type: 'choose-card-option',
          participantId: ai,
          sourceCardInstanceId: pending.sourceCardInstanceId,
          choice: 0
        })
      )
    }
    const player = game.getState().players.find((p) => p.participantId === ai)!
    expect(player.hand).toHaveLength(10)
    expect(player.hand.some((card) => card.cardId.includes('kazakus_potion'))).toBe(
      false
    )
    expect(game.getState().pendingCardChoice).toBeUndefined()
    accept(game.dispatch({ type: 'end-turn', participantId: ai }))
    expect(game.getState().activePlayerId).not.toBe(ai)
  })

  it('samples ingredients reproducibly without requiring a board target', () => {
    const { match, ai } = ready()
    const state = match.getState()
    expect(createAiBonusChoice(state, ai, createSeededRng(50))).toEqual(
      createAiBonusChoice(state, ai, createSeededRng(50))
    )
    const offered = new Set<string>()
    for (let seed = 1; seed <= 30; seed++) {
      for (const option of createAiBonusChoice(state, ai, createSeededRng(seed))!
        .options)
        offered.add(option.presentationCardId!)
    }
    expect(offered.has('mean_streets_of_gadgetzan_kazakus_1_heart_of_fire')).toBe(true)
  })

  it('can disable only the bonus while retaining the upgraded starting power', () => {
    const { match, ai } = ready()
    AI_BONUS_SETTINGS.enabled = false
    try {
      accept(match.dispatch({ type: 'end-turn', participantId: ai }))
      expect(match.getState().pendingCardChoice).toBeUndefined()
      expect(match.getState().activePlayerId).not.toBe(ai)
    } finally {
      AI_BONUS_SETTINGS.enabled = true
    }
  })
})

function accept(result: OpeningCommandResult): OpeningAcceptedResult {
  expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
  if (!result.accepted) throw new Error(result.message)
  return result
}

function deck(id: string, heroId: string): Deck {
  return {
    id,
    name: id,
    heroId: asHeroId(heroId),
    cards: { basic_acidic_swamp_ooze: 30 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function startMatch(heroId: string, opponentHeroId = 'jaina'): OpeningMatchInstance {
  const setup: MatchSetup = {
    seed: 1,
    participants: [
      {
        participantId: HUMAN_ID,
        controllerKind: 'human',
        heroId: asHeroId(heroId),
        deckId: 'human-deck'
      },
      {
        participantId: OPPONENT_ID,
        controllerKind: 'human',
        heroId: asHeroId(opponentHeroId),
        deckId: 'opponent-deck'
      }
    ]
  }
  const match = createOpeningMatch(
    setup,
    [deck('human-deck', heroId), deck('opponent-deck', opponentHeroId)],
    { next: () => 0.1, snapshot: () => 0, restore: () => undefined }
  )
  accept(
    match.dispatch({
      type: 'confirm-mulligan',
      participantId: HUMAN_ID,
      replaceInstanceIds: []
    })
  )
  accept(
    match.dispatch({
      type: 'confirm-mulligan',
      participantId: OPPONENT_ID,
      replaceInstanceIds: []
    })
  )
  setMana(match, HUMAN_ID)
  return match
}

function setMana(match: OpeningMatchInstance, participantId: PlayerId): void {
  accept(
    match.dispatch({
      type: 'dev-set-mana',
      participantId,
      available: 10,
      maximum: 10
    })
  )
}

function usePower(match: OpeningMatchInstance, target?: object): OpeningAcceptedResult {
  return accept(
    match.dispatch({
      type: 'use-hero-power',
      participantId: HUMAN_ID,
      ...(target ? { target } : {})
    })
  )
}

function cycleBackToHuman(match: OpeningMatchInstance): void {
  accept(match.dispatch({ type: 'end-turn', participantId: HUMAN_ID }))
  accept(match.dispatch({ type: 'end-turn', participantId: OPPONENT_ID }))
  setMana(match, HUMAN_ID)
}

describe('mulligan confirmation', () => {
  it('replaces one participant hand before the other participant confirms', () => {
    const match = createOpeningMatch(
      {
        seed: 1,
        participants: [
          {
            participantId: HUMAN_ID,
            controllerKind: 'human',
            heroId: asHeroId('jaina'),
            deckId: 'human-deck'
          },
          {
            participantId: OPPONENT_ID,
            controllerKind: 'ai',
            heroId: asHeroId('rexxar'),
            deckId: 'opponent-deck'
          }
        ]
      },
      [deck('human-deck', 'jaina'), deck('opponent-deck', 'rexxar')],
      { next: () => 0.1, snapshot: () => 0, restore: () => undefined }
    )
    const returnedCard = match.getState().players[0].hand[0]!

    const result = accept(
      match.dispatch({
        type: 'confirm-mulligan',
        participantId: HUMAN_ID,
        replaceInstanceIds: [returnedCard.instanceId]
      })
    )

    expect(result.events[0]).toMatchObject({
      type: 'mulligan-resolved',
      participantId: HUMAN_ID,
      returnedCards: [{ instanceId: returnedCard.instanceId }]
    })
    expect(result.state.phase).toBe('mulligan')
    expect(result.state.players[0].mulliganConfirmed).toBe(true)
    expect(result.state.players[0].hand).not.toContainEqual(
      expect.objectContaining({ instanceId: returnedCard.instanceId })
    )
    expect(result.state.players[1].mulliganConfirmed).toBe(false)
  })

  it('honors an explicit first-player seat override', () => {
    const match = createOpeningMatch(
      {
        seed: 1,
        startingParticipantId: OPPONENT_ID,
        participants: [
          {
            participantId: HUMAN_ID,
            controllerKind: 'human',
            heroId: asHeroId('jaina'),
            deckId: 'human-deck'
          },
          {
            participantId: OPPONENT_ID,
            controllerKind: 'human',
            heroId: asHeroId('rexxar'),
            deckId: 'opponent-deck'
          }
        ]
      },
      [deck('human-deck', 'jaina'), deck('opponent-deck', 'rexxar')],
      { next: () => 0.1, snapshot: () => 0, restore: () => undefined }
    )

    expect(match.getState()).toMatchObject({
      playerOneId: OPPONENT_ID,
      playerTwoId: HUMAN_ID,
      phase: 'mulligan'
    })
  })

  it('can skip mulligan while keeping both dealt hands and starting the turn', () => {
    const match = createOpeningMatch(
      {
        seed: 1,
        skipMulligan: true,
        participants: [
          {
            participantId: HUMAN_ID,
            controllerKind: 'human',
            heroId: asHeroId('jaina'),
            deckId: 'human-deck'
          },
          {
            participantId: OPPONENT_ID,
            controllerKind: 'human',
            heroId: asHeroId('rexxar'),
            deckId: 'opponent-deck'
          }
        ]
      },
      [deck('human-deck', 'jaina'), deck('opponent-deck', 'rexxar')],
      { next: () => 0.1, snapshot: () => 0, restore: () => undefined }
    )
    const state = match.getState()
    const playerOne = state.players[0]!
    const playerTwo = state.players[1]!

    expect(state.phase).toBe('turns')
    expect(state.activePlayerId).toBe(state.playerOneId)
    expect(playerOne.mulliganConfirmed).toBe(true)
    expect(playerTwo.mulliganConfirmed).toBe(true)
    expect(playerOne.hand).toHaveLength(4)
    expect(playerTwo.hand).toHaveLength(5)
    expect(playerOne.mana).toMatchObject({ available: 1, maximum: 1 })
    expect(playerOne.heroPower.available).toBe(true)
    expect(
      match.dispatch({
        type: 'confirm-mulligan',
        participantId: HUMAN_ID,
        replaceInstanceIds: []
      })
    ).toMatchObject({ accepted: false, code: 'wrong-phase' })
  })
})

describe('retired command boundary', () => {
  it('rejects legacy play and attack command names without changing state', () => {
    const match = startMatch('jaina')
    const before = match.getState()
    const legacyCommands: readonly unknown[] = [
      {
        type: 'play-minion',
        participantId: HUMAN_ID,
        cardInstanceId: 'missing',
        position: 0
      },
      {
        type: 'play-weapon',
        participantId: HUMAN_ID,
        cardInstanceId: 'missing'
      },
      { type: 'play-hero', participantId: HUMAN_ID, cardInstanceId: 'missing' },
      {
        type: 'attack-minion',
        participantId: HUMAN_ID,
        attackerInstanceId: 'missing',
        defenderInstanceId: 'missing'
      }
    ]
    for (const command of legacyCommands) {
      expect(match.dispatch(command)).toMatchObject({
        accepted: false,
        code: 'invalid-command'
      })
      expect(match.getState()).toEqual(before)
    }
  })
})

describe('non-mutating command preview', () => {
  it('returns the same result as dispatch without changing the live match', () => {
    const match = startMatch('rexxar')
    const command = { type: 'use-hero-power' as const, participantId: HUMAN_ID }
    const before = match.getState()

    const preview = match.preview(command)

    expect(match.getState()).toEqual(before)
    const dispatched = match.dispatch(command)
    expect(dispatched).toEqual(preview)
  })

  it('isolates multi-command sequences and mutable analysis forks', () => {
    const match = startMatch('rexxar')
    const before = match.getState()
    const commands = [
      { type: 'use-hero-power' as const, participantId: HUMAN_ID },
      { type: 'end-turn' as const, participantId: HUMAN_ID }
    ]

    const preview = match.previewSequence(commands)
    expect(preview.accepted).toBe(true)
    expect(match.getState()).toEqual(before)

    const analyzed = match.analyze((fork) => {
      for (const command of commands) expect(fork.dispatch(command).accepted).toBe(true)
      return fork.getState()
    })
    expect(analyzed).toEqual(preview.state)
    expect(match.getState()).toEqual(before)

    for (const command of commands) expect(match.dispatch(command).accepted).toBe(true)
    expect(match.getState()).toEqual(preview.state)
  })
})

describe('effect trace retention', () => {
  it('keeps effect traces out of normal matches', () => {
    const match = startMatch('rexxar')
    usePower(match)
    expect(match.getState()).not.toHaveProperty('effectTrace')
    expect(match.getEffectTrace?.()).toEqual([])
  })
})

describe('classic hero powers', () => {
  it('Shapeshift grants temporary Attack and persistent Armor', () => {
    const match = startMatch('malfurion')
    usePower(match)
    let human = match.getState().players[0]
    expect(human.hero).toMatchObject({ attack: 1, armor: 1 })

    accept(match.dispatch({ type: 'end-turn', participantId: HUMAN_ID }))
    human = match.getState().players[0]
    expect(human.hero).toMatchObject({ attack: 0, armor: 1 })
  })

  it('Steady Shot damages the enemy hero', () => {
    const match = startMatch('rexxar')
    const result = usePower(match)
    expect(match.getState().players[1].hero.health).toBe(28)
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'character-damaged', amount: 2 })
    )
  })

  it('Fireblast requires a valid target and can destroy a minion', () => {
    const match = startMatch('jaina')
    const missingTarget = match.dispatch({
      type: 'use-hero-power',
      participantId: HUMAN_ID
    })
    expect(missingTarget).toMatchObject({
      accepted: false,
      code: 'invalid-target'
    })
    expect(match.getState().players[0].mana.available).toBe(10)

    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: OPPONENT_ID,
        cardId: 'basic_silver_hand_recruit'
      })
    )
    const target = match.getState().players[1].board[0]
    expect(target).toBeDefined()
    const result = usePower(match, {
      kind: 'minion',
      participantId: OPPONENT_ID,
      instanceId: target!.instanceId
    })
    expect(match.getState().players[1].board).toHaveLength(0)
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'character-damaged', destroyed: true })
    )
  })

  it('Reinforce summons a Recruit and rejects a full board before spending mana', () => {
    const match = startMatch('uther')
    usePower(match)
    expect(match.getState().players[0].board[0]?.cardId).toBe(
      'basic_silver_hand_recruit'
    )

    const fullMatch = startMatch('uther')
    for (let index = 0; index < 7; index += 1) {
      accept(
        fullMatch.dispatch({
          type: 'dev-summon-minion',
          participantId: HUMAN_ID,
          cardId: 'basic_silver_hand_recruit'
        })
      )
    }
    const rejected = fullMatch.dispatch({
      type: 'use-hero-power',
      participantId: HUMAN_ID
    })
    expect(rejected).toMatchObject({ accepted: false, code: 'board-full' })
    expect(fullMatch.getState().players[0].mana.available).toBe(10)
    expect(fullMatch.getState().players[0].heroPower.available).toBe(true)
  })

  it('Lesser Heal targets either side and caps Health at maximum', () => {
    const match = startMatch('anduin')
    const result = usePower(match, {
      kind: 'hero',
      participantId: OPPONENT_ID
    })
    expect(match.getState().players[1].hero.health).toBe(30)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'character-healed',
        amount: 0,
        attemptedAmount: 2
      })
    )
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'history-action-resolved',
        action: 'hero-power',
        source: expect.objectContaining({
          heroPowerId: 'priest-lesser-heal',
          baseCost: 2,
          currentCost: 2
        })
      })
    )
  })

  it('Dagger Mastery equips a 1/2 Wicked Knife and replaces the old weapon', () => {
    const match = startMatch('valeera')
    usePower(match)
    const firstWeapon = match.getState().players[0].weapon
    expect(firstWeapon).toMatchObject({
      cardId: 'basic_wicked_knife',
      attack: 1,
      durability: 2
    })
    cycleBackToHuman(match)
    const result = usePower(match)
    expect(match.getState().players[0].weapon?.instanceId).not.toBe(
      firstWeapon?.instanceId
    )
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'weapon-equipped',
        replacedWeapon: expect.objectContaining({
          cardId: 'basic_wicked_knife'
        })
      })
    )
  })

  it('Totemic Call deterministically summons each missing basic Totem once', () => {
    const match = startMatch('thrall')
    for (let use = 0; use < 4; use += 1) {
      usePower(match)
      if (use < 3) cycleBackToHuman(match)
    }
    const totems = match.getState().players[0].board.map((minion) => minion.cardId)
    expect(new Set(totems).size).toBe(4)

    cycleBackToHuman(match)
    const rejected = match.dispatch({
      type: 'use-hero-power',
      participantId: HUMAN_ID
    })
    expect(rejected).toMatchObject({
      accepted: false,
      code: 'hero-power-unavailable'
    })
  })

  it('Life Tap draws and damages its owner', () => {
    const match = startMatch('guldan')
    const before = match.getState().players[0]
    const result = usePower(match)
    const after = match.getState().players[0]
    expect(after.hand).toHaveLength(before.hand.length + 1)
    expect(after.deck).toHaveLength(before.deck.length - 1)
    expect(after.hero.health).toBe(28)
    expect(
      result.events
        .filter(
          (event) =>
            event.type === 'hero-power-used' ||
            event.type === 'character-damaged' ||
            event.type === 'card-drawn'
        )
        .map((event) => event.type)
    ).toEqual(['hero-power-used', 'character-damaged', 'card-drawn'])
  })

  it('Life Tap burns its draw when the hand is full', () => {
    const match = startMatch('guldan')
    while (match.getState().players[0].hand.length < 10) {
      accept(
        match.dispatch({
          type: 'dev-add-card',
          participantId: HUMAN_ID,
          cardId: 'basic_acidic_swamp_ooze'
        })
      )
    }
    const before = match.getState().players[0]
    const result = usePower(match)
    const after = match.getState().players[0]
    expect(after.hand).toHaveLength(10)
    expect(after.deck).toHaveLength(before.deck.length - 1)
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'card-burned' })
    )
  })

  it('Life Tap and turn draws share escalating fatigue', () => {
    const match = startMatch('guldan')
    for (let cycle = 0; cycle < 26; cycle += 1) cycleBackToHuman(match)
    expect(match.getState().players[0].deck).toHaveLength(0)

    const result = usePower(match)
    const human = match.getState().players[0]
    expect(human.fatigueDamage).toBe(2)
    expect(human.hero.health).toBe(27)
    expect(result.events.map((event) => event.type)).toEqual([
      'hero-power-used',
      'character-damaged',
      'fatigue',
      'character-damaged',
      'history-action-resolved',
      'history-action-resolved'
    ])
    cycleBackToHuman(match)
    expect(match.getState().players[0]).toMatchObject({
      fatigueDamage: 3,
      hero: { health: 25 }
    })
  })

  it('Armor Up accumulates Armor that absorbs combat damage first', () => {
    const match = startMatch('garrosh')
    usePower(match)
    cycleBackToHuman(match)
    usePower(match)
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: OPPONENT_ID,
        cardId: 'basic_acidic_swamp_ooze'
      })
    )
    accept(match.dispatch({ type: 'end-turn', participantId: HUMAN_ID }))
    const attacker = match.getState().players[1].board[0]
    expect(attacker).toBeDefined()
    const attackResult = accept(
      match.dispatch({
        type: 'attack-character',
        participantId: OPPONENT_ID,
        attacker: { kind: 'minion', instanceId: attacker!.instanceId },
        defender: { kind: 'hero' }
      })
    )
    expect(match.getState().players[0].hero).toMatchObject({
      health: 30,
      armor: 1
    })
    const history = attackResult.events.find(
      (
        event
      ): event is Extract<OpeningMatchEvent, { type: 'history-action-resolved' }> =>
        event.type === 'history-action-resolved'
    )
    expect(history).toMatchObject({
      action: 'combat',
      source: {
        kind: 'minion',
        cardId: 'basic_acidic_swamp_ooze',
        participantId: OPPONENT_ID
      },
      outcomes: [
        {
          kind: 'damage',
          amount: 3,
          target: {
            kind: 'hero',
            participantId: HUMAN_ID,
            heroId: 'garrosh'
          }
        }
      ]
    })
  })
})

describe('combat rules', () => {
  it('does not let an equipped defending hero retaliate against a minion', () => {
    const match = startMatch('valeera')
    usePower(match)
    const weaponBefore = match.getState().players[0].weapon
    expect(weaponBefore).toMatchObject({ attack: 1, durability: 2 })
    if (!weaponBefore) throw new Error('Expected Dagger Mastery to equip a weapon.')

    accept(match.dispatch({ type: 'end-turn', participantId: HUMAN_ID }))
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: OPPONENT_ID,
        cardId: 'basic_stonetusk_boar'
      })
    )
    const attackerBefore = match.getState().players[1].board[0]
    expect(attackerBefore).toBeDefined()
    if (!attackerBefore) throw new Error('Expected the attacking minion on the board.')

    const result = accept(
      match.dispatch({
        type: 'attack-character',
        participantId: OPPONENT_ID,
        attacker: { kind: 'minion', instanceId: attackerBefore.instanceId },
        defender: { kind: 'hero' }
      })
    )
    const state = match.getState()
    const attackerAfter = state.players[1].board.find(
      (minion) => minion.instanceId === attackerBefore.instanceId
    )

    expect(state.players[0].hero.health).toBe(29)
    expect(attackerAfter?.health).toBe(attackerBefore.health)
    expect(state.players[0].weapon).toMatchObject({
      instanceId: weaponBefore.instanceId,
      durability: weaponBefore.durability
    })
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'combat-started',
        defender: expect.objectContaining({ attack: 0 })
      })
    )
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'character-combat-resolved',
        attacker: expect.objectContaining({
          healthBefore: attackerBefore.health,
          healthAfter: attackerBefore.health
        }),
        defender: expect.objectContaining({ attack: 0 })
      })
    )
  })
})

describe('match history', () => {
  function latestHistory(result: OpeningAcceptedResult): HistoryActionResolvedEvent {
    const history = result.events.find(
      (event): event is HistoryActionResolvedEvent =>
        event.type === 'history-action-resolved'
    )
    expect(history).toBeDefined()
    if (!history) throw new Error('Expected a history action event.')
    return history
  }

  it('captures effect-runtime spell targets for Fireball and Ice Lance', () => {
    const match = startMatch('jaina', 'garrosh')
    accept(
      match.dispatch({
        type: 'dev-add-card',
        participantId: HUMAN_ID,
        cardId: 'basic_fireball'
      })
    )
    const fireball = match
      .getState()
      .players[0]!.hand.find((card) => card.cardId === 'basic_fireball')
    expect(fireball).toBeDefined()
    const fireballHistory = latestHistory(
      accept(
        match.dispatch({
          type: 'play-card',
          participantId: HUMAN_ID,
          cardInstanceId: fireball!.instanceId,
          targets: [{ kind: 'hero', participantId: OPPONENT_ID }]
        })
      )
    )
    expect(fireballHistory.outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'damage',
        amount: 6,
        target: expect.objectContaining({
          kind: 'hero',
          participantId: OPPONENT_ID,
          heroId: 'garrosh'
        })
      })
    )

    accept(
      match.dispatch({
        type: 'dev-add-card',
        participantId: HUMAN_ID,
        cardId: 'classic_ice_lance'
      })
    )
    const iceLance = match
      .getState()
      .players[0]!.hand.find((card) => card.cardId === 'classic_ice_lance')
    expect(iceLance).toBeDefined()
    const iceLanceHistory = latestHistory(
      accept(
        match.dispatch({
          type: 'play-card',
          participantId: HUMAN_ID,
          cardInstanceId: iceLance!.instanceId,
          targets: [{ kind: 'hero', participantId: OPPONENT_ID }]
        })
      )
    )
    expect(iceLanceHistory.outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'freeze',
        target: expect.objectContaining({
          kind: 'hero',
          participantId: OPPONENT_ID
        })
      })
    )
  })

  it('records Baron Geddon and Doomsayer turn triggers', () => {
    const match = startMatch('jaina', 'garrosh')
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: HUMAN_ID,
        cardId: 'classic_baron_geddon'
      })
    )
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: OPPONENT_ID,
        cardId: 'basic_acidic_swamp_ooze'
      })
    )
    const geddonTurn = accept(
      match.dispatch({ type: 'end-turn', participantId: HUMAN_ID })
    )
    const geddonHistory = geddonTurn.events.find(
      (event): event is HistoryActionResolvedEvent =>
        event.type === 'history-action-resolved' &&
        event.source.cardId === 'classic_baron_geddon'
    )
    expect(geddonHistory?.action).toBe('trigger')
    expect(geddonHistory?.outcomes).toContainEqual(
      expect.objectContaining({ kind: 'damage', amount: 2 })
    )

    const geddonOpponentTurn = accept(
      match.dispatch({ type: 'end-turn', participantId: OPPONENT_ID })
    )
    expect(
      geddonOpponentTurn.events.some(
        (event) =>
          event.type === 'history-action-resolved' &&
          event.source.cardId === 'classic_baron_geddon'
      )
    ).toBe(false)

    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: HUMAN_ID,
        cardId: 'classic_doomsayer'
      })
    )
    const doomsayerOpponentTurn = accept(
      match.dispatch({ type: 'end-turn', participantId: HUMAN_ID })
    )
    expect(
      doomsayerOpponentTurn.events.some(
        (event) =>
          event.type === 'history-action-resolved' &&
          event.source.cardId === 'classic_doomsayer'
      )
    ).toBe(false)
    const doomsayerTurn = accept(
      match.dispatch({ type: 'end-turn', participantId: OPPONENT_ID })
    )
    const doomsayerHistory = doomsayerTurn.events.find(
      (event): event is HistoryActionResolvedEvent =>
        event.type === 'history-action-resolved' &&
        event.source.cardId === 'classic_doomsayer'
    )
    expect(doomsayerHistory?.action).toBe('trigger')
    expect(doomsayerHistory?.outcomes).toContainEqual(
      expect.objectContaining({ kind: 'destroy' })
    )
  })

  it('keeps explicitly global turn triggers active on either turn', () => {
    const match = startMatch('jaina', 'garrosh')
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: HUMAN_ID,
        cardId: 'classic_gruul'
      })
    )

    accept(match.dispatch({ type: 'end-turn', participantId: HUMAN_ID }))
    expect(match.getState().players[0].board[0]?.attack).toBe(8)

    accept(match.dispatch({ type: 'end-turn', participantId: OPPONENT_ID }))
    expect(match.getState().players[0].board[0]?.attack).toBe(9)
  })
})

describe('Hero cards', () => {
  it('Jaraxxus preserves Health, gains Armor, replaces the hero power, and equips Blood Fury', () => {
    const match = startMatch('guldan')
    usePower(match)
    cycleBackToHuman(match)
    accept(
      match.dispatch({
        type: 'dev-add-card',
        participantId: HUMAN_ID,
        cardId: 'classic_lord_jaraxxus'
      })
    )
    const jaraxxus = match
      .getState()
      .players[0].hand.find((card) => card.cardId === 'classic_lord_jaraxxus')
    expect(jaraxxus).toBeDefined()

    const result = accept(
      match.dispatch({
        type: 'play-card',
        participantId: HUMAN_ID,
        cardInstanceId: jaraxxus!.instanceId
      })
    )
    const player = match.getState().players[0]
    expect(player.heroId).toBe('jaraxxus')
    expect(player.hero).toMatchObject({ health: 28, maxHealth: 30, armor: 5 })
    expect(player.heroPower).toMatchObject({
      id: 'jaraxxus-inferno',
      available: true
    })
    expect(player.weapon).toMatchObject({
      cardId: 'classic_blood_fury',
      attack: 3,
      durability: 8
    })
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'hero-replaced', armorGained: 5 })
    )
  })
})

describe('public match projections', () => {
  it('masks private card identities while preserving the viewer hand', () => {
    const match = startMatch('jaina')
    const publicState = match.getPublicState!(HUMAN_ID)
    const ownPlayer = publicState.players.find(
      (player) => player.participantId === HUMAN_ID
    )!
    const opponentPlayer = publicState.players.find(
      (player) => player.participantId === OPPONENT_ID
    )!

    expect(ownPlayer.deck.every((card) => card.cardId === null)).toBe(true)
    expect(opponentPlayer.deck.every((card) => card.cardId === null)).toBe(true)
    expect(ownPlayer.hand.every((card) => card.cardId !== null)).toBe(true)
    expect(opponentPlayer.hand.every((card) => card.cardId === null)).toBe(true)
    expect(ownPlayer.hand[0]).not.toHaveProperty('knownTo')
  })

  it('masks opponent card-bearing events but reveals the viewer event', () => {
    const match = startMatch('jaina')
    const card = match.getState().players[1].hand[0]!
    const opponentEvent = {
      type: 'card-drawn' as const,
      participantId: OPPONENT_ID,
      card
    }
    const ownEvent = { ...opponentEvent, participantId: HUMAN_ID }
    const projected = match.getPublicEvents!(HUMAN_ID, [
      opponentEvent,
      ownEvent
    ] as OpeningMatchEvent[])

    expect(projected[0]).toMatchObject({ card: { cardId: null } })
    expect(projected[1]).toMatchObject({ card: { cardId: card.cardId } })
  })

  it('reveals a burned opponent card to every viewer', () => {
    const match = startMatch('jaina')
    const card = match.getState().players[1].hand[0]!
    const projected = match.getPublicEvents!(HUMAN_ID, [
      {
        type: 'card-burned',
        participantId: OPPONENT_ID,
        card
      }
    ] as OpeningMatchEvent[])

    expect(projected[0]).toMatchObject({ card: { cardId: card.cardId } })
  })

  it('masks opponent effect source and nested card payload identities', () => {
    const match = startMatch('jaina')
    const effectEvent: OpeningMatchEvent = {
      type: 'effect-resolved',
      revision: 1,
      sourceInstanceId: `${OPPONENT_ID}:secret:1`,
      sourceCardId: asCardId('basic_fireball'),
      controllerId: OPPONENT_ID,
      action: 'add-to-hand',
      actionPath: '.effects[0].actions[0]',
      data: {
        cardId: 'basic_fireball',
        nested: { cardId: 'basic_fireball' },
        card: { instanceId: 'hidden-card', cardId: asCardId('basic_fireball') }
      }
    }
    const projected = match.getPublicEvents!(HUMAN_ID, [effectEvent])
    expect(projected[0]).toMatchObject({
      sourceCardId: null,
      data: {
        cardId: null,
        nested: { cardId: null },
        card: { cardId: null }
      }
    })
  })
})

describe('history snapshots and causal entries', () => {
  function play(
    match: OpeningMatchInstance,
    cardId: string,
    targets?: readonly object[]
  ): OpeningAcceptedResult {
    accept(match.dispatch({ type: 'dev-add-card', participantId: HUMAN_ID, cardId }))
    setMana(match, HUMAN_ID)
    const card = match
      .getState()
      .players[0].hand.findLast((card) => card.cardId === cardId)!
    return accept(
      match.dispatch({
        type: 'play-card',
        participantId: HUMAN_ID,
        cardInstanceId: card.instanceId,
        targets,
        ...(CARD_CATALOG.require(asCardId(cardId)).type === 'Minion'
          ? { position: 0 }
          : {})
      })
    )
  }
  function summon(
    match: OpeningMatchInstance,
    cardId: string,
    participantId = OPPONENT_ID
  ): string {
    accept(match.dispatch({ type: 'dev-summon-minion', participantId, cardId }))
    return match
      .getState()
      .players.find((p) => p.participantId === participantId)!
      .board.at(-1)!.instanceId
  }
  function histories(
    result: OpeningAcceptedResult
  ): readonly HistoryActionResolvedEvent[] {
    return result.events.filter(
      (event): event is HistoryActionResolvedEvent =>
        event.type === 'history-action-resolved'
    )
  }
  it('records Elise shuffling the Map and Dream returning Elise', () => {
    const match = startMatch('jaina')
    const elise = play(match, 'league_of_explorers_elise_starseeker')
    expect(histories(elise)[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'shuffle-deck',
        target: expect.objectContaining({
          zone: 'deck',
          cardId: 'league_of_explorers_map_to_the_golden_monkey'
        })
      })
    )
    const id = elise.state.players[0].board[0].instanceId
    const dream = play(match, 'classic_dream', [
      { kind: 'minion', participantId: HUMAN_ID, instanceId: id }
    ])
    expect(histories(dream)[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'return-hand',
        target: expect.objectContaining({
          zone: 'hand',
          cardId: 'league_of_explorers_elise_starseeker'
        })
      })
    )
  })
  it('separates a weapon deathrattle and reactive draw from combat', () => {
    let match = startMatch('garrosh')
    play(match, 'naxxramas_deaths_bite')
    summon(match, 'classic_acolyte_of_pain', HUMAN_ID)
    const target = summon(match, 'naxxramas_loatheb')
    const checkpoint = match.getCheckpoint!()
    const state = checkpoint.state
    match = createOpeningMatchFromCheckpoint({
      ...checkpoint,
      state: {
        ...state,
        players: [
          {
            ...state.players[0],
            weapon: { ...state.players[0].weapon!, durability: 1 }
          },
          state.players[1]
        ]
      }
    })
    const result = accept(
      match.dispatch({
        type: 'attack-character',
        participantId: HUMAN_ID,
        attacker: { kind: 'hero' },
        defender: { kind: 'minion', instanceId: target }
      })
    )
    const entries = histories(result)
    expect(entries.map((entry) => entry.action)).toEqual([
      'combat',
      'trigger',
      'trigger'
    ])
    expect(entries[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'damage',
        amount: 4,
        target: expect.objectContaining({ id: target, health: 1 })
      })
    )
    expect(entries[1].source.cardId).toBe('naxxramas_deaths_bite')
    expect(entries[1].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'death',
        target: expect.objectContaining({ id: target, health: 0 })
      })
    )
    expect(entries[2].source.cardId).toBe('classic_acolyte_of_pain')
    expect(entries[2].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'draw',
        target: expect.objectContaining({
          cardId: 'basic_acidic_swamp_ooze',
          zone: 'hand'
        })
      })
    )
  })
  it('records armor absorption and immunity without inventing health damage', () => {
    const match = startMatch('jaina', 'garrosh')
    accept(
      match.dispatch({ type: 'dev-set-hero', participantId: OPPONENT_ID, armor: 10 })
    )
    const result = play(match, 'basic_fireball', [
      { kind: 'hero', participantId: OPPONENT_ID }
    ])
    expect(histories(result)[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'damage',
        amount: 6,
        armorDamage: 6,
        healthDamage: 0,
        target: expect.objectContaining({ health: 30, armor: 4 })
      })
    )
  })
  it('keeps effective attack, health and spell damage frozen after silence', () => {
    const match = startMatch('jaina')
    const id = summon(match, 'basic_ogre_magi', HUMAN_ID)
    const fireball = play(match, 'basic_fireball', [
      { kind: 'hero', participantId: OPPONENT_ID }
    ])
    const old = histories(fireball)[0]
    expect(old.source.rulesText).toContain('7')
    const silenced = play(match, 'classic_silence', [
      { kind: 'minion', participantId: HUMAN_ID, instanceId: id }
    ])
    expect(histories(silenced)[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'silence',
        target: expect.objectContaining({ silenced: true, spellDamage: 0 })
      })
    )
    expect(old.source.rulesText).toContain('7')
    expect(histories(fireball)[0]).toEqual(old)
  })
  it('shows new grants after silence without restoring native abilities', () => {
    const match = startMatch('jaina')
    const id = summon(match, 'basic_ogre_magi', HUMAN_ID)
    const target = { kind: 'minion', participantId: HUMAN_ID, instanceId: id }
    play(match, 'classic_silence', [target])
    const buff = play(match, 'basic_mark_of_the_wild', [target])
    const snapshot = histories(buff)[0].outcomes.findLast(
      (outcome) => outcome.target.id === id
    )!.target
    expect(snapshot).toMatchObject({
      attack: 6,
      health: 6,
      maxHealth: 6,
      silenced: true,
      spellDamage: 0
    })
    expect(snapshot.keywords).toContain('taunt')
    expect(snapshot.abilities).toContain('taunt')
  })
  it('records collateral aura changes under the played aura source', () => {
    const match = startMatch('jaina')
    const id = summon(match, 'basic_ogre_magi', HUMAN_ID)
    const result = play(match, 'basic_stormwind_champion')
    expect(histories(result)[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'state',
        target: expect.objectContaining({ id, attack: 5, health: 5, maxHealth: 5 })
      })
    )
  })
  it('reports both losing a shield and the next damage hit', () => {
    const match = startMatch('jaina')
    const id = summon(match, 'classic_argent_squire')
    const shield = play(match, 'basic_fireball', [
      { kind: 'minion', participantId: OPPONENT_ID, instanceId: id }
    ])
    expect(histories(shield)[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'shield-lost',
        target: expect.objectContaining({ divineShield: false, health: 1 })
      })
    )
    const lethal = play(match, 'basic_fireball', [
      { kind: 'minion', participantId: OPPONENT_ID, instanceId: id }
    ])
    expect(histories(lethal)[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'death',
        target: expect.objectContaining({ health: 0 })
      })
    )
  })
  it('keeps local Life Tap draws visible and private facts outside public events', () => {
    const match = startMatch('guldan')
    const result = usePower(match)
    const entry = histories(result)[0]
    expect(entry.outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'draw',
        target: expect.objectContaining({ cardId: 'basic_acidic_swamp_ooze' })
      })
    )
    const projected = getOpeningMatchPublicEvents(result.events, OPPONENT_ID)
    expect(projected.some((event) => event.type === 'history-effect-recorded')).toBe(
      false
    )
    const history = projected.find(
      (event) => event.type === 'history-action-resolved'
    ) as HistoryActionResolvedEvent
    expect(
      history.outcomes.find((outcome) => outcome.kind === 'draw')?.target.cardId
    ).toBeNull()
  })
})
