import { describe, expect, expectTypeOf, it } from 'vitest'
import { EXPANSION_CATALOG } from '../expansions'
import { FUTURE_PAST_CARD_SOURCE } from './sets/future-past'
import {
  CARD_ACTIONS,
  CARD_CATALOG,
  CARD_CONDITIONS,
  CARD_DURATIONS,
  CARD_EVENT_TYPES,
  CARD_KEYWORDS,
  CARD_TRIGGERS,
  CAPABILITY_INVENTORY,
  CAPABILITY_OWNERSHIP,
  GENERATED_CARD_DEFINITIONS,
  assertCapabilityOwnership,
  createCapabilityInventory,
  validateCardRecord,
  type CardAction,
  type ManaCardAction,
  type CardNumericValue
} from './index'

describe('card capability inventory', () => {
  it('owns every closed vocabulary item exactly once', () => {
    expect(() => assertCapabilityOwnership()).not.toThrow()

    const keys = CAPABILITY_OWNERSHIP.map((entry) => `${entry.family}:${entry.name}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(
      CAPABILITY_OWNERSHIP.filter((entry) => entry.family === 'action')
    ).toHaveLength(CARD_ACTIONS.length)
  })

  it('derives live catalog counts and recursively sees nested constructs', () => {
    expect(CAPABILITY_INVENTORY.cardCount).toBe(CARD_CATALOG.size)
    expect(CAPABILITY_INVENTORY.effectCardCount).toBeGreaterThan(0)

    for (const family of [
      'action',
      'trigger',
      'event',
      'condition',
      'duration',
      'keyword'
    ] as const) {
      expect(
        CAPABILITY_INVENTORY.usage.filter((entry) => entry.family === family)
      ).toHaveLength(
        family === 'action'
          ? CARD_ACTIONS.length
          : family === 'trigger'
            ? CARD_TRIGGERS.length
            : family === 'event'
              ? CARD_EVENT_TYPES.length
              : family === 'condition'
                ? CARD_CONDITIONS.length
                : family === 'duration'
                  ? CARD_DURATIONS.length
                  : CARD_KEYWORDS.length
      )
    }

    const nested = createCapabilityInventory(CARD_CATALOG.all).usage.find(
      (entry) => entry.family === 'action' && entry.name === 'summon'
    )
    expect(nested?.usageCount).toBeGreaterThan(0)
    expect(nested?.cardIds).toContain('classic_cenarius')
  })

  it('includes generated runtime cards in the catalog and capability audit', () => {
    expect(GENERATED_CARD_DEFINITIONS.length).toBeGreaterThan(0)
    for (const card of GENERATED_CARD_DEFINITIONS)
      expect(CARD_CATALOG.get(card.id)).toBe(card)
    expect(CAPABILITY_INVENTORY.cardCount).toBe(CARD_CATALOG.all.length)
    expect(
      CAPABILITY_INVENTORY.usage.some(
        (entry) =>
          entry.family === 'action' &&
          entry.name === 'modify' &&
          entry.cardIds.some((cardId) =>
            cardId.startsWith('goblins_vs_gnomes_spare_part_')
          )
      )
    ).toBe(true)
    expect(
      CAPABILITY_INVENTORY.usage.find(
        (entry) => entry.family === 'selector-field' && entry.name === 'selection'
      )?.usageCount
    ).toBeGreaterThan(0)
  })
})

describe('validated mana action types', () => {
  function validateAction(action: unknown): CardAction {
    const card = validateCardRecord(
      {
        ...CARD_CATALOG.require('basic_fireball'),
        effects: [{ trigger: 'cast', actions: [action] }]
      },
      'basic'
    )
    return card.effects![0]!.actions![0]!
  }

  it('narrows required fields and retains supported numeric expressions and extensions', () => {
    const amounts: readonly CardNumericValue<'full'>[] = [
      -1.5,
      'full',
      { random: [-1, 2.5] },
      {
        reference: 'source.health',
        operation: 'multiply',
        multiplier: 2,
        opponent: true
      },
      { operation: 'set', value: 3 },
      {
        condition: { type: 'combo' },
        thenValue: 'full',
        elseValue: { reference: 'event.amount' }
      }
    ]
    for (const amount of amounts) {
      const authored = {
        action: 'gain-mana',
        player: 'each',
        amount,
        crystal: 'full',
        duration: 'this-turn',
        count: 2
      } satisfies ManaCardAction
      const action = validateAction(authored)
      expect(action).toEqual(authored)
      if (action.action === 'gain-mana') {
        expectTypeOf(action.amount).toExtend<CardNumericValue<'full'>>()
        expectTypeOf(action.player).toEqualTypeOf<
          'each' | 'opponent' | 'self' | 'turn-player'
        >()
      }
    }
    expect(validateAction({ action: 'overload', amount: 2 })).toEqual({
      action: 'overload',
      amount: 2
    })
    expect(validateAction({ action: 'unlock-overload' })).toEqual({
      action: 'unlock-overload'
    })
    // These are compile-time contracts, never passed to the interpreter.
    expectTypeOf({
      action: 'gain-mana',
      amount: 1
    } as const).not.toExtend<ManaCardAction>()
    expectTypeOf({ action: 'overload' } as const).not.toExtend<ManaCardAction>()
    expectTypeOf({
      action: 'gain-mana',
      player: 'each',
      amount: true
    } as const).not.toExtend<CardAction>()
  })

  it.each([
    [{ action: 'gain-mana', amount: 1 }, '.player: is required for this action'],
    [{ action: 'overload' }, '.amount: is required for this action'],
    [
      { action: 'overload', amount: true },
      '.amount: expected a number or typed value reference'
    ],
    [
      { action: 'overload', amount: { random: [] } },
      '.amount.random: must not be empty'
    ],
    [
      { action: 'overload', amount: { operation: 'set' } },
      '.amount: an operation requires a value or reference'
    ]
  ])('preserves validation diagnostics for %j', (action, diagnostic) => {
    expect(() => validateAction(action)).toThrow(diagnostic)
  })
})

describe('card classification metadata', () => {
  it.each([
    ['classic_demolisher', 'Mech'],
    ['classic_harvest_golem', 'Mech'],
    ['goblins_vs_gnomes_mekgineer_thermaplugg', 'Mech'],
    ['the_grand_tournament_bear', 'Beast'],
    ['the_grand_tournament_boar', 'Beast'],
    ['the_grand_tournament_war_kodo', 'Beast'],
    ['the_grand_tournament_saber_charge_form', 'Beast'],
    ['the_grand_tournament_saber_stealth_form', 'Beast'],
    ['journey_to_ungoro_shellshifter_5_3_stealth', 'Beast'],
    ['journey_to_ungoro_shellshifter_3_5_taunt', 'Beast']
  ])('retains the verified tribe for %s', (id, tribe) => {
    expect(CARD_CATALOG.require(id)).toMatchObject({ type: 'Minion', subtype: tribe })
  })

  it('keeps Hero Jaraxxus out of Demon classification', () => {
    const card = CARD_CATALOG.require('classic_lord_jaraxxus')
    expect(card.type).toBe('Hero')
    expect(card.subtype).toBeNull()
    expect(card.tribes ?? []).toEqual([])
  })

  it('restricts school metadata to spells and tribe metadata to minions', () => {
    const minion = CARD_CATALOG.require('basic_bloodfen_raptor')
    const spell = CARD_CATALOG.require('basic_fireball')
    for (const card of CARD_CATALOG.all) {
      if (card.type !== 'Spell') expect(card.spellSchool, card.id).toBeNull()
      if (card.type !== 'Minion') {
        expect(card.subtype, card.id).toBeNull()
        expect(card.tribes ?? [], card.id).toEqual([])
      }
    }
    expect(() =>
      validateCardRecord({ ...minion, spellSchool: 'Fire' }, 'basic')
    ).toThrow('only valid for spells')
    expect(() => validateCardRecord({ ...spell, subtype: 'Demon' }, 'basic')).toThrow(
      'only valid for minions'
    )
    expect(() => validateCardRecord({ ...spell, tribes: ['Demon'] }, 'basic')).toThrow(
      'only valid for minions'
    )
    expect(() =>
      validateCardRecord({ ...spell, subtype: 'General', tribes: [] }, 'basic')
    ).not.toThrow()
    expect(() =>
      validateCardRecord({ ...spell, spellSchool: null }, 'basic')
    ).not.toThrow()
  })
})

describe('Future Past approved card content', () => {
  it('registers the approved collectibles and generated tokens', () => {
    const expansion = EXPANSION_CATALOG.require('future-past')
    expect(expansion.displayName).toBe('Future Past')
    expect(expansion.releaseOrder).toBe(12)
    expect(expansion.source).toBe(FUTURE_PAST_CARD_SOURCE)
    expect(expansion.sourceModule.expansionId).toBe('future-past')
    expect(expansion.sourceModule.load()).toBe(FUTURE_PAST_CARD_SOURCE)
    expect(FUTURE_PAST_CARD_SOURCE).toHaveLength(43)
    expect(FUTURE_PAST_CARD_SOURCE.filter((card) => card.collectible)).toHaveLength(27)
    expect(FUTURE_PAST_CARD_SOURCE.map((card) => card.id).sort()).toEqual([
      'future_past_agamaggan',
      'future_past_ancient_of_yore',
      'future_past_animated_broomstick',
      'future_past_armor_vendor',
      'future_past_bob_the_bartender',
      'future_past_carnivorous_cube',
      'future_past_corrupted_awakening',
      'future_past_corrupted_drake',
      'future_past_corrupted_dream',
      'future_past_corrupted_laughing_sister',
      'future_past_corrupted_nightmare',
      'future_past_critter_caretaker',
      'future_past_cursed_campaign',
      'future_past_cursed_catacombs',
      'future_past_dark_pact',
      'future_past_depth_charge',
      'future_past_domino_effect',
      'future_past_dragonscale_armaments',
      'future_past_dream',
      'future_past_emerald_drake',
      'future_past_find_a_triple',
      'future_past_freeze_the_shop',
      'future_past_fyrakk_the_blazing',
      'future_past_knight_of_anointment',
      'future_past_laughing_sister',
      'future_past_maiev_shadowsong',
      'future_past_miracle_salesman',
      'future_past_nightmare',
      'future_past_nozdormu_the_timeless',
      'future_past_order_in_the_court',
      'future_past_peasant',
      'future_past_puppetmaster_dorian',
      'future_past_raise_dead',
      'future_past_recruit_a_minion',
      'future_past_refresh_the_tavern',
      'future_past_shaladrassil',
      'future_past_shaladrassil_corrupted',
      'future_past_shallow_grave',
      'future_past_sing_along_buddy',
      'future_past_snake_oil',
      'future_past_table_flip',
      'future_past_touch_of_the_nathrezim',
      'future_past_ysera_awakens'
    ])
    for (const card of FUTURE_PAST_CARD_SOURCE) {
      expect(CARD_CATALOG.require(card.id)).toBe(card)
      expect(card.expansionId).toBe('future-past')
      expect(card.set).toBe('future-past')
      expect(card.deckLegal).toBe(card.collectible)
    }
    expect(CARD_CATALOG.require('future_past_snake_oil')).toMatchObject({
      type: 'Spell',
      cost: 0,
      keywords: ['tradeable'],
      collectible: false,
      deckLegal: false,
      spellSchool: null
    })
  })

  it.each([
    ['animated_broomstick', 1, 1, 1],
    ['armor_vendor', 1, 1, 3],
    ['critter_caretaker', 1, 2, 2],
    ['depth_charge', 1, 0, 5],
    ['knight_of_anointment', 1, 1, 1],
    ['miracle_salesman', 1, 2, 2],
    ['peasant', 1, 2, 1],
    ['sing_along_buddy', 3, 2, 4],
    ['nozdormu_the_timeless', 4, 8, 8]
  ])('pins approved minion stats for %s', (id, cost, attack, health) => {
    expect(CARD_CATALOG.require(`future_past_${id}`)).toMatchObject({
      type: 'Minion',
      cost,
      attack,
      health
    })
  })

  it('preserves the approved spells, tribes and existing eight-mana Uther', () => {
    expect(CARD_CATALOG.require('future_past_dragonscale_armaments')).toMatchObject({
      type: 'Spell',
      cost: 1,
      spellSchool: 'Holy'
    })
    expect(CARD_CATALOG.require('future_past_order_in_the_court')).toMatchObject({
      type: 'Spell',
      cost: 4,
      spellSchool: null,
      effects: [
        {
          trigger: 'cast',
          actions: [
            { action: 'sort-deck', player: 'self', order: 'descending' },
            { action: 'draw', player: 'self', count: 1 }
          ]
        }
      ]
    })
    expect(CARD_CATALOG.require('future_past_sing_along_buddy').subtype).toBe('Mech')
    expect(CARD_CATALOG.require('future_past_nozdormu_the_timeless').subtype).toBe(
      'Dragon'
    )
    expect(
      CARD_CATALOG.require('knights_of_the_frozen_throne_uther_of_the_ebon_blade')
    ).toMatchObject({
      type: 'Hero',
      cost: 8,
      armor: 5,
      replacementHeroId: 'uther-ebon-blade'
    })
  })
})
