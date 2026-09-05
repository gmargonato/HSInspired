I am developing an AI opponent for a Hearthstone-inspired card game.

The system already works. The game itself calculates the legal actions available to the AI, and an LLM evaluates those options and decides what to do. There is also a planning phase at the start of the match where the AI sees its own deck and tries to understand how that deck wants to play, followed by a mulligan decision.

The main problem is no longer basic gameplay. The AI can usually make reasonable immediate decisions. The goal now is to make it better at long-term strategy, sequencing, resource preservation, opponent interpretation, and planning across multiple turns.

An important requirement is that the AI should determine the strategy of its deck dynamically during the planning phase. Do not assume that decks have predefined or hard-coded archetypes or strategies. I frequently change cards, create new decks, or experiment with unusual combinations. The AI should inspect the actual deck it has been given and determine for itself how that particular deck is likely to win, which cards are important, which combinations matter, and what resources should be preserved.

The AI should maintain an understanding of its own strategy throughout the game. It should not forget the original plan simply because an individual action has good immediate value.

For example, if the AI determines that Frostbolt is an important part of a future burst-damage combination, it should understand that using Frostbolt to kill an ordinary minion may have a significant strategic cost, even if the immediate trade looks good.

The AI should think beyond the current board state. Hearthstone-style games involve understanding what happened previously, what both players are trying to accomplish, and what the current decisions may enable several turns later.

The AI should also build and continuously update an understanding of the human opponent.

It should consider observable actions from previous turns and try to infer things such as:

What type of game the opponent appears to be playing.

Whether the opponent is prioritizing aggression, control, card advantage, survival, tempo, combos, or another goal.

What important resources the opponent may be preserving.

What future threats may be developing.

Whether recent behavior changes the AI's previous assumptions about the opponent.

The AI must never have access to information that a real player would not know.

It must not know the opponent's hand.

It must not know hidden cards.

It must not know the exact identity of secrets that have not been revealed.

It must not know the opponent's remaining deck unless that information has legitimately become known during gameplay.

Hidden information is intentional and should remain part of the reasoning process.

The AI should reason using uncertainty rather than cheating.

For example, if the opponent has played a secret, the AI may consider which secrets are possible based on known game information. It may adapt its actions to reduce risk or test possibilities, but it should not behave as though it knows which secret is present.

The AI should also learn from information revealed during gameplay. If an action rules out a possible secret, reveals a card, produces a random result, or otherwise changes what is known, subsequent decisions should reflect that new information.

Action sequencing is very important.

The AI should understand that two turns containing the same actions can have very different quality depending on the order in which those actions are performed.

Information-generating actions should receive special consideration.

For example, drawing a card at the beginning of a turn may be significantly better than drawing the same card at the end of the turn because the newly drawn card may change the best available play.

The AI should recognize situations where deliberately triggering card draw, generating cards, testing hidden information, or resolving uncertain effects before committing important resources creates additional strategic value.

It should also recognize card synergies that involve multiple actions.

For example, playing Acolyte of Pain and intentionally damaging it may be better than treating the Acolyte and the damaging effect as unrelated actions.

The AI should evaluate complete lines of play rather than looking only at isolated actions whenever the situation requires it.

However, the LLM should not replace deterministic game logic.

The game engine should remain responsible for facts that can be calculated reliably, including legal actions, mana availability, valid targets, damage calculations, card effects, board state, lethal calculations, and other mechanical rules.

Do not rely on the LLM to guess calculations that the game can determine exactly.

The LLM's primary value should be strategic judgment, interpretation, prioritization, prediction, and evaluation.

The system currently has access to two models: GPT-5.4-nano and GPT-5.4-mini.

Response time is very important. A stronger AI is desirable, but gameplay cannot become noticeably slow after every ordinary action.

We therefore want to explore a balance between fast tactical reasoning and deeper strategic reasoning.

Not every decision deserves the same amount of computation.

Simple or obvious positions should remain fast.

Complicated, high-impact, strategically important, or uncertain situations may justify deeper reasoning.

Possible examples include turns involving lethal opportunities, possible opponent lethal, important combo pieces, major resource commitments, secrets, unusual synergies, difficult sequencing, card draw, random outcomes, or decisions where several options appear similarly strong.

The AI should also be capable of reconsidering its plan when meaningful new information appears.

The strategy created at the beginning of the match is not permanent. It is the AI's initial hypothesis about how its deck should play.

As the match develops, that strategy may need to change because of the opponent's deck, cards drawn, resources already spent, unexpected synergies, board state, life totals, or other circumstances.

At the same time, the AI should not change strategies impulsively every turn. There should be continuity unless there is a legitimate reason to adjust the plan.

The desired result is an opponent that appears to understand the match rather than simply selecting locally valuable actions.

The AI should reason about:

Its own likely win condition.

Its current plan.

Important cards and resources.

Resources that should be preserved.

Useful combinations and synergies.

Immediate tactical value.

Future value.

Card advantage.

Tempo.

Survival.

Potential lethal setups.

Action sequencing.

Information gained by drawing or revealing cards.

Hidden information and uncertainty.

The opponent's likely strategy.

Recent opponent behavior.

Possible future opponent threats.

How the current turn affects future turns.

Do not make the AI omniscient.

Do not hard-code deck strategies.

Do not assume standard archetypes are always being used.

Do not sacrifice important long-term resources simply because an immediate action appears efficient.

Do not treat actions independently when they form a meaningful sequence or combo.

Do not ask the language model to solve deterministic calculations that the game engine already knows.

Do not make every ordinary turn unnecessarily slow in pursuit of perfect play.

Do preserve uncertainty.

Do allow the AI to form hypotheses and update them.

Do allow the AI to recognize and preserve its own win condition.

Do consider the human player's strategy as well as the AI's strategy.

Do consider previous turns instead of evaluating every board state in isolation.

Do value information before commitment when appropriate.

Do allow deeper reasoning when the position is strategically important.

The overall goal is not to create a perfect Hearthstone engine.

The goal is to create an AI opponent that reacts quickly during normal gameplay but demonstrates believable strategic intelligence: it remembers what it is trying to accomplish, notices what the human player appears to be doing, preserves important resources, recognizes combinations, sequences actions intelligently, learns from revealed information, and plans beyond the current turn.

---

# Implementation status

Updated: September 4, 2026

The first strategic-AI implementation is now in place under the `strategic-v3` policy. The original requirements above remain the product intent; this section records what the current implementation actually does, what was deliberately deferred, and what should be improved next.

## Implemented

### Fair information boundary

- The AI observation contract has a single supported information policy: `fair`.
- The AI receives its own hand and original submitted deck list, but never its shuffled deck order.
- The opponent's hand is represented primarily by its public size. A card identity is included only when that exact card was legitimately revealed to the AI.
- Revealing an opponent card does not expose its private live cost, enchantments, or stable internal entity ID.
- Opposing deck order and unrevealed deck contents are removed from observations and search hashes.
- Facedown opposing Secrets expose only public facts such as controller, count, and class. Their card IDs are withheld until revealed.
- The AI still knows the identity of its own facedown Secrets.
- Pending opponent-only choices, private cost modifiers, hidden queued effects, effect traces, revisions, and similar authoritative metadata are excluded from fair search identity.
- Hidden-state invariance tests verify that changing an unseen opponent hand, deck, top-deck effect, or Secret does not change the AI's fair observation or deterministic search result.

### Dynamic deck planning

- Match strategy is created from the AI's actual submitted deck and authored card mechanics. There are no predefined deck names or hard-coded archetype assignments.
- The plan contains a free-form archetype description, primary and secondary win conditions, early/mid/late priorities, card roles, combos, resource rules, and mulligan priorities.
- Mechanical fallback planning recognizes damage, removal, draw, healing, armor, weapons, summons, tribal requirements, friendly-target requirements, and other authored effect relationships.
- Combo validation is duplicate-aware. A combo can require two copies of the same card when the deck actually contains two copies, but cannot claim more copies than exist.
- Independent combo packages receive independent preservation and release rules; completing one package does not release every unrelated reserved card.
- Generated plans are validated against the exact deck before being accepted.

### Persistent strategy and opponent interpretation

- `AiStrategicTracker` persists the initial plan throughout the match.
- It tracks observable card plays, attacks, resource use, posture, revealed threats, combo readiness, combo invalidation, and resource-release state.
- Opponent hypotheses are based only on public behavior and use descriptive postures such as aggression, control, tempo, card advantage, survival, or combo preparation rather than hard-coded deck labels.
- Strategy review is triggered only by meaningful public evidence. Reviews must cite an exact supplied reason when changing the plan.
- An unchanged review cannot silently replace the current plan.
- Opponent assessments persist between reviews instead of being regenerated from scratch every action.
- Secret beliefs maintain possible and ruled-out card IDs using the opponent's public class and observed trigger outcomes. Safe trigger deductions are supported, including cases where a Secret remains possible because its effect could not resolve.

### Deterministic tactics and sequencing

- Legal actions and all authoritative mechanics remain owned by the match engine.
- The local search evaluates complete current-turn lines rather than treating every action independently.
- Guaranteed lethal is proven by deterministic engine simulation and attached to the candidate as a tactical proof.
- Search recognizes meaningful multi-action sequences, including playing Acolyte of Pain and then deliberately damaging it to draw.
- Information-producing actions can terminate the current search segment. The live controller dispatches the action and plans again after the real result is known.
- Search never previews through an unknown draw, random result, opposing Secret, lethal Deathrattle with an unknown outcome, or another private-information boundary.
- End Turn stops at a public handoff representation instead of dispatching the opponent's hidden top card inside search.
- Public action intent is used at an uncertainty boundary so target choice, damage, minion bodies, armor, weapons, summons, and similar known consequences still matter without observing the hidden result.
- Information value favors drawing, generating, discovering, or testing a Secret before committing the rest of the turn's resources.
- Cards drawn by the opponent are not incorrectly counted as information gained by the AI.
- Guaranteed self-damage is assessed at an information boundary, including rejecting Life Tap when it would kill the AI and penalizing it when public opposing reach makes the health payment unsafe.
- The evaluator gives critical weight to publicly visible next-turn lethal and additional value to persistent board engines such as auras and repeatable triggers.
- Beam search prunes continuations by public action value before simulation. This allows a small node budget to reach later actions instead of being exhausted by engine enumeration order at depth one.
- Deep-search budget is allocated to the strongest fair baselines first rather than whichever legal action the engine happened to enumerate first.
- Search-cache keys include the strategic plan and fair public state so private changes cannot create hidden-information cache behavior.

### Uncertainty reporting

- Random-outcome samples and hidden-state determinizations are reported as zero because true belief-state sampling has not been implemented yet.
- Configuration values are never presented as completed samples.
- Candidates that stop at an information boundary are explicitly marked incomplete for downstream strategic judgment.
- Tactical proofs are not claimed for lines whose authoritative outcome was deliberately not observed.

### Adaptive decision pipeline

- `strategic-v3` is the default policy, with the previous policy retained as an explicit legacy fallback.
- Every legal root receives a cheap local baseline before deeper work begins.
- Decisions are classified as simple, normal, or complex using tactical risk, uncertainty, Secrets, information value, reserved resources, score proximity, and other strategic signals.
- Simple decisions can stay local and fast.
- Normal decisions send a bounded shortlist to one model-ranking pass.
- Complex decisions can use a larger shortlist followed by a critic pass over the best candidates.
- Routine End Turn actions alone do not make a position complex.
- Overall, local-search, provider, and dispatch-reserve deadlines prevent the AI from waiting indefinitely.
- The persistent strategic worker is created lazily, reused across decisions, and disposed with the board/controller lifecycle.

### Model and IPC boundary

- The active implementation is intentionally restricted to GPT-5.4-nano.
- Configuration and response metadata reject a deployment/model that is not GPT-5.4-nano.
- GPT-5.4-mini escalation was deliberately deferred rather than added implicitly.
- Azure Chat Completions requests use strict JSON Schema response formats, bounded output, reasoning effort, and runtime response validation.
- Rank and critic responses can select only supplied action IDs. Rank responses must provide a complete, duplicate-free ordering of the shortlist.
- Deck-plan, strategy-review, mulligan, discover, and turn request classes are validated independently. Invalid phase/class combinations are rejected before crossing IPC.
- Provider prompts receive only fair observations, visible card definitions, candidate dossiers, strategic memory, and a bounded event ledger.
- The event ledger is capped and includes explicit truncation metadata.

## Validation completed

- The focused nine-file AI suite passed with 68 tests and one intentional benchmark skip before the final tactical refinements.
- The final search, tactics, and benchmark regression set passed 24 tests with the long benchmark intentionally skipped in the ordinary test command.
- Both Node and renderer TypeScript projects passed type checking.
- ESLint passed.
- Dependency Cruiser reported no architecture violations.
- The production smoke build passed and emitted the renamed strategic worker correctly.
- `git diff --check` passed.
- A final 24-game fair, same-deck, seat-swapped benchmark smoke run passed the configured 65% gate after the beam-search correction.
- A 60-game run made before the final beam-search correction scored 60%. A new 60-game confirmation was stopped before completion because of runtime. The canonical 600-game benchmark has therefore not been validated against the final implementation and should not yet be treated as a proven strength claim.

## Deliberately deferred

- True belief-state construction and sampling for hidden hands, decks, Secrets, and random outcomes.
- GPT-5.4-mini escalation for selected high-impact positions.
- Authoritative multi-turn simulation across an unknown opponent draw.
- Full calibration against the canonical 600-game benchmark.

# Improvements discovered during implementation

These are ordered roughly by expected strategic value.

## 1. Add real belief-state sampling

Build legal hidden-state hypotheses from public evidence and sample from those hypotheses rather than the authoritative match state. Samples should respect:

- the opponent's class and submitted-mode deck rules;
- cards already played, revealed, discarded, transformed, or generated;
- hand and deck sizes;
- possible Secret identities and trigger deductions;
- known generation sources;
- copy limits where they legitimately apply.

Candidate scores should expose mean, downside, and worst-case values across actual samples. Only then should `determinizations` and `randomOutcomeSamples` become non-zero.

## 2. Build a public turn-start projection

Current search correctly stops before End Turn would consume a hidden top card. The tradeoff is that it cannot authoritatively simulate the opponent's next turn.

A useful next layer would advance only deterministic public turn mechanics:

- active-player handoff;
- mana growth and refresh;
- attack and hero-power refresh;
- overload and other already-public resource effects;
- deterministic start/end-of-turn effects whose inputs and outcomes are public.

The unknown draw and any effects depending on it would remain unresolved. This would allow better analysis of guaranteed board attacks and public counterplay without leaking the top card.

## 3. Improve expected-value models at information boundaries

The current public-intent evaluator covers common action shapes but is still heuristic. It should gain typed, mechanic-specific expected values for:

- random summons based on the legal candidate pool;
- Discover pools and class weighting;
- random damage distributions;
- discard distributions;
- jousts and deck-top comparisons;
- random transformations;
- Deathrattles that summon or generate random cards;
- symmetrical draw and generation effects;
- burn risk when drawing near the hand limit.

This work should use authored effect objects rather than regular-expression inspection wherever possible.

## 4. Replace heuristic synergy discovery with an effect dependency graph

The dynamic deck planner now finds useful mechanical relationships, but unusual custom cards will expose gaps. A typed dependency graph could connect producers and consumers such as:

- weapon creation to weapon buffs;
- token production to sacrifice or board-wide buffs;
- damage events to on-damage triggers;
- spell casting to spell-triggered engines;
- tribes to tribal payoffs;
- discard sources to discard payoffs;
- healing, armor, overload, Secrets, and Deathrattles to their payoffs;
- cost reduction to expensive finishers;
- duplicated combo pieces and interchangeable substitutes.

The graph should distinguish requirements, enablers, payoffs, replacements, and anti-synergies. This would make fallback planning substantially stronger for newly authored decks.

## 5. Make opponent hypotheses probabilistic

The tracker currently maintains descriptive postures and evidence. It could maintain a small probability distribution that changes after each public action.

Useful evidence includes passing with available mana, repeated face attacks, defensive trading, unusual card retention, symmetrical draw, resource hoarding, board commitment, revealed combo pieces, and deviations from previously observed priorities. The model should retain competing hypotheses when evidence is ambiguous instead of collapsing to one label.

## 6. Improve Secret reasoning and test sequencing

Secret tracking can currently rule out safe cases. It should eventually:

- weight possible Secrets rather than treating every remaining identity equally;
- recognize generated-versus-deck-origin Secrets;
- calculate the cost of each safe test order;
- preserve cheap test resources when a more dangerous Secret remains possible;
- update beliefs from partial resolution and non-resolution;
- evaluate the downside of triggering each possible Secret before committing a key resource.

## 7. Strengthen resource reservation

Resource rules currently support independent release states, but their opportunity-cost model is coarse. Improvements should include:

- reserving a required number of copies rather than just a card ID;
- valuing interchangeable combo substitutes;
- releasing only the portion of a package no longer needed;
- distinguishing soft preference from hard reservation;
- considering draw probability and remaining deck count;
- recognizing when waiting for a combo has become less valuable than immediate survival or tempo;
- recording why a resource was spent despite its reservation.

## 8. Extend multi-turn planning without pretending hidden information is known

After public turn-start projection and belief sampling exist, search can evaluate short strategic horizons such as setup, opponent response distribution, and payoff turn. This should remain shallow and selective. Good triggers include lethal setups, combo assembly, major resource commitments, board clears, fatigue transitions, and possible opponent lethal.

## 9. Add optional GPT-5.4-mini escalation

Nano-only operation is appropriate for the current stage. If mini is enabled later, it should be a narrow, measured escalation rather than a default second call.

Potential escalation criteria:

- verified lethal or survival branches disagree with the nano ranking;
- several top candidates remain very close after local search;
- a major reserved resource would be released;
- Secret or random-outcome downside is unusually large;
- a strategy review would materially replace the current win condition.

Latency, decision quality, and override rate should be recorded before making this permanent.

## 10. Move more search work off the renderer thread

The worker currently ranks serializable dossiers, while engine forks remain on the renderer side. A serializable domain snapshot or worker-safe match clone would allow complete search to run away from Pixi rendering. Until then, incremental slices should continue to yield frequently and reuse the transposition cache.

## 11. Expand evaluation beyond one aggregate win-rate gate

The seat-swapped benchmark is useful, but a single win-rate number is noisy and slow. Add deterministic scenario suites for:

- obvious and non-obvious lethal;
- preventing publicly visible opponent lethal;
- correct trade-versus-face decisions;
- draw-before-commitment ordering;
- Secret test ordering;
- combo preservation and justified release;
- fatigue and hand-burn decisions;
- board-engine removal;
- choosing among random-outcome risk profiles;
- invariance under changes to every hidden field.

Keep the 600-game benchmark as an occasional strength check, but use smaller fixed scenario suites as the fast regression gate. Record results per deck and seat because aggregate success can hide a weak matchup or first/second-player bias.

## 12. Add decision replay and calibration telemetry

For development builds, persist a compact replay containing the fair observation hash, plan version, candidate scores, selected line, model ranking, critic override, deadline use, fallback reason, uncertainty boundary, and eventual outcome. This would make it possible to answer whether poor play came from the engine evaluator, search coverage, strategic plan, model judgment, or timeout fallback.

Telemetry must never store fields that were excluded by the fair observation contract.

# Recommended next order

1. Add the public turn-start projection and deterministic tactical scenario suite.
2. Replace regex-based public-intent and synergy inspection with typed effect visitors.
3. Implement legal belief-state sampling and calibrate uncertainty scores.
4. Improve probabilistic opponent and Secret models.
5. Run and tune the canonical benchmark.
6. Evaluate GPT-5.4-mini escalation only after the local system is calibrated.
