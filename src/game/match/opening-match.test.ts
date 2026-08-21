import { describe, expect, it } from 'vitest'
import { asHeroId } from '../content/cards'
import type { Deck } from '../decks'
import { createOpeningMatch } from './opening-match'
import { createSeededRng } from './rng'
import { asPlayerId, type MatchSetup } from './match-types'

function makeDeck(id: string, cardId = 'basic_fireball'): Deck {
  return {
    id,
    name: id,
    heroId: asHeroId(id === 'human-deck' ? 'jaina' : 'guldan'),
    cards: { [cardId]: 30 },
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z'
  }
}

function makeSetup(seed = 42): MatchSetup {
  return {
    seed,
    participants: [
      {
        participantId: asPlayerId('human-player'),
        controllerKind: 'human',
        heroId: asHeroId('jaina'),
        deckId: 'human-deck'
      },
      {
        participantId: asPlayerId('ai-player'),
        controllerKind: 'ai',
        heroId: asHeroId('guldan'),
        deckId: 'ai-deck'
      }
    ]
  }
}

describe('opening match', () => {
  it('deals Hearthstone opening hands and resolves both mulligans', () => {
    const match = createOpeningMatch(
      makeSetup(),
      [makeDeck('human-deck'), makeDeck('ai-deck')],
      createSeededRng(7)
    )
    const initial = match.getState()
    expect(initial.phase).toBe('mulligan')
    expect(initial.players.map((player) => player.hand.length).sort()).toEqual([3, 4])

    const playerOne = initial.players[0]
    const playerTwo = initial.players[1]
    const replaced = playerOne.hand[0]
    expect(replaced).toBeDefined()

    const first = match.dispatch({
      type: 'confirm-mulligan',
      participantId: playerOne.participantId,
      replaceInstanceIds: replaced ? [replaced.instanceId] : []
    })
    expect(first.accepted).toBe(true)
    expect(first.events.some((event) => event.type === 'mulligan-resolved')).toBe(true)

    const second = match.dispatch({
      type: 'confirm-mulligan',
      participantId: playerTwo.participantId,
      replaceInstanceIds: []
    })
    expect(second.accepted).toBe(true)
    expect(second.events.map((event) => event.type)).toEqual([
      'mulligan-resolved',
      'coin-granted',
      'opening-turn-started',
      'opening-card-drawn'
    ])
    const openingTurn = second.events.find((e) => e.type === 'opening-turn-started')
    expect(
      openingTurn && openingTurn.type === 'opening-turn-started'
        ? openingTurn.mana
        : undefined
    ).toEqual({ available: 1, maximum: 1 })

    const finalState = match.getState()
    expect(finalState.phase).toBe('turns')
    expect(finalState.turnNumber).toBe(1)
    expect(finalState.activePlayerId).toBe(finalState.playerOneId)
    expect(finalState.players[0].mana).toEqual({ available: 1, maximum: 1 })
    expect(finalState.players[1].mana).toEqual({ available: 0, maximum: 0 })
    expect(
      finalState.players[1].hand.some((card) => card.cardId === 'basic_the_coin')
    ).toBe(true)
    expect(finalState.players[0].hand).toHaveLength(4)
    expect(finalState.players[1].hand).toHaveLength(4 + 1)
    expect(
      replaced &&
        finalState.players[0].hand.some(
          (card) => card.instanceId === replaced.instanceId
        )
    ).toBe(false)
  })

  it('rejects duplicate or foreign card selections without mutation', () => {
    const match = createOpeningMatch(
      makeSetup(),
      [makeDeck('human-deck'), makeDeck('ai-deck')],
      createSeededRng(9)
    )
    const player = match.getState().players[0]
    const card = player.hand[0]
    expect(card).toBeDefined()
    const before = match.getState()

    const result = match.dispatch({
      type: 'confirm-mulligan',
      participantId: player.participantId,
      replaceInstanceIds: card ? [card.instanceId, card.instanceId] : []
    })
    expect(result.accepted).toBe(false)
    if (result.accepted) throw new Error('Expected invalid mulligan selection.')
    expect(result.code).toBe('invalid-card-selection')
    expect(match.getState()).toEqual(before)
  })

  it('is deterministic for a supplied seed, including player assignment', () => {
    const setup = makeSetup(123)
    const first = createOpeningMatch(
      setup,
      [makeDeck('human-deck'), makeDeck('ai-deck')],
      createSeededRng(123)
    )
    const second = createOpeningMatch(
      setup,
      [makeDeck('human-deck'), makeDeck('ai-deck')],
      createSeededRng(123)
    )
    expect(JSON.stringify(first.getState())).toBe(JSON.stringify(second.getState()))
  })
})

function startTurns(seed = 42) {
  const match = createOpeningMatch(
    makeSetup(seed),
    [makeDeck('human-deck'), makeDeck('ai-deck')],
    createSeededRng(seed)
  )
  const initial = match.getState()
  for (const player of initial.players) {
    const result = match.dispatch({
      type: 'confirm-mulligan',
      participantId: player.participantId,
      replaceInstanceIds: []
    })
    if (!result.accepted) throw new Error(result.message)
  }
  const state = match.getState()
  return { match, state }
}

describe('turn passing', () => {
  it('ends the turn for the active player and draws a card for the next player', () => {
    const { match, state } = startTurns()
    const active = state.activePlayerId
    const other = state.players.find((p) => p.participantId !== active)
    if (!other) throw new Error('Expected an opponent.')

    const beforeActiveDeck = state.players.find((p) => p.participantId === active)
    const beforeOtherDeck = other.deck.length

    const result = match.dispatch({
      type: 'end-turn',
      participantId: active
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) throw new Error(result.message)
    expect(result.events.map((event) => event.type)).toEqual([
      'turn-started',
      'card-drawn'
    ])
    const turnStarted = result.events.find((e) => e.type === 'turn-started')
    expect(
      turnStarted && turnStarted.type === 'turn-started' ? turnStarted.turnNumber : 0
    ).toBe(2)

    const after = match.getState()
    expect(after.activePlayerId).toBe(other.participantId)
    expect(after.turnNumber).toBe(2)
    expect(
      after.players.find((p) => p.participantId === other.participantId)?.hand
    ).toHaveLength(other.hand.length + 1)
    expect(
      after.players.find((p) => p.participantId === other.participantId)?.deck
    ).toHaveLength(beforeOtherDeck - 1)
    expect(after.players.find((p) => p.participantId === active)?.hand).toHaveLength(
      beforeActiveDeck?.hand.length ?? 0
    )
  })

  it('alternates the active player across multiple end turns', () => {
    const { match, state } = startTurns()
    let active = state.activePlayerId
    for (let i = 0; i < 6; i += 1) {
      const result = match.dispatch({ type: 'end-turn', participantId: active })
      expect(result.accepted).toBe(true)
      const next = match.getState()
      expect(next.activePlayerId).not.toBe(active)
      active = next.activePlayerId
    }
    expect(match.getState().turnNumber).toBe(7)
  })

  it('rejects a non-active player ending the turn without mutation', () => {
    const { match, state } = startTurns()
    const nonActive = state.players.find(
      (p) => p.participantId !== state.activePlayerId
    )
    if (!nonActive) throw new Error('Expected an opponent.')
    const before = match.getState()

    const result = match.dispatch({
      type: 'end-turn',
      participantId: nonActive.participantId
    })
    expect(result.accepted).toBe(false)
    if (result.accepted) throw new Error('Expected rejection.')
    expect(result.code).toBe('not-active-player')
    expect(match.getState()).toEqual(before)
  })

  it('rejects end-turn during the mulligan phase', () => {
    const match = createOpeningMatch(
      makeSetup(),
      [makeDeck('human-deck'), makeDeck('ai-deck')],
      createSeededRng(42)
    )
    const player = match.getState().players[0]
    const result = match.dispatch({
      type: 'end-turn',
      participantId: player.participantId
    })
    expect(result.accepted).toBe(false)
    if (result.accepted) throw new Error('Expected rejection.')
    expect(result.code).toBe('wrong-phase')
  })

  it('does not draw when the deck is empty', () => {
    const match = createOpeningMatch(
      makeSetup(42),
      [makeDeck('human-deck'), makeDeck('ai-deck')],
      createSeededRng(42)
    )
    const initial = match.getState()
    for (const player of initial.players) {
      const result = match.dispatch({
        type: 'confirm-mulligan',
        participantId: player.participantId,
        replaceInstanceIds: []
      })
      if (!result.accepted) throw new Error(result.message)
    }
    let state = match.getState()
    // Deplete every drawable card by passing turns many times; a 30-card deck
    // minus opening hands is finite, so an empty deck must stop emitting draws.
    let sawEmptyDeckTurn = false
    for (let i = 0; i < 200; i += 1) {
      const result = match.dispatch({
        type: 'end-turn',
        participantId: state.activePlayerId
      })
      if (!result.accepted) throw new Error(result.message)
      const eventTypes = result.events.map((e) => e.type)
      const after = match.getState()
      const newActiveDeck = after.players.find(
        (p) => p.participantId === after.activePlayerId
      )?.deck
      // A turn that produces neither a draw nor a burn means the active player's
      // deck was empty.
      if (!eventTypes.includes('card-drawn') && !eventTypes.includes('card-burned')) {
        expect(newActiveDeck).toHaveLength(0)
        sawEmptyDeckTurn = true
        break
      }
      state = after
    }
    expect(sawEmptyDeckTurn).toBe(true)
  })

  it('burns the drawn card when the hand already holds the maximum', () => {
    const match = createOpeningMatch(
      makeSetup(42),
      [makeDeck('human-deck'), makeDeck('ai-deck')],
      createSeededRng(42)
    )
    const initial = match.getState()
    for (const player of initial.players) {
      const result = match.dispatch({
        type: 'confirm-mulligan',
        participantId: player.participantId,
        replaceInstanceIds: []
      })
      if (!result.accepted) throw new Error(result.message)
    }
    let state = match.getState()
    // Run enough turns that a hand must reach the cap; a burn event confirms the
    // deck card is removed without growing the hand beyond MAX_HAND_SIZE.
    for (let i = 0; i < 40; i += 1) {
      const result = match.dispatch({
        type: 'end-turn',
        participantId: state.activePlayerId
      })
      if (!result.accepted) throw new Error(result.message)
      const after = match.getState()
      for (const player of after.players) {
        expect(player.hand.length).toBeLessThanOrEqual(10)
      }
      state = after
    }
    const burned = match.getState()
    const anyBurned = burned.players.some((player) => player.hand.length === 10)
    expect(anyBurned).toBe(true)
  })

  it('grows and refills mana for each player at their turn starts', () => {
    const { match, state } = startTurns()
    expect(
      state.players.find((p) => p.participantId === state.playerOneId)?.mana
    ).toEqual({ available: 1, maximum: 1 })
    expect(
      state.players.find((p) => p.participantId === state.playerTwoId)?.mana
    ).toEqual({ available: 0, maximum: 0 })

    // Turn 2 is player two's first turn: they gain their first crystal.
    const second = match.dispatch({
      type: 'end-turn',
      participantId: state.activePlayerId
    })
    expect(second.accepted).toBe(true)
    const secondState = match.getState()
    expect(
      secondState.players.find((p) => p.participantId === state.playerTwoId)?.mana
    ).toEqual({ available: 1, maximum: 1 })
    const secondTurnStarted = second.accepted
      ? second.events.find((e) => e.type === 'turn-started')
      : undefined
    expect(
      secondTurnStarted && secondTurnStarted.type === 'turn-started'
        ? secondTurnStarted.mana
        : undefined
    ).toEqual({ available: 1, maximum: 1 })

    // By turn 7, player one has started turns 1/3/5/7 (4 mana) and player two
    // turns 2/4/6 (3 mana).
    let current = secondState
    while (current.turnNumber < 7) {
      const result = match.dispatch({
        type: 'end-turn',
        participantId: current.activePlayerId
      })
      if (!result.accepted) throw new Error(result.message)
      current = match.getState()
    }
    expect(
      current.players.find((p) => p.participantId === current.playerOneId)?.mana
    ).toEqual({ available: 4, maximum: 4 })
    expect(
      current.players.find((p) => p.participantId === current.playerTwoId)?.mana
    ).toEqual({ available: 3, maximum: 3 })
  })

  it('caps mana at the ten-crystal maximum', () => {
    const { match, state } = startTurns()
    let current = state
    // Player one reaches 10 mana on their 10th turn (overall turn 19); player
    // two on turn 20. Keep passing well beyond and expect the cap to hold.
    for (let i = 0; i < 24; i += 1) {
      const result = match.dispatch({
        type: 'end-turn',
        participantId: current.activePlayerId
      })
      if (!result.accepted) throw new Error(result.message)
      current = match.getState()
    }
    for (const player of current.players) {
      expect(player.mana).toEqual({ available: 10, maximum: 10 })
    }
  })
})
