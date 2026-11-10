/** Exact approved 30-card draft lists. Source: hsinspired-first-pass-deck-selections.pdf.
 * Kept separate from historical adaptations; registration follows card validation. */
export const SHORTLISTED_OPPONENT_DECK_DEFINITIONS = [
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
