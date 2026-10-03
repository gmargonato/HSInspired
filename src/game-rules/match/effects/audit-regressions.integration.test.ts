import { describe, expect, it } from 'vitest'
import { CARD_CATALOG } from '../../content/cards'
import { createZombeastDefinitions } from '../../content/cards/zombeast'
import type { PlayerId } from '../match-types'
import {
  createMatchScenario,
  type MatchScenario
} from '../testing/match-scenario-builder'

function player(scenario: MatchScenario, participantId: PlayerId) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
}

function activePlayers(scenario: MatchScenario): readonly [PlayerId, PlayerId] {
  const participantId = scenario.match.getState().activePlayerId!
  const opponentId = scenario.participants.find((id) => id !== participantId)!
  return [participantId, opponentId]
}

function setMana(scenario: MatchScenario, participantId: PlayerId): void {
  expect(
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId,
      available: 10,
      maximum: 10
    }).accepted
  ).toBe(true)
}

describe('audit regression coverage', () => {
  it('draws Divine Favor only when the opponent has more cards', () => {
    const scenario = createMatchScenario({
      cardId: 'classic_divine_favor',
      firstHeroId: 'uther'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId: opponentId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)

    const card = player(scenario, participantId).hand[0]!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, participantId).hand).toHaveLength(3)
    expect(result.events.filter((event) => event.type === 'card-drawn')).toHaveLength(0)
  })

  it('does not fatigue when The Curator has no matching cards to draw', () => {
    const scenario = createMatchScenario({ cardId: 'basic_acidic_swamp_ooze' })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)

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
        cardId: 'one_night_in_karazhan_the_curator'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)
    expect(
      scenario.match.dispatch({
        type: 'dev-modify-deck',
        participantId,
        action: 'destroy'
      }).accepted
    ).toBe(true)

    const fatigueBefore = player(scenario, participantId).fatigueDamage
    const curator = player(scenario, participantId).hand[0]!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: curator.instanceId,
      position: 0
    })

    expect(result.accepted).toBe(true)
    expect(result.events.filter((event) => event.type === 'card-drawn')).toHaveLength(0)
    expect(result.events.filter((event) => event.type === 'fatigue')).toHaveLength(0)
    expect(player(scenario, participantId).fatigueDamage).toBe(fatigueBefore)
  })

  it('applies spell damage to random split spells as additional sequential hits', () => {
    const scenario = createMatchScenario({ cardId: 'basic_arcane_missiles' })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'classic_azure_drake'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)

    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: player(scenario, participantId).hand[0]!.instanceId
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, opponentId).hero.health).toBe(26)
  })

  it('removes mortally wounded random-hit targets before selecting the next hit', () => {
    const scenario = createMatchScenario({
      seed: 1,
      cardId: 'basic_arcane_missiles'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'classic_wisp'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)

    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: player(scenario, participantId).hand[0]!.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).board).toHaveLength(0)
    expect(player(scenario, opponentId).hero.health).toBe(28)
  })

  it('summons a Demon when Bane of Doom kills its target', () => {
    const scenario = createMatchScenario({
      cardId: 'classic_bane_of_doom',
      seed: 1
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)

    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'whispers_of_the_old_gods_disciple_of_cthun'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_bane_of_doom'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)

    const bane = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_bane_of_doom'
    )!
    const target = player(scenario, opponentId).board[0]!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: bane.instanceId,
      targets: [
        {
          kind: 'minion',
          participantId: opponentId,
          instanceId: target.instanceId
        }
      ]
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, opponentId).board).toHaveLength(0)
    const summoned = player(scenario, participantId).board.at(-1)
    expect(summoned).toBeDefined()
    expect(CARD_CATALOG.require(summoned!.cardId).subtype).toBe('Demon')
  })

  it('selects distinct enemy minions for Multi-Shot', () => {
    const scenario = createMatchScenario({ seed: 1, cardId: 'basic_multi_shot' })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)

    for (let index = 0; index < 2; index += 1) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: opponentId,
          cardId: 'basic_boulderfist_ogre'
        }).accepted
      ).toBe(true)
    }
    setMana(scenario, participantId)

    const card = player(scenario, participantId).hand.find(
      (candidate) => candidate.cardId === 'basic_multi_shot'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, opponentId).board.map((minion) => minion.health)).toEqual([
      4, 4
    ])
  })

  it('draws the fixed missing count for draw-until, including fatigue attempts', () => {
    const scenario = createMatchScenario({ cardId: 'goblins_vs_gnomes_jeeves' })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)
    setMana(scenario, participantId)
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: player(scenario, participantId).hand[0]!.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-modify-deck',
        participantId,
        action: 'destroy'
      }).accepted
    ).toBe(true)

    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(player(scenario, participantId).hero.health).toBe(24)
    expect(player(scenario, participantId).fatigueDamage).toBe(4)
  })

  it('preserves lost weapon durability when a durability modifier is applied', () => {
    const scenario = createMatchScenario({
      cardId: 'basic_fiery_war_axe',
      firstHeroId: 'garrosh'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)
    setMana(scenario, participantId)
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: player(scenario, participantId).hand[0]!.instanceId
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'attack-character',
        participantId,
        attacker: { kind: 'hero' },
        defender: { kind: 'hero' }
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_upgrade'
      }).accepted
    ).toBe(true)
    const upgrade = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_upgrade'
    )!

    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: upgrade.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).weapon).toMatchObject({
      attack: 4,
      durability: 2,
      maxDurability: 3
    })
  })

  it('preserves a card creation ordinal across normal hand-to-play movement', () => {
    const scenario = createMatchScenario({ cardId: 'basic_acidic_swamp_ooze' })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)
    setMana(scenario, participantId)
    const card = player(scenario, participantId).hand[0]!

    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    const minion = player(scenario, participantId).board.find(
      (candidate) => candidate.instanceId === card.instanceId
    )!
    expect(minion.creationOrdinal).toBe(card.creationOrdinal)

    const weaponScenario = createMatchScenario({ cardId: 'basic_fiery_war_axe' })
    weaponScenario.confirmBothMulligans()
    const [weaponPlayer] = activePlayers(weaponScenario)
    setMana(weaponScenario, weaponPlayer)
    const weaponCard = player(weaponScenario, weaponPlayer).hand[0]!
    expect(
      weaponScenario.match.dispatch({
        type: 'play-card',
        participantId: weaponPlayer,
        cardInstanceId: weaponCard.instanceId
      }).accepted
    ).toBe(true)
    expect(player(weaponScenario, weaponPlayer).weapon?.creationOrdinal).toBe(
      weaponCard.creationOrdinal
    )

    const secretScenario = createMatchScenario({ cardId: 'classic_counterspell' })
    secretScenario.confirmBothMulligans()
    const [secretPlayer] = activePlayers(secretScenario)
    setMana(secretScenario, secretPlayer)
    const secretCard = player(secretScenario, secretPlayer).hand[0]!
    expect(
      secretScenario.match.dispatch({
        type: 'play-card',
        participantId: secretPlayer,
        cardInstanceId: secretCard.instanceId
      }).accepted
    ).toBe(true)
    expect(player(secretScenario, secretPlayer).secrets?.[0]?.creationOrdinal).toBe(
      secretCard.creationOrdinal
    )
  })
})

function fixture(seed = 1, hero = 'garrosh', deck = 'basic_acidic_swamp_ooze') {
  const s = createMatchScenario({
    seed,
    firstHeroId: hero,
    secondHeroId: hero,
    cardId: deck
  })
  s.confirmBothMulligans()
  const me = s.match.getState().activePlayerId!
  const foe = s.participants.find((p) => p !== me)!
  const player = (p = me) =>
    s.match.getState().players.find((x) => x.participantId === p)!
  const command = (c: unknown) => {
    const r = s.match.dispatch(c)
    expect(r.accepted, JSON.stringify(c) + ': ' + (r.accepted ? '' : r.message)).toBe(
      true
    )
    return r
  }
  const mana = (n = 10, p = me) =>
    command({ type: 'dev-set-mana', participantId: p, available: n, maximum: n })
  const add = (cardId: string, p = me) => {
    command({ type: 'dev-add-card', participantId: p, cardId })
    return player(p).hand.at(-1)!.instanceId
  }
  const playInstance = (id: string, targets: unknown[] = [], p = me, refill = true) => {
    if (refill) mana(10, p)
    const card = player(p).hand.find((c) => c.instanceId === id)!
    const position =
      CARD_CATALOG.get(card.cardId)?.type === 'Minion'
        ? { position: player(p).board.length }
        : {}
    return command({
      type: 'play-card',
      participantId: p,
      cardInstanceId: id,
      targets,
      ...position
    })
  }
  const play = (id: string, targets: unknown[] = [], p = me) =>
    playInstance(add(id, p), targets, p)
  const summon = (id: string, p = me) => {
    command({ type: 'dev-summon-minion', participantId: p, cardId: id })
    return player(p).board.at(-1)!.instanceId
  }
  const target = (id: string, p = foe) => ({
    kind: 'minion',
    participantId: p,
    instanceId: id
  })
  const end = (p = me) => command({ type: 'end-turn', participantId: p })
  const cycle = () => {
    end()
    end(foe)
  }
  const attack = (id?: string, defender?: string) =>
    command({
      type: 'attack-character',
      participantId: me,
      attacker: id ? { kind: 'minion', instanceId: id } : { kind: 'hero' },
      defender: defender ? { kind: 'minion', instanceId: defender } : { kind: 'hero' }
    })
  for (const p of [me, foe])
    command({ type: 'dev-clear-zone', participantId: p, zone: 'hand' })
  return {
    s,
    me,
    foe,
    player,
    command,
    mana,
    add,
    playInstance,
    play,
    summon,
    target,
    end,
    cycle,
    attack
  }
}

describe('approved broad printed effects', () => {
  it('Brann preserves position-sensitive Battlecry targets', () => {
    const f = fixture()
    const left = f.summon('classic_wisp')
    const brann = f.summon('league_of_explorers_brann_bronzebeard')
    const far = f.summon('classic_wisp')
    const argus = f.add('classic_defender_of_argus')
    f.mana()
    f.command({
      type: 'play-card',
      participantId: f.me,
      cardInstanceId: argus,
      position: 1
    })
    expect(f.player().board.find((c) => c.instanceId === left)).toMatchObject({
      attack: 3,
      health: 3
    })
    expect(f.player().board.find((c) => c.instanceId === brann)).toMatchObject({
      attack: 4,
      health: 6
    })
    expect(f.player().board.find((c) => c.instanceId === far)).toMatchObject({
      attack: 1,
      health: 1
    })
  })
  it.each([0, 1])(
    'Brann doubles hero Choose One branch %i without doubling Armor',
    (choice) => {
      const f = fixture()
      f.summon('league_of_explorers_brann_bronzebeard')
      const cardId = 'knights_of_the_frozen_throne_malfurion_the_pestilent'
      const id = f.add(cardId)
      f.mana()
      const result = f.command({
        type: 'play-card',
        participantId: f.me,
        cardInstanceId: id,
        choice
      })
      const summon =
        choice === 0
          ? 'knights_of_the_frozen_throne_frost_widow'
          : 'knights_of_the_frozen_throne_scarab_beetle'
      expect(f.player().board.filter((c) => c.cardId === summon)).toHaveLength(4)
      expect(result.events.filter((e) => e.type === 'hero-replaced')).toHaveLength(1)
      const definition = CARD_CATALOG.require(cardId)
      expect(f.player().hero.armor).toBe(
        definition.type === 'Hero' ? definition.armor : 0
      )
    }
  )
  it.each([
    ['basic_grimscale_oracle', 1, 0],
    ['classic_murloc_warleader', 2, 1]
  ] as const)(
    '%s buffs both sides, excludes itself, and loses its aura on silence',
    (card, attack, health) => {
      const f = fixture()
      f.summon('basic_murloc_raider')
      f.summon('basic_murloc_raider', f.foe)
      f.play(card)
      const source = f.player().board.at(-1)!
      const definition = CARD_CATALOG.require(card)
      expect(source.attack).toBe(definition.type === 'Minion' ? definition.attack : 0)
      for (const p of [f.me, f.foe])
        expect(f.player(p).board[0]).toMatchObject({
          attack: 2 + attack,
          health: 1 + health
        })
      f.end()
      f.play('basic_murloc_raider', [], f.foe)
      f.end(f.foe)
      expect(f.player(f.foe).board.at(-1)).toMatchObject({
        attack: 2 + attack,
        health: 1 + health
      })
      f.play('classic_silence', [f.target(source.instanceId, f.me)])
      for (const p of [f.me, f.foe])
        expect(f.player(p).board[0]).toMatchObject({ attack: 2, health: 1 })
    }
  )
  it('overlapping Murloc auras remain symmetric after control changes', () => {
    const f = fixture()
    f.summon('basic_murloc_raider')
    f.summon('basic_murloc_raider', f.foe)
    const first = f.summon('basic_grimscale_oracle')
    const second = f.summon('basic_grimscale_oracle', f.foe)
    for (const p of [f.me, f.foe]) expect(f.player(p).board[0].attack).toBe(4)
    f.play('basic_mind_control', [f.target(second)])
    for (const p of [f.me, f.foe]) expect(f.player(p).board[0].attack).toBe(4)
    f.play('classic_silence', [f.target(first, f.me)])
    for (const p of [f.me, f.foe]) expect(f.player(p).board[0].attack).toBe(3)
  })
  it.each(['hero', 'minion', 'friendly', 'none'])(
    'Coldwraith checks Frozen enemies: %s',
    (kind) => {
      const f = fixture()
      if (kind === 'hero')
        f.play('basic_frost_shock', [{ kind: 'hero', participantId: f.foe }])
      else if (kind !== 'none') {
        const p = kind === 'friendly' ? f.me : f.foe
        const id = f.summon('basic_chillwind_yeti', p)
        f.play('basic_frostbolt', [f.target(id, p)])
      }
      const before = f.player().hand.length
      f.play('knights_of_the_frozen_throne_coldwraith')
      expect(f.player().hand.length - before).toBe(
        kind === 'hero' || kind === 'minion' ? 1 : 0
      )
    }
  )
  it.each(['self', 'opponent'])(
    'Tomb Lurker can copy %s Deathrattle deaths without consuming history',
    (owner) => {
      const f = fixture()
      const p = owner === 'self' ? f.me : f.foe
      for (let i = 0; i < 2; i++) {
        const id = f.summon('classic_loot_hoarder', p)
        f.play('basic_fireball', [f.target(id, p)])
      }
      for (let i = 0; i < 2; i++) {
        const before = f.player().hand.length
        f.play('knights_of_the_frozen_throne_tomb_lurker')
        expect(f.player().hand).toHaveLength(before + 1)
        expect(f.player().hand.at(-1)?.cardId).toBe('classic_loot_hoarder')
        expect(f.player(p).graveyard).toHaveLength(2)
      }
    }
  )
  it('Tomb Lurker ignores deaths without Deathrattles', () => {
    const f = fixture()
    const id = f.summon('classic_wisp', f.foe)
    f.play('basic_fireball', [f.target(id)])
    f.play('knights_of_the_frozen_throne_tomb_lurker')
    expect(f.player().hand).toHaveLength(0)
  })
  it.each([0, 1, 2])(
    'Brann doubles weapon Battlecries with %i copies without stacking',
    (count) => {
      const f = fixture()
      const squire = f.summon('classic_argent_squire')
      for (let i = 0; i < count; i++) f.summon('league_of_explorers_brann_bronzebeard')
      f.play('whispers_of_the_old_gods_rallying_blade')
      expect(f.player().board.find((c) => c.instanceId === squire)).toMatchObject({
        attack: count ? 3 : 2,
        health: count ? 3 : 2
      })
    }
  )
  it('Brann doubles hero Battlecries while replacement and base Armor happen once', () => {
    const f = fixture()
    f.summon('league_of_explorers_brann_bronzebeard')
    f.play('knights_of_the_frozen_throne_frost_lich_jaina')
    expect(
      f.player().board.filter((c) => c.cardId === 'basic_water_elemental')
    ).toHaveLength(2)
    const definition = CARD_CATALOG.require(
      'knights_of_the_frozen_throne_frost_lich_jaina'
    )
    expect(f.player().hero.armor).toBe(
      definition.type === 'Hero' ? definition.armor : 0
    )
  })
  it('silencing Brann removes weapon Battlecry doubling', () => {
    const f = fixture()
    const brann = f.summon('league_of_explorers_brann_bronzebeard')
    const squire = f.summon('classic_argent_squire')
    f.play('classic_silence', [f.target(brann, f.me)])
    f.play('whispers_of_the_old_gods_rallying_blade')
    expect(f.player().board.find((c) => c.instanceId === squire)?.attack).toBe(2)
  })
  it('Corrupt the Waters counts Battlecry cards once each across all playable types', () => {
    const f = fixture(1, 'thrall', 'journey_to_ungoro_corrupt_the_waters')
    f.summon('league_of_explorers_brann_bronzebeard')
    expect(f.player().quest?.progress).toBe(0)
    f.play('classic_wisp')
    f.play('basic_fiery_war_axe')
    expect(f.player().quest?.progress).toBe(0)
    f.play('whispers_of_the_old_gods_rallying_blade')
    expect(f.player().quest?.progress).toBe(1)
    f.play('knights_of_the_frozen_throne_frost_lich_jaina')
    expect(f.player().quest?.progress).toBe(2)
    f.play('basic_acidic_swamp_ooze')
    expect(f.player().quest?.progress).toBe(3)
    for (let i = 0; i < 3; i++) f.play('whispers_of_the_old_gods_rallying_blade')
    expect(f.player().quest).toBeNull()
    expect(
      f.player().hand.filter((c) => c.cardId === 'journey_to_ungoro_heart_of_virnaal')
    ).toHaveLength(1)
  })
})

describe('remaining approved audit rules', () => {
  it.each([1, 2, 3, 4, 5, 6, 7])(
    'Blood merges %i copies in pairs without reviving consumed sources',
    (count) => {
      const f = fixture()
      for (let i = 0; i < count; i++)
        f.summon('whispers_of_the_old_gods_blood_of_the_ancient_one')
      f.end()
      expect(
        f
          .player()
          .board.filter((c) => c.cardId === 'whispers_of_the_old_gods_the_ancient_one')
      ).toHaveLength(Math.floor(count / 2))
      expect(
        f
          .player()
          .board.filter(
            (c) => c.cardId === 'whispers_of_the_old_gods_blood_of_the_ancient_one'
          )
      ).toHaveLength(count % 2)
      expect(f.player().board).toHaveLength(Math.ceil(count / 2))
    }
  )
  it('Coldarra permits more than 99 Hero Power uses and silence restores the limit', () => {
    const f = fixture()
    const drake = f.summon('the_grand_tournament_coldarra_drake')
    f.command({ type: 'dev-set-hero-power', participantId: f.me, cost: 0 })
    const armor = f.player().hero.armor
    for (let i = 0; i < 101; i++)
      f.command({ type: 'use-hero-power', participantId: f.me })
    expect(f.player().heroPower.usesThisTurn).toBe(101)
    expect(f.player().hero.armor).toBe(armor + 202)
    f.play('classic_silence', [f.target(drake, f.me)])
    expect(
      f.s.match.dispatch({ type: 'use-hero-power', participantId: f.me }).accepted
    ).toBe(false)
  })
  it.each([true, false])(
    'Coldarra respects Mindbreaker regardless of aura order (%s)',
    (first) => {
      const f = fixture()
      if (first) f.summon('the_grand_tournament_coldarra_drake')
      const blocker = f.summon('knights_of_the_frozen_throne_mindbreaker')
      if (!first) f.summon('the_grand_tournament_coldarra_drake')
      f.command({ type: 'dev-set-hero-power', participantId: f.me, cost: 0 })
      expect(
        f.s.match.dispatch({ type: 'use-hero-power', participantId: f.me }).accepted
      ).toBe(false)
      f.play('classic_silence', [f.target(blocker, f.me)])
      f.command({ type: 'use-hero-power', participantId: f.me })
      f.command({ type: 'use-hero-power', participantId: f.me })
    }
  )
  it.each([0, 2, 5])(
    'Maiden sets base cost %i to 1 and silence restores it',
    (cost) => {
      const f = fixture()
      f.command({ type: 'dev-set-hero-power', participantId: f.me, cost })
      const maiden = f.summon('the_grand_tournament_maiden_of_the_lake')
      expect(f.player().heroPower.cost).toBe(1)
      f.play('classic_silence', [f.target(maiden, f.me)])
      expect(f.player().heroPower.cost).toBe(cost)
    }
  )
  it('Maiden temporarily overrides Raza and follows a replacement Hero Power', () => {
    const f = fixture()
    f.command({ type: 'dev-modify-deck', participantId: f.me, action: 'destroy' })
    f.play('mean_streets_of_gadgetzan_raza_the_chained')
    expect(f.player().heroPower.cost).toBe(0)
    const maiden = f.summon('the_grand_tournament_maiden_of_the_lake')
    expect(f.player().heroPower.cost).toBe(1)
    f.play('knights_of_the_frozen_throne_frost_lich_jaina')
    expect(f.player().heroPower.cost).toBe(1)
    f.play('classic_silence', [f.target(maiden, f.me)])
    expect(f.player().heroPower.cost).toBe(0)
  })
  it('Maiden overrides temporary increases only while its aura is active', () => {
    const f = fixture()
    const maiden = f.summon('the_grand_tournament_maiden_of_the_lake')
    f.end()
    f.play('the_grand_tournament_saboteur', [], f.foe)
    f.end(f.foe)
    expect(f.player().heroPower.cost).toBe(1)
    f.play('classic_silence', [f.target(maiden, f.me)])
    expect(f.player().heroPower.cost).toBe(7)
    f.cycle()
    expect(f.player().heroPower.cost).toBe(2)
  })
  it.each(['classic_wisp', 'classic_deathwing'])(
    'Frozen Crusher freezes after surviving combat against %s',
    (enemy) => {
      const f = fixture()
      f.summon('knights_of_the_frozen_throne_moorabi')
      const crusher = f.summon('journey_to_ungoro_frozen_crusher')
      f.cycle()
      const target = f.summon(enemy, f.foe)
      f.attack(crusher, target)
      const copies = f
        .player()
        .hand.filter((c) => c.cardId === 'journey_to_ungoro_frozen_crusher')
      if (enemy === 'classic_wisp') {
        expect(
          f.player().board.find((c) => c.instanceId === crusher)?.frozenUntilTurn
        ).not.toBeNull()
        expect(copies).toHaveLength(1)
      } else {
        expect(f.player().board.some((c) => c.instanceId === crusher)).toBe(false)
        expect(copies).toHaveLength(0)
      }
    }
  )
  it('Lotus Illusionist deals its original damage before transforming after a hero attack', () => {
    const f = fixture()
    const lotus = f.summon('mean_streets_of_gadgetzan_lotus_illusionist')
    f.cycle()
    const attack = f.player().board[0].attack
    f.attack(lotus)
    expect(f.player(f.foe).hero.health).toBe(30 - attack)
    expect(f.player().board[0].cardId).not.toBe(
      'mean_streets_of_gadgetzan_lotus_illusionist'
    )
    expect(CARD_CATALOG.require(f.player().board[0].cardId).cost).toBe(6)
  })
  it('Lotus Illusionist does not transform when Vaporize cancels its attack', () => {
    const f = fixture()
    const lotus = f.summon('mean_streets_of_gadgetzan_lotus_illusionist')
    f.end()
    f.play('classic_vaporize', [], f.foe)
    f.end(f.foe)
    f.attack(lotus)
    expect(f.player().board).toHaveLength(0)
    expect(f.player(f.foe).hero.health).toBe(30)
  })
  it('Bear Trap summons after damage rather than intercepting the current attack', () => {
    const f = fixture()
    const wisp = f.summon('classic_wisp')
    f.end()
    f.play('the_grand_tournament_bear_trap', [], f.foe)
    f.end(f.foe)
    const result = f.attack(wisp)
    const started = result.events.find((e) => e.type === 'secret-resolution-started')
    expect(
      started?.type === 'secret-resolution-started'
        ? started.state.players.find((p) => p.participantId === f.foe)?.hero.health
        : undefined
    ).toBe(29)
    expect(f.player(f.foe).board.map((c) => c.cardId)).toEqual([
      'the_grand_tournament_bear'
    ])
  })
  it.each(['lethal', 'cancelled'])(
    'Bear Trap stays hidden after %s attacks',
    (mode) => {
      const f = fixture()
      const wisp = f.summon('classic_wisp')
      f.end()
      f.play('the_grand_tournament_bear_trap', [], f.foe)
      if (mode === 'cancelled') f.play('classic_vaporize', [], f.foe)
      else f.command({ type: 'dev-set-hero', participantId: f.foe, health: 1 })
      f.end(f.foe)
      f.attack(wisp)
      expect(f.player(f.foe).board).toHaveLength(0)
      expect(
        f
          .player(f.foe)
          .secrets?.some((c) => c.cardId === 'the_grand_tournament_bear_trap')
      ).toBe(true)
    }
  )
  const chosenCharacters = [
    'classic_holy_wrath',
    'goblins_vs_gnomes_imp_losion',
    'blackrock_mountain_quick_shot',
    'blackrock_mountain_lava_shock',
    'whispers_of_the_old_gods_on_the_hunt',
    'mean_streets_of_gadgetzan_blowgill_sniper',
    'mean_streets_of_gadgetzan_dispatch_kodo',
    'journey_to_ungoro_flame_geyser',
    'journey_to_ungoro_blazecaller',
    'journey_to_ungoro_invocation_of_fire',
    'journey_to_ungoro_invocation_of_water'
  ]
  for (const card of chosenCharacters)
    it.each(['own-hero', 'enemy-hero', 'own-minion', 'enemy-minion'])(
      `${card} accepts %s as its chosen target`,
      (kind) => {
        const f = fixture()
        if (card === 'journey_to_ungoro_blazecaller') {
          f.play('basic_water_elemental')
          f.cycle()
        }
        const own = f.summon('basic_boulderfist_ogre'),
          enemy = f.summon('basic_boulderfist_ogre', f.foe)
        const target =
          kind === 'own-hero'
            ? { kind: 'hero', participantId: f.me }
            : kind === 'enemy-hero'
              ? { kind: 'hero', participantId: f.foe }
              : kind === 'own-minion'
                ? f.target(own, f.me)
                : f.target(enemy)
        const id = f.add(card)
        f.mana()
        expect(f.s.match.getPlayInput!(f.me, id)!.legalTargetOptions[0]).toEqual(
          expect.arrayContaining([target])
        )
        f.playInstance(id, [target])
      }
    )
  it('Blazecaller without its condition needs no target and deals no damage', () => {
    const f = fixture()
    f.play('journey_to_ungoro_blazecaller')
    expect(f.player(f.foe).hero.health).toBe(30)
  })
  it.each([
    'journey_to_ungoro_invocation_of_fire',
    'journey_to_ungoro_invocation_of_water'
  ])('%s affects only its chosen character', (card) => {
    const f = fixture()
    f.command({ type: 'dev-set-hero', participantId: f.me, health: 15 })
    f.command({ type: 'dev-set-hero', participantId: f.foe, health: 15 })
    f.summon('basic_boulderfist_ogre', f.foe)
    f.play(card, [{ kind: 'hero', participantId: f.foe }])
    expect(f.player(f.foe).hero.health).toBe(card.endsWith('fire') ? 9 : 27)
    expect(f.player().hero.health).toBe(15)
    expect(f.player(f.foe).board[0].health).toBe(7)
  })
  it('Bestial Wrath permits an enemy Beast and expires at turn end', () => {
    const f = fixture()
    const beast = f.summon('basic_bloodfen_raptor', f.foe)
    f.play('classic_bestial_wrath', [f.target(beast)])
    expect(f.player(f.foe).board[0]).toMatchObject({ attack: 5, immune: true })
    f.end()
    expect(f.player(f.foe).board[0]).toMatchObject({ attack: 3, immune: false })
  })
  it('Emboldener can buff an opposing minion', () => {
    let buffed = false
    for (let seed = 1; seed <= 8; seed++) {
      const f = fixture(seed)
      f.summon('classic_emboldener_3000')
      f.summon('classic_wisp', f.foe)
      f.end()
      buffed ||= f.player(f.foe).board[0].attack === 2
    }
    expect(buffed).toBe(true)
  })
  it.each(['goblins_vs_gnomes_cobra_shot', 'whispers_of_the_old_gods_stormcrack'])(
    '%s accepts a friendly minion',
    (card) => {
      const f = fixture()
      const own = f.summon('basic_boulderfist_ogre')
      f.play(card, [f.target(own, f.me)])
      expect(f.player().board[0].health).toBe(card.endsWith('cobra_shot') ? 4 : 3)
      if (card.endsWith('cobra_shot')) expect(f.player(f.foe).hero.health).toBe(27)
      else expect(f.player().mana.overloadNextTurn).toBe(1)
    }
  )
  it('Freezing Potion accepts the enemy hero', () => {
    const f = fixture()
    f.play('mean_streets_of_gadgetzan_freezing_potion', [
      { kind: 'hero', participantId: f.foe }
    ])
    expect(f.player(f.foe).hero.frozenUntilTurn).not.toBeNull()
  })
  it('Shatter accepts a friendly Frozen minion', () => {
    const f = fixture()
    const own = f.summon('basic_boulderfist_ogre')
    f.play('basic_frostbolt', [f.target(own, f.me)])
    f.play('whispers_of_the_old_gods_shatter', [f.target(own, f.me)])
    expect(f.player().board).toHaveLength(0)
  })
  const kodos = createZombeastDefinitions(CARD_CATALOG.all).filter((c) =>
    c.id.includes(':mean_streets_of_gadgetzan_dispatch_kodo:')
  )
  it.each(kodos.map((c) => c.id))('%s can target an enemy hero', (card) => {
    const f = fixture()
    f.play(card, [{ kind: 'hero', participantId: f.foe }])
    expect(f.player(f.foe).hero.health).toBe(30 - f.player().board[0].attack)
  })
})

describe('safe card audit batch', () => {
  it('Arathi keeps hero, power, health and armor', () => {
    const f = fixture()
    f.command({ type: 'dev-set-hero', participantId: f.me, health: 24, armor: 6 })
    const power = f.player().heroPower.id
    f.play('classic_arathi_weaponsmith')
    expect(f.player().heroId).toBe('garrosh')
    expect(f.player().heroPower.id).toBe(power)
    expect(f.player().hero).toMatchObject({ health: 24, armor: 6 })
    expect(f.player().weapon).toMatchObject({ attack: 2, durability: 2 })
  })
  it.each([1, 5, 10])('Forbidden Ancient spends %i starting mana', (mana) => {
    const f = fixture()
    const id = f.add('whispers_of_the_old_gods_forbidden_ancient')
    f.mana(mana)
    f.playInstance(id, [], f.me, false)
    expect(f.player().mana.available).toBe(0)
    expect(f.player().board[0]).toMatchObject({ attack: mana, health: mana })
  })
  it('Shatter rejects unfrozen targets without consuming state/RNG', () => {
    const f = fixture()
    const yeti = f.summon('basic_chillwind_yeti', f.foe)
    const id = f.add('whispers_of_the_old_gods_shatter')
    f.mana()
    const before = f.s.match.getState()
    const rng = f.s.rng.snapshot()
    expect(
      f.s.match.dispatch({
        type: 'play-card',
        participantId: f.me,
        cardInstanceId: id,
        targets: [f.target(yeti)]
      }).accepted
    ).toBe(false)
    expect(f.s.match.getState()).toEqual(before)
    expect(f.s.rng.snapshot()).toEqual(rng)
    f.play('basic_frostbolt', [f.target(yeti)])
    f.playInstance(id, [f.target(yeti)])
    expect(f.player(f.foe).board).toHaveLength(0)
  })
  it('Hidden Cache waits for a minion in hand and buffs it', () => {
    const f = fixture()
    const spell = f.add('basic_fireball')
    f.play('mean_streets_of_gadgetzan_hidden_cache')
    expect(f.player().secrets).toHaveLength(1)
    f.end()
    f.play('classic_wisp', [], f.foe)
    expect(f.player().secrets).toHaveLength(1)
    const minion = f.add('classic_wisp')
    f.play('classic_wisp', [], f.foe)
    expect(f.player().secrets).toHaveLength(0)
    expect(f.player().hand.find((c) => c.instanceId === minion)).toMatchObject({
      attack: 3,
      health: 3
    })
    expect(
      f.player().hand.find((c) => c.instanceId === spell)?.enchantments ?? []
    ).toHaveLength(0)
  })
  it('Getaway Kodo returns the dead minion', () => {
    const f = fixture()
    const wisp = f.summon('classic_wisp')
    f.play('mean_streets_of_gadgetzan_getaway_kodo')
    f.end()
    f.play('basic_fireball', [f.target(wisp, f.me)], f.foe)
    expect(f.player().secrets).toHaveLength(0)
    expect(f.player().hand.some((c) => c.cardId === 'classic_wisp')).toBe(true)
  })
  for (const spell of ['basic_cleave', 'classic_forked_lightning']) {
    it.each([1, 2, 3, 4, 5, 6, 7, 8])(
      `${spell} selects distinct minions, seed %i`,
      (seed) => {
        const f = fixture(seed)
        f.summon('basic_boulderfist_ogre', f.foe)
        f.summon('basic_boulderfist_ogre', f.foe)
        f.play(spell)
        expect(f.player(f.foe).board.map((c) => c.health)).toEqual([5, 5])
        if (spell === 'classic_forked_lightning')
          expect(f.player().mana.overloadNextTurn).toBe(2)
      }
    )
    it.each([1, 7])(`${spell} handles %i minions`, (count) => {
      const f = fixture()
      for (let n = 0; n < count; n++) f.summon('basic_boulderfist_ogre', f.foe)
      f.play(spell)
      expect(f.player(f.foe).board.filter((c) => c.health === 5)).toHaveLength(
        Math.min(count, 2)
      )
    })
    it(`${spell} handles shields and lethal damage`, () => {
      const f = fixture()
      f.summon('classic_argent_squire', f.foe)
      f.summon('classic_wisp', f.foe)
      f.play(spell)
      expect(f.player(f.foe).board).toHaveLength(1)
      expect(f.player(f.foe).board[0]).toMatchObject({ health: 1, divineShield: false })
    })
  }
  it('Kirin discounts the next Secret, including one acquired later, and expires', () => {
    const f = fixture()
    f.play('classic_kirin_tor_mage')
    const first = f.add('classic_counterspell')
    const next = f.add('classic_ice_barrier')
    expect(f.player().hand.find((c) => c.instanceId === first)?.currentCost).toBe(0)
    f.play('classic_wisp')
    f.playInstance(first)
    expect(f.player().hand.find((c) => c.instanceId === next)?.currentCost).toBe(3)
    f.play('classic_kirin_tor_mage')
    expect(f.player().hand.find((c) => c.instanceId === next)?.currentCost).toBe(0)
    f.cycle()
    expect(f.player().hand.find((c) => c.instanceId === next)?.currentCost).toBe(3)
  })
  it.each(['valeera', 'garrosh'])('Peddler uses Rogue criterion as %s', (hero) => {
    const f = fixture(1, hero)
    const ids = [
      'basic_fireball',
      'basic_fiery_war_axe',
      'basic_assassins_blade',
      'basic_acidic_swamp_ooze'
    ].map((c) => f.add(c))
    f.play('one_night_in_karazhan_ethereal_peddler')
    expect(
      ids.map((id) => f.player().hand.find((c) => c.instanceId === id)?.currentCost)
    ).toEqual([2, 0, 5, 2])
  })
  it('Dragonlord summons all Dragons without Battlecries', () => {
    const f = fixture()
    const dragon = f.summon('whispers_of_the_old_gods_deathwing_dragonlord')
    f.add('classic_azure_drake')
    f.add('classic_faerie_dragon')
    f.add('basic_boulderfist_ogre')
    f.play('basic_fireball', [f.target(dragon, f.me)])
    f.play('basic_fireball', [f.target(dragon, f.me)])
    expect(
      f
        .player()
        .board.map((c) => c.cardId)
        .sort()
    ).toEqual(['classic_azure_drake', 'classic_faerie_dragon'])
    expect(f.player().hand.map((c) => c.cardId)).toEqual(['basic_boulderfist_ogre'])
  })
  it('Envenom persists across turns but does not transfer to replacement weapon', () => {
    const f = fixture()
    f.play('basic_fiery_war_axe')
    f.play('journey_to_ungoro_envenom_weapon')
    f.cycle()
    const ogre = f.summon('basic_boulderfist_ogre', f.foe)
    f.attack(undefined, ogre)
    expect(f.player(f.foe).board).toHaveLength(0)
    f.play('basic_fiery_war_axe')
    f.cycle()
    const other = f.summon('basic_boulderfist_ogre', f.foe)
    f.attack(undefined, other)
    expect(f.player(f.foe).board[0].health).toBe(4)
  })
  it.each(['classic_wisp', 'basic_boulderfist_ogre', 'hero'])(
    'Burglebot checks own survival against %s',
    (defender) => {
      const f = fixture()
      const bot = f.summon('mean_streets_of_gadgetzan_wind_up_burglebot')
      f.cycle()
      const enemy = defender === 'hero' ? undefined : f.summon(defender, f.foe)
      const before = f.player().hand.length
      f.attack(bot, enemy)
      expect(f.player().hand.length - before).toBe(defender === 'classic_wisp' ? 1 : 0)
    }
  )
  for (const weapon of ['brass_knuckles', 'piranha_launcher'])
    it.each(['hero', 'minion'])(
      `${weapon} triggers on completed attack against %s`,
      (type) => {
        const f = fixture()
        const wisp = f.add('classic_wisp')
        f.play('mean_streets_of_gadgetzan_' + weapon)
        const target = type === 'minion' ? f.summon('classic_wisp', f.foe) : undefined
        f.attack(undefined, target)
        if (weapon === 'brass_knuckles')
          expect(f.player().hand.find((c) => c.instanceId === wisp)).toMatchObject({
            attack: 2,
            health: 2
          })
        else
          expect(f.player().board.map((c) => c.cardId)).toEqual([
            'mean_streets_of_gadgetzan_piranha'
          ])
      }
    )
  const stitched = createZombeastDefinitions(CARD_CATALOG.all)
  const knuckles = [
    'mean_streets_of_gadgetzan_knuckles',
    ...stitched
      .filter((c) => c.id.includes(':mean_streets_of_gadgetzan_knuckles:'))
      .map((c) => c.id)
  ]
  it.each(knuckles)('%s hits hero after lethal combat with Bolf', (card) => {
    const f = fixture()
    const attacker = f.summon(card)
    f.cycle()
    const bolf = f.summon('the_grand_tournament_bolf_ramshield', f.foe)
    f.play('basic_fireball', [f.target(bolf)])
    const attack = f.player().board[0].attack
    f.attack(attacker, bolf)
    expect(f.player(f.foe).hero.health).toBe(30 - attack)
  })
  it.each([1, 2, 3, 4])(
    'Frostcaller freezes after spell resolution, seed %i',
    (seed) => {
      const f = fixture(seed)
      f.summon('whispers_of_the_old_gods_demented_frostcaller')
      const wisp = f.summon('classic_wisp', f.foe)
      f.play('basic_fireball', [f.target(wisp)])
      expect(f.player(f.foe).hero.frozenUntilTurn).not.toBeNull()
    }
  )
  it('Kings Defender and Argent Lance grant durability', () => {
    const f = fixture()
    f.summon('basic_goldshire_footman')
    f.play('the_grand_tournament_kings_defender')
    expect(f.player().weapon).toMatchObject({ durability: 3, maxDurability: 3 })
    f.command({ type: 'dev-modify-deck', participantId: f.foe, action: 'destroy' })
    f.play('the_grand_tournament_argent_lance')
    expect(f.player().weapon).toMatchObject({ durability: 3, maxDurability: 3 })
  })
  it('Toxic Sewer Ooze spends durability and breaks weapons normally', () => {
    const f = fixture()
    f.end()
    f.play('basic_fiery_war_axe', [], f.foe)
    f.end(f.foe)
    f.play('mean_streets_of_gadgetzan_toxic_sewer_ooze')
    expect(f.player(f.foe).weapon?.durability).toBe(1)
    f.play('mean_streets_of_gadgetzan_toxic_sewer_ooze')
    expect(f.player(f.foe).weapon).toBeNull()
  })
  it.each(['grimestreet_pawnbroker', 'hobart_grapplehammer'])(
    '%s buffs the original weapon in hand',
    (card) => {
      const f = fixture()
      const axe = f.add('basic_fiery_war_axe')
      f.play('mean_streets_of_gadgetzan_' + card)
      f.playInstance(axe)
      expect(f.player().weapon).toMatchObject({
        attack: 4,
        durability: card === 'grimestreet_pawnbroker' ? 3 : 2
      })
    }
  )
  it('Hobart buffs weapons in deck through draw and equip', () => {
    const f = fixture(1, 'garrosh', 'basic_fiery_war_axe')
    f.play('mean_streets_of_gadgetzan_hobart_grapplehammer')
    f.command({ type: 'dev-draw', participantId: f.me })
    f.playInstance(f.player().hand[0].instanceId)
    expect(f.player().weapon?.attack).toBe(4)
  })
  it('Lunar Visions discounts its drawn minions', () => {
    const f = fixture()
    f.play('mean_streets_of_gadgetzan_lunar_visions')
    expect(f.player().hand.map((c) => c.currentCost)).toEqual([0, 0])
  })
  const widows = [
    'knights_of_the_frozen_throne_corpse_widow',
    ...stitched
      .filter((c) => c.id.includes(':knights_of_the_frozen_throne_corpse_widow:'))
      .map((c) => c.id)
  ]
  it.each(widows)(
    '%s discounts Deathrattle weapons and removes aura on silence',
    (card) => {
      const f = fixture()
      const weapon = f.add('naxxramas_deaths_bite')
      const widow = f.summon(card)
      expect(f.player().hand.find((c) => c.instanceId === weapon)?.currentCost).toBe(2)
      f.play('classic_ironbeak_owl', [f.target(widow, f.me)])
      expect(f.player().hand.find((c) => c.instanceId === weapon)?.currentCost).toBe(4)
    }
  )
  it.each(['hero', 'minion', 'friendly', 'none'])(
    'Cryomancer condition: %s',
    (kind) => {
      const f = fixture()
      if (kind === 'hero')
        f.play('basic_frost_shock', [{ kind: 'hero', participantId: f.foe }])
      else if (kind !== 'none') {
        const p = kind === 'friendly' ? f.me : f.foe
        const id = f.summon('basic_chillwind_yeti', p)
        f.play('basic_frostbolt', [f.target(id, p)])
      }
      f.play('mean_streets_of_gadgetzan_cryomancer')
      expect(f.player().board.at(-1)?.attack).toBe(
        kind === 'hero' || kind === 'minion' ? 7 : 5
      )
    }
  )
  it.each([8, 9, 10])('Wild Growth checks initial maximum mana %i', (maximum) => {
    const f = fixture()
    const id = f.add('basic_wild_growth')
    f.mana(maximum)
    f.playInstance(id, [], f.me, false)
    expect(f.player().mana.maximum).toBe(Math.min(10, maximum + 1))
    expect(f.player().hand).toHaveLength(maximum === 10 ? 1 : 0)
  })
  it.each(['don_hancho', 'grimestreet_smuggler', 'shaky_zipgunner'])(
    '%s never buffs spells',
    (card) => {
      const f = fixture()
      const spell = f.add('basic_fireball')
      if (card === 'shaky_zipgunner') {
        const id = f.summon('mean_streets_of_gadgetzan_' + card)
        f.play('basic_fireball', [f.target(id, f.me)])
      } else f.play('mean_streets_of_gadgetzan_' + card)
      expect(
        f.player().hand.find((c) => c.instanceId === spell)?.enchantments ?? []
      ).toHaveLength(0)
    }
  )
  it('Blubber Baron buffs in hand on qualifying summons only', () => {
    const f = fixture()
    const baron = f.add('mean_streets_of_gadgetzan_blubber_baron')
    f.play('basic_acidic_swamp_ooze')
    f.play('basic_acidic_swamp_ooze')
    f.play('classic_wisp')
    f.playInstance(baron)
    expect(f.player().board.at(-1)).toMatchObject({ attack: 3, health: 3 })
  })
  it.each(['garrosh', 'valeera'])(
    'Obsidian Shard counts non-Rogue cards as %s',
    (hero) => {
      const f = fixture(1, hero)
      const shard = f.add('journey_to_ungoro_obsidian_shard')
      f.play('the_grand_tournament_burgle')
      expect(f.player().hand.find((c) => c.instanceId === shard)?.currentCost).toBe(
        hero === 'garrosh' ? 2 : 4
      )
    }
  )
  it('Obsidian Shard counts earlier non-Rogue additions, excludes Neutral and floors at zero', () => {
    const f = fixture()
    f.play('the_grand_tournament_burgle')
    f.play('the_grand_tournament_burgle')
    f.play('the_grand_tournament_burgle')
    const shard = f.add('journey_to_ungoro_obsidian_shard')
    expect(f.player().hand.find((c) => c.instanceId === shard)?.currentCost).toBe(0)
    const g = fixture()
    const neutralShard = g.add('journey_to_ungoro_obsidian_shard')
    const yeti = g.summon('basic_chillwind_yeti')
    g.play('classic_youthful_brewmaster', [g.target(yeti, g.me)])
    expect(
      g.player().hand.find((c) => c.instanceId === neutralShard)?.currentCost
    ).toBe(4)
  })
  it('Obsidian Shard discounts a native Rogue copy for an added Warrior card', () => {
    const f = fixture(1, 'valeera')
    const shard = f.add('journey_to_ungoro_obsidian_shard')
    f.add('basic_fiery_war_axe', f.foe)
    f.play('basic_mind_vision')
    expect(f.player().hand.find((c) => c.instanceId === shard)?.currentCost).toBe(3)
  })
  it('Dragonlord leaves overflow Dragons in hand', () => {
    const f = fixture()
    const dragon = f.summon('whispers_of_the_old_gods_deathwing_dragonlord')
    for (let n = 0; n < 6; n++) f.summon('classic_wisp')
    f.add('classic_azure_drake')
    f.add('classic_faerie_dragon')
    f.play('basic_fireball', [f.target(dragon, f.me)])
    f.play('basic_fireball', [f.target(dragon, f.me)])
    expect(f.player().board).toHaveLength(7)
    expect(f.player().hand.map((c) => c.cardId)).toEqual(['classic_faerie_dragon'])
  })
  it.each(['basic_fireball', 'basic_acidic_swamp_ooze'])(
    'Lunar Visions handles a full hand drawing %s',
    (deck) => {
      const f = fixture(1, 'garrosh', deck)
      for (let n = 0; n < 9; n++) f.add('classic_wisp')
      f.play('mean_streets_of_gadgetzan_lunar_visions')
      expect(f.player().hand).toHaveLength(10)
      expect(f.player().hand.at(-1)?.currentCost).toBe(
        deck === 'basic_fireball' ? 4 : 0
      )
    }
  )
  it('Kings Defender and Argent Lance do not grant durability when conditions fail', () => {
    const f = fixture()
    f.play('the_grand_tournament_kings_defender')
    expect(f.player().weapon?.durability).toBe(2)
    f.command({ type: 'dev-modify-deck', participantId: f.me, action: 'destroy' })
    f.play('the_grand_tournament_argent_lance')
    expect(f.player().weapon?.durability).toBe(2)
  })
  it('Toxic Sewer Ooze triggers weapon Deathrattles at zero durability', () => {
    const f = fixture()
    f.end()
    f.play('naxxramas_deaths_bite', [], f.foe)
    f.end(f.foe)
    const wisp = f.summon('classic_wisp')
    f.play('mean_streets_of_gadgetzan_toxic_sewer_ooze')
    f.play('mean_streets_of_gadgetzan_toxic_sewer_ooze')
    expect(f.player(f.foe).weapon).toBeNull()
    expect(f.player().board.some((c) => c.instanceId === wisp)).toBe(false)
  })
  for (const weapon of ['brass_knuckles', 'piranha_launcher']) {
    it(`${weapon} triggers on its final durability charge`, () => {
      const f = fixture()
      f.play('mean_streets_of_gadgetzan_' + weapon)
      const charges = f.player().weapon!.durability
      for (let n = 1; n < charges; n++) {
        f.attack()
        f.cycle()
      }
      f.command({ type: 'dev-clear-zone', participantId: f.me, zone: 'hand' })
      const wisp = f.add('classic_wisp')
      const count = f.player().board.length
      f.attack()
      expect(f.player().weapon).toBeNull()
      if (weapon === 'brass_knuckles')
        expect(f.player().hand.find((c) => c.instanceId === wisp)).toMatchObject({
          attack: 2,
          health: 2
        })
      else expect(f.player().board).toHaveLength(count + 1)
    })
    it(`${weapon} does not trigger when attack is cancelled by lethal Secret damage`, () => {
      const f = fixture()
      f.play('mean_streets_of_gadgetzan_' + weapon)
      const wisp = f.add('classic_wisp')
      f.end()
      f.play('classic_explosive_trap', [], f.foe)
      f.end(f.foe)
      f.command({ type: 'dev-set-hero', participantId: f.me, health: 1 })
      f.attack()
      expect(f.player().board).toHaveLength(0)
      expect(
        f.player().hand.find((c) => c.instanceId === wisp)?.enchantments ?? []
      ).toHaveLength(0)
    })
  }
  it('Frostcaller does not trigger for countered spells', () => {
    const f = fixture()
    f.summon('whispers_of_the_old_gods_demented_frostcaller')
    f.end()
    f.play('classic_counterspell', [], f.foe)
    f.end(f.foe)
    f.play('basic_fireball', [{ kind: 'hero', participantId: f.foe }])
    expect(f.player(f.foe).hero.frozenUntilTurn).toBeNull()
  })
  it('Burglebot does not draw after simultaneous lethal combat', () => {
    const f = fixture()
    const bot = f.summon('mean_streets_of_gadgetzan_wind_up_burglebot')
    f.cycle()
    const foe = f.summon('mean_streets_of_gadgetzan_wind_up_burglebot', f.foe)
    const count = f.player().hand.length
    f.attack(bot, foe)
    expect(f.player().hand).toHaveLength(count)
    expect(f.player().board).toHaveLength(0)
    expect(f.player(f.foe).board).toHaveLength(0)
  })
  it('Envenom does not poison through Divine Shield', () => {
    const f = fixture()
    f.play('basic_fiery_war_axe')
    f.play('journey_to_ungoro_envenom_weapon')
    const squire = f.summon('classic_argent_squire', f.foe)
    f.attack(undefined, squire)
    expect(f.player(f.foe).board[0]).toMatchObject({ health: 1, divineShield: false })
  })
})
