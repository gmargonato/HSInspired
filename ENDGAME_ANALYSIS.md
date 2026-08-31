# Endgame Renderer Error Analysis

## Status

- Investigation date: August 30, 2026
- Current result: the failure was identified as an invalid PixiJS container access, but it was not reproducible after launching a fresh renderer.
- No source-code fix has been attempted. This document is intended to preserve enough context to resume the investigation when the failure happens again.

## Reported symptom

After winning a game, the renderer console repeatedly reported:

```text
Uncaught TypeError: Cannot read properties of null (reading 'x')
```

The same exception entered a loop and effectively froze the application. The original console screenshot pointed to:

```text
node_modules/.vite/deps/chunk-IVWZ37ZZ.js?v=9e3339f2:1729:27
```

It was also repeated by the global renderer logger at `src/renderer/app/logger.ts:16`.

The terminal did not show the exception. That is expected with the current setup: this is an Electron renderer-process error, and the global listeners in `src/renderer/main.ts` send it to the renderer's DevTools console through the application logger.

## Confirmed technical meaning

The bundled line maps to the PixiJS `Container.x` getter:

```js
get x() {
  return this._position.x;
}
```

The installed PixiJS version is `8.19.0`. When `Container.destroy()` runs, Pixi deliberately clears its transform fields, including:

```js
this._position = null;
```

Relevant installed-library locations at the time of investigation:

- `node_modules/pixi.js/lib/scene/container/Container.mjs:505`: the `x` getter.
- `node_modules/pixi.js/lib/scene/container/Container.mjs:1145`: destruction clears `_position`.

Therefore, the immediate cause is known:

> Some callback, animation, ticker, or retained reference attempted to read `.x` from a Pixi container after that container had been destroyed.

This is a renderer object-lifecycle problem. It is not evidence that a game-state coordinate itself was null.

The repeated nature of the exception suggests that the invalid access was owned by something recurring, such as a Pixi/GSAP ticker, animation update callback, pointer-processing path, or development overlay. A one-shot endgame function would normally produce only one exception.

## Endgame code examined

The main result path is in `src/renderer/features/game/game-board-view.ts`:

- `showMatchResult()` freezes interaction, ends targeting/dragging, applies result filters, reparents the local hero into the result overlay, and displays the result.
- `presentMatchResult()` awaits the optional `onMatchEnded` callback before displaying the result.
- `presentResolutionEvents()` presents match events sequentially and reconciles board objects afterward.
- `dispose()` removes window listeners, clears targeting and combat state, stops the hand-drag ticker, disposes or destroys the board views, and kills the board animation scope.

Other areas inspected included:

- `src/renderer/features/game/match-result-overlay.ts`
- `src/renderer/features/game/attack-line.ts`
- `src/renderer/features/game/hand-card-perspective.ts`
- `src/renderer/features/game/game-board-view.ts` combat, death-batch, damage-indicator, drag, and disposal paths
- `src/renderer/rendering/minions/minion-view.ts`
- `src/renderer/rendering/minions/sleeping-zs.ts`
- `src/renderer/rendering/heroes/hero-view.ts`
- `src/renderer/rendering/effects/animated-outline.ts`
- `src/renderer/animation/animations.ts`
- `src/renderer/features/dev/layout-inspector/layout-inspector.ts`
- `src/renderer/scenes/game-scene.ts` and the class-win persistence callback

No definite missing cleanup call was proven during static inspection.

## Live tests performed

The app was launched with Chrome DevTools Protocol access. During the tests, the debugger was configured to pause on uncaught exceptions and renderer `Runtime.exceptionThrown` events were monitored. Most matches initially used the local AI fallback to avoid unnecessary external calls. A final test restored the real AI bridge.

The following paths completed without the reported Pixi exception:

1. Forced developer win through `devEndMatch('win')`.
2. Result blur plus an active damage indicator.
3. Result continuation and scene teardown while a transient indicator existed.
4. Real targetless-spell lethal damage.
5. Real hero-combat lethal damage.
6. Real minion-combat lethal damage.
7. Minion combat in which both minions died and a deathrattle then dealt lethal hero damage.
8. Pointer-accurate minion selection and lethal attack, leaving the pointer over the defeated hero.
9. Pointer-dragging a targetless lethal spell from the hand into the valid play area.
10. Click-targeting the opposing hero with a lethal Fireball.
11. Clicking the result overlay to continue through the real Pixi event path.
12. Result display and scene continuation with the F2 layout inspector enabled.
13. A real-AI-bridge match followed by lethal damage and win-stat persistence.

An inspection of active GSAP animations after endgame navigation did not find an active animation targeting a destroyed Pixi container.

## Hypotheses tested and not supported

The following conditions were individually tested and were not sufficient to trigger the error:

- Applying BlurFilter/ColorMatrixFilter to the concluded gameplay layer.
- Reparenting the local hero into the result overlay.
- A damage popup remaining active when the result appears.
- Ordinary combat lunge, settle, screen-shake, and result sequencing.
- Destroying minions during the same resolution batch as match end.
- Deathrattle lethal resolution.
- The GSAP hand-drag ticker during a lethal card play.
- Combat targeting and pointer-hover state during lethal damage.
- Clicking Continue and destroying the scene from a Pixi pointer event.
- The development layout inspector reading the result scene.
- The asynchronous class-win persistence callback.
- Use of the configured AI bridge versus the local fallback.

These results do not prove that the involved code is bug-free. They show only that none of these conditions, by itself, reproduced the original loop in a fresh renderer.

## Current assessment

The original failure was real and its low-level cause is clear, but the owning application callback remains unknown.

The highest-probability explanations are:

1. A state accumulated over a longer, naturally played match that the accelerated lethal tests did not create.
2. A particular card/effect/animation combination that destroys a view while another callback still references it.
3. A stale renderer-session reference that no longer existed after the development app was restarted.
4. A timing-sensitive pointer, ticker, or animation race that did not occur during the controlled runs.

Because restarting the renderer removed the reproducible state, the next occurrence should be captured in the same running process before restarting or navigating further.

## Recommended next investigation

Before or immediately after the next reproduction, add development-only lifecycle instrumentation. The instrumentation should:

1. Wrap Pixi `Container.destroy()` and record, in a `WeakMap`, the container constructor, label, parent label, last position, and destruction stack.
2. Detect an `x` read when `_position` is null and print the destroyed container metadata and destruction stack only once per object.
3. Print `event.error.stack` explicitly from the global error handler so DevTools ignore-listing cannot hide the application call frames.
4. Keep a short rolling buffer of recently presented match events and include it in the first diagnostic report.
5. On the first matching error, pause the Pixi application ticker and GSAP timeline/ticker to prevent thousands of repeated exceptions from freezing DevTools and obscuring the first stack.
6. Avoid silently returning a fallback coordinate as a permanent fix. That would mask the invalid lifecycle and could leave a recurring callback alive.

The desired evidence from the next occurrence is:

```text
Destroyed object: <constructor and Pixi label>
Destroyed by: <application destruction stack>
Read after destruction by: <complete exception stack>
Recent match events: <ordered event tail>
Active animation/ticker owner: <if applicable>
```

That should make it possible to identify the exact owner, for example a combat marker callback retaining a removed minion, and then fix its cleanup and add a focused regression test.

## Instructions when it happens again

1. Do not restart the app immediately.
2. Preserve the first exception, not only later repeated copies.
3. In DevTools, expand the exception and select **Show ignore-listed frames** if that option appears.
4. Copy the complete stack, including frames from `src/renderer`, GSAP, or Pixi.
5. Note the final action and card/effect involved: combat, spell, hero power, fatigue, concession, deathrattle, secret, weapon, or another path.
6. Note whether the result overlay had appeared and whether Continue had been clicked.
7. Resume this investigation using this document as context.

## Investigation side effects and repository state

- No source files were changed as part of the diagnostic session that preceded this document.
- The development application was closed after testing.
- The repository already contained numerous unrelated modified and untracked files; they were preserved.
- Several non-developer forced lethal tests passed through real win tracking, so the persisted class-win counter outside the repository may have been incremented by the investigation.
- The final real-AI test used the configured AI bridge and may have made an Azure decision request, as approved for testing.
