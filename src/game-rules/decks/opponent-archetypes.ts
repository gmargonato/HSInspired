import type { OpponentArchetype } from './opponent-archetype'

/**
 * Three archetypes per class; one quest archetype per class (except Rogue, whose
 * quest is too hard to realize). Fixed cores stay small, packages guarantee the
 * archetype's synergy, and the profile shapes the curve. Random fill and universal
 * role floors supply unpredictability and "a little bit of everything".
 *
 * Plans and mulligans may only name core cards; the generated strategy brief lists
 * the key cards the finished list actually contains.
 */
export const OPPONENT_ARCHETYPES: readonly OpponentArchetype[] = [
  // ── Druid ─────────────────────────────────────────────────────────────────
  {
    id: 'ramp-druid',
    name: 'Ramp Druid',
    classId: 'Druid',
    quest: false,
    profile: 'ramp',
    plan: 'Use ramp spells to reach strong midgame bodies early, then stabilize with flexible Druid threats, Ancient of Lore value and a Force of Nature finisher.',
    mulligan: 'Keep ramp and affordable early plays; return expensive finishers.',
    core: [
      { id: 'classic_ancient_of_lore', count: 1 },
      { id: 'classic_force_of_nature', count: 1 }
    ],
    packages: [{ tag: 'ramp', min: 4 }],
    bias: ['ramp', 'resource', 'threat']
  },
  {
    id: 'token-druid',
    name: 'Token Druid',
    classId: 'Druid',
    quest: false,
    profile: 'midrange',
    plan: 'Build token boards with useful spells and Violet Teacher, then buff or protect them. Yogg-Saron is recovery when behind; avoid gambling away a winning board.',
    mulligan: 'Keep cheap spells and early token sources; return expensive finishers.',
    core: [
      { id: 'classic_violet_teacher', count: 1 },
      { id: 'whispers_of_the_old_gods_yogg_saron_hopes_end', count: 1 }
    ],
    packages: [
      { tag: 'token-source', min: 6 },
      { tag: 'cheap-spell', min: 6 }
    ],
    bias: ['token-source', 'cheap-spell', 'spell']
  },
  {
    id: 'quest-druid',
    name: 'Untapped Potential Druid',
    classId: 'Druid',
    quest: true,
    profile: 'ramp',
    plan: 'Complete Untapped Potential by ending four turns with unspent mana: leave a crystal free when the board allows it instead of forcing awkward plays, then leverage the reward with heavy late-game threats.',
    mulligan:
      'Keep ramp and smooth early plays; the quest needs turns that end with spare mana.',
    core: [{ id: 'journey_to_ungoro_untapped_potential', count: 1 }],
    packages: [{ tag: 'ramp', min: 3 }],
    bias: ['ramp', 'threat', 'resource']
  },

  // ── Hunter ────────────────────────────────────────────────────────────────
  {
    id: 'beast-hunter',
    name: 'Beast Midrange Hunter',
    classId: 'Hunter',
    quest: false,
    profile: 'midrange',
    plan: 'Curve out with Beasts and keep a Beast alive for Houndmaster. Use resilient bodies such as Savannah Highmane and efficient removal to maintain pressure; trade when it protects stronger attackers.',
    mulligan: 'Keep cheap Beasts and Houndmaster; return slow top-end.',
    core: [
      { id: 'classic_savannah_highmane', count: 1 },
      { id: 'basic_houndmaster', count: 1 }
    ],
    packages: [{ tag: 'tribe:Beast', min: 8 }],
    bias: ['tribe:Beast', 'early', 'threat']
  },
  {
    id: 'deathrattle-hunter',
    name: 'Deathrattle Hunter',
    classId: 'Hunter',
    quest: false,
    profile: 'midrange',
    plan: 'Develop sticky deathrattle bodies that keep returning value, protect them with removal, and finish with sustained board pressure backed by Sylvanas Windrunner.',
    mulligan:
      'Keep early deathrattle bodies and independent removal; return combo-heavy cards.',
    core: [{ id: 'classic_sylvanas_windrunner', count: 1 }],
    packages: [{ tag: 'deathrattle', min: 8 }],
    bias: ['deathrattle', 'threat', 'interaction']
  },
  {
    id: 'quest-hunter',
    name: 'Marsh Queen Hunter',
    classId: 'Hunter',
    quest: true,
    profile: 'aggro',
    plan: 'Play a one-cost minion every turn to complete The Marsh Queen, then flood the board with Queen Carnassa and her raptors.',
    mulligan:
      'Keep one-cost minions above all; the quest needs a cheap play every turn.',
    core: [{ id: 'journey_to_ungoro_the_marsh_queen', count: 1 }],
    packages: [{ tag: 'cost-1-minion', min: 10, max: 12, minQuality: 2 }],
    floorOverrides: [
      { tag: 'cost:0-1', min: 10, max: 13 },
      { tag: 'cost:2', min: 5, max: 9 }
    ],
    bias: ['early', 'token-source', 'board']
  },

  // ── Mage ──────────────────────────────────────────────────────────────────
  {
    id: 'mech-mage',
    name: 'Mech Mage',
    classId: 'Mage',
    quest: false,
    profile: 'aggro',
    plan: 'Flood the board with Mechs, use Mechwarper discounts to stay ahead on tempo, and convert a wide board into damage before late-game clears arrive.',
    mulligan: 'Keep Mechwarper and cheap Mechs; return slow value cards.',
    core: [{ id: 'goblins_vs_gnomes_mechwarper', count: 2 }],
    packages: [{ tag: 'tribe:Mech', min: 9 }],
    bias: ['tribe:Mech', 'early', 'board']
  },
  {
    id: 'flamewaker-mage',
    name: 'Flamewaker Spell Mage',
    classId: 'Mage',
    quest: false,
    profile: 'midrange',
    plan: 'Establish Flamewaker, then chain cheap spells to sweep boards and stack damage. Draw enough to keep the spell engine running.',
    mulligan:
      'Keep Flamewaker, cheap spells and card draw; return expensive finishers.',
    core: [{ id: 'blackrock_mountain_flamewaker', count: 2 }],
    packages: [{ tag: 'cheap-spell', min: 10 }],
    bias: ['spell', 'cheap-spell', 'spell-damage']
  },
  {
    id: 'quest-mage',
    name: 'Sky Temple Spell Mage',
    classId: 'Mage',
    quest: true,
    profile: 'midrange',
    plan: 'Cast spells every turn to open the Sky Temple, using efficient removal to survive while progressing the quest.',
    mulligan: 'Keep cheap spells and draw; every spare mana should cast a spell.',
    core: [{ id: 'journey_to_ungoro_raid_the_sky_temple', count: 1 }],
    packages: [{ tag: 'spell', min: 15, minQuality: 2 }],
    // Fifteen spells leave room for only a lean minion suite.
    floorOverrides: [{ tag: 'minion', min: 10, max: 30 }],
    bias: ['spell', 'cheap-spell', 'resource']
  },

  // ── Paladin ───────────────────────────────────────────────────────────────
  {
    id: 'recruit-paladin',
    name: 'Silver Hand Midrange Paladin',
    classId: 'Paladin',
    quest: false,
    profile: 'midrange',
    plan: 'Build and preserve Silver Hand Recruits for Quartermaster. Use weapons and removal to protect the board and convert wide boards into trades.',
    mulligan: 'Keep Muster for Battle and cheap Recruit support; return slow top-end.',
    core: [
      { id: 'goblins_vs_gnomes_muster_for_battle', count: 1 },
      { id: 'goblins_vs_gnomes_quartermaster', count: 1 }
    ],
    packages: [{ tag: 'recruit-source', min: 4 }],
    bias: ['token-source', 'recruit-source', 'board', 'early']
  },
  {
    id: 'secret-paladin',
    name: 'Secret Midrange Paladin',
    classId: 'Paladin',
    quest: false,
    profile: 'midrange',
    plan: 'Establish an early board, then use Mysterious Challenger to develop pressure and pull remaining secrets. Sequence attacks around active secrets.',
    mulligan:
      'Keep early board plays; Mysterious Challenger is the payoff, not the opener.',
    core: [{ id: 'the_grand_tournament_mysterious_challenger', count: 1 }],
    packages: [{ tag: 'secret', min: 5 }],
    // Paladin secrets cost one, so the cheapest bucket must hold them.
    floorOverrides: [{ tag: 'cost:0-1', min: 1, max: 7 }],
    bias: ['secret', 'board', 'early']
  },
  {
    id: 'quest-paladin',
    name: 'Making Mummies Paladin',
    classId: 'Paladin',
    quest: true,
    profile: 'midrange',
    plan: 'Play deathrattle minions every turn to complete Making Mummies, then hold the board with buffed resilient bodies.',
    mulligan: 'Keep early deathrattle minions; the quest needs one each turn.',
    core: [{ id: 'journey_to_ungoro_making_mummies', count: 1 }],
    packages: [{ tag: 'deathrattle', min: 10, minQuality: 2 }],
    bias: ['deathrattle', 'taunt', 'board']
  },

  // ── Priest ────────────────────────────────────────────────────────────────
  {
    id: 'dragon-priest',
    name: 'Dragon Midrange Priest',
    classId: 'Priest',
    quest: false,
    profile: 'midrange',
    plan: 'Curve out with sturdy Dragons such as Twilight Guardian, buff their health, and out-value the opponent with Priest removal while keeping a Dragon in hand for payoffs.',
    mulligan: 'Keep curve-friendly Dragons and removal; return expensive finishers.',
    core: [{ id: 'the_grand_tournament_twilight_guardian', count: 1 }],
    packages: [{ tag: 'tribe:Dragon', min: 8 }],
    bias: ['tribe:Dragon', 'board', 'interaction']
  },
  {
    id: 'cthun-priest',
    name: "C'Thun Midrange Priest",
    classId: 'Priest',
    quest: false,
    profile: 'midrange',
    plan: "Build a durable board with C'Thun's cultists, use Priest removal to survive, and reserve C'Thun or its threshold payoffs for the decisive turn.",
    mulligan: "Keep early cultists; C'Thun comes down only once it is a real threat.",
    core: [
      { id: 'whispers_of_the_old_gods_cthun', count: 1 },
      { id: 'whispers_of_the_old_gods_twilight_darkmender', count: 1 }
    ],
    packages: [{ tag: 'cthun-buff', min: 7 }],
    bias: ['cthun-buff', 'interaction', 'resource']
  },
  {
    id: 'quest-priest',
    name: 'Awaken the Makers Priest',
    classId: 'Priest',
    quest: true,
    profile: 'ramp',
    plan: 'Summon deathrattle minions every turn to complete Awaken the Makers, then stabilize behind the Amara wall and out-value the opponent.',
    mulligan: 'Keep early deathrattle bodies; the quest needs one each turn.',
    core: [{ id: 'journey_to_ungoro_awaken_the_makers', count: 1 }],
    packages: [{ tag: 'deathrattle', min: 10, minQuality: 2 }],
    bias: ['deathrattle', 'taunt', 'resource']
  },

  // ── Rogue ─────────────────────────────────────────────────────────────────
  {
    id: 'deathrattle-rogue',
    name: 'Deathrattle Value Rogue',
    classId: 'Rogue',
    quest: false,
    profile: 'midrange',
    plan: 'Develop sticky deathrattle bodies, recycle their value with Rogue resource tools such as Tomb Pillager, and convert card advantage into tempo.',
    mulligan:
      'Keep early deathrattle bodies and cheap Rogue plays; return slow value cards.',
    core: [{ id: 'league_of_explorers_tomb_pillager', count: 1 }],
    packages: [{ tag: 'deathrattle', min: 7 }],
    bias: ['deathrattle', 'resource', 'early']
  },
  {
    id: 'weapon-rogue',
    name: 'Oil Tempo Rogue',
    classId: 'Rogue',
    quest: false,
    profile: 'midrange',
    plan: "Build weapon durability and attack buffs together with Tinker's Sharpsword Oil, use efficient Rogue removal to protect the board, and convert a developed weapon into a burst turn.",
    mulligan: 'Keep the dagger opener and cheap tempo plays; Oil needs a weapon first.',
    core: [{ id: 'goblins_vs_gnomes_tinkers_sharpsword_oil', count: 1 }],
    packages: [{ tag: 'weapon', min: 2 }],
    bias: ['weapon', 'interaction', 'early']
  },
  {
    id: 'water-rogue',
    name: 'Water/Tempo Rogue',
    classId: 'Rogue',
    quest: false,
    profile: 'aggro',
    plan: 'Keep the opponent under pressure with cheap Pirates and generated resources, then use Combo payoffs such as Edwin VanCleef and the Rogue weapon to maintain tempo.',
    mulligan:
      'Keep one-cost Pirates and cheap spells; Combo payoffs need an early play first.',
    core: [
      { id: 'one_night_in_karazhan_swashburglar', count: 1 },
      { id: 'classic_edwin_vancleef', count: 1 }
    ],
    packages: [{ tag: 'tribe:Pirate', min: 7 }],
    bias: ['tribe:Pirate', 'early', 'cheap-spell']
  },

  // ── Shaman ────────────────────────────────────────────────────────────────
  {
    id: 'totem-shaman',
    name: 'Totem Midrange Shaman',
    classId: 'Shaman',
    quest: false,
    profile: 'midrange',
    plan: 'Develop totems and protect them for Thunder Bluff Valiant. Plan next-turn mana before taking overload, and exploit discounted payoffs for tempo.',
    mulligan:
      'Keep cheap totems and curve plays; account for overload before committing.',
    core: [
      { id: 'the_grand_tournament_totem_golem', count: 1 },
      { id: 'the_grand_tournament_thunder_bluff_valiant', count: 1 }
    ],
    packages: [{ tag: 'totem', min: 4 }],
    bias: ['totem', 'token-source', 'board']
  },
  {
    id: 'jade-shaman',
    name: 'Jade Midrange Shaman',
    classId: 'Shaman',
    quest: false,
    profile: 'midrange',
    plan: 'Develop Jade Golems while contesting the board. Earlier Jade summons strengthen later ones; preserve enough mana for interaction.',
    mulligan:
      'Keep Jade generators and smooth curve plays; return overload-heavy openers.',
    core: [{ id: 'mean_streets_of_gadgetzan_aya_blackpaw', count: 1 }],
    packages: [{ tag: 'jade', min: 6 }],
    bias: ['jade', 'resource', 'threat']
  },
  {
    id: 'quest-shaman',
    name: 'Unite the Murlocs Shaman',
    classId: 'Shaman',
    quest: true,
    profile: 'aggro',
    plan: 'Summon Murlocs every turn to complete Unite the Murlocs, then swarm with the Megafin murloc tide.',
    mulligan:
      'Keep cheap Murlocs and early bodies; the quest needs one summon each turn.',
    core: [{ id: 'journey_to_ungoro_unite_the_murlocs', count: 1 }],
    packages: [{ tag: 'murloc-source', min: 12, minQuality: 2 }],
    bias: ['murloc-source', 'token-source', 'early']
  },

  // ── Warlock ───────────────────────────────────────────────────────────────
  {
    id: 'zoo-warlock',
    name: 'Zoo Warlock',
    classId: 'Warlock',
    quest: false,
    profile: 'aggro',
    plan: 'Fill the board with cheap Demons such as Flame Imp and other bodies, use efficient buffs and trades to preserve tempo, then let Doomguard convert the board into damage.',
    mulligan:
      'Keep one- and two-cost bodies above everything; tempo is the win condition.',
    core: [
      { id: 'classic_flame_imp', count: 1 },
      { id: 'classic_doomguard', count: 1 }
    ],
    packages: [{ tag: 'tribe:Demon', min: 5 }],
    bias: ['early', 'token-source', 'tribe:Demon']
  },
  {
    id: 'demon-warlock',
    name: 'Demon Midrange Warlock',
    classId: 'Warlock',
    quest: false,
    profile: 'midrange',
    plan: 'Develop Demons that grow or recur, such as Voidcaller, use Life Tap to keep resources flowing, and stabilize with removal before landing large Demon threats.',
    mulligan: 'Keep early bodies and Demon enablers; return discard-heavy cards.',
    core: [{ id: 'naxxramas_voidcaller', count: 2 }],
    packages: [{ tag: 'tribe:Demon', min: 8 }],
    bias: ['tribe:Demon', 'threat', 'resource']
  },
  {
    id: 'quest-warlock',
    name: 'Lakkari Sacrifice Warlock',
    classId: 'Warlock',
    quest: true,
    profile: 'midrange',
    plan: 'Discard cards to complete Lakkari Sacrifice, then flood the board with the Nether Portal. Life Tap and Demon pressure keep the early game alive.',
    mulligan: 'Keep cheap bodies; discard progress matters more than hand size here.',
    core: [{ id: 'journey_to_ungoro_lakkari_sacrifice', count: 1 }],
    packages: [{ tag: 'discard', min: 8, minQuality: 2 }],
    bias: ['tribe:Demon', 'early', 'resource']
  },

  // ── Warrior ───────────────────────────────────────────────────────────────
  {
    id: 'dragon-warrior',
    name: 'Dragon Tempo Warrior',
    classId: 'Warrior',
    quest: false,
    profile: 'midrange',
    plan: 'Curve Dragons such as Twilight Guardian into weapons and efficient damage effects, keep a Dragon in hand for payoffs, and convert early pressure into a decisive midgame.',
    mulligan: 'Keep cheap Dragons, cheap weapons and removal; return slow top-end.',
    core: [{ id: 'the_grand_tournament_twilight_guardian', count: 1 }],
    packages: [
      { tag: 'tribe:Dragon', min: 8 },
      { tag: 'weapon', min: 2 }
    ],
    bias: ['tribe:Dragon', 'friendly-damage', 'interaction']
  },
  {
    id: 'patron-warrior',
    name: 'Grim Patron Tempo Warrior',
    classId: 'Warrior',
    quest: false,
    profile: 'midrange',
    plan: 'Use inexpensive damage effects and weapons to create multiple Grim Patrons, then convert the widened board into tempo or a lethal attack.',
    mulligan: 'Keep cheap damage enablers and weapons; Patrons want a board first.',
    core: [{ id: 'blackrock_mountain_grim_patron', count: 2 }],
    packages: [
      { tag: 'friendly-damage', min: 6 },
      { tag: 'weapon', min: 2 }
    ],
    bias: ['friendly-damage', 'token-source', 'interaction']
  },
  {
    id: 'quest-warrior',
    name: 'Fire Plume Taunt Warrior',
    classId: 'Warrior',
    quest: true,
    profile: 'ramp',
    plan: "Play taunt minions every turn to complete Fire Plume's Heart, then stabilize behind taunts and use Sulfuras damage every turn.",
    mulligan: 'Keep taunt bodies at every cost; the quest needs one each turn.',
    core: [{ id: 'journey_to_ungoro_fire_plumes_heart', count: 1 }],
    packages: [{ tag: 'taunt', min: 12, max: 16, minQuality: 2 }],
    bias: ['taunt', 'resource', 'interaction']
  }
]
