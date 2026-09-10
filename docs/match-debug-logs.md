# Match logs

Each new match has one folder containing exactly two persistent files:

- `match.txt`: the chronological gameplay transcript, using Local Player and Remote Player.
- `ai.json`: compact AI decision summaries: chosen plays, returned explanations, execution results, and errors.

Development recordings are in `artifacts/match-logs/`. Installed builds use `match-logs/` under Electron's application data directory. Folder names contain a UTC timestamp and unique match ID. Existing recordings are retained unchanged; schema version 5 applies only to new recordings.

## Reading the transcript

The transcript reveals both players' opening hands, replacements, draws, and generated cards. It uses card names, simple turn headings, and short sentences, without per-line timestamps, technical IDs, raw JSON, or provider diagnostics. Duplicate minions are identified by their current board position, counting from the left starting at 1.

```text
Turn 5 - Local Player
Local Player has 3 mana.
Local Player draws Arcane Intellect.
Local Player plays Arcane Intellect for 3 mana.
Local Player draws Frostbolt.
Local Player draws Water Elemental.
Local Player ends the turn with 0 mana remaining.
```

Concrete engine events determine ordering. Damage, prevention, summons, simultaneous death batches, Deathrattles, discoveries, weapons, transformations, and control changes are described as they resolve. Aggregate combat/history events do not repeat consequences already logged. A returned or transformed minion is not described as dead. Generated Discover choices are described as additions to hand rather than draws.

```text
Local Player's Chillwind Yeti attacks Remote Player's Argent Squire.
Remote Player's Argent Squire's Divine Shield absorbs the damage and is removed.
Local Player's Chillwind Yeti takes 1 damage and has 4 health remaining.
```

Damage and healing use recorded resolved values rather than printed card amounts. An engine state-only change is explicitly described as the state at the end of the action; the logger does not invent an intermediate cause or order. Unsuccessful commands are described as attempts. If a secret interrupts an attack, the declared attack precedes the interruption and any actual combat follows it.

The transcript includes developer interventions, match results, abandonment, interruption, and an incomplete-recording notice when writable. It is an account of gameplay, not animation or resolver queue internals. A live PowerShell view is available with `Get-Content -LiteralPath '<match-folder>\match.txt' -Wait -Tail 40`.

## Reading AI decisions

`ai.json` is ordinary, indented JSON. Its header contains the match ID, participants, timestamps, status, recording completeness, model name, and deck strategy. New schema-5 decisions also retain a fair observation, candidate policy summaries, policy evidence, lethal-search coverage, and execution effects. Delayed AI draw, burn, and fatigue effects caused at action boundaries are retained in `boundaryEffects`. The model and strategy are stored once.

Each decision has a sequential decision number, turn number (0 for the opening mulligan), selection source and reason code, selected policy ID, candidate count, one returned explanation, and a list of plays. Reason codes distinguish model selection, engine lethal, unavailable API, a single safe policy, provider failure, live safety replacement, and no generated policies. Policy evidence records whether consequences are proven or bounded, risk flags, resolved effect totals, and whether a policy is a guaranteed lethal or a provable immediate loss:

```json
{
  "turn": 4,
  "decision": 7,
  "source": "model",
  "reasonCode": "model-selected",
  "policyId": "policy-3",
  "candidateCount": 12,
  "hasCompleteOutcome": true,
  "lethalCandidateCount": 0,
  "evidence": {
    "certainty": "proven",
    "riskFlags": [],
    "guaranteedLethal": false,
    "immediateLoss": false
  },
  "plays": [
    { "action": "Play Shielded Minibot", "result": "executed" },
    { "action": "End turn", "result": "executed" }
  ],
  "explanation": "Develop a minion while saving removal for a larger threat."
}
```

Plays use card names, with board minion targets including their slot, current stats, and instance ID. Selections initially have a `pending` result; matching engine commands update them to `executed` or `rejected`. Executed plays include compact event types, state changes, and mana snapshots. Rejected attempts include an error. Retries remain separate attempts. A new decision or normal match exit marks unused planned plays `not executed`. Crash recovery or failed logging marks unconfirmed pending plays `unknown`, since their execution result may have been lost. Late execution results can still update their corresponding play without reopening the match.

Fallbacks retain their source and explanation. Provider failures retain a short error on the decision; planning errors without a gameplay decision appear in an optional header-level errors list. Late provider responses do not overwrite the explanation for the selected fallback.

Schema 5 retains a redacted fair observation and compact candidate summaries for each AI selection. It still omits raw provider request/response envelopes, credentials, prompt/configuration dumps, hidden opponent information, and exact model-input reconstruction outside the retained fair observation. Provider response explanations are not duplicated alongside selection explanations. Gameplay consequences remain fully represented in `match.txt`; compact execution and boundary effects in `ai.json` exist to correlate decisions with outcomes.

Returned explanations are the model's stated rationale, not a guarantee of correctness. No additional model calls are made. Credentials and request headers remain filtered, and the playing model's fair-information inputs are unchanged.

## Persistence and lifecycle

The main process formats and writes logs asynchronously. TXT is append-only. JSON is atomically replaced using a temporary file, removed after the operation. Writes are batched at roughly 250 ms and flushed at turn boundaries and exit. The queue is bounded to 256 pending records plus the active batch. Large AI inputs are discarded before entering the write queue. The compact decision summaries are retained in memory and rewritten when a batch is flushed.

Status is `in-progress`, `completed`, `abandoned`, or `interrupted`. Completed results are not overwritten by scene disposal or shutdown. Late AI records may update the JSON without reopening the match. On startup, unfinished version-4 and version-5 recordings are marked interrupted and incomplete. Historical formats are not converted or modified.

Normal shutdown allows up to five seconds for outstanding writes. A hard crash may lose buffered records, leave a partial text line, or leave a temporary JSON file. TXT and JSON are not a transactional pair. If writes fail or the queue overflows, gameplay continues and the existing logging-error notice is shown; the JSON and TXT mark incompleteness where writable.

There are no checkpoint files, structured human-command archives, replay exports, automatic uploads, or automatic deletion. Engine checkpoint functionality used elsewhere is unaffected. Disk usage grows as matches accumulate. No application launch or additional provider request is needed to inspect the files.
