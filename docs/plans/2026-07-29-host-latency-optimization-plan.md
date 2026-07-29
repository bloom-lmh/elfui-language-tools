# Host Latency Optimization Plan

Date: 2026-07-29
Status: completed

## Objective

Reduce user-perceived first-use latency without moving workspace-wide work back onto interactive
request paths. Make cold and warm performance observable in the real VS Code Host, then enforce
budgets that are useful but stable across local and CI machines.

## Work Items

1. Add bounded latency distributions with first-request, warm average, p50, p95, and p99 values.
2. Measure both language-server execution and Extension Host round-trip latency for completion,
   formatting, and code actions.
3. Split activation timing into Language Client startup, active-document prewarm, TypeScript plugin
   configuration, and total activation.
4. Prewarm only the active ElfUI document after Language Client startup and prepare newly opened
   ElfUI documents in the background; do not eagerly compile the whole workspace.
5. Add unit coverage for percentile/retention boundaries and document-preparation cache behavior.
6. Add real Host assertions for cold completion and warm p95 latency with environment-overridable,
   CI-safe budgets. Export the measured Host summary for diagnosis.
7. Run typecheck, unit, smoke, M10, development Host, VSIX packaging, and packaged Host gates.
8. Update `docs/PERFORMANCE.md`, `docs/M10-PRODUCTIZATION.md`, and `docs/HANDOFF.md`, then commit
   and push the verified changes.

## Initial Baseline

- M10 Kit pressure: 472 indexed TS/style files.
- Cold index: 60.3 ms on the current machine.
- Warm index: 3.2 ms with 472/472 cache reuse.
- Warm in-process completion, formatting, and code-action gates: below 50 ms.
- Clean real Host first template completion: approximately 0.8-1.1 seconds in prior runs.
- Main gap: no real Host p50/p95/p99 report and no separated active-document prewarm phase.

## Acceptance

- Percentiles are computed from a bounded recent-sample window and retain all-time aggregate data.
- Performance reports remain backward-compatible with existing average/max consumers.
- Prewarm work is restricted to ElfUI documents and does not block workspace indexing.
- Real Host smoke fails on a material latency regression while allowing explicit budget overrides.
- All repository verification commands pass and the handoff records confirmed measurements only.

## Completed Result

- Added bounded 128-sample latency distributions with first, average, min/max, p50, p95, p99,
  and warm-only statistics.
- Added Extension Host middleware timing around completion, formatting, and code-action provider
  round trips while retaining language-server execution timing.
- Split extension activation into component setup, Language Client startup, active-document
  prewarm, TypeScript plugin configuration, and total activation.
- Added explicit active-document tracking. On restart, stale loaded documents no longer trigger an
  immediate full diagnostics burst; diagnostics are refreshed when a document becomes active.
- Changed diagnostics draining to yield between documents so interactive LSP messages can run
  between expensive compiler checks.
- Added development and packaged Host budgets with environment overrides and JSON artifacts under
  `output/host-performance-{development,packaged}.json`.
- Added percentile retention, invalid-sample, document-preparation, development Host, and packaged
  Host coverage.

Confirmed packaged Host measurements on the current Windows machine:

| Metric | Result |
| --- | ---: |
| extension activation | 459.2 ms |
| latest Language Client restart | 948.9 ms |
| active-document prewarm round trip | 163.4 ms |
| active-document prewarm server work | 2.39 ms |
| first isolated completion | 58.5 ms |
| warm completion p50 / p95 / p99 | 5.24 / 8.68 / 8.68 ms |
| warm formatting p95 | 1.66 ms |
| diagnostics published after restart | 7, down from 40 in the pre-optimization instrumented run |
| packaged Host suite | 18/18; 56 seconds clean, about 2 minutes under final repeated contention |

All acceptance commands passed. The VSIX remains 2.91 MiB.
