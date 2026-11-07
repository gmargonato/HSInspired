/** Exact approved 30-card draft lists. Source: hsinspired-first-pass-deck-selections.pdf.
 * Kept separate from historical adaptations; registration follows card validation. */
export const SHORTLISTED_OPPONENT_DECK_DEFINITIONS = [
  {
    id: 'shortlist-dragon-hand-ramp-druid',
    name: 'Dragon-hand Ramp Druid',
    deckName: 'Dragon Ramp',
    classId: 'Druid',
    source: {
      title: 'HSInspired first pass deck selections, 5 November 2026',
      url: 'docs/shortlist-ai-evaluation.md',
      format: 'wild-legal'
    },
    plan: 'Keep early ramp and a Dragon activator. Develop Whelp, retain another Dragon for Breath/Nestmatron, refill with Nourish/Azure Drake/Explorer, then turn retained Dragons into a Golem board. Earthen Scales and Primordial Drake stabilize; repeated large Taunt boards close.',
    cardList: {
      Innervate: 2,
      'Azure Drake': 2,
      'Wild Growth': 2,
      Swipe: 2,
      'Breath of Dreams': 2,
      'Emerald Explorer': 2,
      Wrath: 2,
      'Dragon Golem': 2,
      'Splish-Splash Whelp': 2,
      Nourish: 2,
      'Faerie Dragon': 2,
      'Primordial Drake': 2,
      'Twilight Drake': 2,
      'Earthen Scales': 2,
      'Desert Nestmatron': 2
    }
  },
  {
    id: 'shortlist-original-libram-paladin',
    name: 'Original Libram Paladin',
    deckName: 'Libram Paladin',
    classId: 'Paladin',
    source: {
      title: 'HSInspired first pass deck selections, 5 November 2026',
      url: 'docs/shortlist-ai-evaluation.md',
      format: 'wild-legal'
    },
    plan: 'Mulligan for Attendant, Crystology and early minions. Attendant/Truthseeker permanently reduce the three included Libram card IDs. Recycle Wisdom through traded minions, converting each survivor into another threat. Justice sets enemy Health to 1; Consecration or the post-spell Pyromancer trigger clears them. Hope provides healing and a large shielded Taunt. Win through repeated buffed boards, not an infinite combo. Crystology has eight printed 1-Attack targets: Attendant, Protector, Knight and Acolyte.',
    cardList: {
      'Aldor Attendant': 2,
      'Libram of Wisdom': 2,
      Crystology: 2,
      'Libram of Justice': 2,
      'Righteous Protector': 2,
      'Libram of Hope': 2,
      'Knight of Anointment': 2,
      Consecration: 2,
      'Acolyte of Pain': 2,
      'Spikeridged Steed': 2,
      'Wild Pyromancer': 2,
      'Blessing of Kings': 2,
      'Shielded Minibot': 2,
      'Sunkeeper Tarim': 1,
      'Aldor Truthseeker': 2,
      'Tirion Fordring': 1
    }
  },
  {
    id: 'shortlist-showdown-giant-paladin',
    name: 'Showdown Giant Paladin',
    deckName: 'Showdown Giants',
    classId: 'Paladin',
    source: {
      title: 'HSInspired first pass deck selections, 5 November 2026',
      url: 'docs/shortlist-ai-evaluation.md',
      format: 'wild-legal'
    },
    plan: 'Build small sticky boards. Showdown creates six bodies, discounting Sea Giant and Prismatic Beam; sequence Beam before trading away enemy tokens if preserving its discount matters. Rush Outlaws/Ducklings trade while leaving your attackers. Busy-Bot grows recruits/Ducklings; Steward protects 1-Health summons. Giant or surviving buffed minions plus Battlemaster close the game. Solemn Vigil refills after a trading turn.',
    cardList: {
      'Righteous Protector': 2,
      'Hi Ho Silverwing': 2,
      'Lost in the Jungle': 2,
      'Gold Panner': 2,
      'Shielded Minibot': 2,
      'Mother Duck': 2,
      'Muster for Battle': 2,
      'Busy-Bot': 2,
      'Showdown!': 2,
      'Steward of Darkshire': 2,
      'Prismatic Beam': 2,
      'Blessing of Kings': 2,
      'Sea Giant': 2,
      'Sunkeeper Tarim': 1,
      'Solemn Vigil': 2,
      'Battleground Battlemaster': 1
    }
  },
  {
    id: 'shortlist-glowfly-token-druid',
    name: 'Glowfly Token Druid',
    deckName: 'Glowfly Druid',
    classId: 'Druid',
    source: {
      title: 'HSInspired first pass deck selections, 5 November 2026',
      url: 'docs/shortlist-ai-evaluation.md',
      format: 'wild-legal'
    },
    plan: 'Sticky early minions and spell-created boards set up Lotus/Power/Roar. Twenty-six spells keep Glowfly meaningful without imposing a zero-minion restriction that has lost its draw payoff. Nourish is the main refill. Authored Force of Nature plus Roar remains 14 empty-board burst for nine mana when the hero can attack.',
    cardList: {
      Innervate: 2,
      'Soul of the Forest': 2,
      'Living Roots': 2,
      Swipe: 2,
      'Mark of the Lotus': 2,
      'Glowfly Swarm': 2,
      'Power of the Wild': 2,
      'Force of Nature': 2,
      'Dreamway Guardians': 2,
      Nourish: 2,
      Wrath: 2,
      Acornbearer: 2,
      'Wild Growth': 2,
      'Lingering Zombie': 2,
      'Savage Roar': 2
    }
  },
  {
    id: 'shortlist-beast-swarm-hunter',
    name: 'Beast Swarm Hunter',
    deckName: 'Beast Swarm',
    classId: 'Hunter',
    source: {
      title: 'HSInspired first pass deck selections, 5 November 2026',
      url: 'docs/shortlist-ai-evaluation.md',
      format: 'wild-legal'
    },
    plan: 'Early Beasts support Razormaw/Houndmaster buffs and Hyena growth. Springpaw and Awakening Tremors supply additional cheap Beasts. Buzzard refills on summon turns, Ingenuity draws and buffs a Beast, and Rhino/Highmane provide pressure and reach alongside Kill Command.',
    cardList: {
      Alleycat: 2,
      'Awakening Tremors': 2,
      Springpaw: 2,
      'Adorable Infestation': 2,
      'Starving Buzzard': 2,
      'Unleash the Hounds': 2,
      'Scavenging Hyena': 2,
      'Kill Command': 2,
      'Crackling Razormaw': 2,
      'Timber Wolf': 2,
      'Kindly Grandmother': 2,
      'Tundra Rhino': 2,
      Houndmaster: 2,
      'Savannah Highmane': 2,
      "Scavenger's Ingenuity": 2
    }
  },
  {
    id: 'shortlist-secret-burn-mage',
    name: 'Secret Burn Mage',
    deckName: 'Secret Burn',
    classId: 'Mage',
    source: {
      title: 'HSInspired first pass deck selections, 5 November 2026',
      url: 'docs/shortlist-ai-evaluation.md',
      format: 'wild-legal'
    },
    plan: 'Eight Secrets support free-secret bodies, active-Secret burn and duplicated Conjurer boards. Arcanologist and Ancient Mysteries improve access; Aluneth is the single sustained-refill engine. Flakmage clears wide boards, while Cloud Prince/Fireball and Loatheb close.',
    cardList: {
      'Potion of Polymorph': 2,
      'Ancient Mysteries': 2,
      'Kabal Lackey': 2,
      'Flame Ward': 2,
      Arcanologist: 2,
      'Kabal Crystal Runner': 2,
      "Medivh's Valet": 2,
      'Cloud Prince': 2,
      'Arcane Flakmage': 2,
      Fireball: 2,
      'Kirin Tor Mage': 2,
      'Occult Conjurer': 2,
      Counterspell: 2,
      Aluneth: 1,
      'Mirror Entity': 2,
      Loatheb: 1
    }
  },
  {
    id: 'shortlist-shark-swarm-mech-mage',
    name: 'Shark Swarm Mech Mage',
    deckName: 'Shark Mechs',
    classId: 'Mage',
    source: {
      title: 'HSInspired first pass deck selections, 5 November 2026',
      url: 'docs/shortlist-ai-evaluation.md',
      format: 'wild-legal'
    },
    plan: 'Discount a hand of Mechs, establish Shark/Automaton, then chain cheap Mechs into random damage and scaling. Sticky Mechs keep pressure and trigger Shark again on token summons. Blastmage wins board swings; Fireball closes and Gorillabot refills.',
    cardList: {
      'Click-Clocker': 2,
      'Mecha-Shark': 2,
      Mecharoo: 2,
      'Seafloor Gateway': 2,
      'Clockwork Gnome': 2,
      'Harvest Golem': 2,
      Mechwarper: 2,
      'Piloted Shredder': 2,
      Galvanizer: 2,
      'Goblin Blastmage': 2,
      'Security Automaton': 2,
      Fireball: 2,
      Snowchugger: 2,
      'Gorillabot A-3': 2,
      'Annoy-o-Tron': 2
    }
  },
  {
    id: 'shortlist-charge-handbuff-paladin',
    name: 'Charge Handbuff Paladin',
    deckName: 'Charge Handbuff',
    classId: 'Paladin',
    source: {
      title: 'HSInspired first pass deck selections, 5 November 2026',
      url: 'docs/shortlist-ai-evaluation.md',
      format: 'wild-legal'
    },
    plan: 'Draw a wide hand, then layer Outfitter/Bannerman/Smuggler buffs and repeated Painter attacks. Buffed Lifesteal Rush/Charge minions stabilize while Deckhand, Horserider and Commander provide immediate damage. Doppelgangster copies handbuffed stats into three bodies. This is an existing handbuff shell made substantially more consistent and explosive, not a newly invented archetype.',
    cardList: {
      Crystology: 2,
      'Chillblade Champion': 2,
      "Smuggler's Run": 2,
      'Argent Horserider': 2,
      'Righteous Protector': 2,
      Doppelgangster: 2,
      'Meanstreet Marshal': 2,
      'Vicious Scalehide': 2,
      'Grimestreet Outfitter': 2,
      'Shielded Minibot': 2,
      'Alliance Bannerman': 2,
      'Acolyte of Pain': 2,
      "Painter's Virtue": 2,
      'Argent Commander': 2,
      'Southsea Deckhand': 2
    }
  },
  {
    id: 'shortlist-pirate-oil-rogue',
    name: 'Pirate Oil Rogue',
    deckName: 'Pirate Oil',
    classId: 'Rogue',
    source: {
      title: 'HSInspired first pass deck selections, 5 November 2026',
      url: 'docs/shortlist-ai-evaluation.md',
      format: 'wild-legal'
    },
    plan: 'Use cheap Pirates and dagger attacks for early tempo, then tutor with Combo Raiding Party. Weapon buffs turn Cutting Class and Dread Corsair cheap, and Oil/Blade Flurry supply burst. Prize Plunderer rewards cheap-card sequencing and removes blockers. Shadowblade allows a safe initial weapon trade through Battlecry Immune. This relies on the supplied custom/old balance baseline: Preparation discounts by 3, Patches has Charge and 2-mana Blade Flurry hits all enemies including the hero.',
    cardList: {
      Preparation: 2,
      'Blade Flurry': 2,
      'Deadly Poison': 2,
      Eviscerate: 2,
      'Southsea Deckhand': 2,
      'Hench-Clan Thug': 2,
      'Small-Time Buccaneer': 2,
      "Tinker's Sharpsword Oil": 2,
      'Dread Corsair': 2,
      'Prize Plunderer': 2,
      'Raiding Party': 2,
      Backstab: 2,
      Shadowblade: 2,
      'Patches the Pirate': 1,
      'Cutting Class': 2,
      'Captain Greenskin': 1
    }
  },
  {
    id: 'shortlist-dragon-tempo-priest',
    name: 'Dragon Tempo Priest',
    deckName: 'Dragon Tempo',
    classId: 'Priest',
    source: {
      title: 'HSInspired first pass deck selections, 5 November 2026',
      url: 'docs/shortlist-ai-evaluation.md',
      format: 'wild-legal'
    },
    plan: 'Maintain Dragon activators in hand, win efficient trades with health buffs and healing, then snowball Drakonid/Azure/Cobalt boards. Duskbreaker supplies an earlier reset and Light! It Burns! efficient removal; these improve an existing Dragon Priest list rather than create a post-2017 archetype. Fourteen printed Dragons provide substantial hand-condition support.',
    cardList: {
      'Twilight Whelp': 2,
      Duskbreaker: 2,
      'Northshire Cleric': 2,
      'Drakonid Operative': 2,
      'Power Word: Shield': 2,
      'Azure Drake': 2,
      'Wyrmrest Agent': 2,
      'The Light! It Burns!': 2,
      'Netherspite Historian': 2,
      'Dragonfire Potion': 2,
      'Shadow Visions': 2,
      'Cobalt Scalebane': 2,
      'Kabal Talonpriest': 2,
      'Book Wyrm': 2,
      'Twilight Guardian': 2
    }
  },
  {
    id: 'shortlist-skipper-enrage-warrior',
    name: 'Skipper Enrage Warrior',
    deckName: 'Skipper Enrage',
    classId: 'Warrior',
    source: {
      title: 'HSInspired first pass deck selections, 5 November 2026',
      url: 'docs/shortlist-ai-evaluation.md',
      format: 'wild-legal'
    },
    plan: "Build damage-trigger boards, use Skipper and inexpensive minions to generate armor, draw and Boom Bots, then finish with Frothing attacks, Kor'kron or activated Grommash. Patron supports a replenishing board rather than importing a new win-condition subsystem.",
    cardList: {
      'Inner Rage': 2,
      'Bomb Wrangler': 2,
      'Blood To Ichor': 2,
      'Frothing Berserker': 2,
      Execute: 2,
      'Ravaging Ghoul': 2,
      'Risky Skipper': 2,
      "Death's Bite": 2,
      Armorsmith: 2,
      "Kor'kron Elite": 2,
      'Battle Rage': 2,
      'Grim Patron': 2,
      'Commanding Shout': 2,
      Loatheb: 1,
      'Acolyte of Pain': 2,
      'Grommash Hellscream': 1
    }
  },
  {
    id: 'shortlist-elemental-curve-shaman',
    name: 'Elemental Curve Shaman',
    deckName: 'Elemental Curve',
    classId: 'Shaman',
    source: {
      title: 'HSInspired first pass deck selections, 5 November 2026',
      url: 'docs/shortlist-ai-evaluation.md',
      format: 'wild-legal'
    },
    plan: 'Play an Elemental curve, discount the hand/deck with Forgeborn and preserve the existing previous-turn Elemental chain for Stone Sentinel, Blazecaller and Kalimos. Slogger supplies immediate Rush trading and healing. Mana Tide offers refill without a new tutor or tracking rule.',
    cardList: {
      'Fire Fly': 2,
      'Tar Creeper': 2,
      'Glacial Shard': 2,
      'Canal Slogger': 2,
      'Lightning Bolt': 2,
      'Granite Forgeborn': 2,
      'Wailing Vapor': 2,
      'Stone Sentinel': 2,
      'Fire Plume Harbinger': 2,
      Blazecaller: 2,
      Hex: 2,
      'Fire Elemental': 2,
      'Lightning Storm': 2,
      'Kalimos, Primal Lord': 1,
      'Mana Tide Totem': 2,
      "Al'Akir the Windlord": 1
    }
  },
  {
    id: 'shortlist-cube-demon-warlock',
    name: 'Cube Demon Warlock',
    deckName: 'Cube Demons',
    classId: 'Warlock',
    source: {
      title: 'HSInspired first pass deck selections, 5 November 2026',
      url: 'docs/shortlist-ai-evaluation.md',
      format: 'wild-legal'
    },
    plan: 'Use removal and healing to reach Voidcaller/Lackey/Skull turns, summon expensive Demons without Doomguard\u2019s discard Battlecry, then Cube the best Demon and trigger the Cube. Voidlord buys time; copied Doomguards close; Guldan rebuilds. Mulligan Librarian, early removal and Voidcaller; avoid keeping multiple expensive Demons.',
    cardList: {
      'Dark Pact': 2,
      'Carnivorous Cube': 2,
      'Kobold Librarian': 2,
      Doomguard: 2,
      'Mistress of Mixtures': 2,
      'Possessed Lackey': 2,
      Darkbomb: 2,
      "Skull of the Man'ari": 1,
      Defile: 2,
      'Lord Godfrey': 1,
      'Drain Soul': 2,
      "Bloodreaver Gul'dan": 1,
      'Shallow Grave': 2,
      "Mal'Ganis": 1,
      'Sense Demons': 2,
      Voidlord: 2,
      Voidcaller: 2
    }
  }
] as const
