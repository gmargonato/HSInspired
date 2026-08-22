# PLAN — Phase 1: Placing Minions on the Board

Status: approved scope, ready for implementation.
This document is self-contained: it gives every fact, file reference, and decision
needed to implement the phase without re-deriving context. Read `AGENTS.md` first —
it is the authoritative engineering guide and every rule in it applies.

---

## 1. Goal

The local (human) player can play a Minion card from their hand onto their half of
the board, Hearthstone-style:

- Maximum **7 minions** per side (`MAX_BOARD_SIZE = 7`).
- The player chooses the **insertion position**: dropping a minion between existing
  minions inserts it there, and the row **automatically rearranges** (the other
  minions slide to make room and re-center).
- While the player carries a minion over their board half, the existing minions
  **slide apart live** to open the gap where the minion would land. This is the
  Hearthstone placement preview — see §7.3 and §8.4 for exactly what it means.
- Board minions render as: **oval-cropped artwork → `minion-frame.png` →
  (if legendary) `minion-frame-legendary.png` → (if taunt) `minion-taunt.png` →
  (if divine shield) `minion-divine-shield.png` → attack & health badges on top**.
- **No effects, no combat, no trait behavior** in this phase. Taunt/divine shield
  are wired as always-off flags so future phases only flip a boolean.

### Out of scope (future phases)

- Attacks, combat, minion death, exhaustion, windfury, etc.
- Taunt/divine shield _gameplay_ (the card JSON has no trait fields yet; the flags
  exist only as renderer hooks defaulting to `false`).
- The AI playing cards: **the remote board stays empty this phase** (confirmed).
- Hovering/zooming board minions, minion name banners, summon/battlecry effects.
- Playing spells or weapons (only `type: 'Minion'` cards can be played).

---

## 2. Facts about the current codebase (verified)

Read these files before starting; line numbers refer to the working tree at plan time.

### 2.1 Match engine — `src/game/match/opening-match.ts`

- Pure, platform-neutral, deterministic (seeded RNG). Commands go through
  `match.dispatch(command)` returning `OpeningCommandResult`
  (`{ accepted: true, state, events }` or
  `{ accepted: false, code, message, state, events: [] }`).
- State: `OpeningMatchState { phase: 'mulligan' | 'turns', activePlayerId,
turnNumber, players: [OpeningPlayerState, OpeningPlayerState], revision }`.
- `OpeningPlayerState { participantId, controllerKind, heroId, playerNumber, deck,
hand, mana: { available, maximum }, heroPower, mulliganConfirmed }`.
  **There is no board yet.**
- Existing commands: `confirm-mulligan`, `end-turn`, `use-hero-power`.
  - `parseCommand` (~line 204) validates raw input.
  - `end-turn` / `use-hero-power` are routed in `dispatch` **before** the
    `phase !== 'mulligan'` gate; a new turns-phase command must be routed the same way.
- Rejection codes today: `invalid-command`, `unknown-participant`, `wrong-phase`,
  `already-confirmed`, `invalid-card-selection`, `not-active-player`,
  `hero-power-unavailable`, `insufficient-mana`.
- `MAX_HAND_SIZE = 10` and `MAX_MANA = 10` are exported constants — follow that
  pattern for `MAX_BOARD_SIZE`.
- `clonePlayer` / `cloneOpeningMatchState` deep-clone the state; a new `board`
  field must be cloned there too.
- Cards in hand/deck are `OpeningCard { instanceId, cardId }`. Instance IDs look
  like `"<participantId>:deck:<ordinal>"`.
- Tests live beside the module: `opening-match.test.ts`. Helpers there:
  `makeDeck(id, cardId)` builds a 30-copy deck of one card; `makeSetup(seed)`
  builds human (`jaina`) vs AI (`guldan`). Confirming mulligan for both
  participants emits `coin-granted`, `opening-turn-started`, `opening-card-drawn`
  and starts turn 1.

### 2.2 Card content — `src/game/content/cards`

- `CardDefinition` is a discriminated union; `MinionCardDefinition` has
  `type: 'Minion'`, `attack: number`, `health: number`, plus metadata (`cost`,
  `rarity`, …). There are **no trait fields** (taunt/divine shield) yet.
- `CARD_CATALOG.require(cardId)` / `.get(cardId)` resolve definitions.
- Useful cards for tests/manual QA (verified in the JSON sets):
  - `basic_murloc_raider` — Minion, cost 1, 2/1, Free.
  - `basic_stonetusk_boar` — Minion, cost 1, 1/1, Free.
  - `basic_bloodfen_raptor` — Minion, cost 2, 3/2, Free.
  - `basic_senjin_shieldmasta` — Minion, cost 4, 3/5, Free.
  - `classic_leeroy_jenkins` — Minion, cost 5, 6/2, **Legendary**.
  - `basic_fireball` — Spell (used by existing tests; handy for non-minion cases).

### 2.3 Renderer feature — `src/renderer/features/game/game-board-view.ts`

`GameBoardView extends Actor` owns the whole match presentation. Key members:

- Layers added in order (child order = draw order): `boardLayer`, `heroPowerLayer`,
  `openingLayer`, `heroLayer`, `deckLayer`, `turnLayer`, `mulliganLayer`,
  `travelLayer`, `remoteHandLayer`, `handLayer`.
- `handEntries: HandEntry[]` — ordered hand model:
  `{ card: OpeningCard, slot: GameCardSlot, restTransform, displaced }`.
- `match` (`OpeningMatchInstance`), `localParticipantId`, `remoteParticipantId`.
- `presentEvent(event)` (~line 953) is a `switch` over `OpeningMatchEvent['type']`.
  Adding a new event type to the union makes this switch non-exhaustive — a new
  `case` is mandatory (the typecheck enforces it).
- `syncTurnHud(state)` refreshes deck counts, mana labels/tray, playable outlines,
  hero power views.
- `createSlot(card)` builds a `GameCardSlot` (a `Container` wrapping `CardView`),
  loading artwork via `this.resolver.loadArtwork(card.cardId)`
  (`CardAssetResolver`, `src/renderer/ui/asset-registry/card-asset-resolver.ts`).
- `applyHandLayout({ positionDuration, scaleDuration, delayedInstanceId? })`
  re-fans the hand with animation after structural changes; it stores
  `restTransform` per entry and is guarded by the `reflowing` flag.
- `addLocalCard(card)` (draw presentation) is the best template for
  "create slot → travel layer → animate → reflow hand".

### 2.4 Current hand interaction (AUDITED — preserve exactly)

- **Pickup**: left `pointerdown` on `handLayer` → `onHandPointerDown` (~line 1407):
  ignores non-left buttons and reflow; resolves the card under the pointer via
  `resolveHandHover`; not the local turn → ignored; cost > available mana →
  `shakeCard` ("no" wobble); otherwise `beginDrag(index, pointer)` (~line 1460):
  the card straightens, scales to `DEFAULT_HAND_DRAG.dragScale` (0.25), gets
  `zIndex 1000`, its playable outline switches to blue via `HandCardPerspective`,
  the cursor becomes `grab`, and a `gsap.ticker` loop (`stepDragFrame`) lerps the
  slot toward the pointer with resistance (`hand-drag.ts: stepDrag`).
- **Follow**: `handLayer.on('globalpointermove')` (~line 1378) updates
  `dragPointer` on every move **regardless of button state** — the card sticks to
  the cursor even after the mouse button is released.
- **Cancel**: right-click anywhere (`handleWindowPointerDown`, a window capture
  listener checking `event.button === 2`, ~line 308), `handLayer` `rightdown`
  (`onHandRightDown`, ~line 1448), or window blur (`handleWindowBlur`) →
  `endDrag()` (~line 1548) → animates the slot back to its **rest** hand transform
  → `finishDrag` restores all transient drag state.
- **GAP (verified)**: there is currently **no drop** — no `pointerup` handling and
  no second-left-click handling. Once picked up, a card stays attached until
  right-click/blur. The interaction contract in §3 therefore requires a small,
  carefully scoped addition; everything listed above must keep working unchanged.

Other relevant pieces:

- `hand-layout.ts`: pure fan math (`layoutHand`, `resolveHandHover`,
  `handHoverHitBounds`) — the precedent for the board row math.
- `game-scene-layout.ts`: `GAME_BOARD_LAYOUT` — fixed placements via `placement()`
  plus parameterized spreads (mulligan `cards`, `remoteHand`, mana `crystals`).
  Board art: 1573×1080 centered at (960, 540). Heroes: local (985, 825), remote
  (985, 180), both 345×433 at scale 0.5.
- `mana-tray.ts` / `hero-power-view.ts`: good templates for small texture-driven
  view components.
- `rendering/layout/index.ts`: `placement()`, `applyPlacement`,
  `applyAnchoredPlacement`, anchors `TOP_LEFT/TOP_CENTER/CENTER/BOTTOM_CENTER`.

### 2.5 Asset registry — `src/renderer/ui/asset-registry/index.ts`

- Assets are imported from `@assets/...`, registered via
  `asset(key, bundle, alias, source, authoredWidth, authoredHeight, owner)` into
  `bespokeAssetDefinitions`, grouped into lazy bundles
  (`ASSET_BUNDLE_IDS.game` = `'game'`), and surfaced as typed interfaces
  (`GameAssets`) acquired by scenes via
  `assetScope.acquire<GameAssets>(ASSET_BUNDLE_IDS.game)`.
- `GameScene.init` already acquires the `game` bundle and passes it to
  `GameBoardView` as `options.gameAssets`.
- `asset-registry.test.ts` guards key uniqueness and specific registrations.

### 2.6 Board minion assets (verified pixel sizes)

Files under `assets/images/board/` (never delete or rename asset files):

| File                         | Size (w×h) | Purpose                                 |
| ---------------------------- | ---------- | --------------------------------------- |
| `minion-frame.png`           | 119×161    | Base minion frame (oval portrait frame) |
| `minion-frame-legendary.png` | 136×99     | Legendary overlay on top of the frame   |
| `minion-taunt.png`           | 136×183    | Taunt ring (future; wired, hidden)      |
| `minion-divine-shield.png`   | 125×167    | Divine shield (future; wired, hidden)   |
| `minion-attack.png`          | 44×51      | Attack badge (bottom-left)              |
| `minion-health.png`          | 38×54      | Health badge (bottom-right)             |

Other files in that folder (`weapon.png`, `hero-immune.png`, `minion-inspire.png`,
`minion-trigger.png`) are **not** part of this phase.

---

## 3. Interaction contract (required end state)

The hand interaction must feel exactly as it does today, plus a drop resolution.
Both Hearthstone input styles must work:

1. **Drag & drop** — press an affordable card on your turn, hold, move it, release:
   - Release over your board drop zone with a Minion card and a free board slot →
     play it at the insertion index under the pointer (§8.3).
   - Release anywhere else (or non-minion card, or engine rejects) → the card
     returns to its rest hand position (today's `endDrag` behavior).
2. **Click to select, click to commit** — press and release a card _without_
   moving it beyond a small threshold: the card stays attached to the cursor
   (today's sticky behavior — unchanged). Then:
   - **Left click anywhere** → drop at the pointer position (same resolution as
     the drag release above).
   - **Right click** → cancel, card returns to hand (already implemented — keep).
3. While a card is carried over the local drop zone, the board row previews the
   insertion gap live (§7.3, §8.4); leaving the zone restores the normal row layout.

Implementation notes for the addition (keep it minimal and surgical):

- Add a **move threshold** to classify press→release as "click" vs "drag": record
  the pointer position at `beginDrag`; if the pointer never moved more than ~10
  design-px, treat release as "keep attached" (selected state), otherwise treat
  release as a drop attempt. Keep the constant with the drag tunables
  (`hand-drag.ts` config or a feature-local constant).
- Add a window-level `pointerup` handler (capture) alongside the existing
  `handleWindowPointerDown` / `handleWindowBlur` (register in `activateHandHover`,
  remove in `dispose`).
- Extend `handleWindowPointerDown`: when a card is attached
  (`draggingIndex !== null`) and `event.button === 0`, resolve the drop at the last
  known pointer position. Keep the existing `button === 2` cancel path untouched.
  The drop click is consumed (it must not pick up another card).
- Drop resolution must be **synchronous in its state bookkeeping** (set flags like
  `dragReturning` / `reflowing` before awaiting animations), mirroring how
  `endDrag` / `confirmMulligan` guard against re-entrancy.
- Do not touch hover logic (`resolveHandHover`, `applyHoverDelta`), the shake, the
  playable outlines, mana-tray highlighting, or right-click cancel.

---

## 4. Step 1 — Domain: board state + `play-minion` command

File: `src/game/match/opening-match.ts` (tests: `opening-match.test.ts`, colocated).
No renderer/pixi/node imports — pure domain. Follow the existing command pattern
(`applyEndTurn` / `applyUseHeroPower` are the templates).

### 4.1 Additions

```ts
export const MAX_BOARD_SIZE = 7

/** A minion in play. Stats are current values (base today; buffs later). */
export interface BoardMinion {
  readonly instanceId: string // carried over from the hand card's instanceId
  readonly cardId: CardId
  readonly attack: number
  readonly health: number
}
```

- `OpeningPlayerState`: add `readonly board: readonly BoardMinion[]` (initialize
  `[]` in `createPlayer`; clone it in `clonePlayer`).
- Command:

```ts
export interface PlayMinionCommand {
  readonly type: 'play-minion'
  readonly participantId: PlayerId
  readonly cardInstanceId: string
  /** Insertion index into the player's board row: 0..board.length inclusive. */
  readonly position: number
}
```

- Add it to `OpeningMatchCommand`; parse it in `parseCommand` (`cardInstanceId`
  must be a string and `position` a non-negative integer — otherwise return null so
  the dispatch rejects as `invalid-command`).
- Event:

```ts
export interface MinionPlayedEvent {
  readonly type: 'minion-played'
  readonly participantId: PlayerId
  readonly minion: BoardMinion
  readonly position: number
}
```

- Add it to the `OpeningMatchEvent` union.
- New rejection codes (extend `OpeningRejectionCode`): `'not-a-minion'`,
  `'board-full'`, `'invalid-position'`. Reuse `'invalid-card-selection'` for
  "card not in hand".

### 4.2 `applyPlayMinion(state, playerIndex)` — validation order

1. `phase === 'turns'` → else `wrong-phase`.
2. Active player check → else `not-active-player`.
3. A card with `cardInstanceId` exists in that player's `hand` → else
   `invalid-card-selection`.
4. `CARD_CATALOG.get(card.cardId)` resolves and `type === 'Minion'` → else
   `not-a-minion`.
5. `mana.available >= definition.cost` → else `insufficient-mana`.
6. `board.length < MAX_BOARD_SIZE` → else `board-full`.
7. `Number.isInteger(position) && 0 <= position <= board.length` → else
   `invalid-position`.

On accept: remove the card from `hand`, spend mana (`available - cost`; `maximum`
unchanged), create
`BoardMinion { instanceId, cardId, attack: definition.attack, health: definition.health }`,
**insert it at `position`** (splice semantics), bump `revision`, and emit exactly
one `minion-played` event. Route the command in `dispatch` beside `end-turn` /
`use-hero-power` (before the mulligan-phase gate).

### 4.3 Tests (colocated, follow the existing helpers/style)

- Happy path: after both mulligans confirm (turn 1 starts), play a cost-1 minion
  from a `basic_murloc_raider` deck: accepted; the hand loses that instance; mana
  is spent; the board gains the minion with base stats; one `minion-played` event
  with `position: 0`.
- Insertion order: grow a board to 2 minions (play on turn 1 → `end-turn` → the
  other participant `end-turn`s back → play on turn 2), then play a third with
  `position: 1` and assert the resulting `cardId` order. Also assert
  `position === board.length` appends.
- Rejections (each asserts `accepted: false`, the `code`, and unchanged state):
  - `wrong-phase` before mulligan confirms.
  - `not-active-player` when the remote tries to play on the local turn.
  - `invalid-card-selection` for an instance id not in hand.
  - `not-a-minion` for a spell (use a `basic_fireball` deck).
  - `insufficient-mana` for a minion costing more than available mana.
  - `invalid-position` for `-1` and `board.length + 1`.
  - `board-full`: drive a game with cost-1 minion decks, alternating local plays
    and `end-turn` dispatches from both participants (the engine is
    controller-agnostic), until the board holds 7; the 8th play is rejected. Keep
    it deterministic with a fixed seed; a small local helper looping
    "play one → end turn → opponent ends turn" is fine.

---

## 5. Step 2 — Register the board assets

File: `src/renderer/ui/asset-registry/index.ts`.

- Import the six PNGs from `@assets/images/board/...` at the top with the other
  imports.
- Add six `asset(...)` entries to `bespokeAssetDefinitions`, in the `game` bundle,
  owner `'game-scene'`, with the authored sizes from §2.6:

| Semantic key                        | Alias                  | Size    |
| ----------------------------------- | ---------------------- | ------- |
| `scene.game.minion-frame`           | `minionFrame`          | 119×161 |
| `scene.game.minion-frame-legendary` | `minionFrameLegendary` | 136×99  |
| `scene.game.minion-taunt`           | `minionTaunt`          | 136×183 |
| `scene.game.minion-divine-shield`   | `minionDivineShield`   | 125×167 |
| `scene.game.minion-attack`          | `minionAttack`         | 44×51   |
| `scene.game.minion-health`          | `minionHealth`         | 38×54   |

- Extend the `GameAssets` interface with the six `Texture` fields.
- Extend `asset-registry.test.ts` — the list in
  `'registers the complete game-opening asset set with the game bundle'` — with the
  six new keys.

---

## 6. Step 3 — Minion rendering (feature-agnostic)

New folder: `src/renderer/rendering/minions/` — rendering infrastructure, analogous
to `rendering/cards/`. It must not import feature state, scenes, or app services.
It should not even import game domain: `MinionView` is purely presentational and
receives everything via options (keeps future buff/trait rendering decoupled from
content).

Files: `minion-layout.ts`, `minion-view.ts`, colocated `minion-view.test.ts`.

### 6.1 `minion-layout.ts` — self-describing geometry

Define the minion's own design space (like `CARD_CANVAS` does for cards):

```ts
export const MINION_CANVAS = { width: 160, height: 210 } as const
```

All layers are positioned inside this canvas. The starting values below are
estimates — **tune them visually against the frame art** (these are new values, not
mutations of existing layout numbers, so tuning is expected):

- `frame`: `minion-frame.png` (119×161) centered horizontally in the top area
  (start: center ≈ (80, 90)).
- `artwork oval`: ellipse inside the frame's portrait window (start: center ≈
  (80, 78), radiusX ≈ 46, radiusY ≈ 58). Tune so the oval sits inside the frame's
  visible aperture.
- `legendaryFrame`: centered on the frame center.
- `taunt`: centered on the frame center (it is intentionally larger than the frame).
- `divineShield`: centered on the frame center.
- `attackBadge`: `minion-attack.png` near the frame's bottom-left corner (start:
  center ≈ (27, 165)); `healthBadge`: `minion-health.png` near the bottom-right
  (start: center ≈ (133, 165)).
- Stat label style: `Belwe`, white fill, dark stroke (`0x17120f`), centered on each
  badge — start around fontSize 30 and tune so 1–2 digit numbers fit the badges
  (compare with the card stat labels in `card-layout.ts`, same font family).

Use the layout contract (`placement()` from `rendering/layout`) for the fixed
pieces so every number is self-describing, and give each entry a `note`.

### 6.2 `minion-view.ts` — API

```ts
export interface MinionViewModel {
  readonly label: string // e.g. `minion:${instanceId}`
  readonly attack: number
  readonly health: number
  readonly legendary: boolean
  readonly taunt: boolean // always false this phase (hook for later)
  readonly divineShield: boolean // always false this phase (hook for later)
}

export interface MinionViewTextures {
  readonly frame: Texture
  readonly legendaryFrame: Texture
  readonly taunt: Texture
  readonly divineShield: Texture
  readonly attack: Texture
  readonly health: Texture
}

export class MinionView extends Container {
  static async create(
    model: MinionViewModel,
    textures: MinionViewTextures,
    artwork: Texture | undefined
  ): Promise<MinionView>

  setStats(attack: number, health: number): void // future buffs
  setTaunt(visible: boolean): void // future traits
  setDivineShield(visible: boolean): void
}
```

Build order / z-order (bottom → top), exactly as requested:

1. **Artwork, clipped to the oval.** Put the artwork sprite in a container and mask
   it with a `Graphics` ellipse (`graphics.ellipse(cx, cy, rx, ry).fill(0xffffff)`,
   assigned to `container.mask`, mask added as a child of the masked container —
   same pattern as the `artwork` node in `card-view.ts`). **Cover-fit** the artwork:
   `scale = max(2*rx / artWidth, 2*ry / artHeight)`, centered on the oval center,
   so the oval is always fully covered regardless of artwork aspect. If `artwork`
   is `undefined`, draw a neutral placeholder fill inside the oval (mirrors the
   placeholder behavior in `card-view.ts`).
2. `minion-frame.png`.
3. `minion-frame-legendary.png` — visible only when `model.legendary` (construct
   the sprite either way so a future phase can toggle it).
4. `minion-taunt.png` — `visible = model.taunt` (false this phase).
5. `minion-divine-shield.png` — `visible = model.divineShield` (false this phase).
6. Attack group: badge sprite + `Text` label; health group: badge sprite + `Text`
   label. These are always the topmost layers.

Rules:

- `eventMode = 'none'` on the view and all children (board minions are not
  interactive this phase).
- Set `.label` on every placed object in `zone.element` style
  (`'minion.artwork'`, `'minion.frame'`, `'minion.frame-legendary'`,
  `'minion.taunt'`, `'minion.divine-shield'`, `'minion.stat-attack'`,
  `'minion.stat-health'`) for the F2 layout inspector.
- Internally work in `MINION_CANVAS` space; the caller positions/scales the view.
  Treat the minion's **center** as its positioning point (the row math in §7
  places minion centers).

### 6.3 Tests (`minion-view.test.ts`)

Headless Pixi tests run via the repo's vitest setup (see `tests/setup/` and the
existing colocated `*.test.ts` files under `src/renderer` for how Pixi objects are
exercised). Cover:

- Layer presence and z-order: the artwork container has a mask; the frame draws
  above the artwork; the stat badges are topmost.
- `legendary: true` → legendary frame visible; `false` → hidden.
- Taunt/divine shield hidden by default; `setTaunt(true)` /
  `setDivineShield(true)` toggle visibility.
- `setStats` updates both labels.
- Missing artwork (`undefined`) does not throw and renders the placeholder.

---

## 7. Step 4 — Board row layout (feature geometry + pure math)

### 7.1 `src/renderer/features/game/game-scene-layout.ts`

Add a new section to `GAME_BOARD_LAYOUT` (new values only; do not touch existing
entries). Follow the file's convention for parameterized spreads. The starting
numbers are **initial estimates** (canvas center ≈ 1080/2, pushed toward each
hero); the user will tune `baselineY` later, so each row must be its own entry:

```ts
boardMinions: {
  /**
   * Local (bottom) minion row — parameterized spread, NOT a fixed placement.
   * INITIAL ESTIMATE: canvas center (540) pushed toward the local hero; tune
   * `baselineY` against the board art.
   */
  local: { centerX: 960, baselineY: 655, maxSpan: 900, maxStep: 130, minionScale: 0.85 },
  /**
   * Remote (top) minion row. INITIAL ESTIMATE, tuned independently from `local`.
   */
  remote: { centerX: 960, baselineY: 425, maxSpan: 900, maxStep: 130, minionScale: 0.85 },
  /**
   * Drop zone for the local row (design-canvas rectangle). INITIAL ESTIMATE:
   * the board art's horizontal extent, from the canvas center down toward (but
   * stopping above) the local hero portrait. Tune against the board art.
   */
  localDropZone: { x: 174, y: 540, width: 1572, height: 170 }
}
```

Why this shape: `local` and `remote` are **separate entries each with its own
`baselineY`**, so changing one row's Y never touches the other (explicitly
requested). All numbers per row are documented spread parameters, exactly like
`mulligan.cards` / `remoteHand` / `mana.crystals`.

### 7.2 `src/renderer/features/game/board-layout.ts` — pure math (+ colocated test)

Mirror the `hand-layout.ts` style (pure functions, config object, no Pixi):

```ts
export interface BoardRowConfig {
  readonly centerX: number
  readonly baselineY: number
  readonly maxSpan: number // max center-to-center span of the outer minions
  readonly maxStep: number // preferred center-to-center step while the row fits
  readonly minionScale: number
}

export interface BoardMinionTransform {
  readonly x: number
  readonly y: number
  readonly scale: number
}

/** Symmetric row for 0..7 minions; compresses once (count-1)*maxStep > maxSpan. */
export function layoutBoardRow(
  count: number,
  config: BoardRowConfig
): readonly BoardMinionTransform[]

/**
 * Maps a pointer x to an insertion index 0..count (gap before minion 0 … gap
 * after the last minion). Boundaries are the midpoints between neighboring
 * centers; an outer half-step extends the row's reach so dropping just outside
 * an edge minion still inserts at that edge.
 */
export function resolveBoardInsertionIndex(
  pointerX: number,
  count: number,
  config: BoardRowConfig
): number

/** Point-in-rectangle check for the drop zone (design-canvas coordinates). */
export function isInDropZone(
  pointer: { readonly x: number; readonly y: number },
  zone: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
): boolean
```

Math (same spirit as `layoutHand`):

- `step = count <= 1 ? 0 : min(maxStep, maxSpan / (count - 1))`
- `x_i = centerX + (i - (count - 1) / 2) * step`, `y = baselineY`,
  `scale = minionScale`.
- `count === 0` returns `[]`; `resolveBoardInsertionIndex` still returns `0`.
- Insertion mapping for `count >= 1`: compute the row's centers with
  `layoutBoardRow(count, config)`; clamp `pointerX` into
  `[firstCenter - step/2, lastCenter + step/2]`, then
  `index = clamp(round((pointerX - (firstCenter - step/2)) / step), 0, count)`.
  For `count === 1` any pointer inside the extended reach maps to 0 or 1 by which
  side of the single center it is on.

Tests (`board-layout.test.ts`, colocated):

- Positions are symmetric around `centerX` for counts 1..7; `y`/`scale` constant.
- Spacing equals `maxStep` while the row fits, then compresses to
  `maxSpan / (count - 1)` (verify at count 7 with the default config).
- Insertion index: far left → 0; far right → count; between minion i and i+1 →
  i+1; exactly on a midpoint is deterministic (round semantics); count 0 → 0.
- `isInDropZone` edges (inside, outside each side).

### 7.3 What "live insertion preview" means (and why it is included)

In Hearthstone, while you drag a minion over the board, the minions already in play
**slide apart in real time** to open the exact gap where the new minion would land;
if you move the pointer, the gap moves; if you leave the board, they slide back.
This is the visual half of "minions automatically rearrange whenever I add a card
in between them" — the rearrangement is computed live from the pointer, before the
drop. It is included in this phase because it reuses the exact same pure math as
the final layout (nothing extra to build): previewing insertion index `k` for a
row of `n` minions is simply `layoutBoardRow(n + 1, config)` with the ghost slot
`k` skipped.

---

## 8. Step 5 — Wire it into `GameBoardView`

File: `src/renderer/features/game/game-board-view.ts`. This is integration only —
no game rules here; the engine remains the single source of truth.

### 8.1 Layers and state

- Add two containers `localMinionLayer` and `remoteMinionLayer`. Insert them in
  the child order **right after `boardLayer`** (minions draw above the board art,
  below hero powers/heroes/hand). Labels: `'game.board-minions-local'`,
  `'game.board-minions-remote'`.
- Track the local row view-side: `private readonly localMinionViews: MinionView[]`
  kept in the same order as the engine's local `board` array. (Remote stays empty
  this phase; do not build remote presentation beyond the empty layer.)
- Feature-local timing constants for the new animations go in a small
  `BOARD_TIMING` object beside `OPENING_TIMING` / `TURN_TIMING` (e.g.
  `minionSettle: 0.3`, `rowShift: 0.25`).

### 8.2 Presenting `minion-played`

- Add `case 'minion-played':` to `presentEvent`. Ignore events for the remote
  participant this phase (guard + early return; the engine is controller-agnostic
  and a future phase makes the AI play).
- For the local participant:
  1. Resolve the card definition via `CARD_CATALOG.require(event.minion.cardId)`.
  2. Build the `MinionViewModel`:
     `attack`/`health` from the event's minion; `legendary` =
     `definition.rarity === 'Legendary'`; `taunt`/`divineShield` = `false`;
     label `minion:${event.minion.instanceId}`.
  3. `await MinionView.create(model, textures, artwork)` where `textures` comes
     from `this.options.gameAssets` (the six new fields) and `artwork` from
     `await this.resolver.loadArtwork(event.minion.cardId)`.
  4. Insert the view into `localMinionViews` at `event.position` and add it to
     `localMinionLayer`.
  5. Entry animation: keep it simple — appear at its row position with a short
     scale/fade-in (from ~1.25× down to rest scale, ~`minionSettle`). Elaborate
     flight choreography from the hand is deferred.
  6. `applyLocalBoardLayout()` (§8.4) to settle the whole row — this is the
     auto-rearrange.
- `syncTurnHud(result.state)` already runs before events are presented in the
  existing `endTurn`/`useHeroPower` flows; for `play-minion` the view dispatches
  itself (§8.3) and must call `this.syncTurnHud(result.state)` after an accepted
  dispatch so mana labels/tray update.

### 8.3 Drop resolution (the new input path from §3)

Add a private `resolveCardDrop(pointer)` used by both the pointerup-after-drag and
second-left-click paths:

1. If no card is attached (`draggingIndex === null`) → no-op.
2. Determine the carried entry and its definition. Pre-check cheaply (before
   dispatching) that the card `type === 'Minion'`, the pointer is inside
   `GAME_BOARD_LAYOUT.boardMinions.localDropZone` (`isInDropZone`), and the local
   board has fewer than 7 minions. Any check failing → fall back to today's
   `endDrag()` (return to hand). Non-minion cards therefore always return to hand.
3. Compute `position = resolveBoardInsertionIndex(pointer.x, boardCount, localRowConfig)`.
4. Dispatch `{ type: 'play-minion', participantId: this.localParticipantId,
cardInstanceId, position }`.
   - **Rejected** → `this.logger.error(result.message)` and `endDrag()` (return to
     hand). The engine re-validates everything; the view never mutates state on a
     rejected command.
   - **Accepted** → presentation, in this order:
     a. Synchronously mark the drag as resolved (reuse the `dragReturning` /
     `reflowing` guard pattern so input cannot re-enter mid-animation), stop the
     drag ticker, release/destroy the `HandCardPerspective`, reset the cursor —
     mirror `endDrag`/`finishDrag` bookkeeping.
     b. Remove the entry from `handEntries`, dispose its `playableOutline`, destroy
     the slot (optionally fade it out quickly at the drop point), then re-fan the
     remaining hand with `applyHandLayout(...)` exactly like `addLocalCard` does.
     c. Present the `minion-played` event(s) from `result.events` via
     `presentEvent`, then `syncTurnHud(result.state)`.
5. Clear the insertion preview (§8.4) back to the resting row.

Wire the two triggers:

- **Pointerup after a real drag**: in the new window `pointerup` capture handler —
  if `draggingIndex !== null`, not `dragReturning`, and the press moved beyond the
  threshold → `resolveCardDrop(this.dragPointer)`. If it did not move beyond the
  threshold → do nothing (the card stays attached: selected state).
- **Second left click**: extend `handleWindowPointerDown` — when
  `draggingIndex !== null` and `event.button === 0` →
  `resolveCardDrop(this.dragPointer)` (consume the click). Keep the `button === 2`
  cancel path exactly as-is.

Coordinate spaces: `dragPointer` is in `handLayer` local space, and `handLayer`
sits at the canvas origin with no transform — the same space as
`GAME_BOARD_LAYOUT` values (verify against how `tryHeroPowerClick` uses
`containsCanvasPoint` with the same coordinates).

### 8.4 Row layout + live insertion preview

```ts
private applyLocalBoardLayout(previewIndex: number | null = null): void
```

- `previewIndex === null` → targets = `layoutBoardRow(n, localRowConfig)` for the
  `n` real minions.
- `previewIndex !== null` → targets = `layoutBoardRow(n + 1, localRowConfig)` with
  slot `previewIndex` skipped (the ghost gap); minion `i` maps to slot
  `i < previewIndex ? i : i + 1`.
- Tween each `MinionView` to its target (`x`, `y`, `scale`) with
  `tweenTo(..., { duration: BOARD_TIMING.rowShift, ease: 'power2.out',
overwrite: 'auto' })` so repeated preview updates hand off cleanly (same
  overwrite strategy as `animateHoverTarget`).

Preview lifecycle:

- While a card is carried, the `globalpointermove` handler (which already tracks
  `dragPointer`) additionally checks `isInDropZone` on every move: inside and the
  carried card is a Minion → compute the insertion index and call
  `applyLocalBoardLayout(index)` **only when the index changed**; outside →
  `applyLocalBoardLayout(null)` once when leaving.
- After a successful drop the preview naturally finalizes (the real layout equals
  the previewed one); after a cancel/return call `applyLocalBoardLayout(null)`.
- Board minions themselves never receive pointer events (`eventMode: 'none'`), so
  they cannot steal the drag's pointer flow.

### 8.5 Dispose

Destroy `localMinionViews` children and remove the new window listeners in
`dispose()` (follow the existing cleanup for `handleWindowPointerDown` /
`handleWindowBlur`).

---

## 9. Suggested implementation order

Each step is independently verifiable; run the relevant tests after each:

1. **Domain** (§4): types, command, validation, event + engine tests.
   `npm test` (or vitest on `src/game`).
2. **Assets** (§5): registry entries + registry test. `npm run typecheck`,
   `npm test`.
3. **MinionView** (§6): geometry + view + test. `npm test`.
4. **Row math** (§7): `board-layout.ts` + test, layout entries in
   `game-scene-layout.ts`. `npm test`.
5. **Wiring** (§8): interaction + presentation in `GameBoardView`.
   `npm run dev` manual pass (§10), then full `npm run verify`.

---

## 10. Verification

Will be tested by the Human.

---

## 11. Notes for the implementing agent

- Follow `AGENTS.md` strictly: kebab-case file names, colocated tests, layout
  contract (`placement()` + parameterized spreads), `zone.element` labels on every
  placed Pixi object, never delete asset files, no comments-free mandate — match
  the surrounding style, which uses concise doc comments on non-obvious behavior.
- Do not modify existing layout values or existing interaction behavior; only add.
- The engine is the single source of truth: the view never invents board state,
  and every accepted command's `events` drive presentation.
- Keep taunt/divine shield as constructed-but-hidden layers and boolean model
  fields; do not add trait fields to the card JSON or domain in this phase.
- If a detail here conflicts with `AGENTS.md`, `AGENTS.md` wins; if it conflicts
  with observed code behavior, prefer the code and note the discrepancy in the
  final summary.
