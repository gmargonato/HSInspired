import type {
  CuratedCardSlot,
  CuratedPackage,
  CuratedRequirement,
  OpponentArchetype
} from './opponent-archetype'

const STANDARD_MULLIGAN =
  'Keep independently useful early plays and affordable interaction. Keep a conditional payoff only with its support; return expensive finishers.'

const STANDARD_REQUIREMENTS: readonly CuratedRequirement[] = [
  { tag: 'early', minimum: 5, maximum: 30 },
  { tag: 'board', minimum: 14, maximum: 30 },
  { tag: 'interaction', minimum: 3, maximum: 30 },
  { tag: 'resource', minimum: 1, maximum: 30 },
  { tag: 'cost:8+', minimum: 0, maximum: 4 },
  { tag: 'cost:6+', minimum: 1, maximum: 8 },
  { tag: 'cost:4-5', minimum: 4, maximum: 14 },
  { tag: 'class-card', minimum: 6, maximum: 30 },
  { tag: 'threat', minimum: 3, maximum: 30 },
  { tag: 'weak-body', minimum: 0, maximum: 2 }
]

interface AdditionalArchetypeInput {
  readonly id: string
  readonly name: string
  readonly classId: OpponentArchetype['classId']
  readonly plan: string
  readonly core: readonly CuratedCardSlot[]
  readonly variants: readonly CuratedPackage[]
  readonly preferences: readonly string[]
  readonly requirements?: readonly CuratedRequirement[]
  readonly sources: readonly string[]
  readonly maxCopies?: Readonly<Record<string, number>>
}

function additionalArchetype(input: AdditionalArchetypeInput): OpponentArchetype {
  return {
    id: input.id,
    name: input.name,
    classId: input.classId,
    strategy: 'midrange-tempo',
    plan: input.plan,
    mulligan: STANDARD_MULLIGAN,
    core: input.core,
    variants: input.variants,
    requirements: [...STANDARD_REQUIREMENTS, ...(input.requirements ?? [])],
    sources: input.sources,
    maxCopies: input.maxCopies,
    preferences: input.preferences
  }
}

/** Additional historical packages; the live catalog still fills the remaining slots. */
const ADDITIONAL_ARCHETYPES: readonly OpponentArchetype[] = [
  additionalArchetype({
    id: 'classic-midrange-druid',
    name: 'Classic Midrange/Ramp Druid',
    classId: 'Druid',
    plan: 'Use Innervate and Wild Growth to reach strong midgame bodies early, then stabilize with flexible Druid threats and a board-based finisher.',
    core: [
      { id: 'classic_ancient_of_lore', count: 2 },
      { id: 'classic_force_of_nature', count: 2 }
    ],
    variants: [
      {
        id: 'ramp-curve',
        reason: 'Emphasize ramp and resource while preserving a smooth board curve.',
        preferences: ['ramp', 'resource'],
        requirements: []
      },
      {
        id: 'finisher-pressure',
        reason: 'Emphasize threat and resilient midgame bodies.',
        preferences: ['threat', 'resilient'],
        requirements: []
      }
    ],
    requirements: [{ tag: 'ramp', minimum: 2, maximum: 30 }],
    sources: [
      'https://www.gamespot.com/articles/state-of-the-metagame-02-28-2014/1100-6437168/'
    ],
    preferences: ['ramp', 'resource', 'resilient', 'threat']
  }),
  additionalArchetype({
    id: 'murloc-paladin',
    name: 'Murloc Midrange Paladin',
    classId: 'Paladin',
    plan: 'Develop a wide Murloc board, preserve the tribe for global buffs, and turn a board advantage into a strong midgame attack.',
    core: [
      { id: 'classic_murloc_warleader', count: 2 },
      { id: 'classic_old_murk_eye', count: 1 }
    ],
    variants: [
      {
        id: 'tribal-pressure',
        reason: 'Emphasize early Murlocs and tribal board pressure.',
        preferences: ['tribe:Murloc', 'early'],
        requirements: []
      },
      {
        id: 'tribal-refill',
        reason: 'Emphasize Murloc resource generation and resilient board development.',
        preferences: ['tribe:Murloc', 'resource', 'resilient'],
        requirements: []
      }
    ],
    requirements: [{ tag: 'tribe:Murloc', minimum: 10, maximum: 30 }],
    sources: ['https://articles.hsreplay.net/2017/05/03/pace-of-the-meta-ungoro/'],
    preferences: ['tribe:Murloc', 'token-source', 'board-buff', 'early']
  }),
  additionalArchetype({
    id: 'midrange-overload-shaman',
    name: 'Classic Midrange/Overload Shaman',
    classId: 'Shaman',
    plan: 'Use Overload-efficient removal and Fire Elementals to seize the board, then keep enough mana available to continue developing through locked turns.',
    core: [
      { id: 'basic_fire_elemental', count: 2 },
      { id: 'the_grand_tournament_elemental_destruction', count: 2 }
    ],
    variants: [
      {
        id: 'overload-pressure',
        reason: 'Emphasize Overload payoffs and interaction.',
        preferences: ['overload', 'interaction'],
        requirements: []
      },
      {
        id: 'fire-elemental-curve',
        reason: 'Emphasize threats and resource while retaining the Overload package.',
        preferences: ['threat', 'resource'],
        requirements: []
      }
    ],
    requirements: [{ tag: 'overload', minimum: 6, maximum: 30 }],
    sources: [
      'https://www.gamespot.com/articles/state-of-the-metagame-04-27-2014/1100-6437467/'
    ],
    preferences: ['overload', 'interaction', 'threat', 'resource']
  }),
  additionalArchetype({
    id: 'secret-hunter',
    name: 'Secret Midrange Hunter',
    classId: 'Hunter',
    plan: 'Use Secrets and Eaglehorn Bow to create awkward attacks, then curve into a pressure package that punishes opponents for playing too slowly.',
    core: [
      { id: 'classic_eaglehorn_bow', count: 2 },
      { id: 'one_night_in_karazhan_cloaked_huntress', count: 2 }
    ],
    variants: [
      {
        id: 'secret-pressure',
        reason: 'Emphasize Secrets, Secret payoffs and early board pressure.',
        preferences: ['secret', 'secret-payoff', 'early'],
        requirements: []
      },
      {
        id: 'secret-resilience',
        reason: 'Emphasize Secrets, weapons and resilient threats.',
        preferences: ['secret', 'weapon', 'resilient'],
        requirements: []
      }
    ],
    requirements: [
      { tag: 'secret', minimum: 4, maximum: 30 },
      { tag: 'secret-kind', minimum: 3, maximum: 30 },
      { tag: 'weapon', minimum: 2, maximum: 4 }
    ],
    sources: ['https://www.vicioussyndicate.com/vs-data-reaper-report-22/'],
    preferences: ['secret', 'secret-payoff', 'weapon', 'early']
  }),
  additionalArchetype({
    id: 'cthun-priest',
    name: "C'Thun Midrange Priest",
    classId: 'Priest',
    plan: "Build a durable board with C'Thun's cultists, use Priest removal to survive, and reserve C'Thun or its threshold payoffs for the decisive turn.",
    core: [
      { id: 'whispers_of_the_old_gods_cthun', count: 1 },
      { id: 'whispers_of_the_old_gods_twilight_darkmender', count: 2 }
    ],
    variants: [
      {
        id: 'threshold-control',
        reason: "Emphasize C'Thun buffs, threshold payoffs and interaction.",
        preferences: ['cthun-buff', 'cthun-payoff', 'interaction'],
        requirements: []
      },
      {
        id: 'cultist-board',
        reason: "Emphasize early C'Thun cultists and resource generation.",
        preferences: ['cthun-buff', 'early', 'resource'],
        requirements: []
      }
    ],
    requirements: [
      { tag: 'cthun-buff', minimum: 8, maximum: 30 },
      { tag: 'cthun-payoff', minimum: 2, maximum: 30 }
    ],
    sources: ['https://www.vicioussyndicate.com/vs-data-reaper-report-31/'],
    preferences: ['cthun-buff', 'cthun-payoff', 'interaction', 'resource']
  }),
  additionalArchetype({
    id: 'nzoth-priest',
    name: "N'Zoth Deathrattle Priest",
    classId: 'Priest',
    plan: "Trade durable Deathrattle minions into the opponent's board, then reload with N'Zoth after enough valuable resurrection targets have died.",
    core: [
      { id: 'whispers_of_the_old_gods_nzoth_the_corruptor', count: 1 },
      { id: 'classic_sylvanas_windrunner', count: 1 },
      { id: 'naxxramas_deathlord', count: 2 }
    ],
    variants: [
      {
        id: 'deathrattle-value',
        reason: 'Emphasize large Deathrattles and resource generation.',
        preferences: ['deathrattle', 'large-deathrattle', 'resource'],
        requirements: []
      },
      {
        id: 'deathrattle-stabilize',
        reason: 'Emphasize early defensive Deathrattles and interaction.',
        preferences: ['deathrattle', 'early', 'interaction'],
        requirements: []
      }
    ],
    requirements: [
      { tag: 'deathrattle', minimum: 8, maximum: 30 },
      { tag: 'large-deathrattle', minimum: 3, maximum: 30 }
    ],
    sources: ['https://www.vicioussyndicate.com/vs-data-reaper-report-35/'],
    preferences: ['deathrattle', 'large-deathrattle', 'resource', 'interaction']
  }),
  additionalArchetype({
    id: 'cthun-warrior',
    name: "C'Thun Midrange Warrior",
    classId: 'Warrior',
    plan: "Use weapons and sturdy C'Thun followers to control the board, grow C'Thun steadily, and finish with a large threshold payoff.",
    core: [
      { id: 'whispers_of_the_old_gods_cthun', count: 1 },
      { id: 'whispers_of_the_old_gods_cthuns_chosen', count: 2 }
    ],
    variants: [
      {
        id: 'armor-and-value',
        reason: "Emphasize C'Thun buffs, interaction and resource.",
        preferences: ['cthun-buff', 'interaction', 'resource'],
        requirements: []
      },
      {
        id: 'cultist-pressure',
        reason: "Emphasize early C'Thun bodies and sustained board pressure.",
        preferences: ['cthun-buff', 'early', 'threat'],
        requirements: []
      }
    ],
    requirements: [
      { tag: 'cthun-buff', minimum: 8, maximum: 30 },
      { tag: 'cthun-payoff', minimum: 2, maximum: 30 },
      { tag: 'weapon', minimum: 2, maximum: 5 }
    ],
    sources: ['https://www.vicioussyndicate.com/vs-data-reaper-report-31/'],
    preferences: ['cthun-buff', 'cthun-payoff', 'weapon', 'interaction']
  }),
  additionalArchetype({
    id: 'patron-warrior',
    name: 'Grim Patron Tempo Warrior',
    classId: 'Warrior',
    plan: 'Use inexpensive damage effects and weapons to create multiple Grim Patrons, then convert the widened board into tempo or a lethal attack.',
    core: [
      { id: 'blackrock_mountain_grim_patron', count: 2 },
      { id: 'basic_warsong_commander', count: 1 }
    ],
    variants: [
      {
        id: 'patron-combo',
        reason: 'Emphasize friendly-damage activators and resource sequencing.',
        preferences: ['friendly-damage', 'resource', 'early'],
        requirements: []
      },
      {
        id: 'patron-tempo',
        reason: 'Emphasize weapons, interaction and board pressure.',
        preferences: ['friendly-damage', 'weapon', 'interaction'],
        requirements: []
      }
    ],
    requirements: [
      { tag: 'friendly-damage', minimum: 3, maximum: 30 },
      { tag: 'weapon', minimum: 2, maximum: 5 }
    ],
    sources: ['https://www.vicioussyndicate.com/vs-data-reaper-report-22/'],
    preferences: ['friendly-damage', 'weapon', 'early', 'resource']
  }),
  additionalArchetype({
    id: 'medivh-mage',
    name: 'Medivh Value Mage',
    classId: 'Mage',
    plan: 'Use efficient spells to survive the midgame, then turn Firelands Portal and other expensive spells into additional board presence through Medivh.',
    core: [
      { id: 'one_night_in_karazhan_medivh_the_guardian', count: 1 },
      { id: 'one_night_in_karazhan_firelands_portal', count: 2 }
    ],
    variants: [
      {
        id: 'portal-value',
        reason: 'Emphasize expensive spells, resource and late threats.',
        preferences: ['spell', 'resource', 'threat'],
        requirements: []
      },
      {
        id: 'control-tempo',
        reason:
          'Emphasize interaction and a stable early curve before the portal package.',
        preferences: ['interaction', 'early', 'spell'],
        requirements: []
      }
    ],
    requirements: [{ tag: 'spell', minimum: 10, maximum: 30 }],
    sources: ['https://www.vicioussyndicate.com/vs-data-reaper-report-31/'],
    preferences: ['spell', 'resource', 'interaction', 'threat']
  }),
  additionalArchetype({
    id: 'oil-rogue',
    name: 'Oil Tempo Rogue',
    classId: 'Rogue',
    plan: 'Build weapon durability and attack buffs together, use efficient Rogue removal to protect the board, and convert a developed weapon into a burst turn.',
    core: [{ id: 'goblins_vs_gnomes_tinkers_sharpsword_oil', count: 2 }],
    variants: [
      {
        id: 'weapon-burst',
        reason: 'Emphasize weapons, Oil payoffs and direct interaction.',
        preferences: ['weapon', 'interaction', 'threat'],
        requirements: []
      },
      {
        id: 'tempo-refill',
        reason: 'Emphasize early plays, resource and flexible weapon use.',
        preferences: ['weapon', 'early', 'resource'],
        requirements: []
      }
    ],
    requirements: [{ tag: 'weapon', minimum: 3, maximum: 5 }],
    sources: [
      'https://www.gamespot.com/articles/state-of-the-metagame-02-28-2014/1100-6437168/'
    ],
    preferences: ['weapon', 'interaction', 'early', 'resource']
  }),
  additionalArchetype({
    id: 'water-rogue',
    name: 'Water/Tempo Rogue',
    classId: 'Rogue',
    plan: 'Keep the opponent under pressure with cheap Pirates and generated resources, then use Combo payoffs and the Rogue weapon to maintain tempo.',
    core: [
      { id: 'one_night_in_karazhan_swashburglar', count: 2 },
      { id: 'classic_edwin_vancleef', count: 1 }
    ],
    variants: [
      {
        id: 'pirate-pressure',
        reason: 'Emphasize cheap Pirates, early board presence and weapon tempo.',
        preferences: ['tribe:Pirate', 'early', 'weapon'],
        requirements: []
      },
      {
        id: 'generated-value',
        reason: 'Emphasize resource generation while preserving cheap Combo enablers.',
        preferences: ['resource', 'early', 'cheap-spell'],
        requirements: []
      }
    ],
    requirements: [{ tag: 'cheap-plays', minimum: 6, maximum: 30 }],
    sources: ['https://www.vicioussyndicate.com/vs-data-reaper-report-31/'],
    preferences: ['early', 'resource', 'weapon', 'cheap-spell']
  }),
  additionalArchetype({
    id: 'handlock',
    name: 'Handlock Warlock',
    classId: 'Warlock',
    plan: 'Use Life Tap and efficient defensive tools to keep a large hand, then deploy Mountain Giants and Twilight Drakes as oversized midgame threats.',
    core: [
      { id: 'classic_mountain_giant', count: 2 },
      { id: 'classic_twilight_drake', count: 2 }
    ],
    variants: [
      {
        id: 'giant-pressure',
        reason: 'Emphasize large threats and taunt protection.',
        preferences: ['threat', 'resilient', 'resource'],
        requirements: []
      },
      {
        id: 'control-hand',
        reason: 'Emphasize interaction and resource before playing the giant package.',
        preferences: ['interaction', 'resource', 'threat'],
        requirements: []
      }
    ],
    requirements: [
      { tag: 'cost:8+', minimum: 2, maximum: 6 },
      { tag: 'cost:6+', minimum: 3, maximum: 10 },
      { tag: 'threat', minimum: 4, maximum: 30 }
    ],
    sources: [
      'https://www.hearthpwn.com/decks/768577-bringing-back-handlock-ungoro-edition'
    ],
    preferences: ['threat', 'resource', 'interaction', 'resilient']
  }),
  additionalArchetype({
    id: 'zoo-warlock',
    name: 'Demon Zoo Warlock',
    classId: 'Warlock',
    plan: 'Fill the board with cheap Demons, use efficient buffs and trades to preserve tempo, then let Doomguard convert the remaining board into damage.',
    core: [
      { id: 'classic_flame_imp', count: 2 },
      { id: 'classic_doomguard', count: 2 }
    ],
    variants: [
      {
        id: 'demon-pressure',
        reason: 'Emphasize cheap Demons, early board presence and direct pressure.',
        preferences: ['tribe:Demon', 'early', 'threat'],
        requirements: []
      },
      {
        id: 'demon-trades',
        reason: 'Emphasize resilient bodies, activators and efficient interaction.',
        preferences: ['tribe:Demon', 'resilient', 'egg-activator'],
        requirements: []
      }
    ],
    requirements: [{ tag: 'tribe:Demon', minimum: 9, maximum: 30 }],
    sources: ['https://www.vicioussyndicate.com/vs-data-reaper-report-22/'],
    preferences: ['tribe:Demon', 'early', 'threat', 'resilient']
  })
]

/** Defining anchors and role targets; supporting cards come from the live catalog. */
export const OPPONENT_ARCHETYPES: readonly OpponentArchetype[] = [
  {
    id: 'secret-paladin',
    name: 'Secret Midrange Paladin',
    classId: 'Paladin',
    strategy: 'midrange-tempo',
    plan: 'Establish an early board, then use Mysterious Challenger to develop pressure and pull remaining secrets. Sequence attacks around active secrets and protect threats that can keep attacking.',
    mulligan:
      'Keep independently useful early plays and affordable interaction. Keep a conditional payoff only with its support; return expensive finishers.',
    core: [
      {
        id: 'the_grand_tournament_mysterious_challenger',
        count: 2
      }
    ],
    variants: [
      {
        id: 'pressure',
        reason: 'Emphasize secret-payoff and early using the current collection.',
        preferences: ['secret-payoff', 'early'],
        requirements: []
      },
      {
        id: 'resilience',
        reason: 'Emphasize resilient and resource using the current collection.',
        preferences: ['resilient', 'resource'],
        requirements: []
      }
    ],
    requirements: [
      {
        tag: 'early',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'board',
        minimum: 16,
        maximum: 30
      },
      {
        tag: 'interaction',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'resource',
        minimum: 1,
        maximum: 30
      },
      {
        tag: 'cost:8+',
        minimum: 0,
        maximum: 1
      },
      {
        tag: 'cost:6+',
        minimum: 2,
        maximum: 5
      },
      {
        tag: 'cost:4-5',
        minimum: 6,
        maximum: 12
      },
      {
        tag: 'secret',
        minimum: 6,
        maximum: 6
      },
      {
        tag: 'weapon',
        minimum: 1,
        maximum: 3
      },
      {
        tag: 'secret-kind',
        minimum: 4,
        maximum: 30
      },
      {
        tag: 'class-card',
        minimum: 12,
        maximum: 30
      },
      {
        tag: 'class-card',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'threat',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'weak-body',
        minimum: 0,
        maximum: 2
      }
    ],
    sources: ['https://www.vicioussyndicate.com/coradin/'],
    maxCopies: {
      goblins_vs_gnomes_coghammer: 1,
      classic_divine_favor: 1,
      classic_equality: 1
    },
    preferences: ['secret', 'token-source', 'resilient']
  },
  {
    id: 'recruit-paladin',
    name: 'Silver Hand Midrange Paladin',
    classId: 'Paladin',
    strategy: 'midrange-tempo',
    plan: 'Build and preserve Silver Hand Recruits for Quartermaster. Weigh an immediate buff against losing recruits to a clear; use weapons and removal to protect the board.',
    mulligan:
      'Keep independently useful early plays and affordable interaction. Keep a conditional payoff only with its support; return expensive finishers.',
    core: [
      {
        id: 'goblins_vs_gnomes_quartermaster',
        count: 2
      }
    ],
    variants: [
      {
        id: 'recruits',
        reason: 'Emphasize recruit-source and resource using the current collection.',
        preferences: ['recruit-source', 'resource'],
        requirements: []
      },
      {
        id: 'recovery',
        reason: 'Emphasize interaction and resource using the current collection.',
        preferences: ['interaction', 'resource'],
        requirements: []
      }
    ],
    requirements: [
      {
        tag: 'early',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'board',
        minimum: 16,
        maximum: 30
      },
      {
        tag: 'interaction',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'resource',
        minimum: 2,
        maximum: 30
      },
      {
        tag: 'cost:8+',
        minimum: 0,
        maximum: 2
      },
      {
        tag: 'cost:6+',
        minimum: 2,
        maximum: 5
      },
      {
        tag: 'cost:4-5',
        minimum: 6,
        maximum: 12
      },
      {
        tag: 'recruit-source',
        minimum: 2,
        maximum: 30
      },
      {
        tag: 'weapon',
        minimum: 1,
        maximum: 3
      },
      {
        tag: 'class-card',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'threat',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'weak-body',
        minimum: 0,
        maximum: 2
      }
    ],
    sources: ['https://gazettereview.com/2016/01/top-heartstone-decks-2016/'],
    maxCopies: {
      goblins_vs_gnomes_coghammer: 1,
      classic_divine_favor: 1,
      classic_equality: 1
    },
    preferences: ['recruit-source', 'token-source', 'resilient']
  },
  {
    id: 'totem-shaman',
    name: 'Totem / Overload Midrange Shaman',
    classId: 'Shaman',
    strategy: 'midrange-tempo',
    plan: 'Develop totems and protect them for Thunder Bluff Valiant. Plan next-turn mana before taking overload, and exploit discounted Thing from Below to gain board tempo.',
    mulligan:
      'Keep independently useful early plays and affordable interaction. Keep a conditional payoff only with its support; return expensive finishers.',
    core: [
      {
        id: 'whispers_of_the_old_gods_thing_from_below',
        count: 2
      },
      {
        id: 'the_grand_tournament_thunder_bluff_valiant',
        count: 2
      }
    ],
    variants: [
      {
        id: 'spell-damage',
        reason: 'Emphasize spell-damage and weapon using the current collection.',
        preferences: ['spell-damage', 'weapon'],
        requirements: [
          {
            tag: 'spell-damage',
            minimum: 3,
            maximum: 30
          },
          {
            tag: 'weapon',
            minimum: 1,
            maximum: 3
          }
        ]
      },
      {
        id: 'board-pressure',
        reason: 'Emphasize token-source and board-buff using the current collection.',
        preferences: ['token-source', 'board-buff'],
        requirements: []
      }
    ],
    requirements: [
      {
        tag: 'early',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'board',
        minimum: 16,
        maximum: 30
      },
      {
        tag: 'interaction',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'resource',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'cost:8+',
        minimum: 0,
        maximum: 1
      },
      {
        tag: 'cost:6+',
        minimum: 2,
        maximum: 5
      },
      {
        tag: 'cost:4-5',
        minimum: 6,
        maximum: 12
      },
      {
        tag: 'totem',
        minimum: 5,
        maximum: 30
      },
      {
        tag: 'overload',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'class-card',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'threat',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'weak-body',
        minimum: 0,
        maximum: 2
      }
    ],
    sources: [
      'https://www.hearthstonetopdecks.com/decks/midrange-shaman-decklist-guide-standard-may-2016-season-26/'
    ],
    maxCopies: {
      basic_bloodlust: 1
    },
    preferences: ['totem', 'overload', 'tribe:Totem']
  },
  {
    id: 'jade-shaman',
    name: 'Jade Midrange Shaman',
    classId: 'Shaman',
    strategy: 'midrange-tempo',
    plan: 'Develop Jade Golems while contesting the board. Earlier Jade summons strengthen later ones; preserve enough mana for interaction instead of playing only for future value.',
    mulligan:
      'Keep independently useful early plays and affordable interaction. Keep a conditional payoff only with its support; return expensive finishers.',
    core: [
      {
        id: 'mean_streets_of_gadgetzan_aya_blackpaw',
        count: 1
      }
    ],
    variants: [
      {
        id: 'jade-value',
        reason: 'Emphasize jade and resource using the current collection.',
        preferences: ['jade', 'resource'],
        requirements: []
      },
      {
        id: 'tempo',
        reason: 'Emphasize early and interaction using the current collection.',
        preferences: ['early', 'interaction'],
        requirements: []
      }
    ],
    requirements: [
      {
        tag: 'early',
        minimum: 4,
        maximum: 30
      },
      {
        tag: 'board',
        minimum: 14,
        maximum: 30
      },
      {
        tag: 'interaction',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'resource',
        minimum: 2,
        maximum: 30
      },
      {
        tag: 'cost:8+',
        minimum: 0,
        maximum: 1
      },
      {
        tag: 'cost:6+',
        minimum: 2,
        maximum: 5
      },
      {
        tag: 'cost:4-5',
        minimum: 6,
        maximum: 12
      },
      {
        tag: 'jade',
        minimum: 8,
        maximum: 30
      },
      {
        tag: 'totem',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'class-card',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'threat',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'weak-body',
        minimum: 0,
        maximum: 2
      }
    ],
    sources: ['https://www.vicioussyndicate.com/vs-data-reaper-report-31/'],
    maxCopies: {
      basic_bloodlust: 1
    },
    preferences: ['jade', 'totem']
  },
  {
    id: 'beast-hunter',
    name: 'Beast Midrange Hunter',
    classId: 'Hunter',
    strategy: 'midrange-tempo',
    plan: 'Curve out with Beasts and keep a Beast alive for Houndmaster. Use resilient bodies and efficient removal to maintain pressure; trade when it protects stronger attackers.',
    mulligan:
      'Keep independently useful early plays and affordable interaction. Keep a conditional payoff only with its support; return expensive finishers.',
    core: [
      {
        id: 'basic_houndmaster',
        count: 2
      }
    ],
    variants: [
      {
        id: 'beast-curve',
        reason: 'Emphasize tribe:Beast and early using the current collection.',
        preferences: ['tribe:Beast', 'early'],
        requirements: []
      },
      {
        id: 'sticky-pressure',
        reason: 'Emphasize deathrattle and resilient using the current collection.',
        preferences: ['deathrattle', 'resilient'],
        requirements: []
      }
    ],
    requirements: [
      {
        tag: 'early',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'board',
        minimum: 16,
        maximum: 30
      },
      {
        tag: 'interaction',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'resource',
        minimum: 1,
        maximum: 30
      },
      {
        tag: 'cost:8+',
        minimum: 0,
        maximum: 1
      },
      {
        tag: 'cost:6+',
        minimum: 2,
        maximum: 5
      },
      {
        tag: 'cost:4-5',
        minimum: 6,
        maximum: 12
      },
      {
        tag: 'tribe:Beast',
        minimum: 10,
        maximum: 30
      },
      {
        tag: 'class-card',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'threat',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'weak-body',
        minimum: 0,
        maximum: 2
      }
    ],
    sources: ['https://www.vicioussyndicate.com/vs-data-reaper-report-5/'],
    maxCopies: {},
    preferences: ['tribe:Beast', 'resilient']
  },
  {
    id: 'nzoth-hunter',
    name: "N'Zoth Deathrattle Hunter",
    classId: 'Hunter',
    strategy: 'midrange-tempo',
    plan: "Contest the board with Beasts and valuable deathrattles. Let useful deathrattles die before committing N'Zoth, and reserve board space for its resurrection.",
    mulligan:
      'Keep independently useful early plays and affordable interaction. Keep a conditional payoff only with its support; return expensive finishers.',
    core: [
      {
        id: 'whispers_of_the_old_gods_nzoth_the_corruptor',
        count: 1
      }
    ],
    variants: [
      {
        id: 'deathrattle-value',
        reason:
          'Emphasize large-deathrattle and resource using the current collection.',
        preferences: ['large-deathrattle', 'resource'],
        requirements: []
      },
      {
        id: 'pressure',
        reason: 'Emphasize early and deathrattle using the current collection.',
        preferences: ['early', 'deathrattle'],
        requirements: []
      }
    ],
    requirements: [
      {
        tag: 'early',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'board',
        minimum: 16,
        maximum: 30
      },
      {
        tag: 'interaction',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'resource',
        minimum: 1,
        maximum: 30
      },
      {
        tag: 'cost:8+',
        minimum: 0,
        maximum: 1
      },
      {
        tag: 'cost:6+',
        minimum: 2,
        maximum: 5
      },
      {
        tag: 'cost:4-5',
        minimum: 6,
        maximum: 12
      },
      {
        tag: 'tribe:Beast',
        minimum: 10,
        maximum: 30
      },
      {
        tag: 'deathrattle',
        minimum: 9,
        maximum: 30
      },
      {
        tag: 'large-deathrattle',
        minimum: 4,
        maximum: 30
      },
      {
        tag: 'class-card',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'threat',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'weak-body',
        minimum: 0,
        maximum: 2
      }
    ],
    sources: ['https://www.vicioussyndicate.com/vs-data-reaper-report-5/'],
    maxCopies: {},
    preferences: ['deathrattle', 'large-deathrattle', 'tribe:Beast']
  },
  {
    id: 'cthun-druid',
    name: "C'Thun Midrange Druid",
    classId: 'Druid',
    strategy: 'midrange-tempo',
    plan: "Develop efficient cultists, reach ten C'Thun attack for threshold payoffs, and use C'Thun to finish or stabilize. Ramp only when safe.",
    mulligan:
      'Keep independently useful early plays and affordable interaction. Keep a conditional payoff only with its support; return expensive finishers.',
    core: [
      {
        id: 'whispers_of_the_old_gods_cthun',
        count: 1
      }
    ],
    variants: [
      {
        id: 'threshold-payoffs',
        reason: 'Emphasize cthun-payoff and cthun-buff using the current collection.',
        preferences: ['cthun-payoff', 'cthun-buff'],
        requirements: []
      },
      {
        id: 'flexible-curve',
        reason: 'Emphasize choose-one and resource using the current collection.',
        preferences: ['choose-one', 'resource'],
        requirements: []
      }
    ],
    requirements: [
      {
        tag: 'early',
        minimum: 4,
        maximum: 30
      },
      {
        tag: 'board',
        minimum: 14,
        maximum: 30
      },
      {
        tag: 'interaction',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'resource',
        minimum: 2,
        maximum: 30
      },
      {
        tag: 'cost:8+',
        minimum: 0,
        maximum: 1
      },
      {
        tag: 'cost:6+',
        minimum: 2,
        maximum: 5
      },
      {
        tag: 'cost:4-5',
        minimum: 4,
        maximum: 10
      },
      {
        tag: 'cthun-buff',
        minimum: 10,
        maximum: 30
      },
      {
        tag: 'ramp',
        minimum: 4,
        maximum: 30
      },
      {
        tag: 'cthun-payoff',
        minimum: 2,
        maximum: 30
      },
      {
        tag: 'resource',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'class-card',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'threat',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'weak-body',
        minimum: 0,
        maximum: 2
      }
    ],
    sources: [
      'https://www.hearthstonetopdecks.com/decks/gamekings-cthun-druid-hearthstone-eu-spring-prelims-2016/'
    ],
    maxCopies: {},
    preferences: ['cthun-buff', 'cthun-payoff', 'ramp']
  },
  {
    id: 'yogg-token-druid',
    name: 'Yogg Token Druid',
    classId: 'Druid',
    strategy: 'midrange-tempo',
    plan: 'Build token boards with useful spells, then buff or protect them. Yogg is recovery when behind; avoid gambling away a winning board.',
    mulligan:
      'Keep independently useful early plays and affordable interaction. Keep a conditional payoff only with its support; return expensive finishers.',
    core: [
      {
        id: 'whispers_of_the_old_gods_yogg_saron_hopes_end',
        count: 1
      },
      {
        id: 'classic_violet_teacher',
        count: 2
      }
    ],
    variants: [
      {
        id: 'token-pressure',
        reason: 'Emphasize token-source and board-buff using the current collection.',
        preferences: ['token-source', 'board-buff'],
        requirements: [
          {
            tag: 'board-buff',
            minimum: 3,
            maximum: 30
          }
        ]
      },
      {
        id: 'refill',
        reason: 'Emphasize resource and choose-one using the current collection.',
        preferences: ['resource', 'choose-one'],
        requirements: []
      }
    ],
    requirements: [
      {
        tag: 'early',
        minimum: 2,
        maximum: 30
      },
      {
        tag: 'board',
        minimum: 8,
        maximum: 30
      },
      {
        tag: 'interaction',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'resource',
        minimum: 2,
        maximum: 30
      },
      {
        tag: 'cost:8+',
        minimum: 0,
        maximum: 1
      },
      {
        tag: 'cost:6+',
        minimum: 1,
        maximum: 3
      },
      {
        tag: 'cost:4-5',
        minimum: 4,
        maximum: 14
      },
      {
        tag: 'spell',
        minimum: 18,
        maximum: 30
      },
      {
        tag: 'cheap-spell',
        minimum: 10,
        maximum: 30
      },
      {
        tag: 'token-source',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'class-card',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'threat',
        minimum: 1,
        maximum: 30
      },
      {
        tag: 'weak-body',
        minimum: 0,
        maximum: 2
      }
    ],
    sources: [
      'https://www.hearthpwn.com/decks/562644-yogg-token-druid-guide-by-j4ckiechan'
    ],
    maxCopies: {
      whispers_of_the_old_gods_wisps_of_the_old_gods: 1,
      basic_savage_roar: 1
    },
    preferences: ['token-source', 'board-buff', 'choose-one', 'cheap-spell']
  },
  {
    id: 'dragon-priest',
    name: 'Dragon Midrange Priest',
    classId: 'Priest',
    strategy: 'midrange-tempo',
    plan: 'Retain a Dragon in hand when it enables conditional minions. Build durable board presence and use removal to protect it; do not play the last enabling Dragon without checking the cost.',
    mulligan:
      'Keep independently useful early plays and affordable interaction. Keep a conditional payoff only with its support; return expensive finishers.',
    core: [
      {
        id: 'mean_streets_of_gadgetzan_drakonid_operative',
        count: 2
      }
    ],
    variants: [
      {
        id: 'dragon-value',
        reason: 'Emphasize resource and tribe:Dragon using the current collection.',
        preferences: ['resource', 'tribe:Dragon'],
        requirements: []
      },
      {
        id: 'board-tempo',
        reason: 'Emphasize early and buff using the current collection.',
        preferences: ['early', 'buff'],
        requirements: []
      }
    ],
    requirements: [
      {
        tag: 'early',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'board',
        minimum: 16,
        maximum: 30
      },
      {
        tag: 'interaction',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'resource',
        minimum: 2,
        maximum: 30
      },
      {
        tag: 'cost:8+',
        minimum: 0,
        maximum: 1
      },
      {
        tag: 'cost:6+',
        minimum: 2,
        maximum: 4
      },
      {
        tag: 'cost:4-5',
        minimum: 6,
        maximum: 12
      },
      {
        tag: 'tribe:Dragon',
        minimum: 9,
        maximum: 30
      },
      {
        tag: 'dragon-payoff',
        minimum: 4,
        maximum: 30
      },
      {
        tag: 'class-card',
        minimum: 8,
        maximum: 30
      },
      {
        tag: 'threat',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'weak-body',
        minimum: 0,
        maximum: 2
      }
    ],
    sources: ['https://www.vicioussyndicate.com/vs-data-reaper-report-31/'],
    maxCopies: {},
    preferences: ['tribe:Dragon', 'dragon-payoff']
  },
  {
    id: 'dragon-warrior',
    name: 'Dragon Tempo Warrior',
    classId: 'Warrior',
    strategy: 'midrange-tempo',
    plan: 'Combine early attackers and weapons to seize the board. Retain a Dragon for conditional payoffs, spend weapons to protect attackers, and turn sustained board pressure into lethal damage.',
    mulligan:
      'Keep independently useful early plays and affordable interaction. Keep a conditional payoff only with its support; return expensive finishers.',
    core: [
      {
        id: 'the_grand_tournament_alexstraszas_champion',
        count: 2
      }
    ],
    variants: [
      {
        id: 'pressure',
        reason: 'Emphasize threat and interaction using the current collection.',
        preferences: ['threat', 'interaction'],
        requirements: []
      },
      {
        id: 'refill',
        reason: 'Emphasize resource generation while preserving the Dragon tempo plan.',
        preferences: ['resource', 'tribe:Dragon'],
        requirements: []
      }
    ],
    requirements: [
      {
        tag: 'early',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'board',
        minimum: 16,
        maximum: 30
      },
      {
        tag: 'interaction',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'resource',
        minimum: 2,
        maximum: 30
      },
      {
        tag: 'cost:8+',
        minimum: 0,
        maximum: 1
      },
      {
        tag: 'cost:6+',
        minimum: 1,
        maximum: 4
      },
      {
        tag: 'cost:4-5',
        minimum: 6,
        maximum: 12
      },
      {
        tag: 'tribe:Dragon',
        minimum: 8,
        maximum: 30
      },
      {
        tag: 'weapon',
        minimum: 3,
        maximum: 4
      },
      {
        tag: 'dragon-payoff',
        minimum: 4,
        maximum: 30
      },
      {
        tag: 'class-card',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'threat',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'weak-body',
        minimum: 0,
        maximum: 2
      }
    ],
    sources: ['https://www.vicioussyndicate.com/top-8-recap-world-championship-2016/'],
    maxCopies: {},
    preferences: ['tribe:Dragon', 'dragon-payoff', 'weapon']
  },
  {
    id: 'mech-mage',
    name: 'Mech Tempo Mage',
    classId: 'Mage',
    strategy: 'midrange-tempo',
    plan: 'Use Mechwarper to develop Mechs efficiently and retain a friendly Mech for Goblin Blastmage. Protect resilient bodies, and use spells to remove blockers or finish the game.',
    mulligan:
      'Keep independently useful early plays and affordable interaction. Keep a conditional payoff only with its support; return expensive finishers.',
    core: [
      {
        id: 'goblins_vs_gnomes_mechwarper',
        count: 2
      },
      {
        id: 'goblins_vs_gnomes_goblin_blastmage',
        count: 2
      }
    ],
    variants: [
      {
        id: 'sticky-mechs',
        reason: 'Emphasize resilient and tribe:Mech using the current collection.',
        preferences: ['resilient', 'tribe:Mech'],
        requirements: []
      },
      {
        id: 'spare-parts',
        reason: 'Emphasize spare-parts and resource using the current collection.',
        preferences: ['spare-parts', 'resource'],
        requirements: [
          {
            tag: 'spare-parts',
            minimum: 4,
            maximum: 30
          }
        ]
      }
    ],
    requirements: [
      {
        tag: 'early',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'board',
        minimum: 16,
        maximum: 30
      },
      {
        tag: 'interaction',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'resource',
        minimum: 2,
        maximum: 30
      },
      {
        tag: 'cost:8+',
        minimum: 0,
        maximum: 1
      },
      {
        tag: 'cost:6+',
        minimum: 1,
        maximum: 3
      },
      {
        tag: 'cost:4-5',
        minimum: 6,
        maximum: 12
      },
      {
        tag: 'tribe:Mech',
        minimum: 12,
        maximum: 30
      },
      {
        tag: 'mech-payoff',
        minimum: 4,
        maximum: 30
      },
      {
        tag: 'class-card',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'threat',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'weak-body',
        minimum: 0,
        maximum: 2
      }
    ],
    sources: ['https://www.hearthpwn.com/decks/238827-budget-mech-mage-no-secrets'],
    maxCopies: {},
    preferences: ['tribe:Mech', 'mech-payoff', 'resilient']
  },
  {
    id: 'flamewaker-mage',
    name: 'Flamewaker Tempo Mage',
    classId: 'Mage',
    strategy: 'midrange-tempo',
    plan: 'Pair cheap spells with Flamewaker or other spell-trigger minions when that produces immediate tempo. Sequence spell damage bonuses before damage spells, while avoiding excessive spell hoarding.',
    mulligan:
      'Keep independently useful early plays and affordable interaction. Keep a conditional payoff only with its support; return expensive finishers.',
    core: [
      {
        id: 'blackrock_mountain_flamewaker',
        count: 2
      }
    ],
    variants: [
      {
        id: 'board-tempo',
        reason: 'Emphasize board and early using the current collection.',
        preferences: ['board', 'early'],
        requirements: []
      },
      {
        id: 'spell-value',
        reason: 'Emphasize spell-damage and resource using the current collection.',
        preferences: ['spell-damage', 'resource'],
        requirements: []
      }
    ],
    requirements: [
      {
        tag: 'early',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'board',
        minimum: 10,
        maximum: 30
      },
      {
        tag: 'interaction',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'resource',
        minimum: 2,
        maximum: 30
      },
      {
        tag: 'cost:8+',
        minimum: 0,
        maximum: 1
      },
      {
        tag: 'cost:6+',
        minimum: 1,
        maximum: 3
      },
      {
        tag: 'cost:4-5',
        minimum: 3,
        maximum: 8
      },
      {
        tag: 'cheap-spell',
        minimum: 10,
        maximum: 30
      },
      {
        tag: 'spell',
        minimum: 14,
        maximum: 30
      },
      {
        tag: 'spell-payoff',
        minimum: 4,
        maximum: 30
      },
      {
        tag: 'class-card',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'threat',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'weak-body',
        minimum: 0,
        maximum: 2
      }
    ],
    sources: ['https://www.reddit.com/r/CompetitiveHS/comments/401m7m/tempo_mage/'],
    maxCopies: {},
    preferences: ['cheap-spell', 'spell-payoff', 'spell-damage']
  },
  {
    id: 'nzoth-rogue',
    name: "N'Zoth Raptor Midrange Rogue",
    classId: 'Rogue',
    strategy: 'midrange-tempo',
    plan: "Develop valuable deathrattles and copy useful friendly deathrattles with Unearthed Raptor. Use efficient interaction to protect pressure, then reload with N'Zoth after strong resurrection targets have died.",
    mulligan:
      'Keep independently useful early plays and affordable interaction. Keep a conditional payoff only with its support; return expensive finishers.',
    core: [
      {
        id: 'whispers_of_the_old_gods_nzoth_the_corruptor',
        count: 1
      },
      {
        id: 'league_of_explorers_unearthed_raptor',
        count: 2
      }
    ],
    variants: [
      {
        id: 'deathrattle-reload',
        reason:
          'Emphasize large-deathrattle and resilient using the current collection.',
        preferences: ['large-deathrattle', 'resilient'],
        requirements: []
      },
      {
        id: 'tempo-refill',
        reason: 'Emphasize early and resource using the current collection.',
        preferences: ['early', 'resource'],
        requirements: []
      }
    ],
    requirements: [
      {
        tag: 'early',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'board',
        minimum: 16,
        maximum: 30
      },
      {
        tag: 'interaction',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'resource',
        minimum: 2,
        maximum: 30
      },
      {
        tag: 'cost:8+',
        minimum: 0,
        maximum: 1
      },
      {
        tag: 'cost:6+',
        minimum: 2,
        maximum: 5
      },
      {
        tag: 'cost:4-5',
        minimum: 6,
        maximum: 12
      },
      {
        tag: 'deathrattle',
        minimum: 9,
        maximum: 30
      },
      {
        tag: 'large-deathrattle',
        minimum: 4,
        maximum: 30
      },
      {
        tag: 'class-card',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'threat',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'weak-body',
        minimum: 0,
        maximum: 2
      }
    ],
    sources: [
      'https://www.hipstersofthecoast.com/2016/09/look-hearthstones-recipe-decks/'
    ],
    maxCopies: {},
    preferences: ['deathrattle', 'large-deathrattle']
  },
  {
    id: 'demon-warlock',
    name: 'Demon Midrange Warlock',
    classId: 'Warlock',
    strategy: 'midrange-tempo',
    plan: 'Develop a durable early board. Play smaller demons before trading Voidcaller when that improves its summon. Spend expendable cards before a necessary discard; use Life Tap when safe.',
    mulligan:
      'Keep independently useful early plays and affordable interaction. Keep a conditional payoff only with its support; return expensive finishers.',
    core: [
      {
        id: 'naxxramas_voidcaller',
        count: 2
      }
    ],
    variants: [
      {
        id: 'egg-pressure',
        reason: 'Emphasize deathrattle and egg-activator using the current collection.',
        preferences: ['deathrattle', 'egg-activator'],
        requirements: []
      },
      {
        id: 'board-growth',
        reason: 'Emphasize token-source and board-buff using the current collection.',
        preferences: ['token-source', 'board-buff'],
        requirements: []
      }
    ],
    requirements: [
      {
        tag: 'early',
        minimum: 8,
        maximum: 30
      },
      {
        tag: 'board',
        minimum: 16,
        maximum: 30
      },
      {
        tag: 'interaction',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'resource',
        minimum: 2,
        maximum: 30
      },
      {
        tag: 'cost:8+',
        minimum: 0,
        maximum: 1
      },
      {
        tag: 'cost:6+',
        minimum: 1,
        maximum: 3
      },
      {
        tag: 'cost:4-5',
        minimum: 5,
        maximum: 11
      },
      {
        tag: 'tribe:Demon',
        minimum: 9,
        maximum: 30
      },
      {
        tag: 'demon-target',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'class-card',
        minimum: 6,
        maximum: 30
      },
      {
        tag: 'threat',
        minimum: 3,
        maximum: 30
      },
      {
        tag: 'weak-body',
        minimum: 0,
        maximum: 2
      }
    ],
    sources: ['https://teamarchon.com/decks/view/13-midrange-warlock/'],
    maxCopies: {
      classic_void_terror: 1,
      basic_soulfire: 1
    },
    preferences: ['tribe:Demon', 'demon-target', 'token-source']
  },
  ...ADDITIONAL_ARCHETYPES
]
