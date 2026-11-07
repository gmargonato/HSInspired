import { effectiveBoardMinionKeywords } from '../rules/minion-attack-state'
import { describe, expect, it } from 'vitest'
import { CARD_CATALOG } from '../../content/cards'
import { createAiFixture, type AiFixtureOptions } from '../testing/ai-scenario-builder'
import { createOpeningMatchFromCheckpoint } from '../opening-match'

const A = 'ashes_of_outland_'
const B = 'showdown_in_the_badlands_'
const wisdom = A + 'libram_of_wisdom'
const ooze = 'basic_acidic_swamp_ooze'
const wisp = 'classic_wisp'
function scenario(hand: string[], options: Partial<AiFixtureOptions> = {}) {
  const f = createAiFixture({
    seed: 618,
    aiHeroId: 'uther',
    opponentHeroId: 'jaina',
    aiMana: 10,
    aiMaximumMana: 10,
    aiHand: hand,
    ...options
  })
  const m = createOpeningMatchFromCheckpoint(f.checkpoint)
  const me = () =>
    m.getState().players.find((p) => p.participantId === f.aiParticipantId)!
  const foe = () =>
    m.getState().players.find((p) => p.participantId === f.localParticipantId)!
  function play(id: string, extra: Record<string, unknown> = {}) {
    expect(
      m.dispatch({
        type: 'dev-set-mana',
        participantId: f.aiParticipantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const card = me().hand.find((c) => c.cardId === id)!
    expect(card, id).toBeDefined()
    const r = m.dispatch({
      type: 'play-card',
      participantId: f.aiParticipantId,
      cardInstanceId: card.instanceId,
      ...(CARD_CATALOG.get(id)?.type === 'Minion'
        ? { position: me().board.length }
        : {}),
      ...extra
    })
    if (!r.accepted) throw new Error(r.message)
    return r
  }
  const add = (id: string) =>
    expect(
      m.dispatch({ type: 'dev-add-card', participantId: f.aiParticipantId, cardId: id })
        .accepted
    ).toBe(true)
  const target = (index = 0) => ({
    targets: [
      {
        kind: 'minion',
        participantId: f.aiParticipantId,
        instanceId: me().board[index]!.instanceId
      }
    ]
  })
  return { m, me, foe, play, add, target, f }
}

describe('shortlisted Paladin cards: durable runtime scenarios', () => {
  it('Aldors stack permanent reductions on held, generated and returned Librams, bounded at zero', () => {
    const s = scenario([
      A + 'aldor_attendant',
      A + 'aldor_truthseeker',
      wisdom,
      A + 'libram_of_hope',
      A + 'libram_of_justice'
    ])
    s.play(A + 'aldor_attendant')
    s.play(A + 'aldor_truthseeker')
    expect(s.me().hand.map((c) => c.currentCost)).toEqual([0, 6, 2])
    s.add(wisdom)
    expect(s.me().hand.at(-1)?.currentCost).toBe(0)
    s.play(wisdom, s.target())
    s.add('basic_sacrificial_pact')
    s.add('basic_shadow_word_pain')
    s.play('basic_shadow_word_pain', s.target())
    expect(
      s
        .me()
        .hand.filter((c) => c.cardId === wisdom)
        .every((c) => c.currentCost === 0)
    ).toBe(true)
    expect(s.me().board[0]?.keywords).toContain('taunt')
  })
  it('Wisdom deathrattles stack and silence removes both buffs and returns', () => {
    for (const silence of [false, true]) {
      const s = scenario(
        [wisdom, wisdom, 'classic_silence', 'basic_shadow_word_pain'],
        { aiBoard: [{ cardId: wisp }] }
      )
      s.play(wisdom, s.target())
      s.play(wisdom, s.target())
      expect(s.me().board[0]).toMatchObject({ attack: 3, health: 3 })
      if (silence) s.play('classic_silence', s.target())
      s.play('basic_shadow_word_pain', s.target())
      expect(s.me().hand.filter((c) => c.cardId === wisdom)).toHaveLength(
        silence ? 0 : 2
      )
    }
  })
  it('Justice replaces the weapon and Pyromancer resolves after health becomes one', () => {
    const s = scenario([A + 'libram_of_justice'], {
      aiBoard: [{ cardId: 'classic_wild_pyromancer' }],
      opponentBoard: [{ cardId: 'basic_boulderfist_ogre' }, { cardId: ooze }],
      aiWeapon: { cardId: 'classic_truesilver_champion' }
    })
    s.play(A + 'libram_of_justice')
    expect(s.foe().board).toHaveLength(0)
    expect(s.me().weapon).toMatchObject({ attack: 1, durability: 4 })
    expect(s.me().board[0]?.health).toBe(1)
  })
  it('Hope heals chosen characters and summons Guardian, even when healing is capped', () => {
    const s = scenario([A + 'libram_of_hope'], { aiHealth: 27 })
    s.play(A + 'libram_of_hope', {
      targets: [{ kind: 'hero', participantId: s.f.aiParticipantId }]
    })
    expect(s.me().hero.health).toBe(30)
    expect(s.me().board[0]).toMatchObject({ attack: 8, health: 8, divineShield: true })
    expect(s.me().board[0]?.keywords).toContain('taunt')
  })
  it('Crystology draws only two one-attack minions, and misses without fatigue', () => {
    const s = scenario(['the_boomsday_project_crystology'], {
      aiDeck: [ooze, A + 'aldor_attendant', 'basic_arcane_shot', B + 'gold_panner']
    })
    s.play('the_boomsday_project_crystology')
    expect(
      s
        .me()
        .hand.map((c) => c.cardId)
        .sort()
    ).toEqual([A + 'aldor_attendant', B + 'gold_panner'].sort())
    s.add('the_boomsday_project_crystology')
    s.play('the_boomsday_project_crystology')
    expect(s.me().hero.health).toBe(30)
  })
  it('Bannerman buffs the drawn minion and existing minions, not spells', () => {
    const s = scenario(['united_in_stormwind_alliance_bannerman', wisp, wisdom], {
      aiDeck: [ooze]
    })
    s.play('united_in_stormwind_alliance_bannerman')
    s.play(ooze)
    s.play(wisp)
    expect(s.me().board.map((c) => [c.attack, c.health])).toEqual([
      [2, 2],
      [4, 3],
      [2, 2]
    ])
  })
  it('Painter’s Virtue heals and buffs minion cards after a hero attack', () => {
    const s = scenario(['whizbangs_workshop_painters_virtue', wisp, wisdom], {
      aiHealth: 20
    })
    s.play('whizbangs_workshop_painters_virtue')
    expect(
      s.m.dispatch({
        type: 'attack-character',
        participantId: s.f.aiParticipantId,
        attacker: { kind: 'hero' },
        defender: { kind: 'hero' }
      }).accepted
    ).toBe(true)
    expect(s.me().hero.health).toBe(22)
    expect(s.foe().hero.health).toBe(28)
    s.play(wisp)
    expect(s.me().board[0]).toMatchObject({ attack: 2, health: 2 })
    expect(s.me().weapon?.durability).toBe(2)
  })
  it('Scalehide can Rush into a minion, cannot attack a hero immediately, and steals life', () => {
    const s = scenario(['the_witchwood_vicious_scalehide'], {
      aiHealth: 20,
      opponentBoard: [{ cardId: ooze }]
    })
    s.play('the_witchwood_vicious_scalehide')
    const attacker = {
      kind: 'minion' as const,
      instanceId: s.me().board[0]!.instanceId
    }
    expect(
      s.m.dispatch({
        type: 'attack-character',
        participantId: s.f.aiParticipantId,
        attacker,
        defender: { kind: 'hero' }
      }).accepted
    ).toBe(false)
    expect(
      s.m.dispatch({
        type: 'attack-character',
        participantId: s.f.aiParticipantId,
        attacker,
        defender: { kind: 'minion', instanceId: s.foe().board[0]!.instanceId }
      }).accepted
    ).toBe(true)
    expect(s.me().hero.health).toBe(21)
  })
  it('Silverwing has Divine Shield and its deathrattle filters Holy spells', () => {
    const s = scenario([B + 'hi_ho_silverwing', 'basic_shadow_word_pain'], {
      aiDeck: ['basic_fireball', wisdom, ooze]
    })
    s.play(B + 'hi_ho_silverwing')
    expect(s.me().board[0]?.divineShield).toBe(true)
    s.play('basic_shadow_word_pain', s.target())
    expect(s.me().hand.map((c) => c.cardId)).toEqual([wisdom])
  })
  it('Gold Panner draws at the end of its controller’s turn', () => {
    const s = scenario([B + 'gold_panner'], { aiDeck: [wisp], opponentDeck: [ooze] })
    s.play(B + 'gold_panner')
    expect(
      s.m.dispatch({ type: 'end-turn', participantId: s.f.aiParticipantId }).accepted
    ).toBe(true)
    expect(s.me().hand.map((c) => c.cardId)).toEqual([wisp])
  })
  it('Mother Duck summons Rush ducklings and respects the seven-minion cap', () => {
    for (const count of [0, 5]) {
      const s = scenario(['into_the_emerald_dream_mother_duck'], {
        aiBoard: Array.from({ length: count }, () => ({ cardId: wisp }))
      })
      s.play('into_the_emerald_dream_mother_duck')
      const ducks = s
        .me()
        .board.filter((c) => c.cardId === 'into_the_emerald_dream_duckling')
      expect(ducks).toHaveLength(count ? 1 : 3)
      expect(ducks.every((c) => effectiveBoardMinionKeywords(c).includes('rush'))).toBe(
        true
      )
    }
  })
  it('Busy-Bot buffs only friendly minions currently at one attack', () => {
    const s = scenario(['perils_in_paradise_busy_bot'], {
      aiBoard: [{ cardId: wisp }, { cardId: ooze }],
      opponentBoard: [{ cardId: wisp }]
    })
    s.play('perils_in_paradise_busy_bot')
    expect(s.me().board.map((c) => c.attack)).toEqual([2, 3, 3])
    expect(s.foe().board[0]?.attack).toBe(1)
  })
  it('Showdown summons friendly then enemy Outlaws and grants Rush only to newly summoned friendlies, at independent caps', () => {
    for (const count of [0, 6, 7]) {
      const s = scenario([B + 'showdown'], {
        aiBoard: Array.from({ length: count }, () => ({ cardId: wisp })),
        opponentBoard: Array.from({ length: count ? 5 : 0 }, () => ({ cardId: wisp }))
      })
      s.play(B + 'showdown')
      const mine = s.me().board.filter((c) => c.cardId === B + 'outlaw'),
        theirs = s.foe().board.filter((c) => c.cardId === B + 'outlaw')
      expect(mine).toHaveLength(Math.min(3, 7 - count))
      expect(theirs).toHaveLength(count ? 2 : 3)
      expect(mine.every((c) => effectiveBoardMinionKeywords(c).includes('rush'))).toBe(
        true
      )
      expect(
        theirs.every((c) => !effectiveBoardMinionKeywords(c).includes('rush'))
      ).toBe(true)
    }
  })
  it('Beam discounts live with enemy board changes and damages the enemy hero too', () => {
    const s = scenario([B + 'prismatic_beam', B + 'showdown'], {
      aiBoard: [{ cardId: wisp }]
    })
    expect(s.me().hand[0]?.currentCost).toBe(7)
    s.play(B + 'showdown')
    expect(s.me().hand[0]?.currentCost).toBe(4)
    s.play(B + 'prismatic_beam')
    expect(s.foe().board).toHaveLength(0)
    expect(s.foe().hero.health).toBe(27)
    expect(s.me().board).toHaveLength(4)
  })
  it('Battlemaster grants Windfury only to adjacent minions and silence removes the aura', () => {
    const s = scenario(
      ['united_in_stormwind_battleground_battlemaster', 'classic_silence'],
      { aiBoard: [{ cardId: wisp }, { cardId: ooze }, { cardId: wisp }] }
    )
    s.play('united_in_stormwind_battleground_battlemaster', { position: 1 })
    expect(
      s.me().board.map((c) => effectiveBoardMinionKeywords(c).includes('windfury'))
    ).toEqual([true, false, true, false])
    s.play('classic_silence', s.target(1))
    expect(
      s.me().board.every((c) => !effectiveBoardMinionKeywords(c).includes('windfury'))
    ).toBe(true)
  })

  it('Wisdom copies retain attached deathrattles and the recipient controller gets the return', () => {
    const s = scenario(
      [
        wisdom,
        'classic_faceless_manipulator',
        'basic_shadow_word_pain',
        'basic_shadow_word_pain'
      ],
      { aiBoard: [{ cardId: wisp }] }
    )
    s.play(wisdom, s.target())
    s.play('classic_faceless_manipulator', s.target())
    s.play('basic_shadow_word_pain', s.target(1))
    s.play('basic_shadow_word_pain', s.target())
    expect(s.me().hand.filter((c) => c.cardId === wisdom)).toHaveLength(2)
    const enemy = scenario([wisdom, 'basic_shadow_word_pain'], {
      opponentBoard: [{ cardId: wisp }]
    })
    const targets = [
      {
        kind: 'minion',
        participantId: enemy.f.localParticipantId,
        instanceId: enemy.foe().board[0]!.instanceId
      }
    ]
    enemy.play(wisdom, { targets })
    enemy.play('basic_shadow_word_pain', { targets })
    expect(enemy.me().hand).toHaveLength(0)
    expect(enemy.foe().hand.map((c) => c.cardId)).toEqual([wisdom])
  })
  it('Libram discounts survive turn changes, source death and checkpoint restoration', () => {
    const s = scenario([A + 'aldor_attendant', 'basic_shadow_word_pain', wisdom], {
      aiDeck: [ooze],
      opponentDeck: [ooze]
    })
    s.play(A + 'aldor_attendant')
    s.play('basic_shadow_word_pain', s.target())
    expect(
      s.m.dispatch({ type: 'end-turn', participantId: s.f.aiParticipantId }).accepted
    ).toBe(true)
    expect(
      s.m.dispatch({ type: 'end-turn', participantId: s.f.localParticipantId }).accepted
    ).toBe(true)
    const restored = createOpeningMatchFromCheckpoint(s.m.getCheckpoint())
    expect(
      restored.dispatch({
        type: 'dev-add-card',
        participantId: s.f.aiParticipantId,
        cardId: wisdom
      }).accepted
    ).toBe(true)
    expect(
      restored
        .getState()
        .players.find((p) => p.participantId === s.f.aiParticipantId)!
        .hand.filter((c) => c.cardId === wisdom)
        .map((c) => c.currentCost)
    ).toEqual([1, 1])
  })
  it('Hope heals on a full board without creating an eighth minion', () => {
    const s = scenario([A + 'libram_of_hope'], {
      aiHealth: 10,
      aiBoard: Array.from({ length: 7 }, () => ({ cardId: wisp }))
    })
    s.play(A + 'libram_of_hope', {
      targets: [{ kind: 'hero', participantId: s.f.aiParticipantId }]
    })
    expect(s.me().hero.health).toBe(18)
    expect(s.me().board).toHaveLength(7)
  })
  it('Showdown does not grant Rush to an existing Outlaw and emits friendly summons first', () => {
    const s = scenario([B + 'showdown'], { aiBoard: [{ cardId: B + 'outlaw' }] })
    const result = s.play(B + 'showdown')
    expect(effectiveBoardMinionKeywords(s.me().board[0]!)).not.toContain('rush')
    expect(
      result.events
        .filter((e) => e.type === 'minion-summoned')
        .map((e) => e.participantId)
    ).toEqual([
      ...Array(3).fill(s.f.aiParticipantId),
      ...Array(3).fill(s.f.localParticipantId)
    ])
  })
  it('Beam returns to full cost after enemy minions disappear and reaches zero at seven enemies', () => {
    const s = scenario([B + 'prismatic_beam', 'basic_flamestrike'], {
      opponentBoard: Array.from({ length: 7 }, () => ({ cardId: wisp }))
    })
    expect(s.me().hand[0]?.currentCost).toBe(0)
    s.play('basic_flamestrike')
    expect(s.me().hand[0]?.currentCost).toBe(7)
  })

  it('Painter’s final durability attack still buffs, but a later attack after replacement does not', () => {
    const s = scenario([wisp], {
      aiWeapon: { cardId: 'whizbangs_workshop_painters_virtue', durability: 1 },
      aiHealth: 20
    })
    expect(
      s.m.dispatch({
        type: 'attack-character',
        participantId: s.f.aiParticipantId,
        attacker: { kind: 'hero' },
        defender: { kind: 'hero' }
      }).accepted
    ).toBe(true)
    expect(s.me().weapon).toBeNull()
    expect(s.me().hero.health).toBe(22)
    s.play(wisp)
    expect(s.me().board[0]).toMatchObject({ attack: 2, health: 2 })
    const replacement = scenario([A + 'libram_of_justice', wisp], {
      aiWeapon: { cardId: 'whizbangs_workshop_painters_virtue' }
    })
    replacement.play(A + 'libram_of_justice')
    expect(
      replacement.m.dispatch({
        type: 'attack-character',
        participantId: replacement.f.aiParticipantId,
        attacker: { kind: 'hero' },
        defender: { kind: 'hero' }
      }).accepted
    ).toBe(true)
    replacement.play(wisp)
    expect(replacement.me().board[0]).toMatchObject({ attack: 1, health: 1 })
  })
  it('Wisdom returns stop at the ten-card hand cap', () => {
    const s = scenario([wisdom, wisdom], {
      aiBoard: [{ cardId: wisp }],
      opponentHand: ['basic_shadow_word_pain'],
      opponentDeck: [ooze]
    })
    s.play(wisdom, s.target())
    s.play(wisdom, s.target())
    for (let i = 0; i < 9; i++) s.add(wisp)
    expect(
      s.m.dispatch({ type: 'end-turn', participantId: s.f.aiParticipantId }).accepted
    ).toBe(true)
    expect(
      s.m.dispatch({
        type: 'dev-set-mana',
        participantId: s.f.localParticipantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const r = s.m.dispatch({
      type: 'play-card',
      participantId: s.f.localParticipantId,
      cardInstanceId: s.foe().hand.find((c) => c.cardId === 'basic_shadow_word_pain')!
        .instanceId,
      targets: [
        {
          kind: 'minion',
          participantId: s.f.aiParticipantId,
          instanceId: s.me().board[0]!.instanceId
        }
      ]
    })
    expect(r.accepted).toBe(true)
    expect(s.me().hand).toHaveLength(10)
    expect(s.me().hand.filter((c) => c.cardId === wisdom)).toHaveLength(1)
  })
  it('Justice changes enemy health without consuming Divine Shield or touching friendly health', () => {
    const s = scenario([A + 'libram_of_justice'], {
      aiBoard: [{ cardId: ooze }],
      opponentBoard: [{ cardId: 'classic_argent_commander' }]
    })
    s.play(A + 'libram_of_justice')
    expect(s.foe().board[0]).toMatchObject({ health: 1, divineShield: true })
    expect(s.me().board[0]?.health).toBe(2)
  })

  it('Painter’s overkill heals full damage and still buffs the hand', () => {
    const s = scenario(['whizbangs_workshop_painters_virtue', wisp], {
      aiHealth: 20,
      opponentBoard: [{ cardId: wisp }]
    })
    s.play('whizbangs_workshop_painters_virtue')
    expect(
      s.m.dispatch({
        type: 'attack-character',
        participantId: s.f.aiParticipantId,
        attacker: { kind: 'hero' },
        defender: { kind: 'minion', instanceId: s.foe().board[0]!.instanceId }
      }).accepted
    ).toBe(true)
    expect(s.me().hero.health).toBe(21)
    s.play(wisp)
    expect(s.me().board[0]).toMatchObject({ attack: 2, health: 2 })
  })
  it('Buffed Scalehide heals its full attack on overkill, not the target’s remaining health', () => {
    const s = scenario(['the_witchwood_vicious_scalehide', wisdom], {
      aiHealth: 20,
      opponentBoard: [{ cardId: wisp }]
    })
    s.play('the_witchwood_vicious_scalehide')
    s.play(wisdom, s.target())
    expect(
      s.m.dispatch({
        type: 'attack-character',
        participantId: s.f.aiParticipantId,
        attacker: { kind: 'minion', instanceId: s.me().board[0]!.instanceId },
        defender: { kind: 'minion', instanceId: s.foe().board[0]!.instanceId }
      }).accepted
    ).toBe(true)
    expect(s.me().hero.health).toBe(22)
  })

  it('Battlemaster permits a second actual attack for each ready adjacent Giant', () => {
    const s = scenario(['united_in_stormwind_battleground_battlemaster'], {
      aiMana: 6,
      aiMaximumMana: 6,
      aiBoard: [
        { cardId: 'classic_sea_giant', ready: true },
        { cardId: 'classic_sea_giant', ready: true }
      ],
      opponentHealth: 30
    })
    s.play('united_in_stormwind_battleground_battlemaster', { position: 1 })
    const ids = [s.me().board[0]!.instanceId, s.me().board[2]!.instanceId]
    expect(s.me().board[0]!.maxAttacksPerTurn).toBe(2)
    for (const instanceId of [...ids, ...ids]) {
      const r = s.m.dispatch({
        type: 'attack-character',
        participantId: s.f.aiParticipantId,
        attacker: { kind: 'minion', instanceId },
        defender: { kind: 'hero' }
      })
      if (!r.accepted) throw new Error(r.message)
    }
    expect(s.foe().hero.health).toBeLessThanOrEqual(0)
  })
  it('Removing the Windfury aura after one attack blocks a second attack', () => {
    for (const remove of ['classic_silence', 'basic_shadow_word_death']) {
      const s = scenario(['united_in_stormwind_battleground_battlemaster', remove], {
        aiBoard: [{ cardId: 'classic_sea_giant', ready: true }]
      })
      s.play('united_in_stormwind_battleground_battlemaster', { position: 1 })
      const attacker = {
        kind: 'minion' as const,
        instanceId: s.me().board[0]!.instanceId
      }
      expect(
        s.m.dispatch({
          type: 'attack-character',
          participantId: s.f.aiParticipantId,
          attacker,
          defender: { kind: 'hero' }
        }).accepted
      ).toBe(true)
      s.play(remove, s.target(1))
      expect(s.me().board[0]!.maxAttacksPerTurn).toBe(1)
      expect(
        s.m.dispatch({
          type: 'attack-character',
          participantId: s.f.aiParticipantId,
          attacker,
          defender: { kind: 'hero' }
        }).accepted
      ).toBe(false)
    }
  })
  it('Changing adjacency revokes the old neighbor’s second attack and enables the new neighbor', () => {
    const s = scenario(['united_in_stormwind_battleground_battlemaster', wisp], {
      aiBoard: [
        { cardId: 'classic_sea_giant', ready: true },
        { cardId: ooze, ready: true }
      ]
    })
    s.play('united_in_stormwind_battleground_battlemaster', { position: 1 })
    const attacker = {
      kind: 'minion' as const,
      instanceId: s.me().board[0]!.instanceId
    }
    expect(
      s.m.dispatch({
        type: 'attack-character',
        participantId: s.f.aiParticipantId,
        attacker,
        defender: { kind: 'hero' }
      }).accepted
    ).toBe(true)
    s.play(wisp, { position: 1 })
    expect(s.me().board[0]!.maxAttacksPerTurn).toBe(1)
    expect(s.me().board[1]!.maxAttacksPerTurn).toBe(2)
    expect(
      s.m.dispatch({
        type: 'attack-character',
        participantId: s.f.aiParticipantId,
        attacker,
        defender: { kind: 'hero' }
      }).accepted
    ).toBe(false)
    const other = { kind: 'minion' as const, instanceId: s.me().board[3]!.instanceId }
    for (let i = 0; i < 2; i++)
      expect(
        s.m.dispatch({
          type: 'attack-character',
          participantId: s.f.aiParticipantId,
          attacker: other,
          defender: { kind: 'hero' }
        }).accepted
      ).toBe(true)
  })

  it('Battlemaster preserves Mega-Windfury and falls back to the remaining aura after silence', () => {
    for (const silenceSource of [true, false]) {
      const s = scenario(
        ['united_in_stormwind_battleground_battlemaster', 'classic_silence'],
        { aiBoard: [{ cardId: 'goblins_vs_gnomes_v_07_tr_0n', ready: true }] }
      )
      s.play('united_in_stormwind_battleground_battlemaster', { position: 1 })
      expect(s.me().board[0]!.maxAttacksPerTurn).toBe(4)
      s.play('classic_silence', s.target(silenceSource ? 1 : 0))
      expect(s.me().board[0]!.maxAttacksPerTurn).toBe(silenceSource ? 4 : 2)
      const attacker = {
        kind: 'minion' as const,
        instanceId: s.me().board[0]!.instanceId
      }
      for (let i = 0; i < (silenceSource ? 4 : 2); i++)
        expect(
          s.m.dispatch({
            type: 'attack-character',
            participantId: s.f.aiParticipantId,
            attacker,
            defender: { kind: 'hero' }
          }).accepted
        ).toBe(true)
      expect(
        s.m.dispatch({
          type: 'attack-character',
          participantId: s.f.aiParticipantId,
          attacker,
          defender: { kind: 'hero' }
        }).accepted
      ).toBe(false)
    }
  })
  it('Battlemaster preserves an independently granted extra attack in restored state', () => {
    const s = scenario(['united_in_stormwind_battleground_battlemaster'], {
      aiBoard: [{ cardId: ooze, ready: true }]
    })
    const checkpoint = s.m.getCheckpoint()
    const players = checkpoint.state.players.map((player) => ({
      ...player,
      board: player.board.map((minion) => ({ ...minion, extraAttacksThisTurn: 1 }))
    }))
    const restored = createOpeningMatchFromCheckpoint({
      ...checkpoint,
      state: {
        ...checkpoint.state,
        players: [players[0]!, players[1]!]
      }
    })
    expect(
      restored.dispatch({
        type: 'play-card',
        participantId: s.f.aiParticipantId,
        cardInstanceId: s.me().hand[0]!.instanceId,
        position: 1
      }).accepted
    ).toBe(true)
    const me = () =>
      restored.getState().players.find((p) => p.participantId === s.f.aiParticipantId)!
    expect(me().board[0]!.extraAttacksThisTurn).toBe(1)
    const attacker = { kind: 'minion' as const, instanceId: me().board[0]!.instanceId }
    for (let i = 0; i < 3; i++)
      expect(
        restored.dispatch({
          type: 'attack-character',
          participantId: s.f.aiParticipantId,
          attacker,
          defender: { kind: 'hero' }
        }).accepted
      ).toBe(true)
    expect(
      restored.dispatch({
        type: 'attack-character',
        participantId: s.f.aiParticipantId,
        attacker,
        defender: { kind: 'hero' }
      }).accepted
    ).toBe(false)
  })
  it('preserves selected historical costs and stats rather than current live tuning', () => {
    expect(CARD_CATALOG.get(B + 'prismatic_beam')?.cost).toBe(7)
    expect(CARD_CATALOG.get('united_in_stormwind_alliance_bannerman')).toMatchObject({
      cost: 3,
      attack: 2,
      health: 2
    })
    expect(
      CARD_CATALOG.get('united_in_stormwind_battleground_battlemaster')?.cost
    ).toBe(6)
  })
})
