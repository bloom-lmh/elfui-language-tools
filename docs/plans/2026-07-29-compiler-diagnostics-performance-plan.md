# Compiler Diagnostics Performance Plan

Date: 2026-07-29

## Goal

Reduce the intrinsic CPU cost of `createElfDiagnostics()` while preserving every existing macro,
template, style, comment, `v-for`, ref-unwrapping, and component-contract diagnostic.

## Original Baseline Method

- Benchmark all macro component files under `elfui-kit/src/components`.
- Record cold and immediate-repeat diagnostic duration per file.
- Keep the existing development and packaged Extension Host latency artifacts as the
  end-to-end interaction guard.
- Add focused cache invalidation and option-revision tests before relying on warm results.

## Candidate Hotspots

1. `analyzeElfSource()` compiles macro metadata and `createMacroDiagnostics()` separately invokes
   `compileMacroComponent()` with template type checking.
2. Repeated diagnostic requests for an unchanged document currently rerun macro compilation,
   template validation, style validation, and diagnostic filtering.
3. Macro false-positive filters can request TypeScript semantic diagnostics once per compiler
   diagnostic even when expressions share the same generated source.
4. Code-action aggregation can call `createElfDiagnostics()` again for the same document version.

## Constraints

- Cache keys must include source content and project-component options.
- Source edits and workspace-index revisions must invalidate affected results.
- Returned diagnostic arrays must not expose mutable cache state.
- No diagnostic class may be dropped merely to improve timing.
- The full unit, M10, development Host, package, and packaged Host gates remain mandatory.

## Verification

- The unchanged-document LRU cache returns cloned diagnostics and invalidates on source or
  project-component changes.
- Compiler mapping candidates now share one TypeScript semantic-diagnostics batch instead of
  creating a semantic request for each compiler diagnostic.
- `pnpm typecheck`, 98 unit tests, smoke/grammar, M10 pressure, development Host, packaging, and
  packaged Host gates passed.

## Outcome

The language-tools-owned repeat work is removed: unchanged diagnostics return directly from a
bounded cache, while source and project-component changes invalidate the appropriate layers.
Further material cold-start gains require compiler-level TypeScript program reuse.

Implementation commit: `7c4c81f`; pushed to Gitee and GitHub `main`.

## Benchmark Correction

The original temporary benchmark bundle ran outside `dist/` and could not access the TypeScript
standard libraries that are shipped beside the real server. Its 43,599.8 ms optimized cold total,
41,558.4 ms compiler attribution, and false-positive-filter attribution are therefore invalid and
must not be used for release decisions.

The corrected benchmark builds first and runs beside `dist/typescript-lib`. On 117 current Kit
macro files with npm compiler beta.20 it records 59,061.0 ms cold diagnostics, 58,945.3 ms macro
compilation, 2.8 ms compiler-diagnostic filtering, and 10.4 ms aggregate unchanged repeat. The
cache correctness and invalidation tests remain valid; only the earlier cold-cost attribution was
incorrect.
