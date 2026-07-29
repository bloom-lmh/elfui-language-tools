# Compiler Diagnostics Performance Plan

Date: 2026-07-29

## Goal

Reduce the intrinsic CPU cost of `createElfDiagnostics()` while preserving every existing macro,
template, style, comment, `v-for`, ref-unwrapping, and component-contract diagnostic.

## Baseline Method

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

- Baseline across 116 real Kit macro files:
  - cold diagnostics: 58,487.4 ms;
  - immediate repeat: 55,305.0 ms.
- Optimized result across the same 116 files:
  - source preparation plus cold diagnostics: 43,599.8 ms, 25.5% below baseline;
  - immediate repeat: 4.7 ms, more than 99.99% below baseline;
  - macro compilation: 41,558.4 ms;
  - language-tools macro filtering: 1,105.1 ms.
- The unchanged-document LRU cache returns cloned diagnostics and invalidates on source or
  project-component changes.
- Compiler mapping candidates now share one TypeScript semantic-diagnostics batch instead of
  creating a semantic request for each compiler diagnostic.
- `pnpm typecheck`, 98 unit tests, smoke/grammar, M10 pressure, development Host, packaging, and
  packaged Host gates passed.

## Outcome

The language-tools-owned repeat work is removed. A repeated diagnostic request for all 116 Kit
macro files now costs 4.7 ms in aggregate instead of 55.3 seconds. Cold end-to-end work is 25.5%
lower, but 41.56 of the remaining 42.79 seconds is the beta.20 compiler's template compilation.
Further material cold-start gains require an incremental compiler API or compiler-level
parse/type-check cache; adding another language-service scheduling layer would not remove that
CPU cost.

Implementation commit: `7c4c81f`; pushed to Gitee and GitHub `main`.
