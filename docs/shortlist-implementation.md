# 57-card shortlist implementation

Source: **HSInspired reduced 57-card visual shortlist** and **HSInspired first pass deck selections** (5 November 2026). The selected card renders, not current live Hearthstone balance, define the new card versions. Existing authored balance values remain unchanged. The base repository commit is `dce7fef2995cf73f842949afa5a08536cc938721`.

## Scope

- 57 collectible cards, all registered in the normal card catalog and their original expansions.
- 12 new noncollectible, non-deck-legal token definitions; reuse existing Boom Bot, Voidwalker, and Light’s Justice.
- 13 exact, legal 30-card shortlist decks added to the normal AI pool. The previous 36 lists remain unchanged (49 total).
- All 69 new card/token illustrations are imported from the existing local extraction archive and registered in `scripts/card-artwork-sources.json`.
- Reusable deterministic card scenarios, selected-version assertions, AI registration scenarios, targeted production-AI strategy probes, and a repeatable complete-game evaluation harness.

## Intentional engine corrections

1. `summon-copy` permits a count of zero, rather than incorrectly forcing one copy. Dragon Golem with no remaining Dragons now produces no additional body.
2. Lifesteal heals for the full unprevented damage of an overkill hit, while preserving the engine’s existing health-loss/event accounting. Divine Shield, immunity, minimum-health prevention, and maximum hero Health still apply. Three existing spell-Lifesteal expectations were corrected; no authored card stats changed.
3. Windfury aura attack allowance is refreshed with the effective keyword. Battlemaster neighbors can actually make their second attacks, not merely display the keyword. Aura removal and movement are covered.

Missile timing is deliberately preserved: damage reactions and random-target eligibility update between hits; Deathrattles resolve at the volley’s outer death checkpoint. See the Mage/Rogue scenario document for the rulebook reference.

## Reproduce

```sh
npm ci
npm test -- --maxWorkers=2 shortlist
npm run typecheck
npm run lint
npm run deps:check
npm run build:smoke
node scripts/run-shortlist-ai-evaluation.cjs --output /tmp/shortlist-ai-evaluation.json
```

Durable regression scenarios use `.scenarios.ts`, included in the normal Vitest configuration. Temporary `.test` loaders are not retained.

## Artwork integration (8 November 2026)

All 57 collectible cards and 12 tokens now have opaque runtime PNGs named after their local card IDs in `assets/images/card-artwork`. Sources are existing files under `assets/original`; no source images, existing runtime artwork, card values, or layout values were changed. The normal asset resolver discovers the PNGs without renderer changes.

Matching uses the extraction archive's `card_portraits.csv` and original expansion card IDs, with each selected texture independently checked against the card's primary `PortraitTexturePath` in `mapping_data/asset_links.json`. These indexes are in the installed Hearthstone `Assets_Extracted/card_related` folder. The updated project source manifest records the portable original path, Hearthstone ID, and source/runtime SHA-256 hashes. `Artifacts/card-artwork-mapping.csv` and `Artifacts/shortlist-artwork-import.json` retain the local mapping and import evidence.

Two local token names differ from the extracted display names: `march_of_the_lich_king_zombie` uses **Unarmed Zombie** (`RLK_650t2`), the final Lingering Zombie form; `titans_worm` uses **Bursting Jormungar** (`TTN_081t`), the Awakening Tremors token. Name collisions such as Squirrel, Dragon Golem, Lord Godfrey, and the story-mode Librams are resolved by original card ID.

The existing `opaqueArtworkPng` conversion removes alpha masks while preserving original dimensions, gamma, and every RGB pixel. All 1,726 pre-existing runtime PNGs were verified byte-identical after importing the 69 additions. Reimport with `npm run assets:import`; validate with `npm run assets:check`. Desktop visual framing remains untested.

## Scenario plans and evidence

- [Druid and Hunter](shortlist-druid-hunter.md)
- [Paladin and neutral support](shortlist-paladin.md)
- [Mage, Mech, and Rogue](shortlist-mage-rogue.md)
- [Priest, Warrior, Shaman, and Warlock](shortlist-other-classes.md)
- [AI complete-game evaluation](shortlist-ai-evaluation.md)
- [AI strategy scenarios](shortlist-ai-strategies.md)

## Collectible inventory

| Card                      | Cost | Class           | Card ID                                         |
| ------------------------- | ---: | --------------- | ----------------------------------------------- |
| Acornbearer               |    1 | Druid           | `rise_of_shadows_acornbearer`                   |
| Adorable Infestation      |    1 | Druid / Hunter  | `scholomance_academy_adorable_infestation`      |
| Aldor Attendant           |    1 | Paladin         | `ashes_of_outland_aldor_attendant`              |
| Aldor Truthseeker         |    5 | Paladin         | `ashes_of_outland_aldor_truthseeker`            |
| Alliance Bannerman        |    3 | Paladin         | `united_in_stormwind_alliance_bannerman`        |
| Aluneth                   |    6 | Mage            | `kobolds_and_catacombs_aluneth`                 |
| Ancient Mysteries         |    2 | Mage            | `saviors_of_uldum_ancient_mysteries`            |
| Arcane Flakmage           |    2 | Mage            | `saviors_of_uldum_arcane_flakmage`              |
| Awakening Tremors         |    1 | Hunter          | `titans_awakening_tremors`                      |
| Battleground Battlemaster |    6 | Neutral         | `united_in_stormwind_battleground_battlemaster` |
| Bomb Wrangler             |    3 | Warrior         | `galakronds_awakening_bomb_wrangler`            |
| Breath of Dreams          |    2 | Druid           | `descent_of_dragons_breath_of_dreams`           |
| Busy-Bot                  |    2 | Paladin         | `perils_in_paradise_busy_bot`                   |
| Canal Slogger             |    4 | Shaman          | `united_in_stormwind_canal_slogger`             |
| Click-Clocker             |    1 | Neutral         | `voyage_to_the_sunken_city_click_clocker`       |
| Cloud Prince              |    5 | Mage            | `saviors_of_uldum_cloud_prince`                 |
| Crystology                |    1 | Paladin         | `the_boomsday_project_crystology`               |
| Cutting Class             |    5 | Rogue / Warrior | `scholomance_academy_cutting_class`             |
| Desert Nestmatron         |    4 | Druid           | `showdown_in_the_badlands_desert_nestmatron`    |
| Dragon Golem              |    7 | Druid           | `showdown_in_the_badlands_dragon_golem`         |
| Dreamway Guardians        |    2 | Druid           | `rise_of_shadows_dreamway_guardians`            |
| Duskbreaker               |    4 | Priest          | `kobolds_and_catacombs_duskbreaker`             |
| Emerald Explorer          |    6 | Druid           | `descent_of_dragons_emerald_explorer`           |
| Flame Ward                |    3 | Mage            | `saviors_of_uldum_flame_ward`                   |
| Galvanizer                |    2 | Neutral         | `the_boomsday_project_galvanizer`               |
| Glowfly Swarm             |    5 | Druid           | `ashes_of_outland_glowfly_swarm`                |
| Gold Panner               |    2 | Neutral         | `showdown_in_the_badlands_gold_panner`          |
| Granite Forgeborn         |    4 | Shaman          | `united_in_stormwind_granite_forgeborn`         |
| Hench-Clan Thug           |    3 | Neutral         | `the_witchwood_hench_clan_thug`                 |
| Hi Ho Silverwing          |    2 | Paladin         | `showdown_in_the_badlands_hi_ho_silverwing`     |
| Kobold Librarian          |    1 | Warlock         | `kobolds_and_catacombs_kobold_librarian`        |
| Libram of Hope            |    9 | Paladin         | `ashes_of_outland_libram_of_hope`               |
| Libram of Justice         |    5 | Paladin         | `ashes_of_outland_libram_of_justice`            |
| Libram of Wisdom          |    2 | Paladin         | `ashes_of_outland_libram_of_wisdom`             |
| Lingering Zombie          |    1 | Druid           | `march_of_the_lich_king_lingering_zombie`       |
| Lord Godfrey              |    7 | Warlock         | `the_witchwood_lord_godfrey`                    |
| Mecha-Shark               |    3 | Mage            | `voyage_to_the_sunken_city_mecha_shark`         |
| Mecharoo                  |    1 | Neutral         | `the_boomsday_project_mecharoo`                 |
| Mother Duck               |    4 | Neutral         | `into_the_emerald_dream_mother_duck`            |
| Occult Conjurer           |    4 | Mage            | `madness_at_the_darkmoon_faire_occult_conjurer` |
| Painter's Virtue          |    4 | Paladin         | `whizbangs_workshop_painters_virtue`            |
| Possessed Lackey          |    5 | Warlock         | `kobolds_and_catacombs_possessed_lackey`        |
| Prismatic Beam            |    7 | Paladin         | `showdown_in_the_badlands_prismatic_beam`       |
| Prize Plunderer           |    1 | Rogue           | `madness_at_the_darkmoon_faire_prize_plunderer` |
| Raiding Party             |    3 | Rogue           | `rastakhans_rumble_raiding_party`               |
| Risky Skipper             |    1 | Warrior         | `galakronds_awakening_risky_skipper`            |
| Scavenger's Ingenuity     |    2 | Hunter          | `ashes_of_outland_scavengers_ingenuity`         |
| Seafloor Gateway          |    3 | Mage            | `voyage_to_the_sunken_city_seafloor_gateway`    |
| Security Automaton        |    2 | Neutral         | `voyage_to_the_sunken_city_security_automaton`  |
| Showdown!                 |    2 | Paladin         | `showdown_in_the_badlands_showdown`             |
| Skull of the Man'ari      |    5 | Warlock         | `kobolds_and_catacombs_skull_of_the_man_ari`    |
| Splish-Splash Whelp       |    2 | Druid           | `showdown_in_the_badlands_splishsplash_whelp`   |
| Springpaw                 |    1 | Hunter          | `rastakhans_rumble_springpaw`                   |
| The Light! It Burns!      |    1 | Priest          | `murder_at_castle_nathria_the_light_it_burns`   |
| Vicious Scalehide         |    2 | Neutral         | `the_witchwood_vicious_scalehide`               |
| Voidlord                  |    9 | Warlock         | `kobolds_and_catacombs_voidlord`                |
| Wailing Vapor             |    1 | Shaman          | `forged_in_the_barrens_wailing_vapor`           |

## New token inventory

| Token            | Cost | Stats | Card ID                                  |
| ---------------- | ---: | ----- | ---------------------------------------- |
| Jo-E Bot         |    1 | 1/1   | `the_boomsday_project_jo_e_bot`          |
| Squirrel         |    1 | 1/1   | `rise_of_shadows_squirrel`               |
| Crystal Dryad    |    1 | 1/2   | `rise_of_shadows_crystal_dryad`          |
| Glowfly          |    2 | 2/2   | `ashes_of_outland_glowfly`               |
| Disarmed Zombie  |    1 | 1/1   | `march_of_the_lich_king_disarmed_zombie` |
| Zombie           |    1 | 1/1   | `march_of_the_lich_king_zombie`          |
| Lynx             |    1 | 1/1   | `rastakhans_rumble_lynx`                 |
| Marsuul Cub      |    1 | 1/1   | `scholomance_academy_marsuul_cub`        |
| Worm             |    1 | 4/1   | `titans_worm`                            |
| Ancient Guardian |    8 | 8/8   | `ashes_of_outland_ancient_guardian`      |
| Duckling         |    1 | 1/1   | `into_the_emerald_dream_duckling`        |
| Outlaw           |    3 | 3/3   | `showdown_in_the_badlands_outlaw`        |

## Verification status

Final stable run on 7 November 2026:

- **256/256 shortlist checks pass** across eight durable scenario files: 215 card-effect/selected-version checks, 15 new-deck integration checks, and 26 AI strategy cases. The latter include 24 scored successful outcomes and two explicitly unscored diagnostics, not 26 strategic successes.
- **Full suite: 3,895 passed, 28 failed, one skipped** across 124 files (453.17 seconds). Clean main had 3,635 passed, 29 failed, one skipped. Every final failing test name also failed on main; no new failing names remain. One previously failing Wyrm/Frostbolt AI recording now passes, without a production AI policy change.
- Typecheck, dependency-boundary checks, build smoke, and changed-file ESLint/Prettier checks pass.
- The repository-wide `verify` command remains red. Formatting has the same five existing failures; lint has the same unused `deriveSourceFiles` error in `scripts/card-testing.cjs:2786`; asset validation has the same 43 absent Future Past PNGs in the Git checkout. These unrelated files and artwork were not changed.
- Catalog-sensitive historical fixtures and two explicit public-knowledge fixtures were corrected, with reasons and preserved assertions in [regression notes](shortlist-regression-notes.md). This is not a claim that the old concealed-Secret scenario is solved.
- Exact baseline-versus-final failure names and check results are recorded in [verification data](shortlist-verification.json).

### Can the AI use these decks?

All 13 are enabled in the normal AI pool. **26 primary full matches completed**, two per deck with swapped seats, against one rotated representative opponent each. There were no illegal selections, rejected commands, failed AI decisions, capped games, or draws. **61 legal timeout fallback actions** occurred across both sides (3.9% of non-forced decisions).

The targeted probes demonstrate specific deck plans, including Libram discounts, Showdown/Giant/Beam ordering, Battlemaster placement and four attacks, Mech synergies, sacrifice/recruit sequencing, and avoiding lethal Aluneth fatigue. However, a short-horizon Whelp ramp choice and a concealed Mirror Entity lethal line remain documented limitations. No production AI policy changes were made.

The primary matches played **48/57 new cards**. Emerald Explorer, Dragon Golem, Prismatic Beam, Showdown!, Aluneth, Possessed Lackey, Skull of the Man'ari, Voidlord, and Lord Godfrey were not played in that small complete-match sample; all have direct effect scenarios, and several have targeted strategy probes. The eight-iteration full-match work cap and two games per deck establish basic usability, not full Expert strength, balance, or reliable win rates. No desktop/manual playtesting was performed.

See [AI match outcomes](shortlist-ai-evaluation.md) and [strategy evidence](shortlist-ai-strategies.md) for selected lines, deck-by-deck results, and limits. The optional default 78-game matrix is reproducible but was not run.
