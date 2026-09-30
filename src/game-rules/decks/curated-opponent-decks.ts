import {
  CARD_CATALOG,
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

export const CURATED_OPPONENT_CATALOG_VERSION = 1

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
  readonly classId: DeckClass
  readonly source: CuratedOpponentSource
  readonly plan: string
  /** Local Expert evaluation pilot; omitted decks keep general evaluation. */
  readonly expertStrategyProfileId?: ExpertDeckStrategyProfileId
  /** Exact card names and counts from the linked source list. */
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
 * Fixed, source-linked historical lists for constructed AI opponents.
 * The entries intentionally retain printed list names and counts; local card
 * stats/effects are resolved from the game's catalog without changing lists.
 */
export const CURATED_OPPONENT_DECK_DEFINITIONS: readonly CuratedOpponentDeckDefinition[] =
  [
    {
      id: 'druid-midrange-old-gods',
      expertStrategyProfileId: 'ramp-midrange',
      name: 'Druid Mid A',
      classId: 'Druid',
      source: source(
        'Winsteak to Legend Midrange Druid',
        'https://www.hearthpwn.com/decks/559973-winsteak-to-legend-midrange-druid'
      ),
      plan: 'Ramp into durable minions, contest the board, and use flexible threats to turn a stable board into pressure.',
      cardList: {
        Innervate: 2,
        'Living Roots': 2,
        'Raven Idol': 2,
        'Darnassus Aspirant': 1,
        'Wild Growth': 2,
        Wrath: 2,
        Mulch: 1,
        Swipe: 2,
        'Fandral Staghelm': 1,
        'Mire Keeper': 2,
        Nourish: 1,
        'Dark Arakkoa': 2,
        'Druid of the Claw': 2,
        'Ancient of War': 2,
        Cenarius: 1,
        'Azure Drake': 2,
        'Harrison Jones': 1,
        'Sylvanas Windrunner': 1,
        'Ragnaros the Firelord': 1
      }
    },
    {
      id: 'druid-cthun-midrange',
      expertStrategyProfileId: 'cthun-midrange',
      name: "Druid C'Thun",
      classId: 'Druid',
      source: source(
        "GameKing's C'Thun Druid - EU Spring Prelims",
        'https://www.hearthstonetopdecks.com/decks/gamekings-cthun-druid-hearthstone-eu-spring-prelims-2016/',
        '2016-05-15'
      ),
      plan: 'Develop C’Thun followers on curve, trade for board control, and preserve the large C’Thun payoff for a swing turn.',
      cardList: {
        Innervate: 2,
        'Wild Growth': 2,
        Wrath: 2,
        Swipe: 2,
        'Klaxxi Amber-Weaver': 2,
        Nourish: 1,
        'Dark Arakkoa': 2,
        'Druid of the Claw': 2,
        'Ancient of War': 2,
        'Beckoner of Evil': 2,
        "Disciple of C'Thun": 2,
        'Twilight Elder': 2,
        "C'Thun's Chosen": 2,
        'Azure Drake': 1,
        'Sylvanas Windrunner': 1,
        "Twin Emperor Vek'lor": 1,
        "C'Thun": 1,
        'Ragnaros the Firelord': 1
      }
    },
    {
      id: 'druid-jade-elemental',
      expertStrategyProfileId: 'jade-midrange',
      name: 'Jade Druid',
      classId: 'Druid',
      source: source(
        "Tars' Jade Elemental Druid - July 2017",
        'https://www.hearthstonetopdecks.com/decks/tars-jade-elemental-druid-july-2017-season-40/',
        '2017-07'
      ),
      plan: 'Build repeatable Jade value while developing Elementals; make efficient trades until the growing board can end the game.',
      cardList: {
        Innervate: 2,
        'Jade Idol': 2,
        'Mark of the Lotus': 2,
        'Power of the Wild': 2,
        'Tortollan Forager': 2,
        'Jade Blossom': 2,
        'Savage Roar': 2,
        'Jade Spirit': 2,
        'Living Mana': 2,
        'Aya Blackpaw': 1,
        'Bloodsail Corsair': 2,
        'Fire Fly': 2,
        'Patches the Pirate': 1,
        'Tar Creeper': 2,
        'Servant of Kalimos': 2,
        Blazecaller: 2
      }
    },
    {
      id: 'hunter-frozen-throne-midrange',
      name: 'Hunter KFT',
      classId: 'Hunter',
      source: source(
        'Midrange Hunter for Frozen Throne',
        'https://www.hearthpwn.com/decks/902104-midrange-hunter-for-frozen-throne',
        '2017-08-13'
      ),
      plan: 'Curve Beast minions into Houndmaster and Highmane; trade efficiently while the opponent can challenge the board, then pressure face.',
      cardList: {
        Alleycat: 2,
        'Fiery Bat': 2,
        'Jeweled Macaw': 2,
        'Crackling Razormaw': 2,
        'Kindly Grandmother': 2,
        'Scavenging Hyena': 2,
        'Animal Companion': 2,
        Bearshark: 2,
        'Eaglehorn Bow': 1,
        'Kill Command': 2,
        'Stitched Tracker': 1,
        'Unleash the Hounds': 1,
        'Exploding Bloatbat': 1,
        Houndmaster: 2,
        'Tundra Rhino': 1,
        'Deathstalker Rexxar': 1,
        'Savannah Highmane': 2,
        Bloodworm: 1,
        'Nesting Roc': 1
      }
    },
    {
      id: 'hunter-probably-midrange',
      name: 'Hunter BM',
      classId: 'Hunter',
      source: source(
        "Pajan's Probably Midrange Hunter",
        'https://www.hearthstonetopdecks.com/decks/probably-midrange/',
        '2017-08-07'
      ),
      plan: 'Develop Beasts on curve and use their synergies to win board trades; retain enough pressure to switch to face damage when ahead.',
      cardList: {
        Alleycat: 2,
        'Crackling Razormaw': 2,
        'Kindly Grandmother': 2,
        'Scavenging Hyena': 2,
        'Toxic Arrow': 2,
        'Animal Companion': 2,
        Bearshark: 2,
        'Kill Command': 2,
        'Rat Pack': 2,
        'Stitched Tracker': 1,
        'Unleash the Hounds': 1,
        Houndmaster: 2,
        'Corpse Widow': 2,
        'Savannah Highmane': 2,
        'Fire Fly': 2,
        'Dire Wolf Alpha': 2
      }
    },
    {
      id: 'hunter-old-gods-midrange',
      name: 'Hunter Old',
      classId: 'Hunter',
      source: source(
        'New School Midrange Hunter by 3nnui',
        'https://www.hearthpwn.com/forums/hearthstone-general/general-discussion/138781-headed-for-legend-s26-may-2016',
        '2016-04-28'
      ),
      plan: 'Use early Beasts and weapons to secure board control, then curve into sticky midgame threats and finishers.',
      cardList: {
        Dreadscale: 1,
        'Princess Huhuran': 1,
        'Sylvanas Windrunner': 1,
        'Infested Wolf': 2,
        'Savannah Highmane': 2,
        'Carrion Grub': 2,
        'Fiery Bat': 2,
        'Huge Toad': 2,
        "King's Elekk": 2,
        'Loot Hoarder': 2,
        Houndmaster: 2,
        'Call of the Wild': 2,
        'Unleash the Hounds': 1,
        'Animal Companion': 2,
        'Bear Trap': 1,
        'Quick Shot': 2,
        "Hunter's Mark": 1,
        'Kill Command': 2
      }
    },
    {
      id: 'mage-mech-midrange',
      name: 'Mage Mech',
      classId: 'Mage',
      source: source(
        'Mech Mage Deck List',
        'https://www.hearthstonetopdecks.com/decks/mech-mage-deck-list/',
        '2015-08'
      ),
      plan: 'Use Mech synergy to establish a board early, spend mana efficiently, and preserve burn for board control or lethal pressure.',
      cardList: {
        'Mana Wyrm': 2,
        Frostbolt: 2,
        Snowchugger: 2,
        'Unstable Portal': 2,
        Fireball: 2,
        'Goblin Blastmage': 2,
        'Archmage Antonidas': 1,
        'Clockwork Gnome': 2,
        Cogmaster: 2,
        'Annoy-o-Tron': 2,
        'Spider Tank': 2,
        'Tinkertown Technician': 2,
        Mechwarper: 2,
        'Piloted Shredder': 2,
        'Fel Reaver': 2,
        'Dr. Boom': 1
      }
    },
    {
      id: 'mage-pavel-tempo',
      name: 'Mage Tempo',
      classId: 'Mage',
      source: source(
        "Pavel's Tempo Mage - BlizzCon 2016",
        'https://www.hearthpwn.com/decks/654832-pavels-tempo-mage-blizzcon-2016-group-stage',
        '2016'
      ),
      plan: 'Develop cheap spell-synergy minions before chaining efficient spells; trade when it protects the engine and turn spare damage toward face.',
      cardList: {
        'Arcane Blast': 2,
        'Arcane Missiles': 2,
        'Babbling Book': 2,
        'Mana Wyrm': 2,
        'Cult Sorcerer': 2,
        Frostbolt: 2,
        "Sorcerer's Apprentice": 2,
        'Arcane Intellect': 2,
        Flamewaker: 2,
        Fireball: 2,
        'Water Elemental': 1,
        'Faceless Summoner': 2,
        'Firelands Portal': 2,
        Flamestrike: 1,
        'Bloodmage Thalnos': 1,
        'Azure Drake': 2,
        'Ragnaros the Firelord': 1
      }
    },
    {
      id: 'mage-frost-lich-midrange',
      name: 'Mage Jaina',
      classId: 'Mage',
      source: source(
        "Disguised Toast's Frost Lich Jaina Midrange Mage",
        'https://www.hearthpwn.com/decks/894517-disguisedtoasts-frost-lich-jaina-midrange-mage',
        '2017-08-11'
      ),
      plan: 'Develop Elementals and protect the board with secrets and removal; use the late-game hero card only after stabilizing.',
      cardList: {
        'Babbling Book': 2,
        'Mana Wyrm': 2,
        Arcanologist: 2,
        Frostbolt: 2,
        "Medivh's Valet": 2,
        'Primordial Glyph': 2,
        Pyros: 1,
        'Arcane Intellect': 2,
        Counterspell: 1,
        'Ice Block': 2,
        'Volcanic Potion': 1,
        Fireball: 2,
        'Water Elemental': 2,
        'Firelands Portal': 2,
        'Frost Lich Jaina': 1,
        'Tar Creeper': 2,
        'Servant of Kalimos': 2
      }
    },
    {
      id: 'paladin-secret-midrange',
      name: 'Pally Secret',
      classId: 'Paladin',
      source: source(
        'TGT Top 10 Legend Mysterious Challenger Midrange',
        'https://www.hearthpwn.com/decks/314544-tgt-top-10-legend-mysterious-challlenger-midrange',
        '2015-08-27'
      ),
      plan: 'Establish the early board with efficient minions and Muster, then turn a strong curve into a secret-powered midgame push.',
      cardList: {
        Avenge: 1,
        'Competitive Spirit': 1,
        'Noble Sacrifice': 1,
        Redemption: 1,
        Repentance: 1,
        Equality: 1,
        'Shielded Minibot': 2,
        'Aldor Peacekeeper': 1,
        Coghammer: 1,
        Consecration: 2,
        'Muster for Battle': 2,
        'Blessing of Kings': 1,
        'Murloc Knight': 1,
        'Truesilver Champion': 1,
        'Mysterious Challenger': 2,
        'Tirion Fordring': 1,
        'Knife Juggler': 2,
        'Argent Horserider': 1,
        'Ironbeak Owl': 1,
        'Piloted Shredder': 2,
        Loatheb: 1,
        'Sludge Belcher': 2,
        'Dr. Boom': 1
      }
    },
    {
      id: 'paladin-old-gods-midrange',
      name: 'Pally WOG',
      classId: 'Paladin',
      source: source(
        "WoG Seraph's Midrange Paladin",
        'https://www.hearthpwn.com/decks/556979-wog-seraphs-midrange-paladin',
        '2016-05'
      ),
      plan: 'Mix early board development and efficient weapons with durable midgame minions; trade for tempo before using N’Zoth value to finish.',
      cardList: {
        'Forbidden Healing': 1,
        'Selfless Hero': 2,
        'Aldor Peacekeeper': 2,
        Consecration: 2,
        'Divine Favor': 1,
        'Keeper of Uldaman': 1,
        'Rallying Blade': 1,
        'Truesilver Champion': 2,
        'Tirion Fordring': 1,
        'Abusive Sergeant': 2,
        'Argent Squire': 2,
        'Flame Juggler': 2,
        'Acolyte of Pain': 1,
        'Harvest Golem': 2,
        "C'Thun's Chosen": 2,
        'Defender of Argus': 1,
        'Corrupted Healbot': 2,
        'Cairne Bloodhoof': 1,
        'Sylvanas Windrunner': 1,
        "N'Zoth, the Corruptor": 1
      }
    },
    {
      id: 'paladin-ungoro-murloc-midrange',
      name: 'Pally Murloc',
      classId: 'Paladin',
      source: source(
        "Machamp's Un'Goro Midrange Murloc Paladin",
        'https://www.hearthpwn.com/decks/834961-ungoro-midrange-paladin-murloc-deck-list-guide-may',
        '2017-05-15'
      ),
      plan: 'Build a Murloc board with efficient trades, then use the midgame buffs and taunts to convert board control into pressure.',
      cardList: {
        'Vilefin Inquisitor': 2,
        Equality: 2,
        Hydrologist: 2,
        'Aldor Peacekeeper': 2,
        Consecration: 2,
        'Ivory Knight': 1,
        'Truesilver Champion': 2,
        'Spikeridged Steed': 2,
        'Sunkeeper Tarim': 1,
        'Ragnaros, Lightlord': 1,
        'Tirion Fordring': 1,
        'Golakka Crawler': 1,
        'Rockpool Hunter': 2,
        'Murloc Warleader': 2,
        'Stonehill Defender': 2,
        'Gentle Megasaur': 2,
        'Stampeding Kodo': 1,
        'The Curator': 1,
        'Primordial Drake': 1
      }
    },
    {
      id: 'priest-nzoth-deathrattle-midrange',
      name: "Priest N'Zoth",
      classId: 'Priest',
      source: source(
        "N'Zoth Deathrattle Priest",
        'https://www.hearthstonetopdecks.com/decks/nzoth-deathrattle-priest-2/',
        '2016-05-02'
      ),
      plan: 'Use healing and efficient removal to preserve a minion board, trade into threats, and rebuild with the late-game Deathrattle payoff.',
      cardList: {
        'Circle of Healing': 2,
        'Northshire Cleric': 2,
        'Power Word: Shield': 2,
        'Museum Curator': 2,
        'Shadow Word: Death': 2,
        'Holy Nova': 2,
        'Auchenai Soulpriest': 2,
        'Shifting Shade': 2,
        'Darkshire Alchemist': 2,
        'Huge Toad': 2,
        'Acolyte of Pain': 2,
        'Refreshment Vendor': 2,
        'Sen’jin Shieldmasta': 2,
        'The Black Knight': 1,
        'Cairne Bloodhoof': 1,
        'Sylvanas Windrunner': 1,
        "N'Zoth, the Corruptor": 1
      }
    },
    {
      id: 'priest-silent-midrange',
      name: 'Silent Priest',
      classId: 'Priest',
      source: source(
        'Silent Priest',
        'https://www.hearthstonetopdecks.com/decks/silent-priest/',
        '2017-01-08'
      ),
      plan: 'Make dormant high-stat minions active with silence effects, then use Priest buffs and removal to keep the board in play.',
      cardList: {
        Silence: 2,
        'Power Word: Shield': 2,
        Purify: 2,
        'Shadow Word: Death': 2,
        'Shadow Word: Pain': 2,
        'Kabal Talonpriest': 2,
        'Priest of the Feast': 2,
        'Excavated Evil': 2,
        'Kabal Songstealer': 2,
        'Acidic Swamp Ooze': 2,
        'Ancient Watcher': 2,
        'Acolyte of Pain': 2,
        'Fel Orc Soulfiend': 1,
        'Eerie Statue': 2,
        'Elise Starseeker': 1,
        'Sylvanas Windrunner': 1,
        'Ragnaros the Firelord': 1
      }
    },
    {
      id: 'priest-cthun-midrange',
      name: "Priest C'Thun",
      classId: 'Priest',
      source: source(
        "SuperJJ's DreamHack C'Thun Priest",
        'https://www.hearthpwn.com/decks/574438-superjjs-dreamhack-cthun-priest',
        '2016'
      ),
      plan: 'Trade with resilient C’Thun followers and removal, stabilize with healing, then use the late-game C’Thun package to close.',
      cardList: {
        'Circle of Healing': 2,
        'Forbidden Shaping': 2,
        'Northshire Cleric': 2,
        'Power Word: Shield': 2,
        'Shadow Word: Death': 2,
        'Shadow Word: Pain': 2,
        'Auchenai Soulpriest': 2,
        'Excavated Evil': 1,
        'Twilight Darkmender': 2,
        'Cabal Shadow Priest': 1,
        'Beckoner of Evil': 2,
        'Wild Pyromancer': 2,
        "Disciple of C'Thun": 2,
        "C'Thun's Chosen": 2,
        'Elise Starseeker': 1,
        'Sylvanas Windrunner': 1,
        "Twin Emperor Vek'lor": 1,
        "C'Thun": 1
      }
    },
    {
      id: 'rogue-tgt-midrange',
      name: 'Rogue TGT',
      classId: 'Rogue',
      source: source(
        '[TGT] Midrange Rogue Guide',
        'https://www.hearthpwn.com/decks/346915-tgt-midrange-rogue-guide',
        '2015-10-13'
      ),
      plan: 'Use cheap removal and Combo enablers to gain tempo, then hold board control with minions and finish with weapon or spell pressure.',
      cardList: {
        Backstab: 2,
        'Deadly Poison': 2,
        'Blade Flurry': 1,
        Eviscerate: 2,
        'Fan of Knives': 2,
        Sap: 2,
        'Undercity Valiant': 2,
        'SI:7 Agent': 2,
        "Assassin's Blade": 1,
        "Tinker's Sharpsword Oil": 1,
        Sprint: 1,
        'Ironbeak Owl': 1,
        Saboteur: 1,
        'Defender of Argus': 1,
        'Piloted Shredder': 2,
        'Antique Healbot': 1,
        'Azure Drake': 1,
        Loatheb: 1,
        'Sludge Belcher': 2,
        'Piloted Sky Golem': 1,
        'Dr. Boom': 1
      }
    },
    {
      id: 'rogue-midrange-2016',
      name: 'Rogue Mid',
      classId: 'Rogue',
      source: source(
        'Midrange Rogue 70% Winrate',
        'https://www.hearthpwn.com/decks/431155-midrange-rogue-70-winrate',
        '2016-02-16'
      ),
      plan: 'Trade with efficient Combo minions and removal, then use sticky threats and reach to shift from board control to aggression.',
      cardList: {
        Backstab: 2,
        'Deadly Poison': 2,
        Eviscerate: 2,
        'Fan of Knives': 1,
        'SI:7 Agent': 2,
        'Unearthed Raptor': 2,
        'Dark Iron Skulker': 2,
        Sprint: 1,
        'Haunted Creeper': 2,
        'Knife Juggler': 2,
        'Ironbeak Owl': 1,
        'Big Game Hunter': 1,
        'Defender of Argus': 2,
        'Piloted Shredder': 2,
        'Antique Healbot': 1,
        Loatheb: 1,
        'Sludge Belcher': 2,
        'Dr. Boom': 1,
        'Ragnaros the Firelord': 1
      }
    },
    {
      id: 'rogue-nzoth-deathrattle-midrange',
      name: "N'Zoth Rogue",
      classId: 'Rogue',
      source: source(
        "N'Zoth Rogue Wild",
        'https://www.hearthpwn.com/decks/556794-nzoth-rogue-wild',
        '2016'
      ),
      plan: 'Protect Deathrattle minions through efficient trades and removal, then rebuild the board with the final value swing.',
      cardList: {
        Backstab: 2,
        Swashburglar: 1,
        Eviscerate: 2,
        'Fan of Knives': 2,
        Sap: 2,
        'Undercity Huckster': 2,
        'Shadow Strike': 1,
        'SI:7 Agent': 2,
        'Unearthed Raptor': 2,
        'Bloodmage Thalnos': 1,
        'Loot Hoarder': 1,
        'Piloted Shredder': 2,
        'Antique Healbot': 1,
        'Azure Drake': 1,
        Barnes: 1,
        'Sludge Belcher': 2,
        'Cairne Bloodhoof': 1,
        'Sylvanas Windrunner': 1,
        'Dr. Boom': 1,
        "Sneed's Old Shredder": 1,
        "N'Zoth, the Corruptor": 1
      }
    },
    {
      id: 'shaman-midrange-2016',
      name: 'Shaman Mid',
      classId: 'Shaman',
      source: source(
        "Vlps' Top 10 Legend Midrange Shaman",
        'https://www.hearthstonetopdecks.com/decks/vlps-top-10-legend-midrange-shaman-june-2016-season-27/',
        '2016-06'
      ),
      plan: 'Build Totems and efficient minions on curve, use overload removal to keep the board, and turn a developed board into burst.',
      cardList: {
        'Tunnel Trogg': 2,
        'Flametongue Totem': 2,
        'Rockbiter Weapon': 2,
        'Totem Golem': 2,
        'Tuskarr Totemic': 2,
        'Feral Spirit': 2,
        Hex: 2,
        'Lightning Storm': 2,
        'Mana Tide Totem': 1,
        'Flamewreathed Faceless': 2,
        'Thunder Bluff Valiant': 2,
        'Fire Elemental': 2,
        'Thing from Below': 2,
        "Al'Akir the Windlord": 1,
        'Argent Squire': 2,
        'Azure Drake': 2
      }
    },
    {
      id: 'shaman-karazhan-midrange',
      name: 'Totem Shaman',
      classId: 'Shaman',
      source: source(
        'Legend Guide Midrange Karazhan Shaman',
        'https://www.hearthpwn.com/decks/608948-legend-guide-midrange-karazhan-shaman',
        '2016-08-14'
      ),
      plan: 'Use low-cost Totems and overload tools to seize the board, then preserve tempo with midgame minions and direct damage.',
      cardList: {
        'Spirit Claws': 2,
        'Tunnel Trogg': 2,
        'Flametongue Totem': 2,
        'Maelstrom Portal': 2,
        'Rockbiter Weapon': 2,
        'Totem Golem': 2,
        'Tuskarr Totemic': 2,
        'Feral Spirit': 2,
        Hex: 2,
        'Lightning Storm': 1,
        'Flamewreathed Faceless': 2,
        Doomhammer: 1,
        'Thunder Bluff Valiant': 1,
        'Fire Elemental': 2,
        'Thing from Below': 2,
        'Bloodmage Thalnos': 1,
        'Azure Drake': 2
      }
    },
    {
      id: 'shaman-elemental-midrange',
      name: 'Elemental Shm',
      classId: 'Shaman',
      source: source(
        'Temp Elemento - Elemental Shaman',
        'https://www.hearthstonetopdecks.com/decks/the-best-elemental-shaman/',
        '2017-04-05'
      ),
      plan: 'Chain Elementals across consecutive turns for discounts and value while making trades that protect the next Elemental payoff.',
      cardList: {
        'Air Elemental': 2,
        'Earth Shock': 1,
        Devolve: 2,
        'Fire Plume Harbinger': 2,
        'Maelstrom Portal': 2,
        Hex: 2,
        'Hot Spring Guardian': 2,
        'Stone Sentinel': 2,
        'Fire Elemental': 2,
        'Fire Fly': 2,
        'Volatile Elemental': 1,
        'Igneous Elemental': 2,
        'Thunder Lizard': 2,
        'Fire Plume Phoenix': 2,
        'Tol’vir Stoneshaper': 2,
        'Servant of Kalimos': 2
      }
    },
    {
      id: 'warlock-midrange-demonlock-season-15',
      name: 'Warlock S15',
      classId: 'Warlock',
      source: source(
        '[Season 15] Midrange Demonlock',
        'https://www.hearthpwn.com/decks/256245-season-15-midrange-demonlock',
        '2015-06-01'
      ),
      plan: 'Control early exchanges with cheap removal and Demons, then use Voidcaller tempo and sturdy midgame minions to keep initiative.',
      cardList: {
        'Mortal Coil': 2,
        'Power Overwhelming': 2,
        Darkbomb: 1,
        Demonwrath: 1,
        Hellfire: 1,
        'Imp Gang Boss': 2,
        'Imp-losion': 1,
        Shadowflame: 1,
        Voidcaller: 2,
        'Bane of Doom': 1,
        Doomguard: 1,
        'Mal’Ganis': 1,
        'Abusive Sergeant': 1,
        'Bloodmage Thalnos': 1,
        'Nerubian Egg': 2,
        'Ironbeak Owl': 1,
        'Big Game Hunter': 1,
        'Defender of Argus': 1,
        'Piloted Shredder': 1,
        'Antique Healbot': 2,
        'Emperor Thaurissan': 1,
        Loatheb: 1,
        'Sylvanas Windrunner': 1,
        'Dr. Boom': 1
      }
    },
    {
      id: 'warlock-imp-boss-midrange-demonlock',
      name: 'Warlock Imp',
      classId: 'Warlock',
      source: source(
        '[Myth] Imp Boss Midrange Demonlock',
        'https://www.hearthpwn.com/decks/226703-myth-imp-boss-midrange-demonlock',
        '2015-04-10'
      ),
      plan: 'Trade for the early board with Demons, use Voidcaller to accelerate a threat, and protect the lead with taunts and removal.',
      cardList: {
        'Mortal Coil': 1,
        Darkbomb: 2,
        Hellfire: 1,
        'Imp Gang Boss': 2,
        'Void Terror': 1,
        Shadowflame: 1,
        'Siphon Soul': 1,
        Voidcaller: 2,
        Doomguard: 1,
        'Lord Jaraxxus': 1,
        'Mal’Ganis': 1,
        'Zombie Chow': 2,
        'Sunfury Protector': 2,
        'Ironbeak Owl': 1,
        'Big Game Hunter': 1,
        'Twilight Drake': 2,
        'Antique Healbot': 2,
        'Sludge Belcher': 2,
        'Sylvanas Windrunner': 1,
        'Dr. Boom': 1,
        'Molten Giant': 2
      }
    },
    {
      id: 'warlock-cthun-midrange',
      name: "C'Thun Lock",
      classId: 'Warlock',
      source: source(
        'New Archetype Midrange Warlock',
        'https://www.hearthpwn.com/decks/556017-new-archetype-midrange-warlock-with-guide',
        '2016-05-24'
      ),
      plan: 'Develop C’Thun followers and healing minions on curve, trade to maintain the board, and use the late-game payoff to close.',
      cardList: {
        'Possessed Villager': 2,
        'Dark Peddler': 2,
        Hellfire: 2,
        'Siphon Soul': 2,
        'Usher of Souls': 2,
        'Dread Infernal': 2,
        'Beckoner of Evil': 2,
        'Jeweled Scarab': 2,
        'Sunfury Protector': 1,
        'Brann Bronzebeard': 1,
        "Disciple of C'Thun": 2,
        'Earthen Ring Farseer': 2,
        'Twilight Elder': 2,
        "C'Thun's Chosen": 2,
        'Refreshment Vendor': 2,
        "Twin Emperor Vek'lor": 1,
        "C'Thun": 1
      }
    },
    {
      id: 'warrior-midrange-varian',
      name: 'Warrior Varian',
      classId: 'Warrior',
      source: source(
        'Top 100 Legend Midrange Varian Warrior',
        'https://www.hearthpwn.com/decks/476637-top-100-legend-midrange-varian-warrior',
        '2016-04-18'
      ),
      plan: 'Use weapons and damaged-minion synergies to control early trades, then curve into sticky midrange threats and late pressure.',
      cardList: {
        Execute: 2,
        Slam: 2,
        Armorsmith: 2,
        Bash: 1,
        'Cruel Taskmaster': 2,
        'Fiery War Axe': 2,
        'Fierce Monkey': 2,
        'Frothing Berserker': 2,
        "Death's Bite": 2,
        Brawl: 1,
        'Grommash Hellscream': 1,
        'Varian Wrynn': 1,
        'Big Game Hunter': 1,
        'Piloted Shredder': 2,
        'Harrison Jones': 1,
        'Sludge Belcher': 2,
        'Cairne Bloodhoof': 1,
        'Sylvanas Windrunner': 1,
        'Dr. Boom': 1,
        'Ragnaros the Firelord': 1
      }
    },
    {
      id: 'warrior-tempo-midrange-2016',
      name: 'Tempo Warrior',
      classId: 'Warrior',
      source: source(
        'Tempo Midrange Warrior Rank 3 Legend',
        'https://www.hearthpwn.com/decks/521851-tempo-midrange-warrior-rank-3-legend-multiple-top',
        '2016-04-30'
      ),
      plan: 'Manage damaged minions and weapons to win board trades, then turn a tempo lead into deliberate face pressure.',
      cardList: {
        'Blood To Ichor': 2,
        Execute: 2,
        Slam: 2,
        Whirlwind: 2,
        Armorsmith: 2,
        'Battle Rage': 2,
        'Fiery War Axe': 2,
        'Fierce Monkey': 2,
        'Frothing Berserker': 2,
        'Ravaging Ghoul': 2,
        'Arathi Weaponsmith': 1,
        'Bloodhoof Brave': 2,
        Malkorok: 1,
        'Grommash Hellscream': 1,
        'Varian Wrynn': 1,
        'Acolyte of Pain': 2,
        'Cairne Bloodhoof': 1,
        'Ragnaros the Firelord': 1
      }
    },
    {
      id: 'warrior-dragon-midrange-2016',
      name: 'Dragon Warr',
      classId: 'Warrior',
      source: source(
        '[S27 Legend] Dragon Warrior',
        'https://www.hearthpwn.com/decks/568392-s27-legend-dragon-warrior',
        '2016-06-09'
      ),
      plan: 'Curve Dragons and weapon-backed minions into board control, then apply pressure once the opponent is forced to trade.',
      cardList: {
        'Blood To Ichor': 2,
        Execute: 2,
        Slam: 2,
        "Alexstrasza's Champion": 2,
        'Fiery War Axe': 2,
        'Frothing Berserker': 1,
        'Ravaging Ghoul': 2,
        'Kor’kron Elite': 2,
        'Grommash Hellscream': 1,
        'Sir Finley Mrrgglton': 1,
        'Faerie Dragon': 2,
        'Blackwing Technician': 2,
        'Twilight Guardian': 2,
        'Azure Drake': 2,
        'Blackwing Corruptor': 2,
        'Drakonid Crusher': 2,
        'Ragnaros the Firelord': 1
      }
    }
  ]

function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]/gu, '')
    .toLowerCase()
}

const allowedExpansions: ReadonlySet<string> = new Set(
  EXPANSION_IDS.filter((id) => HISTORICAL_EXPANSIONS.has(id))
)

function resolveSourceCard(
  name: string,
  classId: DeckClass,
  rules: DeckRules,
  deck: Pick<Deck, 'heroId'>
): CardDefinition {
  const normalizedName = normalizeName(name)
  const candidates = CARD_CATALOG.all.filter(
    (card) =>
      normalizeName(card.name) === normalizedName &&
      allowedExpansions.has(card.expansionId) &&
      (card.cardClass === 'Neutral' || card.cardClass === classId) &&
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
    const card = resolveSourceCard(cardName, definition.classId, rules, deckBase)
    cards[card.id] = count
  }
  const deck: Deck = {
    id: `curated-opponent-${definition.id}`,
    name: definition.name,
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
      strategy: 'midrange',
      theme: definition.id,
      text:
        `Original deck: ${definition.source.title}. ${definition.plan} ` +
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
