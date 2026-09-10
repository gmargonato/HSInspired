import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, asCardId } from '../../content/cards'
import { createMatchScenario } from '../testing/match-scenario-builder'

type Scenario = ReturnType<typeof createMatchScenario>

function player(scenario: Scenario, participantId: string) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
}

function activePlayers(scenario: Scenario) {
  const active = scenario.match.getState().activePlayerId!
  return [
    active,
    scenario.participants.find((participantId) => participantId !== active)!
  ] as const
}

function addCard(scenario: Scenario, participantId: string, cardId: string): void {
  const result = scenario.match.dispatch({
    type: 'dev-add-card',
    participantId,
    cardId: asCardId(cardId)
  })
  if (!result.accepted) throw new Error(result.message)
}

function summon(scenario: Scenario, participantId: string, cardId: string): void {
  const result = scenario.match.dispatch({
    type: 'dev-summon-minion',
    participantId,
    cardId: asCardId(cardId)
  })
  if (!result.accepted) throw new Error(result.message)
}

function setMana(scenario: Scenario, participantId: string): void {
  const result = scenario.match.dispatch({
    type: 'dev-set-mana',
    participantId,
    available: 10,
    maximum: 10
  })
  if (!result.accepted) throw new Error(result.message)
}

function play(
  scenario: Scenario,
  participantId: string,
  cardId: string,
  extra: Record<string, unknown> = {}
) {
  const card = player(scenario, participantId).hand.find(
    (candidate) => candidate.cardId === cardId
  )
  expect(card).toBeDefined()
  const definition = CARD_CATALOG.require(card!.cardId)
  const result = scenario.match.dispatch({
    type: 'play-card',
    participantId,
    cardInstanceId: card!.instanceId,
    ...(definition.type === 'Minion' && extra.position === undefined
      ? { position: player(scenario, participantId).board.length }
      : {}),
    ...extra
  })
  if (!result.accepted) throw new Error(result.message)
  return result
}

function scenario(options: Parameters<typeof createMatchScenario>[0] = {}) {
  const value = createMatchScenario(options)
  value.confirmBothMulligans()
  return value
}

describe('League of Explorers card effects', () => {
  it('uses generated Discover choices without consuming the deck', () => {
    const value = scenario({ firstHeroId: 'malfurion' })
    const [participantId] = activePlayers(value)
    setMana(value, participantId)
    addCard(value, participantId, 'league_of_explorers_raven_idol')
    const deckBefore = player(value, participantId).deck.length

    play(value, participantId, 'league_of_explorers_raven_idol', { choice: 0 })

    const pending = value.match.getState().pendingDiscover
    expect(pending?.origin).toBe('generated')
    expect(pending?.candidates).toHaveLength(3)
    expect(
      pending?.candidates.every(
        (card) => CARD_CATALOG.require(card.cardId).type === 'Minion'
      )
    ).toBe(true)
    expect(player(value, participantId).deck).toHaveLength(deckBefore)

    const chosen = pending!.candidates[0]!
    const result = value.match.dispatch({
      type: 'choose-discover-card',
      participantId,
      cardInstanceId: chosen.instanceId
    })
    expect(result.accepted).toBe(true)
    expect(
      player(value, participantId).hand.some((card) => card.cardId === chosen.cardId)
    ).toBe(true)
    expect(player(value, participantId).revealedCards).toHaveLength(0)
  })

  it('queues separate Discover choices when Brann doubles a Battlecry', () => {
    const value = scenario()
    const [participantId] = activePlayers(value)
    summon(value, participantId, 'league_of_explorers_brann_bronzebeard')
    setMana(value, participantId)
    addCard(value, participantId, 'league_of_explorers_ethereal_conjurer')

    const played = play(value, participantId, 'league_of_explorers_ethereal_conjurer')
    expect(
      played.events.filter((event) => event.type === 'discover-started')
    ).toHaveLength(1)

    expect(value.match.getState().pendingDiscover?.candidates).toHaveLength(3)
    expect(value.match.getState().pendingDiscover?.queued).toHaveLength(1)
    const handBefore = player(value, participantId).hand.length
    for (let index = 0; index < 2; index++) {
      const pending = value.match.getState().pendingDiscover!
      const result = value.match.dispatch({
        type: 'choose-discover-card',
        participantId,
        cardInstanceId: pending.candidates[0]!.instanceId
      })
      expect(result.accepted).toBe(true)
      expect(
        result.events.filter((event) => event.type === 'discover-started')
      ).toHaveLength(index === 0 ? 1 : 0)
    }
    expect(value.match.getState().pendingDiscover).toBeUndefined()
    expect(player(value, participantId).hand).toHaveLength(handBefore + 2)
    expect(player(value, participantId).revealedCards).toHaveLength(0)
    expect(value.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
  })

  it('presents both Finley choices with Brann and installs each selected power', () => {
    const value = scenario()
    const [participantId] = activePlayers(value)
    summon(value, participantId, 'league_of_explorers_brann_bronzebeard')
    setMana(value, participantId)
    addCard(value, participantId, 'league_of_explorers_sir_finley_mrrgglton')
    const played = play(
      value,
      participantId,
      'league_of_explorers_sir_finley_mrrgglton'
    )
    expect(
      played.events.filter((event) => event.type === 'card-choice-started')
    ).toHaveLength(1)
    expect(value.match.getState().pendingCardChoice?.queued).toHaveLength(1)
    for (let index = 0; index < 2; index++) {
      const pending = value.match.getState().pendingCardChoice!
      const result = value.match.dispatch({
        type: 'choose-card-option',
        participantId,
        sourceCardInstanceId: pending.sourceCardInstanceId,
        choice: 0
      })
      expect(result.accepted).toBe(true)
      expect(player(value, participantId).heroPower.id).toBe(
        pending.options[0]!.presentationHeroPowerId
      )
      const events = result.events.filter(
        (event) => event.type === 'card-choice-started'
      )
      expect(events).toHaveLength(index === 0 ? 1 : 0)
      if (index === 0)
        expect(events[0]).toMatchObject({
          options: result.state.pendingCardChoice?.options
        })
    }
    expect(value.match.getState().pendingCardChoice).toBeUndefined()
    expect(value.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
  })

  it.each([0, 1, 2])(
    'applies targeted Battlecries with %s Branns without stacking past twice',
    (branns) => {
      const value = scenario()
      const [participantId, opponentId] = activePlayers(value)
      for (let index = 0; index < branns; index++)
        summon(value, participantId, 'league_of_explorers_brann_bronzebeard')
      setMana(value, participantId)
      addCard(value, participantId, 'basic_elven_archer')
      const before = player(value, opponentId).hero.health
      play(value, participantId, 'basic_elven_archer', {
        targets: [{ kind: 'hero', participantId: opponentId }]
      })
      expect(player(value, opponentId).hero.health).toBe(before - (branns ? 2 : 1))
    }
  )

  it('removes the doubling aura when Brann is silenced', () => {
    const value = scenario()
    const [participantId, opponentId] = activePlayers(value)
    summon(value, participantId, 'league_of_explorers_brann_bronzebeard')
    const brann = player(value, participantId).board.at(-1)!
    setMana(value, participantId)
    addCard(value, participantId, 'classic_silence')
    play(value, participantId, 'classic_silence', {
      targets: [{ kind: 'minion', participantId, instanceId: brann.instanceId }]
    })
    addCard(value, participantId, 'basic_elven_archer')
    const before = player(value, opponentId).hero.health
    play(value, participantId, 'basic_elven_archer', {
      targets: [{ kind: 'hero', participantId: opponentId }]
    })
    expect(player(value, opponentId).hero.health).toBe(before - 1)
  })

  it('finishes a doubled Battlecry when its target dies on the first hit', () => {
    const value = scenario()
    const [participantId, opponentId] = activePlayers(value)
    summon(value, participantId, 'league_of_explorers_brann_bronzebeard')
    summon(value, opponentId, 'basic_elven_archer')
    const victim = player(value, opponentId).board.at(-1)!
    setMana(value, participantId)
    addCard(value, participantId, 'basic_elven_archer')
    const result = play(value, participantId, 'basic_elven_archer', {
      targets: [
        { kind: 'minion', participantId: opponentId, instanceId: victim.instanceId }
      ]
    })
    expect(result.accepted).toBe(true)
    expect(player(value, opponentId).board).toHaveLength(0)
    expect(value.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
  })

  it('caps damage before applying Cursed Blade damage multiplication', () => {
    const value = scenario()
    const [defenderId, attackerId] = activePlayers(value)
    summon(value, defenderId, 'league_of_explorers_animated_armor')
    setMana(value, defenderId)
    addCard(value, defenderId, 'league_of_explorers_cursed_blade')
    play(value, defenderId, 'league_of_explorers_cursed_blade')
    expect(
      value.match.dispatch({ type: 'end-turn', participantId: defenderId }).accepted
    ).toBe(true)
    setMana(value, attackerId)
    addCard(value, attackerId, 'basic_fireball')
    const healthBefore = player(value, defenderId).hero.health

    play(value, attackerId, 'basic_fireball', {
      targets: [{ kind: 'hero', participantId: defenderId }]
    })

    expect(player(value, defenderId).hero.health).toBe(healthBefore - 2)
  })

  it('replaces all hand and deck cards with Legendary minions', () => {
    const value = scenario()
    const [participantId] = activePlayers(value)
    setMana(value, participantId)
    addCard(value, participantId, 'basic_fireball')
    addCard(value, participantId, 'league_of_explorers_golden_monkey')

    const monkey = player(value, participantId).hand.find(
      (card) => card.cardId === 'league_of_explorers_golden_monkey'
    )!
    const handInstanceIdsBefore = player(value, participantId)
      .hand.filter((card) => card.instanceId !== monkey.instanceId)
      .map((card) => card.instanceId)

    const result = play(value, participantId, 'league_of_explorers_golden_monkey')

    expect(player(value, participantId).hand.map((card) => card.instanceId)).toEqual(
      handInstanceIdsBefore
    )
    for (const target of handInstanceIdsBefore) {
      expect(result.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'effect-resolved',
            sourceInstanceId: monkey.instanceId,
            sourceCardId: monkey.cardId,
            controllerId: participantId,
            action: 'transform-random',
            data: expect.objectContaining({ target })
          })
        ])
      )
    }

    for (const card of [
      ...player(value, participantId).hand,
      ...player(value, participantId).deck
    ]) {
      expect(CARD_CATALOG.require(card.cardId)).toMatchObject({
        type: 'Minion',
        rarity: 'Legendary'
      })
    }
  })

  it('discovers and installs one of three different basic Hero Powers', () => {
    const value = scenario({ firstHeroId: 'jaina' })
    const [participantId, opponentId] = activePlayers(value)
    setMana(value, participantId)
    const used = value.match.dispatch({
      type: 'use-hero-power',
      participantId,
      target: { kind: 'hero', participantId: opponentId }
    })
    expect(used.accepted).toBe(true)
    expect(player(value, participantId).heroPower).toMatchObject({
      available: false,
      usesThisTurn: 1
    })
    addCard(value, participantId, 'league_of_explorers_sir_finley_mrrgglton')
    const finley = player(value, participantId).hand.find(
      (card) => card.cardId === 'league_of_explorers_sir_finley_mrrgglton'
    )!

    play(value, participantId, 'league_of_explorers_sir_finley_mrrgglton')
    const pending = value.match.getState().pendingCardChoice
    expect(pending?.options).toHaveLength(3)
    if (pending?.resolution?.type !== 'hero-power')
      throw new Error('Expected hero-power choice')
    expect(pending?.resolution?.heroPowerIds).not.toContain('mage-fireblast')
    expect(pending?.options.map((option) => option.presentationHeroPowerId)).toEqual(
      pending?.resolution?.heroPowerIds
    )

    const result = value.match.dispatch({
      type: 'choose-card-option',
      participantId,
      sourceCardInstanceId: finley.instanceId,
      choice: 0
    })
    expect(result.accepted).toBe(true)
    expect(player(value, participantId).heroPower.id).toBe(
      pending!.resolution!.heroPowerIds[0]
    )
    expect(player(value, participantId).heroPower).toMatchObject({
      available: true,
      usesThisTurn: 0
    })
    expect(result.events).toContainEqual({
      type: 'hero-power-replaced',
      participantId,
      previousHeroPowerId: 'mage-fireblast',
      heroPowerId: pending!.resolution!.heroPowerIds[0]
    })
  })

  it('gives Tunnel Trogg Attack equal to newly applied Overload', () => {
    const value = scenario({ firstHeroId: 'thrall' })
    const [participantId, opponentId] = activePlayers(value)
    summon(value, participantId, 'league_of_explorers_tunnel_trogg')
    setMana(value, participantId)
    addCard(value, participantId, 'classic_lightning_bolt')

    play(value, participantId, 'classic_lightning_bolt', {
      targets: [{ kind: 'hero', participantId: opponentId }]
    })

    expect(
      player(value, participantId).board.find(
        (minion) => minion.cardId === 'league_of_explorers_tunnel_trogg'
      )?.attack
    ).toBe(2)
  })

  it('casts a targeted buff copy on Djinni of Zephyrs', () => {
    const value = scenario()
    const [participantId] = activePlayers(value)
    summon(value, participantId, 'league_of_explorers_djinni_of_zephyrs')
    summon(value, participantId, 'basic_bloodfen_raptor')
    setMana(value, participantId)
    addCard(value, participantId, 'basic_blessing_of_kings')
    const raptor = player(value, participantId).board.find(
      (minion) => minion.cardId === 'basic_bloodfen_raptor'
    )!

    play(value, participantId, 'basic_blessing_of_kings', {
      targets: [{ kind: 'minion', participantId, instanceId: raptor.instanceId }]
    })

    expect(
      player(value, participantId).board.find(
        (minion) => minion.cardId === 'league_of_explorers_djinni_of_zephyrs'
      )
    ).toMatchObject({ attack: 8, health: 10 })
  })

  it('uses the spell final cost for Summoning Stone', () => {
    const value = scenario()
    const [participantId, opponentId] = activePlayers(value)
    summon(value, participantId, 'league_of_explorers_summoning_stone')
    setMana(value, participantId)
    addCard(value, participantId, 'basic_frostbolt')

    play(value, participantId, 'basic_frostbolt', {
      targets: [{ kind: 'hero', participantId: opponentId }]
    })

    const summoned = player(value, participantId).board.find(
      (minion) => minion.cardId !== 'league_of_explorers_summoning_stone'
    )
    expect(summoned).toBeDefined()
    expect(CARD_CATALOG.require(summoned!.cardId).cost).toBe(2)
  })

  it('uses the board count from before Battlecry summons for Sacred Trial', () => {
    const value = scenario()
    const [secretOwnerId, opponentId] = activePlayers(value)
    setMana(value, secretOwnerId)
    addCard(value, secretOwnerId, 'league_of_explorers_sacred_trial')
    play(value, secretOwnerId, 'league_of_explorers_sacred_trial')
    expect(
      value.match.dispatch({ type: 'end-turn', participantId: secretOwnerId }).accepted
    ).toBe(true)
    summon(value, opponentId, 'basic_bloodfen_raptor')
    summon(value, opponentId, 'basic_river_crocolisk')
    setMana(value, opponentId)
    addCard(value, opponentId, 'goblins_vs_gnomes_dr_boom')

    play(value, opponentId, 'goblins_vs_gnomes_dr_boom')

    expect(
      player(value, opponentId).board.some(
        (minion) => minion.cardId === 'goblins_vs_gnomes_dr_boom'
      )
    ).toBe(true)
    expect(player(value, secretOwnerId).secrets).toHaveLength(1)
  })

  it('summons one base copy for each selected Murloc death with Anyfin', () => {
    const value = scenario()
    const [murlocPlayerId, opponentId] = activePlayers(value)
    summon(value, murlocPlayerId, 'basic_bluegill_warrior')
    summon(value, murlocPlayerId, 'league_of_explorers_murloc_tinyfin')
    expect(
      value.match.dispatch({ type: 'end-turn', participantId: murlocPlayerId }).accepted
    ).toBe(true)
    setMana(value, opponentId)
    addCard(value, opponentId, 'basic_flamestrike')
    play(value, opponentId, 'basic_flamestrike')
    expect(
      value.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)
    setMana(value, murlocPlayerId)
    addCard(value, murlocPlayerId, 'league_of_explorers_anyfin_can_happen')

    play(value, murlocPlayerId, 'league_of_explorers_anyfin_can_happen')

    expect(
      player(value, murlocPlayerId)
        .board.map((minion) => minion.cardId)
        .sort()
    ).toEqual(['basic_bluegill_warrior', 'league_of_explorers_murloc_tinyfin'].sort())
  })

  it('resolves Dart Trap after the opposing Hero Power', () => {
    // This card-rule fixture exercises basic Armor Up, independently of AI handicaps.
    const value = scenario({ secondController: 'human' })
    const [secretOwnerId, opponentId] = activePlayers(value)
    setMana(value, secretOwnerId)
    addCard(value, secretOwnerId, 'league_of_explorers_dart_trap')
    play(value, secretOwnerId, 'league_of_explorers_dart_trap')
    expect(
      value.match.dispatch({ type: 'end-turn', participantId: secretOwnerId }).accepted
    ).toBe(true)
    setMana(value, opponentId)
    const healthBefore = player(value, opponentId).hero.health

    const result = value.match.dispatch({
      type: 'use-hero-power',
      participantId: opponentId
    })

    expect(result.accepted).toBe(true)
    expect(player(value, opponentId).hero.health).toBe(healthBefore - 3)
    expect(player(value, opponentId).hero.armor).toBe(0)
    expect(player(value, secretOwnerId).secrets).toHaveLength(0)
  })

  it('sets hand card costs to 5 while Naga Sea Witch is in play', () => {
    const value = scenario()
    const [participantId] = activePlayers(value)
    summon(value, participantId, 'league_of_explorers_naga_sea_witch')
    addCard(value, participantId, 'basic_fireball')
    addCard(value, participantId, 'basic_boulderfist_ogre')

    const costs = player(value, participantId)
      .hand.filter((card) =>
        ['basic_fireball', 'basic_boulderfist_ogre'].includes(card.cardId)
      )
      .map((card) => card.currentCost)
    expect(costs).toEqual([5, 5])
  })

  it('copies a chosen friendly Deathrattle onto Unearthed Raptor', () => {
    const value = scenario()
    const [participantId] = activePlayers(value)
    summon(value, participantId, 'classic_loot_hoarder')
    setMana(value, participantId)
    addCard(value, participantId, 'league_of_explorers_unearthed_raptor')
    const lootHoarder = player(value, participantId).board.find(
      (minion) => minion.cardId === 'classic_loot_hoarder'
    )!

    play(value, participantId, 'league_of_explorers_unearthed_raptor', {
      targets: [{ kind: 'minion', participantId, instanceId: lootHoarder.instanceId }]
    })

    expect(
      player(value, participantId).board.find(
        (minion) => minion.cardId === 'league_of_explorers_unearthed_raptor'
      )?.deathrattles
    ).toHaveLength(1)
  })

  it('moves an Entombed enemy minion into the caster deck', () => {
    const value = scenario()
    const [participantId, opponentId] = activePlayers(value)
    summon(value, opponentId, 'basic_boulderfist_ogre')
    setMana(value, participantId)
    addCard(value, participantId, 'league_of_explorers_entomb')
    const target = player(value, opponentId).board[0]!
    const deckBefore = player(value, participantId).deck.length

    play(value, participantId, 'league_of_explorers_entomb', {
      targets: [
        { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
      ]
    })

    expect(player(value, opponentId).board).toHaveLength(0)
    expect(player(value, participantId).deck).toHaveLength(deckBefore + 1)
    expect(
      player(value, participantId).deck.some(
        (card) => card.cardId === 'basic_boulderfist_ogre'
      )
    ).toBe(true)
  })

  it('applies Jungle Moonkin Spell Damage +2 to both players', () => {
    const value = scenario()
    const [participantId, opponentId] = activePlayers(value)
    summon(value, participantId, 'league_of_explorers_jungle_moonkin')
    setMana(value, participantId)
    addCard(value, participantId, 'basic_frostbolt')
    const healthBefore = player(value, opponentId).hero.health

    play(value, participantId, 'basic_frostbolt', {
      targets: [{ kind: 'hero', participantId: opponentId }]
    })

    expect(player(value, opponentId).hero.health).toBe(healthBefore - 5)
    expect(player(value, participantId).hero.spellDamage).toBe(2)
    expect(player(value, opponentId).hero.spellDamage).toBe(2)
  })

  it('damages the holder at the start of their turn while Cursed is in hand', () => {
    const value = scenario()
    const [participantId, opponentId] = activePlayers(value)
    setMana(value, participantId)
    addCard(value, participantId, 'league_of_explorers_curse_of_rafaam')
    play(value, participantId, 'league_of_explorers_curse_of_rafaam')
    const healthBefore = player(value, opponentId).hero.health

    expect(value.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )

    expect(player(value, opponentId).hero.health).toBe(healthBefore - 2)
    expect(
      player(value, opponentId).hand.some(
        (card) => card.cardId === 'league_of_explorers_cursed'
      )
    ).toBe(true)
  })

  it('resolves Ancient Curse on draw, consumes it, and continues drawing', () => {
    const value = scenario()
    const [participantId, opponentId] = activePlayers(value)
    expect(
      value.match.dispatch({
        type: 'dev-modify-deck',
        participantId,
        action: 'destroy'
      }).accepted
    ).toBe(true)
    setMana(value, participantId)
    addCard(value, participantId, 'league_of_explorers_ancient_shade')
    play(value, participantId, 'league_of_explorers_ancient_shade')
    expect(value.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(
      value.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)

    expect(player(value, participantId).hero.health).toBe(22)
    expect(
      player(value, participantId).hand.some(
        (card) => card.cardId === 'league_of_explorers_ancient_curse'
      )
    ).toBe(false)
    expect(
      player(value, participantId).discardedCards?.some(
        (card) => card.cardId === 'league_of_explorers_ancient_curse'
      )
    ).toBe(true)
  })

  it('fully heals Reno Jackson with a duplicate-free deck', () => {
    const value = scenario()
    const [participantId] = activePlayers(value)
    expect(
      value.match.dispatch({
        type: 'dev-modify-deck',
        participantId,
        action: 'destroy'
      }).accepted
    ).toBe(true)
    expect(
      value.match.dispatch({
        type: 'dev-set-hero',
        participantId,
        health: 8
      }).accepted
    ).toBe(true)
    setMana(value, participantId)
    addCard(value, participantId, 'league_of_explorers_reno_jackson')

    play(value, participantId, 'league_of_explorers_reno_jackson')

    expect(player(value, participantId).hero.health).toBe(30)
  })

  it("grants Explorer's Hat stats and a reusable Hat Deathrattle", () => {
    const value = scenario()
    const [participantId] = activePlayers(value)
    summon(value, participantId, 'basic_bloodfen_raptor')
    setMana(value, participantId)
    addCard(value, participantId, 'league_of_explorers_explorers_hat')
    const target = player(value, participantId).board[0]!

    play(value, participantId, 'league_of_explorers_explorers_hat', {
      targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
    })

    expect(player(value, participantId).board[0]).toMatchObject({
      attack: 4,
      health: 3
    })
    expect(player(value, participantId).board[0]?.deathrattles).toHaveLength(1)
  })
})
