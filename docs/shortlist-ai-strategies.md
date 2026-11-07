# Shortlist AI strategy probes

## Scope and reproduction

These are targeted turn decisions made by the real production `LocalAiDecisionApi`, not hand-written sequences. Fixtures use `createAiFixture`; the harness enumerates legal commands, asks the planner, dispatches only its chosen command, and repeats until turn end/victory (18-action safety cap). Rejected commands fail immediately. Full-game performance is a separate experiment documented in `shortlist-ai-evaluation.md`.

Run:

```sh
npx vitest run src/scenes/match/ai/shortlist-strategies.scenarios.ts --disableConsoleIntercept
```

Settings: expert resource profile, fixed `workBudget: 128` per decision, deterministic fixture seeds listed below, live authored card values, no hidden manually selected moves or AI-engine edits. Base revision `dce7fef` plus the shortlist implementation working tree. Fixed work measures the production policy at this search allowance, not the desktop's full wall-clock/worker-consensus budget. Unless overridden, AI has 10 mana, both heroes have 30 Health, opponent is Jaina, and the AI deck has six Wisps as controlled draw filler. Hand/board overrides and exact assertions live in the scenario file. Small controlled positions isolate ordering; they are not normal deck draws or win-rate estimates.

## Results

Final verification: 22 asserted tactical/sequence outcomes pass across all 13 decks, plus one explicitly unscored early-ramp diagnostic (23 cases total). All 23 cases pass together in the final full-suite run. Focused lint and web typecheck pass. No AI-policy changes were made.

The initial 20-probe run passed 17 outcomes and surfaced three apparent failures. One was an invalid synthetic weapon stat assumption: the fixture's raw Shadowblade attack override is normalized back to its live printed 3 by runtime recomputation. Correcting the fixture to printed Shadowblade and a 6-Health enemy preserved the intended attack-before-Flurry lethal oracle; the planner succeeds. Another was a debatable Whelp-versus-Faerie tempo/ramp choice, discussed below. The Battlemaster result exposed a confirmed runtime bug: granting Windfury did not immediately update the attack cap. A targeted runtime correction fixed that integration defect. Rerunning the unchanged lethal oracle now succeeds.

| Seed  | Deck / scenario                      | Actual selected line and result                                                                        | Assessment                                                          |
| ----- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 22272 | Dragon Ramp: mana refund             | Nestmatron → Twilight Drake at four mana; both developed                                               | Pass: spends refunded mana after the refund                         |
| 22273 | Dragon Ramp: early ramp preference   | See diagnostic below                                                                                   | Diagnostic, not a tactical pass/fail                                |
| 22274 | Dragon Ramp: capped ramp             | Nourish choice 1 (draw) → three drawn Wisps; also uses hero power/attack                               | Pass: chooses refill at ten maximum mana                            |
| 22275 | Libram: Justice + Consecration       | Justice → Consecration → weapon attack; all three Ogres removed                                        | Pass: health-setting before damage                                  |
| 22276 | Libram: Pyromancer reset             | Pyromancer → Justice → weapon attack; three Ogres removed, Pyromancer survives at 1 Health             | Pass: post-spell trigger ordering at seven mana                     |
| 22277 | Libram: persistent discount          | Attendant → Hope targeting own hero; 4→12 Health, shielded 8/8 Taunt                                   | Pass: discount enables both cards within nine mana                  |
| 22278 | Showdown: dynamic costs              | Showdown → Sea Giant → Prismatic Beam; three friendly Outlaws plus Giant, no enemy tokens              | Pass: Giant before clearing the discount providers                  |
| 22279 | Showdown: adjacent Windfury lethal   | After runtime fix: Battlemaster position 1 between two ready Giants → four face attacks; opponent dies | Pass after runtime fix; strict lethal assertion unchanged           |
| 22280 | Showdown: discounted removal         | Beam clears four Raptors for three mana                                                                | Pass: uses current enemy-count discount                             |
| 22281 | Glowfly Token                        | Swarm → Lotus; three 3/3 Glowflies                                                                     | Pass: preserves spell count, then buffs summons                     |
| 22282 | Beast Swarm                          | Ingenuity → drawn Springpaw, developed as 4/4                                                          | Pass: tutor and handbuff payoff                                     |
| 22283 | Secret Burn: Flakmage                | Flakmage → Counterspell; three Raptors removed                                                         | Pass: listener precedes secret                                      |
| 22284 | Mech Swarm: Shark                    | Shark → Mecharoo → Clockwork Gnome; six damage kills enemy hero                                        | Pass: trigger engine before Mechs                                   |
| 22285 | Mech Swarm: discount                 | Galvanizer → Security Automaton → Mecharoo at three mana                                               | Pass: discount unlocks all three and Automaton sees the last summon |
| 22286 | Charge Handbuff                      | Smuggler's Run → Chillblade Champion → face attack for four                                            | Pass: handbuff before Charge lethal                                 |
| 22287 | Pirate Oil                           | Shadowblade face attack for three → legacy Blade Flurry for three                                      | Pass: attack before destroying weapon, lethal at six Health         |
| 22288 | Dragon Tempo Priest                  | Activated Duskbreaker; three Raptors removed, Azure Drake retained                                     | Pass: conditional reset with Dragon in hand                         |
| 22289 | Skipper Enrage: burst                | Grommash → Inner Rage targeting Grommash → face for twelve                                             | Pass: enrage activation before Charge lethal                        |
| 22290 | Elemental Curve                      | Granite Forgeborn → Tar Creeper at six mana                                                            | Pass: discount before development                                   |
| 22291 | Skipper Enrage: damage engine        | Skipper → Bomb Wrangler; Wisp dies and Wrangler produces Boom Bot                                      | Pass: play-trigger ordering                                         |
| 22292 | Secret Burn: fatigue safety          | Hero power face → pass, retains Aluneth at 5 Health with empty deck                                    | Pass: avoids three lethal fatigue draws                             |
| 22293 | Cube Demon                           | Lackey attacks face → Dark Pact on Lackey → recruited Voidlord; heals 4→12                             | Pass: gets attack value before sacrifice, cheats defensive Demon    |
| 22294 | Dragon Ramp: Golem hand preservation | Dragon Golem → Faerie Dragon; three 3/4 Golems remain                                                  | Pass: counts both held Dragons before spending the cheap Dragon     |

## Early Dragon ramp diagnostic

Original seed 22273: empty boards, two available/maximum mana, hand Whelp + Faerie Dragon, 30 Health each, only low-cost filler in deck. The planner played Faerie Dragon and passed, keeping Whelp. This misses the requested ramp plan but is not proof of bad play: a 3/2 is a stronger immediate body than a 2/1, and this artificial hand had no expensive payoff. The original hard Whelp preference assertion was removed as an unjustified tactical oracle, not relaxed to count this choice as strategic success. The durable diagnostic includes Azure Drake and Emerald Explorer in hand. It still chooses Faerie Dragon and passes, keeping Whelp plus both expensive Dragons. This is recorded as a possible short-horizon ramp weakness, not declared an objectively losing move or counted as strategic success.

## Limits and remaining coverage

These probes demonstrate concrete tactical competence for all 13 shells, not mastery of all their plans, mulligans, or matchups. In particular they do not establish long-horizon Dragon preservation, repeated free-Wisdom recycling, Libram overdraw management, safe Showdown use without follow-up, Mother Duck board-space planning, next-turn Elemental reservation/Overload planning, broad Cube/Grave target valuation or resurrection-pool management. Those need additional tailored states or full-game replay review. Most scenarios intentionally have only a few relevant choices and one seed. Random trigger results are seeded; broader stochastic robustness is not established. No win rate should be inferred from this pass count.

## Hidden-information production probes

`shortlist-hidden-tactics.scenarios.ts` runs the production `ExpertAiDecisionApi`, worker decision aggregation, and real fair-world evaluator with the live catalog. Each world receives 256 deterministic work units. The injected parent clock and enlarged worker timeout accommodate serial headless execution; this is not a production latency measurement. Every decision must leave the full live checkpoint unchanged, select an enumerated legal action, and dispatch successfully.

- **Healing Wave, seed 0xde0120:** with an actually concealed singleton Crocolisk opposite an own Ogre, production consensus chooses self-healing and ends at 17 Health against ten visible attack. The scored probe requires health above that damage and no opponent win. It does not assert that the concealed Joust outcome is knowable.
- **Counterspell, seed 0xde0144:** production consensus plays Ragnaros and ends turn for lethal against the actual concealed Counterspell. This is a scored outcome in this seeded position, not a guarantee against every possible Secret.
- **Mirror Entity, seed 0xde0144:** explicitly **unscored assessment**. The observed production line plays Ragnaros first, pings the opposing copied Ragnaros, develops Tinyfin, then ends turn. Ragnaros kills the enemy copy rather than the enemy hero: opponent remains at 8 Health; own hero remains at 20 with Ragnaros and Tinyfin. Tinyfin-first could bait Mirror Entity and allow a winning follow-up, so hidden-secret robustness remains a gap. The probe asserts legality, turn completion, and checkpoint immutability only, and emits the actual line when `LOCAL_AI_ARTIFACT_TRACE=1`. Its passing test status is not a strategic success or win.

The older single-world artifact tests now describe knowledge truthfully: DEV-120 explicitly reveals the singleton deck identity to justify its guaranteed-Joust survival oracle; DEV-144 explicitly uses known/revealed Secrets to test sequencing and retains its strict win oracle. Neither corrected fixture measures unknown-secret or unknown-deck robustness. No production AI policy or authored card balance was changed to obtain these results.
