# Deck card motion

The existing local normal draw is the choreography reference. Its reveal position,
hold, landing and timing are preserved. Its old deck-silhouette departure has been
replaced with rigid full-card extraction. The original numerical trace remains in
[`scripts/card-motion-local-baseline.json`](../scripts/card-motion-local-baseline.json).
The painted deck is a cropped, distorted half cardback. It supplies the slot
position and entry direction; it is **not** a shape to fit a flying card into.

All card flights, including local draw, project one rigid rectangular plane. Translation,
quaternion rotation, perspective and uniform scale determine all four corners.
There is no independent corner interpolation or correction. Perspective can make
opposite edges converge, but the underlying paper keeps its proportions. The
local draw retains its own path recipe and uses the common projection and renderer.

At rest the full card is half inserted: the top half is exposed, and the bottom
half is inside the deck. Extraction reveals the existing hidden portion without
resizing the card. Insertion reverses that operation. The crop is defined along
the card's own long axis and projected with the same plane as the full card; it
is not a fixed screen-X wipe. Complete mesh vertices and texture coordinates stay
unchanged when masking is toggled. All deck paths share the same seated pose.

## Inventory and counting

There are **16 behavior families / 29 local-or-remote variants** in this scope:
**1 retained, 21 adapted or replaced, and 7 newly animated**. Before this work,
23 variants had a deck transport or reveal implementation; the retired fast draw
now uses the normal draw. The other seven lacked the corresponding flight.
The opening shuffle was removed for both players after visual review. No gameplay action was removed.

A reveal-and-return round trip counts once per side; bulk insertion shares its
single-card path and does not count again. Burn and other deck destruction share
the same departure. The local mulligan-to-hand handoff counts separately because
the remote opening deal already lands in its hand. These are behavioral counts,
not a count of animation classes, methods, or every animation in Hearthstone.

| Family                          | Local    | Remote   | Result / timing in seconds                                                                                             |
| ------------------------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| Normal draw                     | Replaced | —        | Rigid half-card extraction; original 1.0 ascent, 0.75 hold, 10/21 landing.                                             |
| Hidden opponent draw            | —        | Replaced | 1.75 path; turn and scale start at 0.8 and last 0.7.                                                                   |
| Public draw                     | Replaced | Replaced | Local revised extraction; remote 1.75 reveal, existing public hold, 0.525 conceal-to-hand.                             |
| Opening deal                    | Replaced | Replaced | Local 1.5 travel plus 14/15 spread/flip; remote hidden draw path.                                                      |
| Mulligan return                 | Replaced | Added    | 1.5 curved return, authored rotation/scale, 0.5 card stagger.                                                          |
| Mulligan replacement            | Replaced | Added    | Reversed return path/clip, 1.5 per card, 0.5 stagger.                                                                  |
| Mulligan row to hand            | Retained | —        | Existing local handoff and hand layout.                                                                                |
| Tradeable hand to deck          | Replaced | Added    | 0.1 pause, then 0.7 approach and 0.7 insertion. Replacement draw uses the ordinary draw route.                         |
| Existing hand card to deck      | Replaced | Replaced | 1.85 staging plus 0.3 per card, then insertion; retains card identity.                                                 |
| Board card to deck              | Replaced | Replaced | Existing board lift/materialization, then the rigid insertion path.                                                    |
| Generated/copied cards to deck  | Replaced | Replaced | Existing source appearance/glow, then rigid insertion; bulk preparation retained.                                      |
| Reveal-only / Joust round trip  | Replaced | Replaced | 1.2 approach, 0.5 overshooting flip, optional winner pulse, 1.2 hold, 0.8 return. Previously disappeared after reveal. |
| Deck burn/destruction           | Replaced | Replaced | Local revised extraction or remote public reveal, then existing burn shader; never enters hand.                        |
| Deck recruitment to board       | Added    | Added    | 2.0 full-card flight before the existing artwork-aligned board landing. Previously only destination appearance.        |
| Deck recruitment to Secret zone | Added    | Added    | Shared 2.0 deck-to-play flight; badge count advances on arrival. Opponent identity stays concealed.                    |
| Empty-deck fatigue              | Replaced | Replaced | 1.2 travel with delayed turn finishing at 1.35; existing hold/fade retained.                                           |

There are seven draw routing profiles, plus thirteen shared rigid motion profiles
in `card-motion.ts`. The `hidden-draw` profile is exclusively for concealed opponent
cards; local triggered draws and Tradeable replacements use `local-reveal`, including
its hold and landing. No fast sampler or timing setting remains. Three authored
Unity clips supply runtime curves; the extracted shuffle clip remains archived as source evidence.
The old generic direct-draw sampler and straight shrink/fade insertion were
retired. Shared samplers avoid one implementation per inventory row.

## Installed Hearthstone evidence

The inspection reads `C:\Program Files (x86)\Hearthstone` without modifying it or
executing game methods. Managed assemblies supply coroutine timing, waypoints,
Euler angles and easing choices. Three Unity bundles supply clip curves and local
anchor transforms. Evidence is written under `.tmp/card-motion-source/`.

The source audit identified **18 relevant entry points/stages**, grouped below,
and four authored clips. The broader reflection dump contains 374 supporting
method/enum records; those records are not 374 distinct animations.

| Source owner                    | Entry points / stages                                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Card` (7)                      | `DrawFriendlyCardWithTiming`, `DrawUnknownOpponentCard`, `RevealDrawnOpponentCard`, `HideRevealedOpponentCard`, `DoHandToDeckTransition`, `AnimatePlayToDeck`, `AnimateDeckToPlay` |
| `MulliganManager` (4)           | `DealStartingCards`, `RemoveOldCardsAnimation`, `EndMulliganWithTiming`, `ShuffleDeck`                                                                                             |
| `JoustSpellController` (3)      | `ShowJouster`, `RevealJouster`, `HideJouster`                                                                                                                                      |
| `RevealCardSpellController` (3) | `PullRevealedCardFromDeckAnim`, `FlipRevealedCardAnim`, `HideRevealedCardAnim`                                                                                                     |
| `FatigueSpellController` (1)    | `OnFatigueActorLoadAttempted`                                                                                                                                                      |

| Authored clip                  | Duration    | Imported tracks                                       |
| ------------------------------ | ----------- | ----------------------------------------------------- |
| `MulliganCardFlipDownToDeck`   | 1.100000024 | Quaternion and scale, original keys and tangents      |
| `MulliganCardDeck2FlipDown`    | 0.533333361 | Quaternion and scale                                  |
| `MulliganCardFlipFromFaceDown` | 0.933333397 | Quaternion and scale                                  |
| `MulliganDeckShuffle1`         | 2.333333492 | Ten child position tracks, plus constant scale tracks |

Bundle hashes and source path IDs accompany the runtime data in
[`card-motion-authored.json`](../src/scenes/match/presentation/card-motion-authored.json).
The inspected managed assembly SHA-256 values are:

```text
Assembly-CSharp.dll
2408C5EAE3D5AB083B8B290A7278147159E79A3C6E72E1D922EF44028ED16AFB
Blizzard.T5.iTween.dll
04F0721435AC1CD14E68FFEBD373DB46205818CDBD4408D39AD72EE20021E1B3
```

The friendly draw source uses a three-point Catmull–Rom path over 1.5 seconds,
with turn/scale beginning after 0.15. The hidden opponent path has four points and
quartic in/out timing. Insertion aligns over 0.2, turns over 0.3 (0.5 when hidden),
approaches above the deck over 0.7, then descends over 0.7 while shrinking over 0.6.
The source deck angles are `(-90, 270, 0)` and its above-deck offset is
`(-0.3, 3.6, 0)`. These are rotations/translations of a card, not corner skews.
The two stages are world-space approach and insertion, not separate screen-X and
screen-Y movement. The refinement keeps those timings but repositions the approach
near the slot mouth so the projected card no longer travels right and then drops
vertically to fit the painted half cardback.

Unweighted Unity curves use cubic Hermite interpolation with derivatives per
second; quaternion samples are normalized. Unity Euler composition is Y × X × Z.
The installed iTween's `easeInSineOutExpo(0, 1, t)` selects its exponential-out
branch for positive normalized time; the port follows the inspected implementation.
Reveal-only movement uses quartic in/out, with turn and scale delayed until the
second half, followed by an `easeOutBack` flip with overshoot 1.70158.

## Adaptation boundaries

This is a source-informed 2D port, not a claim of pixel-identical Hearthstone
playback. Full Unity camera and ancestor transforms were not reconstructed, and
there is no synchronized live Hearthstone recording comparison. Current canvas
anchors, a 45-pixel source-unit conversion, the oblique camera and hand endpoint
alignment adapt source motion to this board. The local normal draw keeps its
existing duration instead of adopting the source's ordinary 1.5-second draw.

- The shared slot is a mouth position and outward direction derived from the deck
  placement, with independently tunable offsets. It does not read the painted deck
  corners or dimensions. Standard slot flights use a full 620-pixel-wide card at
  0.27 table scale, before the deck placement scale and rigid perspective projection.
  A shared yaw and landscape orientation establish the seated card; the deck
  artwork's dimensions never determine the complete card's proportions.
  Its exposed top edge tilts toward the camera and appears larger; the inserted
  bottom recedes. This depth direction is shared by local draw and the deck recipes.
- Insertion, hand return and Tradeable settle their uniform scale during approach
  and keep it constant while crossing the mouth. This deliberately replaces the
  source's final 0.6-second shrink with progressive occlusion. Reveal return also
  settles size before entry; mulligan uses its authored rotation/scale curves in
  transit and blends to the same seated pose before its final 0.4-second insertion.
- Mulligan rotation adapts to the board camera throughout the approach. Delaying
  that adaptation until scale settling let the source turn cross back onto the
  front, flashing the artwork during return and replacement. Each now changes
  face once. Replacement reverses the complete return pose without an additional
  landing rotation. Both use `mulligan.return`; opening deal uses `mulligan.deal`.
  Their configured timing values are unchanged.
- Local and remote insertion, mulligan, opening deal, opponent/public remote draw,
  reveal and recruitment share the deck geometry with normal/public local
  draws and local burn. Departures start half exposed and returns finish half
  exposed before handing back to the static stack. Nonlocal departures use a
  0.25-second extraction within their existing duration; reveal return uses a
  final 0.25-second insertion. Empty-deck fatigue and hand concealment do not crop.
- Reveal return interpolates into the shared deck orientation. The earlier
  camera-relative rotation made it exactly edge-on for its second half and also
  moved its computed endpoint left; that rotation-dependent endpoint is removed.
- The current shadow caster accepts a complete quad. Its silhouette is suppressed
  once the card crosses the lip, rather than drawing a full-card shadow over the
  deck. A partially clipped shadow is not implemented.
- Local draws use the normal reveal, hold and landing for both turn-start and
  triggered draws. Hearthstone's fast timing, progressive multi-draw tracker and
  global fast-animation option are not used.
- Opening deal retains this game's announcement, Coin and hand orchestration;
  the imported deal/flip stages run inside it.
- Opening shuffle motion is removed from both players and the viewer. The opening proceeds directly to the mulligan overlay and deal.
- Remote opening deal, mulligan return and replacement meshes stay in the remote hand layer below the dark overlay. Local flights retain their raised layer. Layer choice follows presentation state, since engine state can already have advanced before queued replacement flights run.
- Deck recruitment finishes through this game's full-card-to-minion artwork
  alignment. Hearthstone's actor spell/hidden-face transition is not copied.
- Fatigue retains this game's hold/fade and serialized damage presentation.
  Hearthstone begins its fatigue effect after 0.8 seconds, overlapping its flight.
- Reveal-only paths omit Hearthstone's randomized reveal offsets/drift so that
  captures and gameplay comparisons remain deterministic.
- Selected/dragged card tilt behavior is unchanged. Accepted Tradeable releases
  capture the currently displayed pose before ownership transfers to the flight.

## Files and tuning

| File                                            | Responsibility                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `presentation/card-motion-layout.ts`            | Source timing plus explicit canvas adaptations                                       |
| `presentation/card-motion.ts`                   | Pure paths, easing, curve sampling and rigid projection                              |
| `presentation/card-deck-slot.ts`                | Deck placement and extraction direction                                              |
| `presentation/card-flight-visual.ts`            | Shared snapshot, mesh, per-card mask, shadow/effect handoff and cleanup              |
| `presentation/card-motion-visual.ts`            | Motion recipe adapter and deck placement conversion                                  |
| `presentation/card-draw-animation.ts`           | Local draw choreography, rigid extraction and draw routing                           |
| `presentation/card-reveal-presenter.ts`         | Reveal, comparison hold and return orchestration                                     |
| `board/game-board-view.ts`                      | Event routing, remote card identities, mulligan, recruitment and Tradeable ownership |
| `hud/deck-stack-view.ts`, `hud/fatigue-view.ts` | Deck stack and fatigue presentation                                                  |
| `hand/hand-card-perspective.ts`                 | Read-only capture of the displayed drag pose                                         |

Paths above are relative to `src/scenes/match/`. Change position/orientation/scale
or camera parameters to tune a flight. Do not add corner offsets to match the
cropped deck sprite. Keep card aspect ratio fixed throughout a flight.
`slot` in `card-motion-layout.ts` tunes full-card width, mouth offset, yaw,
exposed fraction, approach lift and entry/exit durations. These values describe insertion
geometry, independently of the cropped deck artwork. The viewer uses the same
`CardFlightVisual` renderer as live draw and return animations.

## Visual debugging and verification

The obsolete `.tmp/card-motion-check/` folder has been removed. Run:

```powershell
npm.cmd run view:card-motion
npm.cmd run view:card-motion -- --set=tradeable
npm.cmd run test:card-motion
node scripts/check-card-motion.cjs --set=tradeable
node scripts/check-card-motion.cjs --view
node scripts/check-card-motion.cjs --view --set=mulligan
```

The isolated Electron renderer uses the actual Pixi card, back, board, fatigue,
burn and deck-stack components. It does not start a full match or development
server. `--view` opens a selector, time scrubber, and 1×/½×/¼× playback controls.
It initially selects `draw/local-normal`. Pause or scrub near the deck, then use:

- **Hide inside deck** to toggle cropping at exactly the same timestamp.
- **Show hidden portion** to see the complete card translucently behind its exposed part.
- **Show entry edge** to draw the projected cut edge and a cross at the seated center.

Normal capture mode runs hidden and exits with failure on a failed check.
Viewer startup prints build/open/ready messages and shows errors in the window
and terminal. Close the viewer window to end its process. Viewer and capture modes
use separate Electron profiles; viewer mode must not launch with `windowsHide`.
`node scripts/check-card-motion.cjs --smoke-view` opens a temporary visible viewer,
checks every selection, scrubbing, replay and all three inspection controls, saves
`.tmp/card-motion-runtime/viewer-smoke.png`, and exits. Viewer errors and smoke
checks leave the existing capture gallery untouched.

Open [the capture index](../.tmp/card-motion/index.html). It links contact sheets in:

```text
.tmp/card-motion/
  draw/           public-draw/    deck-insertion/    tradeable/
  mulligan/       opening-deal/   deck-to-board/     deck-to-secret/    reveal/
  burn/           fatigue/        drag/
```

Images use `local-...-0750ms.png` or `remote-...-0750ms.png`; close-ups end in
`-detail.png`. Each contact sheet links full-size images. Three
`local-insert-unmasked-...` comparison frames accompany the insertion capture set.
Frames containing `-hidden-` show the translucent full card and its cut edge for
local draw, insertion and reveal returns. Every set retains local/remote filenames.
Runtime bundles/profile files live separately in `.tmp/card-motion-runtime/`.
`report.json` records check
results; `traces.json` records sampled poses. A partial capture refreshes the index
for its selected sets; run the full command to restore the complete index.

Checks include 60 Hz finite poses, hidden-face protection, fixed aspect ratio,
independent Three.js camera reconstruction of every new rigid projection,
snapshot cleanup, exact dragged-card handoff, WebGL errors, and the original local
draw hold/landing baseline (from 1.0 seconds onward). Departure is intentionally
different, so old departure pixels are no longer an acceptance criterion.
Slot checks cover constant physical size during extraction/insertion, half-exposed
return endpoints at the shared seated center, visible seated cards, and an
independent projection of the crop itself. Cropped cards also assert that the exposed
top edge is larger than the cut edge and inserted bottom, preventing reversed taper.
Face checks sample every flight at 240 Hz, verify the number of face changes and
compare the visible face with the plane's normal. Local and remote mulligan checks
also compare return and reversed replacement geometry, exposure and visible face.
Additional mulligan captures at 600 and 675 milliseconds cover the former flash.
GPU checks exercise straight and rotated
card crops and verify that the hidden-portion overlay is translucent.
Pixel checks ensure clipping preserves the visible texture, does not alter mesh
geometry, leaves neighboring objects visible and cleans up on disposal.
These verify geometry and renderer behavior; visual review still
matters for artistic timing and path placement. The captures exercise individual
flights; focused match tests separately cover event routing and ownership.

The engine-integration validation on 2026-11-11 produced 606 screenshots and
39,599 checks. Maximum independent projection error was `3.22e-13` pixels; the
displayed Tradeable handoff differed by `1.32e-11` pixels. Local draw hold/landing
differed from its original trace by at most `2.28e-13` pixels. The departure is
intentionally replaced. Return-start alignment and interrupted fatigue cleanup
also passed. All cropped endpoints agree with the same complete seated card;
no sampled turn remains edge-on longer than a single 60 Hz frame.
Reversing mulligan replacement reproduced return geometry within `7.20e-13`
pixels, with the same face and exposure at matching times.
Capture startup waits for Chromium to compose its first canvas and retries/rejects
blank captures, which previously could pass as a saved initial frame.
The code-review pass also guards local mulligan continuation after board disposal:
it stops after pending returns/pauses and destroys a replacement that finishes
loading after exit. A regression test reproduced the orphaned card before the fix.
Another test varies return timing independently of deal timing to verify the
sampler and live replacement timeline read the correct setting, then restores it.
The interactive viewer covers 28 flight selections. Fast draw and the two shuffle
selections are removed. The engine audit below exercises event ordering
separately from these individual-flight captures. A full live-match visual run was
not performed.

## Engine integration audit

The engine resolves commands synchronously; `PresentationQueue` serializes their
visual jobs and `activePresentationState` preserves the snapshot for each job.
Flights are awaited before the next event, except explicitly grouped opening,
mulligan and bulk-insertion flights. Such groups await every member before
continuing. Existing random-spell and Secret boundary snapshots remain in use.

| Scenario                        | Engine cue and presentation route                                            | Checks / edge cases                                                                                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal and public draws         | `opening-card-drawn` / `card-drawn` → `presentDraw` → `animateDeckDeparture` | Turn-start and triggered draws share the normal reveal/hold; actual hand endpoint; empty/full hand; hidden remote backs; remote public face then concealment.                         |
| Opening / mulligan              | Initial deal; `mulligan-resolved` → local/remote return and replacement      | Three/four cards, keep all, partial/all returns, replacement order independent of row position, asset completion order, selection blocked until completion, Coin/row-to-hand handoff. |
| Tradeable                       | `card-traded` → shared `trade`, then ordinary `card-drawn`                   | The exact released card stays owned until insertion finishes; remote back identity is preserved.                                                                                      |
| Existing hand / board returns   | `deckAddition` or `cardMovement` → `hand-return` / `insert`                  | Preserves the existing instance; owner/controller differences; board materialization; copied versus moved cards; bulk order and disposal.                                             |
| Generated/copied deck additions | `deckAddition` → `presentDeckAddition` → `insert`                            | Single/bulk preparation, source location, hidden/public identities, insertion before a subsequent draw (Map to the Golden Monkey).                                                    |
| Reveal and Joust                | `cardReveal` → `CardRevealPresenter`                                         | Win, loss, tie, either/both empty decks, return before the winning consequence; reveal-only does not move a rules card.                                                               |
| Deck burn / destruction         | `card-burned` with deck origin → `presentDeckBurn`                           | No hand insertion, public burned identity, repeated overdraw, correct source deck for a stolen card that burns. Non-deck discards keep their own route.                               |
| Recruitment / deck swap         | `minion-summoned.sourceZone === 'deck'`; `replacedDeckCard` snapshot         | Local/remote and mixed batches await full-card flights. Madam Goya waits for outgoing insertion and incoming recruitment; the incoming action-time snapshot survives later effects.   |
| Secret recruitment              | `effect-resolved.deckToSecret` → shared `deck-to-play`                       | Mad Scientist, Mysterious Challenger, Glacial Mysteries; duplicate prevention and five-Secret cap; count advances per arrival; hidden remote identity; completion/disposal cleanup.   |
| Cross-deck hand transfer        | `card-generated.origin.kind === 'deck'` → `presentDraw`                      | Death Grip uses the source participant's deck; Auctioneer can fill the hand before the steal, which now follows the source-deck burn path.                                            |
| Automatic on-draw summon        | Tortollan Ninja draw followed by `minion-summoned` from `revealed`           | The card leaves the deck once; its automatic summon cannot start a second deck departure.                                                                                             |
| Empty deck / pause / exit       | `fatigue` then damage; board-owned animation scopes                          | Repeated fatigue waits before each damage event; fatigue pauses/resumes with the board, including when started while paused. Late draw/replacement assets are destroyed after exit.   |

Catalog inspection distinguishes actual deck recruitment from hand recruitment,
generated summons and copies such as Barnes. Those keep their existing non-deck
entry paths. Varian Wrynn and Tortollan Ninja already draw before entering play.
No gameplay action was removed. Goya's extra arrival is a presentation call only;
it does not add an engine summon event or retrigger gameplay effects.

The obsolete local-sampler mulligan/mirrored-opponent branches and their tuning
fields are removed. Transport contracts no longer accept an ignored duration;
the selected motion profile owns flight duration. Local and remote mulligan now
read the same stagger setting. The old nonuniform deck-preparation scales and
alternating skews are removed; resting layout is applied before the shared flight
captures its destination. Hand layout, generated-card appearance and board
materialization tweens remain because they are distinct stages, not legacy deck
paths.

New event snapshots are masked in the public projection: opponent Secret identity
and private deck provenance are not exposed. HUD updates after draws and burns use
the current presentation snapshot rather than a newer queued engine state.

Validation results for this integration pass:

- All **86 focused animation routing/lifecycle tests** passed.
- All **130 engine presentation integration tests** and **117 opening-match tests**
  passed. Secret recruitment now enforces the existing five-Secret limit before
  removing a card from its source, including when a sixth distinct Secret is available.
- The broader four-file run passed **757 tests** and reported **7 failures outside
  deck motion**: four control disappearance expectations (including a live 1.7
  versus expected 1.8 second duration), one pointer/hover expectation, and two
  Auchenai/healing-value expectations. Their live tuning and behavior were not
  changed. Reports are `.tmp/card-motion-engine-audit.json`,
  `.tmp/card-motion-routing.json`, and `.tmp/card-motion-engine-contracts.json`.
- Renderer TypeScript, scoped ESLint and dependency boundaries passed. The viewer
  earlier smoke check passed for all 31 selections (before shuffle removal), scrubbing, replay and crop controls.

This covers the catalog's deck-transport mechanisms and the listed boundary cases;
it does not claim exhaustive testing of every possible multi-card interaction.

The subsequent mulligan refinement removes opening shuffle playback for both
players and keeps every remote deal/return/replacement flight below the dark
overlay. Four regression cases failed before the change and passed afterward;
all 78 selected motion/lifecycle checks, renderer TypeScript and scoped ESLint
passed. The updated viewer smoke check passed with 29 selections. Other motion
paths and timing values were unchanged.

Fast draw was subsequently removed from runtime routing, tuning and the viewer.
Triggered local draws, Tradeable replacements and draws from the other player's
deck now use the normal local reveal and hold. Hidden opponent draws retain their
1.75-second timing. All 82 focused checks, renderer TypeScript, scoped ESLint and
the 28-selection viewer smoke check passed. Refreshed draw captures produced 48
screenshots and passed 24,060 geometry/renderer checks; the original local
hold/landing trace remains within `2.28e-13` pixels.

To repeat the focused match checks without discovering old `.tmp` backups:

```powershell
node node_modules/vitest/vitest.mjs run --exclude '**/.tmp/**' src/scenes/match/presentation/presentation-queue.test.ts -t 'engine-driven minion card departures|local draw profiles|deck motion dispatch and ownership|deck addition animation|Joust reveal choreography|opponent-turn hand pickup|gates mulligan selection|keeps mulligan animations|settles failed opening-card|discards late opening'
```

The source evidence can be regenerated with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/inspect-card-motion.ps1
python scripts/export-card-motion.py
```

These scripts depend on the existing local helpers in Hearthstone's
`Assets_Extracted/tools/`; the exporter needs that helper's Python dependencies.
The first command changes execution policy only for that process. The exporter
rewrites the runtime clip JSON, so review the resulting data diff after an installed
game update.

## Local mulligan choreography refinement

Local initial deals and replacements now use the original checkpoint positions,
angles and gradual straightening recovered from revision `38afdfa`, adapted to
the current rigid full-card extraction and card-axis mask. Initial deals retain
2.433-second playback and replacements retain 1.5 seconds, with 0.5-second
staggering. Neither pauses at the reveal. Local return flights remain unchanged;
local replacement is no longer a reversal of that return. Remote replacement
still reverses its return. The viewer uses the same restored sampler as gameplay.
The earlier Unity opening-clip description above documents the preceding version.

Local mulligan timing is now restored as well: both incoming local flights use
0.8 seconds of approach and 0.5 seconds of settling (1.3 seconds total), with
the original 0.5-second stagger and no reveal pause. This supersedes the retained
durations described in the preceding refinement. Remote and return timings are unchanged.
