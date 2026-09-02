# Card description coherence report

Date: 2026-09-01

## Scope and result

This is a copy/content report only. It audits the `rulesText` and the player-facing
terminology in every card JSON file under `src/game/content/cards/sets/`.

No card JSON, `keywords`, `effects`, numeric value, card ID, or schema file was
changed while producing this report. The proposals below are intended to be
applied to `rulesText` only.

The audit covered 720 JSON records: 719 cards and one `Hero Power` record. The
existing effect blocks were inspected for each proposed semantic rewrite so that
the wording preserves the authored values and operation order.

| JSON file                  | Records |   Cards | Hero powers | Blank `rulesText` |
| -------------------------- | ------: | ------: | ----------: | ----------------: |
| `basic.json`               |     136 |     136 |           0 |                19 |
| `blackrock-mountain.json`  |      36 |      36 |           0 |                 5 |
| `classic.json`             |     323 |     322 |           1 |                41 |
| `goblins-vs-gnomes.json`   |     131 |     131 |           0 |                 8 |
| `league-of-explorers.json` |      58 |      58 |           0 |                 5 |
| `naxxramas.json`           |      36 |      36 |           0 |                 3 |
| **Total**                  | **720** | **719** |       **1** |            **81** |

## Recommended copy conventions

- Use the canonical display terms `Battlecry`, `Deathrattle`, `Secret`, `Combo`,
  `Choose One`, `Taunt`, `Charge`, `Stealth`, `Divine Shield`, `Windfury`,
  `Spell Damage`, `Hero Power`, `Attack`, `Health`, `Armor`, `Mana`,
  `Durability`, `Overload`, `Freeze`, `Silence`, and `Immune`.
- Use `+Attack/+Health` notation consistently. In particular, `+1/1` and
  `1/ 1` should be `+1/+1`.
- Separate clauses with a space after `:` and after sentence-ending punctuation.
  Use ordinary sentence case; avoid emphasis through `ALL` or `HIMSELF`.
- Use `on the battlefield` for a location and `into play` for a zone transition;
  the latter is shorter and matches the rest of the player-facing vocabulary.
- Use `Poisonous` for the repeated “destroy any minion damaged by this minion”
  ability and `Elusive` for the repeated targeting restriction. These are text
  proposals only. This report does not add either label to the structured
  keyword vocabulary or alter the existing `effects`.
- For numeric ranges, use an en dash (`2–4`) rather than a hyphen (`2-4`).

## 1. Keyword and terminology replacements

These are the highest-value player-facing changes because they replace long
sentences or inconsistent labels with one recognizable ability name.

| Card ID(s)                                                                      | Current wording                                                                          | Proposed `rulesText`                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------ |
| `classic_emperor_cobra`, `naxxramas_maexxna`, `league_of_explorers_pit_snake`   | `Destroy any minion damaged by this minion.`                                             | `Poisonous`                                |
| `classic_patient_assassin`                                                      | `Stealth. Destroy any minion damaged by this minion.`                                    | `Stealth. Poisonous`                       |
| `classic_faerie_dragon`, `classic_laughing_sister`, `naxxramas_spectral_knight` | `Can't be targeted by Spells or Hero Powers.` (the second card uses lower-case `powers`) | `Elusive`                                  |
| `goblins_vs_gnomes_arcane_nullifier_x_21`                                       | `Taunt. Can't be targeted by spells or Hero Powers.`                                     | `Taunt. Elusive`                           |
| `goblins_vs_gnomes_wee_spellstopper`                                            | `Adjacent minions can't be targeted by spells or Hero Powers.`                           | `Adjacent minions have Elusive.`           |
| `classic_gnoll`                                                                 | Blank, while `keywords` contains `taunt`                                                 | `Taunt`                                    |
| `classic_silvermoon_guardian`                                                   | `Divine Sheild`                                                                          | `Divine Shield`                            |
| `basic_ogre_magi`, `basic_wrath_of_air_totem`                                   | `Spell Damage 1` / `Spell damage 1`                                                      | `Spell Damage +1`                          |
| `classic_azure_drake`                                                           | `Spell Damage 1. Battlecry: Draw a card.`                                                | `Spell Damage +1. Battlecry: Draw a card.` |

The existing structured values for the Elusive candidates are currently named
`spell-immune`, and the Poisonous candidates have no corresponding structured
keyword. That is intentionally left untouched: renaming or adding those
capabilities would be a separate effect/schema task.

## 2. High-confidence copy repairs

The following are direct wording, grammar, spelling, or punctuation repairs. All
numbers and described operations are preserved.

### Basic

| Card ID                      | Proposed `rulesText`                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `basic_darkspear_hunter`     | `Whenever you play a Beast, the Beast gains +1/+1.`          |
| `basic_divine_spirit`        | `Double a minion's Health.`                                  |
| `basic_dread_infernal`       | `Battlecry: Deal 1 damage to all other characters.`          |
| `basic_excess_mana`          | `Draw a card. (You can have no more than 10 Mana Crystals.)` |
| `basic_frost_shock`          | `Deal 1 damage to an enemy character and Freeze it.`         |
| `basic_grimscale_oracle`     | `All other Murlocs have +1 Attack.`                          |
| `basic_mark_of_the_wild`     | `Give a minion +2/+2 and Taunt.`                             |
| `basic_shattered_sun_cleric` | `Battlecry: Give a friendly minion +1/+1.`                   |
| `basic_stormwind_champion`   | `Your other minions have +1/+1.`                             |
| `basic_starving_buzzard`     | `Whenever you summon a Beast, draw a card.`                  |
| `basic_the_coin`             | `Gain 1 Mana Crystal this turn only.`                        |

`basic_ogre_magi`, `basic_wrath_of_air_totem`, and `classic_azure_drake` are listed
in the terminology table because their wording is both a capitalization and a
stat-format problem.

### Classic

| Card ID                        | Proposed `rulesText`                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `classic_abomination`          | `Taunt. Deathrattle: Deal 2 damage to all characters.`                                      |
| `classic_abusive_sergeant`     | `Battlecry: Give a minion +2 Attack this turn.`                                             |
| `classic_alakir_the_windlord`  | `Windfury. Charge. Divine Shield. Taunt.`                                                   |
| `classic_alarm_o_bot`          | `At the start of your turn, swap this minion with a random minion in your hand.`            |
| `classic_aldor_peacekeeper`    | `Battlecry: Change an enemy minion's Attack to 1.`                                          |
| `classic_amani_berserker`      | `Enrage: +3 Attack.`                                                                        |
| `classic_auchenai_soulpriest`  | `Your cards and Hero Powers that restore Health now deal damage instead.`                   |
| `classic_argent_commander`     | `Charge. Divine Shield.`                                                                    |
| `classic_brawl`                | `Destroy all minions except one, chosen at random.`                                         |
| `classic_cold_blood`           | `Give a minion +2 Attack. Combo: Give it +4 Attack instead.`                                |
| `classic_demonfire`            | `Deal 2 damage to a minion. If it's a friendly Demon, give it +2/+2 instead.`               |
| `classic_doomhammer`           | `Windfury. Overload: (2).`                                                                  |
| `classic_doomsayer`            | `At the start of your turn, destroy all minions.`                                           |
| `classic_dread_corsair`        | `Taunt. Costs (1) less for each Attack your weapon has.`                                    |
| `classic_earthen_ring_farseer` | `Battlecry: Restore 3 Health.`                                                              |
| `classic_emboldener_3000`      | `At the end of your turn, give a random minion +1/+1.`                                      |
| `classic_harrison_jones`       | `Battlecry: Destroy your opponent's weapon and draw cards equal to its Durability.`         |
| `classic_harvest_golem`        | `Deathrattle: Summon a 2/1 Damaged Golem.`                                                  |
| `classic_hogger`               | `At the end of your turn, summon a 2/2 Gnoll with Taunt.`                                   |
| `classic_holy_nova`            | `Deal 2 damage to all enemies. Restore 2 Health to all friendly characters.`                |
| `classic_imp_master`           | `At the end of your turn, deal 1 damage to this minion and summon a 1/1 Imp.`               |
| `classic_injured_blademaster`  | `Battlecry: Deal 4 damage to this minion.`                                                  |
| `classic_inner_fire`           | `Change a minion's Attack to be equal to its Health.`                                       |
| `classic_ironbeak_owl`         | `Battlecry: Silence a minion.`                                                              |
| `classic_ironforge_rifleman`   | `Battlecry: Deal 1 damage.`                                                                 |
| `classic_kirin_tor_mage`       | `Battlecry: The next Secret you play this turn costs (0).`                                  |
| `classic_king_mukla`           | `Battlecry: Give your opponent 2 Bananas.`                                                  |
| `classic_leokk`                | `Your other minions have +1 Attack.`                                                        |
| `classic_leper_gnome`          | `Deathrattle: Deal 2 damage to the enemy hero.`                                             |
| `classic_loot_hoarder`         | `Deathrattle: Draw a card.`                                                                 |
| `classic_mad_bomber`           | `Battlecry: Deal 3 damage randomly split between all other characters.`                     |
| `classic_master_swordsmith`    | `At the end of your turn, give another random friendly minion +1 Attack.`                   |
| `classic_mind_control_tech`    | `Battlecry: If your opponent has 4 or more minions, take control of a random enemy minion.` |
| `classic_mortal_strike`        | `Deal 4 damage. If your hero has 12 or less Health, deal 6 damage instead.`                 |
| `classic_power_of_the_wild`    | `Choose One - Give your minions +1/+1; or Summon a 3/2 Panther.`                            |
| `classic_raging_worgen`        | `Enrage: Windfury and +1 Attack.`                                                           |
| `classic_silver_hand_knight`   | `Battlecry: Summon a 2/2 Squire.`                                                           |
| `classic_siphon_soul`          | `Destroy a minion. Restore 3 Health to your hero.`                                          |
| `classic_slam`                 | `Deal 2 damage to a minion. If it survives, draw a card.`                                   |
| `classic_spellbreaker`         | `Battlecry: Silence a minion.`                                                              |
| `classic_spiteful_smith`       | `Enrage: Your weapon has +2 Attack.`                                                        |
| `classic_stampeding_kodo`      | `Battlecry: Destroy a random enemy minion with 2 or less Attack.`                           |
| `classic_sunfury_protector`    | `Battlecry: Give adjacent minions Taunt.`                                                   |
| `classic_sunwalker`            | `Taunt. Divine Shield.`                                                                     |
| `classic_tauren_warrior`       | `Taunt. Enrage: +3 Attack.`                                                                 |
| `classic_the_beast`            | `Deathrattle: Summon a 3/3 Pip Quickwit for your opponent.`                                 |
| `classic_wild_pyromancer`      | `After you cast a spell, deal 1 damage to all minions.`                                     |
| `classic_young_priestess`      | `At the end of your turn, give another random friendly minion +1 Health.`                   |

The nine `ALL` occurrences in `classic_baron_geddon`, `classic_circle_of_healing`,
`classic_coldlight_seer`, `classic_doomsayer`, `classic_equality`,
`classic_murloc_warleader`, `classic_wild_pyromancer`, `basic_dread_infernal`,
and `basic_grimscale_oracle` should all use ordinary `all` as shown above.

### Goblins vs Gnomes

| Card ID                                  | Proposed `rulesText`                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `goblins_vs_gnomes_grove_tender`         | `Choose One - Give each player a Mana Crystal; or Have each player draw a card.`                    |
| `goblins_vs_gnomes_mech_bear_cat`        | `Whenever this minion takes damage, add a Spare Part to your hand.`                                 |
| `goblins_vs_gnomes_sabotage`             | `Destroy a random enemy minion. Combo: Also destroy your opponent's weapon.`                        |
| `goblins_vs_gnomes_imp_losion`           | `Deal 2–4 damage. Summon 4 Imps, reduced by 1 for each damage dealt.`                               |
| `goblins_vs_gnomes_siltfin_spiritwalker` | `Whenever another Murloc dies, draw a card. Overload: (1).`                                         |
| `goblins_vs_gnomes_neptulon`             | `Battlecry: Add 4 random Murlocs to your hand. Overload: (3).`                                      |
| `goblins_vs_gnomes_anima_golem`          | `At the end of each turn, destroy this minion if it's your only minion.`                            |
| `goblins_vs_gnomes_mimirons_head`        | `At the start of your turn, if you control at least 3 Mechs, destroy them all and form V-07-TR-0N.` |
| `goblins_vs_gnomes_foe_reaper_4000`      | `Also damages the minions next to its target.`                                                      |
| `goblins_vs_gnomes_burrowing_mine`       | `When drawn, deal 10 damage to your hero.`                                                          |

The Imp-losion proposal deliberately preserves the existing authored formula
(`4 - damage dealt`); it does not replace it with a different card design.

### League of Explorers

| Card ID                                | Proposed `rulesText`                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `league_of_explorers_raven_idol`       | `Choose One - Discover a minion; or Discover a spell.`                                    |
| `league_of_explorers_dart_trap`        | `Secret: When your opponent uses their Hero Power, deal 5 damage to a random enemy.`      |
| `league_of_explorers_desert_camel`     | `Battlecry: Put a 1-Cost minion from each deck into play.`                                |
| `league_of_explorers_sacred_trial`     | `Secret: When your opponent has at least 3 minions and plays another minion, destroy it.` |
| `league_of_explorers_unearthed_raptor` | `Battlecry: Choose a friendly minion. Gain a copy of its Deathrattle.`                    |
| `league_of_explorers_reliquary_seeker` | `Battlecry: If you control 6 other minions, gain +4/+4.`                                  |
| `league_of_explorers_eerie_statue`     | `Can't Attack unless this is the only minion on the battlefield.`                         |
| `league_of_explorers_golden_monkey`    | `Taunt. Battlecry: Replace your hand and deck with Legendary minions.`                    |

### Naxxramas

| Card ID                   | Proposed `rulesText`                                                         |
| ------------------------- | ---------------------------------------------------------------------------- |
| `naxxramas_mad_scientist` | `Deathrattle: Put a Secret from your deck into play.`                        |
| `naxxramas_deathlord`     | `Taunt. Deathrattle: Your opponent puts a minion from their deck into play.` |
| `naxxramas_voidcaller`    | `Deathrattle: Put a random Demon from your hand into play.`                  |

`naxxramas_maexxna`, `naxxramas_spectral_knight`, `naxxramas_putrid_slime`, and
`naxxramas_slime` are covered by the keyword and style sections above.

## 3. Mechanical consistency batch

These are low-risk text-only replacements that can be applied mechanically after
the high-confidence copy repairs.

### Standalone keyword punctuation

Use the keyword alone without a trailing full stop for these records:

- `Taunt.` → `Taunt`: `basic_ironfur_grizzly`, `basic_treant_cenarius`,
  `classic_silverback_patriarch`, `classic_spirit_wolf`,
  `goblins_vs_gnomes_target_dummy`.
- `Stealth.` → `Stealth`: `classic_stranglethorn_tiger`,
  `goblins_vs_gnomes_gilblin_stalker`.
- `Windfury.` → `Windfury`: `goblins_vs_gnomes_whirling_zap_o_matic`,
  `goblins_vs_gnomes_flying_machine`.
- `Divine Shield.` → `Divine Shield`: `goblins_vs_gnomes_shielded_minibot`,
  `goblins_vs_gnomes_force_tank_max`.
- `Spell Damage +1.` → `Spell Damage +1`: `basic_archmage`,
  `basic_dalaran_mage`, `basic_kobold_geomancer`,
  `goblins_vs_gnomes_soot_spewer`.

Keep full stops between multiple clauses, as in `Taunt. Divine Shield.`.

### Range notation

Replace the hyphen with an en dash in the following descriptions without changing
the range: `blackrock_mountain_fireguard_destroyer` (`1–4`),
`classic_lightning_storm` (`2–3`), `goblins_vs_gnomes_crackle` (`3–6`),
`goblins_vs_gnomes_imp_losion` (`2–4`), and
`goblins_vs_gnomes_boom_bot` (`1–4`).

Add the missing terminal full stop to the Overload clauses in
`classic_doomhammer`, `classic_dust_devil`, `classic_earth_elemental`,
`classic_feral_spirit`, `classic_forked_lightning`, `classic_lava_burst`,
`classic_lightning_bolt`, `classic_lightning_storm`,
`classic_stormforged_axe`, `goblins_vs_gnomes_crackle`,
`goblins_vs_gnomes_siltfin_spiritwalker`, and
`goblins_vs_gnomes_neptulon`. Where another clause precedes Overload, retain
the existing clause separator and only add the final stop.

### Zone wording

For consistent player language, replace `into the battlefield` with `into play` in
`naxxramas_mad_scientist`, `naxxramas_deathlord`, `naxxramas_voidcaller`,
`classic_mindgames`, `goblins_vs_gnomes_ancestors_call`, and
`league_of_explorers_desert_camel`. The return wording in `classic_ancestral_spirit`
can likewise be shortened to `return it to play` if the same zone vocabulary is
adopted everywhere.

## 4. Content gaps and decisions outside the safe text-only batch

These records need an explicit product decision or a separate effect audit. They
are included so a text-only cleanup does not silently hide a behavior problem.

| Card ID                            | Observation                                                                                         | Text proposal / decision                                                                                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `classic_millhouse_manastorm`      | Collectible Legendary card with blank text and an empty `effects` array.                            | If the intended card is the known Millhouse design, use `Battlecry: Your opponent's spells cost (0) next turn.` only together with a separate effect implementation. Do not apply this as an isolated text change. |
| `goblins_vs_gnomes_burrowing_mine` | Non-collectible card has player-facing text but an empty `effects` array.                           | Use `When drawn, deal 10 damage to your hero.` if the authored effect is confirmed separately; do not remove the text merely to make the current effect array look consistent.                                     |
| `naxxramas_treant`                 | Non-collectible token has no keyword/effect but uses `Make it a tribe, you cowards` as `rulesText`. | Clear `rulesText` to an empty string, or move the joke to a future flavor-text field. It is not a rules description.                                                                                               |

The remaining 79 blank descriptions are vanilla minions, weapons, or generated
tokens with no authored rules keyword/effect and should remain blank.

## 5. Validation notes

- All six JSON files were parsed directly and every record was included in the
  counts above.
- The `classic.json` `Life Tap` hero-power record was reviewed and needs no copy
  change.
- The report intentionally does not modify JSON or run a full application build.
- Before applying any proposal, run the repository's normal content validation and
  review the rendered card text, especially if `Poisonous` and `Elusive` are later
  added to the structured keyword/display system.
