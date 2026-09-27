# HSInspired

A Hearthstone-inspired card game shell built with Electron, TypeScript, and PixiJS.

---

## 1. Quick Start

### Prerequisites

- Node.js (v20+ recommended)
- npm

### Installation & Run

```bash
# Install dependencies
npm install

# Start the game in development mode (starts at Main Menu)
npm run dev

# Launch directly into the development Card Inspector
VITE_DEV_START_ROUTE=card-inspector npm run dev
```

In development, **F3** toggles GPU filters, animated outlines, and board shadows
for visual comparisons. Press F3 again to restore effects; reloading starts with
effects on. Sprite animations and gameplay continue while effects are off.

In development, **Alt → Scenes → Hero Power Anim** opens a visual practice board.
Choose any catalog power in the sidebar, click a valid hero or minion target, and
use **Play / Replay** or **Loop**. Powers without a custom animation are labeled
**Not implemented yet**. The preview reuses match effects with fixed, damaged
heroes and minions; it does not run a match or change saved data.

Selecting Lesser Heal or Heal starts the Priest sunlight loop while choosing a
target. **Play / Replay** confirms the power, showing its flip and sunlight fade.
In matches, the same sunlight begins when hero-power targeting opens and stops on
cancellation; confirmation carries it through the flip. Basic and upgraded powers
share their animations.

---

## 2. Key Commands & Verification

Before committing or submitting changes, run the full verification pipeline:

```bash
npm run verify
```

Individual focused commands:

- `npm run dev` — Run Electron app in development mode.
- `npm run perf:match` — Run the automated in-app match performance benchmark and write `artifacts/match-performance/latest.json`.
- `npm run typecheck` — Run TypeScript checks across node and web contexts.
- `npm run deps:check` — Validate architectural boundaries and dependency rules.
- `npm run lint` — Lint code with ESLint.
- `npm run format:check` — Check code formatting with Prettier (`npm run format` to fix).
- `npm run build:smoke` — Verify production build and check for development marker leaks.
- `npm run test:local-ai` — Run the deterministic local-AI tactical and turn-planning scenarios plus seeded protocol checks.
- `npm run analyze:ai-corpus` — Recalculate local-AI calibration statistics from every archived match log.
- `npm run architecture:map`: Generate the code health atlas, audit report, and complete relationship evidence at `artifacts/architecture/`.
- `npm run architecture:check`: Check the architecture analyzer against isolated fixtures without launching the app.

---

## Build-a-Beast

Deathstalker Rexxar's Hero Power crafts a Zombeast through two consecutive
three-card choices. The pools use collectible Hunter and neutral Beasts costing
at most 5 mana from the existing catalog: an effect-bearing first component and
a keyword-only or vanilla second component. Authored balance values are preserved.
The result combines both cards' base stats and abilities and uses the first
Beast's artwork. Only the finished card enters the hand.

Pool eligibility and composition live in `src/game/content/cards/zombeast.ts`.
Ordered component IDs identify the recipe across checkpoints and AI workers.
The catalog resolves these noncollectible recipes by ID but excludes them from
its enumerable card pool, preventing unrelated random effects from generating
Zombeasts. Combined stats are intrinsic and survive silence.

## Dynamic match decks

Both match decks display one shared-texture `deck-sliced.png` sprite per remaining
card. Four-card groups share small, deterministic height offsets; groups farther
to the right are more likely to shift. The exposed face stays aligned with card
draws, and an empty deck retains the existing fatigue artwork. Decks above 30 cards
compress their spacing to fit the same board slot.

The original `deck.png` implementation remains available. Set `mode` to `'static'`
in `src/renderer/features/game/deck-stack-layout.ts` to restore it, or launch a
temporary comparison from PowerShell:

```powershell
$env:VITE_MATCH_DECK_MODE = 'static'
npm.cmd run dev
Remove-Item Env:VITE_MATCH_DECK_MODE
```

The same layout module controls card gaps, group size, height variation, and tint.
Stack geometry updates only when the count changes; there are no per-card filters
or continuously updated perspective meshes.

## Match hand and drag performance

Held cards follow the latest pointer position in the match render frame, before
shadows are updated. Pickup settling, scale, tilt, and return animation retain
their existing tuning. Two prepared card presentations are retained for reuse;
hover preparation waits for the pointer to pause for 120 ms to avoid allocation churn
during hand sweeps. Hover enlargement and actual pickup do not wait for that
preparation delay. The production frame cap remains 60 FPS.

`npm run perf:match` launches an isolated development match and drives real browser
mouse input through Electron's debugging protocol. It checks normal and premium
hands of 1, 4, 7, and 10 mixed cards, continuous hover sweeps and dragging, targeted
spell cancellation, and a full board with the deck tracker. Each sustained case
runs three 10-second samples; cold/warm pickups, 100 pickup/return cycles, restart,
and disposal are recorded separately. Allow several minutes for the full run.

```bash
npm run perf:match -- --smoke --label smoke --no-fail
npm run perf:match -- --label baseline --no-fail
npm run perf:match -- --label optimized
```

The smoke preset uses 1-second samples, one repetition, 1/10-card hands, and five
pickup cycles. It verifies the harness, not full performance acceptance. Override
individual settings with `--sample-ms`, `--repetitions`, `--cycles`, `--hand-sizes`,
or `--port`. Card auras now animate live; the former baked outline mode is retired.
Named JSON reports and a full-state screenshot are saved under
`artifacts/match-performance`; distinct labels preserve before/after captures.
Short uncapped idle/full-hand diagnostics temporarily remove the frame cap and
restore it afterward; they are reported separately from acceptance gates.

Reports separate frame submission intervals, CPU update/render work, pointer
dispatch, pointer arrival cadence, receipt-to-submission latency, following error,
and generated-texture lifetime counts. Submission is not physical display time:
these measurements do not establish input-to-photon latency. Texture counters
cover `renderer.generateTexture`, not every GPU allocation. Heap snapshots alone
do not establish a leak. Compare matching viewport, display refresh, resolution,
and scenario settings, all included in the report.
Cold pickup means the first pickup after rebuilding a hand; its measured action
includes 50 ms of preparatory hover and does not guarantee an uncached GPU/program.
Postrender telemetry contributes to cadence but is outside the reported CPU span.

The initial 60 FPS targets are frame p95 ≤18.5 ms, p99 ≤25 ms, frames over 33.4 ms
≤0.1%, CPU p95 ≤8 ms, and pointer receipt-to-submission p95 ≤20 ms/p99 ≤33.4 ms.
Only sustained cases use these performance gates; pickup and lifecycle scenarios
also verify that actual input reaches the intended interaction. `--no-fail`
preserves a report when performance targets fail; setup/input errors still fail.

The runner creates a temporary profile and log directory, removed after shutdown.
It uses a deterministic local mulligan fixture and never invokes an external AI
provider. Saved decks, progression, and normal match logs remain isolated. Launch
through this script: directly setting `VITE_DEV_START_ROUTE=match-performance`
without the isolated runner is rejected before repositories initialize.
Benchmark-only Chromium switches preserve foreground scheduling if another
window covers the test, and the test window requests focus once. Normal launches
retain their existing scheduling. GPU information is captured from the browser
after renderer initialization, alongside the display's refresh rate.

## Local hardware AI

Main-menu Settings offers Easy, Expert, and API AI modes. Expert is the deeper
local search profile: it keeps the existing engine-backed planner and
extends it with a wider, deeper search over class-legal hypotheses for concealed
opponent cards. Its fair planning snapshot also randomizes both players'
remaining deck orders, retaining the Expert's known deck composition but never
the live next-card sequence. Expert detects lethal from cumulative visible
attacks and simulates bounded engine-legal opponent replies, including sampled
card plays, public attacks, and hero powers. It runs in a dedicated worker and
never sends game state to a provider. Its cumulative search budget is capped at
24.5 seconds within the 30-second total-turn target, leaving 5 seconds for
presentation and 0.5 seconds for dispatch. The initial plan runs up to three
world searches concurrently, each limited to 18 seconds. This targets at most
about 20 seconds of visible waiting after presentation while preserving a
1.5-second reserve for a later replan. These are configured targets, not
measured runtime guarantees.
API mode continues using remote deliberation.

Run the seeded, mirrored Easy-versus-Expert headless match benchmark with:

    npm run benchmark:local-ai -- --games 2 --seed 1279734066 --max-actions 300 --turn-budget-ms 10000

Run focused local AI checks with npm run test:local-ai; archived-match analysis
remains available through npm run analyze:ai-corpus.

## Arcane Dust and premium cards

Constructed and Arena victories award 25 Arcane Dust. Tavern Brawl, defeats,
draws, and developer-forced results award none. The victory screen displays the
reward after it is saved, with a retry action if saving fails.

Right-click a card in Collection to upgrade all its copies, including those in
existing decks. Free/Common cards cost 50 dust, Rare 100, Epic 150, and Legendary 200. Disenchant restores normal appearance and refunds the original purchase
price. Normal cards are never removed from the collection.

Premium ownership applies to the player's cards in every mode. Generated cards
inherit their source's appearance; uncollectible cards cannot be purchased
separately. Existing card instances retain their appearance when control changes.
The development premium toggle remains a visual override and grants no ownership.

The Alt menu's **Options → Premium** offers **Unlocked**, **All Cards**,
**Local Player Only**, and **Remote Player Only**. Unlocked uses normal purchased
and inherited appearances. Player-specific overrides force premiums for that
player while preserving the other player's normal appearance. Local also applies
to Collection, deck building, and Arena drafting; Remote affects matches only.
These settings last for the current session. Existing instances keep their
original owner's appearance scope when control changes.

A fully premium original deck also gives its player a premium Coin. This is
checked against the deck entering the match; cards generated later do not change
eligibility. Hero cards cannot be upgraded until they have a premium format.
Unsupported visual forms always use normal artwork: for example, premium Sir
Finley keeps his premium minion appearance, while his hero-power choices and the
replacement hero power remain normal. Powers with no premium format create normal
tokens unless the generated card identity has its own purchased upgrade.

Collection upgrades and disenchanting save first, then flip the preview card and
assemble mana, paired combat stats, name, and rarity in distinct stages. Rules,
type labels, and legendary decoration remain on the revealed base. Closing the
preview skips the remaining animation without undoing a saved purchase or refund.
Pieces rotate into place with short cyan spark trails and landing bursts. Each
stage gives the collection and preview a brief shared shake; paired stats share
one impact. Particles reuse a capped pool of 100 sprites with no blur filters or
individual particle tweens. Motion, particle, and shake settings live in
`src/renderer/features/card-preview/card-assembly-layout.ts`.

In development, press Alt and open **Options → Arcane Dust** to set a preset
balance or enter a custom non-negative integer. This changes the saved balance
without changing wins or premium purchases. The setter is disabled in production.

Dust, purchase prices, and match reward receipts are saved alongside win totals
in `player-stats.json` under Electron's `userData` directory. Older saves start
with zero dust and retain their statistics. Economy values are centralized in
`src/game/progression/arcane-dust.ts`: change `WIN_DUST_REWARD` for both rewarded
modes and `PREMIUM_UPGRADE_COSTS` for prices. Existing purchases retain their
original refund amounts. Supported formats are listed in
`src/game/progression/premium-support.ts` and shared by purchases and card rendering.

## Arena run rewards

In development, **Options → Arena** is available only on the Arena screen.
**Retire** uses the normal confirmation and rewards flow. After drafting,
**Set Wins** (0–12) and **Set Losses** (0–3) save and refresh the run immediately.
Score editing preserves draws and does not award match dust or account wins.
The edited score determines normal retirement rewards. Completed runs can be
reopened by lowering their scores before claiming rewards; score editing is
disabled while rewards are pending or displayed.

Click Retire to finish an Arena run, including at 12 wins. Keys are display-only.
Unfinished runs ask for confirmation;
completed runs claim immediately. Unplayed runs reset without prizes. After at least
one recorded match, wins determine 1–5 boxes containing Arcane Dust or an unowned
non-Hero premium card. Existing 25-dust victory rewards remain separate.

Rewards are credited before the boxes appear. Opening a box only reveals its prize;
Confirm can skip unopened boxes and returns to hero selection. Interrupted claims
recover at startup, and unacknowledged rewards reappear when entering Arena. Saved
run receipts prevent duplicate credits. Premium prizes apply to all copies and
disenchant for their upgrade value at the time they were awarded.

Tune box counts, dust ranges, premium probabilities, and rarity weights in
`src/game/arena/arena-rewards.ts`. Exhausted premium rarity pools become dust prizes.

## Gameplay: Stealth and Elusive

- **Stealth:** Opponents cannot choose this minion for attacks, spells, Hero Powers,
  or targeted minion abilities. Its owner can still target it. Stealth ends when
  the minion attacks; taking damage or dealing damage through an ability does not
  reveal it. Taunt does not restrict enemy attacks while its minion is in Stealth.
- **Elusive:** Neither player can choose this minion for spells or Hero Powers,
  including friendly buffs and healing. Attacks and targeted minion abilities are
  allowed. Elusive is not consumed by attacking or taking damage.
- Both remain vulnerable to area effects and random damage or destruction.
  Divine Shield and Immune still prevent damage normally. Random attack
  redirection can hit Stealth even though the player cannot choose it directly.
- Conceal and Master of Disguise grant Stealth until the start of your next turn,
  unless the minion attacks first. Aura-granted Elusive lasts while the aura
  applies. Silence removes abilities, but a chosen silence must first obey
  targeting restrictions; an external aura can still apply to a silenced minion.
- Board markers show active abilities. Keyword explanations and a remaining-duration
  display are not currently provided by the card hover UI.

These rules follow [Blizzard's Stealth damage update](https://hearthstone.blizzard.com/en-gb/news/21694420),
the [Elusive board-clear clarification](https://hearthstone.blizzard.com/en-us/cards/59601-robes-of-protection/),
and [current Master of Disguise text](https://hearthstone.blizzard.com/en-us/cards/887-master-of-disguise/).
The internal `spell-immune` keyword means Elusive, not immunity to spell damage.

## Damage and trigger timing

Secret reveals play in sequence: the cropped banner grows and pauses, its badge
count decreases as the banner disappears, then the revealed card grows from the
badge to the center and fades before its effect appears. The sequence takes 1.6
seconds; tune it in `game-presentation-timing.ts` and `secret-layout.ts` under
`src/renderer/features/game`. Multiple Secrets reveal and resolve individually.

The deterministic engine still calculates synchronously. Internal playback
snapshots hold the visible board and controls at the appropriate resolution step;
they are excluded from public/AI event projections and match logs. Minion entrance
events capture the original body before Battlecry or Secret effects change it.
Potion of Polymorph resolves after Battlecry (including C'Thun's damage), and
transformation does not trigger Deathrattle. Existing death-trigger play ordering
and Secret reveal listeners retain their rule timing.

The engine applies an ordinary area-damage step to its captured targets before
resolving damage triggers. Combat uses the same boundary for attack and retaliation.
Damage reactions finish before the next sequential step; ordinary deaths wait until
the enclosing effect phase finishes. Nested triggers do not open their own death
checkpoint. Resurrection and separate automatically cast spells retain explicit
intermediate death checkpoints.

Card action arrays remain sequential. Use `damage-group` with an `actions` array
of single-hit `damage` actions when different amounts or selectors belong to one
damage step (Swipe and Explosive Shot). Normal `damage` actions already group all
their targets. Repeated hits resolve reactions and select random targets between
hits. `damageResolution: "per-target"` captures the target list but resolves each
target's damage separately, as authored for Lightbomb, Lightning Storm and Elemental
Destruction. `damageOrder: "reverse-play-order"` describes Swipe's splash ordering.

These boundaries follow the documented [damage rules](https://hearthstone.wiki.gg/wiki/Damage-related)
and [resolution phases](https://hearthstone.wiki.gg/wiki/Advanced_rulebook).

## 3. Architecture & AI Agent Instructions

All architectural boundaries, file naming standards, layout contracts, asset pipelines, and engineering invariants are documented in **[AGENTS.md](AGENTS.md)**.

The visual maps and their generation workflow are documented in **[docs/architecture](docs/architecture/README.md)**.

## Constructed AI opponents

Constructed matches generate a fresh opponent locally with normal 30-card class and
copy limits. All nine classes are available, and the human deck never participates
in generation. Only midrange-tempo is enabled; aggro/control remain commented-out
extension points in the strategy registry.

Generator version 10 selects uniformly from 27 class archetypes, three per class.
Each deck includes a legal class Hero card when available, a small defining core,
and random fill from the live catalog. Quests enter only through quest archetype
cores. Missing Hero candidates produce a diagnostic warning.

Core insertion honors each slot's configured count. Mechwarper, Flamewaker,
Voidcaller and Grim Patron have two guaranteed copies in their respective
archetypes. All other core entries start with one copy; eligible nonlegendary
cards can receive a second copy through random fill. Every core copy occupies
one of the 30 slots and appears separately in the construction trace.

Plain minions with no structured effects, keywords or positive Spell Damage are
excluded, even when explicitly rated or carrying a tribe. War Golem and Boulderfist
Ogre cannot enter generated decks. Runtime support and existing exclusions for
problematic cards still apply.

Filler needs quality 3 or higher. Explicit ratings take precedence, with no minimum
clamp. Automatic scoring considers body efficiency, interaction, resources and
beneficial effects, capped at 4. Immediate benefits and unconditional Deathrattles
on minions with attack receive full credit; conditional or delayed benefits receive
half credit. Deathrattle itself earns no bonus, so a drawing Deathrattle is counted
once. Weak bodies and effects that help the opponent lose points. Stormpike
Commando and Wind-up Burglebot are explicitly rated below the filler threshold.
Delayed/conditional draw cannot satisfy the reliable-resource minimum, and decks
need at least six credible early board plays in addition to their cheap-card bounds.
These are conservative estimates, not measured win rates.

Known synergy requirements are checked against the completed deck, including core
cards. Dragon hand payoffs need five other Dragons; the covered Mech, Pirate,
Murloc and Beast payoffs need five supporting minions. Secret payoffs need four
Secrets. Eggs need three attack-buff or useful sacrifice cards. C'Thun payoffs need
six cultists, and cultists require C'Thun. Mech and Mechanical catalog tribes share
one support tag. Spell engines and Recruit payoffs also have explicit support
minimums in `opponent-support.ts`. Requirements count real copies, exclude the
payoff itself, and never infer support from an archetype name.

After assembly, unsupported filler is replaced using seeded weighted choices;
fixed core cards receive supporting replacements in other slots. Every replacement
preserves class/copy legality and composition bounds and reduces missing support.
Repair is bounded to 60 swaps, with up to eight assembly attempts for the same
archetype. Failure is explicit; no quality or support requirement is relaxed.

Selection satisfies the first unmet composition minimum in declared order, then
fills flexible slots, enforcing composition maxima and copy limits. Every eligible
candidate retains a chance: weight is quality cubed, multiplied by 2 for class
cards, 1.5 for an archetype tag match and 1.5 when adding a second copy. There is no
fixed best-card shortlist or guaranteed legendary beyond deliberate core/Hero
inclusions. Failed assembly reports an error without relaxing quality requirements.

Generated decks remain match-local snapshots. Restart retains the same decks with
a new match seed; another match generates another opponent. The development
`VITE_DEV_AI_DECK_ID` saved-deck override is preserved. Arena and Tavern Brawl retain
their own opponent rules. The AI receives the selected archetype's plan
and mulligan guidance in its existing context, without extra provider calls.

`ai.json` retains generator version, seed, exact cards, core, archetype, diagnostics
and the construction trace under `generatedOpponent`. Filler selection reasons
include quality and whether the rating is explicit or automatic. Generation is
deterministic for the same seed, explicit options, catalog and generator version;
version 10 changes the decks produced by earlier versions for the same seed.
The construction trace records replacements, their reasons and quality ratings;
the exact final card map is authoritative when an earlier selection was replaced.

Tune archetypes in `src/game/decks/opponent-archetypes.ts`, composition limits in
`opponent-floors.ts`, explicit ratings in `opponent-card-ratings.ts`, structural
scoring in `opponent-curated-assessment.ts`, admission in `opponent-fill-pool.ts`,
and selection in `opponent-generator.ts`.
Maintaining the human's saved decks requires no opponent documentation.

The [dynamic generation review](docs/dynamic-opponent-review.md), earlier
[27-deck review](docs/curated-opponent-review.md) and
[exact generated decks](docs/curated-opponent-decks.json) are historical.
Construction checks establish eligibility and legality; competitive strength and
AI sequencing still need match playtesting.

## Game AI diagnostics

AI decisions start from resolved engine state while the preceding action's animations
finish, and the first think of each AI turn also begins during turn-start visuals
(hero-power flip and draw). Execution still waits for presentation idle and checks
the current revision and legality. Pending choices use the existing sequential path.
Planning, challenges, inspection budgets, prompts, and animation pacing are unchanged.
Position-only commit intent mismatches are normalized locally from the selected action
ID so they do not trigger a format-repair call. The same normalization also accepts
extra or out-of-order targets when type, source and option already match the selected
command; missing required targets or source/option mismatches still repair. When the
only non-pass legal command is unique, the controller executes it without a provider
call (`source: forced`). Opening mulligan uses a dedicated
`mulligan` phase with a slim hand-only snapshot and a replace-list response
(`choice.replace`) instead of enumerating every legal keep/replace combination.
Mulligan thinking still starts at scene mount while the local deal runs; `decision-timing`
now records turn 0 overlap and visible wait after local confirmation.

OpenRouter requests use the AI match ID as `session_id` for provider cache affinity;
Azure OpenAI uses the same match ID as `prompt_cache_key`. Both are gated by
`HSINSPIRED_AI_SESSION_AFFINITY` (set to `0` for baseline captures). This does not
guarantee cache hits or change the model-facing conversation/schema. Provider fallback
remains enabled; no explicit cache storage is requested.

Run `node scripts/summarize-ai-telemetry.cjs [match-directory-or-ai.json]` for a
read-only timing/cache summary (default: `artifacts/match-logs`). Save baseline and
optimized captures separately for comparison. `decision-timing` records total
decision time, overlap with presentation/pacing, and waiting after presentation.
Raw provider usage remains in `ai.json`; absent cache counters mean unknown, not
zero. An empty artifacts directory produces an empty summary until matches are
played. Progress and timing diagnostics remain hidden from the console.

For baseline comparisons, set `$env:VITE_AI_OVERLAP = '0'` and
`$env:HSINSPIRED_AI_SESSION_AFFINITY = '0'` before starting the app. Remove either
variable to enable that optimization again (restart required). These switches
only control scheduling and routing; they do not change decision instructions.

AI providers are configured as the ordered `providers` array in `config/ai.json`.
The first entry whose `enabled` field is `true` handles each decision; later enabled
entries are ignored. Disable every entry to turn off external AI. OpenRouter profiles
share `config/openrouter-key.local.txt`, so switching models only requires changing
`modelId` (or enabling a different OpenRouter entry). Azure continues to use
`config/ai-key.local.txt`. The provider-specific environment variables are
`HSINSPIRED_OPENROUTER_API_KEY` and `HSINSPIRED_AZURE_OPENAI_API_KEY`; the existing
`HSINSPIRED_AI_API_KEY` remains a fallback for either provider.

Each profile configures `reasoningEffort` (`none`, `low`, `medium`, `high`, or
`xhigh`) and `maxCompletionTokens`. OpenRouter models must support structured JSON
outputs, reasoning effort, and the configured completion limit. Configuration is
read again for every decision, so the application does not need to be restarted
after changing the selected profile or model.

Optional per-profile safeguards are `requestTimeoutMs` (default 45,000; range
1,000–600,000) and `maxContextBytes` (default 200,000; range 1,000–200,000).
The deadline covers each provider HTTP call, including slow/trickling response
bodies. A timeout selects one current legal input at random instead of retrying
the provider or pausing. The normal engine dispatch and stale-state checks still
apply. Logs label it `random-timeout`, not a model decision; subsequent decisions
use the provider again. Timeouts do not trigger format repair.
Context bytes are a payload-size budget, not a model token-window guarantee.
When selecting a smaller-context model, lower the input byte budget and completion
token limit appropriately. Current facts are never silently truncated to fit.

Match recording keeps `match.txt` and compact `ai.json` diagnostics by default.
To additionally record complete request payloads in `decisions.jsonl`, set
`$env:HSINSPIRED_AI_FULL_TRANSCRIPT = '1'` in PowerShell before launching the app.
Remove that environment variable to return to compact logging. Existing logs are preserved.

Conversation history retains recent chronological events, plans, factual exchanges,
and decisions; only the latest decision contains current board state and legal inputs.
The AI returns a structured turn plan, a bounded factual inspection, or one action.
A single legal input executes without a model request. Superseded requests indicate
a state change, not a failed match.

Each new match also records `ai-conversation.txt`: initial instructions, current AI context,
available inputs, plans, returned explanations, response times, and
execution results. It uses only the recorded AI perspective, not the private match
transcript. Empty/inactive fields are omitted for readability. Prior conversation
is not reprinted on each request. Full JSON transcripts remain opt-in.

Request progress is recorded in both AI logs: socket assignment, DNS/TCP/TLS,
request sent, response headers/body/completion, and response validation. Pending
transport requests emit a diagnostic every 30 seconds with elapsed time, the last
milestone and received byte count. HTTP status and provider request IDs are included
when available; credentials, headers and response bodies are not included in these
progress records. Heartbeats are diagnostic only; the separate request deadline
still applies, and
non-streaming requests cannot expose internal generation progress.

Malformed decision JSON, invalid response structures, invalid action IDs and
action-ID/intent mismatches receive
at most one format-correction attempt for planning and a separate attempt for action
selection, using the same board and legal actions. Mismatch corrections show the
selected input's exact intent and the conflicting returned intent. If correction
fails, one automatic fresh-context attempt drops old conversation and plans, rebuilds
current fair facts/legal actions, and carries recent public events and observed
outcomes. This attempt can plan then commit, but cannot inspect or retry its own
invalid responses. It is recorded as `fresh-context-retry`; it may add provider cost.
Refusals, provider/network errors
and truncated completions do not trigger format repair. Temporary provider/network
failures instead receive at most two automatic retries of the identical request,
with 500 ms / 1,000 ms backoff (or a longer provider Retry-After). All attempts and
delays share the configured request deadline. An excessive Retry-After pauses
rather than retrying early. HTTP-200 error envelopes and interrupted generations
are recognized; explicit permanent provider errors pause immediately. Requests
that time out retain the existing random-timeout behavior and are not retried.
Recovery preserves the plan, messages, schema, model, and phase. Cancellation
aborts active transport or backoff; only a fully validated current decision can
execute. No partial response executes. Retries can incur provider charges.
If the target-safety guard rejects a response that restores health on the opposing
side even after its format correction, the controller executes the current legal
End Turn as a deterministic safe fallback; if End Turn is unavailable, the AI
pauses and an on-screen notice explains that the game menu can restart or leave the
match. Other non-timeout failures retain the normal recovery and pause behavior,
while timeout requests retain their separate random legal-input fallback. The notice
also offers `Retry AI`, which resumes the current turn or mulligan with fresh state
and legal actions and a reset conversation. Manual retries may incur additional
provider charges. Leaving the match cancels pending work and invalidates its retry
button.

Progress logs include a per-call ID, phase, attempt number, sanitized provider
error details, retry delay, failed-attempt usage/time, and recovery outcome.
The telemetry summary separates automatic recoveries from manual retries and
counts failed-attempt usage once, excluding its duplicate terminal diagnostics.
`recovery-complete` means a provider response succeeded; normal decision validation
still follows and may require its separate bounded format-repair flow.

Rejected decision content and its validation category/error are retained in both AI
logs even without full transcripts. Content is credential-redacted and capped at
16,000 characters, with truncation explicitly marked. Provider reasoning and full
response envelopes are not included. Successful repairs record their repair count.
Rejected completions retain provider-reported usage when available, including
completion tokens spent on invalid answers. Do not count the duplicate diagnostics
on a terminal failure again when summing rejected-response usage.
HTTP errors use the same capped, redacted diagnostics rather than embedding raw
response bodies in error messages. Responses larger than 4 MiB are rejected before
they can accumulate in memory. Turn-loop and engine-rejection failures use the
same visible pause path as provider failures.
Decision failures cross the Electron bridge as validated plain-data envelopes;
the renderer reconstructs errors locally so repair flags and diagnostics survive
context isolation.

AI requests use compact name-to-count maps for deck overviews, own unordered remaining-deck counts
and graveyards (rendered as `Voidwalker (2)` in the conversation transcript).
Compact definitions are placed inline
for cards in known hands, on boards, in weapon and Secret slots, and in pending
Discover or card choices. Graveyards use names and counts. Catalog and presentation
metadata are omitted. Compact authored mechanics for visible cards and own unordered
remaining-deck counts are included directly. Active mechanics,
targets, costs (including zero), and runtime changes remain available. Position-only
variants share one move description and a position-to-action-ID map. All original
legal IDs and their exact executable commands remain unchanged and local; target,
card-instance and choice differences are never merged. Board slots and insertion
positions are explicitly zero-based, left to right.
Mulligan choices show both KEEP and REPLACE lists. Coin choices show available mana
before and after paying the current cost and applying its authored temporary-mana
gain, using the engine's shared mana calculation. This is conditional on the mana
effect resolving and does not predict Secrets or other triggers.
These reductions affect the provider request, not just the human transcript.

Board minions include current legal attack/hero-attack availability, their remaining
attack allowance, and public restrictions such as entry exhaustion, freezing and
Rush. An unused attack allowance does not imply the minion can attack now. The
decision prompt checks readiness, mana, board space and follow-ups, and requests a
brief expected benefit plus the main drawback/resource cost in the existing reason
field. Reasoning effort remains controlled by the selected provider configuration.
Printed board-card text/keywords are labeled separately from active keywords and
current status, including explicit shield/stealth availability. Stats already
include applied modifiers; enchantment deltas must not be added a second time.

Own-hand cards include engine-derived `battlecryConditions` for conditional
battlecries: `met`, `not-met`, or `unknown`. The initial whitelist covers own-hand
card presence with an optional tribe filter, excluding the card being played;
board minions never satisfy a hand requirement. Matching hand references identify
the enabling cards. Other conditions remain explicitly unknown. These facts are
refreshed with current state, do not predict targets or intervening effects, and
do not change legal actions. Verification also checks prerequisites, useful attacks
before friendly board-clear casualties, and source-before-trigger sequencing,
without adding another model request.

The AI is prompted to read the position, check its immediate win and loss risks,
set the turn's objective, compare up to two complete candidate lines, and test the
opponent's relevant reply before committing. One planning exchange is mandatory
before the first non-forced action of each AI turn. Mulligans and pending choices
skip planning and inspection. There is no configuration toggle; reasoning effort
remains in the selected provider profile. A plan proposes a first current action
but cannot execute it. The next exchange resolves that input, supplies requested
fair facts, and challenges the plan's costs, prerequisites and expected end position.

Factual checks address visible entities, public authored mechanics, existing
own-hand condition previews, current actions/resources, or recent public history.
Catalog lookups explain rules without asserting ownership. They never inspect
hidden hands, deck order, future RNG or the engine's full-state simulation previews.
Unsupported requests are explicit, not assumed true. Initial plan checks (up to
three) are answered in the mandatory exchange. Later inspection allows one batch
per decision and at most two extra exchanges per turn, shared across revisions
and manual retries. The final response after inspection must commit; another
question receives bounded format correction and at most one fresh-context recovery,
without replenishing the inspection allowance.
The 45-second default is per provider call, not per entire turn; extra exchanges
can increase waiting time.

Each commit includes its exact action ID and a matching intent (type, source,
targets, insertion position and option), a brief expected result, and an optional
replacement plan note. Mismatches are rejected before dispatch, never silently
retargeted. Current results override predictions. Updated plans replace stale
continuations without another planning call; actual draws and random outcomes
are reconsidered on the next action. Forecast prose is not an engine-certified
simulation, and no tactical scoring or coded deck strategy is added.

Logs distinguish `turn-plan`, `plan-challenge`, `fact-inspection`, `plan-updated`,
committed decisions, and execution results. Inspect usage and response timing are
recorded alongside planning and action costs. New AI logs use schema version 7;
existing version 4–6 recordings remain readable/recoverable. Action inputs use a
short move label plus structured intent instead of repeating the same references
in both prose and intent; execution logs retain full descriptions. See
[the deliberation design and evidence](docs/ai-turn-deliberation-plan.md) for the
prompt rationale, limits, and examples; gameplay quality still requires human testing.
Historical model moves and execution feedback omit duplicate commands,
reasons, and request identifiers. Card mechanics use compact text notation while
preserving conditions, targets, amounts, and timing.
Completed decisions retain only executed move descriptions and outcome feedback;
intermediate plans, proposed IDs and fact-check payloads remain in logs rather than
future conversation history. Kazakus's generated-card recipe lookup table is omitted
from requests while costs and ingredient rules remain. Board characters expose
maximum and missing health; heroes expose effective weapon-inclusive attack and
current legal attack readiness. A bounded match-local record retains observed
zero-healing and shield-consumption outcomes across context resets. These are factual
reminders, not general tactical learning or memory shared between matches.
Every decision exchange and format correction repeats a compact `currentDecision`
with resources explicitly keyed by `self` and `opponent`, labeled board stats,
current hand costs, and the current legal action list. Resource/history checks use
schema-constrained `self`/`opponent` refs, and action checks use current IDs. Failed
lookups supply usable visible refs; malformed resource lookups still return both
players' labeled facts without guessing which was requested.
An End Turn choice with other legal inputs receives at most one `end-turn-review`
per revision, asking the model to reconsider unfinished plays or confirm a strategic
pass. This adds a provider call when needed; it never forces spending resources,
does not replenish inspection, and is skipped during fresh-context recovery.
Recent non-End-Turn predictions are paired with bounded public outcome excerpts
in `outcomeReviews` (four actions, twelve events each; omissions are labeled).
Standalone historical forecasts are no longer retained as conversational facts.
Prompts distinguish attack from health, spell from hero-power modifiers, reciprocal
combat damage, and action timing. These checks improve grounding but do not certify
model forecasts or simulate hidden outcomes. Format repair permits correcting strategy
when its premises contradict the current facts.
Event narration uses `you/your opponent` directly from participant identities.
Hero powers use their authored names, instance IDs stay unchanged, and combat
summaries describe health/armor/durability changes without raw internal damage labels.

Permanent AI regression tests cover transport bounds, phase/schema validation,
bridge copying, bounded recovery/inspection, cancellation, intent agreement,
fair factual access, plan replacement, and action grouping. These are maintained source
tests; disposable test artifacts should still be removed after use.

## Aura shaders and Shader Lab

**Aura Shader** is the Metaball V5 effect ported from ShaderTest. Card and Bonus
Card use its moving blobs, smoothed silhouette and bottom taper. Board and Button
start from the same tuning with taper and bottom fade disabled. State palettes
retain their gameplay meanings. Distance fields are cached by silhouette; resting,
hovered and dragged cards all animate live, without a short baked loop.

The Card baseline combines V5 defaults with matching saved V4 settings: eight
blobs, pale threshold 1, taper 0.6, bottom fade 1, and fade start 0.67. V4-only
settings are not translated into the new blob controls.

**Ghost Aura Shader** retains the previous effect and tuning only for the mulligan
announcement, confirm button, opponent-still-choosing banner and selection toggle.

Shader Lab has separate Aura/Ghost selection and scrollable controls. Aura exposes
all V5 inputs, including fractional values, five colors and the smooth-outline
toggle. Ghost has independent controls and colors. Save writes both sections to
`config/outline-tunings.json` (version 4) through the existing development bridge.
The V5 distance padding covers the full slider range, and pixel controls keep the
source's 1268-pixel reference width. F3 suppresses both effects.
