import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, cardHasTribe, isCardAllowedForClass } from '../../content/cards'
import { createOpeningMatchFromCheckpoint } from '../opening-match'
import { createAiFixture, type AiFixtureOptions } from '../testing/ai-scenario-builder'

const C = {
  acorn: 'rise_of_shadows_acornbearer',
  squirrel: 'rise_of_shadows_squirrel',
  guardians: 'rise_of_shadows_dreamway_guardians',
  dryad: 'rise_of_shadows_crystal_dryad',
  swarm: 'ashes_of_outland_glowfly_swarm',
  glowfly: 'ashes_of_outland_glowfly',
  zombie: 'march_of_the_lich_king_lingering_zombie',
  disarmed: 'march_of_the_lich_king_disarmed_zombie',
  terminal: 'march_of_the_lich_king_zombie',
  breath: 'descent_of_dragons_breath_of_dreams',
  explorer: 'descent_of_dragons_emerald_explorer',
  whelp: 'showdown_in_the_badlands_splishsplash_whelp',
  nest: 'showdown_in_the_badlands_desert_nestmatron',
  golem: 'showdown_in_the_badlands_dragon_golem',
  springpaw: 'rastakhans_rumble_springpaw',
  lynx: 'rastakhans_rumble_lynx',
  infestation: 'scholomance_academy_adorable_infestation',
  cub: 'scholomance_academy_marsuul_cub',
  tremors: 'titans_awakening_tremors',
  worm: 'titans_worm',
  ingenuity: 'ashes_of_outland_scavengers_ingenuity'
} as const
const wisp = 'classic_wisp'
const dragon = 'classic_faerie_dragon'
const filler = (n: number) => Array.from({ length: n }, () => wisp)
const board = (n: number) => filler(n).map((cardId) => ({ cardId }))
function setup(options: Partial<AiFixtureOptions> = {}) {
  const f = createAiFixture({
    seed: 924,
    aiHeroId: 'malfurion',
    opponentHeroId: 'jaina',
    aiMana: 10,
    ...options
  })
  const m = createOpeningMatchFromCheckpoint(f.checkpoint)
  const id = f.aiParticipantId
  const me = () => m.getState().players.find((p) => p.participantId === id)!
  const foe = () =>
    m.getState().players.find((p) => p.participantId === f.localParticipantId)!
  const play = (
    cardId: string,
    target?: { instanceId: string; participantId?: string }
  ) => {
    const card = me().hand.find((c) => c.cardId === cardId)!
    expect(card, cardId).toBeDefined()
    const result = m.dispatch({
      type: 'play-card',
      participantId: id,
      cardInstanceId: card.instanceId,
      ...(CARD_CATALOG.get(cardId)!.type === 'Minion'
        ? { position: me().board.length }
        : {}),
      ...(target
        ? {
            targets: [
              {
                kind: 'minion',
                participantId: target.participantId ?? id,
                instanceId: target.instanceId
              }
            ]
          }
        : {})
    })
    expect(
      result.accepted,
      'message' in result ? String(result.message) : undefined
    ).toBe(true)
    return result
  }
  const mana = () =>
    expect(
      m.dispatch({
        type: 'dev-set-mana',
        participantId: id,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
  const attack = (instanceId: string, defender?: string) =>
    m.dispatch({
      type: 'attack-character',
      participantId: id,
      attacker: { kind: 'minion', instanceId },
      defender: defender ? { kind: 'minion', instanceId: defender } : { kind: 'hero' }
    })
  return { m, id, me, foe, play, mana, attack }
}

describe('shortlist Druid and Hunter behavior', () => {
  it('registers every card and token with native expansion, legality and selected balance', () => {
    for (const id of Object.values(C)) expect(CARD_CATALOG.get(id), id).toBeDefined()
    for (const id of [
      C.squirrel,
      C.dryad,
      C.glowfly,
      C.disarmed,
      C.terminal,
      C.lynx,
      C.cub,
      C.worm
    ]) {
      expect(CARD_CATALOG.get(id)).toMatchObject({
        collectible: false,
        deckLegal: false
      })
    }
    expect(CARD_CATALOG.get(C.whelp)).toMatchObject({ cost: 2, attack: 2, health: 1 })
    expect(CARD_CATALOG.get(C.worm)).toMatchObject({ cost: 1, attack: 4, health: 1 })
    for (const cls of ['Druid', 'Hunter'])
      expect(isCardAllowedForClass(CARD_CATALOG.get(C.infestation)!, cls)).toBe(true)
    expect(isCardAllowedForClass(CARD_CATALOG.get(C.infestation)!, 'Mage')).toBe(false)
  })
  it.each([0, 8, 9, 10])(
    'Acornbearer adds two Squirrels, respecting hand size %i',
    (count) => {
      const s = setup({
        aiHand: [...filler(count)],
        aiBoard: [{ cardId: C.acorn }],
        opponentBoard: [{ cardId: 'basic_chillwind_yeti' }]
      })
      expect(
        s.attack(s.me().board[0]!.instanceId, s.foe().board[0]!.instanceId).accepted
      ).toBe(true)
      expect(s.me().hand.filter((c) => c.cardId === C.squirrel)).toHaveLength(
        Math.min(2, 10 - count)
      )
      expect(s.me().board).toHaveLength(0)
    }
  )
  it.each([0, 6, 7])(
    'Dreamway Guardians summons up to two Dryads with %i occupied slots',
    (n) => {
      const s = setup({ aiHand: [C.guardians], aiBoard: board(n) })
      s.play(C.guardians)
      const dryads = s.me().board.filter((c) => c.cardId === C.dryad)
      expect(dryads).toHaveLength(Math.min(2, 7 - n))
      dryads.forEach((d) =>
        expect(d).toMatchObject({ attack: 1, health: 2, keywords: ['lifesteal'] })
      )
    }
  )
  it('Dryad lifesteal heals actual combat damage', () => {
    const s = setup({
      aiHealth: 20,
      aiBoard: [{ cardId: C.dryad }],
      opponentBoard: [{ cardId: 'basic_chillwind_yeti' }]
    })
    expect(
      s.attack(s.me().board[0]!.instanceId, s.foe().board[0]!.instanceId).accepted
    ).toBe(true)
    expect(s.me().hero.health).toBe(21)
  })
  it.each([
    [0, 0],
    [3, 0],
    [9, 0],
    [3, 6],
    [3, 7]
  ])(
    'Glowfly counts %i remaining spells with %i occupied slots',
    (spells, occupied) => {
      const s = setup({
        aiHand: [C.swarm, ...Array.from({ length: spells }, () => 'classic_moonfire')],
        aiBoard: board(occupied)
      })
      s.play(C.swarm)
      expect(s.me().board.filter((c) => c.cardId === C.glowfly)).toHaveLength(
        Math.min(spells, 7 - occupied)
      )
    }
  )
  it('Glowfly excludes non-spells as well as the cast source', () => {
    const s = setup({ aiHand: [C.swarm, wisp, dragon, 'classic_moonfire'] })
    s.play(C.swarm)
    expect(s.me().board.map((c) => c.cardId)).toEqual([C.glowfly])
  })
  it('Lingering Zombie has exactly two successive replacement Deathrattles', () => {
    const s = setup({
      aiHand: ['classic_moonfire', 'classic_moonfire', 'classic_moonfire'],
      aiBoard: [{ cardId: C.zombie }, ...board(6)]
    })
    for (const next of [C.disarmed, C.terminal, null]) {
      s.play('classic_moonfire', s.me().board[0]!)
      expect(s.me().board).toHaveLength(next ? 7 : 6)
      if (next)
        expect(s.me().board[0]).toMatchObject({ cardId: next, attack: 1, health: 1 })
    }
  })
  it.each([dragon, wisp])('Breath draws before checking held Dragons (%s)', (drawn) => {
    const s = setup({
      aiHand: [C.breath],
      aiDeck: [drawn],
      aiMana: 4,
      aiMaximumMana: 4
    })
    s.play(C.breath)
    expect(s.me().hand.map((c) => c.cardId)).toEqual([drawn])
    expect(s.me().mana).toMatchObject({
      maximum: drawn === dragon ? 5 : 4,
      available: 2
    })
  })
  it('Breath can ramp with a Dragon already held and stops at ten crystals', () => {
    const s = setup({ aiHand: [C.breath, dragon], aiDeck: [wisp], aiMana: 10 })
    s.play(C.breath)
    expect(s.me().mana).toMatchObject({ maximum: 10, available: 8 })
  })
  it.each([false, true])(
    'Splish-Splash excludes itself; holding another Dragon: %s',
    (held) => {
      const s = setup({
        aiHand: [C.whelp, ...(held ? [dragon] : [])],
        aiMana: 4,
        aiMaximumMana: 4
      })
      s.play(C.whelp)
      expect(s.me().mana).toMatchObject({ maximum: held ? 5 : 4, available: 2 })
    }
  )
  it('Splish-Splash empty ramp is capped at ten', () => {
    const s = setup({ aiHand: [C.whelp, dragon] })
    s.play(C.whelp)
    expect(s.me().mana).toMatchObject({ maximum: 10, available: 8 })
  })
  it.each([false, true])(
    'Desert Nestmatron refreshes only with another held Dragon: %s',
    (held) => {
      const s = setup({
        aiHand: [C.nest, ...(held ? [dragon] : [])],
        aiMana: 4,
        aiMaximumMana: 4
      })
      s.play(C.nest)
      expect(s.me().mana).toMatchObject({ maximum: 4, available: held ? 4 : 0 })
      expect(s.me().board[0]!.keywords).toContain('taunt')
    }
  )
  it('Emerald Explorer offers three distinct Dragons and adds the selected one', () => {
    const s = setup({ aiHand: [C.explorer] })
    s.play(C.explorer)
    const choice = s.m.getState().pendingDiscover!
    expect(choice.candidates).toHaveLength(3)
    expect(new Set(choice.candidates.map((c) => c.cardId)).size).toBe(3)
    choice.candidates.forEach((c) =>
      expect(cardHasTribe(CARD_CATALOG.get(c.cardId), 'Dragon')).toBe(true)
    )
    const selected = choice.candidates[1]!
    expect(
      s.m.dispatch({
        type: 'choose-discover-card',
        participantId: s.id,
        cardInstanceId: selected.instanceId
      }).accepted
    ).toBe(true)
    expect(s.me().hand.map((c) => c.cardId)).toEqual([selected.cardId])
    expect(s.me().board[0]!.keywords).toContain('taunt')
  })
  it.each([
    [0, 0],
    [1, 0],
    [3, 0],
    [3, 5],
    [3, 6]
  ])(
    'Dragon Golem copies %i held Dragons with %i existing minions',
    (held, occupied) => {
      const s = setup({
        aiHand: [C.golem, ...Array.from({ length: held }, () => dragon)],
        aiBoard: board(occupied)
      })
      s.play(C.golem)
      expect(s.me().board.filter((c) => c.cardId === C.golem)).toHaveLength(
        Math.min(1 + held, 7 - occupied)
      )
      s.me()
        .board.filter((c) => c.cardId === C.golem)
        .forEach((c) =>
          expect(c).toMatchObject({ attack: 3, health: 4, keywords: ['taunt'] })
        )
    }
  )
  it('Dragon Golem copies its permanent hand buff without double-counting an aura', () => {
    const s = setup({
      aiHand: [
        {
          cardId: C.golem,
          enchantments: [
            {
              id: 'hand-buff',
              sourceInstanceId: 'buff-source',
              sourceCardId: null,
              attackDelta: 2,
              healthDelta: 2,
              maximumHealthDelta: 2,
              duration: 'permanent'
            }
          ]
        },
        dragon
      ],
      aiBoard: [{ cardId: 'basic_stormwind_champion' }]
    })
    s.play(C.golem)
    const golems = s.me().board.filter((c) => c.cardId === C.golem)
    expect(golems).toHaveLength(2)
    expect(golems[0]).toMatchObject({ attack: 6, health: 7 })
    expect(golems[1]).toMatchObject({ attack: 6, health: 7 })
  })
  it('Springpaw creates a Lynx; both Rush minions attack minions but not heroes immediately', () => {
    const s = setup({
      aiHand: [C.springpaw],
      opponentBoard: [{ cardId: 'basic_chillwind_yeti' }]
    })
    s.play(C.springpaw)
    expect(s.me().hand.map((c) => c.cardId)).toEqual([C.lynx])
    s.play(C.lynx)
    for (const minion of [...s.me().board]) {
      expect(s.attack(minion.instanceId).accepted).toBe(false)
      expect(s.attack(minion.instanceId, s.foe().board[0]!.instanceId).accepted).toBe(
        true
      )
    }
  })
  it.each([false, true])(
    'Adorable Infestation buffs a %s enemy minion, summons and adds a Cub',
    (enemy) => {
      const s = setup({
        aiHand: [C.infestation],
        aiBoard: board(1),
        opponentBoard: board(1)
      })
      const target = (enemy ? s.foe() : s.me()).board[0]!
      s.play(C.infestation, {
        instanceId: target.instanceId,
        participantId: enemy ? s.foe().participantId : s.id
      })
      expect((enemy ? s.foe() : s.me()).board[0]).toMatchObject({
        attack: 2,
        health: 2
      })
      expect(s.me().board.at(-1)!.cardId).toBe(C.cub)
      expect(s.me().hand.map((c) => c.cardId)).toEqual([C.cub])
    }
  )
  it('Adorable Infestation still buffs and adds the Cub when board is full', () => {
    const s = setup({ aiHand: [C.infestation, ...filler(9)], aiBoard: board(7) })
    s.play(C.infestation, s.me().board[0]!)
    expect(s.me().board).toHaveLength(7)
    expect(s.me().board[0]!.attack).toBe(2)
    expect(s.me().hand).toHaveLength(10)
    expect(s.me().hand.at(-1)!.cardId).toBe(C.cub)
  })
  it.each([0, 8, 9])(
    'Awakening Tremors adds selected 4/1 one-cost Worms with %i other cards',
    (n) => {
      const s = setup({ aiHand: [C.tremors, ...filler(n)] })
      s.play(C.tremors)
      const worms = s.me().hand.filter((c) => c.cardId === C.worm)
      expect(worms).toHaveLength(Math.min(3, 10 - n))
      s.play(C.worm)
      expect(s.me().board[0]).toMatchObject({ attack: 4, health: 1 })
      expect(s.me().mana.available).toBe(8)
    }
  )
  it('Scavenger’s Ingenuity draws a Beast, not the top non-Beast, and preserves +3/+3 into play', () => {
    const s = setup({ aiHand: [C.ingenuity], aiDeck: [wisp, C.springpaw] })
    s.play(C.ingenuity)
    expect(s.me().deck.map((c) => c.cardId)).toEqual([wisp])
    expect(s.me().hand.map((c) => c.cardId)).toEqual([C.springpaw])
    s.play(C.springpaw)
    expect(s.me().board[0]).toMatchObject({ attack: 4, health: 4 })
    expect(s.me().hand.map((c) => c.cardId)).toEqual([C.lynx])
  })
  it('Scavenger’s Ingenuity with no Beast neither draws nor fatigues nor buffs existing hand', () => {
    const s = setup({ aiHand: [C.ingenuity, C.springpaw], aiDeck: [wisp] })
    s.play(C.ingenuity)
    expect(s.me().deck.map((c) => c.cardId)).toEqual([wisp])
    expect(s.me().hero.health).toBe(30)
    s.play(C.springpaw)
    expect(s.me().board[0]).toMatchObject({ attack: 1, health: 1 })
  })
  it('Breath fatigues on an empty deck but still checks an already held Dragon', () => {
    const s = setup({
      aiHand: [C.breath, dragon],
      aiDeck: [],
      aiMana: 4,
      aiMaximumMana: 4
    })
    s.play(C.breath)
    expect(s.me().hero.health).toBe(29)
    expect(s.me().mana).toMatchObject({ maximum: 5, available: 2 })
  })
  it('Adorable Infestation cannot be cast without a minion target', () => {
    const s = setup({ aiHand: [C.infestation] })
    const result = s.m.dispatch({
      type: 'play-card',
      participantId: s.id,
      cardInstanceId: s.me().hand[0]!.instanceId
    })
    expect(result.accepted).toBe(false)
    expect(s.me().hand).toHaveLength(1)
    expect(s.me().mana.available).toBe(10)
    expect(s.me().board).toHaveLength(0)
  })
  it('Springpaw fills the one free hand slot after playing from a full hand', () => {
    const s = setup({ aiHand: [C.springpaw, ...filler(9)] })
    s.play(C.springpaw)
    expect(s.me().hand).toHaveLength(10)
    expect(s.me().hand.filter((c) => c.cardId === C.lynx)).toHaveLength(1)
  })
})
