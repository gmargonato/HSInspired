# Code health evidence

Generate an evidence-backed review of relationships, methods, state ownership, and architectural boundaries:

```powershell
npm run architecture:map
```

On Windows, use `npm.cmd` if PowerShell blocks the `npm.ps1` shim. Generation analyzes source without launching the game, running application tests, or building production output.

## Outputs

Generated files are in `artifacts/architecture/` (ignored by Git):

| File                       | Purpose                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atlas.html`               | Standalone interactive review queue, methods/files, state ownership, subsystem boundaries, and analysis confidence. No server or network required. |
| `health-report.md`         | Complete review queue with reasons, possible justifications, source excerpts, and evidence for a later audit conversation.                         |
| `code-health.json`         | Complete symbol, relationship, metric, finding, diagnostic, and provenance data. This is the authoritative generated evidence.                     |
| `dependencies.json`        | Original dependency-cruiser result, including configured boundary violations.                                                                      |
| `boundary-violations.html` | Human-readable configured rule failures.                                                                                                           |
| `manifest.json`            | Generation identity and artifact paths.                                                                                                            |

For a new audit conversation, supply `health-report.md` and `code-health.json`, ideally with the matching source checkout. Findings are review hypotheses, not instructions to delete or refactor. Source excerpts may be truncated and are marked accordingly. Regenerate after changes; source hashes identify the scanned worktree, including uncommitted source changes.

The report does not assign a single health score. Priority 0 is a configured boundary issue, 1 is complex/cyclic behavior or a longer forwarding chain, 2 is an ownership/cohesion signal, and 3 is an abstraction review. The exact detector thresholds are exported. A data-only interface does not become an abstraction finding just because no class explicitly implements it.

## Investigating a finding

Open `atlas.html`. Select a finding subject to inspect its source location, metrics, callers, callees, test references, state access, enclosing declaration, members, and source excerpt. Relationship tables retain all edges; the local drawing shows at most 24 to keep it readable. Hover an edge for its relationship meaning. Click nodes to navigate to their neighborhoods. Lists paginate rather than discard findings. Search and scope filters apply to the result list; the selected neighborhood intentionally retains connections across scopes.

Source links open relative repository files. The displayed line is authoritative; browser support for `#L` line anchors depends on the source viewer.

The subsystem view preserves **semantic subsystem**, **process**, and **architectural layer** separately, including connections within a subsystem. `architecture/subsystems.cjs` remains the manual ownership registry: first matching root wins. Overlapping matches, unmapped files, and missing registered entry points are listed under Scope and confidence. Manual flows are retained as explicitly unverified narratives, not measured call chains.

To start with files matching a regular expression:

```powershell
npm run architecture:focus -- "src/renderer/features/game/"
```

This regenerates the complete evidence and additionally writes `focus.html` and `focus.json`. The focused UI filters the initial results while preserving complete incoming/outgoing neighborhoods. The regular expression is validated before scanning. A regular map generation does not remove existing focused artifacts; check their snapshot before using them.

## Relationship semantics

Every relationship has an ID, endpoints, kind, source location, and evidence category. Symbols have file/offset/kind IDs tied to their snapshot; they are not guaranteed stable after source edits.

| Relationship                                               | Meaning                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `imports-value`, `imports-type`, `re-exports`              | Module dependencies. Re-exports retain `typeOnly`; named symbol imports retain the public entry point in `via`. Mixed imports retain per-symbol type information.               |
| `imports-symbol`, `re-exports-symbol`, `references-symbol` | Resolved declaration usage, including aliases through barrels.                                                                                                                  |
| `calls`, `constructs`                                      | A resolved declaration at a call/construction site, including external declaration endpoints. A declared interface/parameter target is not an observed concrete implementation. |
| `implements`, `extends`, `possible-implementation`         | Explicit heritage and inferred matching methods on explicitly implementing classes. Structural implementations and runtime receiver identity remain unknown.                    |
| `reads-state`, `writes-state`                              | Explicit field access, assignment/update and inferred calls to selected mutator names.                                                                                          |
| `registers-handler`                                        | Inferred callback registration through recognized event/promise APIs. Not proof of execution.                                                                                   |
| `invokes-channel`, `handles-channel`, `dispatches-handler` | Electron IPC registrations/invocations linked by resolved literal channel. Handler dispatch is inferred.                                                                        |
| `test-references`                                          | Static references from test files to production declarations. **Not execution coverage or proof of adequate tests.**                                                            |

`imports-dynamic` records resolved literal `import()` dependencies, including configured path aliases. Nonliteral or unresolved module specifiers remain explicit unknowns.

Source dependencies do not prove emitted JavaScript dependencies. Cycle analysis computes strongly connected components separately for static value imports and the static graph including type dependencies. Dynamic imports contribute to potential impact but are excluded from static cycle analysis. A type-involved component may contain a smaller value component; neither count represents the number of all possible cycle paths. Component evidence includes its internal source relationships.

## Metrics and limitations

- Method metrics include source lines, branch count, approximate cyclomatic complexity, maximum decision nesting, parameter count, returns, awaits, and exact argument forwarding. Nested functions have separate metrics; line counts include comments and blank lines.
- Class member groups connect methods through shared resolved field access or direct calls. Constructors are excluded. Independent groups suggest a review, not an automatic class split.
- State writers are grouped by enclosing class or outer function, so callbacks inside a class do not become separate owners. Alias/deep mutation and reflection are incomplete.
- File coupling separates direct importers, type/value dependencies, and potential transitive importers. Transitive reach is potential impact, not proof that every consumer must change.
- Few-implementation signals apply to behavioral interfaces, not ordinary data records. Counts cover explicit heritage, not TypeScript structural typing.
- No-consumer signals exclude registered entry-point files. They cannot prove dead code: external consumers, framework registration and unresolved dispatch require inspection.
- Each source is indexed once, preferring the node configuration for domain/main/preload and the web configuration for renderer. Each file records its configuration. Compiler diagnostics and unresolved calls remain visible; generation does not assert the codebase type-checks successfully.
- Tests and development tools are indexed as separate scopes. Generated artifacts, assets, and dependencies outside `src` are not analyzed as application implementations. Coverage and runtime traces are not collected.

Snapshot metadata includes commit, dirty status, Git status, hashes of analyzed sources and analyzer/configuration inputs, resolved compiler options, and the installed TypeScript version. Source hashes use TypeScript-decoded text, with byte-order marks removed; input-file hashes use raw bytes. `changedSinceRead` identifies sources edited during extraction; regenerate if this list is nonempty. Source files excluded by the configured TypeScript programs are listed in the scope. The JSON contains complete findings even when the UI is filtered. Rule failures do not prevent artifact generation; analyzer/configuration failures do. `npm run deps:check` remains the enforcement command.

## Maintaining the generator

- `scripts/generate-architecture-atlas.cjs`: CLI, dependency-cruiser invocation, artifact generation.
- `scripts/code-health-analysis.cjs`: TypeScript resolution, relationship extraction, metrics, and review detectors.
- `scripts/code-health-report.cjs`: Markdown report and standalone interactive HTML.
- `scripts/verify-code-health.cjs`: Focused fixture validation, including a DOM harness for atlas navigation.

```powershell
npm run architecture:check
```

The checker creates isolated temporary source fixtures and removes them in `finally`, including its test-reference specimen. It checks barrel aliases, calls, constructors, declared and possible implementation targets, nested callback complexity, state mutation, IPC, cycle classification, test scope, diagnostics, snapshot determinism, complete exports, embedded-data escaping, and atlas interactions. It does not launch the application.
