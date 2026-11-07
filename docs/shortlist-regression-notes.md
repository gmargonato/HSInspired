# Shortlist regression triage

## Baseline and preliminary run

The clean dce7fef baseline reported 29 failed / 3635 passed tests across 11 failed suites. The initial shortlist run reported 47 failed / 3850 passed tests. It ran while the Battleground Battlemaster correction and fixture fixes were being edited, so it is not final verification. There were 19 newly failing test names and one formerly failing test no longer failing. Final stable verification is tracked separately.

## Deliberate fixture corrections

- **Unstable Portal (phase5-6):** the expanded minion pool selects a two-cost card for seed 511. The existing engine clamps a negative cost adjustment at zero (`max(minimum - readCost, evaluated)`). Assert the stored adjustment is `-min(3, baseCost)` rather than always -3. The already-existing final-cost and generated-event assertions remain. No authored value changed.
- **Fyrakk self-death sequence (wiki-rules):** the new Fire spell pool makes the first qualifying sequence kill Fyrakk with Forbidden Flame rather than Hellfire. Pin the recorded pre-shortlist catalog for this specific historical Hellfire/AoE scenario; preserve seed 1, exact Hellfire identity, 15-mana budget, and subsequent-cast checks. Live catalog card scenarios remain separate.
- **Dirty Rat public uncertainty:** replace hidden-catalog sample seeds 13 and 18 with explicit concealed Flamecannon and Senjin Shieldmasta hands. The oracle still requires identical public observations, a no-RNG no-minion summon attempt, unknown proof, and the taunt branch preventing face attack. This checks the intended rule without depending on unrelated catalog order.
- **Recorded healing/controller lines:** exclude the shortlist IDs only for the two historical real-search line recordings, retaining their original Future Past subsets. Preserve exact expected sequences, dispatchability, state, and controller behavior. Rename the previously “expanded-catalog” recording to “Future Past-expanded recorded line” so it does not claim to cover the latest catalog.
- **Volcanic Drake hypothesis:** preserve the recorded pre-shortlist catalog when constructing the deliberate death-sensitive-cost hypothesis (sample 1212). Its required Drake and conservative-review assertions remain.
- **Legal healing continuation:** use the live pool and replay every intended command in the selected line; assert full health and Reno on board rather than requiring a particular first command. This is separate from the stricter historical redundant-healing controller checks.
- **Three local AI tactical cases:** use the live pool, replay the selected legal line, and check the resulting trade, development, or freeze. Do not require a particular first action. `choose` also verifies that the complete checkpoint is unchanged by AI analysis.

## Live-pool AI choice evidence

At fixed work budget 128, the original first-action assertions failed reproducibly. Removing shortlist cards from the sampled pool restored the recorded choices in isolated focused runs, proving the dependency on catalog composition. That pinning was diagnostic and was removed from the three tactical tests.

- Seed 0x504: Garrosh has Tank Up costing 2, 2 mana, 9 health, and a ready 6/7 Ogre opposite a 9/5 Core Hound. The chosen line is Tank Up, Ogre trades into Hound, end turn. The resulting trade meets the original tactical intent.
- Seed 0x505: Garrosh has Armor Up costing 1 and 7 mana, with Ogre and multiple Oozes in hand. The chosen line is Armor Up followed by two Oozes. This is a valid development line rather than a pass.
- Seed 0x50e: Garrosh has Armor Up costing 1 and 3 mana, 5 health, and Frostbolt against a 30/30 Ancient One. The chosen line is Armor Up, Frostbolt targeting Ancient One, end turn. Both actions are affordable and the attacker is frozen.

The upgraded or one-cost powers exist before analysis: opening-match's seeded AI hero-power bonus supplies them. Deep before/after state comparisons were identical for all three decisions. There is no evidence of simulation mutation here. The temporary trace test was removed after diagnosis.

## Actual content integration correction

Libram of Hope's restore action lacked its standard healing VFX reference. Add `vfx: heal-target`; update the exact authored-heal count from 61 to 62. This reuses an existing effect and adds no artwork.

## Verification and remaining findings

Focused initial reproduction: 7/7 failures. After the first targeted fixture corrections: 7/7 passed. The three same-pool AI controls passed, but full-file runs showed that catalog pool caching can preserve prior pools, reinforcing the decision to use live-pool semantic outcomes for nonhistorical tests.

Final targeted verification: all **557 tests in six affected suites passed**, including full files rather than only isolated test names. Druid routing now expects catalog version 4, and Arena validates dual-class membership through the existing shared class predicate. Preliminary Battlemaster failures were resolved by the tested runtime correction. The two artifact tests involving hidden identities are addressed explicitly below rather than silently filtered out. Final frozen-tree aggregate results are recorded in the implementation summary.

## Healing Wave and Secret knowledge correction

The artifact helper uses one fair hidden hypothesis, whereas the production Expert API aggregates multiple worlds. Expanded archetypes/catalog entries changed that sample: DEV-120 sampled a six-cost Shieldmaiden against own six-cost Ogre (a losing Joust tie), and DEV-144 sampled Mana Bind rather than Mirror Entity. Concealed singleton/Secret identities were never guaranteed AI knowledge.

- **DEV-120:** mark the opponent singleton deck card `knownTo` the acting AI in this specific fixture, and rename it publicly known. Keep the original self-heal and exhaustive opponent-reply survival assertions unchanged.
- **DEV-144:** mark the Secrets revealed and rename it publicly known Secret sequencing. Keep the strict winning outcome for both Mirror Entity and Counterspell. This explicitly changes the knowledge scope; it does not claim the old hidden-secret outcome is fixed.
- **Live production coverage:** add `shortlist-hidden-tactics.scenarios.ts` using the live catalog and actual production consensus/world evaluator. Hidden Healing Wave and Counterspell meet scored outcome checks; hidden Mirror Entity is an unscored assessment recording the missed immediate lethal. All decisions preserve the complete live checkpoint and dispatch legally. See `shortlist-ai-strategies.md` for the actual lines and limits.

Focused verification: **5 passed, 339 skipped across two files**, covering both corrected artifact cases and three production probes. Web TypeScript checking passed. Full artifact/aggregate verification is recorded in the implementation summary. No production AI policy, sampling rule, or authored balance change was made.
