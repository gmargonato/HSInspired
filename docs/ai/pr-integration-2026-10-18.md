# PR integration and preservation checkpoint: 18 October 2026

This record reconciles GitHub PR status with earlier local integrations and records
the integration of PR #18 into the normal working copy. All GitHub operations use
`gmargonato`; commits use `gabriel-merida@hotmail.com`.

## Preservation and recovery

- Starting local main: `ad84a959b501257307609ffccbe11b2507ab4c40`, already
  containing the local PR #17 merge. GitHub main initially pointed to `612cdaf`.
- Eight uncommitted source/test files were copied to an ignored recovery directory
  with verified SHA-256 hashes and a binary patch before integration. There were
  no staged changes or nonignored untracked files.
- Preservation commit: `e245ea1b6161e0dc75823f0a4ac3b51768666503`, published
  before merging #18 and tagged `checkpoint/pre-pr18-2026-10-18`.
- The checkpoint preserves the local Four Horsemen rules and missile origins,
  one-reward tuning, hero-power VFX choices, and related tests. Manual tuning was
  not reverted to satisfy older expectations.
- Recovery copies and their manifest are under
  `.tmp/pr18-preservation-2026-10-18T14-21-25-953Z`; the manifest maps original
  paths to files with a `.backup` suffix. `RECOVERY.txt` explains their use.
  The published checkpoint is the durable recovery point; `.tmp` is local only.
- All eight files remained byte-for-byte identical after the merge. No assets,
  existing stashes, or branches were removed. No extra worktree was created.

## PR history and GitHub disposition

| PR                                                      | Actual integration                                                                                                                                                                                                                                                                               | GitHub disposition                                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#14](https://github.com/gmargonato/HSInspired/pull/14) | Original head `9825f6c` entered main through local merge `7326f54`, already published. Later VFX work superseded parts of it.                                                                                                                                                                    | Closed as already integrated, with an explanatory comment. GitHub rejected retargeting to main because there were no new commits; no duplicate merge was created. |
| [#15](https://github.com/gmargonato/HSInspired/pull/15) | Session history confirms local integration on 16 October. Its changes were subsequently saved in accumulated-work checkpoint `79fe871`, already published. Original PR head `fa84556` was not merged by ancestry. All 67 files were present: 47 identical Git blobs and 20 subsequently changed. | Closed as already incorporated, with the distinction between content integration and commit ancestry documented.                                                  |
| [#16](https://github.com/gmargonato/HSInspired/pull/16) | Original commit `6059b50` is in main's ancestry.                                                                                                                                                                                                                                                 | Already merged; unchanged.                                                                                                                                        |
| [#17](https://github.com/gmargonato/HSInspired/pull/17) | Original head `2601676` entered local main through merge `ad84a95`. Publishing `e245ea1` published that existing merge.                                                                                                                                                                          | GitHub automatically recognized it as merged. Added a history/checkpoint comment.                                                                                 |
| [#18](https://github.com/gmargonato/HSInspired/pull/18) | Original head `80052d98b702990d1d65d63e89a1b4a414bb2ef4` merged without conflicts as `fd786db4ee59ab6a0bcb2c5fd056bc84a7352971`.                                                                                                                                                                 | Retargeted from #17's branch to main after #17 was published. The final checkpoint publishes this merge and its validation record.                                |

## Integration scope

The #18 merge changes exactly its 12 authored files: seven production AI modules,
three durable regression templates, the temporary-test runner, and the original
experiment's validation document. Its changes do not overlap the eight preserved
files. No production integration fixes were required.

The original experiment's validation is historical evidence, not a claim that all
of its worker panels were repeated here. The checks below cover integration with
the current local gameplay and presentation work.

## Local validation

- Before merge: the three modified test files ran 341 source tests, with 338
  passing and three existing presentation-layer assertion failures. Backup copies
  were initially discovered as three extra suites with unresolved imports; adding
  the `.backup` suffix removed those generated-suite discovery errors without
  changing source tests or their assertions.
- PR #18's portable runner: all 43 cases passed; its generated tests were removed
  from the temporary directory by the runner.
- Node and web typechecks passed.
- Dependency boundaries passed: 1,140 modules and 3,392 dependencies checked.
- Scoped ESLint passed for all seven changed production AI modules and the runner.
- Post-merge focused source/AI suite: 506 passed and three failed across 11 files
  (509 cases). The only failures were the same pre-merge presentation assertions
  for confirm, announcement, and waiting disappearance expecting `modalExitLayer`
  at `presentation-queue.test.ts:752`. No assertions were weakened or unrelated
  layer behavior changed. All ten other selected files passed, including Expert
  decision API/world pool, Coin, empty-selector, generation, reconsidered-pass,
  local decision, fair-hypothesis, and both gameplay integration files.
- The default Prettier check reported CRLF checkout line endings in the eight
  imported code/runner files. Comparing formatter output confirmed no other
  formatting differences; checking with `--end-of-line auto` passed. Original
  local files were not reformatted.
- The merge diff passed `git diff --check`. No full application build, development
  server, UI session, full repository verification, or long worker panel was run.

## Final checkpoint

The documentation commit containing this record is tagged
`checkpoint/post-pr18-2026-10-18` and published to main. Use the pre-integration
tag to recover the complete saved local state or compare the integration diff.
No reset, clean, force push, blanket conflict resolution, or code reapplication
was used. Existing branches and stashes remain available.
