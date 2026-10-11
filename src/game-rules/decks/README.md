# Curated constructed opponents

Catalog version 2 contains the 27 approved local deck adaptations: three per
playable class, 30 cards per deck (810 slots), with unique names of at most
15 characters. The supported card pool runs from Basic through Knights of the
Frozen Throne, including all intervening Wild sets.

## Approved input

- Input: `HSInspired-Recommended-27-Decks.json`, dated 2026-10-11.
- Input SHA-256: `6622cadd4587b699d94bae700eff24abb9ae18a104044286a415100586af4e30`.
- Input baseline: `481297f671bec3d99b65810b89d7a33003e04027`.
- The linked sources are historical inspiration; these exact lists are local
  adaptations and must not be represented as verbatim published lists.

## Authorized correction

The only card-count deviation from the approved input is one copy of Greater
Healing Potion removed and one copy of Spirit Lash added in Reno Raza
(`priest-reno-raza`). Greater Healing Potion had been a workaround for broken
spell Lifesteal. Spirit Lash is restored together with the damage-event runtime
fix and focused regressions for Spirit Lash, Drain Soul and Tidal Surge. Every
other card and count remains exactly as approved.

## Selection and Expert evaluation

Class selection stays uniform and seeded; selection among each class's three
lists stays uniform and seeded, retaining the original positional replacement
slots. Explicit selection uses the replacement IDs below.
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
