# Choose One presentation

Implemented for the 17 Choose One parents in the supported sets, with 34 choice cards. Added 27 noncollectible JSON entries and 27 illustrations; reused seven existing entries/artworks. No artwork is missing.

## Research and sources

- [HearthstoneJSON card API, pinned build 25770](https://api.hearthstonejson.com/v1/25770/enUS/cards.json): option identities, names, and descriptions. This historical snapshot covers the supported sets; its balance values do not override this project.
- [HearthstoneJSON image API documentation](https://hearthstonejson.com/docs/images.html): standalone illustrations, downloaded at 512 ? 512.
- [Choose One reference](https://hearthstone.wiki.gg/wiki/Choose_One) and the supplied screenshots: separate cards represent the branches, without playing an additional card.

Option order below follows the local gameplay actions, not alphabetical order or API suffixes. Ancient Teachings retains the local two-card draw. Longer descriptions for targeted buffs spell out the target. Existing gameplay values are preserved; Wrath and Starfall now include their missing second branches.

## Inventory

| Parent              | Choice 0                                         | Choice 1                                              |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| Ancient of Lore     | Ancient Teachings ? Draw 2 cards.                | Ancient Secrets ? Restore 5 Health.                   |
| Ancient of War      | Rooted ? +5 Health and Taunt.                    | Uproot ? +5 Attack.                                   |
| Cenarius            | Demigod's Favor ? Give your other minions +2/+2. | Shan'do's Lesson ? Summon two 2/2 Treants with Taunt. |
| Druid of the Claw   | Cat Form ? Charge                                | Bear Form ? +2 Health and Taunt.                      |
| Keeper of the Grove | Moonfire ? Deal 2 damage.                        | Dispel ? Silence a minion.                            |
| Mark of Nature      | Mark of Nature ? Give a minion +4 Attack.        | Mark of Nature ? Give a minion +4 Health and Taunt.   |
| Nourish             | Nourish ? Gain 2 Mana Crystals.                  | Nourish ? Draw 3 cards.                               |
| Power of the Wild   | Leader of the Pack ? Give your minions +1/+1.    | Summon a Panther ? Summon a 3/2 Panther.              |
| Wrath               | Wrath ? Deal 3 damage to a minion.               | Wrath ? Deal 1 damage to a minion. Draw a card.       |
| Starfall            | Starfall ? Deal 5 damage to a minion.            | Starfall ? Deal 2 damage to all enemy minions.        |
| Anodized Robo Cub   | Attack Mode ? +1 Attack.                         | Tank Mode ? +1 Health.                                |
| Grove Tender        | Gift of Mana ? Give each player a Mana Crystal.  | Gift of Cards ? Each player draws a card.             |
| Dark Wispers        | Dark Wispers ? Summon 5 Wisps.                   | Dark Wispers ? Give a minion +5/+5 and Taunt.         |
| Druid of the Flame  | Firecat Form ? +3 Attack.                        | Fire Hawk Form ? +3 Health.                           |
| Living Roots        | Living Roots ? Deal 2 damage.                    | Living Roots ? Summon two 1/1 Saplings.               |
| Druid of the Saber  | Lion Form ? Charge                               | Panther Form ? +1/+1 and Stealth.                     |
| Raven Idol          | Raven Idol ? Discover a minion.                  | Raven Idol ? Discover a spell.                        |

## Data and artwork mapping

Illustrations live at `assets/images/card-artwork/<local ID>.jpg`. The external ID links to the original download. Existing artwork was retained. Some API illustrations contain padding at their outer edges; visual crop quality should be checked in-game.

| Local choice ID                              | Source illustration                                                | Entry  |
| -------------------------------------------- | ------------------------------------------------------------------ | ------ |
| `classic_ancient_teachings`                  | [NEW1_008a](https://art.hearthstonejson.com/v1/512x/NEW1_008a.jpg) | Reused |
| `classic_ancient_secrets`                    | [NEW1_008b](https://art.hearthstonejson.com/v1/512x/NEW1_008b.jpg) | Reused |
| `classic_rooted`                             | [EX1_178a](https://art.hearthstonejson.com/v1/512x/EX1_178a.jpg)   | Added  |
| `classic_uproot`                             | [EX1_178b](https://art.hearthstonejson.com/v1/512x/EX1_178b.jpg)   | Reused |
| `classic_demigods_favor`                     | [EX1_573a](https://art.hearthstonejson.com/v1/512x/EX1_573a.jpg)   | Added  |
| `classic_shandos_lesson`                     | [EX1_573b](https://art.hearthstonejson.com/v1/512x/EX1_573b.jpg)   | Reused |
| `classic_cat_form`                           | [EX1_165a](https://art.hearthstonejson.com/v1/512x/EX1_165a.jpg)   | Added  |
| `classic_bear_form`                          | [EX1_165b](https://art.hearthstonejson.com/v1/512x/EX1_165b.jpg)   | Reused |
| `classic_moonfire_choose_one`                | [EX1_166a](https://art.hearthstonejson.com/v1/512x/EX1_166a.jpg)   | Added  |
| `classic_dispel`                             | [EX1_166b](https://art.hearthstonejson.com/v1/512x/EX1_166b.jpg)   | Reused |
| `classic_mark_of_nature_attack`              | [EX1_155a](https://art.hearthstonejson.com/v1/512x/EX1_155a.jpg)   | Added  |
| `classic_mark_of_nature_health`              | [EX1_155b](https://art.hearthstonejson.com/v1/512x/EX1_155b.jpg)   | Added  |
| `classic_nourish_mana`                       | [EX1_164a](https://art.hearthstonejson.com/v1/512x/EX1_164a.jpg)   | Added  |
| `classic_nourish_draw`                       | [EX1_164b](https://art.hearthstonejson.com/v1/512x/EX1_164b.jpg)   | Added  |
| `classic_leader_of_the_pack`                 | [EX1_160b](https://art.hearthstonejson.com/v1/512x/EX1_160b.jpg)   | Added  |
| `classic_summon_a_panther`                   | [EX1_160a](https://art.hearthstonejson.com/v1/512x/EX1_160a.jpg)   | Reused |
| `classic_wrath_damage`                       | [EX1_154a](https://art.hearthstonejson.com/v1/512x/EX1_154a.jpg)   | Added  |
| `classic_wrath_draw`                         | [EX1_154b](https://art.hearthstonejson.com/v1/512x/EX1_154b.jpg)   | Added  |
| `classic_starfall_single`                    | [NEW1_007b](https://art.hearthstonejson.com/v1/512x/NEW1_007b.jpg) | Added  |
| `classic_starfall_all`                       | [NEW1_007a](https://art.hearthstonejson.com/v1/512x/NEW1_007a.jpg) | Added  |
| `goblins_vs_gnomes_attack_mode`              | [GVG_030a](https://art.hearthstonejson.com/v1/512x/GVG_030a.jpg)   | Added  |
| `goblins_vs_gnomes_tank_mode`                | [GVG_030b](https://art.hearthstonejson.com/v1/512x/GVG_030b.jpg)   | Added  |
| `goblins_vs_gnomes_gift_of_mana`             | [GVG_032a](https://art.hearthstonejson.com/v1/512x/GVG_032a.jpg)   | Added  |
| `goblins_vs_gnomes_gift_of_cards`            | [GVG_032b](https://art.hearthstonejson.com/v1/512x/GVG_032b.jpg)   | Added  |
| `goblins_vs_gnomes_dark_wispers_wisps`       | [GVG_041b](https://art.hearthstonejson.com/v1/512x/GVG_041b.jpg)   | Added  |
| `goblins_vs_gnomes_dark_wispers_buff`        | [GVG_041a](https://art.hearthstonejson.com/v1/512x/GVG_041a.jpg)   | Added  |
| `blackrock_mountain_firecat_form`            | [BRM_010a](https://art.hearthstonejson.com/v1/512x/BRM_010a.jpg)   | Added  |
| `blackrock_mountain_fire_hawk_form`          | [BRM_010b](https://art.hearthstonejson.com/v1/512x/BRM_010b.jpg)   | Added  |
| `the_grand_tournament_living_roots_damage`   | [AT_037a](https://art.hearthstonejson.com/v1/512x/AT_037a.jpg)     | Added  |
| `the_grand_tournament_living_roots_saplings` | [AT_037b](https://art.hearthstonejson.com/v1/512x/AT_037b.jpg)     | Added  |
| `the_grand_tournament_lion_form`             | [AT_042a](https://art.hearthstonejson.com/v1/512x/AT_042a.jpg)     | Added  |
| `the_grand_tournament_panther_form`          | [AT_042b](https://art.hearthstonejson.com/v1/512x/AT_042b.jpg)     | Added  |
| `league_of_explorers_raven_idol_minion`      | [LOE_115a](https://art.hearthstonejson.com/v1/512x/LOE_115a.jpg)   | Added  |
| `league_of_explorers_raven_idol_spell`       | [LOE_115b](https://art.hearthstonejson.com/v1/512x/LOE_115b.jpg)   | Added  |

## Implementation

1. Each authored `choice.options` entry has a validated `presentationCardId`. Catalog initialization rejects unknown references.
2. The match input exposes that card ID and the parent?s printed `presentationCost`. The numeric choice ID, actions, target selection, and timing remain the gameplay authority.
3. The overlay builds the usual card view, using its Belwe title and Franklin Gothic Condensed description. It overrides the visible mana cost with the parent?s printed cost and omits the external option label.
4. Choice definitions use rarity `None` to omit rarity gems. Their stored cost remains zero, as in the source data. They are noncollectible and excluded from normal deck building and collectible random-card pools.
5. New entries are presentation tokens with empty `effects`; choosing them executes the parent branch. Existing token effects were retained. They are not intended as independently playable generated spells.
6. Transformation choices use their researched spell option cards; the original transform actions still create the existing minion forms. Unmapped choices retain the source-card/label fallback, and existing transform inference remains available.

## Validation plan

- Check all 17 parents expose two distinct, resolvable options with their printed parent costs.
- Exercise Keeper targeting, both Power of the Wild and Living Roots options, Wrath/Starfall damage and draw, Raven Idol discovery, and staged Druid transformations.
- Run focused tests, TypeScript checks, dependency checks, and lint/format checks on edited files.
- Manually inspect the overlay in-game for typography, artwork cropping, hit targets, and See Board toggling. The app was not launched as part of this change.

The suggested smoke-test names are **Keeper of the Grove**, **Living Roots**, and **Power of the Wild**. [Call of the Wild](https://hearthstone.wiki.gg/wiki/Call_of_the_Wild) is a Hunter spell that summons Animal Companions; it is not one of these Choose One parents.

## Validation results

- 27 focused runtime checks passed: all 17 mappings, Keeper targeting, staged transformation, both Wrath/Starfall branches, and both Power of the Wild/Living Roots branches. The latter also verify one mana payment and only the parent card in play/cast history.
- The supporting League of Explorers, capability inventory, and choice descriptor suites passed (24 tests), including Raven Idol discovery.
- Two temporary overlay tests passed for token IDs, printed mana, omitted labels, choice submission, and unmapped fallback; the temporary test file was removed.
- TypeScript, dependency boundaries, and edited TypeScript lint checks passed. The JSON semantic audit verified that other cards and balance values were unchanged; all 34 referenced JPEGs are present. Existing compact JSON formatting was retained for unrelated records.
- The broader effect-runtime suite has four unrelated numeric expectation failures involving Acidic Swamp Ooze: current data gives it 2 Attack while older tests expect 3. Those balance values and assertions were left unchanged.
- In-game visual validation remains manual, including source-art padding/cropping and See Board interaction.
