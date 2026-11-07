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
    expansionId: 'rise-of-shadows'
  },
  {
    name: 'Adorable Infestation',
    cost: 1,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Druid', 'Hunter'],
    tribes: [],
    spellSchool: null,
    expansionId: 'scholomance-academy'
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
    expansionId: 'ashes-of-outland'
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
    expansionId: 'ashes-of-outland'
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
    expansionId: 'united-in-stormwind'
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
    expansionId: 'kobolds-and-catacombs'
  },
  {
    name: 'Ancient Mysteries',
    cost: 2,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Mage'],
    tribes: [],
    spellSchool: 'Arcane',
    expansionId: 'saviors-of-uldum'
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
    expansionId: 'saviors-of-uldum'
  },
  {
    name: 'Awakening Tremors',
    cost: 1,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Hunter'],
    tribes: [],
    spellSchool: null,
    expansionId: 'titans'
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
    expansionId: 'united-in-stormwind'
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
    expansionId: 'galakronds-awakening'
  },
  {
    name: 'Breath of Dreams',
    cost: 2,
    type: 'Spell',
    rarity: 'Rare',
    classes: ['Druid'],
    tribes: [],
    spellSchool: 'Nature',
    expansionId: 'descent-of-dragons'
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
    expansionId: 'perils-in-paradise'
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
    expansionId: 'united-in-stormwind'
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
    expansionId: 'voyage-to-the-sunken-city'
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
    expansionId: 'saviors-of-uldum'
  },
  {
    name: 'Crystology',
    cost: 1,
    type: 'Spell',
    rarity: 'Rare',
    classes: ['Paladin'],
    tribes: [],
    spellSchool: null,
    expansionId: 'the-boomsday-project'
  },
  {
    name: 'Cutting Class',
    cost: 5,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Rogue', 'Warrior'],
    tribes: [],
    spellSchool: null,
    expansionId: 'scholomance-academy'
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
    expansionId: 'showdown-in-the-badlands'
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
    expansionId: 'showdown-in-the-badlands'
  },
  {
    name: 'Dreamway Guardians',
    cost: 2,
    type: 'Spell',
    rarity: 'Rare',
    classes: ['Druid'],
    tribes: [],
    spellSchool: null,
    expansionId: 'rise-of-shadows'
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
    expansionId: 'kobolds-and-catacombs'
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
    expansionId: 'descent-of-dragons'
  },
  {
    name: 'Flame Ward',
    cost: 3,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Mage'],
    tribes: [],
    spellSchool: 'Fire',
    expansionId: 'saviors-of-uldum'
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
    expansionId: 'the-boomsday-project'
  },
  {
    name: 'Glowfly Swarm',
    cost: 5,
    type: 'Spell',
    rarity: 'Epic',
    classes: ['Druid'],
    tribes: [],
    spellSchool: null,
    expansionId: 'ashes-of-outland'
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
    expansionId: 'showdown-in-the-badlands'
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
    expansionId: 'united-in-stormwind'
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
    expansionId: 'the-witchwood'
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
    expansionId: 'showdown-in-the-badlands'
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
    expansionId: 'kobolds-and-catacombs'
  },
  {
    name: 'Libram of Hope',
    cost: 9,
    type: 'Spell',
    rarity: 'Epic',
    classes: ['Paladin'],
    tribes: [],
    spellSchool: 'Holy',
    expansionId: 'ashes-of-outland'
  },
  {
    name: 'Libram of Justice',
    cost: 5,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Paladin'],
    tribes: [],
    spellSchool: 'Holy',
    expansionId: 'ashes-of-outland'
  },
  {
    name: 'Libram of Wisdom',
    cost: 2,
    type: 'Spell',
    rarity: 'Rare',
    classes: ['Paladin'],
    tribes: [],
    spellSchool: 'Holy',
    expansionId: 'ashes-of-outland'
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
    expansionId: 'march-of-the-lich-king'
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
    expansionId: 'the-witchwood'
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
    expansionId: 'voyage-to-the-sunken-city'
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
    expansionId: 'the-boomsday-project'
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
    expansionId: 'into-the-emerald-dream'
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
    expansionId: 'madness-at-the-darkmoon-faire'
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
    expansionId: 'whizbangs-workshop'
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
    expansionId: 'kobolds-and-catacombs'
  },
  {
    name: 'Prismatic Beam',
    cost: 7,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Paladin'],
    tribes: [],
    spellSchool: null,
    expansionId: 'showdown-in-the-badlands'
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
    expansionId: 'madness-at-the-darkmoon-faire'
  },
  {
    name: 'Raiding Party',
    cost: 3,
    type: 'Spell',
    rarity: 'Rare',
    classes: ['Rogue'],
    tribes: [],
    spellSchool: null,
    expansionId: 'rastakhans-rumble'
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
    expansionId: 'galakronds-awakening'
  },
  {
    name: "Scavenger's Ingenuity",
    cost: 2,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Hunter'],
    tribes: [],
    spellSchool: null,
    expansionId: 'ashes-of-outland'
  },
  {
    name: 'Seafloor Gateway',
    cost: 3,
    type: 'Spell',
    rarity: 'Rare',
    classes: ['Mage'],
    tribes: [],
    spellSchool: null,
    expansionId: 'voyage-to-the-sunken-city'
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
    expansionId: 'voyage-to-the-sunken-city'
  },
  {
    name: 'Showdown!',
    cost: 2,
    type: 'Spell',
    rarity: 'Epic',
    classes: ['Paladin'],
    tribes: [],
    spellSchool: null,
    expansionId: 'showdown-in-the-badlands'
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
    expansionId: 'kobolds-and-catacombs'
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
    expansionId: 'showdown-in-the-badlands'
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
    expansionId: 'rastakhans-rumble'
  },
  {
    name: 'The Light! It Burns!',
    cost: 1,
    type: 'Spell',
    rarity: 'Common',
    classes: ['Priest'],
    tribes: [],
    spellSchool: 'Holy',
    expansionId: 'murder-at-castle-nathria'
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
    expansionId: 'the-witchwood'
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
    expansionId: 'kobolds-and-catacombs'
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
    expansionId: 'forged-in-the-barrens'
  }
] as const

describe('selected 57-card content snapshot', () => {
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
