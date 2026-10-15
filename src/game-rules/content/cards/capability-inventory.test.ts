import { describe, expect, expectTypeOf, it } from 'vitest'
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
