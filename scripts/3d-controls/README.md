# Standalone 3D controls experiment

Interactive Electron + Three.js viewer of the original end-turn and hero-power
models. Runs independently of the game, without its entrypoint, services, routes,
saves, or Pixi renderer. Three.js is pinned in this folder's own package/lockfile;
Electron is reused from the existing root development dependencies. No server or
game build is required. Nothing is downloaded at runtime.

From the repository root:

```powershell
# First time on another checkout; already installed in this workspace:
npm.cmd --prefix scripts/3d-controls ci --ignore-scripts

# Open the interactive app:
node scripts/3d-controls/launch.cjs

# Hidden screenshot and interaction verification:
node scripts/3d-controls/launch.cjs --capture
```

Hold the end-turn object (or its button) to depress it. Release over it to end the
turn; moving off releases the press, and releasing elsewhere cancels the action.
Click again to restore your turn. Click the hero power to use or restore it.
Playback supports normal, half, and quarter speed. Drag the timeline to pause and
inspect the last animation, including the recorded end-turn hold, release, and
flip. Keyboard activation previews one complete press-down before releasing.
Replay, reset, and wireframe are available.
The camera is locked directly overhead and uses orthographic projection: objects
on either side have the same viewing direction, with no perspective convergence.
The background is the repository's `assets/images/table/board.png` (there is no
`table/base.png` in this checkout). The whole image is fitted without stretching.
`viewer-layout.mjs` mirrors the current game's end-turn placement (1595, 490;
157 px wide) and local hero-power placement (1160, 810; 150 px wide) on the
1920 x 1080 design canvas. Source meshes retain uniform 3D scale and their animation
depth. The experiment does not change the actual match renderer.
The inspector plays one selected animation at a time; selecting another finishes
the previous animation. Restore clicks are a lab convenience, not match rules.

Screenshots and the check report are written to `.tmp/3d-controls-app/`. Separate
Electron profiles also live there; the application's normal profile is not used.
The capture check dispatches pointer events through the actual canvas hit-testing
handler, checks both directions, held presses, overlapping release/flip,
drag-away and pointer cancellation, scrubbing and reset. It compares rendered
pixels across front, intermediate and back poses, and checks overhead orthographic
projection, game-relative placement, resizing and clicks after resizing. It is not
a visual parity test against a running Hearthstone client or a performance benchmark.

## Source and fidelity

`assets/experiments/3d-controls/controls.json` records source bundles, string-valued
Unity path IDs, material slots, transforms, original vertex attributes, texture
hashes, and unweighted cubic animation keys with incoming/outgoing tangents.
These isolated experimental assets are loaded directly by the viewer; they are
not added to the game's asset registry or build. Both `scripts/` and `assets/` are
already excluded from Electron packaging.

| Mesh           | Vertices | Triangles |
| -------------- | -------: | --------: |
| Button_EndTurn |      150 |       208 |
| HeroPowerV2    |      545 |       560 |
| ManaGem        |       19 |        24 |

The end-turn button uses `ENDTURN_PRESSED_DOWN` (0.0833 s) and
`ENDTURN_PRESSED_UP` (0.0333 s) on `ButtonContainer`, independently of
`ENDTURN_WAITING` (0.5833 s) and `ENDTURN_YOUR_TURN` (0.5 s) on its `ButtonMesh`
child. Release and waiting start together on mouse-up; the flip retains its
original lift and settling keys. All four clips come from
`essential_base_global-prefab-0.unity3d`. The additional `ENDTURN_PRESSED` clip is
retained as reference but is not the one called by the desktop mouse handlers.
See [animation-reference.md](animation-reference.md) for the inspected call chain,
source IDs, and remaining fidelity limits.

The ordinary hero-power clips are `HeroPower_Used` (0.5333 s) and
`HeroPower_Restore` (0.4333 s), from
`essential_base_qualityhigh_global-content-0.unity3d`. Reflection-only IL
inspection of `Card.PlayHeroPowerAnimation` confirmed these are the desktop
use/reset clips. They are not the separately authored `SuperFlip` variants.
The source mana-gem translation and scale tracks are also applied.

Unity coordinates are reflected across Z, triangle winding is reversed, and
quaternions are converted and normalized. Unweighted cubic tangents are preserved;
editor Euler hints are ignored rather than applied as a second rotation. Clip
duration is the last authored key, not the generic muscle-clip stop-time field.
The end-turn prefab parent's 180-degree facing is retained by the display host.

**Adaptations:** camera and staging, Phong lighting, shadow map, subtle hover tint,
canvas-rendered text, and the Fireblast portrait texture already used by this repo.
The mana gem uses its original geometry/texture with a static blue material.
Unity's original shader equations, mana shader scrolling/refraction, outline/glow,
audio, and gameplay are not ported. Material/visibility float tracks are retained
as evidence but are not evaluated; the selected turn clips' texture offsets are
zero. No claim of pixel-perfect parity or Pixi composition validation is made.

## Re-extract locally

The exporter reads the installation and its existing `Assets_Extracted` texture
manifest and Unity readers. It writes only to the experimental asset folder above.
It checks texture hashes, index bounds, and decoded vertex bounds against Unity's
recorded bounding boxes, rejecting unsupported mesh/curve formats.

```powershell
& 'C:\Users\gabri\AppData\Roaming\uv\python\cpython-3.11-windows-x86_64-none\python.exe' scripts/3d-controls/export-assets.py
```

Use `--installation 'path/to/Hearthstone'` for another installation. Re-extraction
replaces this experiment's generated files, never the source installation or the
game's existing assets. The viewer itself only needs the checked-in exports.

After visual approval, the next experiment is Pixi/Three composition with live
game layers, including foreground occlusion, pointer routing and timing. This
prototype deliberately does not connect the new renderer to the match.
