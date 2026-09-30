# Notes by the human

- Clean any .test files created after a test, keeping the codebase clean.
- This is not a OneDrive folder, even though the path to this project makes you believe that. It is a left-over, and OneDrive is not installed.
- If running tests, and any test fails because of the live-numbers are different from the test files, assume that the human made manual adjustments and those are the correct values he wants.

## Engineering preference

When investigating or fixing technical problems:

- Prefer clean, targeted, reliable fixes that address the actual problem.
- Do not over-engineer solutions or introduce unnecessary complexity.
- Do not turn a focused fix into a broad rewrite, refactor, redesign, migration, or cleanup unless that is specifically the goal or clearly necessary.
- Preserve working behavior and existing architecture when possible.
- Investigate and gather evidence before making speculative changes.
- Favor the smallest complete solution, not a shortcut that only hides the symptom.
- Separate necessary fixes from optional improvements.
- Suggestions for broader improvements are welcome, but do not automatically implement them.
- Optimize for reliability, clarity, maintainability, and low complexity.

## Windows Codex Sandbox ACL Failure

If `apply_patch` or normal `exec_command` fails before launching with:

```
helper_unknown_error: apply deny-read ACLs
windows sandbox failed: helper_unknown_error: apply deny-read ACLs
```

inspect the Codex sandbox state before changing repository permissions or source files.

Check:

C:\Users\gabri\.codex\.sandbox\setup_error.json
C:\Users\gabri\.codex\.sandbox\deny_read_acl_state.json
C:\Users\gabri\.codex\.sandbox\sandbox*.log

The issue is confirmed when the log contains:

parse deny-read ACL state ...\deny_read_acl_state.json
expected value at line 1 column 1

and deny_read_acl_state.json contains NUL bytes instead of valid JSON. This is a corrupted Codex sandbox state file,
not necessarily a repository ACL problem.

Preserve the corrupt file and move it out of the active path so Codex can regenerate it:

$statePath = 'C:\Users\gabri\.codex\.sandbox\deny_read_acl_state.json'
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (Test-Path -LiteralPath $statePath) {
      Move-Item -LiteralPath $statePath `
-Destination ($statePath + '.corrupt-' + $stamp)
}

This may require elevated permission because the file is outside the repository. Do not manually guess a replacement
schema; let Codex regenerate the state. Verify using normal, non-elevated commands:

```
Get-Location
git status --short
```

Then confirm that deny_read_acl_state.json has been recreated as valid JSON. If the error persists, restart/recreate
the Codex sandbox and inspect the newest sandbox log. Do not modify .git ACLs unless separate evidence proves they are
the cause.

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
Desktop main / preload -> desktop contracts -> game rules
Application -> scene adapters -> scene-local views / controllers
                              -> visual components / injected contracts
                              -> game rules / desktop contracts
```

### Strict Ownership Rules

- **`src/scenes`**: Each screen and its complete workflow. Keep adapters, views, controllers, layouts, and animations together while preserving their separate responsibilities. Collection owns `card-preview/` and `deck-builder/`, including the separately navigable New Deck screen. Scenes must never construct or import concrete sibling scene adapters; request typed routes through SceneNavigator. Separate workflows must not import each other's internal views/controllers.
- **`src/scenes/match`**: Match orchestration and named board, hand, targeting, combat, AI, presentation, HUD, history, results, loading, and embedded-tool subfolders. The mulligan view lives directly beside match orchestration. Hero, minion, weapon, power, and board-shadow visuals live directly in `board/`. Inspectors may reuse them without moving them out of match.
- **`src/visual-components`**: Reusable cards, controls, assets, layout, animations, effects, transitions, and lifecycle bases. Must never import scene implementations, application service implementations, or development tools. Injected interfaces from `application/contracts` are allowed. Scene and Actor bases live in `lifecycle`; AnimationScope lives in `animation`.
- **`src/game-rules`**: Pure game content, deck validation, and deterministic match simulation. Must never import Electron, PixiJS, DOM, Node APIs, desktop contracts, or presentation/application code.
- **`src/application`**: Startup and concrete renderer services. `navigation/` owns the router, SceneNavigator factory, SceneManager, and typed routes. `contracts/` owns injected service ports; `match-seed.ts` is the session seed helper. Views/controllers consume these contracts and route definitions rather than concrete application implementations.
- **`src/dev-tools`**: Standalone inspectors, labs, and development runtime adapters. Preserve guarded entrypoint imports and production-substituted aliases. Embedded match commands/card-picker hooks retain their existing availability in `scenes/match/tools`.
- **`src/desktop/main`**: Electron lifecycle, native menus, filesystem repositories, and platform services. Must never import presentation code or preload implementations.
- **`src/desktop/preload`**: Narrow, runtime-validated bridge exposing desktop services to the game window. Must never import game-rules, main-process, or presentation implementations.
- **`src/desktop/contracts`**: Process-safe message schemas and route requests used across the desktop bridge. Must never import process or presentation implementations.

The current navigation guide is `src/README.md`; the complete follow-up inventory and validation tracker is `docs/source-layout.md`. `docs/renderer-reorganization.md` records the initial migration with final destinations. Retired `src/renderer`, `src/game`, `src/main`, `src/preload`, and `src/shared` roots must not be reintroduced. Stable public router/service exports remain facades, not migration shims.

Boundaries are enforced by `.dependency-cruiser.cjs` and checked with `npm run deps:check`. Route IDs, exported classes, saved data, asset keys, and numeric tuning are independent of folder names.

---

## 2. Directory Structure & File Conventions

- **Purpose-named source roots**: `scenes`, `visual-components`, `game-rules`, `application`, `dev-tools`, and `desktop`. Browser startup, HTML, stylesheet, and environment declarations live in `application`. Electron's compiled `out/main`, `out/preload`, and `out/renderer` paths remain stable.
- **Shallow by default**: Use at most one organizational folder below a scene or subsystem owner (for example `scenes/match/board/*.ts` and `application/navigation/*.ts`). Keep single-file helpers beside their owner or in an existing related group. Do not create placeholder folders. Desktop process owners (`main`, `preload`, `contracts`), content catalog owners (`cards`, `heroes`, etc.) with their card-set data, and framework-managed `__snapshots__` retain their meaningful boundaries. Document any additional depth in `src/README.md` before introducing it.
- **File Naming**: Use **kebab-case** for source files and directories (for example `deck-repository.ts` and `main-menu-scene.ts`).
- **No Direct Mutation of Layout Values**: Do not modify pixel coordinates or scales during refactoring unless explicitly requested.

---

## 3. Scene Layout Contract (`src/visual-components/layout`)

Scene geometry is self-describing so numbers are understandable without reading surrounding animation or input logic.

### The Contract

Every visual placement is declared with `placement(position, size, options)`:

```ts
import {
  CENTER,
  TOP_LEFT,
  placement,
  type LayoutPlacement
} from '../../visual-components/layout'

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
2. **Beside Its Owner**: Each scene/component keeps its geometry in a `*-layout.ts` module beside its implementation (e.g. `src/scenes/match/game-scene-layout.ts`, `src/scenes/collection/collection-layout.ts`).
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

### Asset Registration (`src/visual-components/assets`)

- Bespoke assets are imported and typed in `src/visual-components/assets/index.ts` with their semantic key, authored dimensions, bundle, and alias.
- Assets are grouped into lazy bundles (`main-menu`, `deck-selection`, `deck-presentation`, `game`, `collection`, `card-preview`, `menu-settings`, `game-settings`, `shared-ui`, `card-rendering`).
- Components acquire textures through `this.assetScope.acquire(bundleId)` rather than loading files ad-hoc.

---

## 5. Domain Models (Game & Match)

### Card Content (`src/game-rules/content`)

- Cards are declared in `src/game-rules/content/cards/sets/*.json` and validated by `validateCardSet` against the schema.
- `CardDefinition` is a discriminated union (`Minion`, `Spell`, `Weapon`, `Hero`) with branded IDs (`asCardId`, `asHeroId`, `asExpansionId`).
- Catalogs (`CARD_CATALOG`, `HERO_CATALOG`, `HERO_POWER_CATALOG`, `EXPANSION_CATALOG`, `CLASS_CATALOG`) provide immutable, queryable indexes. Rules text is display-only markup and never parsed as code.

### Deck Persistence & Rules (`src/game-rules/decks` & `src/desktop/main/services/deck-repository.ts`)

- Decks are version 2 JSON records with 30 cards, a designated `heroId`, max 2 copies of normal cards, and max 1 copy of legendaries.
- The Electron main process owns JSON persistence, automatic v1 $\rightarrow$ v2 migration, and corruption recovery backups.

### Match Engine (`src/game-rules/match`)

- Platform-neutral, deterministic match boundary driven by seeded RNG (`createSeededRng`).
- Manages opening hand dealing (3 cards for player 1, 4 cards + Coin for player 2), mulligan card replacement, alternating turn loops, draw/fatigue/burn rules, and turn-by-turn mana crystal growth.

---

## 6. Developer Workflow & Canonical Verification

### Running the App

```bash
npm run dev                                      # Start game at Main Menu
VITE_DEV_START_ROUTE=card-inspector npm run dev # Open development Card Inspector directly
```
