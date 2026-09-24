import { describe, expect, it } from 'vitest'
import { markHearthstoneKeywords } from '../../rendering/cards/card-text-markup'
import { CARD_CATALOG, type CardTrigger } from '../../../game/content/cards'
import {
  isBoardMinionSleeping,
  type BoardMinion,
  type RuntimeEnchantment
} from '../../../game/match'
import {
  boardAbilityMarkers,
  boardMinionAbilityMarkers,
  boardMinionRuntimeMarkers
} from './board-ability-markers'

function markers(cardId: string) {
  return boardAbilityMarkers(CARD_CATALOG.require(cardId))
}

function markersForTrigger(trigger: CardTrigger) {
  return boardAbilityMarkers({
    keywords: [],
    effects: [{ trigger, actions: [{ action: 'draw' }] }]
  })
}

describe('board ability markers', () => {
  it('shows Enrage only while an unsilenced Enrage minion is damaged', () => {
    const grommash = CARD_CATALOG.require('classic_grommash_hellscream')
    const minion = {
      instanceId: 'grommash',
      attack: 10,
      summonedOnTurn: 1,
      lastAttackedOnTurn: null,
      cardId: grommash.id,
      keywords: ['charge'],
      health: 8,
      maxHealth: 9
    } as BoardMinion
    expect(boardMinionAbilityMarkers(minion, grommash, 1).enraged).toBe(true)
    expect(
      boardMinionAbilityMarkers({ ...minion, health: 9 }, grommash, 1).enraged
    ).toBe(false)
    expect(
      boardMinionAbilityMarkers({ ...minion, silenced: true }, grommash, 1).enraged
    ).toBe(false)
    expect(
      boardMinionAbilityMarkers(minion, { keywords: [], effects: [] }, 1).enraged
    ).toBe(false)
  })

  it('uses resolved granted abilities and hides them after removal or silence', () => {
    const minion = {
      cardId: CARD_CATALOG.require('basic_stonetusk_boar').id,
      keywords: [],
      health: 1,
      maxHealth: 1,
      maxAttacksPerTurn: 4,
      spellDamage: 2,
      spellImmune: true,
      immune: true
    } as unknown as BoardMinion
    const visible = { windfury: true, spellDamage: true, elusive: true, immune: true }
    const hidden = {
      windfury: false,
      spellDamage: false,
      elusive: false,
      immune: false
    }
    expect(boardMinionRuntimeMarkers(minion, 1)).toMatchObject(visible)
    expect(
      boardMinionRuntimeMarkers(
        {
          ...minion,
          maxAttacksPerTurn: 1,
          spellDamage: 0,
          spellImmune: false,
          immune: false
        },
        2
      )
    ).toMatchObject(hidden)
    expect(boardMinionRuntimeMarkers({ ...minion, silenced: true }, 1)).toMatchObject(
      hidden
    )
  })

  it('uses controller-change exhaustion unless a current Charge effect overrides it', () => {
    const boar = CARD_CATALOG.require('basic_stonetusk_boar')
    const shadowMadness = CARD_CATALOG.require('classic_shadow_madness')
    const temporaryControlCharge: RuntimeEnchantment = {
      id: 'temporary-control-charge',
      sourceInstanceId: 'shadow-madness',
      sourceCardId: shadowMadness.id,
      keywords: ['charge'],
      startsOnTurn: 3,
      expiresOnTurn: 3,
      duration: 'this-turn'
    }
    const controlledMinion = {
      instanceId: 'controlled-minion',
      cardId: boar.id,
      attack: 1,
      health: 1,
      maxHealth: 1,
      summonedOnTurn: 1,
      controllerChangedOnTurn: 3,
      lastAttackedOnTurn: null,
      keywords: [],
      divineShield: false,
      stealth: false,
      enchantments: []
    } as BoardMinion

    expect(isBoardMinionSleeping(controlledMinion, 3)).toBe(true)

    expect(
      isBoardMinionSleeping(
        {
          ...controlledMinion,
          enchantments: [temporaryControlCharge]
        },
        3
      )
    ).toBe(false)
  })

  it('projects granted Taunt and consumed Divine Shield from runtime state', () => {
    const annoyOTron = CARD_CATALOG.require('goblins_vs_gnomes_annoy_o_tron')
    const sunfury = CARD_CATALOG.require('classic_sunfury_protector')
    const minion = {
      instanceId: 'minion-1',
      cardId: annoyOTron.id,
      attack: 1,
      health: 2,
      maxHealth: 2,
      summonedOnTurn: 1,
      lastAttackedOnTurn: null,
      keywords: ['divine-shield'],
      divineShield: false,
      stealth: false,
      enchantments: [
        {
          id: 'sunfury-keyword',
          sourceInstanceId: 'sunfury',
          sourceCardId: sunfury.id,
          keywords: ['taunt']
        }
      ]
    } as BoardMinion

    expect(boardMinionRuntimeMarkers(minion, 1)).toMatchObject({
      taunt: true,
      divineShield: false,
      stealth: false
    })
  })

  it('does not show runtime keywords on a silenced minion', () => {
    const footman = CARD_CATALOG.require('basic_goldshire_footman')
    const minion = {
      instanceId: 'minion-2',
      cardId: footman.id,
      attack: 1,
      health: 2,
      maxHealth: 2,
      summonedOnTurn: 1,
      lastAttackedOnTurn: null,
      keywords: ['taunt'],
      divineShield: true,
      stealth: true,
      silenced: true
    } as BoardMinion

    expect(boardMinionRuntimeMarkers(minion, 1)).toMatchObject({
      taunt: false,
      divineShield: false,
      stealth: false
    })
  })

  it('maps intrinsic Taunt and Divine Shield keywords', () => {
    expect(markers('goblins_vs_gnomes_annoy_o_tron')).toMatchObject({
      taunt: true,
      divineShield: true
    })
  })

  it('maps minion and weapon Deathrattles', () => {
    expect(markers('naxxramas_sludge_belcher').deathrattle).toBe(true)
    expect(markers('naxxramas_deaths_bite').deathrattle).toBe(true)
    expect(markers('goblins_vs_gnomes_powermace').deathrattle).toBe(true)
  })

  it('maps repeatable in-play minion and weapon triggers', () => {
    expect(markers('classic_knife_juggler').trigger).toBe(true)
    expect(markers('classic_sword_of_justice').trigger).toBe(true)
  })

  it('maps Inspire separately from the generic Trigger badge', () => {
    expect(markers('the_grand_tournament_savage_combatant')).toMatchObject({
      inspire: true,
      trigger: false
    })
  })

  it.each([
    'end-of-turn',
    'on-attack',
    'on-card-played',
    'on-cast',
    'on-damage',
    'on-death',
    'on-gain-armor',
    'on-heal',
    'on-secret-played',
    'on-secret-revealed',
    'on-summon',
    'start-of-turn'
  ] satisfies readonly CardTrigger[])('maps %s as an in-play trigger', (trigger) => {
    expect(markersForTrigger(trigger).trigger).toBe(true)
  })

  it.each([
    'aura',
    'battlecry',
    'cast',
    'deathrattle',
    'inspire',
    'on-draw',
    'on-play',
    'secret',
    'while-in-hand'
  ] satisfies readonly CardTrigger[])(
    'does not map %s to the Trigger badge',
    (trigger) => {
      expect(markersForTrigger(trigger).trigger).toBe(false)
    }
  )

  it('excludes source-play Overload and deferred Poison visuals', () => {
    expect(markers('classic_doomhammer').trigger).toBe(false)
    expect(markers('classic_emperor_cobra').trigger).toBe(false)
  })

  it('uses authored Poisonous and Stealth indicators instead of temporary labels', () => {
    expect(markers('classic_emperor_cobra')).toMatchObject({
      poisonous: true,
      windfury: false,
      spellDamage: false,
      elusive: false,
      immune: false
    })
    expect(markers('classic_patient_assassin')).toMatchObject({
      poisonous: true,
      stealth: true,
      windfury: false,
      spellDamage: false,
      elusive: false,
      immune: false
    })
    expect(markers('goblins_vs_gnomes_mini_mage').spellDamage).toBe(true)
    expect(markers('goblins_vs_gnomes_mini_mage').stealth).toBe(true)
    expect(markers('classic_doomhammer').windfury).toBe(true)
    expect(markers('goblins_vs_gnomes_v_07_tr_0n').windfury).toBe(true)
    expect(markers('classic_faerie_dragon').elusive).toBe(true)
    expect(markers('classic_ancient_watcher')).toMatchObject({
      windfury: false,
      spellDamage: false,
      elusive: false,
      immune: false
    })
  })

  it('maps Lifesteal from the normalized minion keyword', () => {
    expect(markers('goblins_vs_gnomes_mistress_of_pain').lifesteal).toBe(true)
    expect(markers('mean_streets_of_gadgetzan_wickerflame_burnbristle').lifesteal).toBe(
      true
    )
  })

  it('grants Frost Lich Jaina Elementals the Lifesteal badge', () => {
    const waterElemental = CARD_CATALOG.require('basic_water_elemental')
    const elementalMinion = {
      instanceId: 'water-elemental',
      cardId: waterElemental.id,
      attack: waterElemental.attack,
      health: waterElemental.health,
      maxHealth: waterElemental.health,
      keywords: [],
      summonedOnTurn: 1,
      lastAttackedOnTurn: null
    } as BoardMinion

    expect(
      boardMinionAbilityMarkers(
        elementalMinion,
        waterElemental,
        1,
        'jaina-frost-lich'
      ).lifesteal
    ).toBe(true)
    expect(
      boardMinionAbilityMarkers(elementalMinion, waterElemental, 1, 'jaina')
        .lifesteal
    ).toBe(false)
    expect(boardMinionAbilityMarkers(elementalMinion, waterElemental, 1).lifesteal).toBe(
      false
    )

    const noElemental = CARD_CATALOG.require('basic_goldshire_footman')
    const footmanMinion = {
      instanceId: 'footman',
      cardId: noElemental.id,
      attack: noElemental.attack,
      health: noElemental.health,
      maxHealth: noElemental.health,
      keywords: [],
      summonedOnTurn: 1,
      lastAttackedOnTurn: null
    } as BoardMinion
    expect(
      boardMinionAbilityMarkers(footmanMinion, noElemental, 1, 'jaina-frost-lich')
        .lifesteal
    ).toBe(false)
  })

  it('maps board-targeting Auras independently from the Trigger badge', () => {
    expect(markers('basic_grimscale_oracle')).toMatchObject({
      aura: true,
      trigger: false
    })
    expect(markers('classic_dire_wolf_alpha')).toMatchObject({
      aura: true,
      trigger: false
    })
    expect(markers('basic_stormwind_champion')).toMatchObject({
      aura: true,
      trigger: false
    })
    expect(markers('league_of_explorers_brann_bronzebeard')).toMatchObject({
      aura: true,
      trigger: false
    })
    expect(markers('naxxramas_baron_rivendare')).toMatchObject({
      aura: true,
      trigger: false
    })
    expect(markers('whispers_of_the_old_gods_bloodhoof_brave')).toMatchObject({
      aura: false,
      trigger: false
    })
    expect(markers('classic_lightspawn')).toMatchObject({
      aura: false,
      trigger: false
    })
    expect(markers('classic_sorcerers_apprentice')).toMatchObject({
      aura: false,
      trigger: false
    })
  })

  it('hides a board Aura when its minion is silenced', () => {
    const stormwind = CARD_CATALOG.require('basic_stormwind_champion')
    if (stormwind.type !== 'Minion')
      throw new Error('Expected Stormwind Champion to be a minion')
    const minion = {
      instanceId: 'stormwind',
      cardId: stormwind.id,
      attack: stormwind.attack,
      health: stormwind.health,
      maxHealth: stormwind.health,
      keywords: [],
      summonedOnTurn: 1,
      lastAttackedOnTurn: null
    } as BoardMinion

    expect(boardMinionAbilityMarkers(minion, stormwind, 1).aura).toBe(true)
    expect(
      boardMinionAbilityMarkers({ ...minion, silenced: true }, stormwind, 1).aura
    ).toBe(false)
  })

  it('keeps Aura and Trigger independent when a definition contains both', () => {
    expect(
      boardAbilityMarkers({
        keywords: [],
        effects: [
          {
            trigger: 'aura',
            actions: [
              { action: 'modify', target: { type: 'minion', selection: 'all' } }
            ]
          },
          { trigger: 'on-attack' }
        ]
      })
    ).toMatchObject({ aura: true, trigger: true })
  })

  it('uses the Trigger asset for the persistent wrong-enemy attack effect', () => {
    expect(markers('goblins_vs_gnomes_ogre_brute')).toMatchObject({
      trigger: true,
      windfury: false,
      spellDamage: false,
      elusive: false,
      immune: false
    })
    expect(markers('goblins_vs_gnomes_ogre_warmaul')).toMatchObject({
      trigger: true,
      windfury: false,
      spellDamage: false,
      elusive: false,
      immune: false
    })
  })

  it('does not add a persistent badge for source-play Charge', () => {
    expect(markers('basic_stonetusk_boar')).toMatchObject({
      windfury: false,
      spellDamage: false,
      elusive: false,
      immune: false
    })
  })

  it("shows Iron Juggernaut's deathrattle marker", () => {
    expect(markers('goblins_vs_gnomes_iron_juggernaut').deathrattle).toBe(true)
  })

  it('keeps Deathrattle and Trigger independently visible', () => {
    expect(
      boardAbilityMarkers({
        keywords: [],
        effects: [{ trigger: 'deathrattle' }, { trigger: 'start-of-turn' }]
      })
    ).toMatchObject({ deathrattle: true, trigger: true })
  })

  it('keeps Deathrattle, Trigger, and Inspire independently visible', () => {
    expect(
      boardAbilityMarkers({
        keywords: [],
        effects: [
          { trigger: 'deathrattle' },
          { trigger: 'start-of-turn' },
          { trigger: 'inspire' }
        ]
      })
    ).toMatchObject({ deathrattle: true, trigger: true, inspire: true })
  })
})

it('uses modern bold keywords across matching card descriptions', () => {
  for (const [id, text] of [
    ['classic_patient_assassin', 'Stealth. Poisonous.'],
    ['classic_emperor_cobra', 'Poisonous.'],
    ['naxxramas_maexxna', 'Poisonous.'],
    ['league_of_explorers_pit_snake', 'Poisonous.'],
    ['classic_faerie_dragon', 'Elusive.'],
    ['classic_laughing_sister', 'Elusive.'],
    ['naxxramas_spectral_knight', 'Elusive.'],
    ['goblins_vs_gnomes_arcane_nullifier_x_21', 'Taunt. Elusive.'],
    ['goblins_vs_gnomes_wee_spellstopper', 'Adjacent minions have Elusive.'],
    ['goblins_vs_gnomes_mistress_of_pain', 'Lifesteal.'],
    [
      'mean_streets_of_gadgetzan_wickerflame_burnbristle',
      'Divine Shield. Taunt. Lifesteal.'
    ],
    ['the_grand_tournament_icehowl', 'Rush.']
  ]) {
    expect(CARD_CATALOG.require(id!).rulesText).toBe(text)
    const keyword = text!.match(/Poisonous|Elusive|Lifesteal|Rush/)![0]
    expect(markHearthstoneKeywords(text!)).toContain(
      '<keyword>' + keyword + '</keyword>'
    )
  }
})
