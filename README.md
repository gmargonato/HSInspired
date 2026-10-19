# HSInspired

HSInspired is a Hearthstone-inspired collectible card game for desktop. Build a
collection, create decks, and play turn-based matches against AI opponents.

## Game modes

- **Constructed:** Build a 30-card deck and play matches with your chosen cards.
- **Arena:** Choose a hero, draft a 30-card deck, and play until 12 wins or 3
  losses. Runs earn rewards.
- **Tavern Brawl:** Play a special preset-deck challenge. The current brawl gives
  both players 30 Unstable Portals.

## Cards and effects

Cards come in four types: minions, spells, weapons, and hero cards. Minions stay
on the board and fight; spells resolve when cast; weapons let heroes attack;
hero cards replace your hero and grant armor.

Effects can deal damage, heal, draw cards, summon minions, change stats or
keywords, freeze or destroy targets, generate cards, and trigger from game events.
Common mechanics include:

- **Battlecry** happens when a minion is played; **Deathrattle** happens when it
  dies. **Secrets** trigger in response to an opponent's action, while **Auras**
  continuously affect cards as long as they are active.
- **Discover** offers a choice of cards. **Overload** locks some mana crystals on
  your next turn.
- **Tradeable** lets you drag Big Game Hunter or The Black Knight from your hand
  onto your deck to spend 1 mana and draw a different card. Trading preserves the
  card's buffs and the order of the other cards, and requires a nonempty deck.
  AI opponents do not choose trades yet.
- **Taunt** forces enemy attacks onto a minion when possible. **Rush** lets a
  minion attack enemy minions right away; **Charge** allows immediate attacks.
  **Windfury** grants an extra attack.
- **Divine Shield** blocks one instance of damage. **Stealth** and **Elusive**
  limit targeting. **Lifesteal** heals your hero when its source deals damage;
  **Poisonous** destroys minions it damages; **Spell Damage** boosts spell damage.

## Card sets

The catalog currently includes cards from Basic, Classic, Curse of Naxxramas,
Goblins vs Gnomes, Blackrock Mountain, The Grand Tournament, League of Explorers,
Whispers of the Old Gods, One Night in Karazhan, Mean Streets of Gadgetzan,
Journey to Un'Goro, and Knights of the Frozen Throne.

## Visual effects

The game features animated card auras, premium card appearances, board shadows,
ghostly mist and particles, card and Secret reveals, combat, and selected
hero-power animations. In development, press **F3** to toggle GPU effects.

Ghost UI uses the extracted mulligan glow atlas, scrolling clouds, two smoke
layers, light motes, and floating-button evaporation textures. Shader Lab's
**Reset Ghost** restores the recovered material and particle defaults; white
palette controls preserve the original colors. Banners shrink over 0.5 seconds,
while buttons play a blue echo, hide at 0.2 seconds, and evaporate through a
1.7-second cleanup window. Separate text fades over 0.3 seconds; lettering baked
into an image hides with that image. [Ghost reference](docs/ghost-effect-reference.md)
records verified behavior and remaining adaptations. Local inspection evidence
in `Artifacts/ghost-reference.json` includes source IDs and texture hashes.
`npm run test:ghost` runs isolated WebGL pixel/lifecycle checks and captures the
Ghost page of Shader Lab under `.tmp/ghost-check`. It also exercises production
mulligan, Discover/Cancel, reward confirmation, and startup shader warm-up.

In-match deck additions materialize at their source with a growing card and blue
glow before flying into the destination deck. Every card in a bulk shuffle is
shown with overlapping flights. Hidden hand/deck copies use card backs where their
identities are private; existing board-minion movements retain their animation.
The catalog has 22 direct deck-addition cards, plus Ninja returns enabled by
Master Dusk. Prince Malchezaar's opening setup is separate.

Damage, freeze, and character-destruction shaders are opt-in: set an action's `vfx` key in
its card JSON. Hero powers declare the key beside their effect in
`src/game-rules/content/hero-powers/hero-power-catalog.ts`; card-authored power
overrides and generated Kazakus ingredients carry their own explicit keys.
An omitted key produces no shader. `config/vfx-templates.json` owns the reusable
fire missile and fire AoE tuning, including explicit friendly/enemy coverage.
Repeated hits play individual missiles; simultaneous hits share an impact boundary.
Power missiles start at the power center, minion effects at the visible source,
and spells or missing sources at the controller's hero.

Fireball uses the extracted medium missile, idle and impact prefabs' textures,
particle curves and material equations through one renderer shared by matches and
the VFX Lab. A fresh cast grows its three rotating cores over 300 ms, reaches Idle
after one second, then launches. The saved `durationMs` controls flight only
(400 ms by default); the gameplay cue occurs at arrival and particle tails finish
independently. Callers that already presented Idle can use the renderer's
`prewarmed` path. Bloom uses separate color and alpha blur at the native reduced
resolutions. Sphere projection, particle physics and board lighting remain
adaptations. `Artifacts/fireball-reference.json` records source assets and the
implementation comparison; `npm run test:fireball` captures isolated WebGL frames
and checks shader pixels, saved tuning, playback and cleanup.

Fire-blast templates use the extracted wisp, smoke, ember, impact and color-ramp
textures. Bright, multiplicative-dark and smoke particles build a 256×256 heat
texture; its red channel selects fire color and opacity. Full-board and half-board
presets have separate emission rates and lifetimes. Target bursts come from event
target IDs, independently of the board coverage. The default gameplay cue is 500 ms;
the visual tail continues on its own timeline.
Minion impact bursts are off by default. Enable **Minion impact bursts** in the
VFX Lab to restore them for a template (`fire.minionImpacts`). Hero target impacts
remain enabled. This setting affects visuals only, not the affected targets or
gameplay cue.

In the VFX Lab, these templates expose particle density, size, motion, ramp, glow,
timing and target-preview controls. All AoE templates use this renderer through
`tuning.fire`. Fire animation speed uses `fire.timingScale`; missile duration uses
`durationMs`.
Choose **Original fire** to retain the extracted ramp, or **Custom colors** to set
the cool edge, main flame, and hot core. Custom ramps retain the original opacity
curve. Glow, embers, and impacts follow the palette unless their color override is
enabled; smoke tint and opacity are independent. Appearance is saved under
`fire.appearance`. Turbulence and separate smoke/ember amount and persistence
controls are saved under `fire.dynamics`; omitted settings preserve the default
effect. Turbulence is smooth and seeded, and persistence updates cleanup timing.
Use **Create copy** and **Save effects** to keep a variation as its own template.

Missile and AoE templates expose **Impact shake** (On by default) and **Shake
intensity** (0–3×, default 1×). A medium kick moves the board by up to 8 design
pixels over 180 ms; intensity changes displacement, and 0 suppresses shaking.
Each landing refreshes the shake without stacking beyond the strongest active
impulse. Shake starts at the gameplay impact cue, independently of the remaining
visual tail, and does not delay damage resolution. The Lab previews the same
shake while its HTML controls stay still. Settings save as
`tuning.impactShake: { enabled, intensity }`; omitted settings mean On at 1×.

Missiles expose **Path curvature** (−1 left, 0 straight, +1 right, relative to
travel) and **Tail irregularity** (0 smooth, 1 original Fireball, 2 stronger billows).
Curvature is continuous; at either extreme the path bows by 25% of the source-to-target
distance. Flame, glow, smoke, and sparks follow the curve. Tail irregularity blends
a smooth, continuous tapered ribbon into the original flame's uneven outline and
texture; higher values exaggerate folds and erosion. A smooth trail has no loose
smoke or sparks. This controls appearance independently of flight time, head
rotation, and impact timing. These settings save as `pathCurvature` and `tailMotion`; omitted
values preserve a straight path and original Fireball appearance.
**Nature** uses the small missile's timing and size with a green palette and a
straight path for Leper Gnome. **Nature — Left curve** supplies the same palette
with maximum left curvature for existing Druid Nature missiles (including both
Wrath choices). Arcane missiles use maximum right curvature.

The VFX Lab derives board-effect placement from the match layout with the same
translation as the board artwork. Heat filters retain their full quad bounds so
viewport clipping cannot stretch or reposition the fire. Flame and smoke billows
can extend beyond their emitter footprint.
The board glow has a soft outer feather to bridge the filled center and moving
flame rim. Its quad includes transparent margins so that feather remains unclipped;
the original mask mapping and particle geometry stay fixed.
Enemy-board inner fill extends toward the center seam independently of the flame
footprint; its depth is tuned with `boardGlowDepthScale` in `fire-aoe-layout.ts`.

`fire-aoe-authored.json` retains the extracted emitter vertices/normals, particle
delays, and emission, size, color, rotation, and speed-limit curves. Particle clocks
continue independently of state changes. Board smoke and embers use separate
billboards so half-board coverage does not flatten them. Smoke and impact material
equations follow the inspected shader bytecode. Board glow uses the coverage mask
without a dissolve texture. Post-fire smoke uses reduced
counts, emission windows, lifetimes, and travel speeds in `fire-aoe-layout.ts` to keep
the tail brief and local; its cloud size and blending are preserved. Ember emission
and lifetimes are shortened, and cleanup follows the last particle and board fade
instead of a fixed wait. World-to-screen projection, native velocity damping,
and scene lighting remain adaptations; the original global
bloom pipeline is not reproduced. See the implementation addendum in
`Artifacts/fire-explosions.md`.

`npm run test:fire-aoe` runs a hidden, isolated Electron/WebGL check (no game or
server) and writes a contact sheet/report to `.tmp/fire-aoe-check`.

## Run locally

Requires Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Development sessions keep running while source files are edited: automatic hot
updates, reloads, and renderer file watching are disabled. Stop the development
command and run `npm run dev` again to apply changes, including desktop code.
The FPS counter and controls remain active during edits.

This preserves already-loaded code, rather than taking a snapshot of the entire
project. Assets, developer tools, or AI workers first loaded later can still read
changed files. Existing live tuning controls continue to work.

## Verify changes

```bash
npm run assets:check # Verify artwork resolution, aliases, and served images
npm run verify      # Formatting, lint, assets, all tests, types, dependencies, build
```

Artwork verification uses the actual Vite asset pipeline and does not launch the
game. The full verification command includes the production build smoke check.

Card artwork uses original extracted illustrations, exported as opaque RGB PNGs
into `assets/images/card-artwork` under the existing game card IDs. Importing
discards the source alpha masks while preserving dimensions and every RGB pixel;
the extracted originals stay untouched.
`scripts/card-artwork-sources.json` records the Hearthstone IDs, extracted source
paths, and source/runtime image hashes. To reimport from `assets/original`, run
`npm run assets:import`; replaced files are preserved in ignored
`.tmp/card-artwork-backups` folders. Darkspear Hunter shares Houndmaster's artwork.

## Card behavior campaigns

The headless card campaign runner inventories authored, static generated, and
dynamic Zombeast entries. It records replayable setup, commands, state snapshots,
event traces, assertions, and progress under `Artifacts/card-testing/`.

```bash
npm run cards:test -- preflight
npm run cards:test -- start [campaign-id]
npm run cards:test -- status <campaign-id>
npm run cards:test -- pause <campaign-id>
npm run cards:test -- resume <campaign-id>
npm run cards:test -- replay <campaign-id> <scenario-id>
npm run cards:test -- report <campaign-id>
```

Campaigns freeze source and catalog fingerprints. Start a linked campaign with
`--parent <campaign-id>` after changing inputs. The baseline checks command
acceptance, match invariants, and seeded replay. The interaction phase revisits
every entry with mixed boards, weapons, companion actions, post-card hero power
and hero attack attempts, and both turn boundaries. It resolves pending choices
with the first legal option and records effect-trace paths and bystander changes.
Trace evidence does not establish semantic correctness. The completed card audit
and its actionable findings are consolidated in `Artifacts/card-testing/REPORT.md`;
temporary campaign outputs were removed. Progress is indexed in
`Artifacts/CARD_TESTING_PROGRESS.md`.

## Find the code

Scenes live directly under `src/scenes`. See [the source guide](src/README.md)
for visual components, game rules, application navigation, development tools,
and desktop services.
