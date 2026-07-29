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
- The component structure view refreshes after a 120 ms quiet window.

This keeps macro compilation, TypeScript template checking, disk reads, and full
workspace rescans out of the completion and rename request paths. The default scan ceiling is
10,000 source files and remains configurable.

## Gates

`pnpm test` contains a warm completion and formatting gate under 50 ms per request.
`pnpm verify:m10` continues to enforce the workspace index budget:

- cold index scan: at most 3000 ms
- warm cached index: at most 750 ms

`pnpm package:vsix` also rejects source maps in its staging tree and enforces a 4 MiB compressed
VSIX budget. The 0.4.0 cleanup baseline is 2.91 MiB, down from roughly 7 MiB before source maps
were excluded.

Use `ElfUI: Show Workspace Index Report` to inspect completion, formatting, and
diagnostics latency collected by the language server.
