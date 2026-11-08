import { describe, expect, it } from 'vitest'
import { CARD_CATALOG } from './index'
import { SHORTLIST_CARD_SOURCE } from './sets/shortlist'
import { EXPANSION_CATALOG } from '../expansions'

// Transcribed from the selected November 2026 card renders, independently of definitions.
// Keep this snapshot pinned: later official balance changes are not this selection.
const selected = [
  {
    name: 'Acornbearer',
    cost: 1,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Druid'],
    tribes: [],
    spellSchool: null,
    attack: 2,
    health: 1,
    expansionId: 'future-past'
  },
  {
    name: 'Adorable Infestation',
    cost: 1,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Druid', 'Hunter'],
    tribes: [],
    spellSchool: null,
    expansionId: 'future-past'
  },
  {
    name: 'Aldor Attendant',
    cost: 1,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Paladin'],
    tribes: ['Draenei'],
    spellSchool: null,
    attack: 1,
    health: 3,
    expansionId: 'future-past'
  },
  {
    name: 'Aldor Truthseeker',
    cost: 5,
    type: 'Minion',
    rarity: 'Rare',
    classes: ['Paladin'],
    tribes: ['Draenei'],
    spellSchool: null,
    attack: 4,
    health: 6,
    expansionId: 'future-past'
  },
  {
    name: 'Alliance Bannerman',
    cost: 3,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Paladin'],
    tribes: [],
    spellSchool: null,
    attack: 2,
    health: 2,
    expansionId: 'future-past'
  },
  {
    name: 'Aluneth',
    cost: 6,
    type: 'Weapon',
    rarity: 'Legendary',
    classes: ['Mage'],
    tribes: [],
    spellSchool: null,
    attack: 0,
    durability: 3,
    expansionId: 'future-past'
  },
  {
    name: 'Ancient Mysteries',
    cost: 2,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Mage'],
    tribes: [],
    spellSchool: 'Arcane',
    expansionId: 'future-past'
  },
  {
    name: 'Arcane Flakmage',
    cost: 2,
    type: 'Minion',
    rarity: 'Rare',
    classes: ['Mage'],
    tribes: [],
    spellSchool: null,
    attack: 3,
    health: 2,
    expansionId: 'future-past'
  },
  {
    name: 'Awakening Tremors',
    cost: 1,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Hunter'],
    tribes: [],
    spellSchool: null,
    expansionId: 'future-past'
  },
  {
    name: 'Battleground Battlemaster',
    cost: 6,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Neutral'],
    tribes: [],
    spellSchool: null,
    attack: 5,
    health: 5,
    expansionId: 'future-past'
  },
  {
    name: 'Bomb Wrangler',
    cost: 3,
    type: 'Minion',
    rarity: 'Rare',
    classes: ['Warrior'],
    tribes: [],
    spellSchool: null,
    attack: 2,
    health: 3,
    expansionId: 'future-past'
  },
  {
    name: 'Breath of Dreams',
    cost: 2,
    type: 'Spell',
    rarity: 'Rare',
    classes: ['Druid'],
    tribes: [],
    spellSchool: 'Nature',
    expansionId: 'future-past'
  },
  {
    name: 'Busy-Bot',
    cost: 2,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Paladin'],
    tribes: ['Mech'],
    spellSchool: null,
    attack: 3,
    health: 2,
    expansionId: 'future-past'
  },
  {
    name: 'Canal Slogger',
    cost: 4,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Shaman'],
    tribes: ['Elemental'],
    spellSchool: null,
    attack: 6,
    health: 4,
    expansionId: 'future-past'
  },
  {
    name: 'Click-Clocker',
    cost: 1,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Neutral'],
    tribes: ['Mech', 'Beast'],
    spellSchool: null,
    attack: 1,
    health: 1,
    expansionId: 'future-past'
  },
  {
    name: 'Cloud Prince',
    cost: 5,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Mage'],
    tribes: ['Elemental'],
    spellSchool: null,
    attack: 4,
    health: 4,
    expansionId: 'future-past'
  },
  {
    name: 'Crystology',
    cost: 1,
    type: 'Spell',
    rarity: 'Rare',
    classes: ['Paladin'],
    tribes: [],
    spellSchool: null,
    expansionId: 'future-past'
  },
  {
    name: 'Cutting Class',
    cost: 5,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Rogue', 'Warrior'],
    tribes: [],
    spellSchool: null,
    expansionId: 'future-past'
  },
  {
    name: 'Desert Nestmatron',
    cost: 4,
    type: 'Minion',
    rarity: 'Rare',
    classes: ['Druid'],
    tribes: ['Dragon'],
    spellSchool: null,
    attack: 3,
    health: 5,
    expansionId: 'future-past'
  },
  {
    name: 'Dragon Golem',
    cost: 7,
    type: 'Minion',
    rarity: 'Epic',
    classes: ['Druid'],
    tribes: ['Dragon'],
    spellSchool: null,
    attack: 3,
    health: 4,
    expansionId: 'future-past'
  },
  {
    name: 'Dreamway Guardians',
    cost: 2,
    type: 'Spell',
    rarity: 'Rare',
    classes: ['Druid'],
    tribes: [],
    spellSchool: null,
    expansionId: 'future-past'
  },
  {
    name: 'Duskbreaker',
    cost: 4,
    type: 'Minion',
    rarity: 'Rare',
    classes: ['Priest'],
    tribes: ['Dragon'],
    spellSchool: null,
    attack: 3,
    health: 3,
    expansionId: 'future-past'
  },
  {
    name: 'Emerald Explorer',
    cost: 6,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Druid'],
    tribes: ['Dragon'],
    spellSchool: null,
    attack: 4,
    health: 8,
    expansionId: 'future-past'
  },
  {
    name: 'Flame Ward',
    cost: 3,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Mage'],
    tribes: [],
    spellSchool: 'Fire',
    expansionId: 'future-past'
  },
  {
    name: 'Galvanizer',
    cost: 2,
    type: 'Minion',
    rarity: 'Rare',
    classes: ['Neutral'],
    tribes: ['Mech'],
    spellSchool: null,
    attack: 1,
    health: 2,
    expansionId: 'future-past'
  },
  {
    name: 'Glowfly Swarm',
    cost: 5,
    type: 'Spell',
    rarity: 'Epic',
    classes: ['Druid'],
    tribes: [],
    spellSchool: null,
    expansionId: 'future-past'
  },
  {
    name: 'Gold Panner',
    cost: 2,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Neutral'],
    tribes: [],
    spellSchool: null,
    attack: 1,
    health: 2,
    expansionId: 'future-past'
  },
  {
    name: 'Granite Forgeborn',
    cost: 4,
    type: 'Minion',
    rarity: 'Rare',
    classes: ['Shaman'],
    tribes: ['Elemental'],
    spellSchool: null,
    attack: 4,
    health: 5,
    expansionId: 'future-past'
  },
  {
    name: 'Hench-Clan Thug',
    cost: 3,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Neutral'],
    tribes: ['Quilboar'],
    spellSchool: null,
    attack: 3,
    health: 3,
    expansionId: 'future-past'
  },
  {
    name: 'Hi Ho Silverwing',
    cost: 2,
    type: 'Minion',
    rarity: 'Rare',
    classes: ['Paladin'],
    tribes: ['Dragon'],
    spellSchool: null,
    attack: 2,
    health: 1,
    expansionId: 'future-past'
  },
  {
    name: 'Kobold Librarian',
    cost: 1,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Warlock'],
    tribes: [],
    spellSchool: null,
    attack: 2,
    health: 1,
    expansionId: 'future-past'
  },
  {
    name: 'Libram of Hope',
    cost: 9,
    type: 'Spell',
    rarity: 'Epic',
    classes: ['Paladin'],
    tribes: [],
    spellSchool: 'Holy',
    expansionId: 'future-past'
  },
  {
    name: 'Libram of Justice',
    cost: 5,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Paladin'],
    tribes: [],
    spellSchool: 'Holy',
    expansionId: 'future-past'
  },
  {
    name: 'Libram of Wisdom',
    cost: 2,
    type: 'Spell',
    rarity: 'Rare',
    classes: ['Paladin'],
    tribes: [],
    spellSchool: 'Holy',
    expansionId: 'future-past'
  },
  {
    name: 'Lingering Zombie',
    cost: 1,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Druid'],
    tribes: ['Undead'],
    spellSchool: null,
    attack: 1,
    health: 1,
    expansionId: 'future-past'
  },
  {
    name: 'Lord Godfrey',
    cost: 7,
    type: 'Minion',
    rarity: 'Legendary',
    classes: ['Warlock'],
    tribes: ['Undead'],
    spellSchool: null,
    attack: 4,
    health: 4,
    expansionId: 'future-past'
  },
  {
    name: 'Mecha-Shark',
    cost: 3,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Mage'],
    tribes: ['Mech', 'Beast'],
    spellSchool: null,
    attack: 4,
    health: 3,
    expansionId: 'future-past'
  },
  {
    name: 'Mecharoo',
    cost: 1,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Neutral'],
    tribes: ['Mech', 'Beast'],
    spellSchool: null,
    attack: 1,
    health: 1,
    expansionId: 'future-past'
  },
  {
    name: 'Mother Duck',
    cost: 4,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Neutral'],
    tribes: ['Beast'],
    spellSchool: null,
    attack: 2,
    health: 3,
    expansionId: 'future-past'
  },
  {
    name: 'Occult Conjurer',
    cost: 4,
    type: 'Minion',
    rarity: 'Epic',
    classes: ['Mage'],
    tribes: [],
    spellSchool: null,
    attack: 4,
    health: 4,
    expansionId: 'future-past'
  },
  {
    name: "Painter's Virtue",
    cost: 4,
    type: 'Weapon',
    rarity: 'Common',
    classes: ['Paladin'],
    tribes: [],
    spellSchool: null,
    attack: 2,
    durability: 3,
    expansionId: 'future-past'
  },
  {
    name: 'Possessed Lackey',
    cost: 5,
    type: 'Minion',
    rarity: 'Rare',
    classes: ['Warlock'],
    tribes: [],
    spellSchool: null,
    attack: 2,
    health: 2,
    expansionId: 'future-past'
  },
  {
    name: 'Prismatic Beam',
    cost: 7,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Paladin'],
    tribes: [],
    spellSchool: null,
    expansionId: 'future-past'
  },
  {
    name: 'Prize Plunderer',
    cost: 1,
    type: 'Minion',
    rarity: 'Rare',
    classes: ['Rogue'],
    tribes: ['Pirate'],
    spellSchool: null,
    attack: 2,
    health: 1,
    expansionId: 'future-past'
  },
  {
    name: 'Raiding Party',
    cost: 3,
    type: 'Spell',
    rarity: 'Rare',
    classes: ['Rogue'],
    tribes: [],
    spellSchool: null,
    expansionId: 'future-past'
  },
  {
    name: 'Risky Skipper',
    cost: 1,
    type: 'Minion',
    rarity: 'Rare',
    classes: ['Warrior'],
    tribes: ['Pirate'],
    spellSchool: null,
    attack: 1,
    health: 3,
    expansionId: 'future-past'
  },
  {
    name: "Scavenger's Ingenuity",
    cost: 2,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Hunter'],
    tribes: [],
    spellSchool: null,
    expansionId: 'future-past'
  },
  {
    name: 'Seafloor Gateway',
    cost: 3,
    type: 'Spell',
    rarity: 'Rare',
    classes: ['Mage'],
    tribes: [],
    spellSchool: null,
    expansionId: 'future-past'
  },
  {
    name: 'Security Automaton',
    cost: 2,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Neutral'],
    tribes: ['Mech'],
    spellSchool: null,
    attack: 1,
    health: 3,
    expansionId: 'future-past'
  },
  {
    name: 'Showdown!',
    cost: 2,
    type: 'Spell',
    rarity: 'Epic',
    classes: ['Paladin'],
    tribes: [],
    spellSchool: null,
    expansionId: 'future-past'
  },
  {
    name: "Skull of the Man'ari",
    cost: 5,
    type: 'Weapon',
    rarity: 'Legendary',
    classes: ['Warlock'],
    tribes: [],
    spellSchool: null,
    attack: 0,
    durability: 3,
    expansionId: 'future-past'
  },
  {
    name: 'Splish-Splash Whelp',
    cost: 2,
    type: 'Minion',
    rarity: 'Rare',
    classes: ['Druid'],
    tribes: ['Dragon'],
    spellSchool: null,
    attack: 2,
    health: 1,
    expansionId: 'future-past'
  },
  {
    name: 'Springpaw',
    cost: 1,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Hunter'],
    tribes: ['Beast'],
    spellSchool: null,
    attack: 1,
    health: 1,
    expansionId: 'future-past'
  },
  {
    name: 'The Light! It Burns!',
    cost: 1,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Priest'],
    tribes: [],
    spellSchool: 'Holy',
    expansionId: 'future-past'
  },
  {
    name: 'Vicious Scalehide',
    cost: 2,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Neutral'],
    tribes: ['Beast'],
    spellSchool: null,
    attack: 1,
    health: 3,
    expansionId: 'future-past'
  },
  {
    name: 'Voidlord',
    cost: 9,
    type: 'Minion',
    rarity: 'Epic',
    classes: ['Warlock'],
    tribes: ['Demon'],
    spellSchool: null,
    attack: 3,
    health: 9,
    expansionId: 'future-past'
  },
  {
    name: 'Wailing Vapor',
    cost: 1,
    type: 'Minion',
    rarity: 'Common',
    classes: ['Shaman'],
    tribes: ['Elemental'],
    spellSchool: null,
    attack: 1,
    health: 3,
    expansionId: 'future-past'
  }
] as const

describe('selected 57-card content snapshot', () => {
  it('groups every new card and token under Future Past without adding expansion filters', () => {
    const futurePast = EXPANSION_CATALOG.require('future-past')
    expect(EXPANSION_CATALOG.all).toHaveLength(13)
    for (const card of SHORTLIST_CARD_SOURCE) {
      expect(card.expansionId).toBe('future-past')
      expect(card.set).toBe('future-past')
      expect(futurePast.source).toContainEqual(card)
    }
    expect(futurePast.source.map((card) => card.id)).toEqual(
      CARD_CATALOG.all
        .filter((card) => card.expansionId === 'future-past')
        .map((card) => card.id)
    )
  })

  it('registers exactly the selected collectible names and 12 generated tokens', () => {
    const collectible = SHORTLIST_CARD_SOURCE.filter((card) => card.collectible)
    expect(collectible.map((card) => card.name).sort()).toEqual(
      selected.map((card) => card.name).sort()
    )
    expect(collectible).toHaveLength(57)
    const tokens = SHORTLIST_CARD_SOURCE.filter((card) => !card.collectible)
    expect(tokens).toHaveLength(12)
    expect(tokens.every((card) => !card.deckLegal)).toBe(true)
  })

  it.each(selected)('preserves the selected printed version of $name', (snapshot) => {
    const card = SHORTLIST_CARD_SOURCE.find((card) => card.name === snapshot.name)!
    expect(card).toBeDefined()
    expect(card).toMatchObject({
      cost: snapshot.cost,
      type: snapshot.type,
      rarity: snapshot.rarity,
      spellSchool: snapshot.spellSchool,
      expansionId: snapshot.expansionId
    })
    expect([...(card.allowedClasses ?? [card.cardClass])].sort()).toEqual(
      [...snapshot.classes].sort()
    )
    for (const field of ['attack', 'health', 'durability'] as const) {
      if (field in snapshot)
        expect(card).toHaveProperty(field, snapshot[field as keyof typeof snapshot])
    }
    expect([...(card.tribes ?? (card.subtype ? [card.subtype] : []))].sort()).toEqual(
      [...snapshot.tribes].sort()
    )
    expect(CARD_CATALOG.require(card.id)).toEqual(card)
    expect(EXPANSION_CATALOG.require(card.expansionId).source).toContainEqual(card)
  })
})
