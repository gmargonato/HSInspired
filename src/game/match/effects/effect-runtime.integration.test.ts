import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, type CardDefinition, type CardId } from '../../content/cards'
import { createMatchScenario } from '../testing/match-scenario-builder'
import { getDerivedState, getMatchLegality, resolveCardPlay } from './effect-runtime'
import { getOpeningMatchPublicEvents } from '../match-public-projection'
import { projectHistoryAction } from '../history-visibility'
import { triggerHistoryEvents } from '../match-history'
import type { OpeningMatchState } from '../opening-match-types'

describe('Vilefin Inquisitor', () => {
  const vilefinId = 'whispers_of_the_old_gods_vilefin_inquisitor'
  const tokenId = 'whispers_of_the_old_gods_silver_hand_murloc'

  function setup(heroId = 'uther') {
    const scenario = createMatchScenario({ firstHeroId: heroId, secondHeroId: heroId })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    const player = () =>
      scenario.match.getState().players.find((p) => p.participantId === participantId)!
    const mana = (available = 10) => {
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId,
          available,
          maximum: 10
        }).accepted
      ).toBe(true)
    }
    const summon = (cardId: string) => {
      expect(
        scenario.match.dispatch({ type: 'dev-summon-minion', participantId, cardId })
          .accepted
      ).toBe(true)
    }
    const play = (cardId = vilefinId) => {
      mana()
      expect(
        scenario.match.dispatch({ type: 'dev-add-card', participantId, cardId })
          .accepted
      ).toBe(true)
      const card = player().hand.find((c) => c.cardId === cardId)!
      const result = scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        position: player().board.length
      })
      expect(result.accepted).toBe(true)
      return result
    }
    const use = () => scenario.match.dispatch({ type: 'use-hero-power', participantId })
    return { scenario, participantId, player, mana, summon, play, use }
  }

  it('replaces and refreshes an exhausted power, including a second Tidal Hand', () => {
    const s = setup()
    s.mana()
    expect(s.use().accepted).toBe(true)
    for (const previousHeroPowerId of ['paladin-reinforce', 'paladin-the-tidal-hand']) {
      expect(s.play().events).toContainEqual({
        type: 'hero-power-replaced',
        participantId: s.participantId,
        previousHeroPowerId,
        heroPowerId: 'paladin-the-tidal-hand'
      })
      expect(s.player().heroPower).toMatchObject({
        id: 'paladin-the-tidal-hand',
        cost: 2,
        baseCost: 2,
        available: true,
        usesThisTurn: 0
      })
      const beforeMana = s.player().mana.available
      expect(s.use().accepted).toBe(true)
      expect(s.player().mana.available).toBe(beforeMana - 2)
      expect(s.player().board.at(-1)).toMatchObject({
        cardId: tokenId,
        attack: 1,
        health: 1
      })
      expect(s.use().accepted).toBe(false)
    }
    expect(CARD_CATALOG.get(tokenId)).toMatchObject({
      collectible: false,
      subtype: 'Murloc',
      cost: 1
    })
  })

  it.each(['uther', 'jaina'])(
    'replaces upgraded powers for %s and cannot be upgraded by Justicar',
    (heroId) => {
      const s = setup(heroId)
      s.play('the_grand_tournament_justicar_trueheart')
      s.play()
      expect(s.player().heroPower.id).toBe('paladin-the-tidal-hand')
      const events = s.play('the_grand_tournament_justicar_trueheart').events
      expect(s.player().heroPower.id).toBe('paladin-the-tidal-hand')
      expect(events.some((event) => event.type === 'hero-power-replaced')).toBe(false)
    }
  )

  it('does not trigger the battlecry when Vilefin is summoned', () => {
    const s = setup()
    s.summon(vilefinId)
    expect(s.player().heroPower.id).toBe('paladin-reinforce')
  })

  it('requires mana and a free board slot', () => {
    const s = setup()
    s.play()
    s.mana(1)
    expect(s.use().accepted).toBe(false)
    expect(s.player().heroPower.available).toBe(true)
    s.mana()
    while (s.player().board.length < 7) s.summon('basic_silver_hand_recruit')
    expect(s.use().accepted).toBe(false)
    expect(s.player().mana.available).toBe(10)
  })

  it('triggers Murloc synergy without receiving Silver Hand Recruit buffs', () => {
    const s = setup()
    s.play()
    s.summon('classic_murloc_tidecaller')
    s.summon('the_grand_tournament_warhorse_trainer')
    const before = s
      .player()
      .board.find((m) => m.cardId === 'classic_murloc_tidecaller')!.attack
    expect(s.use().accepted).toBe(true)
    expect(s.player().board.at(-1)).toMatchObject({
      cardId: tokenId,
      attack: 1,
      health: 1
    })
    expect(
      s.player().board.find((m) => m.cardId === 'classic_murloc_tidecaller')!.attack
    ).toBe(before + 1)
  })
})

describe('conceding a match', () => {
  it.each(['mulligan', 'own turn', 'opponent turn'])(
    'ends during %s exactly once',
    (phase) => {
      const scenario = createMatchScenario({ seed: 778, cardId: 'basic_sap' })
      if (phase !== 'mulligan') scenario.confirmBothMulligans()
      const before = scenario.match.getState()
      const loserId =
        phase === 'opponent turn'
          ? before.players.find((p) => p.participantId !== before.activePlayerId)!
              .participantId
          : (before.activePlayerId ?? before.players[0].participantId)
      const winnerId = before.players.find(
        (p) => p.participantId !== loserId
      )!.participantId
      const command = { type: 'concede', participantId: loserId }
      const result = scenario.match.dispatch(command)
      expect(result).toMatchObject({
        accepted: true,
        state: {
          phase: 'ended',
          activePlayerId: null,
          winnerId,
          loserId,
          revision: before.revision + 1
        },
        events: [{ type: 'match-ended', winnerId, loserId, reason: 'concede' }]
      })
      expect(scenario.match.dispatch(command)).toMatchObject({
        accepted: false,
        code: 'match-ended',
        events: []
      })
    }
  )
})

describe('generic board-to-card movement cues', () => {
  it('routes a stolen minion back to its owner rather than its current controller', () => {
    const scenario = createMatchScenario({ seed: 778, cardId: 'basic_sap' })
    scenario.confirmBothMulligans()
    const owner = scenario.match.getState().activePlayerId!
    const controller = scenario.match
      .getState()
      .players.find((p) => p.participantId !== owner)!.participantId
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId: owner,
      available: 10,
      maximum: 10
    })
    scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId: controller,
      cardId: 'basic_bloodfen_raptor'
    })
    const original = scenario.match.getState()
    const target = original.players.find((p) => p.participantId === controller)!
      .board[0]
    const state = {
      ...original,
      players: original.players.map((p) => ({
        ...p,
        board: p.board.map((m) => ({ ...m, ownerId: owner }))
      })) as unknown as OpeningMatchState['players']
    }
    const sap = state.players
      .find((p) => p.participantId === owner)!
      .hand.find((c) => c.cardId === 'basic_sap')!
    const result = resolveCardPlay({
      state,
      participantId: owner,
      cardInstanceId: sap.instanceId,
      targets: [
        { kind: 'minion', participantId: controller, instanceId: target.instanceId }
      ]
    })
    expect(result.accepted).toBe(true)
    const movement = result.events.find(
      (event) => event.type === 'effect-resolved' && event.cardMovement
    )
    expect(movement).toMatchObject({
      cardMovement: {
        participantId: owner,
        sourceInstanceId: target.instanceId,
        destination: 'hand',
        copy: false
      }
    })
    expect(
      result.state.players.find((p) => p.participantId === owner)!.hand.at(-1)
        ?.instanceId
    ).toBe(target.instanceId)
  })

  it.each([
    { action: 'return-to-hand', trigger: 'cast', full: false, count: 1 },
    { action: 'return-to-hand', trigger: 'cast', full: true, count: 1 },
    { action: 'return-to-hand', trigger: 'battlecry', full: false, count: 1 },
    { action: 'return-to-hand', trigger: 'deathrattle', full: false, count: 1 },
    { action: 'shuffle-into-deck', trigger: 'cast', full: false, count: 1 },
    { action: 'copy', trigger: 'cast', full: false, count: 3 },
    { action: 'copy', trigger: 'battlecry', full: false, count: 2 }
  ])(
    'emits resolved $action/$trigger movement (full=$full, count=$count)',
    ({ action, trigger, full, count }) => {
      const id = 'movement_fixture' as CardId
      const catalog = CARD_CATALOG as unknown as {
        cardsById: Map<CardId, CardDefinition>
      }
      const fixture = {
        ...CARD_CATALOG.require(
          trigger === 'cast' ? 'basic_sap' : 'basic_acidic_swamp_ooze'
        ),
        id,
        cost: 0,
        effects: [
          {
            trigger,
            actions: [
              {
                action,
                target: {
                  controller: 'opponent',
                  type: 'minion',
                  selection: trigger === 'deathrattle' ? 'all' : 'chosen'
                },
                ...(action === 'copy' ? { destination: 'deck', count } : {})
              }
            ]
          }
        ]
      } as unknown as CardDefinition
      catalog.cardsById.set(id, fixture)
      try {
        const scenario = createMatchScenario({ seed: 777 })
        scenario.confirmBothMulligans()
        const state = scenario.match.getState()
        const caster = state.activePlayerId!
        const owner = state.players.find(
          (p) => p.participantId !== caster
        )!.participantId
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId: caster,
          cardId: id
        })
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: owner,
          cardId: 'basic_bloodfen_raptor'
        })
        if (full) {
          scenario.match.dispatch({
            type: 'dev-clear-zone',
            participantId: owner,
            zone: 'hand'
          })
          for (let index = 0; index < 10; index++)
            scenario.match.dispatch({
              type: 'dev-add-card',
              participantId: owner,
              cardId: 'basic_bloodfen_raptor'
            })
        }
        const before = scenario.match.getState()
        const target = before.players.find((p) => p.participantId === owner)!.board[0]
        const card = before.players
          .find((p) => p.participantId === caster)!
          .hand.find((c) => c.cardId === id)!
        let result = scenario.match.dispatch({
          type: 'play-card',
          participantId: caster,
          cardInstanceId: card.instanceId,
          ...(trigger !== 'cast' ? { position: 0 } : {}),
          ...(trigger !== 'deathrattle'
            ? {
                targets: [
                  {
                    kind: 'minion' as const,
                    participantId: owner,
                    instanceId: target.instanceId
                  }
                ]
              }
            : {})
        })
        expect(result.accepted).toBe(true)
        if (trigger === 'deathrattle') {
          scenario.match.dispatch({
            type: 'dev-add-card',
            participantId: caster,
            cardId: 'basic_fireball'
          })
          scenario.match.dispatch({
            type: 'dev-set-mana',
            participantId: caster,
            available: 10,
            maximum: 10
          })
          const fireball = scenario.match
            .getState()
            .players.find((p) => p.participantId === caster)!
            .hand.find((c) => c.cardId === 'basic_fireball')!
          result = scenario.match.dispatch({
            type: 'play-card',
            participantId: caster,
            cardInstanceId: fireball.instanceId,
            targets: [
              { kind: 'minion', participantId: caster, instanceId: card.instanceId }
            ]
          })
        }
        expect(result.accepted).toBe(true)
        if (!result.accepted) throw new Error(result.message)
        const movements = result.events.flatMap((event) =>
          event.type === 'effect-resolved' && event.cardMovement
            ? [event.cardMovement]
            : []
        )
        const destination =
          action === 'return-to-hand' ? (full ? 'discarded' : 'hand') : 'deck'
        expect(movements).toHaveLength(1)
        expect(movements[0]).toMatchObject({
          sourceInstanceId: target.instanceId,
          participantId: action === 'copy' ? caster : owner,
          destination,
          copy: action === 'copy'
        })
        expect(movements[0].cards).toHaveLength(count)
        const destinationPlayer = result.state.players.find(
          (p) => p.participantId === movements[0].participantId
        )!
        const destinationCards =
          destination === 'discarded'
            ? destinationPlayer.discardedCards!
            : destinationPlayer[destination]
        for (const moved of movements[0].cards) {
          expect(moved).toMatchObject({ cardId: target.cardId, zone: destination })
          expect(
            destinationCards.find((card) => card.instanceId === moved.instanceId)
          ).toMatchObject(moved)
        }
        expect(
          result.state.players
            .find((p) => p.participantId === owner)!
            .board.some((m) => m.instanceId === target.instanceId)
        ).toBe(action === 'copy')
        const publicEvents = getOpeningMatchPublicEvents(result.events, owner)
        const publicMovement = publicEvents.find(
          (event) => event.type === 'effect-resolved' && event.cardMovement
        )
        expect(publicMovement).toMatchObject({
          cardMovement: {
            cards: movements[0].cards.map((card) => ({
              instanceId: card.instanceId,
              cardId: card.cardId
            }))
          }
        })
        if (publicMovement?.type === 'effect-resolved')
          for (const card of publicMovement.cardMovement!.cards)
            expect(card).not.toHaveProperty('knownTo')
        // Event snapshots must not alias the committed zone state.
        expect(movements[0].cards[0]).not.toBe(
          destinationCards.find(
            (c) => c.instanceId === movements[0].cards[0].instanceId
          )
        )
      } finally {
        catalog.cardsById.delete(id)
      }
    }
  )
})

function randomSpellScenario(
  spellId: string,
  count = 3,
  casterId = 'whispers_of_the_old_gods_yogg_saron_hopes_end'
) {
  const scenario = createMatchScenario({
    seed: 93,
    cardId: casterId
  })
  scenario.confirmBothMulligans()
  const participantId = scenario.match.getState().activePlayerId!
  scenario.match.dispatch({
    type: 'dev-set-mana',
    participantId,
    available: 10,
    maximum: 10
  })
  const state = scenario.match.getState()
  const configured: OpeningMatchState = {
    ...state,
    history: {
      ...state.history!,
      spellsCastThisGameByPlayer: { [participantId]: count }
    }
  }
  const pool = CARD_CATALOG.all.filter(
    (card) => card.type === 'Spell' && card.collectible
  )
  const index = pool.findIndex((card) => card.id === spellId)
  expect(index).toBeGreaterThanOrEqual(0)
  let calls = 0
  const rng = {
    next: () => {
      calls++
      return (index + 0.5) / pool.length
    },
    snapshot: () => calls,
    restore: (value: unknown) => {
      calls = value as number
    }
  }
  const card = state.players
    .find((p) => p.participantId === participantId)!
    .hand.find((card) => card.cardId === casterId)!
  const resolve = (input = configured) =>
    resolveCardPlay({
      state: input,
      rng,
      participantId,
      cardInstanceId: card.instanceId,
      position: 0,
      nextEntityOrdinal: input.nextEntityOrdinal
    })
  return { configured, participantId, card, resolve, rng }
}

describe('random spell presentation boundaries', () => {
  it('also brackets Servant of Yogg-Saron’s single random spell', () => {
    const fixture = randomSpellScenario(
      'basic_hellfire',
      3,
      'whispers_of_the_old_gods_servant_of_yogg_saron'
    )
    const result = fixture.resolve()
    expect(result.accepted).toBe(true)
    expect(
      result.events.filter((event) => event.type === 'random-spell-started')
    ).toHaveLength(1)
    expect(
      result.events.filter((event) => event.type === 'random-spell-completed')
    ).toHaveLength(1)
  })

  it.each(['classic_silence', 'basic_polymorph'])(
    'keeps the original caster and count after %s',
    (spellId) => {
      const fixture = randomSpellScenario(spellId)
      const result = fixture.resolve()
      expect(result.accepted).toBe(true)
      if (!result.accepted) throw new Error(result.message)
      const starts = result.events.filter(
        (event) => event.type === 'random-spell-started'
      )
      expect(starts).toHaveLength(3)
      expect(
        starts.every((event) => event.participantId === fixture.participantId)
      ).toBe(true)
    }
  )

  it('places the match result after the complete spell sequence', () => {
    const fixture = randomSpellScenario('basic_hellfire')
    const result = fixture.resolve({
      ...fixture.configured,
      players: fixture.configured.players.map((p) => ({
        ...p,
        hero: { ...p.hero, health: 3 }
      })) as unknown as OpeningMatchState['players']
    })
    expect(result.accepted).toBe(true)
    const lastSpell = result.events.findLastIndex(
      (event) => event.type === 'random-spell-completed'
    )
    expect(lastSpell).toBeGreaterThan(0)
    expect(
      result.events.findIndex((event) => event.type === 'match-ended')
    ).toBeGreaterThan(lastSpell)
  })

  it('captures each spell and keeps casting after Yogg dies without extra RNG calls', () => {
    const fixture = randomSpellScenario('basic_hellfire')
    const result = fixture.resolve()
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const boundaries = result.events.filter(
      (event) =>
        event.type === 'random-spell-started' || event.type === 'random-spell-completed'
    )
    expect(boundaries.map((event) => event.type)).toEqual([
      'random-spell-started',
      'random-spell-completed',
      'random-spell-started',
      'random-spell-completed',
      'random-spell-started',
      'random-spell-completed'
    ])
    expect(boundaries.map((event) => event.state.players[0].hero.health)).toEqual([
      30, 27, 27, 24, 24, 21
    ])
    expect(
      boundaries.every((event) => event.participantId === fixture.participantId)
    ).toBe(true)
    expect(
      boundaries[4].state.players
        .flatMap((p) => p.board)
        .some((minion) => minion.instanceId === fixture.card.instanceId)
    ).toBe(false)
    expect(fixture.rng.snapshot()).toBe(3)
    for (let index = 0; index < boundaries.length; index += 2) {
      const start = boundaries[index]
      const end = boundaries[index + 1]
      expect(start.castId).toBe(end.castId)
      const effects = result.events.slice(
        result.events.indexOf(start) + 1,
        result.events.indexOf(end)
      )
      expect(
        effects.some(
          (event) => event.type === 'effect-resolved' && event.action === 'damage'
        )
      ).toBe(true)
    }
    for (const viewer of fixture.configured.players) {
      const projected = getOpeningMatchPublicEvents(result.events, viewer.participantId)
      expect(projected.some((event) => 'state' in event)).toBe(false)
    }
    fixture.rng.restore(0)
    expect(fixture.resolve()).toEqual(result)
  })

  it('emits no previews for zero casts and completes spells with no useful effect', () => {
    expect(
      randomSpellScenario('basic_deadly_poison', 0)
        .resolve()
        .events.some((event) => event.type === 'random-spell-started')
    ).toBe(false)
    const result = randomSpellScenario('basic_deadly_poison', 2).resolve()
    expect(result.accepted).toBe(true)
    expect(
      result.events.filter((event) => event.type === 'random-spell-completed')
    ).toHaveLength(2)
  })

  it('conceals automatic Secrets in cast history and associated effect sources', () => {
    const fixture = randomSpellScenario('classic_counterspell', 1)
    const result = fixture.resolve()
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const opponent = fixture.configured.players.find(
      (p) => p.participantId !== fixture.participantId
    )!
    const history = triggerHistoryEvents(
      fixture.configured,
      result.state,
      result.events
    )
    expect(JSON.stringify(history)).toContain('classic_counterspell')
    expect(
      JSON.stringify(
        history.map((event) => projectHistoryAction(event, opponent.participantId))
      )
    ).not.toContain('classic_counterspell')
    expect(
      JSON.stringify(
        history.map((event) => projectHistoryAction(event, fixture.participantId))
      )
    ).toContain('classic_counterspell')
  })

  it('completes a countered cast before the next spell starts', () => {
    const fixture = randomSpellScenario('basic_hellfire', 2)
    const configured: OpeningMatchState = {
      ...fixture.configured,
      players: fixture.configured.players.map((p) =>
        p.participantId === fixture.participantId
          ? p
          : {
              ...p,
              secrets: [
                {
                  cardId: CARD_CATALOG.require('classic_counterspell').id,
                  instanceId: 'counterspell-fixture',
                  ownerId: p.participantId,
                  controllerId: p.participantId,
                  creationOrdinal: 64,
                  revealed: false
                }
              ]
            }
      ) as unknown as OpeningMatchState['players']
    }
    const result = fixture.resolve(configured)
    if (!result.accepted) throw new Error(result.message)
    expect(result.accepted).toBe(true)
    const completed = result.events.filter(
      (event) => event.type === 'random-spell-completed'
    )
    expect(completed).toHaveLength(2)
    expect(completed.map((event) => event.state.players[0].hero.health)).toEqual([
      30, 27
    ])
  })
})

describe('shared effect runtime', () => {
  it('publishes Malganis hero immunity and removes it only after the last aura leaves', () => {
    const scenario = createMatchScenario({ seed: 97, cardId: 'classic_silence' })
    scenario.confirmBothMulligans()
    const [owner, opponent] = activeParticipants(scenario)
    for (let copy = 0; copy < 2; copy++) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: owner,
          cardId: 'goblins_vs_gnomes_malganis'
        }).accepted
      ).toBe(true)
    }
    expect(player(scenario, owner).hero.immune).toBe(true)
    const health = player(scenario, owner).hero.health
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: owner,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: owner,
        cardId: 'basic_hellfire'
      }).accepted
    ).toBe(true)
    const hellfire = player(scenario, owner).hand.find(
      (c) => c.cardId === 'basic_hellfire'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: owner,
        cardInstanceId: hellfire.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, owner).hero.health).toBe(health)
    expect(player(scenario, opponent).hero.health).toBeLessThan(health)
    const sources = [...player(scenario, owner).board]
    for (const [index, source] of sources.entries()) {
      const silence = player(scenario, owner).hand.find(
        (c) => c.cardId === 'classic_silence'
      )!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId: owner,
          cardInstanceId: silence.instanceId,
          targets: [
            { kind: 'minion', participantId: owner, instanceId: source.instanceId }
          ]
        }).accepted
      ).toBe(true)
      expect(player(scenario, owner).hero.immune).toBe(index === 0)
    }
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: owner,
        cardId: 'goblins_vs_gnomes_malganis'
      }).accepted
    ).toBe(true)
    expect(player(scenario, owner).hero.immune).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId: owner,
        zone: 'board'
      }).accepted
    ).toBe(true)
    expect(player(scenario, owner).hero.immune).toBe(false)
  })

  it('applies Violet Illusionist immunity only during its controller turn', () => {
    const scenario = createMatchScenario({ seed: 97, cardId: 'basic_hellfire' })
    scenario.confirmBothMulligans()
    const [owner, opponent] = activeParticipants(scenario)
    for (const participantId of [owner, opponent]) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId: 'one_night_in_karazhan_violet_illusionist'
        }).accepted
      ).toBe(true)
    }
    expect(player(scenario, owner).hero.immune).toBe(true)
    expect(player(scenario, opponent).hero.immune).toBe(false)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: owner }).accepted
    ).toBe(true)
    expect(player(scenario, owner).hero.immune).toBe(false)
    expect(player(scenario, opponent).hero.immune).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponent }).accepted
    ).toBe(true)
    expect(player(scenario, owner).hero.immune).toBe(true)
    expect(player(scenario, opponent).hero.immune).toBe(false)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: owner,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const health = player(scenario, owner).hero.health
    const hellfire = player(scenario, owner).hand.find(
      (c) => c.cardId === 'basic_hellfire'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: owner,
        cardInstanceId: hellfire.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, owner).hero.health).toBe(health)
    expect(player(scenario, owner).board).toHaveLength(0)
    expect(player(scenario, owner).hero.immune).toBe(false)
  })

  it('protects minions summoned after Commanding Shout and expires after the turn', () => {
    const scenario = createMatchScenario({ seed: 909, cardId: 'basic_fireball' })
    scenario.confirmBothMulligans()
    const [id, enemy] = activeParticipants(scenario)
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId: id,
      available: 10,
      maximum: 10
    })
    scenario.match.dispatch({
      type: 'dev-add-card',
      participantId: id,
      cardId: 'classic_commanding_shout'
    })
    const shout = player(scenario, id).hand.find(
      (c) => c.cardId === 'classic_commanding_shout'
    )!
    const deckSize = player(scenario, id).deck.length
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: id,
        cardInstanceId: shout.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, id).deck.length).toBe(deckSize - 1)
    scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId: id,
      cardId: 'basic_acidic_swamp_ooze'
    })
    const target = {
      kind: 'minion' as const,
      participantId: id,
      instanceId: player(scenario, id).board[0]!.instanceId
    }
    const fireball = player(scenario, id).hand.find(
      (c) => c.cardId === 'basic_fireball'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: id,
        cardInstanceId: fireball.instanceId,
        targets: [target]
      }).accepted
    ).toBe(true)
    expect(player(scenario, id).board[0]!.health).toBe(1)
    scenario.match.dispatch({ type: 'end-turn', participantId: id })
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId: enemy,
      available: 10,
      maximum: 10
    })
    const nextFireball = player(scenario, enemy).hand.find(
      (c) => c.cardId === 'basic_fireball'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: enemy,
        cardInstanceId: nextFireball.instanceId,
        targets: [target]
      }).accepted
    ).toBe(true)
    expect(player(scenario, id).board).toHaveLength(0)
  })

  it('summons Barnes as a 1/1 copy without consuming its deck source', () => {
    const scenario = createMatchScenario({
      seed: 911,
      cardId: 'one_night_in_karazhan_barnes'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)

    const before = player(scenario, participantId)
    const playedBarnes = before.hand.find(
      (card) => card.cardId === 'one_night_in_karazhan_barnes'
    )!
    const deckInstanceIds = before.deck.map((card) => card.instanceId)

    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: playedBarnes.instanceId,
      position: 0
    })
    expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)

    const after = player(scenario, participantId)
    expect(after.deck.map((card) => card.instanceId)).toEqual(deckInstanceIds)
    expect(after.board).toHaveLength(2)

    const playedMinion = after.board.find(
      (minion) => minion.instanceId === playedBarnes.instanceId
    )
    const summonedCopy = after.board.find(
      (minion) => minion.instanceId !== playedBarnes.instanceId
    )
    expect(playedMinion).toMatchObject({ attack: 3, health: 4 })
    expect(summonedCopy).toMatchObject({
      cardId: 'one_night_in_karazhan_barnes',
      attack: 1,
      health: 1,
      maxHealth: 1
    })
    expect(deckInstanceIds).not.toContain(summonedCopy?.instanceId)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'minion-summoned',
        minion: expect.objectContaining({
          instanceId: summonedCopy?.instanceId,
          attack: 1,
          health: 1,
          maxHealth: 1
        })
      })
    )
  })

  it('summons Hogger Gnolls with two attack, two health and Taunt', () => {
    const scenario = createMatchScenario({ seed: 910, cardId: 'basic_fireball' })
    scenario.confirmBothMulligans()
    const [id] = activeParticipants(scenario)
    scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId: id,
      cardId: 'classic_hogger'
    })
    scenario.match.dispatch({ type: 'end-turn', participantId: id })
    expect(
      player(scenario, id).board.find((m) => m.cardId === 'classic_gnoll')
    ).toMatchObject({
      attack: 2,
      health: 2,
      keywords: expect.arrayContaining(['taunt'])
    })
  })

  it('returns release Anubarak to hand and summons a plain Nerubian on death', () => {
    const scenario = createMatchScenario({
      seed: 906,
      cardId: 'basic_shadow_word_death'
    })
    scenario.confirmBothMulligans()
    const [id, enemy] = activeParticipants(scenario)
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId: id,
      available: 10,
      maximum: 10
    })
    scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId: enemy,
      cardId: 'the_grand_tournament_anubarak'
    })
    const card = player(scenario, id).hand.find(
      (c) => c.cardId === 'basic_shadow_word_death'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: id,
        cardInstanceId: card.instanceId,
        targets: [
          {
            kind: 'minion',
            participantId: enemy,
            instanceId: player(scenario, enemy).board[0]!.instanceId
          }
        ]
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, enemy).hand.some(
        (c) => c.cardId === 'the_grand_tournament_anubarak' && c.currentCost === 9
      )
    ).toBe(true)
    expect(player(scenario, enemy).board[0]).toMatchObject({
      cardId: 'the_grand_tournament_nerubian',
      attack: 4,
      health: 4
    })
    expect(CARD_CATALOG.require('the_grand_tournament_nerubian').effects).toEqual([])
  })

  it('discounts Knight of the Wild only for Beasts summoned while it is in hand', () => {
    const scenario = createMatchScenario({ seed: 907, cardId: 'basic_fireball' })
    scenario.confirmBothMulligans()
    const [id] = activeParticipants(scenario)
    scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId: id,
      cardId: 'basic_bloodfen_raptor'
    })
    scenario.match.dispatch({
      type: 'dev-add-card',
      participantId: id,
      cardId: 'the_grand_tournament_knight_of_the_wild'
    })
    expect(
      player(scenario, id).hand.find(
        (c) => c.cardId === 'the_grand_tournament_knight_of_the_wild'
      )!.currentCost
    ).toBe(7)
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId: id,
      available: 10,
      maximum: 10
    })
    scenario.match.dispatch({
      type: 'dev-add-card',
      participantId: id,
      cardId: 'basic_bloodfen_raptor'
    })
    const raptor = player(scenario, id).hand.find(
      (c) => c.cardId === 'basic_bloodfen_raptor'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: id,
        cardInstanceId: raptor.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, id).hand.find(
        (c) => c.cardId === 'the_grand_tournament_knight_of_the_wild'
      )!.currentCost
    ).toBe(6)
  })

  it.each(['lower', 'empty'] as const)(
    'heals fourteen in one event when Healing Wave beats a %s opposing deck',
    (opponentDeck) => {
      const scenario = createMatchScenario({
        seed: 908,
        cardId: 'basic_boulderfist_ogre'
      })
      scenario.confirmBothMulligans()
      const [id, enemy] = activeParticipants(scenario)
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: id,
        available: 10,
        maximum: 10
      })
      scenario.match.dispatch({ type: 'dev-set-hero', participantId: id, health: 10 })
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: id,
        cardId: 'the_grand_tournament_healing_wave'
      })
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: id,
        cardId: 'classic_lightwarden'
      })
      const state = scenario.match.getState()
      const configured = {
        ...state,
        players: state.players.map((p) =>
          p.participantId === enemy
            ? {
                ...p,
                deck:
                  opponentDeck === 'empty'
                    ? []
                    : p.deck.map((c) => ({ ...c, cardId: 'classic_wisp' as CardId }))
              }
            : p
        ) as unknown as typeof state.players
      }
      const card = player(scenario, id).hand.find(
        (c) => c.cardId === 'the_grand_tournament_healing_wave'
      )!
      const result = resolveCardPlay({
        state: configured,
        rng: scenario.rng,
        participantId: id,
        cardInstanceId: card.instanceId,
        targets: [{ kind: 'hero', participantId: id }],
        nextEntityOrdinal: state.nextEntityOrdinal
      })
      expect(result.accepted).toBe(true)
      if (!result.accepted) return
      const healed = result.state.players.find((p) => p.participantId === id)!
      expect(healed.hero.health).toBe(24)
      expect(healed.board[0]!.attack).toBe(3)
    }
  )

  it('uses Malygos spell damage and removes it on silence', () => {
    const scenario = createMatchScenario({ seed: 901, cardId: 'basic_fireball' })
    scenario.confirmBothMulligans()
    const [id, enemy] = activeParticipants(scenario)
    scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId: id,
      cardId: 'classic_malygos'
    })
    expect(player(scenario, id).board[0]!.spellDamage).toBe(5)
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId: id,
      available: 10,
      maximum: 10
    })
    const card = player(scenario, id).hand.find((c) => c.cardId === 'basic_fireball')!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: id,
        cardInstanceId: card.instanceId,
        targets: [{ kind: 'hero', participantId: enemy }]
      }).accepted
    ).toBe(true)
    expect(player(scenario, enemy).hero.health).toBe(19)
    scenario.match.dispatch({
      type: 'dev-add-card',
      participantId: id,
      cardId: 'classic_silence'
    })
    const silence = player(scenario, id).hand.find(
      (c) => c.cardId === 'classic_silence'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: id,
        cardInstanceId: silence.instanceId,
        targets: [
          {
            kind: 'minion',
            participantId: id,
            instanceId: player(scenario, id).board[0]!.instanceId
          }
        ]
      }).accepted
    ).toBe(true)
    expect(player(scenario, id).board[0]!.spellDamage).toBe(0)
  })

  it('makes existing and newly added enemy spells free only during Millhouse next turn', () => {
    const scenario = createMatchScenario({ seed: 902, cardId: 'basic_fireball' })
    scenario.confirmBothMulligans()
    const [id, enemy] = activeParticipants(scenario)
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId: id,
      available: 10,
      maximum: 10
    })
    scenario.match.dispatch({
      type: 'dev-add-card',
      participantId: id,
      cardId: 'classic_millhouse_manastorm'
    })
    const card = player(scenario, id).hand.find(
      (c) => c.cardId === 'classic_millhouse_manastorm'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: id,
        cardInstanceId: card.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, enemy).hand.find((c) => c.cardId === 'basic_fireball')!
        .currentCost
    ).toBe(4)
    scenario.match.dispatch({ type: 'end-turn', participantId: id })
    expect(
      player(scenario, enemy)
        .hand.filter((c) => c.cardId === 'basic_fireball')
        .every((c) => c.currentCost === 0)
    ).toBe(true)
    scenario.match.dispatch({
      type: 'dev-add-card',
      participantId: enemy,
      cardId: 'basic_flamestrike'
    })
    expect(
      player(scenario, enemy).hand.find((c) => c.cardId === 'basic_flamestrike')!
        .currentCost
    ).toBe(0)
    scenario.match.dispatch({ type: 'end-turn', participantId: enemy })
    expect(
      player(scenario, enemy).hand.find((c) => c.cardId === 'basic_fireball')!
        .currentCost
    ).toBe(4)
  })

  it('detonates a normally drawn Burrowing Mine for ten damage', () => {
    const scenario = createMatchScenario({
      seed: 903,
      cardId: 'goblins_vs_gnomes_burrowing_mine'
    })
    scenario.confirmBothMulligans()
    const [id, enemy] = activeParticipants(scenario)
    const health = player(scenario, enemy).hero.health
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: id }).accepted
    ).toBe(true)
    expect(player(scenario, enemy).hero.health).toBe(health - 10)
  })

  it.each([12, 13])('resolves Revenge as one damage pulse at %s health', (health) => {
    const scenario = createMatchScenario({
      seed: 904,
      cardId: 'blackrock_mountain_revenge'
    })
    scenario.confirmBothMulligans()
    const [id, enemy] = activeParticipants(scenario)
    scenario.match.dispatch({ type: 'dev-set-hero', participantId: id, health })
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId: id,
      available: 10,
      maximum: 10
    })
    scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId: enemy,
      cardId: 'goblins_vs_gnomes_shielded_minibot'
    })
    scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId: enemy,
      cardId: 'basic_chillwind_yeti'
    })
    const card = player(scenario, id).hand.find(
      (c) => c.cardId === 'blackrock_mountain_revenge'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: id,
        cardInstanceId: card.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, enemy).board.map((m) => m.health)).toEqual([
      2,
      health <= 12 ? 2 : 4
    ])
  })

  it('allows Healing Wave to target the opposing hero and heals seven on a tied joust', () => {
    const scenario = createMatchScenario({
      seed: 905,
      cardId: 'the_grand_tournament_healing_wave'
    })
    scenario.confirmBothMulligans()
    const [id, enemy] = activeParticipants(scenario)
    scenario.match.dispatch({ type: 'dev-set-hero', participantId: enemy, health: 10 })
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId: id,
      available: 10,
      maximum: 10
    })
    const card = player(scenario, id).hand.find(
      (c) => c.cardId === 'the_grand_tournament_healing_wave'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: id,
        cardInstanceId: card.instanceId,
        targets: [{ kind: 'hero', participantId: enemy }]
      }).accepted
    ).toBe(true)
    expect(player(scenario, enemy).hero.health).toBe(17)
  })

  it.each([
    ['classic_power_of_the_wild', 0],
    ['classic_power_of_the_wild', 1],
    ['the_grand_tournament_living_roots', 0],
    ['the_grand_tournament_living_roots', 1]
  ] as const)(
    'resolves %s choice %s without playing its presentation token',
    (cardId, choice) => {
      const scenario = createMatchScenario({ seed: 923, cardId })
      scenario.confirmBothMulligans()
      const [participantId, opponentId] = activeParticipants(scenario)
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
      const before = player(scenario, participantId).board[0]!
      const card = player(scenario, participantId).hand.find(
        (entry) => entry.cardId === cardId
      )!
      const damage = cardId === 'the_grand_tournament_living_roots' && choice === 0
      const heroHealth = player(scenario, opponentId).hero.health
      const result = scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        choice,
        ...(damage
          ? { targets: [{ kind: 'hero' as const, participantId: opponentId }] }
          : {})
      })
      expect(result.accepted).toBe(true)
      const board = player(scenario, participantId).board
      if (choice === 1) {
        const panther = cardId === 'classic_power_of_the_wild'
        expect(board.slice(1).map((minion) => minion.cardId)).toEqual(
          panther
            ? ['classic_panther']
            : ['the_grand_tournament_sapling', 'the_grand_tournament_sapling']
        )
      } else if (damage) {
        expect(player(scenario, opponentId).hero.health).toBe(heroHealth - 2)
      } else {
        expect(board[0]).toMatchObject({
          attack: before.attack + 1,
          health: before.health + 1
        })
      }
      expect(player(scenario, participantId).mana.available).toBe(
        10 - CARD_CATALOG.require(cardId).cost
      )
      expect(scenario.match.getState().history?.cardsPlayedThisTurn).toEqual([cardId])
      expect(scenario.match.getState().history?.cardsCastThisTurn).toEqual([cardId])
    }
  )

  it.each([
    [
      'blackrock_mountain_druid_of_the_flame',
      ['blackrock_mountain_firecat_form', 'blackrock_mountain_fire_hawk_form']
    ],
    [
      'classic_ancient_of_lore',
      ['classic_ancient_teachings', 'classic_ancient_secrets']
    ],
    ['classic_ancient_of_war', ['classic_rooted', 'classic_uproot']],
    ['classic_cenarius', ['classic_demigods_favor', 'classic_shandos_lesson']],
    ['classic_druid_of_the_claw', ['classic_cat_form', 'classic_bear_form']],
    ['classic_keeper_of_the_grove', ['classic_moonfire_choose_one', 'classic_dispel']],
    [
      'classic_mark_of_nature',
      ['classic_mark_of_nature_attack', 'classic_mark_of_nature_health']
    ],
    ['classic_nourish', ['classic_nourish_mana', 'classic_nourish_draw']],
    [
      'classic_power_of_the_wild',
      ['classic_leader_of_the_pack', 'classic_summon_a_panther']
    ],
    ['classic_starfall', ['classic_starfall_single', 'classic_starfall_all']],
    ['classic_wrath', ['classic_wrath_damage', 'classic_wrath_draw']],
    [
      'goblins_vs_gnomes_anodized_robo_cub',
      ['goblins_vs_gnomes_attack_mode', 'goblins_vs_gnomes_tank_mode']
    ],
    [
      'goblins_vs_gnomes_grove_tender',
      ['goblins_vs_gnomes_gift_of_mana', 'goblins_vs_gnomes_gift_of_cards']
    ],
    [
      'goblins_vs_gnomes_dark_wispers',
      ['goblins_vs_gnomes_dark_wispers_wisps', 'goblins_vs_gnomes_dark_wispers_buff']
    ],
    [
      'league_of_explorers_raven_idol',
      ['league_of_explorers_raven_idol_minion', 'league_of_explorers_raven_idol_spell']
    ],
    [
      'the_grand_tournament_living_roots',
      [
        'the_grand_tournament_living_roots_damage',
        'the_grand_tournament_living_roots_saplings'
      ]
    ],
    [
      'the_grand_tournament_druid_of_the_saber',
      ['the_grand_tournament_lion_form', 'the_grand_tournament_panther_form']
    ]
  ])('projects distinct researched choice cards for %s', (cardId, expectedIds) => {
    const scenario = createMatchScenario({ seed: 921, cardId })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === cardId
    )!
    const input = scenario.match.getPlayInput?.(participantId, card.instanceId)
    expect(input?.choiceOptions.map((option) => option.presentationCardId)).toEqual(
      expectedIds
    )
    expect(input?.choiceOptions.map((option) => option.choice)).toEqual([0, 1])
    for (const option of input!.choiceOptions) {
      expect(option.presentationCost).toBe(CARD_CATALOG.require(cardId).cost)
      const definition = CARD_CATALOG.require(option.presentationCardId!)
      expect(definition).toMatchObject({
        type: 'Spell',
        collectible: false,
        deckLegal: false,
        rarity: 'None'
      })
      expect(definition.rulesText.length).toBeGreaterThan(0)
    }
  })

  it.each([
    ['classic_wrath', 0, 3, false],
    ['classic_wrath', 1, 1, true],
    ['classic_starfall', 0, 5, false],
    ['classic_starfall', 1, 2, false]
  ] as const)(
    'resolves %s branch %s with the original choice identity',
    (cardId, choice, damage, draws) => {
      const scenario = createMatchScenario({ seed: 922, cardId })
      scenario.confirmBothMulligans()
      const [participantId, opponentId] = activeParticipants(scenario)
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      for (const owner of [participantId, opponentId, opponentId])
        expect(
          scenario.match.dispatch({
            type: 'dev-summon-minion',
            participantId: owner,
            cardId: 'basic_boulderfist_ogre'
          }).accepted
        ).toBe(true)
      const card = player(scenario, participantId).hand.find(
        (entry) => entry.cardId === cardId
      )!
      const beforeHand = player(scenario, participantId).hand.length
      const beforeHealth = player(scenario, opponentId).board.map(
        (minion) => minion.health
      )
      const friendlyHealth = player(scenario, participantId).board[0]!.health
      const area = cardId === 'classic_starfall' && choice === 1
      const target = player(scenario, opponentId).board[0]!
      const input = scenario.match.getPlayInput?.(
        participantId,
        card.instanceId,
        choice
      )
      expect(input?.targetSelectors).toHaveLength(area ? 0 : 1)
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId,
          cardInstanceId: card.instanceId,
          choice,
          ...(area
            ? {}
            : {
                targets: [
                  {
                    kind: 'minion' as const,
                    participantId: opponentId,
                    instanceId: target.instanceId
                  }
                ]
              })
        }).accepted
      ).toBe(true)
      expect(player(scenario, opponentId).board.map((minion) => minion.health)).toEqual(
        [beforeHealth[0]! - damage, beforeHealth[1]! - (area ? damage : 0)]
      )
      expect(player(scenario, participantId).board[0]!.health).toBe(friendlyHealth)
      expect(player(scenario, participantId).hand.length).toBe(
        beforeHand - 1 + (draws ? 1 : 0)
      )
      expect(player(scenario, participantId).mana.available).toBe(
        10 - CARD_CATALOG.require(cardId).cost
      )
    }
  )

  const player = (
    scenario: ReturnType<typeof createMatchScenario>,
    participantId: string
  ) =>
    scenario.match
      .getState()
      .players.find((candidate) => candidate.participantId === participantId)!

  const activeParticipants = (scenario: ReturnType<typeof createMatchScenario>) => {
    const active = scenario.match.getState().activePlayerId!
    return [
      active,
      scenario.participants.find((participantId) => participantId !== active)!
    ] as const
  }

  it('requires a candidate for direct random-target spells such as Flamecannon', () => {
    const scenario = createMatchScenario({
      seed: 73,
      cardId: 'goblins_vs_gnomes_flamecannon'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'goblins_vs_gnomes_flamecannon'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 2,
        maximum: 2
      }).accepted
    ).toBe(true)
    const flamecannon = player(scenario, participantId).hand[0]!

    expect(
      scenario.match.getLegality?.(participantId).playableCardInstanceIds
    ).not.toContain(flamecannon.instanceId)
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: flamecannon.instanceId
      }).accepted
    ).toBe(false)

    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_bloodfen_raptor'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.getLegality?.(participantId).playableCardInstanceIds
    ).toContain(flamecannon.instanceId)
  })

  it("draws each of Ysera's five Dream cards, including Nightmare", () => {
    const dreamIds = new Set([
      'classic_dream',
      'classic_emerald_drake',
      'classic_laughing_sister',
      'classic_nightmare',
      'classic_ysera_awakens'
    ])
    const drawnDreamIds = new Set<string>()

    for (let seed = 1; seed <= 128 && drawnDreamIds.size < dreamIds.size; seed += 1) {
      const scenario = createMatchScenario({ seed, cardId: 'classic_ysera' })
      scenario.confirmBothMulligans()
      const participantId = scenario.match.getState().activePlayerId!
      expect(
        scenario.match.dispatch({
          type: 'dev-clear-zone',
          participantId,
          zone: 'hand'
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId,
          cardId: 'classic_ysera'
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      const ysera = player(scenario, participantId).hand[0]!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId,
          cardInstanceId: ysera.instanceId,
          position: 0
        }).accepted
      ).toBe(true)
      const endTurn = scenario.match.dispatch({ type: 'end-turn', participantId })
      expect(endTurn.accepted).toBe(true)
      if (!endTurn.accepted) return
      expect(endTurn.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'card-generated',
            participantId,
            origin: { kind: 'minion', instanceId: ysera.instanceId }
          })
        ])
      )

      const dream = player(scenario, participantId).hand.find((card) =>
        dreamIds.has(card.cardId)
      )
      expect(dream).toBeDefined()
      if (dream) drawnDreamIds.add(dream.cardId)
    }

    expect(drawnDreamIds).toEqual(dreamIds)
  })

  it("summons Pip Quickwit when The Beast's Deathrattle resolves", () => {
    const scenario = createMatchScenario({ seed: 129, cardId: 'classic_the_beast' })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_the_beast'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'basic_shadow_word_death'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)

    const beast = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_the_beast'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: beast.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    const beastOnBoard = player(scenario, participantId).board[0]!
    const deathSpell = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'basic_shadow_word_death'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: deathSpell.instanceId,
        targets: [
          {
            kind: 'minion',
            participantId,
            instanceId: beastOnBoard.instanceId
          }
        ]
      }).accepted
    ).toBe(true)

    expect(player(scenario, opponentId).board).toContainEqual(
      expect.objectContaining({
        cardId: 'classic_pip_quickwit',
        attack: 3,
        health: 3,
        maxHealth: 3
      })
    )
  })

  it('resolves a real targeted spell through the canonical play-card command', () => {
    const scenario = createMatchScenario({ seed: 41, cardId: 'basic_arcane_shot' })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    const opponentId = scenario.participants.find(
      (participantId) => participantId !== playerId
    )!
    const before = scenario.match.getState()
    const mana = scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId: playerId,
      available: 10,
      maximum: 10
    })
    expect(mana.accepted).toBe(true)
    const card = scenario.match
      .getState()
      .players.find((player) => player.participantId === playerId)!.hand[0]
    expect(card).toBeDefined()
    const input = scenario.match.getPlayInput?.(playerId, card!.instanceId)
    expect(input?.targetSelectors).toHaveLength(1)
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: playerId,
      cardInstanceId: card!.instanceId,
      targets: [{ kind: 'hero', participantId: opponentId }]
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const resultPlayer = result.state.players.find(
      (player) => player.participantId === playerId
    )!
    const resultOpponent = result.state.players.find(
      (player) => player.participantId === opponentId
    )!
    const beforeOpponent = before.players.find(
      (player) => player.participantId === opponentId
    )!
    expect(resultPlayer.mana.available).toBe(9)
    expect(resultOpponent.hero.health).toBe(beforeOpponent.hero.health - 2)
    expect(
      resultPlayer.hand.some((entry) => entry.instanceId === card!.instanceId)
    ).toBe(false)
    expect(result.events.some((event) => event.type === 'effect-resolved')).toBe(true)
  })

  it('silences and damages only the minion targeted by Earth Shock', () => {
    const scenario = createMatchScenario({ seed: 421, cardId: 'classic_earth_shock' })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    for (const [controllerId, cardId] of [
      [participantId, 'basic_acidic_swamp_ooze'],
      [participantId, 'basic_chillwind_yeti'],
      [opponentId, 'basic_acidic_swamp_ooze'],
      [opponentId, 'basic_chillwind_yeti']
    ] as const) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: controllerId,
          cardId
        }).accepted
      ).toBe(true)
    }

    const target = player(scenario, opponentId).board[0]!
    const unaffectedBefore = [
      ...player(scenario, participantId).board,
      ...player(scenario, opponentId).board.slice(1)
    ].map((minion) => ({
      instanceId: minion.instanceId,
      health: minion.health,
      silenced: minion.silenced
    }))
    const earthShock = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_earth_shock'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: earthShock.instanceId,
      targets: [
        {
          kind: 'minion',
          participantId: opponentId,
          instanceId: target.instanceId
        }
      ]
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    expect(
      player(scenario, opponentId).board.find(
        (minion) => minion.instanceId === target.instanceId
      )
    ).toMatchObject({ health: target.health - 1, silenced: true })
    const unaffectedAfter = [
      ...player(scenario, participantId).board,
      ...player(scenario, opponentId).board
    ]
    for (const before of unaffectedBefore) {
      expect(
        unaffectedAfter.find((minion) => minion.instanceId === before.instanceId)
      ).toMatchObject({ health: before.health, silenced: before.silenced })
    }
  })

  it('allows unsided damage to target a friendly character', () => {
    const scenario = createMatchScenario({ seed: 411, cardId: 'basic_arcane_shot' })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)

    const beforeHealth = player(scenario, playerId).hero.health
    const card = player(scenario, playerId).hand[0]!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: playerId,
      cardInstanceId: card.instanceId,
      targets: [{ kind: 'hero', participantId: playerId }]
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, playerId).hero.health).toBe(beforeHealth - 2)
  })

  it('allows an unsided restore to target an enemy character', () => {
    const scenario = createMatchScenario({
      seed: 412,
      cardId: 'goblins_vs_gnomes_light_of_the_naaru'
    })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    const opponentId = scenario.participants.find(
      (participantId) => participantId !== playerId
    )!
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)

    const card = player(scenario, playerId).hand[0]!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: playerId,
      cardInstanceId: card.instanceId,
      targets: [{ kind: 'hero', participantId: opponentId }]
    })

    expect(result.accepted).toBe(true)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'effect-resolved',
        action: 'restore',
        data: expect.objectContaining({
          amount: 0,
          displayAmount: 3,
          target: `${opponentId}:hero`
        })
      })
    )
  })

  it('projects a conditional spell preview from the current board state', () => {
    const scenario = createMatchScenario({
      seed: 42,
      cardId: 'classic_kill_command'
    })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    const killCommand = player(scenario, playerId).hand[0]!

    expect(
      scenario.match.getPlayInput?.(playerId, killCommand.instanceId)?.effectPreview
    ).toEqual({
      conditionallyEnhanced: false
    })
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'naxxramas_haunted_creeper'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.getPlayInput?.(playerId, killCommand.instanceId)?.effectPreview
    ).toEqual({
      conditionallyEnhanced: true
    })
  })

  it.each([
    [26, false, 4],
    [13, false, 4],
    [12, true, 6]
  ] as const)(
    'uses the enhanced Mortal Strike branch only at %s Health',
    (health, conditionallyEnhanced, damage) => {
      const scenario = createMatchScenario({
        seed: 4242 + health,
        cardId: 'classic_mortal_strike'
      })
      scenario.confirmBothMulligans()
      const [playerId, opponentId] = activeParticipants(scenario)
      expect(
        scenario.match.dispatch({
          type: 'dev-set-hero',
          participantId: playerId,
          health
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId: playerId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)

      const mortalStrike = player(scenario, playerId).hand.find(
        (card) => card.cardId === 'classic_mortal_strike'
      )!
      expect(
        scenario.match.getPlayInput?.(playerId, mortalStrike.instanceId)?.effectPreview
      ).toEqual({ conditionallyEnhanced })

      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId: playerId,
          cardInstanceId: mortalStrike.instanceId,
          targets: [{ kind: 'hero', participantId: opponentId }]
        }).accepted
      ).toBe(true)
      expect(player(scenario, opponentId).hero.health).toBe(30 - damage)
    }
  )

  it('projects the played card out of hand before evaluating play conditions', () => {
    const scenario = createMatchScenario({ seed: 43 })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    const clearHand = (): void => {
      expect(
        scenario.match.dispatch({
          type: 'dev-clear-zone',
          participantId: playerId,
          zone: 'hand'
        }).accepted
      ).toBe(true)
    }
    const addCard = (cardId: CardId): void => {
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId: playerId,
          cardId
        }).accepted
      ).toBe(true)
    }
    const effectPreview = (cardId: CardId) => {
      const card = player(scenario, playerId).hand.find(
        (candidate) => candidate.cardId === cardId
      )!
      return scenario.match.getPlayInput?.(playerId, card.instanceId)?.effectPreview
    }

    clearHand()
    addCard('blackrock_mountain_twilight_whelp' as CardId)
    expect(effectPreview('blackrock_mountain_twilight_whelp' as CardId)).toBeNull()

    addCard('classic_faerie_dragon' as CardId)
    expect(effectPreview('blackrock_mountain_twilight_whelp' as CardId)).toEqual({
      conditionallyEnhanced: true
    })

    clearHand()
    addCard('blackrock_mountain_core_rager' as CardId)
    expect(effectPreview('blackrock_mountain_core_rager' as CardId)).toEqual({
      conditionallyEnhanced: true
    })

    addCard('classic_ironbeak_owl' as CardId)
    expect(effectPreview('blackrock_mountain_core_rager' as CardId)).toBeNull()
  })

  it('projects a played minion onto the board before evaluating its Battlecry', () => {
    const scenario = createMatchScenario({ seed: 44 })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId: playerId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: playerId,
        cardId: 'league_of_explorers_gorillabot_a_3'
      }).accepted
    ).toBe(true)
    const gorillabot = player(scenario, playerId).hand[0]!

    expect(
      scenario.match.getPlayInput?.(playerId, gorillabot.instanceId)?.effectPreview
    ).toBeNull()
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'goblins_vs_gnomes_clockwork_gnome'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.getPlayInput?.(playerId, gorillabot.instanceId)?.effectPreview
    ).toEqual({ conditionallyEnhanced: true })
  })

  it('projects the current play into Combo condition timing', () => {
    const scenario = createMatchScenario({ seed: 45 })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId: playerId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    for (const cardId of [
      'classic_defias_ringleader',
      'goblins_vs_gnomes_clockwork_gnome'
    ] as const) {
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId: playerId,
          cardId
        }).accepted
      ).toBe(true)
    }
    const defias = player(scenario, playerId).hand.find(
      (card) => card.cardId === 'classic_defias_ringleader'
    )!
    expect(
      scenario.match.getPlayInput?.(playerId, defias.instanceId)?.effectPreview
    ).toBeNull()
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const firstPlay = player(scenario, playerId).hand.find(
      (card) => card.cardId === 'goblins_vs_gnomes_clockwork_gnome'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: firstPlay.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.getPlayInput?.(playerId, defias.instanceId)?.effectPreview
    ).toEqual({ conditionallyEnhanced: true })
  })

  it('moves Alarm-o-Bot and its hand minion as identity-preserving instances', () => {
    const scenario = createMatchScenario({ seed: 117, cardId: 'classic_alarm_o_bot' })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    const opponentId = scenario.participants.find(
      (participantId) => participantId !== playerId
    )!
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId: playerId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: playerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const handWisp = player(scenario, playerId).hand[0]!
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'classic_alarm_o_bot'
      }).accepted
    ).toBe(true)
    const alarm = player(scenario, playerId).board[0]!
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: playerId }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)

    const after = player(scenario, playerId)
    expect(after.board).toHaveLength(1)
    expect(after.board[0]?.instanceId).toBe(handWisp.instanceId)
    expect(after.board[0]?.cardId).toBe('basic_acidic_swamp_ooze')
    expect(after.hand.some((card) => card.instanceId === alarm.instanceId)).toBe(true)
    expect(
      after.hand.find((card) => card.instanceId === alarm.instanceId)?.cardId
    ).toBe('classic_alarm_o_bot')
  })

  it('returns an enemy minion to its owner hand with the same identity', () => {
    const scenario = createMatchScenario({ seed: 118, cardId: 'basic_sap' })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    for (const participantId of [playerId, opponentId])
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, opponentId).board[0]!
    const sap = player(scenario, playerId).hand[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: sap.instanceId,
        targets: [
          { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).board).toHaveLength(0)
    expect(player(scenario, opponentId).hand).toContainEqual(
      expect.objectContaining({
        instanceId: target.instanceId,
        cardId: 'basic_acidic_swamp_ooze',
        currentCost: 2
      })
    )
  })

  it('transforms and permanently steals real minions without changing their instance IDs', () => {
    const transform = createMatchScenario({ seed: 119, cardId: 'basic_polymorph' })
    transform.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(transform)
    expect(
      transform.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      transform.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(transform, opponentId).board[0]!
    expect(
      transform.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: player(transform, playerId).hand[0]!.instanceId,
        targets: [
          { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(player(transform, opponentId).board[0]).toMatchObject({
      instanceId: target.instanceId,
      cardId: 'basic_sheep',
      attack: 1,
      health: 1,
      enchantments: []
    })

    const control = createMatchScenario({ seed: 120, cardId: 'basic_mind_control' })
    control.confirmBothMulligans()
    const [controllerId, originalControllerId] = activeParticipants(control)
    expect(
      control.match.dispatch({
        type: 'dev-set-mana',
        participantId: controllerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      control.match.dispatch({
        type: 'dev-summon-minion',
        participantId: originalControllerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const stolen = player(control, originalControllerId).board[0]!
    expect(
      control.match.dispatch({
        type: 'play-card',
        participantId: controllerId,
        cardInstanceId: player(control, controllerId).hand[0]!.instanceId,
        targets: [
          {
            kind: 'minion',
            participantId: originalControllerId,
            instanceId: stolen.instanceId
          }
        ]
      }).accepted
    ).toBe(true)
    expect(player(control, originalControllerId).board).toHaveLength(0)
    expect(player(control, controllerId).board[0]).toMatchObject({
      instanceId: stolen.instanceId,
      ownerId: originalControllerId,
      controllerId
    })
  })

  it('returns Shadow Madness control to the original controller at end of turn', () => {
    const scenario = createMatchScenario({
      seed: 121,
      cardId: 'classic_shadow_madness'
    })
    scenario.confirmBothMulligans()
    const [controllerId, ownerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: controllerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: ownerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, ownerId).board[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: controllerId,
        cardInstanceId: player(scenario, controllerId).hand[0]!.instanceId,
        targets: [
          { kind: 'minion', participantId: ownerId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    const controlled = player(scenario, controllerId).board[0]!
    expect(controlled).toMatchObject({
      instanceId: target.instanceId,
      controllerChangedOnTurn: scenario.match.getState().turnNumber,
      enchantments: [
        expect.objectContaining({
          keywords: ['charge'],
          returnControllerId: ownerId,
          duration: 'this-turn'
        })
      ]
    })
    expect(
      getMatchLegality(scenario.match.getState(), controllerId).legalAttackerInstanceIds
    ).toContain(target.instanceId)
    expect(
      scenario.match.dispatch({
        type: 'attack-character',
        participantId: controllerId,
        attacker: { kind: 'minion', instanceId: target.instanceId },
        defender: { kind: 'hero' }
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: controllerId })
        .accepted
    ).toBe(true)
    expect(player(scenario, ownerId).board[0]).toMatchObject({
      instanceId: target.instanceId,
      controllerId: ownerId,
      ownerId,
      enchantments: []
    })
  })

  it.each([
    {
      cardId: 'classic_cabal_shadow_priest' as const,
      targetCardId: 'classic_wisp' as const,
      targetCount: 1
    },
    {
      cardId: 'classic_mind_control_tech' as const,
      targetCardId: 'basic_acidic_swamp_ooze' as const,
      targetCount: 4
    },
    {
      cardId: 'classic_sylvanas_windrunner' as const,
      targetCardId: 'basic_acidic_swamp_ooze' as const,
      targetCount: 1
    }
  ])('$cardId gives a permanently stolen minion control exhaustion', (entry) => {
    const scenario = createMatchScenario({ seed: 1220, cardId: entry.cardId })
    scenario.confirmBothMulligans()
    const [controllerId, ownerId] = activeParticipants(scenario)
    for (let index = 0; index < entry.targetCount; index += 1)
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: ownerId,
          cardId: entry.targetCardId
        }).accepted
      ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: controllerId })
        .accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: ownerId }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: controllerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const targetIds = player(scenario, ownerId).board.map((minion) => minion.instanceId)

    if (entry.cardId === 'classic_cabal_shadow_priest') {
      const cabal = player(scenario, controllerId).hand.find(
        (card) => card.cardId === entry.cardId
      )!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId: controllerId,
          cardInstanceId: cabal.instanceId,
          position: 0,
          targets: [
            {
              kind: 'minion',
              participantId: ownerId,
              instanceId: targetIds[0]!
            }
          ]
        }).accepted
      ).toBe(true)
    } else if (entry.cardId === 'classic_mind_control_tech') {
      const tech = player(scenario, controllerId).hand.find(
        (card) => card.cardId === entry.cardId
      )!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId: controllerId,
          cardInstanceId: tech.instanceId,
          position: 0
        }).accepted
      ).toBe(true)
    } else {
      const sylvanas = player(scenario, controllerId).hand.find(
        (card) => card.cardId === entry.cardId
      )!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId: controllerId,
          cardInstanceId: sylvanas.instanceId,
          position: 0
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId: controllerId,
          cardId: 'basic_shadow_word_death'
        }).accepted
      ).toBe(true)
      const destroy = player(scenario, controllerId).hand.find(
        (card) => card.cardId === 'basic_shadow_word_death'
      )!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId: controllerId,
          cardInstanceId: destroy.instanceId,
          targets: [
            {
              kind: 'minion',
              participantId: controllerId,
              instanceId: sylvanas.instanceId
            }
          ]
        }).accepted
      ).toBe(true)
    }

    const stolen = player(scenario, controllerId).board.find((minion) =>
      targetIds.includes(minion.instanceId)
    )!
    expect(stolen.controllerChangedOnTurn).toBe(scenario.match.getState().turnNumber)
    expect(
      getMatchLegality(scenario.match.getState(), controllerId).legalAttackerInstanceIds
    ).not.toContain(stolen.instanceId)
  })

  it('applies permanent control exhaustion unless the stolen minion has Charge', () => {
    const normal = createMatchScenario({ seed: 1221, cardId: 'basic_mind_control' })
    normal.confirmBothMulligans()
    const [controllerId, ownerId] = activeParticipants(normal)
    expect(
      normal.match.dispatch({
        type: 'dev-summon-minion',
        participantId: ownerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    expect(
      normal.match.dispatch({ type: 'end-turn', participantId: controllerId }).accepted
    ).toBe(true)
    expect(
      normal.match.dispatch({ type: 'end-turn', participantId: ownerId }).accepted
    ).toBe(true)
    expect(
      normal.match.dispatch({
        type: 'dev-set-mana',
        participantId: controllerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const normalTarget = player(normal, ownerId).board[0]!
    expect(
      normal.match.dispatch({
        type: 'play-card',
        participantId: controllerId,
        cardInstanceId: player(normal, controllerId).hand[0]!.instanceId,
        targets: [
          {
            kind: 'minion',
            participantId: ownerId,
            instanceId: normalTarget.instanceId
          }
        ]
      }).accepted
    ).toBe(true)
    expect(
      getMatchLegality(normal.match.getState(), controllerId).legalAttackerInstanceIds
    ).not.toContain(normalTarget.instanceId)
    const rejectedAttack = normal.match.dispatch({
      type: 'attack-character',
      participantId: controllerId,
      attacker: { kind: 'minion', instanceId: normalTarget.instanceId },
      defender: { kind: 'hero' }
    })
    expect(rejectedAttack).toMatchObject({
      accepted: false,
      code: 'minion-cannot-attack'
    })
    expect(
      normal.match.dispatch({ type: 'end-turn', participantId: controllerId }).accepted
    ).toBe(true)
    expect(
      normal.match.dispatch({ type: 'end-turn', participantId: ownerId }).accepted
    ).toBe(true)
    expect(
      getMatchLegality(normal.match.getState(), controllerId).legalAttackerInstanceIds
    ).toContain(normalTarget.instanceId)

    const charged = createMatchScenario({ seed: 1222, cardId: 'basic_mind_control' })
    charged.confirmBothMulligans()
    const [chargeControllerId, chargeOwnerId] = activeParticipants(charged)
    expect(
      charged.match.dispatch({
        type: 'dev-summon-minion',
        participantId: chargeOwnerId,
        cardId: 'basic_stonetusk_boar'
      }).accepted
    ).toBe(true)
    expect(
      charged.match.dispatch({
        type: 'dev-set-mana',
        participantId: chargeControllerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const chargedTarget = player(charged, chargeOwnerId).board[0]!
    expect(
      charged.match.dispatch({
        type: 'play-card',
        participantId: chargeControllerId,
        cardInstanceId: player(charged, chargeControllerId).hand[0]!.instanceId,
        targets: [
          {
            kind: 'minion',
            participantId: chargeOwnerId,
            instanceId: chargedTarget.instanceId
          }
        ]
      }).accepted
    ).toBe(true)
    expect(
      getMatchLegality(charged.match.getState(), chargeControllerId)
        .legalAttackerInstanceIds
    ).toContain(chargedTarget.instanceId)
  })

  it('lets Shadow Madness use a minion that attacked on the preceding turn', () => {
    const scenario = createMatchScenario({
      seed: 1223,
      cardId: 'classic_shadow_madness'
    })
    scenario.confirmBothMulligans()
    const [controllerId, ownerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: ownerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, ownerId).board[0]!
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: controllerId })
        .accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'attack-character',
        participantId: ownerId,
        attacker: { kind: 'minion', instanceId: target.instanceId },
        defender: { kind: 'hero' }
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: ownerId }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: controllerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: controllerId,
        cardInstanceId: player(scenario, controllerId).hand[0]!.instanceId,
        targets: [
          { kind: 'minion', participantId: ownerId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(
      getMatchLegality(scenario.match.getState(), controllerId).legalAttackerInstanceIds
    ).toContain(target.instanceId)
  })

  it('does not let Shadow Madness bypass Freeze', () => {
    const scenario = createMatchScenario({
      seed: 12231,
      cardId: 'classic_shadow_madness'
    })
    scenario.confirmBothMulligans()
    const [controllerId, ownerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: controllerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: ownerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, ownerId).board[0]!
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: controllerId,
        cardId: 'basic_frost_nova'
      }).accepted
    ).toBe(true)
    const frostNova = player(scenario, controllerId).hand.find(
      (card) => card.cardId === 'basic_frost_nova'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: controllerId,
        cardInstanceId: frostNova.instanceId
      }).accepted
    ).toBe(true)
    const shadowMadness = player(scenario, controllerId).hand.find(
      (card) => card.cardId === 'classic_shadow_madness'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: controllerId,
        cardInstanceId: shadowMadness.instanceId,
        targets: [
          { kind: 'minion', participantId: ownerId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(
      getMatchLegality(scenario.match.getState(), controllerId).legalAttackerInstanceIds
    ).not.toContain(target.instanceId)
  })

  it('returns a Shadow Madness target immediately when it is silenced', () => {
    const scenario = createMatchScenario({
      seed: 1224,
      cardId: 'classic_shadow_madness'
    })
    scenario.confirmBothMulligans()
    const [controllerId, ownerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: controllerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: ownerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, ownerId).board[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: controllerId,
        cardInstanceId: player(scenario, controllerId).hand[0]!.instanceId,
        targets: [
          { kind: 'minion', participantId: ownerId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: controllerId,
        cardId: 'classic_silence'
      }).accepted
    ).toBe(true)
    const silence = player(scenario, controllerId).hand.find(
      (card) => card.cardId === 'classic_silence'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: controllerId,
        cardInstanceId: silence.instanceId,
        targets: [
          { kind: 'minion', participantId: controllerId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(player(scenario, controllerId).board).toHaveLength(0)
    expect(player(scenario, ownerId).board[0]).toMatchObject({
      instanceId: target.instanceId,
      controllerId: ownerId,
      silenced: true,
      enchantments: []
    })
  })

  it('keeps a transformed Shadow Madness target permanently', () => {
    const scenario = createMatchScenario({
      seed: 1225,
      cardId: 'classic_shadow_madness'
    })
    scenario.confirmBothMulligans()
    const [controllerId, ownerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: controllerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: ownerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, ownerId).board[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: controllerId,
        cardInstanceId: player(scenario, controllerId).hand[0]!.instanceId,
        targets: [
          { kind: 'minion', participantId: ownerId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: controllerId,
        cardId: 'basic_polymorph'
      }).accepted
    ).toBe(true)
    const polymorph = player(scenario, controllerId).hand.find(
      (card) => card.cardId === 'basic_polymorph'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: controllerId,
        cardInstanceId: polymorph.instanceId,
        targets: [
          { kind: 'minion', participantId: controllerId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: controllerId })
        .accepted
    ).toBe(true)
    expect(player(scenario, controllerId).board[0]).toMatchObject({
      instanceId: target.instanceId,
      cardId: 'basic_sheep',
      controllerId
    })
    expect(player(scenario, ownerId).board).toHaveLength(0)
  })

  it('resurrects Reincarnate targets as fresh, full-health board instances', () => {
    const scenario = createMatchScenario({ seed: 122, cardId: 'naxxramas_reincarnate' })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, opponentId).board[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: player(scenario, playerId).hand[0]!.instanceId,
        targets: [
          { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    const resurrected = player(scenario, opponentId).board[0]!
    expect(resurrected).toMatchObject({
      cardId: 'basic_acidic_swamp_ooze',
      attack: 3,
      health: 2,
      maxHealth: 2,
      enchantments: []
    })
    expect(resurrected.instanceId).not.toBe(target.instanceId)
    expect(player(scenario, opponentId).graveyard ?? []).toHaveLength(0)
  })

  it.each(['basic_mind_control', 'classic_shadow_madness'] as const)(
    'rejects %s when its controller board is already full',
    (cardId) => {
      const scenario = createMatchScenario({ seed: 123, cardId })
      scenario.confirmBothMulligans()
      const [controllerId, ownerId] = activeParticipants(scenario)
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId: controllerId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      for (let index = 0; index < 7; index += 1)
        expect(
          scenario.match.dispatch({
            type: 'dev-summon-minion',
            participantId: controllerId,
            cardId: 'basic_acidic_swamp_ooze'
          }).accepted
        ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: ownerId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
      const target = player(scenario, ownerId).board[0]!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId: controllerId,
          cardInstanceId: player(scenario, controllerId).hand[0]!.instanceId,
          targets: [
            { kind: 'minion', participantId: ownerId, instanceId: target.instanceId }
          ]
        })
      ).toMatchObject({ accepted: false, code: 'board-full' })
      expect(player(scenario, controllerId).board).toHaveLength(7)
      expect(player(scenario, ownerId).board[0]).toMatchObject({
        instanceId: target.instanceId,
        controllerId: ownerId
      })
    }
  )

  it('destroys a Cabal Shadow Priest target when its Battlecry has no board slot', () => {
    const scenario = createMatchScenario({
      seed: 1231,
      cardId: 'classic_cabal_shadow_priest'
    })
    scenario.confirmBothMulligans()
    const [controllerId, ownerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: controllerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    for (let index = 0; index < 6; index += 1)
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: controllerId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: ownerId,
        cardId: 'classic_wisp'
      }).accepted
    ).toBe(true)
    const target = player(scenario, ownerId).board[0]!
    const cabal = player(scenario, controllerId).hand.find(
      (card) => card.cardId === 'classic_cabal_shadow_priest'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: controllerId,
        cardInstanceId: cabal.instanceId,
        position: 6,
        targets: [
          { kind: 'minion', participantId: ownerId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(player(scenario, controllerId).board).toHaveLength(7)
    expect(player(scenario, ownerId).board).toHaveLength(0)
  })

  it('destroys a Shadow Madness target when its original board fills before return', () => {
    const scenario = createMatchScenario({
      seed: 1232,
      cardId: 'classic_shadow_madness'
    })
    scenario.confirmBothMulligans()
    const [controllerId, ownerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: controllerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    for (let index = 0; index < 7; index += 1)
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: ownerId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
    const target = player(scenario, ownerId).board[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: controllerId,
        cardInstanceId: player(scenario, controllerId).hand[0]!.instanceId,
        targets: [
          { kind: 'minion', participantId: ownerId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: ownerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    expect(player(scenario, ownerId).board).toHaveLength(7)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: controllerId })
        .accepted
    ).toBe(true)
    expect(player(scenario, controllerId).board).toHaveLength(0)
    expect(
      player(scenario, ownerId).board.some(
        (minion) => minion.instanceId === target.instanceId
      )
    ).toBe(false)
  })

  it('burns a bounced minion when its owner hand is full', () => {
    const scenario = createMatchScenario({ seed: 124, cardId: 'basic_sap' })
    scenario.confirmBothMulligans()
    const [playerId, ownerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId: ownerId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    for (let index = 0; index < 10; index += 1)
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId: ownerId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: ownerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, ownerId).board[0]!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: player(scenario, playerId).hand[0]!.instanceId,
        targets: [
          { kind: 'minion', participantId: ownerId, instanceId: target.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(player(scenario, ownerId).board).toHaveLength(0)
    expect(player(scenario, ownerId).hand).toHaveLength(10)
    expect(player(scenario, ownerId).discardedCards).toContainEqual(
      expect.objectContaining({ instanceId: target.instanceId, cardId: target.cardId })
    )
  })

  it('replays a seeded command with identical state, events, trace, ids, and RNG path', () => {
    const first = createMatchScenario({ seed: 91, cardId: 'basic_fireball' })
    const second = createMatchScenario({ seed: 91, cardId: 'basic_fireball' })
    first.confirmBothMulligans()
    second.confirmBothMulligans()
    const firstPlayerId = first.match.getState().activePlayerId!
    const secondPlayerId = second.match.getState().activePlayerId!
    expect(secondPlayerId).toBe(firstPlayerId)
    const firstOpponentId = first.participants.find(
      (participantId) => participantId !== firstPlayerId
    )!
    const secondOpponentId = second.participants.find(
      (participantId) => participantId !== secondPlayerId
    )!
    for (const scenario of [first, second])
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId: scenario.match.getState().activePlayerId!,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
    const firstCard = first.match
      .getState()
      .players.find((player) => player.participantId === firstPlayerId)!.hand[0]!
    const secondCard = second.match
      .getState()
      .players.find((player) => player.participantId === secondPlayerId)!.hand[0]!
    const firstResult = first.match.dispatch({
      type: 'play-card',
      participantId: firstPlayerId,
      cardInstanceId: firstCard.instanceId,
      targets: [{ kind: 'hero', participantId: firstOpponentId }]
    })
    const secondResult = second.match.dispatch({
      type: 'play-card',
      participantId: secondPlayerId,
      cardInstanceId: secondCard.instanceId,
      targets: [{ kind: 'hero', participantId: secondOpponentId }]
    })
    expect(firstResult).toEqual(secondResult)
    expect(first.match.getState()).toEqual(second.match.getState())
    expect(first.match.getEffectTrace?.()).toEqual(second.match.getEffectTrace?.())
    expect(
      firstResult.accepted &&
        firstResult.events
          .filter((event) => event.type === 'effect-resolved')
          .every((event) => event.correlation?.resolutionId)
    ).toBe(true)
    expect(
      first.match
        .getState()
        .players.flatMap((player) => [
          ...player.hand.map((card) => card.instanceId),
          ...player.deck.map((card) => card.instanceId),
          ...player.board.map((minion) => minion.instanceId)
        ])
    ).toEqual(
      second.match
        .getState()
        .players.flatMap((player) => [
          ...player.hand.map((card) => card.instanceId),
          ...player.deck.map((card) => card.instanceId),
          ...player.board.map((minion) => minion.instanceId)
        ])
    )
  })
  it('replays random effects with identical RNG consumption', () => {
    const first = createMatchScenario({ seed: 93, cardId: 'basic_arcane_missiles' })
    const second = createMatchScenario({ seed: 93, cardId: 'basic_arcane_missiles' })
    first.confirmBothMulligans()
    second.confirmBothMulligans()
    const firstPlayerId = first.match.getState().activePlayerId!
    const secondPlayerId = second.match.getState().activePlayerId!
    const firstState = first.match.getState()
    const secondState = second.match.getState()
    const firstCard = firstState.players
      .find((player) => player.participantId === firstPlayerId)!
      .hand.find((card) => card.cardId === 'basic_arcane_missiles')!
    const secondCard = secondState.players
      .find((player) => player.participantId === secondPlayerId)!
      .hand.find((card) => card.cardId === 'basic_arcane_missiles')!
    const makeRng = () => {
      let calls = 0
      return {
        rng: {
          next(): number {
            calls += 1
            return 0.25
          },
          snapshot(): number {
            return calls
          },
          restore(snapshot: unknown): void {
            calls = typeof snapshot === 'number' ? snapshot : calls
          }
        },
        get calls(): number {
          return calls
        }
      }
    }
    const firstRng = makeRng()
    const secondRng = makeRng()
    const firstResult = resolveCardPlay({
      state: firstState,
      rng: firstRng.rng,
      participantId: firstPlayerId,
      cardInstanceId: firstCard.instanceId,
      nextEntityOrdinal: firstState.nextEntityOrdinal
    })
    const secondResult = resolveCardPlay({
      state: secondState,
      rng: secondRng.rng,
      participantId: secondPlayerId,
      cardInstanceId: secondCard.instanceId,
      nextEntityOrdinal: secondState.nextEntityOrdinal
    })
    expect(firstResult).toEqual(secondResult)
    expect(firstRng.calls).toBeGreaterThan(0)
    expect(firstRng.calls).toBe(secondRng.calls)
  })
  it('rolls a resolver failure back across state, counters, events, trace, and RNG', () => {
    const scenario = createMatchScenario({ seed: 92, cardId: 'basic_arcane_missiles' })
    scenario.confirmBothMulligans()
    const state = scenario.match.getState()
    const participantId = state.activePlayerId!
    const card = state.players.find((player) => player.participantId === participantId)!
      .hand[0]!
    let restored: unknown
    const rng = {
      next(): number {
        throw new Error('deterministic test failure')
      },
      snapshot(): number {
        return 17
      },
      restore(snapshot: unknown): void {
        restored = snapshot
      }
    }
    const result = resolveCardPlay({
      state,
      rng,
      participantId,
      cardInstanceId: card.instanceId,
      nextEntityOrdinal: state.nextEntityOrdinal
    })
    expect(result.accepted).toBe(false)
    if (result.accepted) return
    expect(result.code).toBe('resolution-failed')
    expect(result.state).toEqual(state)
    expect(result.events).toEqual([])
    expect(result.trace).toEqual([])
    expect(result.triggerEvents).toEqual([])
    expect(result.nextEntityOrdinal).toBe(state.nextEntityOrdinal)
    expect(restored).toBe(17)
    expect(result.diagnostic.recentQueue.length).toBeGreaterThan(0)
  })

  it('preserves while-damaged enchantments while inactive and reapplies them after damage', () => {
    const scenario = createMatchScenario({ seed: 94, cardId: 'basic_arcane_shot' })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)

    const fullHealthState = scenario.match.getState()
    const playerIndex = fullHealthState.players.findIndex(
      (player) => player.participantId === participantId
    )
    const minion = fullHealthState.players[playerIndex]!.board[0]!
    const inactiveState = {
      ...fullHealthState,
      players: fullHealthState.players.map((player, index) =>
        index !== playerIndex
          ? player
          : {
              ...player,
              board: player.board.map((entry) =>
                entry.instanceId !== minion.instanceId
                  ? entry
                  : {
                      ...entry,
                      enchantments: [
                        {
                          id: 'while-damaged-test',
                          sourceInstanceId: entry.instanceId,
                          sourceCardId: null,
                          attackDelta: 2,
                          duration: 'while-damaged'
                        }
                      ]
                    }
              )
            }
      )
    } as unknown as typeof fullHealthState
    const firstCard = inactiveState.players[playerIndex]!.hand[0]!
    const inactiveResult = resolveCardPlay({
      state: inactiveState,
      rng: scenario.rng,
      participantId,
      cardInstanceId: firstCard.instanceId,
      targets: [{ kind: 'hero', participantId: opponentId }],
      nextEntityOrdinal: inactiveState.nextEntityOrdinal
    })
    expect(inactiveResult.accepted).toBe(true)
    if (!inactiveResult.accepted) return
    const inactiveMinion = inactiveResult.state.players[playerIndex]!.board[0]!
    expect(inactiveMinion.attack).toBe(3)
    expect(inactiveMinion.enchantments).toHaveLength(1)

    const damagedState = {
      ...inactiveResult.state,
      players: inactiveResult.state.players.map((player, index) =>
        index !== playerIndex
          ? player
          : {
              ...player,
              board: player.board.map((entry) =>
                entry.instanceId !== minion.instanceId
                  ? entry
                  : { ...entry, health: entry.maxHealth - 1 }
              )
            }
      )
    } as unknown as typeof inactiveResult.state
    const secondCard = damagedState.players[playerIndex]!.hand[0]!
    const damagedResult = resolveCardPlay({
      state: damagedState,
      rng: scenario.rng,
      participantId,
      cardInstanceId: secondCard.instanceId,
      targets: [{ kind: 'hero', participantId: opponentId }],
      nextEntityOrdinal: damagedState.nextEntityOrdinal
    })
    expect(damagedResult.accepted).toBe(true)
    if (!damagedResult.accepted) return
    expect(damagedResult.state.players[playerIndex]!.board[0]).toMatchObject({
      attack: 5,
      health: 1,
      maxHealth: 2
    })
  })
  it('keeps delayed keywords out of combat legality until their start turn', () => {
    const scenario = createMatchScenario({ seed: 98 })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const state = scenario.match.getState()
    const playerIndex = state.players.findIndex(
      (player) => player.participantId === participantId
    )
    const minion = state.players[playerIndex]!.board[0]!
    const delayedState = {
      ...state,
      players: state.players.map((player, index) =>
        index !== playerIndex
          ? player
          : {
              ...player,
              board: player.board.map((entry) =>
                entry.instanceId !== minion.instanceId
                  ? entry
                  : {
                      ...entry,
                      summonedOnTurn: state.turnNumber - 1,
                      enchantments: [
                        {
                          id: 'next-turn-cannot-attack',
                          sourceInstanceId: entry.instanceId,
                          sourceCardId: null,
                          keywords: ['cannot-attack'],
                          duration: 'next-turn',
                          startsOnTurn: state.turnNumber + 1,
                          expiresOnTurn: state.turnNumber + 1
                        }
                      ]
                    }
              )
            }
      )
    } as unknown as typeof state
    expect(
      getMatchLegality(delayedState, participantId).legalAttackerInstanceIds
    ).toContain(minion.instanceId)
    expect(
      getMatchLegality(
        { ...delayedState, turnNumber: state.turnNumber + 1 },
        participantId
      ).legalAttackerInstanceIds
    ).not.toContain(minion.instanceId)
  })
  it("expires a real this-attack keyword after Gladiator's Longbow combat", () => {
    const scenario = createMatchScenario({
      seed: 97,
      firstHeroId: 'rexxar',
      cardId: 'classic_gladiators_longbow'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const longbow = player(scenario, playerId).hand.find(
      (card) => card.cardId === 'classic_gladiators_longbow'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: longbow.instanceId
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_chillwind_yeti'
      }).accepted
    ).toBe(true)
    const defender = player(scenario, opponentId).board[0]!
    const before = player(scenario, playerId).hero.health
    const attack = scenario.match.dispatch({
      type: 'attack-character',
      participantId: playerId,
      attacker: { kind: 'hero' },
      defender: {
        kind: 'minion',
        participantId: opponentId,
        instanceId: defender.instanceId
      }
    })
    expect(attack.accepted).toBe(true)
    const hero = player(scenario, playerId).hero
    expect(
      attack.events.find((event) => event.type === 'combat-started')
    ).toMatchObject({
      attacker: { immune: true }
    })
    expect(hero.health).toBe(before)
    expect(hero.immune).toBe(false)
    expect(hero.enchantments ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ duration: 'this-attack' })])
    )
  })
  it('retains delayed stat enchantments and removes source-bound effects after the source leaves play', () => {
    const scenario = createMatchScenario({ seed: 96 })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    for (let index = 0; index < 2; index += 1) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
    }
    const state = scenario.match.getState()
    const playerIndex = state.players.findIndex(
      (player) => player.participantId === participantId
    )
    const source = state.players[playerIndex]!.board[0]!
    const target = state.players[playerIndex]!.board[1]!
    const baseAttack = target.attack
    const delayedState = {
      ...state,
      players: state.players.map((player, index) =>
        index !== playerIndex
          ? player
          : {
              ...player,
              board: player.board.map((minion) =>
                minion.instanceId !== target.instanceId
                  ? minion
                  : {
                      ...minion,
                      enchantments: [
                        {
                          id: 'next-turn-stat',
                          sourceInstanceId: source.instanceId,
                          sourceCardId: null,
                          attackDelta: 2,
                          duration: 'next-turn',
                          startsOnTurn: state.turnNumber + 1,
                          expiresOnTurn: state.turnNumber + 1
                        },
                        {
                          id: 'source-bound-stat',
                          sourceInstanceId: source.instanceId,
                          sourceCardId: null,
                          attackDelta: 3,
                          duration: 'while-source-in-play'
                        }
                      ]
                    }
              )
            }
      )
    } as unknown as typeof state
    const dormant = getDerivedState(delayedState)
    expect(dormant.players[playerIndex]!.board[1]).toMatchObject({
      attack: baseAttack + 3,
      enchantments: expect.arrayContaining([
        expect.objectContaining({ id: 'next-turn-stat' })
      ])
    })
    const active = getDerivedState({
      ...delayedState,
      turnNumber: state.turnNumber + 1
    })
    expect(active.players[playerIndex]!.board[1]!.attack).toBe(baseAttack + 5)
    const expired = getDerivedState({
      ...delayedState,
      turnNumber: state.turnNumber + 2
    })
    expect(expired.players[playerIndex]!.board[1]!.attack).toBe(baseAttack + 3)

    const sourceInHand = getDerivedState({
      ...expired,
      players: expired.players.map((player, index) =>
        index !== playerIndex
          ? player
          : {
              ...player,
              board: player.board.filter(
                (minion) => minion.instanceId !== source.instanceId
              ),
              hand: player.hand.map((card, handIndex) =>
                handIndex === 0 ? { ...card, instanceId: source.instanceId } : card
              )
            }
      )
    } as unknown as typeof state)
    expect(sourceInHand.players[playerIndex]!.board[0]!.attack).toBe(baseAttack)
  })
  it('retains a real next-turn cost modifier until it becomes active and expires', () => {
    expect(CARD_CATALOG.require('naxxramas_loatheb').effects).toMatchObject([
      {
        actions: [{ deferUntil: 'matching-cards-until-expiry' }]
      }
    ])
    const scenario = createMatchScenario({ seed: 95, cardId: 'naxxramas_loatheb' })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: opponentId,
        cardId: 'basic_arcane_shot'
      }).accepted
    ).toBe(true)
    const loatheb = player(scenario, playerId).hand.find(
      (card) => card.cardId === 'naxxramas_loatheb'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: loatheb.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).pendingCostModifiers).toHaveLength(1)

    const spellCost = () =>
      player(scenario, opponentId).hand.find(
        (card) => card.cardId === 'basic_arcane_shot'
      )!.currentCost
    expect(spellCost()).toBe(1)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: playerId }).accepted
    ).toBe(true)
    expect(spellCost()).toBe(6)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: opponentId,
        cardId: 'basic_fireball'
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, opponentId).hand.find((card) => card.cardId === 'basic_fireball')
        ?.currentCost
    ).toBe(9)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)
    expect(spellCost()).toBe(1)
  })
  it('projects branch-specific choices and targets through canonical input', () => {
    const first = createMatchScenario({
      seed: 60,
      cardId: 'classic_keeper_of_the_grove'
    })
    first.confirmBothMulligans()
    const firstPlayerId = first.match.getState().activePlayerId!
    const firstOpponentId = first.participants.find(
      (participantId) => participantId !== firstPlayerId
    )!
    expect(
      first.match.dispatch({
        type: 'dev-set-mana',
        participantId: firstPlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const firstCard = first.match
      .getState()
      .players.find((player) => player.participantId === firstPlayerId)!
      .hand.find((card) => card.cardId === 'classic_keeper_of_the_grove')!
    const firstInput = first.match.getPlayInput?.(firstPlayerId, firstCard.instanceId)
    expect(firstInput).toMatchObject({
      choiceCount: 2,
      legalChoices: [0, 1],
      requiresPosition: true
    })
    expect(firstInput?.targetSelectors).toHaveLength(1)
    expect(firstInput?.legalTargetOptions).toEqual([
      [
        { kind: 'hero', participantId: firstPlayerId },
        { kind: 'hero', participantId: firstOpponentId }
      ]
    ])
    const firstSecondChoiceInput = first.match.getPlayInput?.(
      firstPlayerId,
      firstCard.instanceId,
      1
    )
    expect(firstSecondChoiceInput?.targetSelectors).toEqual([])
    expect(firstSecondChoiceInput?.legalTargetOptions).toEqual([])
    expect(first.match.getLegality?.(firstPlayerId).playableCardInstanceIds).toContain(
      firstCard.instanceId
    )
    const firstResult = first.match.dispatch({
      type: 'play-card',
      participantId: firstPlayerId,
      cardInstanceId: firstCard.instanceId,
      position: 0,
      targets: [{ kind: 'hero', participantId: firstOpponentId }],
      choice: 0
    })
    expect(firstResult.accepted).toBe(true)

    const second = createMatchScenario({
      seed: 61,
      cardId: 'classic_keeper_of_the_grove'
    })
    second.confirmBothMulligans()
    const secondPlayerId = second.match.getState().activePlayerId!
    const secondOpponentId = second.participants.find(
      (participantId) => participantId !== secondPlayerId
    )!
    expect(
      second.match.dispatch({
        type: 'dev-set-mana',
        participantId: secondPlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      second.match.dispatch({
        type: 'dev-summon-minion',
        participantId: secondOpponentId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const targetMinion = second.match
      .getState()
      .players.find((player) => player.participantId === secondOpponentId)!.board[0]!
    const secondCard = second.match
      .getState()
      .players.find((player) => player.participantId === secondPlayerId)!
      .hand.find((card) => card.cardId === 'classic_keeper_of_the_grove')!
    const secondChoiceInput = second.match.getPlayInput?.(
      secondPlayerId,
      secondCard.instanceId,
      1
    )
    expect(secondChoiceInput?.legalTargetOptions[0]).toEqual([
      {
        kind: 'minion',
        participantId: secondOpponentId,
        instanceId: targetMinion.instanceId
      }
    ])
    const secondResult = second.match.dispatch({
      type: 'play-card',
      participantId: secondPlayerId,
      cardInstanceId: secondCard.instanceId,
      position: 0,
      targets: [
        {
          kind: 'minion',
          participantId: secondOpponentId,
          instanceId: targetMinion.instanceId
        }
      ],
      choice: 1
    })
    expect(secondResult.accepted).toBe(true)
  })

  it('returns stable target rejection codes without mutating the match', () => {
    const setup = (seed: number, cardId = 'basic_arcane_shot') => {
      const scenario = createMatchScenario({
        seed,
        cardId
      })
      scenario.confirmBothMulligans()
      const playerId = scenario.match.getState().activePlayerId!
      const opponentId = scenario.participants.find(
        (participantId) => participantId !== playerId
      )!
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId: playerId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      return { scenario, playerId, opponentId, cardId }
    }
    const assertRejected = (
      seed: number,
      target: unknown,
      expectedCode: string
    ): void => {
      const { scenario, playerId, cardId } = setup(seed)
      const before = scenario.match.getState()
      const card = before.players
        .find((player) => player.participantId === playerId)!
        .hand.find((entry) => entry.cardId === cardId)!
      const result = scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: card.instanceId,
        targets: [target]
      })
      expect(result.accepted).toBe(false)
      if (result.accepted) return
      expect(result.code).toBe(expectedCode)
      expect(result.state).toEqual(before)
    }

    const wrongController = setup(62, 'basic_frost_shock')
    const wrongControllerBefore = wrongController.scenario.match.getState()
    const wrongControllerCard = wrongControllerBefore.players
      .find((player) => player.participantId === wrongController.playerId)!
      .hand.find((entry) => entry.cardId === wrongController.cardId)!
    const wrongControllerResult = wrongController.scenario.match.dispatch({
      type: 'play-card',
      participantId: wrongController.playerId,
      cardInstanceId: wrongControllerCard.instanceId,
      targets: [{ kind: 'hero', participantId: wrongController.playerId }]
    })
    expect(wrongControllerResult.accepted).toBe(false)
    if (!wrongControllerResult.accepted) {
      expect(wrongControllerResult.code).toBe('wrong-controller')
      expect(wrongControllerResult.state).toEqual(wrongControllerBefore)
    }

    assertRejected(
      63,
      { kind: 'minion', participantId: 'scenario-player-two', instanceId: 'stale' },
      'stale-target'
    )

    const illegal = setup(64)
    const illegalBefore = illegal.scenario.match.getState()
    const illegalCard = illegalBefore.players
      .find((player) => player.participantId === illegal.playerId)!
      .hand.find((entry) => entry.cardId === 'basic_arcane_shot')!
    const illegalTarget = illegalBefore.players.find(
      (player) => player.participantId === illegal.opponentId
    )!.hand[0]!
    const illegalResult = illegal.scenario.match.dispatch({
      type: 'play-card',
      participantId: illegal.playerId,
      cardInstanceId: illegalCard.instanceId,
      targets: [
        {
          kind: 'card',
          participantId: illegal.opponentId,
          instanceId: illegalTarget.instanceId
        }
      ]
    })
    expect(illegalResult.accepted).toBe(false)
    if (!illegalResult.accepted) {
      expect(illegalResult.code).toBe('illegal-target')
      expect(illegalResult.state).toEqual(illegalBefore)
    }

    const wrongZone = setup(65)
    const wrongZoneBefore = wrongZone.scenario.match.getState()
    const wrongZoneCard = wrongZoneBefore.players
      .find((player) => player.participantId === wrongZone.playerId)!
      .hand.find((entry) => entry.cardId === 'basic_arcane_shot')!
    const handTarget = wrongZoneBefore.players.find(
      (player) => player.participantId === wrongZone.opponentId
    )!.hand[0]!
    const wrongZoneResult = wrongZone.scenario.match.dispatch({
      type: 'play-card',
      participantId: wrongZone.playerId,
      cardInstanceId: wrongZoneCard.instanceId,
      targets: [
        {
          kind: 'minion',
          participantId: wrongZone.opponentId,
          instanceId: handTarget.instanceId
        }
      ]
    })
    expect(wrongZoneResult.accepted).toBe(false)
    if (!wrongZoneResult.accepted) {
      expect(wrongZoneResult.code).toBe('wrong-zone')
      expect(wrongZoneResult.state).toEqual(wrongZoneBefore)
    }

    const immune = setup(66)
    expect(
      immune.scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: immune.opponentId,
        cardId: 'classic_faerie_dragon'
      }).accepted
    ).toBe(true)
    const immuneBefore = immune.scenario.match.getState()
    const immuneCard = immuneBefore.players
      .find((player) => player.participantId === immune.playerId)!
      .hand.find((entry) => entry.cardId === 'basic_arcane_shot')!
    const immuneTarget = immuneBefore.players.find(
      (player) => player.participantId === immune.opponentId
    )!.board[0]!
    const immuneResult = immune.scenario.match.dispatch({
      type: 'play-card',
      participantId: immune.playerId,
      cardInstanceId: immuneCard.instanceId,
      targets: [
        {
          kind: 'minion',
          participantId: immune.opponentId,
          instanceId: immuneTarget.instanceId
        }
      ]
    })
    expect(immuneResult.accepted).toBe(false)
    if (!immuneResult.accepted) {
      expect(immuneResult.code).toBe('immune-target')
      expect(immuneResult.state).toEqual(immuneBefore)
    }
  })

  it('rejects extra card input and invalid choices atomically', () => {
    const extra = createMatchScenario({ seed: 67, cardId: 'basic_the_coin' })
    extra.confirmBothMulligans()
    const extraPlayerId = extra.match.getState().activePlayerId!
    expect(
      extra.match.dispatch({
        type: 'dev-set-mana',
        participantId: extraPlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const extraBefore = extra.match.getState()
    const extraCard = extraBefore.players.find(
      (player) => player.participantId === extraPlayerId
    )!.hand[0]!
    const extraResult = extra.match.dispatch({
      type: 'play-card',
      participantId: extraPlayerId,
      cardInstanceId: extraCard.instanceId,
      targets: [{ kind: 'hero', participantId: extraPlayerId }]
    })
    expect(extraResult.accepted).toBe(false)
    if (!extraResult.accepted) {
      expect(extraResult.code).toBe('extra-input')
      expect(extraResult.state).toEqual(extraBefore)
    }

    const duplicate = createMatchScenario({
      seed: 68,
      cardId: 'classic_keeper_of_the_grove'
    })
    duplicate.confirmBothMulligans()
    const duplicatePlayerId = duplicate.match.getState().activePlayerId!
    const duplicateOpponentId = duplicate.participants.find(
      (participantId) => participantId !== duplicatePlayerId
    )!
    expect(
      duplicate.match.dispatch({
        type: 'dev-set-mana',
        participantId: duplicatePlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const duplicateBefore = duplicate.match.getState()
    const duplicateCard = duplicateBefore.players
      .find((player) => player.participantId === duplicatePlayerId)!
      .hand.find((entry) => entry.cardId === 'classic_keeper_of_the_grove')!
    const duplicateResult = duplicate.match.dispatch({
      type: 'play-card',
      participantId: duplicatePlayerId,
      cardInstanceId: duplicateCard.instanceId,
      position: 0,
      targets: [
        { kind: 'hero', participantId: duplicateOpponentId },
        { kind: 'hero', participantId: duplicateOpponentId }
      ],
      choice: 0
    })
    expect(duplicateResult.accepted).toBe(false)
    if (!duplicateResult.accepted) {
      expect(duplicateResult.code).toBe('duplicate-target')
      expect(duplicateResult.state).toEqual(duplicateBefore)
    }
    const choice = createMatchScenario({
      seed: 68,
      cardId: 'classic_power_of_the_wild'
    })
    choice.confirmBothMulligans()
    const choicePlayerId = choice.match.getState().activePlayerId!
    expect(
      choice.match.dispatch({
        type: 'dev-set-mana',
        participantId: choicePlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const choiceBefore = choice.match.getState()
    const choiceCard = choiceBefore.players.find(
      (player) => player.participantId === choicePlayerId
    )!.hand[0]!
    const missingChoice = choice.match.dispatch({
      type: 'play-card',
      participantId: choicePlayerId,
      cardInstanceId: choiceCard.instanceId
    })
    expect(missingChoice.accepted).toBe(false)
    if (!missingChoice.accepted) {
      expect(missingChoice.code).toBe('missing-input')
      expect(missingChoice.state).toEqual(choiceBefore)
    }
    const invalidChoice = choice.match.dispatch({
      type: 'play-card',
      participantId: choicePlayerId,
      cardInstanceId: choiceCard.instanceId,
      choice: 2
    })
    expect(invalidChoice.accepted).toBe(false)
    if (!invalidChoice.accepted) {
      expect(invalidChoice.code).toBe('extra-input')
      expect(invalidChoice.state).toEqual(choiceBefore)
    }
  })
  it('projects card type, resource, turn, board, and source-zone legality', () => {
    const scenario = createMatchScenario({
      seed: 69,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    const opponentId = scenario.participants.find(
      (participantId) => participantId !== playerId
    )!
    const minion = scenario.match
      .getState()
      .players.find((player) => player.participantId === playerId)!
      .hand.find((card) => card.cardId === 'basic_acidic_swamp_ooze')!
    expect(scenario.match.getPlayInput?.(playerId, minion.instanceId)).toMatchObject({
      requiresPosition: true,
      legalPositions: [0]
    })
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 0,
        maximum: 0
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.getLegality?.(playerId).playableCardInstanceIds
    ).not.toContain(minion.instanceId)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    for (const cardId of [
      'basic_arcanite_reaper',
      'classic_lord_jaraxxus',
      'basic_the_coin'
    ]) {
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId: playerId,
          cardId
        }).accepted
      ).toBe(true)
    }
    expect(scenario.match.getLegality?.(playerId).playableCardInstanceIds).toContain(
      minion.instanceId
    )
    for (let index = 0; index < 7; index += 1) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: playerId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
    }
    expect(
      scenario.match.getLegality?.(playerId).playableCardInstanceIds
    ).not.toContain(minion.instanceId)
    expect(
      scenario.match.getPlayInput?.(playerId, minion.instanceId)?.legalPositions
    ).toEqual([])
    expect(scenario.match.getLegality?.(opponentId)).toMatchObject({
      canEndTurn: false,
      playableCardInstanceIds: []
    })

    const staleBefore = scenario.match.getState()
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId: playerId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    const staleState = scenario.match.getState()
    const staleResult = scenario.match.dispatch({
      type: 'play-card',
      participantId: playerId,
      cardInstanceId: minion.instanceId,
      position: 0
    })
    expect(staleResult.accepted).toBe(false)
    if (!staleResult.accepted) {
      expect(staleResult.code).toBe('stale-target')
      expect(staleResult.state).toEqual(staleState)
    }
    expect(staleBefore.revision).toBeLessThan(staleState.revision)
  })

  it('rejects missing input atomically without consuming mana or the card', () => {
    const scenario = createMatchScenario({ seed: 42, cardId: 'basic_arcane_shot' })
    scenario.confirmBothMulligans()
    const playerId = scenario.match.getState().activePlayerId!
    const setMana = scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId: playerId,
      available: 10,
      maximum: 10
    })
    expect(setMana.accepted).toBe(true)
    const before = scenario.match.getState()
    const card = before.players.find((player) => player.participantId === playerId)!
      .hand[0]!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: playerId,
      cardInstanceId: card.instanceId
    })
    expect(result.accepted).toBe(false)
    if (result.accepted) return
    expect(result.code).toBe('missing-input')
    expect(result.state).toEqual(before)
    expect(result.events).toEqual([])
  })

  it('uses identical legality and mana payment for human and temporary-opponent controllers', () => {
    const humanFirst = createMatchScenario({
      seed: 49,
      cardId: 'basic_acidic_swamp_ooze',
      firstController: 'human',
      secondController: 'ai'
    })
    const aiFirst = createMatchScenario({
      seed: 49,
      cardId: 'basic_acidic_swamp_ooze',
      firstController: 'ai',
      secondController: 'human'
    })

    const playActiveCard = (scenario: ReturnType<typeof createMatchScenario>) => {
      scenario.confirmBothMulligans()
      const participantId = scenario.match.getState().activePlayerId!
      const mana = scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      })
      expect(mana.accepted).toBe(true)
      const legality = scenario.match.getLegality?.(participantId)
      const card = scenario.match
        .getState()
        .players.find((candidate) => candidate.participantId === participantId)!
        .hand[0]!
      expect(legality?.playableCardInstanceIds).toContain(card.instanceId)
      const result = scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        position: 0
      })
      expect(result.accepted).toBe(true)
      if (!result.accepted) return null
      const playerState = result.state.players.find(
        (candidate) => candidate.participantId === participantId
      )!
      return {
        participantId,
        mana: playerState.mana.available,
        hand: playerState.hand.length,
        board: playerState.board.map((minion) => ({
          cardId: minion.cardId,
          attack: minion.attack,
          health: minion.health
        }))
      }
    }

    expect(playActiveCard(humanFirst)).toEqual(playActiveCard(aiFirst))
  })
  it('resolves secret-played listeners against the canonical secret event', () => {
    const scenario = createMatchScenario({ seed: 43 })
    scenario.confirmBothMulligans()
    const [playerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'classic_secretkeeper'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: playerId,
        cardId: 'classic_ice_block'
      }).accepted
    ).toBe(true)
    const secret = scenario.match
      .getState()
      .players[0].hand.find((card) => card.cardId === 'classic_ice_block')
    expect(secret).toBeDefined()

    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: playerId,
      cardInstanceId: secret!.instanceId
    })
    expect(result.accepted).toBe(true)
    expect(player(scenario, playerId).board[0]).toMatchObject({
      cardId: 'classic_secretkeeper',
      attack: 2,
      health: 3
    })
  })

  it('returns a minion with Shadowstep and reduces its hand cost by two', () => {
    const scenario = createMatchScenario({ seed: 431 })
    scenario.confirmBothMulligans()
    const [playerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: playerId,
        cardId: 'classic_shadowstep'
      }).accepted
    ).toBe(true)

    const target = player(scenario, playerId).board[0]!
    const shadowstep = player(scenario, playerId).hand.find(
      (card) => card.cardId === 'classic_shadowstep'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: playerId,
      cardInstanceId: shadowstep.instanceId,
      targets: [
        {
          kind: 'minion',
          participantId: playerId,
          instanceId: target.instanceId
        }
      ]
    })

    expect(result.accepted).toBe(true)
    const returned = player(scenario, playerId).hand.find(
      (card) => card.instanceId === target.instanceId
    )
    expect(returned).toMatchObject({ currentCost: 0, zone: 'hand' })
    expect(returned?.costAdjustments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: -2, duration: 'while-in-hand' })
      ])
    )
  })

  it('returns an attacking minion with Freezing Trap and applies the hand cost increase', () => {
    const scenario = createMatchScenario({ seed: 44 })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: opponentId,
        cardId: 'classic_freezing_trap'
      }).accepted
    ).toBe(true)

    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: playerId }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: opponentId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const trap = player(scenario, opponentId).hand.find(
      (card) => card.cardId === 'classic_freezing_trap'
    )
    expect(trap).toBeDefined()
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: opponentId,
        cardInstanceId: trap!.instanceId
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)

    const attacker = player(scenario, playerId).board[0]
    expect(attacker).toBeDefined()
    const attackerInstanceId = attacker!.instanceId
    const result = scenario.match.dispatch({
      type: 'attack-character',
      participantId: playerId,
      attacker: { kind: 'minion', instanceId: attackerInstanceId },
      defender: { kind: 'hero' }
    })
    expect(result.accepted).toBe(true)
    const returned = player(scenario, playerId).hand.find(
      (card) => card.instanceId === attackerInstanceId
    )
    expect(returned).toMatchObject({ currentCost: 4, zone: 'hand' })
    expect(returned?.costAdjustments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 2, duration: 'while-in-hand' })
      ])
    )
  })

  it('fires armor triggers without treating armor gain as hero damage', () => {
    const scenario = createMatchScenario({ seed: 45, firstHeroId: 'garrosh' })
    scenario.confirmBothMulligans()
    const [playerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'goblins_vs_gnomes_siege_engine'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: playerId,
        cardId: 'classic_eye_for_an_eye'
      }).accepted
    ).toBe(true)
    const eye = player(scenario, playerId).hand.find(
      (card) => card.cardId === 'classic_eye_for_an_eye'
    )
    expect(eye).toBeDefined()
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: eye!.instanceId
      }).accepted
    ).toBe(true)

    const power = scenario.match.dispatch({
      type: 'use-hero-power',
      participantId: playerId
    })
    expect(power.accepted).toBe(true)
    expect(player(scenario, playerId)).toMatchObject({ hero: { armor: 2 } })
    expect(player(scenario, playerId).board[0]).toMatchObject({ attack: 6 })
    expect(player(scenario, playerId).secrets).toHaveLength(1)
  })

  it('applies Eye for an Eye to damage absorbed by armor', () => {
    const scenario = createMatchScenario({
      seed: 46,
      firstHeroId: 'rexxar',
      secondHeroId: 'rexxar'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-hero',
        participantId: playerId,
        health: 30,
        armor: 2
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: playerId,
        cardId: 'classic_eye_for_an_eye'
      }).accepted
    ).toBe(true)
    const eye = player(scenario, playerId).hand.find(
      (card) => card.cardId === 'classic_eye_for_an_eye'
    )
    expect(eye).toBeDefined()
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: eye!.instanceId
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: playerId }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: opponentId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)

    const damage = scenario.match.dispatch({
      type: 'use-hero-power',
      participantId: opponentId
    })
    expect(damage.accepted).toBe(true)
    expect(player(scenario, playerId).hero).toMatchObject({ health: 30, armor: 0 })
    expect(player(scenario, opponentId).hero.health).toBe(28)
  })

  it('converts Circle of Healing and Lesser Heal into damage, including on full-health targets', () => {
    const scenario = createMatchScenario({
      seed: 47,
      firstHeroId: 'anduin',
      secondHeroId: 'anduin'
    })
    scenario.confirmBothMulligans()
    const [playerId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'classic_auchenai_soulpriest'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: playerId,
        cardId: 'classic_circle_of_healing'
      }).accepted
    ).toBe(true)
    const circle = player(scenario, playerId).hand.find(
      (card) => card.cardId === 'classic_circle_of_healing'
    )
    expect(circle).toBeDefined()

    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: playerId,
        cardInstanceId: circle!.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, playerId).board[0]).toMatchObject({ health: 1 })

    const power = scenario.match.dispatch({
      type: 'use-hero-power',
      participantId: playerId,
      target: { kind: 'hero', participantId: playerId }
    })
    expect(power.accepted).toBe(true)
    expect(player(scenario, playerId).hero.health).toBe(28)
    expect(power.events).toContainEqual(
      expect.objectContaining({
        type: 'character-damaged',
        source: 'hero-power',
        participantId: playerId,
        amount: 2,
        attemptedAmount: 2
      })
    )
    expect(power.events).not.toContainEqual(
      expect.objectContaining({ type: 'character-healed', participantId: playerId })
    )
  })

  it('limits Auchenai replacement to the controller of the replacement source', () => {
    const scenario = createMatchScenario({
      seed: 47,
      firstHeroId: 'anduin',
      secondHeroId: 'anduin'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-hero',
        participantId: playerId,
        health: 20
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'classic_auchenai_soulpriest'
      }).accepted
    ).toBe(true)

    expect(
      scenario.match.dispatch({
        type: 'use-hero-power',
        participantId: playerId,
        target: { kind: 'hero', participantId: playerId }
      }).accepted
    ).toBe(true)
    expect(player(scenario, playerId).hero.health).toBe(22)
  })

  it('resolves Baron Rivendare deathrattles twice in the captured death batch', () => {
    const scenario = createMatchScenario({
      seed: 48,
      firstHeroId: 'jaina',
      secondHeroId: 'jaina'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: playerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'naxxramas_baron_rivendare'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'classic_leper_gnome'
      }).accepted
    ).toBe(true)
    const leper = player(scenario, playerId).board.find(
      (minion) => minion.cardId === 'classic_leper_gnome'
    )
    expect(leper).toBeDefined()

    expect(
      scenario.match.dispatch({
        type: 'use-hero-power',
        participantId: playerId,
        target: {
          kind: 'minion',
          participantId: playerId,
          instanceId: leper!.instanceId
        }
      }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).hero.health).toBe(26)
    expect(
      player(scenario, playerId).graveyard?.some(
        (entry) => entry.minion.cardId === 'classic_leper_gnome'
      )
    ).toBe(true)
  })

  it('does not trigger a living Haunted Creeper when another minion dies in combat', () => {
    const scenario = createMatchScenario({
      seed: 813,
      firstHeroId: 'jaina',
      secondHeroId: 'jaina'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    for (const [participantId, cardId] of [
      [playerId, 'naxxramas_haunted_creeper'],
      [playerId, 'classic_leper_gnome'],
      [opponentId, 'basic_bloodfen_raptor']
    ] as const) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId
        }).accepted
      ).toBe(true)
    }
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: playerId }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)

    const leper = player(scenario, playerId).board.find(
      (minion) => minion.cardId === 'classic_leper_gnome'
    )!
    const raptor = player(scenario, opponentId).board[0]!
    const opponentHeroHealth = player(scenario, opponentId).hero.health
    expect(
      scenario.match.dispatch({
        type: 'attack-character',
        participantId: playerId,
        attacker: { kind: 'minion', instanceId: leper.instanceId },
        defender: { kind: 'minion', instanceId: raptor.instanceId }
      }).accepted
    ).toBe(true)

    expect(player(scenario, opponentId).hero.health).toBe(opponentHeroHealth - 2)
    expect(player(scenario, playerId).board).toEqual([
      expect.objectContaining({ cardId: 'naxxramas_haunted_creeper', health: 2 })
    ])
  })

  it('does not trigger a living Haunted Creeper when it kills another minion', () => {
    const scenario = createMatchScenario({
      seed: 814,
      firstHeroId: 'jaina',
      secondHeroId: 'jaina'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activeParticipants(scenario)
    for (const [participantId, cardId] of [
      [playerId, 'naxxramas_haunted_creeper'],
      [opponentId, 'classic_wisp']
    ] as const) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId
        }).accepted
      ).toBe(true)
    }
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: playerId }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)

    const creeper = player(scenario, playerId).board[0]!
    const wisp = player(scenario, opponentId).board[0]!
    expect(
      scenario.match.dispatch({
        type: 'attack-character',
        participantId: playerId,
        attacker: { kind: 'minion', instanceId: creeper.instanceId },
        defender: { kind: 'minion', instanceId: wisp.instanceId }
      }).accepted
    ).toBe(true)

    expect(player(scenario, playerId).board).toEqual([
      expect.objectContaining({
        cardId: 'naxxramas_haunted_creeper',
        health: 1
      })
    ])
  })

  it('applies permanent buffs, swaps stats, and silences through real card commands', () => {
    const scenario = createMatchScenario({
      seed: 95,
      cardId: 'basic_blessing_of_might'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, participantId).board[0]!
    const blessing = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'basic_blessing_of_might'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: blessing.instanceId,
        targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[0]).toMatchObject({
      attack: 6,
      health: 2
    })
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'basic_blessing_of_might'
      }).accepted
    ).toBe(true)
    const secondBlessing = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'basic_blessing_of_might'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: secondBlessing.instanceId,
        targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[0]).toMatchObject({
      attack: 9,
      health: 2
    })
    const onceDerived = getDerivedState(scenario.match.getState())
    expect(getDerivedState(onceDerived)).toEqual(onceDerived)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_crazed_alchemist'
      }).accepted
    ).toBe(true)
    const alchemist = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_crazed_alchemist'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: alchemist.instanceId,
        position: 1,
        targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === target.instanceId
      )
    ).toMatchObject({ attack: 2, health: 9, maxHealth: 9 })
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_silence'
      }).accepted
    ).toBe(true)
    const silence = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_silence'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: silence.instanceId,
        targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === target.instanceId
      )
    ).toMatchObject({
      attack: 3,
      health: 2,
      maxHealth: 2,
      silenced: true,
      enchantments: []
    })
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_silence'
      }).accepted
    ).toBe(true)
    const repeatedSilence = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_silence'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: repeatedSilence.instanceId,
        targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === target.instanceId
      )
    ).toMatchObject({
      attack: 3,
      health: 2,
      maxHealth: 2,
      silenced: true,
      enchantments: []
    })
  })

  it('sets minion Health to a full maximum and restores that maximum through Silence', () => {
    const scenario = createMatchScenario({ seed: 951 })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_boulderfist_ogre'
      }).accepted
    ).toBe(true)
    const target = player(scenario, participantId).board[0]!
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_equality'
      }).accepted
    ).toBe(true)
    const equality = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_equality'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: equality.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[0]).toMatchObject({
      health: 1,
      maxHealth: 1,
      damageTaken: 0
    })

    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_silence'
      }).accepted
    ).toBe(true)
    const silence = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_silence'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: silence.instanceId,
        targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[0]).toMatchObject({
      health: 7,
      maxHealth: 7,
      damageTaken: 0,
      silenced: true
    })
  })

  it('clamps rather than damages a wounded minion when maximum Health decreases', () => {
    const fixtureId = 'maximum_health_reduction_fixture' as CardId
    const fixture = {
      id: fixtureId,
      name: 'Maximum Health Reduction Fixture',
      rarity: 'Common',
      cardClass: 'Neutral',
      type: 'Spell',
      subtype: 'General',
      cost: 0,
      attack: null,
      health: null,
      rulesText: '',
      keywords: [],
      effects: [
        {
          trigger: 'cast',
          actions: [
            {
              action: 'modify',
              target: { controller: 'self', type: 'minion', selection: 'chosen' },
              health: -1
            }
          ]
        }
      ]
    } as unknown as CardDefinition
    const catalog = CARD_CATALOG as unknown as {
      readonly cardsById: Map<CardId, CardDefinition>
    }
    catalog.cardsById.set(fixtureId, fixture)
    try {
      const scenario = createMatchScenario({ seed: 952 })
      scenario.confirmBothMulligans()
      const [participantId] = activeParticipants(scenario)
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId: 'basic_boulderfist_ogre'
        }).accepted
      ).toBe(true)
      const target = player(scenario, participantId).board[0]!
      for (const cardId of ['classic_moonfire', fixtureId] as const) {
        expect(
          scenario.match.dispatch({ type: 'dev-add-card', participantId, cardId })
            .accepted
        ).toBe(true)
        const card = player(scenario, participantId).hand.find(
          (entry) => entry.cardId === cardId
        )!
        expect(
          scenario.match.dispatch({
            type: 'play-card',
            participantId,
            cardInstanceId: card.instanceId,
            targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
          }).accepted
        ).toBe(true)
      }
      expect(player(scenario, participantId).board[0]).toMatchObject({
        health: 6,
        maxHealth: 6,
        damageTaken: 0
      })
    } finally {
      catalog.cardsById.delete(fixtureId)
    }
  })

  it('recomputes a real while-condition aura as its condition changes', () => {
    const scenario = createMatchScenario({ seed: 102 })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    for (const cardId of [
      'goblins_vs_gnomes_cogmaster',
      'goblins_vs_gnomes_warbot'
    ] as const) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId
        }).accepted
      ).toBe(true)
    }
    const state = scenario.match.getState()
    const playerIndex = state.players.findIndex(
      (player) => player.participantId === participantId
    )
    const cogmaster = state.players[playerIndex]!.board.find(
      (minion) => minion.cardId === 'goblins_vs_gnomes_cogmaster'
    )!
    expect(
      getDerivedState(state).players[playerIndex]!.board.find(
        (minion) => minion.instanceId === cogmaster.instanceId
      )?.attack
    ).toBe(3)
    const withoutMech = {
      ...state,
      players: state.players.map((player, index) =>
        index !== playerIndex
          ? player
          : {
              ...player,
              board: player.board.filter(
                (minion) => minion.cardId !== 'goblins_vs_gnomes_warbot'
              )
            }
      )
    } as unknown as typeof state
    expect(
      getDerivedState(withoutMech).players[playerIndex]!.board.find(
        (minion) => minion.instanceId === cogmaster.instanceId
      )?.attack
    ).toBe(1)
  })
  it('grants a deterministic random keyword through the resolver fixture path', () => {
    const fixtureId = 'phase7_random_keyword_fixture' as CardId
    const fixture = {
      id: fixtureId,
      name: 'Phase 7 Random Keyword Fixture',
      rarity: 'Common',
      cardClass: 'Neutral',
      type: 'Spell',
      subtype: 'General',
      cost: 0,
      attack: null,
      health: null,
      rulesText: '',
      keywords: [],
      effects: [
        {
          trigger: 'cast',
          actions: [
            {
              action: 'grant-random-keyword',
              target: {
                controller: 'self',
                type: 'minion',
                selection: 'chosen'
              },
              keywords: ['taunt', 'windfury'],
              duration: 'permanent'
            }
          ]
        }
      ]
    } as unknown as CardDefinition
    const catalog = CARD_CATALOG as unknown as {
      readonly cardsById: Map<CardId, CardDefinition>
    }
    catalog.cardsById.set(fixtureId, fixture)
    try {
      const scenario = createMatchScenario({ seed: 101 })
      scenario.confirmBothMulligans()
      const [participantId] = activeParticipants(scenario)
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId,
          cardId: fixtureId
        }).accepted
      ).toBe(true)
      const fixtureCard = player(scenario, participantId).hand.find(
        (card) => card.cardId === fixtureId
      )!
      const target = player(scenario, participantId).board[0]!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId,
          cardInstanceId: fixtureCard.instanceId,
          targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
        }).accepted
      ).toBe(true)
      expect(
        player(scenario, participantId).board.find(
          (minion) => minion.instanceId === target.instanceId
        )?.enchantments
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            keywords: expect.arrayContaining([
              expect.stringMatching(/^(taunt|windfury)$/)
            ])
          })
        ])
      )
    } finally {
      catalog.cardsById.delete(fixtureId)
    }
  })
  it('keeps real until-next-turn keyword grants through the opponent turn only', () => {
    const scenario = createMatchScenario({ seed: 100, cardId: 'classic_conceal' })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, participantId).board[0]!
    const conceal = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_conceal'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: conceal.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[0]!.stealth).toBe(true)
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === target.instanceId
      )?.stealth
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === target.instanceId
      )?.stealth
    ).toBe(false)
  })
  it('honors and expires real minimum-Health enchantments at turn boundaries', () => {
    const scenario = createMatchScenario({
      seed: 99,
      firstHeroId: 'garrosh',
      cardId: 'classic_commanding_shout'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, participantId).board[0]!
    const shout = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_commanding_shout'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: shout.instanceId
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'basic_hellfire'
      }).accepted
    ).toBe(true)
    const hellfire = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'basic_hellfire'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: hellfire.instanceId
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === target.instanceId
      )
    ).toMatchObject({ health: 1, maxHealth: 2 })
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === target.instanceId
      )?.enchantments
    ).toEqual([])
  })
  it('expires a real this-turn hero buff at the end-turn boundary', () => {
    const scenario = createMatchScenario({ seed: 96, cardId: 'basic_rockbiter_weapon' })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'basic_rockbiter_weapon'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        targets: [{ kind: 'hero', participantId }]
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).hero.attack).toBe(3)
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(player(scenario, participantId).hero.attack).toBe(0)
  })
  it('ends simultaneous hero lethal as a draw at the match-end checkpoint', () => {
    const scenario = createMatchScenario({
      seed: 808,
      cardId: 'basic_hellfire',
      firstHeroId: 'guldan',
      secondHeroId: 'jaina'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    for (const targetId of [participantId, opponentId])
      expect(
        scenario.match.dispatch({
          type: 'dev-set-hero',
          participantId: targetId,
          health: 3,
          armor: 0
        }).accepted
      ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'basic_hellfire'
    )
    expect(card).toBeDefined()
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card!.instanceId
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state).toMatchObject({
      phase: 'ended',
      activePlayerId: null,
      winnerId: null,
      loserId: null
    })
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'match-ended',
        winnerId: null,
        loserId: null,
        reason: 'simultaneous-hero-lethal'
      })
    )
  })
  it('resolves Shadowflame sacrifice damage through the shared destruction pipeline', () => {
    const scenario = createMatchScenario({
      seed: 809,
      cardId: 'classic_shadowflame',
      firstHeroId: 'guldan'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    for (const [id, cardId] of [
      [participantId, 'basic_boulderfist_ogre'],
      [opponentId, 'basic_chillwind_yeti']
    ] as const)
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: id,
          cardId
        }).accepted
      ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const source = player(scenario, participantId).board[0]!
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'classic_shadowflame'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId,
      targets: [{ kind: 'minion', participantId, instanceId: source.instanceId }]
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(player(scenario, participantId).board).toHaveLength(0)
    expect(player(scenario, opponentId).board).toHaveLength(0)
    expect(
      result.events.some(
        (event) => event.type === 'effect-resolved' && event.action === 'destroy'
      )
    ).toBe(true)
  })

  it('resolves Void Terror adjacent destruction and stat gain atomically', () => {
    const scenario = createMatchScenario({
      seed: 810,
      cardId: 'classic_void_terror',
      firstHeroId: 'guldan'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    for (const cardId of ['basic_acidic_swamp_ooze', 'basic_chillwind_yeti'])
      expect(
        scenario.match.dispatch({ type: 'dev-summon-minion', participantId, cardId })
          .accepted
      ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'classic_void_terror'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId,
      position: 1
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(player(scenario, participantId).board).toHaveLength(1)
    expect(player(scenario, participantId).board[0]).toMatchObject({
      cardId: 'classic_void_terror',
      attack: 10,
      health: 10,
      maxHealth: 10
    })
  })

  it('triggers live deathrattles without destroying their sources', () => {
    const scenario = createMatchScenario({
      seed: 811,
      cardId: 'goblins_vs_gnomes_feign_death',
      firstHeroId: 'rexxar'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'classic_leper_gnome'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'goblins_vs_gnomes_feign_death'
    )!
    const before = player(scenario, opponentId).hero.health
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId
    })
    expect(result.accepted).toBe(true)
    expect(player(scenario, participantId).board).toHaveLength(1)
    expect(player(scenario, opponentId).hero.health).toBe(before - 2)
  })

  it('processes Poison Seeds destruction before replacement summons', () => {
    const scenario = createMatchScenario({
      seed: 812,
      cardId: 'naxxramas_poison_seeds',
      firstHeroId: 'malfurion'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    for (const [id, cardId] of [
      [participantId, 'basic_acidic_swamp_ooze'],
      [opponentId, 'basic_chillwind_yeti']
    ] as const)
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: id,
          cardId
        }).accepted
      ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'naxxramas_poison_seeds'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(
      result.state.players
        .flatMap((entry) => entry.board)
        .every((minion) => minion.cardId === 'naxxramas_treant')
    ).toBe(true)
    expect(result.state.players.flatMap((entry) => entry.board)).toHaveLength(2)
    expect(
      result.state.players
        .flatMap((entry) => entry.graveyard ?? [])
        .map((entry) => entry.minion.cardId)
    ).toEqual(
      expect.arrayContaining(['basic_acidic_swamp_ooze', 'basic_chillwind_yeti'])
    )
  })
  it("skips Cruel Taskmaster's Battlecry when it has no other minion target", () => {
    const scenario = createMatchScenario({
      seed: 420,
      cardId: 'classic_cruel_taskmaster'
    })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_cruel_taskmaster'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const taskmaster = player(scenario, participantId).hand[0]!
    expect(
      scenario.match.getLegality?.(participantId).playableCardInstanceIds
    ).toContain(taskmaster.instanceId)
    expect(
      scenario.match.getPlayInput?.(participantId, taskmaster.instanceId)
        ?.targetSelectors
    ).toEqual([])
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: taskmaster.instanceId,
      position: 0
    })
    expect(result).toMatchObject({ accepted: true })
    if (!result.accepted) return
    expect(player(scenario, participantId).board[0]).toMatchObject({
      attack: 2,
      health: 2
    })
  })

  it('stages a self-transform Choice after the minion enters play', () => {
    const scenario = createMatchScenario({ seed: 421 })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    for (const command of [
      {
        type: 'dev-add-card' as const,
        participantId,
        cardId: 'blackrock_mountain_druid_of_the_flame'
      },
      {
        type: 'dev-set-mana' as const,
        participantId,
        available: 10,
        maximum: 10
      },
      {
        type: 'dev-set-hero-power' as const,
        participantId,
        available: false
      }
    ])
      expect(scenario.match.dispatch(command).accepted).toBe(true)

    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'blackrock_mountain_druid_of_the_flame'
    )!
    expect(scenario.match.getPlayInput?.(participantId, card.instanceId)).toMatchObject(
      {
        choiceTiming: 'after-placement',
        choiceOptions: [
          {
            choice: 0,
            presentationCardId: 'blackrock_mountain_firecat_form',
            presentationCost: 3
          },
          {
            choice: 1,
            presentationCardId: 'blackrock_mountain_fire_hawk_form',
            presentationCost: 3
          }
        ]
      }
    )

    const play = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId,
      position: 0
    })
    expect(play).toMatchObject({ accepted: true })
    if (!play.accepted) return
    expect(play.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['minion-played', 'card-choice-started'])
    )
    expect(player(scenario, participantId)).toMatchObject({
      mana: { available: 7 },
      board: [
        {
          instanceId: card.instanceId,
          cardId: 'blackrock_mountain_druid_of_the_flame',
          attack: 2,
          health: 2
        }
      ]
    })
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      false
    )

    const choice = scenario.match.dispatch({
      type: 'choose-card-option',
      participantId,
      sourceCardInstanceId: card.instanceId,
      choice: 1
    })
    expect(choice).toMatchObject({ accepted: true })
    expect(player(scenario, participantId)).toMatchObject({
      mana: { available: 7 },
      board: [
        {
          instanceId: card.instanceId,
          cardId: 'blackrock_mountain_druid_of_the_flame_2_5',
          attack: 2,
          health: 5
        }
      ]
    })
    expect(scenario.match.getState().pendingCardChoice).toBeUndefined()
  })

  it('resolves Naturalize into Majordomo hero replacement without stalling', () => {
    const scenario = createMatchScenario({ seed: 422 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    for (const command of [
      {
        type: 'dev-summon-minion' as const,
        participantId,
        cardId: 'blackrock_mountain_majordomo_executus'
      },
      {
        type: 'dev-add-card' as const,
        participantId,
        cardId: 'classic_naturalize'
      },
      {
        type: 'dev-set-mana' as const,
        participantId,
        available: 10,
        maximum: 10
      }
    ])
      expect(scenario.match.dispatch(command).accepted).toBe(true)

    const current = player(scenario, participantId)
    const naturalize = current.hand.find(
      (card) => card.cardId === 'classic_naturalize'
    )!
    const majordomo = current.board.find(
      (minion) => minion.cardId === 'blackrock_mountain_majordomo_executus'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: naturalize.instanceId,
      targets: [{ kind: 'minion', participantId, instanceId: majordomo.instanceId }]
    })
    expect(result).toMatchObject({ accepted: true })
    if (!result.accepted) return
    const eventTypes = result.events.map((event) => event.type)
    expect(eventTypes.indexOf('death-batch-started')).toBeLessThan(
      eventTypes.indexOf('hero-replaced')
    )
    expect(eventTypes.indexOf('hero-replaced')).toBeLessThan(
      eventTypes.indexOf('death-batch-completed')
    )
    expect(
      result.events.filter((event) => event.type === 'hero-replaced')
    ).toHaveLength(1)
    expect(player(scenario, participantId)).toMatchObject({
      heroId: 'ragnaros',
      hero: { health: 8, maxHealth: 8 },
      heroPower: {
        id: 'ragnaros-die-insects',
        cost: 2,
        targetType: 'any-character',
        available: true,
        usesThisTurn: 0
      }
    })
    expect(
      result.events.filter((event) => event.type === 'hero-power-replaced')
    ).toHaveLength(0)

    expect(
      scenario.match.dispatch({ type: 'use-hero-power', participantId }).accepted
    ).toBe(false)
    const power = scenario.match.dispatch({
      type: 'use-hero-power',
      participantId,
      target: { kind: 'hero', participantId: opponentId }
    })
    expect(power).toMatchObject({ accepted: true })
    expect(player(scenario, opponentId).hero.health).toBe(22)

    const ended = scenario.match.dispatch({
      type: 'dev-end-match',
      participantId,
      winnerId: participantId
    })
    expect(ended).toMatchObject({ accepted: true, state: { phase: 'ended' } })
    if (!ended.accepted) return
    expect(ended.events.filter((event) => event.type === 'match-ended')).toHaveLength(1)
    expect(
      scenario.match.dispatch({
        type: 'dev-end-match',
        participantId,
        winnerId: participantId
      }).accepted
    ).toBe(false)
  })

  it('Gang Up keeps its target in play and shuffles three copies into the caster deck', () => {
    const scenario = createMatchScenario({
      seed: 423,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)

    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'blackrock_mountain_gang_up'
      }).accepted
    ).toBe(true)
    for (let index = 0; index < 9; index += 1) {
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
    }
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_bloodfen_raptor'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)

    const beforeCaster = player(scenario, participantId)
    const beforeOpponent = player(scenario, opponentId)
    const gangUp = beforeCaster.hand.find(
      (card) => card.cardId === 'blackrock_mountain_gang_up'
    )!
    const target = beforeOpponent.board.find(
      (minion) => minion.cardId === 'basic_bloodfen_raptor'
    )!
    const casterDeckIds = new Set(beforeCaster.deck.map((card) => card.instanceId))
    const casterDeckSize = beforeCaster.deck.length
    const opponentDeckSize = beforeOpponent.deck.length

    expect(beforeCaster.hand).toHaveLength(10)
    expect(
      scenario.match.getLegality?.(participantId).playableCardInstanceIds
    ).toContain(gangUp.instanceId)

    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: gangUp.instanceId,
      targets: [
        {
          kind: 'minion',
          participantId: opponentId,
          instanceId: target.instanceId
        }
      ]
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    const afterCaster = player(scenario, participantId)
    const afterOpponent = player(scenario, opponentId)
    const copies = afterCaster.deck.filter(
      (card) => !casterDeckIds.has(card.instanceId)
    )
    expect(afterOpponent.board).toContainEqual(target)
    expect(afterOpponent.deck).toHaveLength(opponentDeckSize)
    expect(afterCaster.deck).toHaveLength(casterDeckSize + 3)
    expect(copies).toHaveLength(3)
    expect(new Set(copies.map((card) => card.instanceId)).size).toBe(3)
    for (const copy of copies) {
      expect(copy).toMatchObject({
        cardId: 'basic_bloodfen_raptor',
        ownerId: participantId,
        controllerId: participantId,
        zone: 'deck',
        revealed: false
      })
    }
  })

  it('Blade Flurry requires a weapon and damages all enemies from its destroyed snapshot', () => {
    const scenario = createMatchScenario({ seed: 424, cardId: 'classic_blade_flurry' })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    for (const cardId of ['classic_blade_flurry', 'basic_assassins_blade'] as const) {
      expect(
        scenario.match.dispatch({ type: 'dev-add-card', participantId, cardId })
          .accepted
      ).toBe(true)
    }
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_kobold_geomancer'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_boulderfist_ogre'
      }).accepted
    ).toBe(true)

    const bladeFlurry = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_blade_flurry'
    )!
    expect(
      scenario.match.getPlayInput?.(participantId, bladeFlurry.instanceId)
    ).toBeNull()
    expect(
      scenario.match.getLegality?.(participantId).playableCardInstanceIds
    ).not.toContain(bladeFlurry.instanceId)

    const weapon = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'basic_assassins_blade'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: weapon.instanceId
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.getPlayInput?.(participantId, bladeFlurry.instanceId)
    ).toMatchObject({
      currentCost: 2
    })

    const friendlyHeroHealthBefore = player(scenario, participantId).hero.health
    const enemyHeroHealthBefore = player(scenario, opponentId).hero.health
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: bladeFlurry.instanceId
    })
    expect(result.accepted).toBe(true)
    expect(player(scenario, participantId).weapon).toBeNull()
    expect(player(scenario, participantId).hero.health).toBe(friendlyHeroHealthBefore)
    expect(player(scenario, participantId).board[0]).toMatchObject({
      cardId: 'basic_kobold_geomancer',
      health: 2
    })
    expect(player(scenario, opponentId).hero.health).toBe(enemyHeroHealthBefore - 4)
    expect(player(scenario, opponentId).board[0]).toMatchObject({
      cardId: 'basic_boulderfist_ogre',
      health: 3
    })
  })

  it.each([
    { remainingDurability: 1, attackBeforeHarrison: true },
    { remainingDurability: 2, attackBeforeHarrison: false }
  ])(
    'Harrison Jones draws $remainingDurability card(s) from the destroyed weapon snapshot',
    ({ remainingDurability, attackBeforeHarrison }) => {
      const scenario = createMatchScenario({
        seed: 425,
        cardId: 'classic_harrison_jones',
        firstHeroId: 'garrosh',
        secondHeroId: 'garrosh'
      })
      scenario.confirmBothMulligans()
      const [harrisonPlayerId, weaponPlayerId] = activeParticipants(scenario)

      expect(
        scenario.match.dispatch({
          type: 'dev-clear-zone',
          participantId: harrisonPlayerId,
          zone: 'hand'
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId: harrisonPlayerId,
          cardId: 'classic_harrison_jones'
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId: weaponPlayerId,
          cardId: 'basic_fiery_war_axe'
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'end-turn',
          participantId: harrisonPlayerId
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId: weaponPlayerId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)

      const weapon = player(scenario, weaponPlayerId).hand.find(
        (card) => card.cardId === 'basic_fiery_war_axe'
      )!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId: weaponPlayerId,
          cardInstanceId: weapon.instanceId
        }).accepted
      ).toBe(true)
      if (attackBeforeHarrison) {
        expect(
          scenario.match.dispatch({
            type: 'attack-character',
            participantId: weaponPlayerId,
            attacker: { kind: 'hero' },
            defender: { kind: 'hero' }
          }).accepted
        ).toBe(true)
      }
      expect(player(scenario, weaponPlayerId).weapon?.durability).toBe(
        remainingDurability
      )
      expect(
        scenario.match.dispatch({
          type: 'end-turn',
          participantId: weaponPlayerId
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId: harrisonPlayerId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)

      const harrison = player(scenario, harrisonPlayerId).hand.find(
        (card) => card.cardId === 'classic_harrison_jones'
      )!
      const deckSizeBefore = player(scenario, harrisonPlayerId).deck.length
      const result = scenario.match.dispatch({
        type: 'play-card',
        participantId: harrisonPlayerId,
        cardInstanceId: harrison.instanceId,
        position: 0
      })

      expect(result.accepted).toBe(true)
      expect(player(scenario, weaponPlayerId).weapon).toBeNull()
      expect(result.events.filter((event) => event.type === 'card-drawn')).toHaveLength(
        remainingDurability
      )
      expect(player(scenario, harrisonPlayerId).deck).toHaveLength(
        deckSizeBefore - remainingDurability
      )
    }
  )

  it('Harrison Jones draws no cards when the opponent has no weapon', () => {
    const scenario = createMatchScenario({
      seed: 426,
      cardId: 'classic_harrison_jones'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)

    const harrison = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_harrison_jones'
    )!
    const deckSizeBefore = player(scenario, participantId).deck.length
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: harrison.instanceId,
      position: 0
    })

    expect(result.accepted).toBe(true)
    expect(result.events.filter((event) => event.type === 'card-drawn')).toHaveLength(0)
    expect(player(scenario, participantId).deck).toHaveLength(deckSizeBefore)
  })

  it('Preparation discounts and consumes the next spell chosen this turn', () => {
    const scenario = createMatchScenario({ seed: 425, cardId: 'classic_preparation' })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    for (const cardId of [
      'classic_preparation',
      'basic_sinister_strike',
      'classic_sprint',
      'basic_bloodfen_raptor'
    ] as const) {
      expect(
        scenario.match.dispatch({ type: 'dev-add-card', participantId, cardId })
          .accepted
      ).toBe(true)
    }
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const preparation = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_preparation'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: preparation.instanceId
      }).accepted
    ).toBe(true)

    const preparedHand = player(scenario, participantId).hand
    expect(
      preparedHand.find((card) => card.cardId === 'basic_sinister_strike')?.currentCost
    ).toBe(0)
    expect(
      preparedHand.find((card) => card.cardId === 'classic_sprint')?.currentCost
    ).toBe(4)
    expect(
      preparedHand.find((card) => card.cardId === 'basic_bloodfen_raptor')?.currentCost
    ).toBe(2)

    const raptor = preparedHand.find((card) => card.cardId === 'basic_bloodfen_raptor')!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: raptor.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).pendingCostModifiers).toHaveLength(1)

    const sinisterStrike = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'basic_sinister_strike'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: sinisterStrike.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).pendingCostModifiers).toEqual([])
    expect(
      player(scenario, participantId).hand.find(
        (card) => card.cardId === 'classic_sprint'
      )?.currentCost
    ).toBe(7)
  })

  it('Preparation is consumed by another Preparation and expires at turn end', () => {
    const scenario = createMatchScenario({ seed: 426, cardId: 'classic_preparation' })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    for (const cardId of [
      'classic_preparation',
      'classic_preparation',
      'classic_sprint'
    ] as const) {
      expect(
        scenario.match.dispatch({ type: 'dev-add-card', participantId, cardId })
          .accepted
      ).toBe(true)
    }
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)

    const firstPreparation = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_preparation'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: firstPreparation.instanceId
      }).accepted
    ).toBe(true)
    const secondPreparation = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_preparation'
    )!
    expect(secondPreparation.currentCost).toBe(0)
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: secondPreparation.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).pendingCostModifiers).toHaveLength(1)
    expect(
      player(scenario, participantId).hand.find(
        (card) => card.cardId === 'classic_sprint'
      )?.currentCost
    ).toBe(4)

    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(player(scenario, participantId).pendingCostModifiers).toEqual([])
    expect(
      player(scenario, participantId).hand.find(
        (card) => card.cardId === 'classic_sprint'
      )?.currentCost
    ).toBe(7)
  })

  it('keeps undated next-card discounts active across turn boundaries', () => {
    const scenario = createMatchScenario({
      seed: 427,
      cardId: 'blackrock_mountain_dragon_consort'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    for (const cardId of [
      'blackrock_mountain_dragon_consort',
      'classic_faerie_dragon'
    ] as const) {
      expect(
        scenario.match.dispatch({ type: 'dev-add-card', participantId, cardId })
          .accepted
      ).toBe(true)
    }
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const consort = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'blackrock_mountain_dragon_consort'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: consort.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, participantId).hand.find(
        (card) => card.cardId === 'classic_faerie_dragon'
      )?.currentCost
    ).toBe(0)

    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).pendingCostModifiers).toHaveLength(1)
    expect(
      player(scenario, participantId).hand.find(
        (card) => card.cardId === 'classic_faerie_dragon'
      )?.currentCost
    ).toBe(0)
  })
})

describe('current-stat swaps', () => {
  function setup(targetCard = 'basic_chillwind_yeti', enemy = false) {
    const { match, confirmBothMulligans } = createMatchScenario({
      cardId: 'classic_moonfire'
    })
    confirmBothMulligans()
    const participantId = match.getState().activePlayerId!
    const opponent = match
      .getState()
      .players.find((p) => p.participantId !== participantId)!.participantId
    const targetOwner = enemy ? opponent : participantId
    const board = () => match.getState().players.flatMap((p) => p.board)
    const summon = (cardId: string) => {
      expect(
        match.dispatch({ type: 'dev-summon-minion', participantId, cardId }).accepted
      ).toBe(true)
      return match
        .getState()
        .players.find((p) => p.participantId === participantId)!
        .board.at(-1)!.instanceId
    }
    expect(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: targetOwner,
        cardId: targetCard
      }).accepted
    ).toBe(true)
    const targetId = board()[0].instanceId
    const play = (cardId: string, id: string | null = targetId) => {
      expect(
        match.dispatch({
          type: 'dev-set-mana',
          participantId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      expect(
        match.dispatch({ type: 'dev-add-card', participantId, cardId }).accepted
      ).toBe(true)
      const player = match
        .getState()
        .players.find((p) => p.participantId === participantId)!
      const card = player.hand.find((c) => c.cardId === cardId)!
      const owner = match
        .getState()
        .players.find((p) => p.board.some((m) => m.instanceId === id))?.participantId
      const result = match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        ...(CARD_CATALOG.require(cardId).type === 'Minion'
          ? { position: player.board.length }
          : {}),
        ...(id === null
          ? {}
          : {
              targets: [
                { kind: 'minion' as const, participantId: owner!, instanceId: id }
              ]
            })
      })
      expect(result.accepted).toBe(true)
    }
    const stats = (id = targetId) => {
      const m = board().find((m) => m.instanceId === id)
      return m
        ? { attack: m.attack, health: m.health, maxHealth: m.maxHealth }
        : undefined
    }
    const cardStats = (cardId: string) =>
      stats(board().find((m) => m.cardId === cardId)!.instanceId)
    const endTurn = () =>
      expect(
        match.dispatch({
          type: 'end-turn',
          participantId: match.getState().activePlayerId!
        }).accepted
      ).toBe(true)
    const stable = () => {
      const state = getDerivedState(match.getState())
      expect(getDerivedState(state)).toEqual(state)
    }
    const keywords = (cardId: string) =>
      board().find((m) => m.cardId === cardId)!.keywords
    return { play, stats, cardStats, summon, endTurn, stable, targetId, keywords }
  }
  it.each([
    'classic_crazed_alchemist',
    'mean_streets_of_gadgetzan_kooky_chemist',
    'goblins_vs_gnomes_spare_part_reversing_switch',
    'the_grand_tournament_confuse'
  ])('swaps current health with %s', (card) => {
    const s = setup()
    s.play('classic_moonfire')
    s.play(card, card === 'the_grand_tournament_confuse' ? null : s.targetId)
    expect(s.stats()).toEqual({ attack: 4, health: 4, maxHealth: 4 })
    s.stable()
  })
  it('Darkspeaker exchanges both current stats', () => {
    const s = setup()
    s.play('classic_moonfire')
    s.play('basic_blessing_of_might')
    s.play('whispers_of_the_old_gods_darkspeaker')
    expect(s.stats()).toEqual({ attack: 3, health: 6, maxHealth: 6 })
    expect(s.cardStats('whispers_of_the_old_gods_darkspeaker')).toEqual({
      attack: 7,
      health: 4,
      maxHealth: 4
    })
    s.stable()
  })
  it.each([false, true])(
    'Voljin persistently exchanges remaining health (enemy=%s)',
    (enemy) => {
      const s = setup('basic_chillwind_yeti', enemy)
      s.play('classic_moonfire')
      s.play('goblins_vs_gnomes_voljin')
      expect(s.stats()).toEqual({ attack: 4, health: 2, maxHealth: 2 })
      expect(s.cardStats('goblins_vs_gnomes_voljin')).toEqual({
        attack: 6,
        health: 4,
        maxHealth: 4
      })
      s.stable()
    }
  )
  it('attack buffs after a swap increase attack', () => {
    const s = setup()
    s.play('classic_crazed_alchemist')
    s.play('basic_blessing_of_might')
    expect(s.stats()).toEqual({ attack: 8, health: 4, maxHealth: 4 })
    s.stable()
  })
  it('health multipliers after a swap increase health', () => {
    const s = setup()
    s.play('classic_crazed_alchemist')
    s.play('basic_divine_spirit')
    expect(s.stats()).toEqual({ attack: 5, health: 8, maxHealth: 8 })
    s.stable()
  })
  it('swapping twice retains damage converted into attack', () => {
    const s = setup()
    s.play('classic_moonfire')
    s.play('classic_crazed_alchemist')
    s.play('classic_crazed_alchemist')
    expect(s.stats()).toEqual({ attack: 4, health: 4, maxHealth: 4 })
  })
  it('swapping again captures damage taken after the first swap', () => {
    const s = setup()
    s.play('classic_crazed_alchemist')
    s.play('classic_moonfire')
    s.play('classic_crazed_alchemist')
    expect(s.stats()).toEqual({ attack: 3, health: 5, maxHealth: 5 })
  })
  it('silence removes swap and later buffs', () => {
    const s = setup()
    s.play('classic_crazed_alchemist')
    s.play('basic_blessing_of_might')
    s.play('classic_silence')
    expect(s.stats()).toEqual({ attack: 4, health: 5, maxHealth: 5 })
  })
  it('temporary buffs captured before swapping remain after expiration', () => {
    const s = setup()
    s.play('classic_abusive_sergeant')
    s.play('classic_crazed_alchemist')
    s.endTurn()
    expect(s.stats()).toEqual({ attack: 5, health: 6, maxHealth: 6 })
    s.stable()
  })
  it('temporary buffs after swapping expire on the correct stat', () => {
    const s = setup()
    s.play('classic_crazed_alchemist')
    s.play('classic_abusive_sergeant')
    expect(s.stats()).toEqual({ attack: 7, health: 4, maxHealth: 4 })
    s.endTurn()
    expect(s.stats()).toEqual({ attack: 5, health: 4, maxHealth: 4 })
  })
  it('auras are captured then reapplied and can be removed', () => {
    const s = setup()
    const champion = s.summon('basic_stormwind_champion')
    s.play('classic_crazed_alchemist')
    expect(s.stats()).toEqual({ attack: 7, health: 6, maxHealth: 6 })
    s.stable()
    s.play('classic_silence', champion)
    expect(s.stats()).toEqual({ attack: 6, health: 5, maxHealth: 5 })
    s.stable()
  })
  it('zero attack becomes zero health and dies', () => {
    const s = setup('classic_shieldbearer')
    s.play('classic_crazed_alchemist')
    expect(s.stats()).toBeUndefined()
  })
  it('Brann repeats swaps before zero-health deaths', () => {
    const s = setup('classic_shieldbearer')
    s.summon('league_of_explorers_brann_bronzebeard')
    s.play('classic_crazed_alchemist')
    expect(s.stats()).toEqual({ attack: 0, health: 4, maxHealth: 4 })
  })
  it('Confuse swaps both boards using each current value', () => {
    const s = setup('basic_chillwind_yeti', true)
    const ooze = s.summon('basic_acidic_swamp_ooze')
    s.play('classic_moonfire')
    s.play('the_grand_tournament_confuse', null)
    expect(s.stats()).toEqual({ attack: 4, health: 4, maxHealth: 4 })
    expect(s.stats(ooze)).toEqual({ attack: 2, health: 3, maxHealth: 3 })
    s.stable()
  })
  it.each(['goblins_vs_gnomes_voljin', 'whispers_of_the_old_gods_darkspeaker'])(
    'Brann repeats exchanges with %s',
    (card) => {
      const s = setup()
      s.summon('league_of_explorers_brann_bronzebeard')
      s.play(card)
      expect(s.stats()).toEqual({ attack: 4, health: 5, maxHealth: 5 })
      s.stable()
    }
  )
  it('Voljin health swap can be silenced and buffed', () => {
    const s = setup()
    s.play('goblins_vs_gnomes_voljin')
    s.play('basic_divine_spirit')
    expect(s.stats()).toEqual({ attack: 4, health: 4, maxHealth: 4 })
    s.play('classic_silence')
    expect(s.stats()).toEqual({ attack: 4, health: 5, maxHealth: 5 })
  })
  it('Darkspeaker does not transfer keywords', () => {
    const s = setup('classic_shieldbearer')
    s.play('whispers_of_the_old_gods_darkspeaker')
    expect(s.stats()).toEqual({ attack: 3, health: 6, maxHealth: 6 })
    expect(s.cardStats('whispers_of_the_old_gods_darkspeaker')).toEqual({
      attack: 0,
      health: 4,
      maxHealth: 4
    })
    expect(s.keywords('classic_shieldbearer')).toContain('taunt')
    expect(s.keywords('whispers_of_the_old_gods_darkspeaker')).not.toContain('taunt')
  })
  it('damage protection cannot preserve a zero-health swap', () => {
    const s = setup('classic_shieldbearer')
    s.play('classic_commanding_shout', null)
    s.play('classic_crazed_alchemist')
    expect(s.stats()).toBeUndefined()
  })
})