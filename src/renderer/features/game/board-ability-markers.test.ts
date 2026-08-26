import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, type CardTrigger } from '../../../game/content/cards'
import { boardAbilityMarkers } from './board-ability-markers'

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

  it('uses temporary labels for persistent abilities without authored board art', () => {
    expect(markers('classic_emperor_cobra').temporaryAbilityLabels).toEqual([
      'Poisonous'
    ])
    expect(markers('classic_patient_assassin').temporaryAbilityLabels).toEqual([
      'Poisonous',
      'Stealth'
    ])
    expect(markers('goblins_vs_gnomes_mini_mage').temporaryAbilityLabels).toEqual([
      'Stealth',
      'Spell Damage'
    ])
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

  it('uses original GvG Iron Juggernaut metadata', () => {
    expect(markers('goblins_vs_gnomes_iron_juggernaut').deathrattle).toBe(false)
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
