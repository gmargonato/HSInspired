import { SHORTLISTED_OPPONENT_DECK_DEFINITIONS } from './shortlisted-opponent-decks'
import {
  CARD_CATALOG,
  isCardAllowedForClass,
  EXPANSION_IDS,
  PLAYABLE_CLASSES,
  type CardDefinition,
  type DeckClass
} from '../content/cards'
import { HERO_CATALOG } from '../content/heroes'
import { MAX_DECK_CARDS, type Deck } from './deck'
import { DeckRules, isCollectibleDeckCard } from './deck-rules'
import type { OpponentStrategyBrief } from './opponent-strategy'
import type { ExpertDeckStrategyProfileId } from './expert-deck-strategy'

export const CURATED_OPPONENT_CATALOG_VERSION = 4

const HISTORICAL_EXPANSIONS: ReadonlySet<string> = new Set([
  'basic',
  'classic',
  'goblins-vs-gnomes',
  'naxxramas',
  'blackrock-mountain',
  'league-of-explorers',
  'the-grand-tournament',
  'one-night-in-karazhan',
  'whispers-of-the-old-gods',
  'mean-streets-of-gadgetzan',
  'journey-to-ungoro',
  'knights-of-the-frozen-throne'
])

export interface CuratedOpponentSource {
  readonly title: string
  readonly url: string
  /** Where the original deck was published, when the source supplies a date. */
  readonly publishedAt?: string
  /** These historical lists are eligible for the game's shared Wild card pool. */
  readonly format: 'wild-legal'
}

export interface CuratedOpponentDeckDefinition {
  readonly id: string
  readonly name: string
  /** Optional compact name for the persisted fifteen-character deck-name limit. */
  readonly deckName?: string
  readonly classId: DeckClass
  readonly source: CuratedOpponentSource
  readonly plan: string
  /** Local Expert evaluation pilot; omitted decks keep general evaluation. */
  readonly expertStrategyProfileId?: ExpertDeckStrategyProfileId
  /** Approved local adaptation: exact card names and counts for this catalog. */
  readonly cardList: Readonly<Record<string, number>>
}

export interface CuratedOpponentDeck {
  readonly definition: CuratedOpponentDeckDefinition
  readonly deck: Deck
  readonly strategy: OpponentStrategyBrief
}

const source = (
  title: string,
  url: string,
  publishedAt?: string
): CuratedOpponentSource => ({
  title,
  url,
  format: 'wild-legal',
  ...(publishedAt ? { publishedAt } : {})
})

/**
 * Approved, source-inspired local adaptations for constructed AI opponents.
 * These are not verbatim historical lists. Local card stats/effects resolve from
 * the game's catalog. See README.md for the approval fingerprint and slot mapping.
 * Replacement lists deliberately use general Expert evaluation: no old pilot
 * profile is inherited solely because a new list replaces its catalog slot.
 */
const LEGACY_CURATED_OPPONENT_DECK_DEFINITIONS: readonly CuratedOpponentDeckDefinition[] =
  [
    {
      id: 'druid-aggro-token',
      name: 'Token Druid',
      classId: 'Druid',
      source: source(
        'slizzle466’s Aggro-Token Druid',
        'https://www.vicioussyndicate.com/slizzle466s-aggro-token-druid/'
      ),
      plan: 'Flood resilient small bodies, rebuild with Living Mana, then convert the board into lethal with permanent buffs and Savage Roar.',
      cardList: {
        Innervate: 2,
        'Bloodsail Corsair': 2,
        'Enchanted Raven': 2,
        'Fire Fly': 2,
        'Living Roots': 2,
        'Mark of the Lotus': 2,
        'Patches the Pirate': 1,
        'Druid of the Swarm': 2,
        'Haunted Creeper': 2,
        "Mark of Y'Shaarj": 2,
        'Power of the Wild': 2,
        'Crypt Lord': 2,
        'Savage Roar': 2,
        Jeeves: 2,
        'Soul of the Forest': 1,
        'Living Mana': 2
      }
    },
    {
      id: 'druid-force-roar-combo',
      name: 'Combo Druid',
      classId: 'Druid',
      source: source(
        'LowkoTV: Combo Druid deck demonstration and description',
        'https://www.youtube.com/watch?v=1QijTGWjlZ8',
        '2016-01-21'
      ),
      plan: 'Use ramp and durable midgame bodies to pressure and survive, then finish with the deterministic Force of Nature plus Savage Roar hand burst.',
      cardList: {
        Innervate: 2,
        'Living Roots': 2,
        'Darnassus Aspirant': 1,
        'Wild Growth': 2,
        Wrath: 2,
        'Big Game Hunter': 1,
        'Savage Roar': 2,
        'Tar Creeper': 2,
        'Keeper of the Grove': 2,
        'Piloted Shredder': 2,
        Swipe: 2,
        'Azure Drake': 1,
        'Druid of the Claw': 2,
        Loatheb: 1,
        'Emperor Thaurissan': 1,
        'Force of Nature': 2,
        'Ancient of Lore': 2,
        'Dr. Boom': 1
      }
    },
    {
      id: 'druid-dedicated-jade',
      name: 'Jade Druid',
      classId: 'Druid',
      source: source(
        'Poach’s Jade Druid',
        'https://www.vicioussyndicate.com/poachs-jade-druid/'
      ),
      plan: 'Ramp and draw into repeated, progressively larger Jade boards; defend with Plague/taunts and armor, with Idol recycling as an optional endurance route.',
      cardList: {
        Innervate: 2,
        'Jade Idol': 2,
        'Earthen Scales': 1,
        'Wild Growth': 2,
        Wrath: 2,
        'Brann Bronzebeard': 1,
        'Feral Rage': 1,
        'Jade Blossom': 2,
        Mulch: 1,
        'Fandral Staghelm': 1,
        'Jade Spirit': 2,
        Swipe: 2,
        'Azure Drake': 1,
        Nourish: 2,
        'Aya Blackpaw': 1,
        'Jade Behemoth': 2,
        'Spreading Plague': 2,
        'Malfurion the Pestilent': 1,
        'Ultimate Infestation': 2
      }
    },
    {
      id: 'hunter-face-burn',
      name: 'Face Hunter',
      classId: 'Hunter',
      source: source(
        'Foxta: S15 Face Hunter to everybody get legend',
        'https://www.hearthpwn.com/decks/267204-s15-face-hunter-to-everybody-get-legend-w-guide',
        '2015-06-27'
      ),
      plan: 'Commit cheap attackers and Charge damage to a fast life-total clock, then close with weapons, burn and Steady Shot rather than a six-to-eight-mana board plan.',
      cardList: {
        'Abusive Sergeant': 2,
        'Fiery Bat': 2,
        'Leper Gnome': 2,
        Tracking: 1,
        'Explosive Trap': 2,
        Glaivezooka: 1,
        'Ironbeak Owl': 1,
        'Knife Juggler': 2,
        'Mad Scientist': 2,
        'Quick Shot': 2,
        'Unleash the Hounds': 2,
        'Animal Companion': 2,
        'Arcane Golem': 2,
        'Eaglehorn Bow': 2,
        'Kill Command': 2,
        Wolfrider: 2,
        'Leeroy Jenkins': 1
      }
    },
    {
      id: 'hunter-egg-deathrattle',
      name: 'Egg Hunter',
      classId: 'Hunter',
      source: source(
        'Control’s Deathrattle Hunter',
        'https://www.vicioussyndicate.com/controls-deathrattle-hunter/'
      ),
      plan: 'Turn inert Eggs and sticky deathrattles into immediate board/value swings with cheap activators, then use Widow-discounted Highmanes and optional Rexxar resources.',
      cardList: {
        'Play Dead': 2,
        Tracking: 1,
        'Feign Death': 2,
        Glaivezooka: 2,
        'Kindly Grandmother': 2,
        'Loot Hoarder': 2,
        'Nerubian Egg': 2,
        'Terrorscale Stalker': 2,
        'Devilsaur Egg': 2,
        'Kill Command': 2,
        'Stitched Tracker': 2,
        Houndmaster: 2,
        'Corpse Widow': 2,
        'Princess Huhuran': 1,
        'Sylvanas Windrunner': 1,
        'Savannah Highmane': 2,
        'Deathstalker Rexxar': 1
      }
    },
    {
      id: 'hunter-secret-tempo',
      name: 'Secret Hunter',
      classId: 'Hunter',
      source: source(
        "Thijs' Midrange Secret Hunter, BlizzCon 2016 Group Stage",
        'https://www.hearthpwn.com/decks/654731-thijs-midrange-secret-hunter-blizzcon-2016-group',
        '2016-10-20'
      ),
      plan: 'Develop Secretkeeper and Huntress/Scientist-supported secrets, tax opposing turns and extend Eaglehorn Bow, then win through protected Highmanes and Call of the Wild.',
      cardList: {
        Secretkeeper: 2,
        Tracking: 1,
        'Cat Trick': 2,
        'Freezing Trap': 2,
        'Kindly Grandmother': 2,
        'Mad Scientist': 2,
        'Quick Shot': 2,
        'Snake Trap': 1,
        Snipe: 2,
        'Animal Companion': 2,
        'Cloaked Huntress': 2,
        'Eaglehorn Bow': 2,
        'Kill Command': 2,
        'Avian Watcher': 2,
        'Savannah Highmane': 2,
        'Call of the Wild': 2
      }
    },
    {
      id: 'mage-mech-tempo',
      name: 'Mech Mage',
      classId: 'Mage',
      source: source(
        'Mech Mage Deck List, Evident',
        'https://www.hearthstonetopdecks.com/decks/mech-mage-deck-list/',
        '2015-08-23'
      ),
      plan: 'Accelerate Mechs with Mechwarper, protect a snowballing board, and convert Mech-conditioned battlecries and burn into pressure.',
      cardList: {
        'Clockwork Gnome': 2,
        Cogmaster: 2,
        'Mana Wyrm': 2,
        'Annoy-o-Tron': 2,
        Frostbolt: 2,
        Mechwarper: 2,
        Snowchugger: 2,
        'Unstable Portal': 1,
        'Arcane Intellect': 1,
        'Spider Tank': 2,
        'Tinkertown Technician': 2,
        Fireball: 2,
        'Goblin Blastmage': 2,
        'Piloted Shredder': 2,
        'Clockwork Knight': 2,
        'Archmage Antonidas': 1,
        'Dr. Boom': 1
      }
    },
    {
      id: 'mage-jaina-elemental-control',
      name: 'Jaina Control',
      classId: 'Mage',
      source: source(
        'MasterScary / GratedWasabi Elemental Mage Theorycraft discussion',
        'https://www.hearthpwn.com/forums/class-discussion/mage/199550-elemental-mage-theorycraft'
      ),
      plan: 'Survive and contest the board with removal and defensive Elementals, then turn Elemental damage and Water Elemental production into a sustained healing/value endgame.',
      cardList: {
        'Fire Fly': 2,
        Arcanologist: 2,
        Frostbolt: 2,
        'Primordial Glyph': 1,
        'Arcane Intellect': 2,
        'Ice Block': 2,
        'Tar Creeper': 2,
        'Volcanic Potion': 2,
        Polymorph: 2,
        'Water Elemental': 2,
        'Servant of Kalimos': 2,
        Blazecaller: 2,
        Blizzard: 1,
        Meteor: 1,
        'Baron Geddon': 1,
        'Firelands Portal': 2,
        'Frost Lich Jaina': 1,
        'Ragnaros the Firelord': 1
      }
    },
    {
      id: 'paladin-secret-challenger',
      name: 'Secret Paladin',
      classId: 'Paladin',
      source: source(
        'Chai’s Secret Paladin',
        'https://www.vicioussyndicate.com/chais-secret-paladin-3/'
      ),
      plan: 'Curve out resilient bodies, recruit a layered Secret board with Challenger, and close behind attack-order disruption.',
      cardList: {
        Avenge: 2,
        'Competitive Spirit': 1,
        'Noble Sacrifice': 2,
        Redemption: 1,
        'Righteous Protector': 2,
        Secretkeeper: 2,
        Hydrologist: 2,
        'Knife Juggler': 2,
        'Shielded Minibot': 2,
        'Divine Favor': 1,
        'Muster for Battle': 2,
        'Rallying Blade': 2,
        'Blessing of Kings': 1,
        'Piloted Shredder': 2,
        'Truesilver Champion': 1,
        Loatheb: 1,
        'Mysterious Challenger': 2,
        'Sunkeeper Tarim': 1,
        'Tirion Fordring': 1
      }
    },
    {
      id: 'priest-reno-raza',
      name: 'Reno Raza',
      classId: 'Priest',
      source: source(
        'Capilano’s Reno Priest',
        'https://www.vicioussyndicate.com/capilanos-reno-priest/'
      ),
      plan: 'Survive with singleton answers and Reno, assemble Raza plus Anduin, then turn cheap cards into repeated damage Hero Powers and a Spawn burst finish.',
      cardList: {
        'Circle of Healing': 1,
        Silence: 1,
        'Binding Heal': 1,
        'Flash Heal': 1,
        'Holy Smite': 1,
        'Northshire Cleric': 1,
        'Potion of Madness': 1,
        'Power Word: Shield': 1,
        'Bloodmage Thalnos': 1,
        Doomsayer: 1,
        'Loot Hoarder': 1,
        'Mind Blast': 1,
        'Novice Engineer': 1,
        'Radiant Elemental': 1,
        'Shadow Visions': 1,
        'Shadow Word: Pain': 1,
        'Wild Pyromancer': 1,
        'Acolyte of Pain': 1,
        'Shadow Word: Death': 1,
        'Auchenai Soulpriest': 1,
        'Spirit Lash': 1,
        Kazakus: 1,
        'Spawn of Shadows': 1,
        'Azure Drake': 1,
        'Raza the Chained': 1,
        'Dragonfire Potion': 1,
        'Emperor Thaurissan': 1,
        Lightbomb: 1,
        'Reno Jackson': 1,
        'Shadowreaper Anduin': 1
      }
    },
    {
      id: 'priest-deathlord-inner-fire',
      name: 'Inner Fire',
      classId: 'Priest',
      source: source(
        'AZSwim’s Inner-Fire Priest',
        'https://www.vicioussyndicate.com/azswims-inner-fire-priest/'
      ),
      plan: 'Build a high-health board, heal and protect it, then turn a surviving body into a lethal-sized attacker with health doubling and Inner Fire.',
      cardList: {
        'Circle of Healing': 2,
        Silence: 1,
        'Binding Heal': 1,
        'Inner Fire': 2,
        'Northshire Cleric': 2,
        'Potion of Madness': 1,
        'Power Word: Shield': 2,
        'Divine Spirit': 2,
        'Radiant Elemental': 2,
        'Shadow Visions': 2,
        'Shadow Word: Pain': 1,
        'Acolyte of Pain': 1,
        Deathlord: 2,
        'Injured Blademaster': 2,
        'Kabal Talonpriest': 2,
        "Velen's Chosen": 2,
        'Faceless Shambler': 2,
        'Lyra the Sunshard': 1
      }
    },
    {
      id: 'rogue-oil-burst',
      name: 'Oil Rogue',
      classId: 'Rogue',
      source: source(
        'Kolento Oil Rogue archive',
        'https://www.hearthpwn.com/decks/262889-oil-rogue'
      ),
      plan: 'Cycle spells while controlling the board, then turn a buffed dagger into attack damage plus a face-capable Blade Flurry burst.',
      cardList: {
        Backstab: 2,
        Preparation: 2,
        'Deadly Poison': 2,
        'Southsea Deckhand': 1,
        'Blade Flurry': 2,
        'Bloodmage Thalnos': 1,
        Eviscerate: 2,
        Sap: 2,
        'Earthen Ring Farseer': 1,
        'Edwin VanCleef': 1,
        'Fan of Knives': 2,
        'SI:7 Agent': 2,
        "Tinker's Sharpsword Oil": 2,
        'Violet Teacher': 2,
        'Antique Healbot': 1,
        'Azure Drake': 2,
        Loatheb: 1,
        Sprint: 2
      }
    },
    {
      id: 'rogue-keleseth-pirates',
      name: 'Keleseth Rogue',
      classId: 'Rogue',
      source: source(
        'Hazer’s Keleseth Tempo Rogue',
        'https://www.vicioussyndicate.com/hazers-keleseth-tempo-rogue/'
      ),
      plan: 'Apply early pirate pressure, amplify future draws with Keleseth, then use removal Battlecries and attack buffs to convert initiative into lethal.',
      cardList: {
        Backstab: 2,
        Shadowstep: 2,
        'Cold Blood': 2,
        'Fire Fly': 2,
        'Patches the Pirate': 1,
        'Southsea Deckhand': 2,
        Swashburglar: 2,
        'Prince Keleseth': 1,
        'Edwin VanCleef': 1,
        'SI:7 Agent': 2,
        'Shaku, the Collector': 1,
        'Southsea Captain': 2,
        'Leeroy Jenkins': 1,
        'Piloted Shredder': 2,
        'Azure Drake': 1,
        'Dark Iron Skulker': 1,
        'Vilespine Slayer': 2,
        'Cairne Bloodhoof': 1,
        Bonemare: 2
      }
    },
    {
      id: 'shaman-nzoth-control',
      name: "N'Zoth Shaman",
      classId: 'Shaman',
      source: source(
        "Poach's Control Shaman",
        'https://www.vicioussyndicate.com/poachs-control-shaman/'
      ),
      plan: "Spend early turns clearing and healing, land layered deathrattle taunts and removal threats, then rebuild a compact six-card deathrattle pool with N'Zoth. White Eyes adds later 10/10 taunts.",
      cardList: {
        'Ancestral Knowledge': 1,
        'Bloodmage Thalnos': 1,
        Devolve: 2,
        Doomsayer: 2,
        'Maelstrom Portal': 2,
        'Far Sight': 1,
        'Healing Wave': 2,
        Hex: 2,
        'Lightning Storm': 2,
        'Mana Tide Totem': 1,
        'Tidal Surge': 2,
        'Jinyu Waterspeaker': 2,
        'Hallazeal the Ascended': 1,
        'Harrison Jones': 1,
        'Sludge Belcher': 2,
        'Sylvanas Windrunner': 1,
        Volcano: 2,
        'White Eyes': 1,
        'Cairne Bloodhoof': 1,
        "N'Zoth, the Corruptor": 1
      }
    },
    {
      id: 'shaman-totem-overload',
      name: 'Totem Shaman',
      classId: 'Shaman',
      source: source(
        'TjornHS: Midrange Karazhan Shaman',
        'https://www.hearthpwn.com/decks/608948-legend-guide-midrange-karazhan-shaman'
      ),
      plan: 'Claim board with Trogg, Totem Golem and Tuskarr; convert Totem summons to cheap Thing from Below and Valiant pressure. Spell-power weapons and Doomhammer/Rockbiter close games.',
      cardList: {
        'Rockbiter Weapon': 2,
        'Spirit Claws': 2,
        'Tunnel Trogg': 2,
        'Bloodmage Thalnos': 1,
        'Flametongue Totem': 2,
        'Maelstrom Portal': 2,
        'Totem Golem': 2,
        'Feral Spirit': 2,
        Hex: 2,
        'Lightning Storm': 1,
        'Tuskarr Totemic': 2,
        'Flamewreathed Faceless': 2,
        'Azure Drake': 2,
        Doomhammer: 1,
        'Thunder Bluff Valiant': 1,
        'Fire Elemental': 2,
        'Thing from Below': 2
      }
    },
    {
      id: 'warlock-sticky-zoo-selected',
      name: 'Sticky Zoo',
      classId: 'Warlock',
      source: source(
        'Bunnyhoppor’s EU Winter Prelims 2016 Aggro Zoo',
        'https://www.hearthstonetopdecks.com/decks/bunnyhoppors-eu-winter-prelims-2016-aggro-zoo/',
        '2016-02-15'
      ),
      plan: 'Establish a wide, sticky early board, turn small bodies into favorable trades and immediate burst, and finish with Doomguard, Soulfire or a discounted Sea Giant.',
      cardList: {
        Soulfire: 2,
        'Abusive Sergeant': 2,
        'Flame Imp': 2,
        'Possessed Villager': 2,
        'Power Overwhelming': 2,
        Voidwalker: 2,
        'Dire Wolf Alpha': 2,
        'Haunted Creeper': 2,
        'Knife Juggler': 2,
        'Darkshire Councilman': 2,
        'Imp Gang Boss': 2,
        'Defender of Argus': 2,
        'Imp-losion': 2,
        Doomguard: 2,
        Loatheb: 1,
        'Sea Giant': 1
      }
    },
    {
      id: 'warlock-giant-handlock-selected',
      name: 'Giant Handlock',
      classId: 'Warlock',
      source: source(
        'Handlock high budget against aggro meta (Lifecoach’s)',
        'https://www.hearthpwn.com/decks/274879-handlock-high-budget-against-aggro-meta-lifecoachs',
        '2015-07-22'
      ),
      plan: 'Use Life Tap and sturdy defensive bodies to create large Drakes and discounted Giants, then convert those bodies into taunts or one-turn Shadowflame swings. Jaraxxus is the optional late resource conversion.',
      cardList: {
        'Mortal Coil': 2,
        'Ancient Watcher': 2,
        Darkbomb: 2,
        'Ironbeak Owl': 2,
        'Sunfury Protector': 2,
        'Big Game Hunter': 1,
        'Earthen Ring Farseer': 1,
        'Defender of Argus': 2,
        Hellfire: 2,
        Shadowflame: 2,
        'Twilight Drake': 2,
        'Antique Healbot': 2,
        'Sludge Belcher': 2,
        'Siphon Soul': 1,
        'Lord Jaraxxus': 1,
        'Mountain Giant': 2,
        'Molten Giant': 2
      }
    },
    {
      id: 'warrior-justicar-control',
      name: 'Armor Control',
      classId: 'Warrior',
      source: source(
        'Fibonacci December 2015 Control Warrior in player interview archive',
        'https://www.hearthpwn.com/news/1169-kindred-keywords-voting-player-spotlight-fibonacci'
      ),
      plan: 'Trade weapons and efficient removal for opposing threats, build Armor to power Shield Slam, and establish sustainable Tank Up defense. Grommash/Ragnaros provide a concrete finish after stabilization.',
      cardList: {
        Execute: 2,
        'Shield Slam': 2,
        'Fiery War Axe': 2,
        Revenge: 1,
        Slam: 2,
        'Acolyte of Pain': 2,
        Bash: 2,
        'Ravaging Ghoul': 2,
        'Shield Block': 2,
        "Death's Bite": 2,
        Brawl: 2,
        'Harrison Jones': 1,
        'Sludge Belcher': 2,
        'Sylvanas Windrunner': 1,
        'Justicar Trueheart': 1,
        Shieldmaiden: 2,
        'Grommash Hellscream': 1,
        'Ragnaros the Firelord': 1
      }
    },
    {
      id: 'warrior-pirate-weapons',
      name: 'Pirate Warrior',
      classId: 'Warrior',
      source: source(
        "DannyDonuts' Pirate Warrior",
        'https://www.vicioussyndicate.com/dannydonuts-pirate-warrior/'
      ),
      plan: 'Create an immediate Pirate/Cannon board, use efficient weapons to protect it, then finish with upgraded weapon damage and Charge. This is the fastest Warrior clock.',
      cardList: {
        "N'Zoth's First Mate": 2,
        'Patches the Pirate': 1,
        'Small-Time Buccaneer': 2,
        'Southsea Deckhand': 2,
        'Upgrade!': 2,
        'Bloodsail Raider': 2,
        'Fiery War Axe': 2,
        'Heroic Strike': 2,
        "Ship's Cannon": 2,
        'Bloodsail Cultist': 2,
        'Frothing Berserker': 2,
        'Southsea Captain': 2,
        "Death's Bite": 2,
        'Dread Corsair': 2,
        "Kor'kron Elite": 2,
        'Leeroy Jenkins': 1
      }
    },
    // Append-only original Un'Goro quest additions; the original 27 lists stay intact.
    {
      id: 'rogue-crystal-caverns',
      name: 'Crystal Caverns',
      classId: 'Rogue',
      source: {
        title: 'QUEST ROGUE DECK LIST GUIDE',
        url: 'https://www.hearthpwn.com/decks/793687-quest-rogue-deck-list-guide',
        format: 'wild-legal'
      },
      plan: 'Generate repeated Flame Elementals or bounce an affordable minion to play the same name five times. After Crystal Core, exploit cheap 5/5 bodies, tokens and Charge threats; retain bounce tools until completion when safe.',
      cardList: {
        'The Caverns Below': 1,
        Preparation: 2,
        Shadowstep: 2,
        Swashburglar: 1,
        'Vicious Scalehide': 1,
        'Gadgetzan Ferryman': 2,
        'Mimic Pod': 2,
        Vanish: 2,
        'Fire Fly': 2,
        'Glacial Shard': 2,
        'Patches the Pirate': 1,
        'Southsea Deckhand': 2,
        'Stonetusk Boar': 2,
        'Bilefin Tidehunter': 2,
        'Novice Engineer': 2,
        'Youthful Brewmaster': 2,
        'Igneous Elemental': 2
      }
    }
  ]

export const CURATED_OPPONENT_DECK_DEFINITIONS: readonly CuratedOpponentDeckDefinition[] =
  [
    ...LEGACY_CURATED_OPPONENT_DECK_DEFINITIONS,
    ...SHORTLISTED_OPPONENT_DECK_DEFINITIONS
  ]
const shortlistedIds = new Set<string>(
  SHORTLISTED_OPPONENT_DECK_DEFINITIONS.map(({ id }) => id)
)

function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]/gu, '')
    .toLowerCase()
}

const allowedExpansions: ReadonlySet<string> = new Set(
  EXPANSION_IDS.filter((id) => HISTORICAL_EXPANSIONS.has(id))
)

// Crystal Caverns alone may use Future Past among the legacy adaptations.
const cavernsExpansions: ReadonlySet<string> = new Set([
  ...allowedExpansions,
  'future-past'
])
const supportedExpansions: ReadonlySet<string> = new Set(EXPANSION_IDS)

function resolveSourceCard(
  name: string,
  classId: DeckClass,
  rules: DeckRules,
  deck: Pick<Deck, 'heroId'>,
  cardPool: ReadonlySet<string>
): CardDefinition {
  const normalizedName = normalizeName(name)
  const candidates = CARD_CATALOG.all.filter(
    (card) =>
      normalizeName(card.name) === normalizedName &&
      cardPool.has(card.expansionId) &&
      isCardAllowedForClass(card, classId) &&
      isCollectibleDeckCard(card) &&
      rules.isCardAllowedInDeck(deck, card)
  )
  if (candidates.length !== 1) {
    throw new Error(
      `Curated deck card "${name}" resolved to ${candidates.length} eligible cards.`
    )
  }
  return candidates[0]
}

function buildDeck(definition: CuratedOpponentDeckDefinition): CuratedOpponentDeck {
  const hero = HERO_CATALOG.getPrimaryForClass(definition.classId)
  if (!hero) throw new Error(`No primary hero exists for ${definition.classId}.`)
  const rules = new DeckRules()
  const deckBase = { heroId: hero.id }
  const cards: Record<string, number> = {}
  for (const [cardName, count] of Object.entries(definition.cardList)) {
    if (!Number.isInteger(count) || count < 1)
      throw new Error(`Invalid copy count for ${cardName} in ${definition.id}.`)
    const card = resolveSourceCard(
      cardName,
      definition.classId,
      rules,
      deckBase,
      shortlistedIds.has(definition.id)
        ? supportedExpansions
        : definition.id === 'rogue-crystal-caverns'
          ? cavernsExpansions
          : allowedExpansions
    )
    cards[card.id] = count
  }
  const deck: Deck = {
    id: `curated-opponent-${definition.id}`,
    name: definition.deckName ?? definition.name,
    heroId: hero.id,
    cards,
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z'
  }
  if (Object.values(cards).reduce((sum, count) => sum + count, 0) !== MAX_DECK_CARDS)
    throw new Error(`Curated deck ${definition.id} does not contain 30 cards.`)
  const errors = rules.validate(deck)
  if (errors.length)
    throw new Error(`Invalid curated deck ${definition.id}: ${errors.join('; ')}`)
  return {
    definition,
    deck,
    strategy: {
      strategy: 'constructed',
      theme: definition.id,
      text:
        `${shortlistedIds.has(definition.id) ? 'Approved custom shortlist' : 'Historical inspiration'}: ${definition.source.title}. ${definition.plan} ` +
        'Adapt to the visible board, hand, and opponent threats; this deck plan is a prior, not a rule.'
    }
  }
}

if (CURATED_OPPONENT_DECK_DEFINITIONS.length !== PLAYABLE_CLASSES.length * 3) {
  throw new Error(
    'Curated opponent catalog must contain exactly three decks per playable class.'
  )
}

const definitionIds = new Set(
  CURATED_OPPONENT_DECK_DEFINITIONS.map((definition) => definition.id)
)
if (definitionIds.size !== CURATED_OPPONENT_DECK_DEFINITIONS.length) {
  throw new Error('Curated opponent deck IDs must be unique.')
}
for (const classId of PLAYABLE_CLASSES) {
  const classDeckCount = CURATED_OPPONENT_DECK_DEFINITIONS.filter(
    (definition) => definition.classId === classId
  ).length
  if (classDeckCount !== 3) {
    throw new Error(
      `Curated opponent catalog must contain exactly three ${classId} decks.`
    )
  }
}

export const CURATED_OPPONENT_DECKS: readonly CuratedOpponentDeck[] =
  CURATED_OPPONENT_DECK_DEFINITIONS.map(buildDeck)

export function getCuratedOpponentDecksForClass(
  classId: DeckClass
): readonly CuratedOpponentDeck[] {
  return CURATED_OPPONENT_DECKS.filter((entry) => entry.definition.classId === classId)
}
