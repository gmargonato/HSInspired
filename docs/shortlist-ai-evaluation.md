# Shortlisted deck integration and AI evaluation

## Source and scope

The 13 lists in `src/game-rules/decks/shortlisted-opponent-decks.ts` reproduce the
30-card lists in **HSInspired first pass deck selections**, 5 November 2026,
`hsinspired-first-pass-deck-selections.pdf`. They are custom design candidates,
not historical tournament lists. The source's rules snapshot preserves the
project's authored legacy balance. No artwork is required for this change.

The original 36 curated decks remain intact. The new definitions are registered
only after their card scenario validation. They use normal seeded class-then-list
selection, rather than a special scripted opponent. All nine supported classes
remain eligible; Death Knight and Demon Hunter are not added.

## Repeatable complete-match screen

Run from the repository root:

```sh
node scripts/run-shortlist-ai-evaluation.cjs --output /tmp/shortlist-ai-evaluation.json
```

The default matrix is 13 decks × three existing opponents × two seat-swapped
games = 78 complete-match attempts. Opponents represent aggro (Face Burn Hunter),
board tempo (Mech Mage), and control (Justicar Warrior). Each pair uses the same
seed and swaps the candidate deck between first and second seats, balancing
first-player advantage. Both sides use the current shared production AI policy
through `ExpertAiDecisionApi`, fair hidden-world simulation, and the Easy resource
profile. No scripted strategy, random baseline or AI-only hero-power bonus is used.

The default explicit **work budget of 8** keeps this a practical capability smoke
screen, not a test of full production Expert strength. Change `--work-budget` to
increase search effort. `--games` must be positive and even; larger values add
paired seeds. A 1,000-action ceiling exposes capped/stuck games rather than silently
counting them as completed. Rejected commands, illegal selections, worker failures,
fallbacks and per-card decision coverage remain in the underlying benchmark JSON.

Narrow or reproduce an individual pairing:

```sh
node scripts/run-shortlist-ai-evaluation.cjs \
  --deck-id shortlist-original-libram-paladin \
  --opponent-deck-id warrior-justicar-control \
  --games 2 --seed 20261107 --work-budget 8 \
  --output /tmp/libram-control.json
```

The report is saved after every pairing. It includes source/deck fingerprints,
configuration, runtime, per-game outcomes, exact card play coverage, and failures.
A nonzero benchmark exit is preserved even when a partial report is available.
Count candidate wins using `winnerParticipantId === candidateParticipantId`, not
by difficulty: both players use the same policy/profile in this screen.

## Interpretation

A valid 30-card deck is not evidence that the AI uses its plan well. Completed,
legal games establish basic usability only. Targeted decision/sequence scenarios
must additionally examine Dragon retention, Libram recycling, Showdown/Giant/Beam
ordering, Mech discounts, Aluneth fatigue, weapon burst, and Cube deathrattles.

Two games against each of three opponents provide **no reliable win-rate estimate**.
A card never drawn or played in these games is not covered by the match screen.
Legal but strategically poor sequences must be reported separately from engine
correctness and from stalled or rejected actions. Card scenarios remain the
primary evidence for the correctness of individual effects and caps.

For a smaller broad screen, `--matrix rotated` pairs each of the 13 decks with one
of the three opponents in round-robin order (26 games). This still swaps seats
within each equal-seed pair, but does not test every deck against every opponent.

## Results (7 November 2026)

Card-validation gate passed before registration. All 13 lists are enabled in the
normal AI pool; deck/selection validation passed **24/24 checks**. The original
36-definition array is byte-for-byte unchanged, with **49 total registered decks**.
Route/Arena checks pass **27/27**; web typecheck, dependency check and targeted
ESLint pass. No legacy balance values were changed to satisfy tests.

The executed primary screen is the **rotated 26-game matrix**, not the default
78-game extension. All 26 games completed with no draws, capped/stuck games,
illegal selections, rejected commands, failed AI decisions or worker-failure
fallbacks. There were **61 legal timeout fallback actions** across both sides. No production AI policy changes
were made. The Showdown pair was repeated after confirming the Battlemaster
Windfury aura fix; only the confirmed-fixed pair is in the primary results.

**30 games actually completed**: 26 primary games, two initial timing-smoke games
(a duplicate Dragon Ramp pairing), and two superseded Showdown games. These four
additional games are not extra independent matchups and are not included in the
primary win/loss totals. All 30 had zero illegal/rejected/failed/capped outcomes; there were **66 timeout
fallbacks** including the diagnostic runs.

Primary game runtime: **806.7 seconds**; all executions: **915.3 seconds**. These are summed benchmark simulation wall times, excluding process startup and time between runs.

All pairs used seed **20261107**, swapped deck seats with player one starting,
and used both Easy resource profiles with the shared production policy and an
explicit **eight-iteration work cap per world**. AI hero-power bonuses were off.
No production-strength or competitive win-rate claim follows from this sample.

| Deck                    | Existing opponent        | Wins | Losses | New deck cards played / included |
| ----------------------- | ------------------------ | ---: | -----: | -------------------------------: |
| Dragon Hand Ramp Druid  | hunter-face-burn         |    1 |      1 |                              3/5 |
| Original Libram Paladin | mage-mech-tempo          |    2 |      0 |                              6/6 |
| Showdown Giant Paladin  | warrior-justicar-control |    2 |      0 |                              5/7 |
| Glowfly Token Druid     | hunter-face-burn         |    0 |      2 |                              4/4 |
| Beast Swarm Hunter      | mage-mech-tempo          |    2 |      0 |                              4/4 |
| Secret Burn Mage        | warrior-justicar-control |    2 |      0 |                              5/6 |
| Shark Swarm Mech Mage   | hunter-face-burn         |    2 |      0 |                              6/6 |
| Charge Handbuff Paladin | mage-mech-tempo          |    2 |      0 |                              4/4 |
| Pirate Oil Rogue        | warrior-justicar-control |    0 |      2 |                              4/4 |
| Dragon Tempo Priest     | hunter-face-burn         |    1 |      1 |                              2/2 |
| Skipper Enrage Warrior  | mage-mech-tempo          |    1 |      1 |                              2/2 |
| Elemental Curve Shaman  | warrior-justicar-control |    1 |      1 |                              3/3 |
| Cube Demon Warlock      | hunter-face-burn         |    0 |      2 |                              1/5 |

### Search-budget fallbacks

The 61 timeout fallback actions represent **3.9% of 1569 non-forced action
decisions**, excluding mulligans, across both players. They occurred in Libram
(8), Showdown (8), Glowfly (6), Beast Swarm (18), Charge Handbuff (17) and Skipper
(4) pairings. Counts are for both sides, not only the named candidate. Other
pairings had none. No worker failed and no turn-budget violation was recorded.

These are the production coordinator's legal fallback actions when the remaining
search-time allowance is exhausted; the fixed iteration cap does not remove the
cumulative turn-time allowance. CPU contention and long multi-action turns can
influence this screen. Legal completion therefore does **not** imply every action
was fully searched or optimally chosen. Beast Swarm's pairing had a 15% fallback
rate, the highest in this sample.

### Actual card-play coverage

Across candidate actions, **48 of the 57 new collectible cards** were played.
This does not count simulations, cards only seen in hand, or opponent actions.
Card correctness comes from the dedicated effect scenarios, not from this coverage.

- **dragon-hand-ramp-druid**: played Breath of Dreams, Desert Nestmatron, Splish-Splash Whelp. Not played: Emerald Explorer, Dragon Golem.
- **original-libram-paladin**: played Aldor Attendant, Aldor Truthseeker, Libram of Hope, Libram of Justice, Libram of Wisdom, Crystology. Not played: none.
- **showdown-giant-paladin**: played Mother Duck, Busy-Bot, Gold Panner, Hi Ho Silverwing, Battleground Battlemaster. Not played: Prismatic Beam, Showdown!.
- **glowfly-token-druid**: played Glowfly Swarm, Lingering Zombie, Acornbearer, Dreamway Guardians. Not played: none.
- **beast-swarm-hunter**: played Scavenger's Ingenuity, Springpaw, Adorable Infestation, Awakening Tremors. Not played: none.
- **secret-burn-mage**: played Occult Conjurer, Ancient Mysteries, Arcane Flakmage, Cloud Prince, Flame Ward. Not played: Aluneth.
- **shark-swarm-mech-mage**: played Galvanizer, Mecharoo, Click-Clocker, Mecha-Shark, Seafloor Gateway, Security Automaton. Not played: none.
- **charge-handbuff-paladin**: played Crystology, Vicious Scalehide, Alliance Bannerman, Painter's Virtue. Not played: none.
- **pirate-oil-rogue**: played Prize Plunderer, Raiding Party, Cutting Class, Hench-Clan Thug. Not played: none.
- **dragon-tempo-priest**: played Duskbreaker, The Light! It Burns!. Not played: none.
- **skipper-enrage-warrior**: played Bomb Wrangler, Risky Skipper. Not played: none.
- **elemental-curve-shaman**: played Wailing Vapor, Canal Slogger, Granite Forgeborn. Not played: none.
- **cube-demon-warlock**: played Kobold Librarian. Not played: Possessed Lackey, Skull of the Man'ari, Voidlord, Lord Godfrey.

### Strategic limits and supporting probes

The separate `src/scenes/match/ai/shortlist-strategies.scenarios.ts` exercises
specific visible-board sequencing and lethal decisions rather than counting a
legal card play as strategic success. It includes the corrected Battlemaster
placement/four-attack lethal line. Consult its final test results for the exact
probe count and outcomes.

A Dragon-hand fixture can still play Faerie Dragon instead of ramping with
Splish-Splash Whelp. A hidden Mirror Entity lethal line can also be missed by the
current AI. These are known limitations, not concealed by the clean match totals.
Full-game losses for Glowfly/Pirate Oil do not by themselves prove a strategy bug;
likewise two wins do not prove strength. Aluneth fatigue, hand overflow, retained
Dragon resources, and other rare cautions are not exhaustively exercised by two
games per deck. No human interactivity/enjoyment assessment was performed.

### Evidence

`docs/shortlist-ai-results.json` contains compact per-deck outcomes, exact card IDs
played, new-card gaps, settings, runtime, source/deck fingerprints, and per-game
seats/actions/turns. Complete benchmark traces were retained outside the repository
as `shortlist-final-raw.json` and can be supplied separately. Individual source
fingerprints vary because test/source files were finalized in parallel. The
confirmed-fixed Showdown run replaces its earlier result; no AI policy patch was
introduced during this screen.
