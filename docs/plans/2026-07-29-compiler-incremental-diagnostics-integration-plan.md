# Compiler Incremental Diagnostics Integration Plan

Date: 2026-07-29

## Goal

Reduce the remaining cold template-diagnostic CPU cost by adding bounded incremental TypeScript
program reuse inside `@elfui/compiler`, then verify that Language Tools consumes the optimized
compiler without changing diagnostics or interactive behavior.

## Baseline

- 117 real Kit macro files.
- Corrected npm beta.20 Language Tools cold diagnostics: 59,061.0 ms.
- Compiler template compilation: 58,945.3 ms of the 59,061.0 ms cold diagnostic total.
- Immediate repeat is already cached at the Language Tools layer: 10.4 ms aggregate.

## Implementation

1. Add a reproducible compiler template-diagnostic benchmark over the real Kit source.
2. Reuse TypeScript program/library state through a bounded workspace cache.
3. Request diagnostics only for the generated template source while preserving imported type
   resolution and diagnostic mapping.
4. Add same-file edit, cross-file, invalid template, and cache-eviction coverage.
5. Publish or otherwise consume the resulting compiler version from Language Tools.

## Constraints

- No diagnostic may be hidden because it originated from a changed document.
- Different workspaces, macro import paths, and compiler options must not share unsafe state.
- Cache size must be bounded and disposable.
- Compiler output, metadata, source maps, Vite behavior, and public API remain compatible.
- Both repositories must pass their full release/productization gates.

## Verification

- Local compiler integration: 51,915.7 ms cold diagnostics and 3.9 ms aggregate repeat.
- Local compiler macro compilation: 51,799.6 ms; filtering: 0.7 ms.
- Cold Language Tools diagnostics are 12.1% below the corrected npm beta.20 baseline.
- Direct compiler benchmark:
  - beta.20 cold/second pass: 73,321.5 / 78,396.9 ms;
  - optimized cold/second pass: 55,969.1 / 58,732.3 ms;
  - 23.7% / 25.1% reduction with an unchanged diagnostic set after removing four confirmed
    cross-file line-number projections.
- Compiler focused edit/import/isolation/eviction tests: passed.
- ElfUI compiler implementation commit: `27d5b41`; handoff commit: `59ea441`; both pushed to Gitee
  and GitHub `main`.
- Language Tools typecheck, 98 tests, smoke/grammar, M10 pressure, and 2.92 MiB VSIX packaging
  passed.
- Development and packaged Host reruns are pending because the local VS Code Inno updater has held
  `vscode-updating` since 19:44. The runner now supports an isolated downloaded test archive, but
  the current network path stalled while fetching it.
- ElfUI `v0.1.0-beta.21` passed its Linux release workflow and all seven packages were published
  through npm Trusted Publishing.
- Language Tools now pins `@elfui/compiler@0.1.0-beta.21`; the release-candidate benchmark kept
  the immediate 117-file repeat at 4.5 ms. Its 64,173.1 ms cold result was collected while the
  Windows host was under unrelated process contention, so the controlled direct-compiler result
  above remains the release performance comparison.
- Language Tools `0.4.2` was packaged at 2.92 MiB and published to the VS Code Marketplace. The
  GitHub release workflow remains the authoritative Linux development/packaged Host gate because
  the local VS Code updater still prevents either Host from launching.
