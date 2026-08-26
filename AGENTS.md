# Commiting and Pushing to GitHub

You have access to GitHub CLI. Please make sure that we are using account 'gmargonato' email 'gabriel-merida@hotmail.com', and not another account in the machine. If you detect another account (for example gmargonato-arctiq, or gmargonato-mohawk) please make sure to switch to the correct one.
Make sure to never use a command that could possibly pull and overwrite a local, uncommited code.

# Agent Invariants & Engineering Guide

This file is the single authoritative source of truth for repository architecture,
ownership boundaries, layout contracts, asset pipelines, and development workflows.
Every AI agent and developer working on this codebase must adhere strictly to these rules.

---

## 1. Process & Dependency Boundaries

```text
Electron main / preload adapters
            -> shared contracts
            -> game domain

renderer app -> scenes -> features -> rendering / ui
                         -> game / shared contracts
```

### Strict Ownership Rules

- **`src/game` (Pure Domain)**: Contains game rules, card content catalogs, deck validation, and match engine. It must **NEVER** import Electron, PixiJS, DOM, Node.js (`fs`, `path`, etc.), or renderer code.
- **`src/shared` (Cross-Process Contracts)**: Process-safe contracts (e.g. IPC schemas, route requests). Must **NEVER** import implementation code from `main`, `preload`, or `renderer`.
- **`src/main` (Electron Main Process)**: App lifecycle, JSON deck filesystem repository, IPC handlers. Platform-neutral; must **NEVER** import renderer code.
- **`src/preload` (Electron Preload Bridge)**: Exposes a narrow runtime-validated bridge (`window.electron`) to the renderer. Must **NEVER** import domain or renderer implementations.
- **`src/renderer` (PixiJS Presentation Layer)**:
  - `app/`: Composition root, router, services, and `SceneNavigator` scene factory.
  - `scenes/`: Full-screen scene adapters and lifecycle orchestration (`Scene`, `SceneManager`). Scenes must **NEVER** import or construct concrete sibling scenes; navigation is requested via typed `AppRoute` through `SceneNavigator`.
  - `features/`: Feature state, controllers, views, and local layout modules. Features must **NEVER** import scenes.
  - `rendering/`: Low-level draw infrastructure and the feature-agnostic card engine (card rendering, layout engine, filters, shaders/effects). Must **NEVER** import feature state or app services.
  - `ui/`: Base presentation primitives and asset loading, depended on by `rendering/` and below. Holds `Actor`/`AnimationScope` lifecycle bases, interactive controls (`Button`, `FlipCard`, `cursor`), and the semantic `asset-registry` (including shared `deck-frames.ts` asset-key maps). `ui/` must **NEVER** import feature state, scenes, or app services.
  - `features/dev/` & `scenes/dev/`: Development-only tools (Card Inspector, Layout Inspector). Isolated behind conditional build aliases so they are stripped from production builds.

These boundaries are strictly enforced by `.dependency-cruiser.cjs` and checked via `npm run deps:check`.

---

## 2. Directory Structure & File Conventions

- **Flattened Renderer**: All renderer code lives under `src/renderer/` (`app`, `scenes`, `features`, `rendering`, `ui`, `animation`). Never create a nested `src/renderer/src/`.
- **File Naming**: All files and directories must use **`kebab-case.ts`** (e.g. `deck-repository.ts`, `scene-navigator.ts`, `main-menu-scene.ts`, `flip-card.ts`).
- **No Direct Mutation of Layout Values**: Do not modify pixel coordinates or scales during refactoring unless explicitly requested.

---

## 3. Scene Layout Contract (`src/renderer/rendering/layout`)

Scene geometry is self-describing so numbers are understandable without reading surrounding animation or input logic.

### The Contract

Every visual placement is declared with `placement(position, size, options)`:

```ts
import {
  CENTER,
  TOP_LEFT,
  placement,
  type LayoutPlacement
} from '../../rendering/layout'

export const MY_FEATURE_LAYOUT = {
  name: 'Feature Name',
  playButton: placement(
    { x: 960, y: 540 }, // position: where anchor point sits
    { width: 355, height: 65 }, // size: display size at scale 1 (authored asset dimensions)
    {
      anchor: CENTER, // anchor: normalized pivot (0..1)
      scale: 1, // optional scale multiplier
      note: 'Centered action button.' // human/agent hint
    }
  )
} as const
```

### Layout Placement Rules

1. **Design Canvas**: Full scenes use the canonical **1920 x 1080** canvas at 1x scale (origin top-left). Complete cards use **620 x 900**.
2. **Beside the Feature**: Each scene/feature keeps its geometry in a `*-layout.ts` module inside its feature folder (e.g. `src/renderer/features/game/game-scene-layout.ts`, `src/renderer/features/collection/collection-layout.ts`).
3. **Application Helpers**: Apply placements with `applyAnchoredPlacement(sprite, value)` (sets position + anchor + scale) or `applyPlacement(container, value)`.
4. **Fixed Placements vs. Parameterized Spreads**:
   - Use `placement()` for fixed elements (backgrounds, buttons, frames, portraits).
   - Dynamic spreads (mulligan hand of 3 or 4 cards, hand fan, mana crystals, deck stacks) are **parameterized** (`centerX`, `baselineY`, `gap`, `scale`, `anchor`) and driven by pure math. Never place cards individually to solve count differences.
5. **Object Labels & Dev Inspector (F2)**:
   - Set `.label` on every placed Pixi object using the `zone.element` format (e.g. `'game.board'`, `'chest.box'`).
   - Pressing **F2** in `npm run dev` toggles the live layout overlay that visualizes bounding boxes, anchors, and labels for all active objects.

---

## 4. Asset Registry & Media Rules

### Asset Storage (`assets/`)

- `assets/` remains at the workspace root to isolate large binary files from TypeScript source code.
- `assets/source/`: Master PSD files and editable assets (excluded from production builds).
- `assets/fonts/`: Runtime custom fonts (`Belwe`, `Franklin Gothic Condensed`).
- `assets/images/`: Runtime graphics categorized by domain:
  - `board/`: In-game minion frames, taunt shields, divine shields.
  - `card-artwork/`: Card illustrations named exactly after their `CardId` (e.g. `classic_abomination.jpg`).
  - `cards/`: Card templates, rarity gems, stat badges, mana crystal.
  - `cursor/`: Custom game cursor variants.
  - `effects/`: Auras and spotlight overlays.
  - `heroes/`: Hero frames, portraits, hero power plates.
  - `match/`: Game board, turn flags, end turn buttons, mulligan announcements, versus plate.
  - `ui/`: Subdivided into `common/`, `main-menu/`, `deck-selection/`, `deck-builder/`, `collection/`, `card-preview/`, `settings/`.
- **Never delete existing asset files.**

### Asset Registration (`src/renderer/ui/asset-registry`)

- Bespoke assets are imported and typed in `src/renderer/ui/asset-registry/index.ts` with their semantic key, authored dimensions, bundle, and alias.
- Assets are grouped into lazy bundles (`main-menu`, `deck-selection`, `deck-presentation`, `game`, `collection`, `card-preview`, `menu-settings`, `game-settings`, `shared-ui`, `card-rendering`).
- Components acquire textures through `this.assetScope.acquire(bundleId)` rather than loading files ad-hoc.

---

## 5. Domain Models (Game & Match)

### Card Content (`src/game/content`)

- Cards are declared in `src/game/content/cards/sets/*.json` and validated by `validateCardSet` against the schema.
- `CardDefinition` is a discriminated union (`Minion`, `Spell`, `Weapon`, `Hero`) with branded IDs (`asCardId`, `asHeroId`, `asExpansionId`).
- Catalogs (`CARD_CATALOG`, `HERO_CATALOG`, `HERO_POWER_CATALOG`, `EXPANSION_CATALOG`, `CLASS_CATALOG`) provide immutable, queryable indexes. Rules text is display-only markup and never parsed as code.

### Deck Persistence & Rules (`src/game/decks` & `src/main/services/deck-repository.ts`)

- Decks are version 2 JSON records with 30 cards, a designated `heroId`, max 2 copies of normal cards, and max 1 copy of legendaries.
- The Electron main process owns JSON persistence, automatic v1 $\rightarrow$ v2 migration, and corruption recovery backups.

### Match Engine (`src/game/match`)

- Platform-neutral, deterministic match boundary driven by seeded RNG (`createSeededRng`).
- Manages opening hand dealing (3 cards for player 1, 4 cards + Coin for player 2), mulligan card replacement, alternating turn loops, draw/fatigue/burn rules, and turn-by-turn mana crystal growth.

---

## 6. Developer Workflow & Canonical Verification

### Running the App

```bash
npm run dev                                      # Start game at Main Menu
VITE_DEV_START_ROUTE=card-inspector npm run dev # Open development Card Inspector directly
```

### Canonical Verification (Mandatory Before Handoff)

Always run the full verification suite before concluding any task:

```bash
npm run verify
```

This executes the complete safety net:

1. `npm run format:check` — Prettier formatting validation.
2. `npm run lint` — ESLint rules.
3. `npm run typecheck` — TypeScript checks across node and web contexts.
4. `npm run deps:check` — Architecture dependency cruiser validation.
5. `npm run build:smoke` — Production build smoke test and dev-marker leak check.
