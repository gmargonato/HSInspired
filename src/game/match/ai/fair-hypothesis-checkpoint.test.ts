import { describe, expect, it } from 'vitest'
import { createSeededRng } from '../rng'
import { createOpeningMatch } from '../opening-match'
import { createAiFixture } from '../testing/ai-scenario-builder'
import { createFairHypothesisCheckpoint } from './fair-hypothesis-checkpoint'

describe('fair Expert AI checkpoints', () => {
  it('redacts hidden cards by knowledge, not the hand-zone revealed flag', () => {
    const fixture = createAiFixture({
      seed: 0x5eed,
      aiHeroId: 'jaina',
      opponentHeroId: 'jaina',
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentHand: ['classic_counterspell'],
      opponentSecrets: [{ cardId: 'classic_counterspell' }]
    })
    const source = {
      ...fixture.checkpoint,
      state: {
        ...fixture.checkpoint.state,
        history: {
          ...fixture.checkpoint.state.history!,
          cardsPlayedThisGame: ['classic_counterspell', 'basic_acidic_swamp_ooze']
        }
      }
    }
    const original = structuredClone(source)
    const hiddenBefore = source.state.players.find(
      (player) => player.participantId === fixture.localParticipantId
    )!
    expect(hiddenBefore.hand[0]?.revealed).toBe(true)
    expect(hiddenBefore.hand[0]?.knownTo ?? []).not.toContain(fixture.aiParticipantId)

    const checkpoint = createFairHypothesisCheckpoint(
      source,
      fixture.aiParticipantId,
      0x1234
    )
    const hiddenAfter = checkpoint.state.players.find(
      (player) => player.participantId === fixture.localParticipantId
    )!

    expect(hiddenAfter.hand[0]?.instanceId).not.toBe(hiddenBefore.hand[0]?.instanceId)
    expect(hiddenAfter.hand[0]?.instanceId).toMatch(/^expert-hidden:/)
    expect(hiddenAfter.hand[0]?.knownTo).toEqual([])
    expect(hiddenAfter.hand[0]?.revealed).toBe(false)
    expect(hiddenAfter.secrets?.[0]?.instanceId).toMatch(/^expert-hidden:/)
    expect(JSON.stringify(checkpoint)).not.toContain(hiddenBefore.hand[0]!.instanceId)
    expect(JSON.stringify(checkpoint)).not.toContain(
      hiddenBefore.secrets![0]!.instanceId
    )
    expect(checkpoint.state.history?.cardsPlayedThisGame).toEqual([
      'basic_acidic_swamp_ooze'
    ])
    expect(checkpoint.state.openingHistory).toBeUndefined()
    expect(checkpoint.state.effectTrace).toBeUndefined()
    expect(source).toEqual(original)
  })

  it('produces deterministic but independently seeded public-information worlds', () => {
    const fixture = createAiFixture({
      seed: 0x5eed,
      aiHeroId: 'jaina',
      opponentHeroId: 'jaina',
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentHand: ['classic_counterspell']
    })
    const first = createFairHypothesisCheckpoint(
      fixture.checkpoint,
      fixture.aiParticipantId,
      0x1234
    )
    const same = createFairHypothesisCheckpoint(
      fixture.checkpoint,
      fixture.aiParticipantId,
      0x1234
    )
    const other = createFairHypothesisCheckpoint(
      fixture.checkpoint,
      fixture.aiParticipantId,
      0x1235
    )

    expect(same).toEqual(first)
    expect(other).not.toEqual(first)
    expect(
      first.state.players.find(
        (player) => player.participantId === fixture.localParticipantId
      )?.originalDeckCardIds
    ).not.toEqual(
      fixture.checkpoint.state.players.find(
        (player) => player.participantId === fixture.localParticipantId
      )?.originalDeckCardIds
    )
  })

  it('re-samples the generated Coin without counting it as an original-deck card', () => {
    const fixture = createAiFixture({
      seed: 0x5eed,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze']
    })
    const opening = createOpeningMatch(
      fixture.setup,
      fixture.decks,
      createSeededRng(fixture.setup.seed)
    )
    const liveCheckpoint = opening.getCheckpoint()
    const hiddenPlayer = liveCheckpoint.state.players.find(
      (player) => player.participantId === fixture.aiParticipantId
    )!
    expect(hiddenPlayer.hand.some((card) => card.cardId === 'basic_the_coin')).toBe(true)

    const firstWorld = createFairHypothesisCheckpoint(
      liveCheckpoint,
      fixture.localParticipantId,
      0x1234
    )
    expect(() =>
      createFairHypothesisCheckpoint(firstWorld, fixture.localParticipantId, 0x1235)
    ).not.toThrow()
  })

  it('uses visible archetype cards to weight hidden deck hypotheses', () => {
    const fixture = createAiFixture({
      seed: 0x5eed,
      aiHeroId: 'jaina',
      opponentHeroId: 'jaina',
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentBoard: [{ cardId: 'blackrock_mountain_flamewaker', attack: 2, health: 4 }]
    })
    const checkpoint = createFairHypothesisCheckpoint(
      fixture.checkpoint,
      fixture.aiParticipantId,
      0xabc123
    )
    const opponent = checkpoint.state.players.find(
      (player) => player.participantId === fixture.localParticipantId
    )!
    const flamewakers = (opponent.originalDeckCardIds ?? []).filter(
      (cardId) => cardId === 'blackrock_mountain_flamewaker'
    )

    expect(flamewakers).toHaveLength(2)
  })

  it('reserves publicly known original cards before allocating hidden zones', () => {
    const fixture = createAiFixture({
      seed: 0x5eed,
      aiHeroId: 'jaina',
      opponentHeroId: 'jaina',
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentHand: ['basic_acidic_swamp_ooze'],
      opponentBoard: [{ cardId: 'blackrock_mountain_flamewaker', attack: 2, health: 4 }]
    })
    const updatePlayer = (player: (typeof fixture.checkpoint.state.players)[number]) =>
      player.participantId === fixture.localParticipantId
        ? {
            ...player,
            deck: player.deck.slice(1),
            hand: player.hand.map((card) => ({
              ...card,
              startedInDeck: true,
              knownTo: [fixture.aiParticipantId]
            }))
          }
        : player
    const source = {
      ...fixture.checkpoint,
      state: {
        ...fixture.checkpoint.state,
        players: [
          updatePlayer(fixture.checkpoint.state.players[0]),
          updatePlayer(fixture.checkpoint.state.players[1])
        ] as const
      }
    }
    const checkpoint = createFairHypothesisCheckpoint(
      source,
      fixture.aiParticipantId,
      0xabc123
    )
    const opponent = checkpoint.state.players.find(
      (player) => player.participantId === fixture.localParticipantId
    )!
    const sampledCounts = new Map<string, number>()
    for (const cardId of opponent.originalDeckCardIds ?? [])
      sampledCounts.set(cardId, (sampledCounts.get(cardId) ?? 0) + 1)
    const allocatedCounts = new Map<string, number>()
    for (const card of [
      ...opponent.deck,
      ...opponent.hand,
      ...(opponent.revealedCards ?? []),
      ...(opponent.discardedCards ?? [])
    ].filter((entry) => entry.startedInDeck !== false))
      allocatedCounts.set(card.cardId, (allocatedCounts.get(card.cardId) ?? 0) + 1)

    expect(opponent.hand[0]?.cardId).toBe('basic_acidic_swamp_ooze')
    expect(sampledCounts.get('basic_acidic_swamp_ooze')).toBeGreaterThan(0)
    for (const [cardId, count] of allocatedCounts)
      expect(count, String(cardId)).toBeLessThanOrEqual(sampledCounts.get(cardId) ?? 0)
  })

  it('does not preserve either player’s hidden remaining deck order', () => {
    const fixture = createAiFixture({
      seed: 0x5eed,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentHand: ['classic_counterspell', 'basic_fireball'],
      opponentDeck: [
        'basic_acidic_swamp_ooze',
        'basic_fireball',
        'classic_faerie_dragon',
        'basic_frostbolt'
      ]
    })
    const checkpoint = createFairHypothesisCheckpoint(
      fixture.checkpoint,
      fixture.aiParticipantId,
      0x778899
    )
    const opponent = checkpoint.state.players.find(
      (player) => player.participantId === fixture.localParticipantId
    )!
    const sampledCounts = new Map<string, number>()
    for (const cardId of opponent.originalDeckCardIds ?? [])
      sampledCounts.set(cardId, (sampledCounts.get(cardId) ?? 0) + 1)
    const allocatedCounts = new Map<string, number>()
    for (const card of [...opponent.deck, ...opponent.hand].filter(
      (entry) => entry.startedInDeck !== false
    ))
      allocatedCounts.set(card.cardId, (allocatedCounts.get(card.cardId) ?? 0) + 1)
    for (const [cardId, count] of allocatedCounts)
      expect(count, String(cardId)).toBeLessThanOrEqual(sampledCounts.get(cardId) ?? 0)
  })

  it('does not preserve hidden remaining deck order', () => {
    const common = {
      seed: 0x5eed,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHand: ['basic_arcane_intellect'],
      aiMana: 2,
      aiDeck: [
        'classic_faerie_dragon',
        'basic_fireball',
        'basic_frostbolt',
        'basic_water_elemental',
        'basic_acidic_swamp_ooze'
      ],
      opponentHand: ['classic_counterspell'],
      opponentDeck: [
        'basic_acidic_swamp_ooze',
        'basic_fireball',
        'basic_frostbolt',
        'classic_faerie_dragon'
      ]
    } as const
    const firstFixture = createAiFixture(common)
    const secondFixture = createAiFixture({
      ...common,
      aiDeck: [...common.aiDeck].reverse(),
      opponentDeck: [...common.opponentDeck].reverse()
    })
    const sourceDeck = (
      fixture: typeof firstFixture,
      participantId: typeof firstFixture.aiParticipantId
    ) =>
      fixture.checkpoint.state.players
        .find((player) => player.participantId === participantId)!
        .deck.map((card) => card.cardId)
    expect(sourceDeck(firstFixture, firstFixture.aiParticipantId)).not.toEqual(
      sourceDeck(secondFixture, secondFixture.aiParticipantId)
    )
    expect(sourceDeck(firstFixture, firstFixture.localParticipantId)).not.toEqual(
      sourceDeck(secondFixture, secondFixture.localParticipantId)
    )
    const firstCheckpoint = createFairHypothesisCheckpoint(
      firstFixture.checkpoint,
      firstFixture.aiParticipantId,
      0xdecafbad
    )
    const secondCheckpoint = createFairHypothesisCheckpoint(
      secondFixture.checkpoint,
      secondFixture.aiParticipantId,
      0xdecafbad
    )
    const selfDeck = (checkpoint: typeof firstCheckpoint) =>
      checkpoint.state.players
        .find((player) => player.participantId === firstFixture.aiParticipantId)!
        .deck.map((card) => card.cardId)
    const opponentDeck = (checkpoint: typeof firstCheckpoint) =>
      checkpoint.state.players
        .find((player) => player.participantId === firstFixture.localParticipantId)!
        .deck.map((card) => card.cardId)
    const originalSelfDeck = firstFixture.checkpoint.state.players.find(
      (player) => player.participantId === firstFixture.aiParticipantId
    )!.deck
    const sampledSelfDeck = selfDeck(firstCheckpoint)

    expect(originalSelfDeck.map((card) => card.cardId).sort()).toEqual(
      [...sampledSelfDeck].sort()
    )
    expect(sampledSelfDeck).not.toEqual(
      sourceDeck(firstFixture, firstFixture.aiParticipantId)
    )
    expect(selfDeck(secondCheckpoint)).toEqual(sampledSelfDeck)
    expect(opponentDeck(secondCheckpoint)).toEqual(opponentDeck(firstCheckpoint))
    expect(
      firstCheckpoint.state.players.find(
        (player) => player.participantId === firstFixture.aiParticipantId
      )?.hand
    ).toEqual(
      firstFixture.checkpoint.state.players.find(
        (player) => player.participantId === firstFixture.aiParticipantId
      )?.hand
    )
  })
})
