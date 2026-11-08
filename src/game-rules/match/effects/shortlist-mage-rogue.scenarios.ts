import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, cardHasClass, cardHasTribe } from '../../content/cards'
import { createOpeningMatchFromCheckpoint } from '../opening-match'
import { createAiFixture, type AiFixtureOptions } from '../testing/ai-scenario-builder'

const ids = {
  aluneth: 'kobolds_and_catacombs_aluneth',
  mysteries: 'saviors_of_uldum_ancient_mysteries',
  flakmage: 'saviors_of_uldum_arcane_flakmage',
  prince: 'saviors_of_uldum_cloud_prince',
  ward: 'saviors_of_uldum_flame_ward',
  conjurer: 'madness_at_the_darkmoon_faire_occult_conjurer',
  click: 'voyage_to_the_sunken_city_click_clocker',
  automaton: 'voyage_to_the_sunken_city_security_automaton',
  shark: 'voyage_to_the_sunken_city_mecha_shark',
  gateway: 'voyage_to_the_sunken_city_seafloor_gateway',
  mecharoo: 'the_boomsday_project_mecharoo',
  galvanizer: 'the_boomsday_project_galvanizer',
  thug: 'the_witchwood_hench_clan_thug',
  plunderer: 'madness_at_the_darkmoon_faire_prize_plunderer',
  party: 'rastakhans_rumble_raiding_party',
  cutting: 'scholomance_academy_cutting_class',
  bot: 'the_boomsday_project_jo_e_bot'
}
const wisp = 'classic_wisp'
const yeti = 'basic_chillwind_yeti'
const secret = 'classic_counterspell'
function setup(options: Partial<AiFixtureOptions> = {}) {
  const fixture = createAiFixture({
    seed: 7201,
    aiHeroId: 'jaina',
    opponentHeroId: 'garrosh',
    aiMana: 10,
    aiMaximumMana: 10,
    aiDeck: [wisp, wisp, wisp, wisp],
    opponentDeck: [wisp, wisp],
    ...options
  })
  const match = createOpeningMatchFromCheckpoint(fixture.checkpoint)
  const own = fixture.aiParticipantId
  const enemy = fixture.localParticipantId
  const player = (id = own) =>
    match.getState().players.find((p) => p.participantId === id)!
  const play = (cardId: string, extra: Record<string, unknown> = {}) => {
    const card = player().hand.find((c) => c.cardId === cardId)!
    expect(card, cardId + ' in hand').toBeDefined()
    const result = match.dispatch({
      type: 'play-card',
      participantId: own,
      cardInstanceId: card.instanceId,
      ...(CARD_CATALOG.require(cardId).type === 'Minion'
        ? { position: player().board.length }
        : {}),
      ...extra
    })
    if (!result.accepted) throw new Error(result.message)
    return result
  }
  const end = (participantId = own) => {
    const result = match.dispatch({ type: 'end-turn', participantId })
    if (!result.accepted) throw new Error(result.message)
    return result
  }
  return { match, own, enemy, player, play, end }
}
type Scenario = ReturnType<typeof setup>
function attack(
  s: Scenario,
  attacker: { kind: 'hero' } | { kind: 'minion'; instanceId: string },
  defender: { kind: 'hero' } | { kind: 'minion'; instanceId: string } = { kind: 'hero' }
) {
  const r = s.match.dispatch({
    type: 'attack-character',
    participantId: s.own,
    attacker,
    defender
  })
  if (!r.accepted) throw new Error(r.message)
  return r
}
function minionTarget(s: Scenario, index = 0) {
  return {
    kind: 'minion',
    participantId: s.enemy,
    instanceId: s.player(s.enemy).board[index]!.instanceId
  }
}
function effects(r: ReturnType<Scenario['play']>, source: string, action: string) {
  return r.events.filter(
    (e) =>
      e.type === 'effect-resolved' && e.sourceCardId === source && e.action === action
  )
}

describe('Selected Mage/Rogue content metadata', () => {
  it('registers all sixteen collectible cards and the noncollectible Jo-E Bot', () => {
    for (const [name, id] of Object.entries(ids)) {
      const c = CARD_CATALOG.require(id)
      expect(c.collectible).toBe(name !== 'bot')
      expect(c.deckLegal).toBe(name !== 'bot')
      expect(c.expansionId).toBe('future-past')
    }
    expect(CARD_CATALOG.require(ids.party).cost).toBe(3)
    expect(cardHasClass(CARD_CATALOG.require(ids.cutting), 'Warrior')).toBe(true)
    expect(cardHasClass(CARD_CATALOG.require(ids.cutting), 'Rogue')).toBe(true)
    expect(CARD_CATALOG.require(ids.thug).cardClass).toBe('Neutral')
    for (const id of [ids.mecharoo, ids.shark, ids.click]) {
      expect(cardHasTribe(CARD_CATALOG.require(id), 'Mech')).toBe(true)
      expect(cardHasTribe(CARD_CATALOG.require(id), 'Beast')).toBe(true)
    }
  })
})

describe('Aluneth', () => {
  it('draws three only at its controller end turn and never spends durability', () => {
    const s = setup({ aiHand: [ids.aluneth] })
    s.play(ids.aluneth)
    s.end()
    expect(s.player().hand).toHaveLength(3)
    expect(s.player().weapon).toMatchObject({ attack: 0, durability: 3 })
    s.end(s.enemy)
    expect(s.player().hand).toHaveLength(4) // ordinary next-turn draw only
    expect(s.player().weapon?.durability).toBe(3)
  })
  it('burns draws beyond ten and still removes all three deck cards', () => {
    const s = setup({ aiHand: Array(9).fill(wisp), aiWeapon: { cardId: ids.aluneth } })
    s.end()
    expect(s.player().hand).toHaveLength(10)
    expect(s.player().deck).toHaveLength(1)
  })
  it('applies successive fatigue for all missing draws', () => {
    const s = setup({ aiDeck: [], aiWeapon: { cardId: ids.aluneth } })
    s.end()
    expect(s.player().hero.health).toBe(24)
  })
  it('stops drawing after replacement and does not stack on a second Aluneth', () => {
    const s = setup({ aiHand: [ids.aluneth], aiWeapon: { cardId: ids.aluneth } })
    s.play(ids.aluneth)
    s.end()
    expect(s.player().hand).toHaveLength(3)
    const t = setup({
      aiHand: ['basic_fiery_war_axe'],
      aiWeapon: { cardId: ids.aluneth }
    })
    t.play('basic_fiery_war_axe')
    t.end()
    expect(t.player().hand).toHaveLength(0)
  })
})

describe('Ancient Mysteries and Arcane Flakmage', () => {
  it('draws a Secret, sets only that drawn card to zero, and leaves nonsecrets in deck', () => {
    const s = setup({ aiHand: [ids.mysteries, secret], aiDeck: [wisp, ids.ward] })
    s.play(ids.mysteries)
    expect(s.player().hand.find((c) => c.cardId === ids.ward)?.currentCost).toBe(0)
    expect(s.player().hand.find((c) => c.cardId === secret)?.currentCost).toBe(3)
    expect(s.player().deck.map((c) => c.cardId)).toEqual([wisp])
  })
  it('does not fatigue without a matching Secret, including an empty deck', () => {
    for (const aiDeck of [[], [wisp]]) {
      const s = setup({ aiHand: [ids.mysteries], aiDeck })
      s.play(ids.mysteries)
      expect(s.player().hero.health).toBe(30)
      expect(s.player().hand).toHaveLength(0)
    }
  })
  it('burns the selected Secret when hand is full after a draw trigger fills it', () => {
    // A full hand is maintained by a board Gadgetzan Auctioneer drawing before the spell.
    const s = setup({
      aiHand: [ids.mysteries, ...Array(9).fill(wisp)],
      aiDeck: [wisp, ids.ward],
      aiBoard: [{ cardId: 'classic_gadgetzan_auctioneer' }]
    })
    s.play(ids.mysteries)
    expect(s.player().hand).toHaveLength(10)
    expect(s.player().hand.some((c) => c.cardId === ids.ward)).toBe(false)
    expect(s.player().deck).toHaveLength(0)
  })
  it('damages enemy minions after own Secret play, not heroes or friendly minions', () => {
    const s = setup({
      aiHand: [ids.ward],
      aiBoard: [{ cardId: ids.flakmage }, { cardId: yeti }],
      opponentBoard: [{ cardId: yeti }, { cardId: wisp }]
    })
    const r = s.play(ids.ward)
    expect(s.player().secrets).toHaveLength(1)
    expect(s.player(s.enemy).board).toMatchObject([{ cardId: yeti, health: 3 }])
    expect(s.player().board[1]?.health).toBe(5)
    expect(s.player(s.enemy).hero.health).toBe(30)
    expect(effects(r, ids.flakmage, 'damage')).toHaveLength(2)
  })
  it('does not trigger for ordinary spells or an enemy Secret', () => {
    const s = setup({
      aiHand: ['basic_arcane_intellect', ids.ward],
      opponentBoard: [{ cardId: ids.flakmage }]
    })
    s.play('basic_arcane_intellect')
    s.play(ids.ward)
    expect(s.player().hero.health).toBe(30)
    expect(s.player(s.enemy).board[0]?.health).toBe(2)
  })
})

describe('Cloud Prince and Occult Conjurer', () => {
  it.each([ids.prince, ids.conjurer])(
    '%s is a plain body with no friendly Secret, even if enemy has one',
    (id) => {
      const s = setup({ aiHand: [id], opponentSecrets: [{ cardId: secret }] })
      s.play(id)
      expect(s.player().board).toHaveLength(1)
      expect(s.player(s.enemy).hero.health).toBe(30)
    }
  )
  it('Cloud Prince deals six to a chosen character only with a friendly Secret', () => {
    const s = setup({ aiHand: [ids.prince], aiSecrets: [{ cardId: secret }] })
    s.play(ids.prince, { targets: [{ kind: 'hero', participantId: s.enemy }] })
    expect(s.player(s.enemy).hero.health).toBe(24)
  })
  it('Conjurer copies hand buffs exactly without replaying battlecry or copying forever', () => {
    const s = setup({
      aiHand: [ids.conjurer, 'mean_streets_of_gadgetzan_smugglers_run'],
      aiSecrets: [{ cardId: secret }]
    })
    s.play('mean_streets_of_gadgetzan_smugglers_run')
    s.play(ids.conjurer)
    expect(s.player().board).toHaveLength(2)
    expect(s.player().board.map((c) => [c.attack, c.health])).toEqual([
      [5, 5],
      [5, 5]
    ])
  })
  it('Conjurer respects the seven-minion cap', () => {
    const s = setup({
      aiHand: [ids.conjurer],
      aiSecrets: [{ cardId: secret }],
      aiBoard: Array.from({ length: 6 }, () => ({ cardId: wisp }))
    })
    s.play(ids.conjurer)
    expect(s.player().board).toHaveLength(7)
    expect(s.player().board.filter((c) => c.cardId === ids.conjurer)).toHaveLength(1)
  })
})

describe('Flame Ward', () => {
  it('resolves after minion combat damage, killing attacker but not undoing damage', () => {
    const s = setup({
      aiBoard: [{ cardId: 'basic_bloodfen_raptor', ready: true }, { cardId: yeti }],
      opponentSecrets: [{ cardId: ids.ward }]
    })
    attack(s, { kind: 'minion', instanceId: s.player().board[0]!.instanceId })
    expect(s.player(s.enemy).hero.health).toBe(27)
    expect(s.player().board).toMatchObject([{ cardId: yeti, health: 2 }])
    expect(s.player(s.enemy).secrets).toHaveLength(0)
  })
  it('does not save a hero from lethal combat', () => {
    const s = setup({
      aiBoard: [{ cardId: 'basic_bloodfen_raptor', ready: true }],
      opponentHealth: 3,
      opponentSecrets: [{ cardId: ids.ward }]
    })
    attack(s, { kind: 'minion', instanceId: s.player().board[0]!.instanceId })
    expect(s.player(s.enemy).hero.health).toBe(0)
    expect(s.player().board).toHaveLength(1)
  })
  it('ignores hero attacks, minion-to-minion attacks, and spell damage', () => {
    const s = setup({
      aiHand: ['classic_moonfire'],
      aiWeapon: { cardId: 'basic_fiery_war_axe' },
      aiBoard: [{ cardId: yeti, ready: true }],
      opponentBoard: [{ cardId: yeti }],
      opponentSecrets: [{ cardId: ids.ward }]
    })
    attack(s, { kind: 'hero' })
    attack(
      s,
      { kind: 'minion', instanceId: s.player().board[0]!.instanceId },
      { kind: 'minion', instanceId: s.player(s.enemy).board[0]!.instanceId }
    )
    s.play('classic_moonfire', { targets: [{ kind: 'hero', participantId: s.enemy }] })
    expect(s.player(s.enemy).secrets).toHaveLength(1)
  })
})

describe('Mech hand effects and deathrattle', () => {
  it('Click-Clocker grants exactly one random friendly hand Mech +1/+1 and has Divine Shield', () => {
    const s = setup({
      aiHand: [ids.click, ids.mecharoo, ids.galvanizer, yeti],
      aiBoard: [{ cardId: ids.mecharoo }]
    })
    s.play(ids.click)
    const mechs = s
      .player()
      .hand.filter((c) => [ids.mecharoo, ids.galvanizer].includes(c.cardId))
    expect(mechs.map((c) => c.attack ?? 1).sort()).toEqual([1, 2])
    expect(s.player().hand.find((c) => c.cardId === yeti)?.attack ?? 4).toBe(4)
    expect(s.player().board[0]?.attack).toBe(1)
    expect(s.player().board[1]?.divineShield).toBe(true)
  })
  it('Click-Clocker without another Mech is a safe no-op', () => {
    const s = setup({ aiHand: [ids.click, wisp] })
    s.play(ids.click)
    expect(s.player().board[0]).toMatchObject({ attack: 1, health: 1 })
  })
  it('Mecharoo summons one noncollectible 1/1 Mech after death', () => {
    const s = setup({
      aiHand: ['classic_moonfire'],
      opponentBoard: [{ cardId: ids.mecharoo }]
    })
    s.play('classic_moonfire', { targets: [minionTarget(s)] })
    expect(s.player(s.enemy).board).toMatchObject([
      { cardId: ids.bot, attack: 1, health: 1 }
    ])
  })
  it('Galvanizer discounts only Mechs currently in hand, stacking with a zero floor', () => {
    const s = setup({
      aiHand: [ids.galvanizer, ids.galvanizer, ids.mecharoo, yeti],
      aiDeck: [ids.mecharoo]
    })
    s.play(ids.galvanizer)
    s.play(ids.galvanizer)
    expect(s.player().hand.find((c) => c.cardId === ids.mecharoo)?.currentCost).toBe(0)
    expect(s.player().hand.find((c) => c.cardId === yeti)?.currentCost).toBe(4)
    expect(s.player().deck[0]?.currentCost).toBe(1)
    expect(s.player().board.map((c) => c.attack)).toEqual([1, 1])
  })
  it('Gateway draws exactly one Mech, then discounts it and previously held Mechs', () => {
    const s = setup({
      aiHand: [ids.gateway, ids.shark, yeti],
      aiDeck: [ids.mecharoo, ids.mecharoo, wisp]
    })
    s.play(ids.gateway)
    expect(s.player().hand.find((c) => c.cardId === ids.shark)?.currentCost).toBe(2)
    expect(s.player().hand.find((c) => c.cardId === ids.mecharoo)?.currentCost).toBe(0)
    expect(s.player().hand.find((c) => c.cardId === yeti)?.currentCost).toBe(4)
    expect(s.player().deck).toHaveLength(2)
    expect(s.player().deck.find((c) => c.cardId === ids.mecharoo)?.currentCost).toBe(1)
  })
  it('Gateway still discounts hand Mechs without a matching deck card and does not fatigue', () => {
    const s = setup({ aiHand: [ids.gateway, ids.mecharoo], aiDeck: [] })
    s.play(ids.gateway)
    expect(s.player().hero.health).toBe(30)
    expect(s.player().hand[0]?.currentCost).toBe(0)
  })
})

describe('Security Automaton and Mecha-Shark summon triggers', () => {
  it('does not trigger on its own arrival, but triggers on played friendly Mechs', () => {
    const s = setup({ aiHand: [ids.automaton, ids.mecharoo, wisp] })
    s.play(ids.automaton)
    expect(s.player().board[0]).toMatchObject({ attack: 1, health: 3 })
    s.play(ids.mecharoo)
    s.play(wisp)
    expect(s.player().board[0]).toMatchObject({ attack: 2, health: 4 })
  })
  it('triggers on a deathrattle summon as well as play, not an enemy summon', () => {
    const s = setup({
      aiHand: [ids.mecharoo, 'classic_moonfire'],
      aiBoard: [{ cardId: ids.automaton }],
      opponentBoard: [{ cardId: ids.automaton }]
    })
    s.play(ids.mecharoo)
    s.play('classic_moonfire', {
      targets: [
        {
          kind: 'minion',
          participantId: s.own,
          instanceId: s.player().board[1]!.instanceId
        }
      ]
    })
    expect(s.player().board[0]).toMatchObject({ attack: 3, health: 5 })
    expect(s.player().board[1]?.cardId).toBe(ids.bot)
    expect(s.player(s.enemy).board[0]).toMatchObject({ attack: 1, health: 3 })
  })
  it('Shark emits three individual damage hits, excluding itself and non-Mechs', () => {
    const s = setup({ aiHand: [ids.shark, wisp, ids.mecharoo] })
    s.play(ids.shark)
    s.play(wisp)
    expect(s.player(s.enemy).hero.health).toBe(30)
    const r = s.play(ids.mecharoo)
    expect(s.player(s.enemy).hero.health).toBe(27)
    expect(effects(r, ids.shark, 'damage')).toHaveLength(3)
  })
  it('Shark resolves deaths between hits and reselects living enemy targets deterministically', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = setup({
        seed,
        aiHand: [ids.mecharoo],
        aiBoard: [{ cardId: ids.shark }],
        opponentBoard: [{ cardId: wisp }]
      })
      const r = s.play(ids.mecharoo)
      expect(effects(r, ids.shark, 'damage')).toHaveLength(3)
      const damage =
        30 -
        s.player(s.enemy).hero.health +
        (s.player(s.enemy).board.length === 0 ? 1 : 0)
      expect(damage).toBe(3)
    }
  })
})

describe('Rogue weapon and combo effects', () => {
  it('Hench-Clan Thug grows after hero attacks, not friendly minion attacks', () => {
    const s = setup({
      aiWeapon: { cardId: 'basic_fiery_war_axe' },
      aiBoard: [{ cardId: ids.thug, ready: true }]
    })
    attack(s, { kind: 'minion', instanceId: s.player().board[0]!.instanceId })
    expect(s.player().board[0]).toMatchObject({ attack: 3, health: 3 })
    attack(s, { kind: 'hero' })
    expect(s.player().board[0]).toMatchObject({ attack: 4, health: 4 })
  })
  it('Thug also triggers for temporary hero Attack without a weapon', () => {
    const s = setup({ aiAttack: 1, aiBoard: [{ cardId: ids.thug }] })
    attack(s, { kind: 'hero' })
    expect(s.player().board[0]).toMatchObject({ attack: 4, health: 4 })
  })
  it('Prize Plunderer without Combo is a body without required target', () => {
    const s = setup({ aiHand: [ids.plunderer], opponentBoard: [{ cardId: yeti }] })
    s.play(ids.plunderer)
    expect(s.player(s.enemy).board[0]?.health).toBe(5)
  })
  it('Prize Plunderer counts only earlier cards, not itself or summoned minions', () => {
    const s = setup({
      aiHand: [wisp, wisp, ids.plunderer],
      opponentBoard: [{ cardId: yeti }]
    })
    s.play(wisp)
    s.play(wisp)
    s.play(ids.plunderer, { targets: [minionTarget(s)] })
    expect(s.player(s.enemy).board[0]?.health).toBe(3)
  })
  it.each([false, true])(
    'Raiding Party draws two Pirates and a weapon only with Combo=%s',
    (combo) => {
      const s = setup({
        aiHand: [...(combo ? [wisp] : []), ids.party],
        aiDeck: [ids.plunderer, 'classic_bloodsail_raider', 'basic_fiery_war_axe', yeti]
      })
      if (combo) s.play(wisp)
      s.play(ids.party)
      expect(
        s
          .player()
          .hand.map((c) => c.cardId)
          .sort()
      ).toEqual(
        [
          ids.plunderer,
          'classic_bloodsail_raider',
          ...(combo ? ['basic_fiery_war_axe'] : [])
        ].sort()
      )
      expect(
        s
          .player()
          .deck.map((c) => c.cardId)
          .sort()
      ).toEqual([yeti, ...(combo ? [] : ['basic_fiery_war_axe'])].sort())
    }
  )
  it('Raiding Party handles a depleted matching pool without fatigue', () => {
    const s = setup({ aiHand: [wisp, ids.party], aiDeck: [ids.plunderer] })
    s.play(wisp)
    s.play(ids.party)
    expect(s.player().hand.map((c) => c.cardId)).toEqual([ids.plunderer])
    expect(s.player().hero.health).toBe(30)
  })
  it.each([0, 3, 7])(
    'Cutting Class costs max(0,5-weapon Attack) for Attack %i and draws two',
    (attack) => {
      const s = setup({
        aiHand: [ids.cutting],
        ...(attack
          ? {
              aiWeapon: {
                cardId: attack === 7 ? 'classic_gorehowl' : 'basic_fiery_war_axe'
              }
            }
          : {})
      })
      const before = s.player().mana.available
      s.play(ids.cutting)
      expect(s.player().mana.available).toBe(before - Math.max(0, 5 - attack))
      expect(s.player().hand).toHaveLength(2)
    }
  )
  it('Cutting Class ignores temporary hero Attack and tracks weapon replacement', () => {
    const s = setup({ aiHand: [ids.cutting, 'basic_fiery_war_axe'], aiAttack: 8 })
    expect(s.player().hand.find((c) => c.cardId === ids.cutting)?.currentCost).toBe(5)
    s.play('basic_fiery_war_axe')
    s.play(ids.cutting)
    expect(s.player().mana.available).toBe(6) // Selected existing 2-mana axe + 2-mana draw
  })
})

describe('Additional sequencing and zone boundaries', () => {
  it('a countered Secret never reaches Flakmage after-play triggers', () => {
    const s = setup({
      aiHand: [ids.ward],
      aiBoard: [{ cardId: ids.flakmage }],
      opponentSecrets: [{ cardId: secret }],
      opponentBoard: [{ cardId: yeti }]
    })
    const r = s.play(ids.ward)
    expect(s.player().secrets).toHaveLength(0)
    expect(s.player(s.enemy).board[0]?.health).toBe(5)
    expect(effects(r, ids.flakmage, 'damage')).toHaveLength(0)
  })
  it('putting a Secret into play through Mad Scientist does not trigger Flakmage', () => {
    const s = setup({
      aiHand: ['classic_moonfire'],
      aiDeck: [ids.ward],
      aiBoard: [
        { cardId: ids.flakmage },
        { cardId: 'naxxramas_mad_scientist', health: 1, maxHealth: 2 }
      ],
      opponentBoard: [{ cardId: yeti }]
    })
    const r = s.play('classic_moonfire', {
      targets: [
        {
          kind: 'minion',
          participantId: s.own,
          instanceId: s.player().board[1]!.instanceId
        }
      ]
    })
    expect(s.player().secrets).toHaveLength(1)
    expect(s.player(s.enemy).board[0]?.health).toBe(5)
    expect(effects(r, ids.flakmage, 'damage')).toHaveLength(0)
  })
  it('Flakmage damage resolves before resulting Loot Hoarder deathrattle draw', () => {
    const s = setup({
      aiHand: [ids.ward],
      aiBoard: [{ cardId: ids.flakmage }],
      opponentBoard: [{ cardId: 'classic_loot_hoarder' }]
    })
    const r = s.play(ids.ward)
    expect(s.player().secrets?.[0]?.cardId).toBe(ids.ward)
    const damageIndex = r.events.findIndex(
      (e) =>
        e.type === 'effect-resolved' &&
        e.sourceCardId === ids.flakmage &&
        e.action === 'damage'
    )
    const deathDrawIndex = r.events.findIndex(
      (e) => e.type === 'card-drawn' && e.participantId === s.enemy
    )
    expect(damageIndex).toBeGreaterThanOrEqual(0)
    expect(deathDrawIndex).toBeGreaterThan(damageIndex)
    expect(s.player(s.enemy).hand).toHaveLength(1)
  })
  it('Flame Ward gains damage from defending controller Spell Damage', () => {
    const s = setup({
      aiBoard: [{ cardId: yeti, ready: true }],
      opponentBoard: [{ cardId: 'basic_kobold_geomancer' }],
      opponentSecrets: [{ cardId: ids.ward }]
    })
    attack(s, { kind: 'minion', instanceId: s.player().board[0]!.instanceId })
    expect(s.player().board[0]?.health).toBe(1)
  })
  it('Mecharoo replaces itself on a full seven-minion board without exceeding the cap', () => {
    const s = setup({
      aiHand: ['classic_moonfire'],
      opponentBoard: [
        { cardId: ids.mecharoo },
        ...Array.from({ length: 6 }, () => ({ cardId: wisp }))
      ]
    })
    s.play('classic_moonfire', { targets: [minionTarget(s)] })
    expect(s.player(s.enemy).board).toHaveLength(7)
    expect(s.player(s.enemy).board.filter((c) => c.cardId === ids.bot)).toHaveLength(1)
  })
  it('summoning Conjurer directly does not replay its battlecry', () => {
    const s = setup({ aiSecrets: [{ cardId: secret }] })
    const r = s.match.dispatch({
      type: 'dev-summon-minion',
      participantId: s.own,
      cardId: ids.conjurer
    })
    expect(r.accepted).toBe(true)
    expect(s.player().board).toMatchObject([{ cardId: ids.conjurer }])
  })
  it('summoning Click-Clocker directly never buffs hand Mechs', () => {
    const s = setup({ aiHand: [ids.mecharoo] })
    const r = s.match.dispatch({
      type: 'dev-summon-minion',
      participantId: s.own,
      cardId: ids.click
    })
    expect(r.accepted).toBe(true)
    s.play(ids.mecharoo)
    expect(s.player().board[1]).toMatchObject({ attack: 1, health: 1 })
  })
  it('Mecha-Shark skips mortally wounded targets and processes deathrattles after its volley', () => {
    let witnessedDeath = false
    for (let seed = 1; seed <= 30; seed++) {
      const s = setup({
        seed,
        aiHand: [ids.mecharoo],
        aiBoard: [{ cardId: ids.shark }],
        opponentBoard: [{ cardId: ids.mecharoo }]
      })
      const r = s.play(ids.mecharoo)
      const damages = effects(r, ids.shark, 'damage')
      expect(damages).toHaveLength(3)
      if (s.player(s.enemy).board[0]?.cardId === ids.bot) {
        witnessedDeath = true
        expect(s.player(s.enemy).hero.health).toBe(28)
        expect(s.player(s.enemy).board[0]?.health).toBe(1)
        expect(
          r.events.findIndex((e) => e.type === 'death-batch-started')
        ).toBeGreaterThan(r.events.indexOf(damages[2]!))
      }
    }
    expect(witnessedDeath).toBe(true)
  })
  it('Mecha-Shark fires for deathrattle summons as well as hand plays', () => {
    const s = setup({
      aiHand: [ids.mecharoo, 'classic_moonfire'],
      aiBoard: [{ cardId: ids.shark }]
    })
    s.play(ids.mecharoo)
    s.play('classic_moonfire', {
      targets: [
        {
          kind: 'minion',
          participantId: s.own,
          instanceId: s.player().board[1]!.instanceId
        }
      ]
    })
    expect(s.player(s.enemy).hero.health).toBe(24)
    expect(s.player().board[1]?.cardId).toBe(ids.bot)
  })
  it('Prize Plunderer excludes summoned minions from the earlier-card count', () => {
    const s = setup({
      aiHand: ['basic_mirror_image', ids.plunderer],
      opponentBoard: [{ cardId: yeti }]
    })
    s.play('basic_mirror_image')
    expect(s.player().board).toHaveLength(2)
    s.play(ids.plunderer, { targets: [minionTarget(s)] })
    expect(s.player(s.enemy).board[0]?.health).toBe(4)
  })
  it('Raiding Party overdraw burns excess matching cards but leaves nonmatching cards', () => {
    const s = setup({
      aiHand: [ids.party, ...Array(9).fill(wisp)],
      aiDeck: [ids.plunderer, 'classic_bloodsail_raider', yeti]
    })
    s.play(ids.party)
    expect(s.player().hand).toHaveLength(10)
    expect(s.player().deck.map((c) => c.cardId)).toEqual([yeti])
  })
  it('Cutting Class loses its weapon discount when the last durability is spent', () => {
    const s = setup({
      aiHand: [ids.cutting],
      aiWeapon: { cardId: 'basic_fiery_war_axe', durability: 1 }
    })
    attack(s, { kind: 'hero' })
    expect(s.player().weapon).toBeNull()
    s.play(ids.cutting)
    expect(s.player().mana.available).toBe(5)
  })
  it('Cutting Class ordinary draws fatigue on an empty deck', () => {
    const s = setup({ aiHand: [ids.cutting], aiDeck: [] })
    s.play(ids.cutting)
    expect(s.player().hero.health).toBe(27)
  })
})

describe('Mecha-Shark damage-reaction timing', () => {
  it('can hit an Imp created by an earlier on-damage reaction in the same volley', () => {
    let witnessedImpHit = false
    for (let seed = 1; seed <= 30; seed++) {
      const s = setup({
        seed,
        aiHand: [ids.mecharoo],
        aiBoard: [{ cardId: ids.shark }],
        opponentBoard: [{ cardId: 'blackrock_mountain_imp_gang_boss' }]
      })
      const boss = s.player(s.enemy).board[0]!
      const r = s.play(ids.mecharoo)
      const damages = effects(r, ids.shark, 'damage')
      expect(damages).toHaveLength(3)
      for (const event of damages) {
        if (
          event.type === 'effect-resolved' &&
          event.data?.target !== boss.instanceId &&
          event.data?.target !== `${s.enemy}:hero`
        ) {
          witnessedImpHit = true
          expect(event.data?.actualDamage).toBe(1)
        }
      }
    }
    expect(witnessedImpHit).toBe(true)
  })
})
