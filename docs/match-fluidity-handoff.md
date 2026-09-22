# Match fluidity pass: pause handoff

Paused at the user's request on 2026-09-20. Implementation is in the working tree;
no commit or push was requested. No further application runs are planned for this
session.

## Implemented

- Held-card translation follows the latest pointer directly. The existing 85 ms
  pickup settling and scale response, tilt, boundaries, and return animation remain.
- Drag updates run in the scene frame before board visuals and shadows. Pointer
  samples still record gesture thresholds immediately; board previews update once
  per frame. Releases use their actual coordinates and respect pointer ownership.
- Cached hand transforms and canvas bounds avoid repeated work. Board insertion
  reads a narrow authoritative session snapshot instead of cloning the match.
  Canvas conversions now use logical renderer dimensions at high DPI.
- A two-entry presentation pool reuses card textures and meshes. Preparation waits
  for a 120 ms pointer pause, avoiding allocations during moving hand sweeps.
  Hover enlargement is immediate; actual pickup bypasses that preparation delay.
- Held appearance snapshots refresh at most once per scene frame. Unchanged mesh
  geometry is skipped; bounds, appearance, DPI, context loss, transfers, and disposal
  have explicit resource handling.
- The isolated benchmark uses real browser mouse input, deterministic local AI
  mulligan responses, separate player data/logs, normal/premium hands, full-board
  cases, lifecycle counters, and capped/uncapped diagnostics.

Visual quality, assets, layout tuning, and the production 60 FPS cap are preserved.

## Validation and evidence

- **147 focused tests passed** across hand layout/drag, rotation, card and target
  gestures, presentation ordering/lifecycle, and card appearance snapshots.
- Targeted ESLint and dependency-boundary checks passed. A production build smoke
  check passed; final check logs are under `artifacts/match-performance/`.
- Repository-wide TypeScript checks already failed before this work in existing
  AI files, the shared AI schema, and `game-combat-presentation.ts`. Those unrelated
  errors were reproduced against the original code and were left unchanged.
- [Baseline report](../artifacts/match-performance/baseline.json): original hand
  and rendering code with matching benchmark instrumentation and shared assets.
  All **85 scenarios had valid input**. It includes three ten-second samples for
  normal/premium 1-, 4-, 7-, and 10-card hands.
- The baseline ten-card normal drag averaged about **72 rendered pixels** of
  anchor-following error. Its 100 pickup/return cycles generated **200 textures**,
  with no net live-texture growth; final match disposal returned the tracked live
  texture count to zero.
- The earlier [optimized smoke report](../artifacts/match-performance/optimized-smoke.json)
  showed zero new textures on warm pickup, but exposed hover preparation churn.
  That churn was subsequently addressed with stationary-pointer preparation and
  regression tests. This older smoke report also contains a since-fixed full-board
  fixture error; **it is not final performance acceptance evidence**.

The final optimized full capture timed out during its first restart after frame
submission fell to approximately 1 FPS. The document reported visible and focused;
bringing it to the front did not resolve the slowdown. The cause is **unconfirmed**.
Display sleep or compositor scheduling is a hypothesis, not a demonstrated cause.
The current harness writes only on successful completion, so this failed run did
not preserve its preceding measurements. No validated final before/after claim or
performance-target pass is available.

Ordinary baseline hands ran near 58 FPS. The full premium board was heavier
(about 46 FPS hovering and 43 FPS dragging). Short uncapped idle diagnostics ran
near 60 FPS; the installed Pixi ticker truncates elapsed milliseconds in its cap
check (`node_modules/pixi.js/lib/ticker/Ticker.mjs`). This suggests a frame-pacing
issue to investigate separately. The cap was deliberately left unchanged.

## Resume in this order

1. **Make measurements durable.** Save completed scenarios to a partial JSON report
   after each case and preserve it with the failure reason before cleanup. Add
   approximately three minutes of overall lifecycle timeout headroom.
2. **Stabilize the benchmark environment.** Add a benchmark-only Electron
   `powerSaveBlocker` using `prevent-display-sleep`, record its status, and release
   it on exit. Confirm display refresh, GPU, viewport, DPI, fonts, and sustained
   frame submission. Investigate the 1 FPS condition if it recurs.
3. **Run a short validation first**, including a four-card moving hover, premium
   ten-card hover/drag, a full-board weapon drag, and a restart. Verify actual
   pickups and zero moving-hover preparation allocations before another long run.
4. **Repeat the matched full capture** and compare following error, frame p95/p99,
   long-frame frequency, warm pickup allocations, all 100 returns, resource counts,
   and disposal. Keep generated reports under distinct labels.
5. **Review the remaining budget gaps.** Investigate frame-cap scheduling and the
   crowded premium-board rendering cost using measurements. Preserve the 60 FPS
   target and visual quality; avoid a broad renderer rewrite.
6. **Human feel check:** quick reversals, slow/faster hand sweeps, edge dragging,
   click-to-carry, cancel/return, minion placement, spell targeting, and high-DPI
   release outside the canvas.

Initial targets remain frame p95 <=18.5 ms, p99 <=25 ms, frames over 33.4 ms <=0.1%,
and CPU p95 <=8 ms. Input receipt-to-submission is a latest-event freshness proxy,
not input-to-photon latency. Following error measures the rendered grab anchor;
texture counters cover `renderer.generateTexture`, not every GPU allocation.

```powershell
npm.cmd run perf:match -- --smoke --hand-sizes 4,10 --label resume-smoke --no-fail
npm.cmd run perf:match -- --label optimized-verified --no-fail
```

Do the harness fixes above before those runs. `--no-fail` retains performance-budget
failures as reports; invalid input/setup remains an error. The automated fixture
uses cancellation to preserve its cards, so committed plays still need the listed
human check in addition to the gesture regression tests.
