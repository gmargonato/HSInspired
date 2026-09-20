import { describe, expect, it } from 'vitest'
import {
  createMatchScenario,
  type MatchScenario
} from '../testing/match-scenario-builder'
import type { PlayerId } from '../match-types'
import type { BattlecryRepetitionStartedEvent, OpeningMatchEvent } from '../opening-match-types'

const NIGHTBLADE = 'basic_nightblade'
const YETI = 'basic_chillwind_yeti'
const BRANN = 'league_of_explorers_brann_bronzebeard'
const DRUID_OF_THE_FLAME = 'blackrock_mountain_druid_of_the_flame'

function battlecryStarted(
  events: readonly OpeningMatchEvent[]
): BattlecryRepetitionStartedEvent[] {
  return events.filter(
    (event): event is BattlecryRepetitionStartedEvent =>
      event.type === 'battlecry-repetition-started'
  )
}

function setup(seed = 423): {
  scenario: MatchScenario
  participantId: PlayerId
} {
  const scenario = createMatchScenario({ seed })
  scenario.confirmBothMulligans()
  const participantId = scenario.match.getState().activePlayerId!
  return { scenario, participantId }
}

function boardOf(scenario: MatchScenario, participantId: PlayerId) {
  return scenario.match
    .getState()
    .players.find((entry) => entry.participantId === participantId)!.board
}

function prepareHand(
  scenario: MatchScenario,
  participantId: PlayerId,
  cardId: string
) {
  expect(
    scenario.match.dispatch({ type: 'dev-add-card', participantId, cardId })
      .accepted
  ).toBe(true)
  expect(
    scenario.match
      .dispatch({ type: 'dev-set-mana', participantId, available: 10, maximum: 10 })
      .accepted
  ).toBe(true)
  return scenario.match
    .getState()
    .players.find((entry) => entry.participantId === participantId)!
    .hand.find((entry) => entry.cardId === cardId)!
}

function playMinion(
  scenario: MatchScenario,
  participantId: PlayerId,
  cardId: string
) {
  const card = prepareHand(scenario, participantId, cardId)
  const result = scenario.match.dispatch({
    type: 'play-card',
    participantId,
    cardInstanceId: card.instanceId,
    position: 0
  })
  expect(result.accepted).toBe(true)
  if (!result.accepted) throw new Error(result.message)
  return result
}

describe('Battlecry repetition boundary events', () => {
  it('announces a played Battlecry before its effects resolve', () => {
    const { scenario, participantId } = setup()
    const result = playMinion(scenario, participantId, NIGHTBLADE)

    const started = battlecryStarted(result.events)
    expect(started).toHaveLength(1)
    const played = boardOf(scenario, participantId).find(
      (minion) => minion.cardId === NIGHTBLADE
    )!
    expect(started[0]).toMatchObject({
      participantId,
      repetition: 0,
      repetitions: 1
    })
    expect(started[0]!.minion.instanceId).toBe(played.instanceId)

    const startedIndex = result.events.indexOf(started[0]!)
    const firstBattlecryEffect = result.events.findIndex(
      (event) =>
        event.type === 'effect-resolved' && event.actionPath.includes('battlecry')
    )
    expect(firstBattlecryEffect).toBeGreaterThan(-1)
    expect(startedIndex).toBeLessThan(firstBattlecryEffect)
  })

  it('replays the announcement for every Battlecry repetition under Brann', () => {
    const { scenario, participantId } = setup()
    expect(
      scenario.match
        .dispatch({ type: 'dev-summon-minion', participantId, cardId: BRANN })
        .accepted
    ).toBe(true)

    const result = playMinion(scenario, participantId, NIGHTBLADE)

    expect(
      battlecryStarted(result.events).map((event) => [
        event.repetition,
        event.repetitions
      ])
    ).toEqual([
      [0, 2],
      [1, 2]
    ])
  })

  it('does not announce minions without a Battlecry', () => {
    const { scenario, participantId } = setup()
    const result = playMinion(scenario, participantId, YETI)
    expect(battlecryStarted(result.events)).toEqual([])
  })

  it('announces a deferred after-placement Battlecry when the choice resolves', () => {
    const { scenario, participantId } = setup()
    const card = prepareHand(scenario, participantId, DRUID_OF_THE_FLAME)

    const play = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId,
      position: 0
    })
    expect(play.accepted).toBe(true)
    if (!play.accepted) return
    expect(battlecryStarted(play.events)).toEqual([])

    const choice = scenario.match.dispatch({
      type: 'choose-card-option',
      participantId,
      sourceCardInstanceId: card.instanceId,
      choice: 1
    })
    expect(choice.accepted).toBe(true)
    if (!choice.accepted) return

    const started = battlecryStarted(choice.events)
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({
      participantId,
      repetition: 0,
      repetitions: 1
    })
    expect(started[0]!.minion.instanceId).toBe(card.instanceId)
  })
})
