# Agent navigation

Start with [README.md](README.md) for commands and [ARCHITECTURE.md](ARCHITECTURE.md) for
ownership rules. Use this file for repository-specific agent workflow and constraints.

## Code owners

- `src/game`: pure domain/content/decks/match; never import platform or renderer code.
- `src/shared`: process-safe contracts and runtime parsers.
- `src/main` and `src/preload`: Electron adapters and narrow IPC bridges.
- `src/renderer/src/app`: composition root, services, routes, and scene factory.
- `src/renderer/src/scenes`: lifecycle orchestration only.
- `src/renderer/src/features`: feature state and views.
- `src/renderer/src/rendering` and `src/renderer/src/ui`: production presentation infrastructure.
- `src/renderer/src/features/dev` and `src/renderer/src/scenes/dev`: development-only tools.

## Canonical verification

Run `npm run verify` before handoff. Focused commands are `npm run content:check`,
`npm run deps:check`, `npm run typecheck`, `npm test`, and `npm run build:smoke`.

Do not introduce imports from game to Electron/Pixi/DOM/filesystem, from main to renderer,
from features to scenes, from rendering/UI to workflows, or from production modules to tests
or dev-only modules. Keep scene construction in the app factory and use typed routes.
