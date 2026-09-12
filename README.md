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
- `npm run architecture:map`: Generate the code health atlas, audit report, and complete relationship evidence at `artifacts/architecture/`.
- `npm run architecture:check`: Check the architecture analyzer against isolated fixtures without launching the app.

---

## 3. Architecture & AI Agent Instructions

All architectural boundaries, file naming standards, layout contracts, asset pipelines, and engineering invariants are documented in **[AGENTS.md](AGENTS.md)**.

The visual maps and their generation workflow are documented in **[docs/architecture](docs/architecture/README.md)**.

## Game AI diagnostics

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
selection, using the same board and legal actions. Refusals, provider/network errors
and truncated completions do not trigger format repair. If a non-timeout request still fails,
the AI pauses and an on-screen notice explains that the game menu can restart or
leave the match; no random fallback move is played. The notice also offers
`Retry AI`, which resumes the current turn or mulligan with fresh state and legal
actions. Manual retries may incur additional provider charges. Leaving the match
cancels pending work and invalidates its retry button.

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
question receives only the existing bounded format repair, not an endless loop.
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
Event narration uses `you/your opponent` directly from participant identities.
Hero powers use their authored names, instance IDs stay unchanged, and combat
summaries describe health/armor/durability changes without raw internal damage labels.

Permanent AI regression tests cover transport bounds, phase/schema validation,
bridge copying, bounded recovery/inspection, cancellation, intent agreement,
fair factual access, plan replacement, and action grouping. These are maintained source
tests; disposable test artifacts should still be removed after use.
