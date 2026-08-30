import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, type CardTrigger } from '../../../game/content/cards'
import type { BoardMinion } from '../../../game/match'
import { boardAbilityMarkers, boardMinionRuntimeMarkers } from './board-ability-markers'

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

    expect(boardMinionRuntimeMarkers(minion, 1)).toEqual({
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

    expect(boardMinionRuntimeMarkers(minion, 1)).toEqual({
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
      temporaryAbilityLabels: []
    })
    expect(markers('classic_patient_assassin')).toMatchObject({
      poisonous: true,
      stealth: true,
      temporaryAbilityLabels: []
    })
    expect(markers('goblins_vs_gnomes_mini_mage').temporaryAbilityLabels).toEqual([
      'Spell Damage'
    ])
    expect(markers('goblins_vs_gnomes_mini_mage').stealth).toBe(true)
    expect(markers('classic_doomhammer').temporaryAbilityLabels).toEqual(['Windfury'])
    expect(markers('goblins_vs_gnomes_v_07_tr_0n').temporaryAbilityLabels).toEqual([
      'Mega Windfury'
    ])
    expect(markers('classic_faerie_dragon').temporaryAbilityLabels).toEqual([
      'Spell Immune'
    ])
    expect(markers('classic_ancient_watcher').temporaryAbilityLabels).toEqual([
      'Cannot Attack'
    ])
  })

  it('uses the Trigger asset for the persistent wrong-enemy attack effect', () => {
    expect(markers('goblins_vs_gnomes_ogre_brute')).toMatchObject({
      trigger: true,
      temporaryAbilityLabels: []
    })
    expect(markers('goblins_vs_gnomes_ogre_warmaul')).toMatchObject({
      trigger: true,
      temporaryAbilityLabels: []
    })
  })

  it('does not add a persistent badge for source-play Charge', () => {
    expect(markers('basic_stonetusk_boar').temporaryAbilityLabels).toEqual([])
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
})
