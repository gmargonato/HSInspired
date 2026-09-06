import { describe, expect, it } from 'vitest'
import { asHeroId } from '../content/cards'
import type { Deck } from '../decks'
import {
  asPlayerId,
  createOpeningMatch,
  createOpeningMatchFromCheckpoint,
  type MatchSetup
} from '.'

const humanId = asPlayerId('checkpoint-human')
const aiId = asPlayerId('checkpoint-ai')

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

describe('opening match checkpoints', () => {
  it('does not reuse derived query state across hypothetical branches with equal revisions', () => {
    const decks = [deck('branch-human-deck', 'jaina'), deck('branch-ai-deck', 'guldan')]
    const setup: MatchSetup = {
      seed: 271828,
      participants: [
        {
          participantId: humanId,
          controllerKind: 'human',
          heroId: decks[0]!.heroId,
          deckId: decks[0]!.id
        },
        {
          participantId: aiId,
          controllerKind: 'ai',
          heroId: decks[1]!.heroId,
          deckId: decks[1]!.id
        }
      ]
    }
    const match = createOpeningMatch(setup, decks)
    for (const participantId of [humanId, aiId]) {
      expect(
        match.dispatch({
          type: 'confirm-mulligan',
          participantId,
          replaceInstanceIds: []
        }).accepted
      ).toBe(true)
    }
    const activePlayerId = match.getState().activePlayerId!
    expect(
      match.dispatch({
        type: 'dev-set-mana',
        participantId: activePlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      match.dispatch({
        type: 'dev-add-card',
        participantId: activePlayerId,
        cardId: 'basic_frost_nova'
      }).accepted
    ).toBe(true)

    const baseline = match.getState()
    const activePlayerIndex = baseline.players.findIndex(
      (player) => player.participantId === activePlayerId
    )
    const ooze = baseline.players[activePlayerIndex].hand.find(
      (card) => card.cardId === 'basic_acidic_swamp_ooze'
    )!
    const frostNova = baseline.players[activePlayerIndex].hand.find(
      (card) => card.cardId === 'basic_frost_nova'
    )!

    const oozeBranch = match.analyze((fork) => {
      const result = fork.dispatch({
        type: 'play-card',
        participantId: activePlayerId,
        cardInstanceId: ooze.instanceId,
        position: 0
      })
      if (!result.accepted) throw new Error(result.message)
      return fork.getState()
    })
    const novaBranch = match.analyze((fork) => {
      const result = fork.dispatch({
        type: 'play-card',
        participantId: activePlayerId,
        cardInstanceId: frostNova.instanceId
      })
      if (!result.accepted) throw new Error(result.message)
      return fork.getState()
    })

    expect(novaBranch.revision).toBe(oozeBranch.revision)
    expect(
      oozeBranch.players[activePlayerIndex].hand.some(
        (card) => card.instanceId === ooze.instanceId
      )
    ).toBe(false)
    expect(
      oozeBranch.players[activePlayerIndex].hand.some(
        (card) => card.cardId === 'basic_frost_nova'
      )
    ).toBe(true)
    expect(
      novaBranch.players[activePlayerIndex].hand.some(
        (card) => card.cardId === ooze.cardId
      )
    ).toBe(true)
    expect(
      novaBranch.players[activePlayerIndex].hand.some(
        (card) => card.cardId === 'basic_frost_nova'
      )
    ).toBe(false)
    expect(match.getState()).toEqual(baseline)
  })

  it('round-trips state, legality, RNG, and entity sequencing independently', () => {
    const decks = [
      deck('checkpoint-human-deck', 'jaina'),
      deck('checkpoint-ai-deck', 'guldan')
    ]
    const setup: MatchSetup = {
      seed: 314159,
      participants: [
        {
          participantId: humanId,
          controllerKind: 'human',
          heroId: decks[0]!.heroId,
          deckId: decks[0]!.id
        },
        {
          participantId: aiId,
          controllerKind: 'ai',
          heroId: decks[1]!.heroId,
          deckId: decks[1]!.id
        }
      ]
    }
    const live = createOpeningMatch(setup, decks)
    expect(
      live.dispatch({
        type: 'confirm-mulligan',
        participantId: humanId,
        replaceInstanceIds: []
      }).accepted
    ).toBe(true)
    expect(
      live.dispatch({
        type: 'confirm-mulligan',
        participantId: aiId,
        replaceInstanceIds: []
      }).accepted
    ).toBe(true)

    const before = live.getState()
    const restored = createOpeningMatchFromCheckpoint(
      structuredClone(live.getCheckpoint())
    )
    expect(restored.getState()).toEqual(before)
    expect(restored.getLegality?.(humanId)).toEqual(live.getLegality?.(humanId))
    expect(restored.getLegality?.(aiId)).toEqual(live.getLegality?.(aiId))

    const activePlayerId = before.activePlayerId!
    const command = { type: 'end-turn' as const, participantId: activePlayerId }
    const restoredResult = restored.dispatch(command)
    expect(live.getState()).toEqual(before)
    const liveResult = live.dispatch(command)
    expect(restoredResult).toEqual(liveResult)
    expect(restored.getCheckpoint()).toEqual(live.getCheckpoint())
  })
})
