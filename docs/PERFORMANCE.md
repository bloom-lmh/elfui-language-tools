# Performance Guardrails

The language server keeps interactive requests ahead of expensive background work.

## Request Path

- Completion, hover, formatting, and navigation reuse the cached source analysis.
- Embedded HTML/CSS virtual documents and parsed HTML/CSS trees are cached by document,
  region, and content.
- TypeScript member completion reuses one incremental `LanguageService` per document
  instead of creating a new `Program` for every `user.` request.
- Project component options are cached per document and invalidated only when the
  workspace index revision changes.

## Background Path

- Diagnostics are debounced while typing and run after a 120 ms idle window.
- Open-document index updates are coalesced using `workspace.indexDebounceMs`.
- File watcher updates are coalesced before reading and parsing changed files.
- Initial and full workspace scans use asynchronous filesystem APIs and yield to the event loop
  while traversing directories and indexing batches.
- Ordinary TS/JS watcher changes update only the affected file; package/metadata changes trigger
  a serialized, coalesced full rebuild.
- Template reference records are stored once per indexed source file and reused by cross-file
  references and rename instead of rescanning consumers per request.
- Workspace index refreshes schedule diagnostics instead of running them inline.
- The client reports the active editor to the language server. Restart synchronization does not
  eagerly diagnose every stale document retained by VS Code; a document is refreshed when it
  becomes active.
- Diagnostics yield between documents so completion, formatting, and navigation messages can run
  between expensive compiler checks.
- The active ElfUI document is prewarmed after Language Client startup. Prewarm prepares cached
  source analysis and parsed HTML/CSS documents only for that document.
- The component structure view refreshes after a 120 ms quiet window.

This keeps macro compilation, TypeScript template checking, disk reads, and full
workspace rescans out of the completion and rename request paths. The default scan ceiling is
10,000 source files and remains configurable.

## Gates

`pnpm test` contains a warm completion and formatting gate under 50 ms per request. Latency
recorders retain 128 recent samples for percentile calculations while preserving all-time count,
average, min/max, first-request, and warm-request aggregates.
`pnpm verify:m10` continues to enforce the workspace index budget:

- cold index scan: at most 3000 ms
- warm cached index: at most 750 ms

Real development and packaged Host smoke additionally enforce these defaults:

- first isolated completion: at most 1500 ms
- active-document prewarm round trip: at most 1500 ms
- warm completion p95: at most 250 ms
- warm formatting p95: at most 1000 ms

Override them on known slow CI hosts with `ELFUI_HOST_FIRST_COMPLETION_BUDGET_MS`,
`ELFUI_HOST_PREWARM_BUDGET_MS`, `ELFUI_HOST_WARM_COMPLETION_P95_BUDGET_MS`, and
`ELFUI_HOST_WARM_FORMATTING_P95_BUDGET_MS`. Successful Host runs write ignored diagnostic
artifacts to `output/host-performance-development.json` and
`output/host-performance-packaged.json`.

`pnpm package:vsix` also rejects source maps in its staging tree and enforces a 4 MiB compressed
VSIX budget. The 0.4.1 baseline is 2.91 MiB, down from roughly 7 MiB before source maps
were excluded.

Use `ElfUI: Show Workspace Index Report` to inspect completion, formatting, and
diagnostics latency collected by the language server. The report separates Extension Host round
trip latency from language-server execution and displays first, warm p50, p95, and p99 values.

## Current Host Baseline

Latest confirmed packaged Host measurements on Windows, 2026-07-29:

| Metric | Result |
| --- | ---: |
| extension activation | 459.2 ms |
| latest Language Client restart | 948.9 ms |
| active-document prewarm | 163.4 ms round trip / 2.39 ms server |
| first completion | 58.5 ms |
| warm completion p50 / p95 / p99 | 5.24 / 8.68 / 8.68 ms |
| warm formatting p95 | 1.66 ms |
| complete packaged Host suite | 18/18; 56 seconds clean, about 2 minutes under repeated contention |

Mocha workflow duration includes document opening, TypeScript Server work, diagnostics polling,
saves, and fixture cleanup. It varied from 56 seconds to roughly two minutes across passing runs on
the same machine. Use the provider round-trip distribution above for request latency.
