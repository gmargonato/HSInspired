import { describe, expect, it } from 'vitest'
import {
  CARD_CATALOG,
  CARD_SET_SOURCES,
  EXPANSION_IDS,
  isCollectibleCard
} from './card-catalog'
import { CLASSIC_HERO_POWER_RECORDS } from './sets/classic'
import { CLASS_CATALOG } from '../classes'
import { EXPANSION_CATALOG } from '../expansions'
import { HERO_CATALOG } from '../heroes'
import { HERO_POWER_CATALOG } from '../hero-powers'

describe('canonical card catalog', () => {
  it('registers every planned expansion exactly once', () => {
    expect(CARD_SET_SOURCES).toHaveLength(EXPANSION_IDS.length)
    expect(CARD_CATALOG.size).toBeGreaterThan(600)
    expect(new Set(CARD_CATALOG.all.map((card) => card.id)).size).toBe(
      CARD_CATALOG.size
    )
  })

  it('keeps hero cards collectible while excluding them from deck cards', () => {
    const hero = CARD_CATALOG.require('classic_lord_jaraxxus')
    expect(isCollectibleCard(hero)).toBe(true)
    expect(hero.deckLegal).toBe(false)
  })

  it('keeps hero powers out of the card catalog', () => {
    expect(CLASSIC_HERO_POWER_RECORDS.length).toBeGreaterThan(0)
    expect(CARD_CATALOG.get('classic_life_tap')).toBeUndefined()
  })

  it('preserves the original release names and excludes later Priest additions', () => {
    const laterOrRevisedNames = [
      'Radiance',
      'Psychic Conjurer',
      'Power Infusion',
      'Kul Tiran Chaplain',
      'Scarlet Subjugator',
      'Shadow Word: Ruin',
      'Natalie Seline',
      'Focused Will',
      'Thrive in the Shadows',
      'Crimson Clergy',
      'Shadowed Spirit',
      'Icicle',
      'Tome of Intellect',
      'Call of the Void',
      'Pilfer',
      'Siegebreaker',
      'Gift of the Wild',
      'Righteousness',
      'Brightwing',
      'High Inquisitor Whitemane',
      'Barrens Stablehand',
      'SI:7 Infiltrator',
      'Arcane Devourer',
      'Queen of Pain',
      'Burrowing Mine'
    ]

    for (const name of laterOrRevisedNames) {
      expect(CARD_CATALOG.all.some((card) => card.name === name)).toBe(false)
    }

    expect(CARD_CATALOG.require('goblins_vs_gnomes_mistress_of_pain').name).toBe(
      'Mistress of Pain'
    )
    expect(CARD_CATALOG.require('goblins_vs_gnomes_imp_losion').rulesText).toBe(
      'Deal 2-4 damage. Summon 4 Imps, minus one for each damage dealt.'
    )
  })

  it('keeps each expansion source compatible with a future loader', () => {
    for (const expansion of EXPANSION_CATALOG.all) {
      expect(expansion.sourceModule.expansionId).toBe(expansion.id)
      expect(expansion.sourceModule.load()).toBe(expansion.source)
    }
  })

  it('resolves every class, hero, and hero-power relationship', () => {
    for (const classDefinition of CLASS_CATALOG.all) {
      for (const heroId of classDefinition.heroIds) {
        const hero = HERO_CATALOG.require(heroId)
        expect(hero.classId).toBe(classDefinition.id)
        expect(HERO_POWER_CATALOG.require(hero.heroPowerId).classId).toBe(
          classDefinition.id
        )
      }
    }
  })
})
