import { asHeroId } from '../content/cards'
import type { Deck } from '../decks'
import { describe, expect, it } from 'vitest'
import { asPlayerId, type MatchSetup } from './match-types'
import { createOpeningMatch, type OpeningCommandResult } from './opening-match'

const HUMAN_ID = asPlayerId('human-player')
const OPPONENT_ID = asPlayerId('opponent-player')

function accept(result: OpeningCommandResult): void {
  expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
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

function createStartedMatch(roll = 0.1) {
  const setup: MatchSetup = {
    seed: 1,
    startingParticipantId: HUMAN_ID,
    participants: [
      {
        participantId: HUMAN_ID,
        controllerKind: 'human',
        heroId: asHeroId('rexxar'),
        deckId: 'human-deck'
      },
      {
        participantId: OPPONENT_ID,
        controllerKind: 'ai',
        heroId: asHeroId('jaina'),
        deckId: 'opponent-deck'
      }
    ]
  }
  const match = createOpeningMatch(
    setup,
    [deck('human-deck', 'rexxar'), deck('opponent-deck', 'jaina')],
    { next: () => roll, snapshot: () => 0, restore: () => undefined }
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
  return match
}

describe('dev deck commands', () => {
  it('sets cost even when the remote player has a startup cost override', () => {
    const match = createStartedMatch(0.7)
    expect(match.getState().players[1].heroPowerCostOverride).toBe(1)
    accept(
      match.dispatch({
        type: 'dev-set-hero-power',
        participantId: OPPONENT_ID,
        cost: 3
      })
    )
    expect(match.getState().players[1].heroPower.cost).toBe(3)
    accept(
      match.dispatch({
        type: 'dev-set-hero-power',
        participantId: OPPONENT_ID,
        available: true
      })
    )
    expect(match.getState().players[1].heroPower.cost).toBe(3)
  })

  it('resets a used hero power for another paid use in the same turn', () => {
    const match = createStartedMatch()
    accept(
      match.dispatch({
        type: 'dev-set-mana',
        participantId: HUMAN_ID,
        available: 10,
        maximum: 10
      })
    )
    accept(match.dispatch({ type: 'use-hero-power', participantId: HUMAN_ID }))
    expect(match.getLegality!(HUMAN_ID).legalHeroPower).toBe(false)
    const before = match.getState()
    const reset = match.dispatch({
      type: 'dev-set-hero-power',
      participantId: HUMAN_ID,
      available: true
    })
    accept(reset)
    expect(reset.state.players[0].heroPower).toMatchObject({
      available: true,
      usesThisTurn: 0
    })
    expect(reset.state.players[0].mana).toEqual(before.players[0].mana)
    expect(reset.state.players[1]).toEqual(before.players[1])
    expect(match.getLegality!(HUMAN_ID).legalHeroPower).toBe(true)
    accept(match.dispatch({ type: 'use-hero-power', participantId: HUMAN_ID }))
    expect(match.getState().players[0].mana.available).toBe(6)
  })

  it.each([
    [undefined, 1],
    ['the_grand_tournament_garrison_commander', 2],
    ['the_grand_tournament_coldarra_drake', 0]
  ] as const)(
    'consumes the current allowance with %s and survives recalculation',
    (cardId, limit) => {
      const match = createStartedMatch()
      accept(
        match.dispatch({
          type: 'dev-set-mana',
          participantId: HUMAN_ID,
          available: 10,
          maximum: 10
        })
      )
      if (cardId)
        accept(
          match.dispatch({ type: 'dev-summon-minion', participantId: HUMAN_ID, cardId })
        )
      accept(
        match.dispatch({
          type: 'dev-set-hero-power',
          participantId: HUMAN_ID,
          available: false
        })
      )
      expect(match.getState().players[0].heroPower).toMatchObject({
        available: false,
        usesThisTurn: limit
      })
      expect(match.getLegality!(HUMAN_ID).legalHeroPower).toBe(false)
      accept(
        match.dispatch({
          type: 'dev-summon-minion',
          participantId: HUMAN_ID,
          cardId: 'basic_acidic_swamp_ooze'
        })
      )
      expect(
        match.dispatch({ type: 'use-hero-power', participantId: HUMAN_ID })
      ).toMatchObject({ accepted: false, code: 'hero-power-unavailable' })
      accept(
        match.dispatch({
          type: 'dev-set-hero-power',
          participantId: HUMAN_ID,
          available: true
        })
      )
      expect(match.getLegality!(HUMAN_ID).legalHeroPower).toBe(true)
    }
  )

  it('preserves normal restrictions and only resets the selected player', () => {
    const match = createStartedMatch()
    const local = match.getState().players[0]
    accept(
      match.dispatch({
        type: 'dev-set-hero-power',
        participantId: OPPONENT_ID,
        available: false
      })
    )
    expect(match.getState().players[0]).toEqual(local)
    expect(match.getState().players[1].heroPower.available).toBe(false)
    accept(
      match.dispatch({
        type: 'dev-set-hero-power',
        participantId: OPPONENT_ID,
        available: true
      })
    )
    expect(match.getState().players[1].heroPower.available).toBe(true)
    expect(match.getLegality!(OPPONENT_ID).legalHeroPower).toBe(false)
    accept(
      match.dispatch({
        type: 'dev-set-hero-power',
        participantId: HUMAN_ID,
        available: true
      })
    )
    expect(match.getLegality!(HUMAN_ID).legalHeroPower).toBe(false)
    accept(
      match.dispatch({
        type: 'dev-set-mana',
        participantId: HUMAN_ID,
        available: 10,
        maximum: 10
      })
    )
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: OPPONENT_ID,
        cardId: 'knights_of_the_frozen_throne_mindbreaker'
      })
    )
    const reset = match.dispatch({
      type: 'dev-set-hero-power',
      participantId: HUMAN_ID,
      available: true
    })
    accept(reset)
    expect(reset.state.players[0].heroPower).toMatchObject({
      available: false,
      usesThisTurn: 0
    })
    expect(match.getLegality!(HUMAN_ID).legalHeroPower).toBe(false)
  })

  it('changes cost independently of usage and preserves discounted base cost on reset', () => {
    const match = createStartedMatch()
    accept(
      match.dispatch({
        type: 'dev-set-hero-power',
        participantId: HUMAN_ID,
        available: false
      })
    )
    accept(
      match.dispatch({ type: 'dev-set-hero-power', participantId: HUMAN_ID, cost: 0 })
    )
    expect(match.getState().players[0].heroPower).toMatchObject({
      cost: 0,
      baseCost: 0,
      available: false,
      usesThisTurn: 1
    })
    accept(
      match.dispatch({ type: 'dev-set-hero-power', participantId: HUMAN_ID, cost: 2 })
    )
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: HUMAN_ID,
        cardId: 'the_grand_tournament_maiden_of_the_lake'
      })
    )
    const before = match.getState().players[0].heroPower
    expect(before.cost).toBe(1)
    accept(
      match.dispatch({
        type: 'dev-set-hero-power',
        participantId: HUMAN_ID,
        available: true
      })
    )
    const after = match.getState().players[0].heroPower
    expect(after.cost).toBe(before.cost)
    expect(after.baseCost).toBe(before.baseCost)
    accept(
      match.dispatch({ type: 'dev-clear-zone', participantId: HUMAN_ID, zone: 'board' })
    )
    expect(match.getLegality!(HUMAN_ID).legalHeroPower).toBe(false)
  })

  it('destroys only the selected player deck', () => {
    const match = createStartedMatch()
    const before = match.getState()

    const result = match.dispatch({
      type: 'dev-modify-deck',
      participantId: OPPONENT_ID,
      action: 'destroy'
    })

    accept(result)
    const state = match.getState()
    expect(state.players[0].deck).toHaveLength(before.players[0].deck.length)
    expect(state.players[1].deck).toHaveLength(0)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'dev-deck-modified',
        participantId: OPPONENT_ID,
        action: 'destroy',
        deckCount: 0
      })
    )
  })

  it('refills a selected deck with a fresh full set of card instances', () => {
    const match = createStartedMatch()
    const before = match.getState().players[0]
    accept(
      match.dispatch({
        type: 'dev-modify-deck',
        participantId: HUMAN_ID,
        action: 'destroy'
      })
    )

    const result = match.dispatch({
      type: 'dev-modify-deck',
      participantId: HUMAN_ID,
      action: 'refill'
    })

    accept(result)
    const after = match.getState().players[0]
    expect(after.deck).toHaveLength(30)
    expect(after.deck.every((card) => card.cardId === 'basic_acidic_swamp_ooze')).toBe(
      true
    )
    expect(new Set(after.deck.map((card) => card.instanceId)).size).toBe(30)
    expect(
      after.deck.some((card) =>
        before.hand.some((handCard) => handCard.instanceId === card.instanceId)
      )
    ).toBe(false)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'dev-deck-modified',
        participantId: HUMAN_ID,
        action: 'refill',
        deckCount: 30
      })
    )
  })

  it('rejects deck changes before turns begin', () => {
    const setup: MatchSetup = {
      participants: [
        {
          participantId: HUMAN_ID,
          controllerKind: 'human',
          heroId: asHeroId('rexxar'),
          deckId: 'human-deck'
        },
        {
          participantId: OPPONENT_ID,
          controllerKind: 'ai',
          heroId: asHeroId('jaina'),
          deckId: 'opponent-deck'
        }
      ]
    }
    const match = createOpeningMatch(setup, [
      deck('human-deck', 'rexxar'),
      deck('opponent-deck', 'jaina')
    ])

    expect(
      match.dispatch({
        type: 'dev-modify-deck',
        participantId: HUMAN_ID,
        action: 'destroy'
      })
    ).toMatchObject({ accepted: false, code: 'wrong-phase' })
  })

  it('updates hero, power, mana, fatigue, zones, and weapons for the selected player', () => {
    const match = createStartedMatch()
    accept(
      match.dispatch({
        type: 'dev-set-hero',
        participantId: HUMAN_ID,
        health: 12,
        armor: 5,
        attack: 2
      })
    )
    accept(
      match.dispatch({
        type: 'dev-set-hero-power',
        participantId: HUMAN_ID,
        cost: 0,
        available: false
      })
    )
    accept(
      match.dispatch({
        type: 'dev-set-fatigue',
        participantId: HUMAN_ID,
        nextDamage: 5
      })
    )
    accept(
      match.dispatch({ type: 'dev-clear-zone', participantId: HUMAN_ID, zone: 'hand' })
    )
    accept(
      match.dispatch({
        type: 'dev-set-mana',
        participantId: HUMAN_ID,
        available: 10,
        maximum: 10
      })
    )
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: HUMAN_ID,
        cardId: 'basic_acidic_swamp_ooze'
      })
    )
    accept(
      match.dispatch({ type: 'dev-clear-zone', participantId: HUMAN_ID, zone: 'board' })
    )
    accept(
      match.dispatch({
        type: 'dev-add-card',
        participantId: HUMAN_ID,
        cardId: 'basic_wicked_knife'
      })
    )
    const weapon = match.getState().players[0].hand[0]!
    accept(
      match.dispatch({
        type: 'play-card',
        participantId: HUMAN_ID,
        cardInstanceId: weapon.instanceId
      })
    )
    expect(match.getState().players[0].weapon).toMatchObject({
      cardId: 'basic_wicked_knife'
    })
    accept(match.dispatch({ type: 'dev-remove-weapon', participantId: HUMAN_ID }))

    const player = match.getState().players[0]
    expect(player.hero).toMatchObject({ health: 12, armor: 5, attack: 2 })
    expect(player.heroPower).toMatchObject({ cost: 0, available: false })
    expect(player.fatigueDamage).toBe(5)
    expect(player.hand).toHaveLength(0)
    expect(player.board).toHaveLength(0)
    expect(player.mana).toMatchObject({ available: 9, maximum: 10 })
    expect(player.weapon).toBeNull()
  })

  it('draws for the selected player and turns an empty-deck draw into fatigue', () => {
    const match = createStartedMatch()
    const before = match.getState().players[1]
    const draw = match.dispatch({ type: 'dev-draw', participantId: OPPONENT_ID })
    accept(draw)
    expect(match.getState().players[1].hand).toHaveLength(before.hand.length + 1)

    accept(
      match.dispatch({
        type: 'dev-modify-deck',
        participantId: OPPONENT_ID,
        action: 'destroy'
      })
    )
    const fatigue = match.dispatch({ type: 'dev-draw', participantId: OPPONENT_ID })
    accept(fatigue)
    expect(fatigue.events).toContainEqual(expect.objectContaining({ type: 'fatigue' }))
  })
})
