# Ghost UI reference

Inspected the local Hearthstone installation on 2026-10-19. This effect follows
the normal mulligan UI, not the separate `Custom/FX_GhostCard` card effect.

## Source and assets

`essential_base_global-prefab-0.unity3d` contains the active banner
`-9185784758078504462` and `MulliganButton` `797710811736412717`.
The button's PlayMaker FSM is `5125814216190235181`.

| Original texture | Runtime file under `assets/images/effects` |
| ---------------- | ------------------------------------------ |
| GenFX_clouds6b   | ghost-clouds.png                           |
| Mulligan_Banner  | ghost-banner-atlas.png                     |
| Button_Floaty2   | ghost-button-atlas.png                     |
| GenFX_DustE_add  | ghost-smoke-add.png                        |
| GenFX_DustE      | ghost-smoke.png                            |
| GenFX_moteE      | ghost-mote.png                             |
| GenFX_moteB      | ghost-evaporate.png                        |

The files are byte-identical copies of the extracted PNGs. No old assets were
deleted. Original mesh UVs select regions of the full atlases.
The recovered shader programs are `Hero/AddMultiply/AddMultiplyFXScrolling`,
`Hero/Additive/Additive`, `Hero/Particle/Particle Additive + 1`, and
`Hero/Particle/Particles_Transparent`. `ghost-authored.json` holds the recovered
particle ranges and curves. Local disassembly and full provenance remain in
the ignored `Artifacts/ghost-*` inspection files.

## Confirmation sequence

The C# call chain is `OnMulliganButtonReleased` → `BeginDealNewCards` →
`RemoveOldCardsAnimation` → `RemoveUIButtons`. The release handler disables
input. `RemoveUIButtons` sends `Death` to the floating button's FSM.

1. State 3 starts `AllyInHandScryLines` on `ButtonFloaty2GlowEcho_mesh` at speed 2.
   This enables the initially disabled echo renderer and animates `_TintColor.a`.
   Its initial alpha of zero does not mean the echo is unused.
2. It fades **UberText**, not the body or all particles, to zero over 0.3 seconds.
   The serialized iTween ease value is 21 (`linear`).
3. At 0.2 seconds, Death State hides `GameObjectContainer` recursively and plays
   `FX_Evaporate`: 250 motes, each lasting 0.5–1.5 seconds.
4. The port releases the exit visual after 1.7 seconds, when the last possible
   mote ends. Hearthstone destroys its UI objects later, after a 3.5-second wait
   plus any replacement-label staggering. That longer invisible lifetime is not
   imposed on gameplay or reward dismissal here.

The first port incorrectly faded the whole button and omitted the death echo.
The second pass corrected both. Separate labels (Discover/Cancel) have their own
fade; existing confirmation/reward PNGs contain baked lettering, so their text
cannot fade independently without replacing the artwork.

## Call-site and lifecycle behavior

- Mulligan confirmation locks immediately and cannot confirm twice. A rejected
  confirmation restores its parent, visibility, transforms, and input.
- The waiting notice retains the existing generic button profile.
- Discover's Show/Hide toggle remains present when toggled. Closing the overlay
  transfers its exit effect to the match-owned exit layer. Reopening restores
  the old parent **before** applying the next Discover or Cancel placement.
- Reward confirmation waits for a successful save before evaporating. A failed
  save re-enables Confirm. Repeated clicks cannot save or dismiss twice.
- Startup warms the reward shader using the arena bundle. Every consumer owns
  and disposes its Ghost instance; the effect does not own shared textures.
- Idle artwork skips the departure filters. Smoke/glow remain behind the target,
  and echo/motes render in front. F3 suppresses both effect layers.
- Full-game validation exposed an existing first-turn hover restoration error
  when no pointer event had initialized Pixi's hit-test root. Board and hand
  inspection now wait for that root; subsequent pointer input works normally.

## Fidelity limits

The port is not an exact reproduction of the complete Unity UI. It maps 3D
particle motion to existing 2D placements, approximates velocity damping, and
does not reproduce global bloom, depth interactions, audio, or the entry echo.
The project's hover/press behavior is retained; Hearthstone's `NormalButton`
moves to a mouse-over bone rather than applying this project's hover scale.
Banner dismissal follows the recovered half-second `easeOutExpo` shrink, but
its trigger remains owned by this game's mulligan flow. Hearthstone also has
separate immediate banner destruction paths and a four-second scheduled hold.
Smoke uses Pixi's premultiplied coverage for compositing.

No live Hearthstone capture was used, so visual identity cannot be claimed.

## Verification

`npm run test:ghost` uses an isolated hidden Electron/WebGL window to check shader
pixels, source death timing, actual production control handlers, interruption,
overlay transfer, save failure recovery, and disposal. It captures Shader Lab
frames in `.tmp/ghost-check`. Card selection uses empty candidates in this focused
test; ordinary card rendering is outside its scope.
