# HSInspired

A Hearthstone-inspired card game shell built with Electron, TypeScript, and PixiJS.

---

## 1. Quick Start

### Prerequisites

- Node.js (v20+ recommended)
- npm

### Installation & Run

```bash
# Install dependencies
npm install

# Start the game in development mode (starts at Main Menu)
npm run dev

# Launch directly into the development Card Inspector
VITE_DEV_START_ROUTE=card-inspector npm run dev
```

---

## 2. Key Commands & Verification

Before committing or submitting changes, run the full verification pipeline:

```bash
npm run verify
```

Individual focused commands:

- `npm run dev` — Run Electron app in development mode.
- `npm run perf:match` — Run the automated in-app match performance benchmark and write `artifacts/match-performance/latest.json`.
- `npm run typecheck` — Run TypeScript checks across node and web contexts.
- `npm run deps:check` — Validate architectural boundaries and dependency rules.
- `npm run lint` — Lint code with ESLint.
- `npm run format:check` — Check code formatting with Prettier (`npm run format` to fix).
- `npm run build:smoke` — Verify production build and check for development marker leaks.

---

## 3. Architecture & AI Agent Instructions

All architectural boundaries, file naming standards, layout contracts, asset pipelines, and engineering invariants are documented in **[AGENTS.md](AGENTS.md)**.
