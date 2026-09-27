import { describe, expect, it } from 'vitest'
import { asHeroId } from '../content/cards'
import type { Deck } from '../decks'
import { createMatchScenario } from './testing/match-scenario-builder'
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
  it('isolates returned resolver results, query snapshots, and hypothetical states', () => {
    const { match } = createMatchScenario()
    const participantId = match.getState().players[0].participantId
    const result = match.dispatch({
      type: 'dev-set-mana',
      participantId,
      available: 5,
      maximum: 5
    })
    expect(result.accepted).toBe(true)
    const baseline = match.getCheckpoint()
    const query = match.getState()
    const observation = match.getAiObservation!(participantId, 'fair')
    const hypothetical = match.analyze((fork) => {
      fork.dispatch({ type: 'dev-set-mana', participantId, available: 9, maximum: 9 })
      return fork.getState()
    })
    const observedPlayer = observation.players.find(
      (player) => player.participantId === participantId
    )!
    Object.assign(observedPlayer.hero, { health: -100 })
    Object.assign(observedPlayer.hand[0]!, { cardId: 'corrupted' })
    expect(match.getCheckpoint()).toEqual(baseline)
    for (const snapshot of [result.state, query, hypothetical]) {
      Object.assign(snapshot.players[0].hero, { health: -100 })
      Object.assign(snapshot.players[0].hand[0]!, { cardId: 'corrupted' })
      expect(match.getCheckpoint()).toEqual(baseline)
    }
  })

  it('matches the seeded command, event, visibility, and checkpoint baseline', async () => {
    // Baseline includes the added match counters, summon presentation groups and
    // expanded card catalog. Update only for intentional behavior changes.
    for (const seed of [17, 314159]) {
      const { match, participants } = createMatchScenario({
        seed,
        secondHeroId: 'jaina'
      })
      const observations: Record<string, unknown[]> = {
        commands: [],
        results: [],
        checkpoints: [],
        legality: [],
        publicState: [],
        publicEvents: [],
        trace: []
      }
      const dispatch = (command: unknown, accepted = true) => {
        const before = match.getCheckpoint()
        const preview = match.preview(command)
        expect(match.getCheckpoint()).toEqual(before)
        const result = match.dispatch(command)
        expect(result).toEqual(preview)
        expect(result.accepted, JSON.stringify(command)).toBe(accepted)
        observations.commands.push(command)
        observations.results.push(result)
        observations.checkpoints.push(match.getCheckpoint())
        observations.legality.push(participants.map((id) => match.getLegality!(id)))
        observations.publicState.push(
          participants.map((id) => match.getPublicState!(id))
        )
        observations.publicEvents.push(
          participants.map((id) => match.getPublicEvents!(id, result.events))
        )
        observations.trace.push(match.getEffectTrace!())
        return result
      }
      dispatch(null, false)
      for (const participantId of participants) {
        const hand = match
          .getState()
          .players.find((p) => p.participantId === participantId)!.hand
        dispatch({
          type: 'confirm-mulligan',
          participantId,
          replaceInstanceIds: [hand[0]!.instanceId]
        })
      }
      const participantId = match.getState().activePlayerId!
      const opponentId = participants.find((id) => id !== participantId)!
      const mana = () =>
        dispatch({ type: 'dev-set-mana', participantId, available: 10, maximum: 10 })
      const summon = (owner: typeof participantId, cardId: string) =>
        dispatch({ type: 'dev-summon-minion', participantId: owner, cardId })
      const play = (cardId: string, extra: Record<string, unknown> = {}) => {
        mana()
        dispatch({ type: 'dev-add-card', participantId, cardId })
        const card = match
          .getState()
          .players.find((p) => p.participantId === participantId)!
          .hand.find((c) => c.cardId === cardId)!
        dispatch({
          type: 'play-card',
          participantId,
          cardInstanceId: card.instanceId,
          ...extra
        })
      }
      mana()
      dispatch({ type: 'play-card', participantId, cardInstanceId: 'missing' }, false)
      dispatch({
        type: 'use-hero-power',
        participantId,
        target: { kind: 'hero', participantId: opponentId }
      })
      play('goblins_vs_gnomes_blingtron_3000', { position: 0 })
      summon(opponentId, 'naxxramas_haunted_creeper')
      summon(opponentId, 'naxxramas_nerubian_egg')
      play('basic_flamestrike')
      const target = match
        .getState()
        .players.find((p) => p.participantId === opponentId)!.board[0]!
      const targets = [
        { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
      ]
      play('basic_polymorph', { targets })
      play('basic_mind_control', { targets })
      summon(participantId, 'basic_raid_leader')
      play('classic_ice_barrier')
      play('league_of_explorers_raven_idol', { choice: 0 })
      const pending = match.getState().pendingDiscover!
      expect(pending).toBeDefined()
      dispatch({
        type: 'choose-discover-card',
        participantId,
        cardInstanceId: pending.candidates[0]!.instanceId
      })
      dispatch({ type: 'end-turn', participantId })
      dispatch({ type: 'end-turn', participantId: opponentId })
      const attacker = match
        .getState()
        .players.find((p) => p.participantId === participantId)!.board[0]!
      dispatch({
        type: 'attack-character',
        participantId,
        attacker: { kind: 'minion', instanceId: attacker.instanceId },
        defender: { kind: 'hero' }
      })
      for (let i = 0; i < 10; i += 1) dispatch({ type: 'dev-draw', participantId })
      dispatch({ type: 'dev-modify-deck', participantId, action: 'destroy' })
      dispatch({ type: 'dev-draw', participantId })
      dispatch({ type: 'dev-modify-deck', participantId, action: 'refill' })
      const beforeAnalysis = match.getCheckpoint()
      expect(() =>
        match.analyze((fork) => {
          fork.dispatch({ type: 'end-turn', participantId })
          throw new Error('abort analysis')
        })
      ).toThrow('abort analysis')
      expect(match.getCheckpoint()).toEqual(beforeAnalysis)
      const digests: Record<string, string> = {}
      for (const [boundary, values] of Object.entries(observations)) {
        const hash = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(JSON.stringify(values))
        )
        digests[boundary] = Array.from(new Uint8Array(hash), (byte) =>
          byte.toString(16).padStart(2, '0')
        ).join('')
      }
      expect({ commands: observations.commands, digests }).toMatchSnapshot(
        `seed ${seed}`
      )
    }
  })

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
