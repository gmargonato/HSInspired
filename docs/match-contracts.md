# Match domain contracts

These contracts are intentionally platform-neutral and are exercised by tests in
`src/game/match`.

- A runtime entity has one stable instance identity and exactly one authoritative zone.
- Moving an entity preserves its identity; copying, summoning, or generating creates a
  deterministic new identity owned by the match counter.
- Selectors return stable zone/board/creation order before count or random selection.
- Simultaneous deaths are captured as a batch at a checkpoint before deathrattles resolve.
- Trigger ordering is active-player-first, then stable zone/board order, then creation ordinal.
- A command is validated before mutation. Rejection emits no events, consumes no RNG, and
  does not advance revision or entity counters.
- An unexpected resolver error rolls the complete command back, including state, counters,
  events, and RNG position.
- Public snapshots are copies; mutating a returned snapshot never mutates the match.
