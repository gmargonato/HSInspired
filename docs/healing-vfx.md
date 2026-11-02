# Healing VFX

Healing now plays in matches as well as the development preview. Existing
damage presets and their version-1 save format remain supported.

Open the normal VFX Lab and select **Mass Heal** or **Target Heal**. To start there
directly in PowerShell:

```powershell
$env:VITE_DEV_START_ROUTE = 'vfx-lab'
npm.cmd run dev
```

Mass Heal offers friendly side, enemy side, both boards, and all-character presets.
Individual board/hero zones remain independently selectable. Friendly/enemy is
relative to the caster; the opponent-caster checkbox flips the preview. Click a
recipient guide to exclude its bloom. The wave still covers the selected zone.
The minion count can be zero through seven per row.

Target Heal has draggable source and destination guides, curved travel, and a
bloom-only option. Coincident endpoints automatically use bloom only. Both modes
offer replay, pause/resume, looping, reset, original material colors or a custom
tint, intensity, timing, density, and size controls. Healing never shakes the board.

Save effects writes the existing template library through its normal desktop
bridge. Coverage and appearance are saved; caster preview, recipient exclusions,
guides, minion count, and dragged endpoints are preview-only.

## Source and adaptations

`scripts/export-healing-vfx.py` reads the installed Unity bundles using the existing
readers in `Assets_Extracted/tools`. It verifies copied PNG hashes against the
extraction manifest. Runtime does not require Hearthstone or those tools.

The three source prefabs are:

- `ReuseFX_Holy_Impact_CircleOfHealing`: mass wave, rays, glow, motes, beam, spiral.
- `ReuseFX_Holy_Missile_Healing`: moving particles and two ribbon materials.
- `ReuseFX_HealImpact_HolyLight_Large`: shared recipient bloom.

All 16 imported textures are named `heal-*.png` under `assets/images/effects/`.
They are registered in the lazy `healing-vfx` bundle. Source IDs, hashes, material
properties, particle curves, and spiral geometry live in `healing-authored.json`,
beside the other authored VFX metadata. Re-export with:

```powershell
python scripts/export-healing-vfx.py
```

This is a Pixi adaptation, not a Unity runtime reproduction. It retains source
textures, colors, cubic size/lifetime curves, particle rotation, trail gradients,
and the spiral mesh and spin speed. The missile's action script supplies its
0.3/0.4-second ribbon lifetimes, animated width, and emission-rate curve.
Billboard projection, seeded particle spread,
emission limits, board clipping, spiral fade, and brightness are adapted to the 2D
board. FXWorld texture coordinates use the local effect surface. Unity scene
lighting, native particle simulation, and PlayMaker transform animation are not
executed. Target travel is a configurable curved path with a 0.7-second base
duration; the timing control scales the whole effect. `healing-layout.ts` records
projection units, exposure, and timing defaults.

Mass coverage uses the board surface footprint separately from recipient positions.
Each floor layer fits its maximum authored expansion; rays and motes keep their
billboard proportions, and beams retain their height. Broad overlapping particles
are exposure-normalized, with separate ring and ray gains. Heroes receive one larger
recipient bloom rather than an additional board-wave stack. Particle start delay
shifts playback but does not advance the emitter's initial-color or size curves.
Mass-heal blooms use their own larger base size, separate from target-heal blooms.
Recipient rings face the screen as circles; the board-wide wave retains its
elliptical shape, with 35% more width and 80% more depth around the selected
board footprint. This spread does not enlarge individual recipient blooms.
Core rays, beams, and afterglow use reduced exposure so the
rings remain readable. The missile has one small star attached to its current
flight position, a narrower ribbon, and a more visible stream of sparks. A single
soft glow stays anchored at the source, rises over 0.1 seconds, and fades during
the last 0.25 seconds of travel. It never emits along the path and is omitted for
self-heals and bloom-only playback. These timings follow the timing multiplier.
Target-heal arrival rings have a thicker shader stroke and stronger bloom.
The lab exposes **Trail particle count**, **Trail particle size**, and **Bloom
strength** sliders; saved presets retain these controls. Older presets acquire
neutral multipliers automatically. Missile captures use the lab's friendly and
enemy hero centers, and the timelapse shows both heroes throughout the flight.
The ground expansion reaches its coverage sooner and stops at its fitted extent,
so enlarging the main pulse does not push the ring outside the selected surface.

`HealingEffect.update(seconds)` is deterministic and supports seeking; `duration`,
`impactSeconds`, and idempotent `dispose()` drive match playback. The match scene
acquires the healing bundle through its asset scope. The presentation queue waits
for impact; the remaining visual tail finishes independently, without screen shake.

## Match coverage

All 61 restore actions across 59 card definitions carry authored VFX references,
including nested choices and triggered effects. Eight definitions use mass healing;
the other 51 use targeted healing. Mass presets cover friendly board and hero,
friendly minions, both boards, all characters, or both heroes. Recipients come from
resolved outcomes, with no fabricated minion slots or blooms on excluded targets.
Positive attempted heals still display on full-health targets; zero-amount heals do not.

Lesser Heal, Heal, and Obelisk's Eye use targeted healing. Siphon Life retains its
damage missile and adds a separate heal. Shared Lifesteal resolution supplies the
same heal for natural, granted, copied, and generated Lifesteal, including Jaina.
Self-heals omit missile travel. Dead sources use their retained board positions;
spells use the caster hero and hero powers use their power plate as the origin.

Healing converted to damage uses the existing shadow damage missile. Hozen Healer
now uses `restore` rather than `set-health`, so healing modifiers and reactions apply.
Binding Heal remains two targeted heals. Holy Nova preserves its enemy damage wave
and then plays friendly mass healing.

## Validation

`node scripts/check-healing-vfx.cjs` runs an isolated hidden Electron/WebGL preview.
It checks coverage, caster flipping, exclusions, empty/full boards, template
round-trips, desktop save payload, pause/reset, self and distant targets,
deterministic seeking, visible output, damage-family switching, and disposal. It
also exercises the real match presenter: impact timing, tails, cancellation,
no-shake behavior, and preservation of shared textures. Match dispatch and catalog
coverage are checked in the existing resolution and presentation test suites.
Frame captures and interactive-lab screenshots go to `.tmp/healing-check/`.
The `aoe/` and `missile/` folders each contain 12 timestamped full-board frames
and a cropped `timelapse.png` contact sheet, rendered using the saved templates.
All PNG captures, including lab and presenter checks, stay in these subfolders;
the capture root contains only the check runner and report.
