# Animation reference

Verified against the local Hearthstone installation on 2026-10-30 by read-only
reflection/IL inspection and decoding the original Unity prefabs and clips.
The exporter records exact source keys, tangents, sample rates, wrap modes,
animation roots, bundle names, and string-valued path IDs in `controls.json`.

## End-turn input sequence

1. `InputManager.HandleLeftMouseDown` calls
   `EndTurnButton.PlayPushDownAnimation`. It marks the button pressed and calls
   `Animation.Play("ENDTURN_PRESSED_DOWN")` on `ButtonContainer`.
2. On mouse-up over the same button, `InputManager` calls
   `EndTurnButton.PlayButtonUpAnimation`, then `DoEndTurnButton`.
   The first call clears the pressed flag and plays `ENDTURN_PRESSED_UP` on the
   container. It does not wait for that clip to finish.
3. `DoEndTurnInternal` sends the end-turn option and immediately invokes
   `DoEndTurnButton_Option_OnEndTurnRequested`. This calls
   `EndTurnButton.OnEndTurnRequested`, which calls `SetStateToWaiting`.
   The waiting actor state plays `ENDTURN_WAITING` on the separate `ButtonMesh`
   animation component. Its configured cross-fade is zero.
4. `EndTurnButton.HandleMouseOut` calls `PlayButtonUpAnimation` if still pressed.
   Releasing elsewhere does not submit the end-turn action. Moving back before
   releasing can still activate the button; the press does not restart on reentry.

The viewer therefore needs two independent transforms. Applying both animations
to the mesh would overwrite one set of curves. Adding a delay between release
and flip would also change the source behavior.

| Clip                   | Animation owner   |   Duration | Source motion                                                        |
| ---------------------- | ----------------- | ---------: | -------------------------------------------------------------------- |
| `ENDTURN_PRESSED_DOWN` | `ButtonContainer` | 0.083333 s | Linear local Y: 0 to -0.2; stays down while held.                    |
| `ENDTURN_PRESSED_UP`   | `ButtonContainer` | 0.033333 s | Local Y: -0.2 to 0, with original unequal cubic tangents.            |
| `ENDTURN_WAITING`      | `ButtonMesh`      | 0.583333 s | Source quaternion flip, small lift, then local Y settles to -0.33.   |
| `ENDTURN_YOUR_TURN`    | `ButtonMesh`      |      0.5 s | Rises from -0.33, rotates back with authored overshoot and settling. |

These values are source-local units and are scaled with the mesh to fit the game
table. The 180-degree waiting orientation is reached around 0.333333 s after
release; the remaining keys settle its height. No generic easing, synthetic
bounce, or extra rotation is added. Very short clicks still begin the release
clip at its authored -0.2 first key, as the source uses `Animation.Play` without
cross-fading.

In `essential_base_global-prefab-0.unity3d`, the inspected active prefab has:

- `EndTurnButton`: `-7841752709053336988`.
- `ButtonContainer`: `-3077616787339791772` (identity local transform).
- `ButtonMesh`: `-1658026854451039644`.
- `ENDTURN_PRESSED_DOWN`: `7156919352994214614`.
- `ENDTURN_PRESSED_UP`: `-2990439347017841127`.

## Hero power

`Card.PlayHeroPowerAnimation` selects `HeroPower_Used` and `HeroPower_Restore`
for the ordinary desktop interaction. The viewer already used these clips,
including the mana-gem translation/scale and original quaternion tangents.
Their durations are 0.533333 s and 0.433333 s. They are separate from the
`SuperFlip` clips. No changes to their animation keys were necessary.

`MobileActorGem` is gated by the mobile check in `Awake`; its positioning behavior
is not an additional desktop animation to apply here.

## Preview behavior and limits

Physical pointer input records the actual hold duration. Replay and the timeline
include that hold followed by simultaneous release and flip. Keyboard activation
previews an 0.083333 s hold, and the speed selector scales all selected motion.
The lab allows restoring controls on click and finishes the previous selection
when another animation is selected; those are inspection conveniences.

Transform playback follows the source hierarchy, event order, and authored
curves. Lighting, shadows, text rendering, portrait composition, hover tint, and
materials remain the adaptations documented in the README. Audio, Unity shader
effects, and gameplay timing beyond this local input sequence are not ported.
The checks verify input behavior and sampled transforms, not frame-by-frame
visual equivalence to a running Hearthstone client.
