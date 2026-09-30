import { describe, expect, it } from 'vitest'
import { createMatchScenario } from '../testing/match-scenario-builder'

function setup(cardId: string) {
  const scenario = createMatchScenario()
  scenario.confirmBothMulligans()
  const { match } = scenario
  const id = match.getState().activePlayerId!
  const enemy = scenario.participants.find((value) => value !== id)!
  const player = () =>
    match.getState().players.find((value) => value.participantId === id)!
  expect(
    match.dispatch({
      type: 'dev-set-mana',
      participantId: id,
      available: 10,
      maximum: 10
    }).accepted
  ).toBe(true)
  expect(
    match.dispatch({ type: 'dev-add-card', participantId: id, cardId }).accepted
  ).toBe(true)
  const card = player().hand.find((value) => value.cardId === cardId)!
  const preview = () => match.getPlayInput!(id, card.instanceId)!.battlecryConditions
  return { match, id, enemy, player, card, preview }
}

describe('battlecry hand-condition preview', () => {
  it.each([
    'blackrock_mountain_blackwing_corruptor',
    'one_night_in_karazhan_book_wyrm'
  ])(
    '%s excludes itself and board Dragons while preserving a body-only play',
    (cardId) => {
      const { match, id, enemy, card, preview } = setup(cardId)
      expect(
        match.dispatch({
          type: 'dev-summon-minion',
          participantId: id,
          cardId: 'classic_twilight_drake'
        }).accepted
      ).toBe(true)
      expect(
        match.dispatch({
          type: 'dev-summon-minion',
          participantId: enemy,
          cardId: 'classic_doomsayer'
        }).accepted
      ).toBe(true)
      const before = structuredClone(match.getState())
      expect(preview()).toEqual([
        expect.objectContaining({ status: 'not-met', qualifyingCardInstanceIds: [] })
      ])
      expect(match.getState()).toEqual(before)
      expect(
        match.dispatch({
          type: 'play-card',
          participantId: id,
          cardInstanceId: card.instanceId,
          position: 0
        }).accepted
      ).toBe(true)
      expect(
        match.getState().players.find((value) => value.participantId === enemy)!
          .board[0]
      ).toMatchObject({ cardId: 'classic_doomsayer', health: 7 })
    }
  )

  it.each([
    'blackrock_mountain_blackwing_corruptor',
    'one_night_in_karazhan_book_wyrm'
  ])(
    '%s identifies a remaining hand Dragon and the engine resolves its effect',
    (cardId) => {
      const { match, id, enemy, card, player, preview } = setup(cardId)
      expect(
        match.dispatch({
          type: 'dev-add-card',
          participantId: id,
          cardId: 'classic_twilight_drake'
        }).accepted
      ).toBe(true)
      const dragon = player().hand.find(
        (value) => value.cardId === 'classic_twilight_drake'
      )!
      expect(preview()).toEqual([
        expect.objectContaining({
          status: 'met',
          qualifyingCardInstanceIds: [dragon.instanceId]
        })
      ])
      expect(
        match.dispatch({
          type: 'dev-summon-minion',
          participantId: enemy,
          cardId: 'classic_doomsayer'
        }).accepted
      ).toBe(true)
      const target = match
        .getState()
        .players.find((value) => value.participantId === enemy)!.board[0]!
      expect(
        match.dispatch({
          type: 'play-card',
          participantId: id,
          cardInstanceId: card.instanceId,
          position: 0,
          targets: [
            { kind: 'minion', participantId: enemy, instanceId: target.instanceId }
          ]
        }).accepted
      ).toBe(true)
      const board = match
        .getState()
        .players.find((value) => value.participantId === enemy)!.board
      if (cardId === 'one_night_in_karazhan_book_wyrm') expect(board).toHaveLength(0)
      else expect(board[0]!.health).toBe(4)
    }
  )

  it('refreshes when the enabling Dragon leaves the hand', () => {
    const { match, id, player, preview } = setup('one_night_in_karazhan_book_wyrm')
    expect(
      match.dispatch({
        type: 'dev-add-card',
        participantId: id,
        cardId: 'classic_twilight_drake'
      }).accepted
    ).toBe(true)
    const dragon = player().hand.find(
      (value) => value.cardId === 'classic_twilight_drake'
    )!
    expect(preview()![0]!.status).toBe('met')
    expect(
      match.dispatch({
        type: 'play-card',
        participantId: id,
        cardInstanceId: dragon.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    expect(preview()![0]!.status).toBe('not-met')
  })

  it('marks unsupported conditions unknown instead of guessing', () => {
    const { preview } = setup('league_of_explorers_reno_jackson')
    expect(preview()).toEqual([expect.objectContaining({ status: 'unknown' })])
  })
})
