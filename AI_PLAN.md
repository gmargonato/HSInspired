# Competitive Game AI Architecture

## Objective

The remote player must pursue the winning strategy of its own deck while using
only information available under the active game mode. The current constructed
mode is fair-information: the AI knows its own deck and hand, but not the
opponent's hand, decklist, facedown secrets, remaining deck order, or future RNG.

## Decision pipeline

```text
AI deck + structured effects
        |
        v
automatic match-scoped deck plan
        |
        v
public state + public event delta + secret belief set
        |
        v
isolated bounded turn-line search
        |
        v
plan-aware outcome annotations and safe shortlist
        |
        v
GPT-5.4 nano selects one supplied line/action ID
        |
        v
revision, legality, and engine dispatch validation
```

The game engine owns legality, state transitions, RNG snapshots, and analysis
forks. The renderer orchestrates planning and selection. The main process owns
the Azure adapter. Shared code owns serializable IPC contracts.

## Deck strategy

- A new plan is generated for every match; plans are not cached across matches.
- The plan contains win conditions, phase priorities, card roles, combo packages,
  resource-preservation rules, release conditions, and mulligan priorities.
- Card IDs returned by the model must exist in the AI deck.
- A deterministic fallback derives curve, roles, and structured synergies. For
  example, an effect that applies `frozen` is linked to a card requiring a frozen
  target, allowing Frostbolt and Ice Lance to be identified as a package.
- Reserved resources receive an opportunity-cost penalty when spent outside a
  complete package. Lethal and forced survival always outrank preservation.

## Fair information and uncertainty

- AI payloads use the engine's public state and public event projections.
- Only the AI's original unordered decklist is included.
- Opponent hidden cards and secret identities remain masked.
- Possible secrets are listed from the opponent class and eligible card pool.
  With no metagame prior, they are treated uniformly.
- Exact previews are not used when an action may resolve a hidden secret or
  future random result. This prevents the shortlist itself from becoming a
  hidden-information side channel.
- Two internal matches with identical public observations must produce identical
  AI state and candidates even if their hidden secrets differ.

## Turn planning

- Deterministic actions are expanded into bounded candidate lines using isolated
  engine analysis forks.
- Search defaults: depth 12, beam width 32, 4,000 nodes, and 250 ms local time.
- Lethal, survival, end-turn, and strategically distinct first actions remain
  represented in the candidate pool.
- At most 16 outcome-annotated candidates cross the provider boundary.
- The model ranks candidates by guaranteed lethal, forced survival, expected win
  value, deck-plan progress, sequencing, and resource opportunity cost.
- Only the first command is dispatched. The next decision is rebuilt from the
  newly resolved authoritative state.

## Provider and reliability policy

- Model: the configured Azure GPT-5.4 nano deployment only.
- Deck plan and ambiguous turn choices use medium reasoning effort.
- Routine Discover uses low effort; deterministic forced actions should bypass
  the provider where possible.
- Deck planning starts during scene initialization and overlaps asset/font loading and
  the opening presentation. It has a separate 30-second budget. Mulligan ranking runs
  concurrently using the deterministic synergy plan if remote planning is still in
  flight; later turns adopt the richer plan when it completes.
- Every mulligan, Discover, and turn decision has a fresh absolute 20-second budget
  including retry time.
- Schema validation, candidate membership, match revision, and live legality are
  mandatory before dispatch.
- Provider failure uses the same plan-aware deterministic shortlist rather than
  action enumeration order.

## Verification requirements

- Hidden secret, hand, deck-order, and RNG variations cannot change an AI request
  before becoming public.
- Immediate lethal and forced survival remain deterministic priorities.
- Freeze-combo fixtures preserve Frostbolt unless lethal, survival, or a complete
  package justifies spending it.
- Unknown Mirror Entity does not reveal itself through previews and does not
  automatically prohibit all minion plays.
- Analysis and sequence previews restore live state, revision, entity counters,
  observed events, and RNG.
- Provider/config/IPC tests cover strict plan and decision schemas, deadlines,
  failure fallback, and stale response rejection.
