# Early public-threat defensive search

This change builds on the five correctness fixes in PR #17 (base commit
`2601676cc0eb99ab7ed2a29256b8d320f9612b0e`). The defensive change is separately
reviewable. Newer main has additional gameplay and VFX changes; semantic
integration with those changes has not been validated by this experiment.

## Scope

Before allocating search resources, review the actual root pass in a closed,
public, attack-only model. When that pass has a legal lethal witness, seed existing
MCTS with exact immediate-defense-plus-End-Turn completions. Promote only genuinely
sampled, exactly bound surviving completions; preserve discovered own wins and
stronger broader-clear continuations. Preserve the selected exact continuation in
the consensus trace even when no narrow certificate remains. Stronger contrary
evidence for the same completion revokes its narrow preference.

The new review runs once per production decision and is shared across worlds. Its
elapsed time is deducted from the existing decision window. It has a cooperative
750 ms deadline and a 512-dispatch cap. No turn-budget, engine, GPU, or synthetic
visit changes are included. Existing post-selection safety review remains separate.

## Reproducible focused checks

Run `node scripts/run-early-threat-regressions.cjs` with the project's installed
dependencies. Durable source templates are retained under
`scripts/ai-regressions/early-public-threat`; the runner materializes tests only in
a temporary directory and cleans them afterward. The checks cover public proof
bounds/abstentions, own known protection, hidden-card/RNG neutrality, real search
integration, winning opportunities, consensus sequence binding, stronger contrary
evidence, and the sampled shortlist regression. No external evidence directory is
needed.

The shortlist control uses a test-only one-slot trace limit and real fixed-work
search. The selected broader-clear line has fewer visits than another root, with
no narrow certificate on any candidate. It verifies exact selected completion
retention through consensus. Production trace limits are unchanged.

## Recorded validation (18 October 2026)

- 41 focused proof/integration controls and two shortlist regressions passed before
  publication packaging.
- The relevant AI regression suite passed 503 of 506 tests. The same three
  singleton-cleanup failures reproduce on the clean PR #17 baseline; expected
  values were not changed to hide them.
- Node/web typechecks, changed-module lint/formatting and dependency checks passed
  during the experiment. Publication packaging checks are reported in the PR.
- A frozen 12-checkpoint paired panel spanning seven actor classes used real
  production world workers, alternating execution order, identical checkpoints
  and request identities, and the existing 60-second turn policy. All 12 pairs
  met their predeclared properties for both baseline and candidate. These are
  preservation results, not 12 improvements.
- Three opportunity-cost controls produced actual own wins: Hunter face attack,
  Rogue Preparation/two Eviscerates, and Mage Coin/two Fireballs. Nonthreat Mage
  retained Ice Block. Healing, taunt, freeze, removal, transformation, bounce and
  protective-secret controls met their scoped attack-reply conditions.
- On the natural later 4-mana failure, the previous frozen candidate survived both
  repeats where baseline died. After the shortlist correction, candidate again
  survived both natural checkpoints at 3 health with immunity; baseline died in
  that repeat. Earlier-checkpoint baseline survived other repeats, so its timed
  behavior is variable. Preservation of already-good behavior is the criterion,
  not strict improvement at every checkpoint.
- No illegal commands, controller timeouts or certificate-shape violations were
  recorded in the wider panel; source/game-rule hashes remained fixed.

## Limits and adverse evidence

The initial seed-only revision failed both natural checkpoints. A subsequent
narrow-certificate ordering revision displaced a better broader-clear Taunt line;
the generic proof-strength ordering was corrected rather than adding card-specific
exceptions. These failures informed the final design.

The certificate excludes enemy powers, card plays, future turns, unsupported
effects and alternate random outcomes. The independent engine reply oracle
enumerates legal attacks and their actual engine effects, but excludes powers,
card plays, future turns and alternate random outcomes. A known own protective
secret is recognized only through a closed effect grammar and actual engine replay.
A surviving witness alone is not proof of safety. Preferring known scoped survival
over an unknown continuation is a conservative policy choice: unknown does not
mean losing, and the policy can forfeit undiscovered combos or consume one-shot
resources. Discovered wins retain priority, but completeness is not established.

The authored Rogue draw prefix remained an open own turn. No unknown partial
candidate appeared in its retained measured traces, so that panel does not prove
universal partial-line classification. There is no general win-rate or quest-deck
mastery claim. Full application build/UI/artwork checks and complete repository
verification were not performed.

Recorded wider-panel early checks took 5.45–53.13 ms and 1–40 dispatches. Early
wins sometimes skipped diagnostics, so this is not comprehensive cost accounting.
Latest natural review peaked at 750.96 ms (0.96 ms cooperative overrun); the prior
maximum was 751.83 ms. Exhausted checks reviewed no defense lines. Individual
engine work can cross the deadline; it is not a hard wall-clock cap. Overall
controller measurements include artifact I/O and reply enumeration, not just AI
thinking time. Small timed panels cannot establish deterministic choices.
