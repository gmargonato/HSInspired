# Curated constructed opponents

Catalog version 3 retains the 27 approved version-2 adaptations and appends nine
original Un'Goro quest decks: four per playable class, 30 cards per deck (1,080 slots), with unique names of at most
15 characters. The supported card pool runs from Basic through Knights of the
Frozen Throne, including all intervening Wild sets.

## Preserved version-2 input

- Input: `HSInspired-Recommended-27-Decks.json`, dated 2026-10-11.
- Input SHA-256: `6622cadd4587b699d94bae700eff24abb9ae18a104044286a415100586af4e30`.
- Input baseline: `481297f671bec3d99b65810b89d7a33003e04027`.
- The linked sources are historical inspiration; these exact lists are local
  adaptations and must not be represented as verbatim published lists.

## Authorized correction

Within the preserved 27 lists, the only card-count deviation from the approved input is one copy of Greater
Healing Potion removed and one copy of Spirit Lash added in Reno Raza
(`priest-reno-raza`). Greater Healing Potion had been a workaround for broken
spell Lifesteal. Spirit Lash is restored together with the damage-event runtime
fix and focused regressions for Spirit Lash, Drain Soul and Tidal Surge. Every
other card and count remains exactly as approved.

## Selection and Expert evaluation

Class selection stays uniform and seeded; selection among each class's four
lists stays uniform and seeded. The original three lists keep their positions,
and each class's quest list is appended. Version 3 changes the seeded list choice
because the roster grew; it does not replace an existing list. Explicit selection uses the replacement IDs below.
The catalog version and IDs distinguish the changed roster in match logs. Saved
user decks, snapshots, deck schema, primary class heroes and asset keys are unchanged.

The replacement package assigns no Expert strategy profiles. All 27 definitions
therefore omit `expertStrategyProfileId` and use general Expert evaluation. In
particular, Token, Combo and dedicated Jade Druid do not inherit the retired
ramp/C'Thun/Jade pilot profiles. The profile implementation remains available
unchanged for explicitly bound callers. The development menu now routes to the
new Token, Combo and Jade Druid IDs and names. No new evaluator bonuses are added.

## Replacement mapping

| Retired catalog ID                     | Replacement catalog ID                | Display name    |
| -------------------------------------- | ------------------------------------- | --------------- |
| `druid-midrange-old-gods`              | `druid-aggro-token`                   | Token Druid     |
| `druid-jade-elemental`                 | `druid-dedicated-jade`                | Jade Druid      |
| `druid-cthun-midrange`                 | `druid-force-roar-combo`              | Combo Druid     |
| `hunter-frozen-throne-midrange`        | `hunter-face-burn`                    | Face Hunter     |
| `hunter-old-gods-midrange`             | `hunter-secret-tempo`                 | Secret Hunter   |
| `hunter-probably-midrange`             | `hunter-egg-deathrattle`              | Egg Hunter      |
| `mage-mech-midrange`                   | `mage-mech-tempo`                     | Mech Mage       |
| `mage-pavel-tempo`                     | `mage-flamewaker-tempo`               | Flamewaker Mage |
| `mage-frost-lich-midrange`             | `mage-jaina-elemental-control`        | Jaina Control   |
| `paladin-secret-midrange`              | `paladin-secret-challenger`           | Secret Paladin  |
| `paladin-ungoro-murloc-midrange`       | `paladin-murloc-swarm`                | Murloc Paladin  |
| `paladin-old-gods-midrange`            | `paladin-anyfin-control`              | Anyfin Paladin  |
| `priest-cthun-midrange`                | `priest-dragon-tempo`                 | Dragon Priest   |
| `priest-nzoth-deathrattle-midrange`    | `priest-reno-raza`                    | Reno Raza       |
| `priest-silent-midrange`               | `priest-deathlord-inner-fire`         | Inner Fire      |
| `rogue-midrange-2016`                  | `rogue-keleseth-pirates`              | Keleseth Rogue  |
| `rogue-tgt-midrange`                   | `rogue-oil-burst`                     | Oil Rogue       |
| `rogue-nzoth-deathrattle-midrange`     | `rogue-jade-deathrattle`              | Jade Rogue      |
| `shaman-karazhan-midrange`             | `shaman-totem-overload`               | Totem Shaman    |
| `shaman-elemental-midrange`            | `shaman-elemental-battlecry`          | Elemental Shm   |
| `shaman-midrange-2016`                 | `shaman-nzoth-control`                | N'Zoth Shaman   |
| `warlock-midrange-demonlock-season-15` | `warlock-sticky-zoo-selected`         | Sticky Zoo      |
| `warlock-imp-boss-midrange-demonlock`  | `warlock-giant-handlock-selected`     | Giant Handlock  |
| `warlock-cthun-midrange`               | `warlock-reno-demon-control-selected` | Reno Demons     |
| `warrior-tempo-midrange-2016`          | `warrior-pirate-weapons`              | Pirate Warrior  |
| `warrior-dragon-midrange-2016`         | `warrior-dragon-tempo`                | Dragon Warrior  |
| `warrior-midrange-varian`              | `warrior-justicar-control`            | Armor Control   |

## Validation limits

Catalog/selection regressions cover exact roster counts, legality, era, class,
copy limits, names, seeded selection and routing. This is not a 27-deck round-robin
or evidence of whole-game Expert win rate. Historical performance does not
establish performance under this project's custom card costs and mechanics.

## Version-3 quest additions

The nine additions use original Un'Goro quests and only supporting cards released
by Knights of the Frozen Throne. They are researched, source-inspired local
adaptations, not verbatim recommendations or competitive win-rate claims. The
current custom quest requirements, automatic activation and reward mechanics are
authoritative; no future supporting cards or new Expert evaluation profiles are added.

The Mage list deliberately uses a board-based Arcane Giant payoff for the single
extra turn instead of requiring an infinite-Fireball sequence. Other changes favor
reliable quest progression and effects already supported by the local catalog.

### Jungle Giants (Druid)

Historical source: [Taunted Quest Druid](https://www.hearthpwn.com/decks/895183-taunted-quest-druid), page last updated 2017-08-11.

Local changes: 1 C'Thun → 1 The Lich King; 2 Bright-Eyed Scout → 2 Ancient of Lore; 1 Elise the Trailblazer → 1 Ysera

Limitations: Historically fringe. Expensive threats can clog early hands; weak against fast aggression. Custom summon wording makes copied or generated qualifying bodies useful.

### Marsh Queen (Hunter)

Historical source: [Hunter Quest with DK](https://www.hearthpwn.com/decks/833002-hunter-quest-with-dk), page last updated 2017-09-01.

Local changes: No card substitutions.

Limitations: Historically weak/fringe quest. Modern custom lower threshold, stronger Carnassa and automatic quest activation remove some old weaknesses. Summoned tokens do not count as played 1-cost minions.

### Waygate Giants (Mage)

Historical source: [Exodia Quest Mage KOFT In-depth Guide](https://www.hearthpwn.com/decks/918727-exodia-quest-mage-koft-in-depth-guide), page last updated 2017-08-25.

Local changes: 2 Sorcerer's Apprentice → 2 Arcane Giant; 2 Molten Reflection → 2 Frostbolt; 1 Simulacrum → 1 Ghastly Conjurer; 1 Archmage Antonidas → 1 Alexstrasza

Limitations: Adapted Giants version is our design, not the exact published Exodia list. No claim that the bounded AI can execute precise OTK sequencing; use broad board-value payoff rather than requiring infinite Fireballs. Coldlight can help opponents or overdraw own hand.

### Kaleidosaur (Paladin)

Historical source: [Un'Goro Quest Paladin](https://www.hearthpwn.com/decks/855807-ungoro-quest-paladin), page last updated 2017-08-25.

Local changes: 2 Dirty Rat → 2 Righteous Protector; 2 Sword of Justice → 2 Argent Squire

Limitations: Historically weak quest; stronger custom Galvadon and automatic activation help. Pyromancer and Doomsayer can conflict with buffed boards, so sequencing remains important. Silences/transforms answer investment.

### Awaken Makers (Priest)

Historical source: [Savjz's Quest Priest](https://www.hearthpwn.com/decks/826476-savjzs-quest-priest), page last updated 2017-05-03.

Local changes: 2 Radiant Elemental → 2 Haunted Creeper

Limitations: Historically fringe/control rather than top-tier. Lower custom threshold improves reliability. N'Zoth pool can be diluted by small Deathrattles; removal/transform effects can undermine value.

### Crystal Caverns (Rogue)

Historical source: [QUEST ROGUE DECK LIST GUIDE](https://www.hearthpwn.com/decks/793687-quest-rogue-deck-list-guide), page last updated 2017-04-18.

Local changes: No card substitutions.

Limitations: Historically strong archetype, though source predates five-play nerf. Current five-play requirement is supported by six generated Flame Elementals plus bounce. Requires coherent repeated-target choices; vulnerable before payoff.

### Unite Murlocs (Shaman)

Historical source: [Murloc's Unite: Murloc Association list](https://www.hearthpwn.com/forums/hearthstone-events/tournaments/decklists/195983-murlocs-unite), post dated 2017-06-22.

Local changes: 1 Lightning Storm → 1 Everyfin is Awesome; 1 Corrupted Seer → 1 Everyfin is Awesome

Limitations: Historical quest variant less proven than established Murloc aggression. Lower threshold and automatic activation improve fit. Board wipes and hand overflow are principal risks; play Megafin with hand space.

### Lakkari Portal (Warlock)

Historical source: [Lakkari's Scrifice](https://www.hearthpwn.com/decks/877156-lakkaris-scrifice), page last updated 2017-08-10.

Local changes: 2 Argent Horserider → 2 Lakkari Felhound

Limitations: Historically weak quest despite viable nonquest Discard Zoo shells. Empty-hand discard does not advance quest; low resources and accidental reward discard are risks. Source modern Felstalker name maps to local Succubus.

### Fire Plume (Warrior)

Historical source: [How do you counter Taunt Quest Warrior?: [42-22] Quest Taunt Warrior list](https://www.hearthpwn.com/forums/hearthstone-game-modes/standard-format/190975-how-do-you-counter-taunt-quest-warrior?page=2), post dated 2017-04-10.

Local changes: No card substitutions.

Limitations: Historically competitive. Custom targeted power substantially strengthens reward. Dirty Rat can backfire if played without removal; do not replace hero after Sulfuras and lose reward power.
