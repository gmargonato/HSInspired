# Future Past Yore validation

Implementation branch: `feat/future-past-yore`, based on `2702ef0`.

## Verified implementation checks

- TypeScript typecheck, changed-file ESLint, dependency boundaries, and production build smoke passed.
- Permanent card interaction scenarios: 99 passed (the 91 retained Yore scenarios, four explicit Ancient/Maiev Dormancy checks, two persistent Health-resource checks, and two Domino/Dormant barrier cases, in the existing wiki-rules integration suite; 116 total cases including its prior 17), including natural Dorian draws, all Bob choices, Dream upgrades, Dormant copies, and lethal Health-payment ordering.
- Opponent-Health payment scenarios: 13 passed; accompanying existing regression suites: 325 passed.
- Timed-Dormant scenarios: 5 passed; accompanying existing regression suites: 282 passed.
- AI payment awareness: 82 local-AI/fallback tests passed, including zero-Mana lethal through Armor, cards costing more than 10 being unplayable, and one-use consumption. Terminal-safety/fair-hypothesis suites: 40 passed.
- Catalog/capability suite: 35 passed. Future Past now contains 43 entries, 27 collectible.

These suites overlap; their counts must not be added together as unique coverage. Temporary scenario test files are removed after execution as required by repository instructions.

Artwork remains deferred. The artwork validator reports 43 missing Future Past images, comprising the 12 pre-existing entries and 31 additions. Runtime uses the existing fallback; this validator is not reported as passing.

## Baseline reconciliation

The initial full run had 27 failures; the matching baseline had 25. All 25 baseline failure names were also present in the implementation run. They are retained as known failures rather than hidden or rewritten. One additional failure was the stale Future Past catalog count, now updated.

The remaining historical fixed-work AI fixture was proven catalog-sensitive. Restored match checkpoints, public observations, and legal action lists were byte-identical. The expanded catalog changed sampled enemy hands/decks in fair hypotheses, changing the selected line from self-heal to Loot Hoarder followed by Reno. A test-only restriction to the baseline catalog reproduced every baseline candidate's numeric mean, visit count, sequence, and selected action exactly. The expanded-catalog line already omitted the redundant self-heal.

The historical fixture is pinned explicitly to its historical Future Past hypothesis catalog, preserving its original assertion. A separate unmocked expanded-catalog test verifies legal replay, no redundant hero-power prefix, full healing, two remaining Mana, and the resulting board. The complete action-ordering suite passes 86 tests. No production catalog restriction is introduced.

## Full-match protocol

The starting 30-card list is `future-past-yore-deck.json`. Games use natural shuffles and deliberate decisions from public observations against the production Expert controller, with its normal 60-second turn budget and no work-budget override. This is interactive headless testing, not graphical-interface validation.

Predeclared opponents/seeds:

- Face Hunter: 2026101901 and 2026101902
- Dragon Warrior: 2026101903 and 2026101904
- Reno Raza Priest: 2026101905 and 2026101906

Odd-numbered games start first. Original logs are retained. Any game affected by a discovered rules bug is marked diagnostic and rerun with the same original seed after correction, rather than replaced with a favorable seed.

Natural-game testing exposed a Dorian self-trigger when the minion was drawn without a Dorian on the battlefield. An explicit board-only trigger scope fixes that case; four additional scenarios verify ordinary draws, tutor draws, an existing on-board Dorian, and hand overflow. A separate terminal-payment test exposed spell/Battlecry resolution continuing after lethal Health payment. Payment now consumes the card and modifier, records the play, and ends before those later effects; five additional cases verify the terminal boundary.

Record wins/losses, Ancient Armor and draws, freeze value, burns, premature combo draws, assembly, unused cards, and deliberate decisions. Starting-list results and any bounded matched-seed adjustment/holdout results will be added after clean games finish. Small samples are diagnostic evidence, not a reliable win-rate estimate.

## Additional Discover edge case

Catacombs initially allowed repeated card IDs in its options. The corrected tutor skips repeated IDs after its existing candidate shuffle, preserving both RNG consumption and options for draws whose first three candidates were already distinct. Thirteen additional cases verify duplicate-rich decks, one distinct minion type, untouched unchosen card order/identity, and drawing the exact selected instance. Only exploratory game 5 showed duplicate options (turn 9, revision 24); that game was already diagnostic for the Dorian issue. No corrected-engine replay had cast Catacombs when this was found. Paused games continue from opaque saved checkpoints at their own decision boundary, preserving RNG/history and recording the code transition.

## Remaining limits

- Existing Chromaggus/Shadowfiend draw-trigger zone behavior was not broadened into this change; Dorian uses the explicit new board scope.
- Fyrakk's remaining-budget sampling and zero-cost safety cap are documented project contracts, not independently verified exact official behavior.
- No graphical playthrough or new artwork is included in this validation.
- Match samples are intended to expose interactions and refine a fun list, not establish competitive balance or a general Expert win rate.

## Separate inherited Defile correction

A corrected-code pilot loss exposed an existing Defile defect, independently reproduced on both unchanged baseline and Yore: the repeat state forced a second cast even when the first killed nothing, then checked death history before deferred deaths were resolved. A plain 1/2/3-Health ladder therefore stopped after two passes. Four of five initial focused scenarios failed identically on both versions; the spell-damage-source case happened to pass despite incorrect timing.

The focused correction snapshots initial death history, resolves deaths/Deathrattles at each cast boundary, and repeats only when that pass caused deaths. It stops on hero defeat and uses an explicit catalog repeat limit of 13 additional casts, matching the [documented 14-total-cast cap](https://hearthstone.wiki.gg/wiki/Defile). Other repeat effects retain their existing generic safety budget. This is a mechanics correction, not a card balance change.

Seven permanent regression cases were added to the existing wiki-rules integration suite: plain ladder, no death, Divine Shield, Deathrattle summons, dying Spell Damage source, regenerating Grim Patron cap, and terminal Deathrattle. Five related suites pass 198 tests; the separate Yore scenarios pass 89, including the Power Overwhelming timing alternative.

Before this correction, the final reconciled full suite reported 3293 passed, 25 failed, and one skipped. All 25 failures exactly matched baseline names. The final full run after the correction reports 3300 passed, the same 25 baseline failures, and one skipped; there are no additional failure names. Typecheck, changed-file lint, and production build smoke pass after this correction. Full-repository lint additionally reports the inherited unused `deriveSourceFiles` in `scripts/card-testing.cjs`; temporary manual-pilot harness lint findings are excluded from the final production deliverable. The affected Dragon Warrior loss remains in the evidence; its corrected continuation starts from an untouched pre-defect checkpoint, with exact public revision and RNG/history preserved. Other games are audited for both failure modes before inclusion.

## Shaladrassil recovery validation

Shaladrassil is retained as an intended fun/recovery card, not evaluated solely as an expensive dead draw. A controlled two-turn scenario verifies: an early hand-drawn Agamaggan is played while holding Shaladrassil; the upgraded spell is paid for with enemy Health; Corrupted Dream returns that Agamaggan to its owner's deck; surviving Dorian and Catacombs then recover the full-size card plus its permanent one-cost 1/1 copy and rebuild the Health-payment chain. A second scenario uses Corrupted Awakening before the chain to prepare lethal. The high-Armor scenario independently checks that Shaladrassil and both subsequent Health payments bypass Armor. All 91 controlled scenarios pass. These are deliberately constructed interaction checks, separate from natural full-game outcomes.

## Starting-list natural games

Final included outcomes for the six predeclared seeds were five wins and one loss. Diagnostic branches repeating those seeds are excluded from this count.

| Seed       | Opponent       | Result | Finish           | Ancient Armor | Ancient draws (successful / attempted) | Burns |
| ---------- | -------------- | ------ | ---------------- | ------------: | -------------------------------------: | ----: |
| 2026101901 | Face Hunter    | Win    | Own turn 10      |            21 |                                  7 / 7 |     0 |
| 2026101902 | Face Hunter    | Win    | Own turn 9       |            18 |                                  6 / 6 |     0 |
| 2026101903 | Dragon Warrior | Win    | Own turn 8       |             9 |                                  3 / 3 |     0 |
| 2026101904 | Dragon Warrior | Loss   | Opponent turn 10 |             6 |                                  2 / 2 |     0 |
| 2026101905 | Reno Raza      | Win    | Own turn 13      |            30 |                                 9 / 10 |     4 |
| 2026101906 | Reno Raza      | Win    | Own turn 10      |            18 |                                  6 / 6 |     0 |

The intended Dorian/Catacombs/Agamaggan/Fyrakk chain occurred in seed 1903; Fire cleared the board and Ancient attacks finished next turn. Other games often won through Ancient pressure or a legitimate one-cost Fyrakk after early Agamaggan draws. Bob/Maiev freeze bought turns but did not independently solve repeated hero-power and weapon pressure in the loss. Cube plus Dark Pact provided emergency healing there.

The four burns in the longest control game were Touch, Shaladrassil, Domino, and Catacombs. This is evidence of hand-management pressure, not a reason to remove the intended Shaladrassil recovery package. The fun-first comparison retains every original card name and replaces only the second Shallow Grave with one Shadow Bolt, in the same expanded deck slot. Both lists are tested on the known Warrior seed 2026101904 and fresh Hunter/Warrior/Priest seeds 2026101911–1913. This eight-game paired comparison was declared before variant play; it is not a competitive balance estimate. The starting list remains preferred unless the comparison supports the single substitution.

## Expanded opponent coverage

The verified curated catalog contains 36 decks (four per class). After the bounded list comparison, the selected fun-first list is frozen for one initial natural-shuffle match against each of the 33 remaining exact deck IDs. Face Hunter (`hunter-face-burn`), Dragon Warrior (`warrior-dragon-tempo`), and Reno Raza (`priest-reno-raza`) are the only exclusions. Seeds 2026102001–2026102033 and alternating seats are declared in catalog order before play. Each game uses the actual production Expert with its unchanged 60-second turn budget and no work-budget override. Results, card defects, and independently checked AI opportunities are recorded separately; this exploratory coverage does not establish a statistically reliable win rate.

## Permanent regression gate

After retaining all 91 interaction scenarios and adding four explicit Ancient/Maiev checks in the existing integration file, the complete suite reports **3395 passed, 25 failed, one skipped (3421 total)**. The 25 failure names exactly match the clean baseline; none were added or removed. The focused integration suite passes 112/112. Node/web typechecks, focused test-file lint, and whitespace checks pass. The final full run excludes only the live manual-pilot harness, which is removed when match testing concludes.

Two subsequent test-only cases additionally verify that Agamaggan persists across a complete round and pays for a spell without spending Mana or Armor, and rejects a 20-cost card without consuming its modifier. The latest focused suite passes 114/114; these two additions postdate the 3395-pass full run above.

## Frozen recommendation after paired comparison

Retain the original 30 cards, including both Shallow Graves and Shaladrassil. Original and the one-card Shadow Bolt variant each won all four predeclared paired matches. This small descriptive result does not establish a win rate or equivalence. The second Shallow provided a concrete survival/pressure reset in the Hunter holdout; Bolt improved one Warrior removal turn but was redundant or unseen elsewhere. The original remains the fun-first recommendation.

- Seed 2026101904, Dragon Warrior: both won on own turn 9. Bolt preserved additional attacks and enabled a payment-only finish. The earlier valid starting-list loss remains recorded; different Finley powers and earlier Ancient/Shard decisions explain important divergence.
- Seed 2026101911, Face Hunter: original won on own turn 9, variant on turn 10. Original gained 36 Ancient Armor versus 24, but also burned five cards versus one. The second Shallow enabled a four-Ancient reset; Bolt stayed unused.
- Seed 2026101912, Dragon Warrior: both won on own turn 11. The swapped slot arrived only on the lethal turn and was unused. Original naturally finished with Agamaggan, corrupted Shaladrassil, Dream removing Ragnaros, and Awakening lethal.
- Seed 2026101913, Reno Raza: original won on own turn 11, variant on turn 17. The variant recovered after burning Fyrakk through corrupted Shaladrassil, Cube/Shallow Bearsharks, and final Ancient pressure; Expert supplied multiple genuine clears and recovery effects.

The 33-opponent sweep uses a byte-frozen copy of the original list. No card or engine changes were made during this paired comparison. Qualified unused-weapon observations are review leads, not confirmed AI defects; the sweep now archives exact opaque pre-action checkpoints for postgame legality checks.

## Independently validated Expert opportunity

Sweep-07 (Flamewaker Mage), global turn 18, step 58/revision 59: Expert cast Firelands Portal on its own hero, reducing 9 Health to 4, then Fireblasted Fierce Monkey. This left 14 visible attack; Bob alone had a legal lethal attack. An exact-checkpoint counterfactual, also verified across eight fair hypotheses, established a deterministic defense already available in Expert's hand: Flamestrike, then Fireblast one active Ancient, then pass. Expert retains 9 Health and faces only one active 5-attack Ancient on the next turn; the third Ancient and both Campaign Bob copies remain Dormant. This is a confirmed avoidable public-board lethal, not proof of an eventual win. No AI behavior was changed for the sweep.

The first six games were separately checked at 245 non-mulligan Expert action states for one-action fair lethal, with bounded depth-six/node-300/width-eight searches at 53 end-turn states. No missed immediate lethal was confirmed in that bounded review; it does not rule out all earlier multi-action combo errors. A legal unused Tar Creeper face attack was recorded as a chip-damage opportunity. A last-durability Glaivezooka swing was reasonably qualified as conservation because Expert used it on the following turn.

A natural Secret Paladin game prompted clarification of Domino's adjacent chain: it stops at a Dormant slot rather than skipping over it. This matches the implemented contract and a [directly relevant community explanation](https://us.forums.blizzard.com/en/hearthstone/t/domino-effect-bug-in-arena/147799); that explanation is not an official developer adjudication. No production change was made. Two permanent left/right-edge regressions now verify the barrier, bringing the latest focused suite to 116/116; these two cases also postdate the full run above. The pilot's mistaken expectation is retained in its match notes rather than erased by a restart.

The Inner Fire sweep win included a risky partial-hand Shaladrassil play: the pilot initially assumed a fixed token order. The implemented random order is correct and is supported by [Blizzard's known-issues clarification](https://us.forums.blizzard.com/en/hearthstone/t/320-known-issues/143315). Dream happened to arrive in the two available slots and remove the giant Taunt. The outcome remains valid, but the mistaken expectation is retained as a piloting limitation; future decisions treat partial-hand delivery as a gamble.

## Success criterion and interpretation

The user's goal is a fun deck capable of at least a 51% win rate, not a perfect record. The recommendation preserves the intended modern cards and recovery lines. The sweep's observed panel record is reported separately from an estimated population win rate: it uses one declared seed per remaining curated deck, approximately balanced seats, deliberate headless piloting, and a particular production Expert version. Matchup frequencies and human piloting differ outside this panel. A result above 51% in these games supports the direction but is not a guarantee of that win rate for a different matchup distribution or player. AI mistakes remain documented for later work; they are not fixed during this frozen comparison.

### Sweep correction: Dormant Spell Damage and Spirit Claws

The Totem Shaman sweep paused immediately after Maiev put Azure Drake Dormant at
step 36/revision 37 (global turn 12). Actual spell damage already excluded Dormant
minions, but the inherited `player-has-spell-damage` condition did not, leaving
Spirit Claws at 3 Attack rather than 1. That exact condition is present in the
baseline source; the new Maiev interaction exposed it. The fix reuses the shared
spell-damage helper, with permanent tests for both the sole sleeping source and
an additional active source, including the Drake waking again. The first test
failed before the fix; all 118 interaction cases and web typecheck pass afterward.
Original match evidence is retained, with continuation from the exact pre-Maiev
opaque checkpoint and identical chosen action. Previous match exposure is checked
specifically rather than treating unrelated runs as invalid.

### Bounded Expert decision audit

The archived postgame audits distinguish confirmed immediate consequences from
unproven explanations for a loss. No production AI changes are made from them.
The strongest confirmed error is Flamewaker Mage casting Firelands Portal on its
own hero, opening immediate public-board lethal, while a legal Flamestrike then
Fireblast defense avoids that lethal on the actual checkpoint and eight fair
hypotheses. This proves an avoidable immediate loss, not an eventual winning line.

Additional exact-checkpoint cases are retained for later investigation: Dragon
Priest skipped three damage to Armor with a ready Twilight Guardian; Anyfin
Paladin healed the opposing hero with Forbidden Healing while itself damaged
(qualified because hidden Molten Giant incentives are possible); Murloc Paladin
traded Finja into a 9/9 rather than removing a 4/1 Bob. Both direct Finja trades
kill Finja, so neither triggers its summons, and both still allow public lethal
after passing. A legal Coldlight Seer setup preserves Finja and triggers summons,
but does not establish an exhaustive winning defense. Reports include exact
legality, survival flags, public state, and sampled counterfactual results.

## Completed frozen-list opponent sweep

The 33 remaining curated AI decks are all complete: **26 wins, seven losses, no draws**.
The original 30-card list remains the recommendation, with both Shallow Graves and
Shaladrassil. The seven losses were Token Druid, Egg Hunter, Secret Hunter, Totem
Shaman, Reno Demons, Pirate Warrior, and Lakkari Portal. The observed 78.8% panel
result is descriptive only: one seed per deck, a particular Expert version,
approximately balanced seats, and manual decisions do not establish a population
win rate or optimal-play matchup strength.

The run retained genuine piloting errors (including Coin/Table Flip hand-size
sequencing, initial Bob and Domino misunderstandings, and risky draw decisions)
without restarting losses. Interrupted games resumed from saved accepted-action
boundaries with actor, phase, revision, and public-observation guards. Two
unfinished Expert searches restarted from their exact saved boundaries; their
wall-clock search continuations could not be preserved.

Card fixes and new-card integration belong in this change. Confirmed and qualified
AI targeting, survival, and development findings are recorded for a separate AI
change; no strategic fixes from those findings are included here.

## Publication gate (2026-10-20)

Final full suite: **3,401 passed, 25 failed, one skipped (3,427 total)**. The 25
failed test names exactly match the clean `2702ef0` baseline: no new or resolved
failures. All 118 wiki-rules integration cases pass. The temporary manual-pilot
harness is not included in the repository change or this final test run.

- Passed: Node/web typechecks, dependency boundary checks, production build smoke,
  changed-file ESLint, changed-file Prettier, and whitespace checks.
- Full-repository lint remains blocked by the unchanged unused `deriveSourceFiles`
  helper in `scripts/card-testing.cjs`.
- Full-repository formatting flags six unchanged files: `config/outline-tunings.json`,
  `config/vfx-templates.json`, `scripts/card-testing.cjs`,
  `src/game-rules/match/testing/card-testing-scenario.ts`,
  `src/scenes/arena/arena-model.test.ts`, and
  `src/visual-components/effects/fireball-authored.json`.
- Artwork validation fails for 43 missing Future Past images (12 pre-existing and
  31 additions); the accepted runtime fallback remains in use.

These limitations mean the aggregate verification command is not green. No
unrelated baseline failure, formatting issue, or asset was silently changed.
