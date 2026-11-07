import { describe, expect, it } from 'vitest'
import { CARD_CATALOG } from '../../content/cards'
import { createOpeningMatchFromCheckpoint } from '../opening-match'
import { createMatchScenario } from '../testing/match-scenario-builder'

type Scenario = ReturnType<typeof createMatchScenario>
const ids = {
  dusk: 'kobolds_and_catacombs_duskbreaker',
  light: 'murder_at_castle_nathria_the_light_it_burns',
  skipper: 'galakronds_awakening_risky_skipper',
  wrangler: 'galakronds_awakening_bomb_wrangler',
  vapor: 'forged_in_the_barrens_wailing_vapor',
  granite: 'united_in_stormwind_granite_forgeborn',
  slogger: 'united_in_stormwind_canal_slogger',
  librarian: 'kobolds_and_catacombs_kobold_librarian',
  lackey: 'kobolds_and_catacombs_possessed_lackey',
  voidlord: 'kobolds_and_catacombs_voidlord',
  skull: 'kobolds_and_catacombs_skull_of_the_man_ari',
  godfrey: 'the_witchwood_lord_godfrey'
}
function player(s: Scenario, id: string) {
  return s.match.getState().players.find((p) => p.participantId === id)!
}
function command(s: Scenario, c: Parameters<Scenario['match']['dispatch']>[0]) {
  const r = s.match.dispatch(c)
  expect(r.accepted, r.accepted ? undefined : r.message).toBe(true)
  if (!r.accepted) throw new Error(r.message)
  return r
}
function ready(cardId?: string) {
  const s = createMatchScenario({ seed: 9402, cardId })
  s.confirmBothMulligans()
  const own = s.match.getState().activePlayerId!,
    enemy = s.participants.find((p) => p !== own)!
  for (const participantId of s.participants)
    command(s, { type: 'dev-clear-zone', participantId, zone: 'hand' })
  return { s, own, enemy }
}
function add(s: Scenario, own: string, cardId: string) {
  command(s, { type: 'dev-add-card', participantId: own, cardId })
}
function summon(s: Scenario, own: string, cardId: string) {
  command(s, { type: 'dev-summon-minion', participantId: own, cardId })
  return player(s, own).board.at(-1)!
}
function play(
  s: Scenario,
  own: string,
  cardId: string,
  target?: { kind: 'minion'; instanceId: string }
) {
  command(s, { type: 'dev-set-mana', participantId: own, available: 10, maximum: 10 })
  add(s, own, cardId)
  const card = player(s, own).hand.at(-1)!
  return command(s, {
    type: 'play-card',
    participantId: own,
    cardInstanceId: card.instanceId,
    ...(CARD_CATALOG.get(cardId)?.type === 'Minion'
      ? { position: player(s, own).board.length }
      : {}),
    ...(target
      ? {
          targets: [
            {
              ...target,
              participantId: s.match
                .getState()
                .players.find((p) =>
                  p.board.some((m) => m.instanceId === target.instanceId)
                )!.participantId
            }
          ]
        }
      : {})
  })
}
function hit(s: Scenario, own: string, instanceId: string, card = 'classic_moonfire') {
  return play(s, own, card, { kind: 'minion', instanceId })
}
function cycle(s: Scenario, own: string, enemy: string) {
  command(s, { type: 'end-turn', participantId: own })
  command(s, { type: 'end-turn', participantId: enemy })
}

describe('shortlist: Priest, Warrior, Shaman, Warlock', () => {
  it('Duskbreaker requires another Dragon in hand, excludes itself, and damages both boards', () => {
    const { s, own, enemy } = ready()
    summon(s, enemy, 'basic_chillwind_yeti')
    play(s, own, ids.dusk)
    expect(player(s, enemy).board[0].health).toBe(5)
    add(s, own, 'classic_faerie_dragon')
    play(s, own, ids.dusk)
    expect(player(s, own).board).toMatchObject([{ cardId: ids.dusk, health: 3 }])
    expect(player(s, enemy).board[0].health).toBe(2)
  })
  it.each([
    ['basic_chillwind_yeti', 1],
    ['classic_silvermoon_guardian', 3]
  ])('Light uses target Attack and respects shields: %s', (card, health) => {
    const { s, own, enemy } = ready()
    const target = summon(s, enemy, card)
    hit(s, own, target.instanceId, ids.light)
    expect(player(s, enemy).board[0].health).toBe(health)
    expect(player(s, enemy).board[0].divineShield).toBe(false)
  })
  it('Light includes spell damage and allows friendly targets', () => {
    const { s, own } = ready()
    summon(s, own, 'basic_kobold_geomancer')
    const target = summon(s, own, 'basic_chillwind_yeti')
    hit(s, own, target.instanceId, ids.light)
    expect(player(s, own).board.map((m) => m.cardId)).toEqual([
      'basic_kobold_geomancer'
    ])
  })
  it('Skipper triggers on another played minion, never itself or summons', () => {
    const { s, own, enemy } = ready()
    summon(s, enemy, 'basic_chillwind_yeti')
    play(s, own, ids.skipper)
    expect(player(s, own).board[0].health).toBe(3)
    summon(s, own, 'basic_chillwind_yeti')
    expect(player(s, own).board[0].health).toBe(3)
    play(s, own, 'basic_chillwind_yeti')
    expect(player(s, own).board.map((m) => m.health)).toEqual([2, 4, 4])
    expect(player(s, enemy).board[0].health).toBe(4)
  })
  it.each(['classic_moonfire', 'basic_fireball'])(
    'Wrangler summons on nonlethal and lethal damage: %s',
    (spell) => {
      const { s, own } = ready()
      const target = summon(s, own, ids.wrangler)
      hit(s, own, target.instanceId, spell)
      expect(
        player(s, own).board.filter((m) => m.cardId === 'goblins_vs_gnomes_boom_bot')
      ).toHaveLength(1)
      expect(player(s, own).board.some((m) => m.cardId === ids.wrangler)).toBe(
        spell === 'classic_moonfire'
      )
    }
  )
  it('Wrangler cannot summon onto a full board before its lethal removal', () => {
    const { s, own } = ready()
    const target = summon(s, own, ids.wrangler)
    for (let i = 0; i < 6; i++) summon(s, own, 'basic_chillwind_yeti')
    hit(s, own, target.instanceId, 'basic_fireball')
    expect(player(s, own).board).toHaveLength(6)
    expect(
      player(s, own).board.some((m) => m.cardId === 'goblins_vs_gnomes_boom_bot')
    ).toBe(false)
  })
  it('Vapor grows only for another friendly Elemental played, not summoned', () => {
    const { s, own } = ready()
    play(s, own, ids.vapor)
    expect(player(s, own).board[0].attack).toBe(1)
    summon(s, own, ids.vapor)
    play(s, own, 'basic_chillwind_yeti')
    expect(player(s, own).board[0].attack).toBe(1)
    play(s, own, ids.vapor)
    expect(player(s, own).board.map((m) => m.attack)).toEqual([2, 2, 4, 1])
  })
  it('Granite discounts existing hand and deck Elementals, not other or future cards', () => {
    const { s, own } = ready(ids.slogger)
    add(s, own, ids.slogger)
    add(s, own, 'basic_chillwind_yeti')
    play(s, own, ids.granite)
    expect(player(s, own).hand.map((c) => c.currentCost)).toEqual([3, 4])
    expect(player(s, own).deck.every((c) => c.currentCost === 3)).toBe(true)
    add(s, own, ids.slogger)
    expect(player(s, own).hand.at(-1)!.currentCost).toBe(4)
    command(s, { type: 'dev-draw', participantId: own })
    expect(player(s, own).hand.at(-1)!.currentCost).toBe(3)
  })
  it('Slogger has Rush, Lifesteal, and locks one mana next turn', () => {
    const { s, own, enemy } = ready()
    command(s, { type: 'dev-set-hero', participantId: own, health: 20 })
    const target = summon(s, enemy, 'basic_chillwind_yeti')
    play(s, own, ids.slogger)
    const slogger = player(s, own).board[0]
    expect(
      s.match.dispatch({
        type: 'attack-character',
        participantId: own,
        attacker: { kind: 'minion', instanceId: slogger.instanceId },
        defender: { kind: 'hero' }
      }).accepted
    ).toBe(false)
    command(s, {
      type: 'attack-character',
      participantId: own,
      attacker: { kind: 'minion', instanceId: slogger.instanceId },
      defender: { kind: 'minion', instanceId: target.instanceId }
    })
    expect(player(s, own).hero.health).toBe(26)
    expect(player(s, own).mana.overloadNextTurn).toBe(1)
    cycle(s, own, enemy)
    expect(player(s, own).mana.overloadLocked).toBe(1)
  })
  it.each([false, true])(
    'Librarian draws before self-damage, including fatigue=%s',
    (empty) => {
      const { s, own } = ready()
      if (empty)
        command(s, { type: 'dev-modify-deck', participantId: own, action: 'destroy' })
      const deckBefore = player(s, own).deck.length
      const result = play(s, own, ids.librarian)
      if (!empty) {
        const draw = result.events.findIndex((event) => event.type === 'card-drawn')
        const damage = result.events.findIndex(
          (event) =>
            event.type === 'effect-resolved' &&
            event.action === 'damage' &&
            event.sourceCardId === ids.librarian
        )
        expect(draw).toBeGreaterThanOrEqual(0)
        expect(damage).toBeGreaterThan(draw)
      }
      expect(player(s, own).hero.health).toBe(empty ? 27 : 28)
      expect(player(s, own).hand).toHaveLength(empty ? 0 : 1)
      expect(player(s, own).deck).toHaveLength(empty ? 0 : deckBefore - 1)
    }
  )
  it('Lackey recruits exactly one Demon from deck without its battlecry', () => {
    const { s, own } = ready('classic_flame_imp')
    const before = player(s, own).deck.length
    const lackey = summon(s, own, ids.lackey)
    hit(s, own, lackey.instanceId, 'basic_fireball')
    expect(player(s, own).board).toMatchObject([{ cardId: 'classic_flame_imp' }])
    expect(player(s, own).deck).toHaveLength(before - 1)
    expect(player(s, own).hero.health).toBe(30)
  })
  it('Lackey with no Demons leaves its deck unchanged', () => {
    const { s, own } = ready()
    const before = player(s, own).deck.length
    const lackey = summon(s, own, ids.lackey)
    hit(s, own, lackey.instanceId, 'basic_fireball')
    expect(player(s, own).board).toHaveLength(0)
    expect(player(s, own).deck).toHaveLength(before)
  })
  it('Voidlord summons three exact Taunt Demons', () => {
    const { s, own } = ready()
    const lord = summon(s, own, ids.voidlord)
    hit(s, own, lord.instanceId, 'classic_siphon_soul')
    expect(player(s, own).board).toHaveLength(3)
    for (const m of player(s, own).board)
      expect(m).toMatchObject({
        cardId: 'basic_voidwalker',
        attack: 1,
        health: 3,
        keywords: ['taunt']
      })
  })
  it('Voidlord caps summons at available slots', () => {
    const { s, own } = ready()
    const lord = summon(s, own, ids.voidlord)
    for (let i = 0; i < 5; i++) summon(s, own, 'basic_chillwind_yeti')
    hit(s, own, lord.instanceId, 'classic_siphon_soul')
    expect(player(s, own).board).toHaveLength(7)
    expect(
      player(s, own).board.filter((m) => m.cardId === 'basic_voidwalker')
    ).toHaveLength(2)
  })
  it('Skull summons from hand at own start without battlecry or durability loss', () => {
    const { s, own, enemy } = ready()
    play(s, own, ids.skull)
    add(s, own, 'classic_flame_imp')
    expect(player(s, own).board).toHaveLength(0)
    cycle(s, own, enemy)
    expect(player(s, own).board).toMatchObject([{ cardId: 'classic_flame_imp' }])
    expect(player(s, own).hero.health).toBe(30)
    expect(player(s, own).weapon?.durability).toBe(3)
    expect(player(s, own).hand.some((c) => c.cardId === 'classic_flame_imp')).toBe(
      false
    )
  })
  it.each([false, true])(
    'Skull does not consume cards with empty pool/full board=%s',
    (full) => {
      const { s, own, enemy } = ready()
      play(s, own, ids.skull)
      if (full) {
        add(s, own, 'classic_flame_imp')
        for (let i = 0; i < 7; i++) summon(s, own, 'basic_chillwind_yeti')
      }
      cycle(s, own, enemy)
      expect(player(s, own).board).toHaveLength(full ? 7 : 0)
      expect(player(s, own).hand.some((c) => c.cardId === 'classic_flame_imp')).toBe(
        full
      )
    }
  )
  it('Godfrey stops after a wave without deaths and excludes himself', () => {
    const { s, own, enemy } = ready()
    summon(s, enemy, 'basic_chillwind_yeti')
    play(s, own, ids.godfrey)
    expect(player(s, enemy).board[0].health).toBe(3)
    expect(player(s, own).board[0].health).toBe(4)
  })
  it('Godfrey resolves deathrattle spawns between waves and repeats until none die', () => {
    const { s, own, enemy } = ready()
    summon(s, enemy, 'naxxramas_haunted_creeper')
    summon(s, enemy, 'basic_boulderfist_ogre')
    play(s, own, ids.godfrey)
    expect(player(s, enemy).board).toMatchObject([
      { cardId: 'basic_boulderfist_ogre', health: 1 }
    ])
    expect(player(s, own).board[0].health).toBe(4)
  })
  it('Light uses buffed Attack and zero Attack causes no damage', () => {
    const { s, own } = ready()
    const target = summon(s, own, 'basic_chillwind_yeti')
    hit(s, own, target.instanceId, 'basic_blessing_of_might')
    hit(s, own, target.instanceId, ids.light)
    expect(player(s, own).board).toHaveLength(0)
    const zero = summon(s, own, 'classic_shieldbearer')
    hit(s, own, zero.instanceId, ids.light)
    expect(player(s, own).board[0].health).toBe(4)
  })
  it('Lackey on a full board recruits into the slot freed by its own death', () => {
    const { s, own } = ready('classic_flame_imp')
    const lackey = summon(s, own, ids.lackey)
    for (let i = 0; i < 6; i++) summon(s, own, 'basic_chillwind_yeti')
    hit(s, own, lackey.instanceId, 'basic_fireball')
    expect(player(s, own).board).toHaveLength(7)
    expect(
      player(s, own).board.filter((m) => m.cardId === 'classic_flame_imp')
    ).toHaveLength(1)
  })
  it('simultaneously dying Voidlords resolve in play order and share the seven slots', () => {
    const { s, own } = ready()
    const first = summon(s, own, ids.voidlord)
    const second = summon(s, own, ids.voidlord)
    summon(s, own, 'basic_chillwind_yeti')
    summon(s, own, 'basic_chillwind_yeti')
    const result = play(s, own, 'classic_twisting_nether')
    const summons = result.events.filter(
      (event) =>
        event.type === 'effect-resolved' &&
        event.action === 'summon' &&
        event.sourceCardId === ids.voidlord
    )
    expect(
      summons.map((event) =>
        event.type === 'effect-resolved' ? event.sourceInstanceId : undefined
      )
    ).toEqual([
      first.instanceId,
      first.instanceId,
      first.instanceId,
      second.instanceId,
      second.instanceId,
      second.instanceId
    ])
    expect(player(s, own).board).toHaveLength(6)
    expect(player(s, own).board.every((m) => m.cardId === 'basic_voidwalker')).toBe(
      true
    )
  })
  it('Granite discounts stack and never make a one-mana Elemental cost negative', () => {
    const { s, own } = ready(ids.vapor)
    add(s, own, ids.vapor)
    play(s, own, ids.granite)
    play(s, own, ids.granite)
    expect(player(s, own).hand[0].currentCost).toBe(0)
    expect(player(s, own).deck.every((c) => c.currentCost === 0)).toBe(true)
  })

  it.each([
    ['classic_silvermoon_guardian', 20, 20],
    ['classic_wisp', 29, 30],
    ['basic_boulderfist_ogre', 20, 26]
  ])(
    'Slogger healing handles shield, overheal and dying attacker: %s',
    (card, health, expected) => {
      const { s, own, enemy } = ready()
      command(s, { type: 'dev-set-hero', participantId: own, health })
      const target = summon(s, enemy, card)
      play(s, own, ids.slogger)
      command(s, {
        type: 'attack-character',
        participantId: own,
        attacker: { kind: 'minion', instanceId: player(s, own).board[0].instanceId },
        defender: { kind: 'minion', instanceId: target.instanceId }
      })
      expect(player(s, own).hero.health).toBe(expected)
      if (card === 'basic_boulderfist_ogre')
        expect(player(s, own).board).toHaveLength(0)
    }
  )
  it('Slogger deals no damage and gains no healing from an immune target', () => {
    const fixture = ready()
    let s = fixture.s
    const { own, enemy } = fixture
    command(s, { type: 'dev-set-hero', participantId: own, health: 20 })
    const target = summon(s, enemy, 'basic_chillwind_yeti')
    play(s, own, ids.slogger)
    const checkpoint = s.match.getCheckpoint!()
    const players = checkpoint.state.players.map((p) =>
      p.participantId !== enemy
        ? p
        : {
            ...p,
            board: p.board.map((m) => ({
              ...m,
              keywords: [...(m.keywords ?? []), 'immune']
            }))
          }
    ) as unknown as typeof checkpoint.state.players
    s = {
      ...s,
      match: createOpeningMatchFromCheckpoint({
        ...checkpoint,
        state: { ...checkpoint.state, players }
      })
    }
    command(s, { type: 'end-turn', participantId: own })
    command(s, {
      type: 'attack-character',
      participantId: enemy,
      attacker: { kind: 'minion', instanceId: target.instanceId },
      defender: { kind: 'minion', instanceId: player(s, own).board[0].instanceId }
    })
    expect(player(s, own).hero.health).toBe(20)
    expect(player(s, enemy).board[0].health).toBe(5)
  })
})
