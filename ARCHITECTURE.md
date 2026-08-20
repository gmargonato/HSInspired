# Architecture invariants

This file records the durable boundaries of the project and is the source of
truth for ownership and dependency rules.

## Process and dependency direction

```text
Electron main / preload adapters
            -> shared contracts
            -> game domain

renderer app -> scenes -> features -> rendering/ui
                         -> game/shared contracts
```

The important constraints are:

- `src/game` has no Electron, PixiJS, DOM, filesystem, or renderer dependency.
- `src/main` imports platform-neutral `game` and `shared` contracts, never renderer code.
- `src/preload` exposes narrow runtime-validated bridges and does not import implementations.
- `src/shared/ipc` contains contracts only; adapters stay in main or preload.
- `app` constructs concrete scenes and owns service composition. Scenes request typed routes.
- Production scenes do not import or construct other concrete scene modules.
- Features do not import scenes; rendering and UI do not import workflows or app services.
- Development-only Card Inspector modules are not production dependencies; the build smoke check
  verifies that their route markers are absent from the production renderer output.

These directions are enforced by `.dependency-cruiser.cjs` and `npm run deps:check`.

## Domain boundaries

Content is declarative and validated at the catalog boundary. Card records become a
discriminated union (`Minion`, `Spell`, `Weapon`, or `Hero`) with branded IDs. Heroes,
classes, hero powers, and expansions are queryable catalogs rather than fields duplicated
through deck or renderer state.

Deck persistence is a replaceable `DeckRepository` port. The current filesystem
format is version 2. The Electron main process owns the JSON filesystem adapter,
migrates supported version 1 files, and preserves unsupported files as backups
before initializing a replacement version 2 file. Both sides of deck IPC are
validated at runtime.

The match API is intentionally provisional: a serializable `MatchSetup`, command result,
state, and domain-event boundary plus an injected seeded RNG. The proof is not gameplay;
turns, mana, combat, card resolution, triggers, and AI strategy remain future work.

## Renderer composition

`Scene` owns lifecycle, animation scope, asset scope, and its root container. `SceneManager`
owns the stack and transition lifecycle. `SceneNavigator` owns route-to-scene composition.
Feature views may be mounted inside a scene, but they own their feature-local state and
presentation resources.

`CardView` consumes validated card content and a semantic asset resolver. Its layout exposes
read-only geometry metadata for demonstrated consumers such as preview parallax and the
dev inspector; editor mutation state does not belong in production rendering.

Scene geometry is self-describing: a `LayoutPlacement` bundles position, anchor, size, and
optional scale so a number is understandable without reading the surrounding logic. Each scene
keeps its geometry in a `*-layout.ts` module next to the feature that owns it, and a
development-only overlay (toggle F2) annotates every labelled Pixi object live. See
[docs/LAYOUT.md](docs/LAYOUT.md).

## Conventions, not new abstractions

- Runtime image filenames use lowercase kebab-case; card artwork uses exact `CardId` filenames.
- Bespoke assets have one typed registry entry with source, authored dimensions, owner, and bundle.
- Full scenes use 1920 x 1080 coordinates; complete cards use 620 x 900 coordinates.
- Add shared tokens only after reuse is demonstrated; keep feature-specific geometry local.
- Do not add a general JSON effect language or speculative gameplay framework before gameplay
  provides evidence for one.
