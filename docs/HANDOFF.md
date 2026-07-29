# ElfUI Language Tools Maintenance Handoff

Last updated: 2026-07-29

This repository, `E:\dev_projects\elfui-official\elfui-language-tools`, is the
only maintained home for the ElfUI VS Code extension. Do not modify the retired
`E:\dev_projects\elfui\tools\vscode-extension` copy.

## Continuity Protocol

This file is the required state ledger for ongoing maintenance, not a one-time summary.

- Read it before changing code.
- Update it when a maintenance cycle starts and again before handoff, commit, or release.
- Keep `目标`, `已经做的工作`, `未作的工作（将要做的）`, `当前问题`, `Verification
  Snapshot`, and `Release State` aligned with the working tree.
- Record only confirmed results. If a gate has not run, mark it pending instead of carrying
  forward an older result.
- Keep long-form release history in `CHANGELOG.md` and Git; keep this document focused on the
  latest actionable state.

## 1. 目标

- Maintain `elfui-language-tools` as the only supported home of the ElfUI VS Code extension.
- Remove obsolete protocols and duplicate code while preserving compatibility with the maintained
  ElfUI compiler, Kit source, and documentation examples.
- Keep interactive language features responsive, workspace indexing incremental and cached, and
  the packaged VSIX below the enforced size budget.
- Continue splitting oversized modules along provider, index, configuration, and host boundaries
  without weakening behavior or compatibility.
- Keep unit, grammar, M10 pressure, development Host, packaged Host, CI, and release gates reliable
  on Windows and Linux.
- Treat `elfui`, `elfui-docs`, and `elfui-kit` as read-only compatibility inputs unless a future
  task explicitly authorizes changes in those repositories.

Current maintained baseline: `0.4.1` released.

Current maintenance cycle: intrinsic compiler-diagnostic profiling and optimization are
implemented, fully verified, and synchronized to Gitee and GitHub. The completed record is
`docs/plans/2026-07-29-compiler-diagnostics-performance-plan.md`.

## 2. 已经做的工作

- Removed language-core, language-service, TypeScript plugin, grammar, snippet, formatting,
  metadata, navigation, and smoke coverage for `fragment` / `defineFragment`.
- Upgraded compiler metadata consumption from beta.13 to beta.20.
- Moved initial/full indexing off the interactive LSP path, added asynchronous scans, incremental
  watcher updates, dynamic workspace folders, scan limits, cache reuse, and performance history.
- Added cached cross-file component/prop/event/slot references and rename with import-alias
  preservation.
- Shared the beta.20 completion catalog between desktop and Web extension entries.
- Split settings parsing into `configuration.ts` and index state/per-document option caching into
  `workspaceIndex.ts`; enabled unused-local and unused-parameter compiler gates.
- Reduced the packaged VSIX from roughly 7 MiB to 2.91 MiB by excluding source maps and minifying
  production bundles; packaging now rejects source maps and artifacts above 4 MiB.
- Fixed recursive TextMate injection into embedded HTML, which caused real VS Code renderer
  `Token length and text length do not match` errors during incremental edits.
- Isolated real Host smoke documents by URI and added deterministic generated-fixture cleanup,
  preventing TextMate and semantic-token state from leaking across tests.
- Added a one-second will-save budget plus guarded post-save completion for embedded formatting,
  preventing VS Code listener timeouts when the language server is temporarily busy.
- Made packaged VSIX extraction cross-platform: Windows uses its ZIP-capable tar, while Linux and
  macOS use `unzip`.
- Made remote Marketplace publication optional when `VSCE_PAT` is not configured, so a locally
  published release can still complete its GitHub Release asset upload.
- Expanded CI and release gates to include M10 pressure checks, development Host smoke, packaging,
  packaged VSIX Host smoke, token-length failures, ElfUI will-save listener failures, and deferred
  formatting failures.
- Published Marketplace `0.4.1`, pushed release tag `v0.4.1` to Gitee and GitHub, and created the
  GitHub Release with the verified 3,052,235-byte VSIX asset.
- Fixed the release workflow so missing optional `VSCE_PAT` credentials no longer block a GitHub
  Release after an authoritative local Marketplace publication.
- Added bounded first/warm p50/p95/p99 latency distributions for language-server execution and
  Extension Host completion, formatting, and code-action round trips.
- Split extension activation timing, prewarmed only the active ElfUI document, and exported real
  development/packaged Host performance artifacts with CI-safe latency budgets.
- Added active-editor tracking and yielded between queued diagnostics. Language Client restarts no
  longer immediately diagnose every stale document retained by VS Code; the instrumented restart
  diagnostics count dropped from 40 to 8 and the development Host suite dropped from roughly two
  minutes to 54 seconds on the same machine class.
- Embedded formatting now inherits effective VS Code indentation and
  `elfui.languageFeatures.formatting.printWidth`, with `prettier.printWidth` and
  `editor.wordWrapColumn` fallbacks across document, range, on-type, and external save formatting.
- Escaped nested template literals no longer terminate the outer `defineHtml()` TextMate region;
  parentheses and other brackets inside HTML comments remain comment tokens.
- `Alt+\` reveals and selects the generated handler, method, or state declaration.
- Formatting/color-only configuration changes no longer restart the language server. Pending
  compiler diagnostics wait for a 300 ms editor-idle window and are postponed by interactive
  requests, eliminating the observed multi-second completion queue stall without disabling
  diagnostics.
- Added a bounded per-document diagnostics LRU that returns cloned results and invalidates on
  source or project-component changes. Across all 116 Kit macro files, an unchanged repeat fell
  from 55.3 seconds to 4.7 ms in aggregate.
- Batched compiler-mapping false-positive review into one TypeScript semantic request per document
  instead of one request per diagnostic, and added `pnpm benchmark:diagnostics` with cold/warm and
  compiler/filter attribution.

## 3. 未作的工作（将要做的）

1. Split `languageService.ts` by provider family around a shared embedded-document/cache context,
   starting with completion/hover and diagnostics/code actions.
2. Move workspace/package scanning, metadata parsing, and cross-file reference indexing out of
   `server.ts`; leave the server module responsible for LSP lifecycle and request wiring.
3. Reuse `language-core` analysis in Studio commands and remove the regex-based duplicate analyzer
   from `extension.ts`.
4. Add focused coverage and bundle-size attribution for each extracted module before changing
   behavior.
5. Re-run both development and packaged Host smoke whenever grammar, semantic classifications,
   document edits, or packaging change.
6. Coordinate an incremental compiler diagnostic API or compiler-level parse/type-check cache if
   lower cold idle-time CPU becomes a priority. The language-tools-owned repeat/filter work is now
   cached and batched.

## 4. 当前问题

- `src/language-service/languageService.ts` is still 8,617 lines and mixes embedded document
  caching, completion, diagnostics, navigation, formatting, and semantic token providers.
- `src/language-service/server.ts` is still 3,003 lines. Configuration and index state are split,
  but package metadata parsing, source scanning, reference indexing, and LSP orchestration still
  share one module.
- `src/extension.ts` is 2,301 lines and contains Studio-oriented source analysis that partially
  duplicates `language-core`.
- Compiler beta.20 template compilation is the remaining cold diagnostic hotspot: 41.56 seconds
  of the measured 42.79-second cold diagnostic aggregate over 116 Kit macro files, versus 1.11
  seconds in language-tools filtering. Diagnostics run after a 300 ms idle window and are
  postponed by interactive requests, while unchanged repeats are cached. Further material cold
  reduction requires compiler-level incremental support.
- The M10 CI pressure gate depends on checking out `bloom-lmh/elfui-kit`; upstream availability is
  therefore part of CI reliability.

## Verification Snapshot

Latest confirmed locally on 2026-07-29 for the unreleased performance maintenance after `0.4.1`:

- `pnpm typecheck`: passed with unused-code checks enabled.
- `pnpm test`: 7 files, 98 tests passed.
- `pnpm smoke`: extension startup, Windows/Linux/macOS extraction selection, and 9/9 grammar
  cases passed.
- `pnpm verify:m10`: 376 Kit source files, 27 macro components, cold index 45.6 ms, warm
  491/491 cache reuse in 3.8 ms.
- `pnpm benchmark:diagnostics`: 116 Kit macro files; baseline cold/repeat was
  58,487.4/55,305.0 ms; optimized preparation plus cold was 43,599.8 ms and repeat was 4.7 ms.
  Remaining cold attribution was 41,558.4 ms compiler compilation and 1,105.1 ms macro filtering.
- `pnpm smoke:host`: 18/18 development-extension Host tests passed with clean Host logs in 24
  seconds. Activation was 524.9 ms, latest server startup 317.1 ms, prewarm 74.3 ms, first
  completion 22.90 ms, warm completion p95 5.17 ms, and warm formatting p95 1.19 ms.
- `pnpm package:vsix`: 115 files, 2.92 MiB, below the 4 MiB budget.
- `pnpm smoke:vsix`: 18/18 packaged-extension Host tests passed on Windows with clean Host logs in
  24 seconds. Activation was 511.3 ms, latest server startup 472.5 ms, prewarm 66.6 ms, first
  completion 24.78 ms, warm completion p95 3.74 ms, and warm formatting p95 1.27 ms.
- GitHub workflow `30420440673`: build, 91 tests, smoke, development Host, package, and Linux
  packaged Host all passed; only the now-optional missing-`VSCE_PAT` publication step failed.

## Release State

- Released version: `0.4.1`.
- Unreleased editor maintenance commits: `80c2daf` and `998f0a9`; beta.20 compiler alignment,
  formatting/highlighting/navigation fixes, and interactive-priority diagnostic scheduling are
  fully verified and pushed to Gitee and GitHub `main`.
- Diagnostics cache/batching and benchmark commit: `7c4c81f`; fully verified and pushed to Gitee
  and GitHub `main`.
- Previous release: Marketplace `0.4.0` published; `v0.4.0` pushed to Gitee/GitHub; GitHub Release
  workflow failed only at Linux VSIX extraction.
- Release commit: `036ce90`; pushed to Gitee and GitHub `main`.
- Release-workflow follow-up: `5627d44`; pushed to Gitee and GitHub `main`.
- Marketplace: published as `SWUST-WEBLAB-LMH.elfui-language-features v0.4.1`.
- Git tag: `v0.4.1`; pushed to Gitee and GitHub.
- GitHub Release: `https://github.com/bloom-lmh/elfui-language-tools/releases/tag/v0.4.1`;
  verified VSIX asset uploaded (3,052,235 bytes).
- Local artifact: `.local-vsix/elfui-language-features-0.4.1.vsix`.

## Current Capability

- Embedded HTML/CSS grammar and formatting for ElfUI macro template strings,
  including save formatting alongside a separate TS/JS formatter such as Prettier.
- LSP completion, hover, diagnostics, definitions, references, rename, document symbols,
  inlay hints, code actions, document links, folding, selection, linked editing, and color
  providers in ElfUI regions.
- Local macro support for beta.20 `defineHtml`, `defineProps`, `defineEmits`, `defineSlots`,
  `defineModel`, `defineOptions`, `defineDirective`, and `useComponents`. The removed
  `fragment` / `defineFragment` protocol is intentionally unsupported.
- `@elfui/compiler@0.1.0-beta.20` metadata schema v2 is the source of truth for structured
  components, source ranges, compiler protocol, and diagnostic summaries.
- Asynchronous, cached workspace and dependency component indexing with a 10,000-file default,
  incremental watcher updates, dynamic workspace folders, auto import, and structured metadata.
- Cached cross-file component, prop, event, and slot references/rename with import-alias
  preservation.
- TypeScript server filtering narrowly scoped to false-positive template locals and
  auto-unwrapped `useRef()` comparisons and semantic classifications inside ElfUI-only HTML/CSS
  comments.
- The Web entry uses the shared beta.20 API catalog for macro/runtime, lifecycle, host/form/
  observer, directive, modifier, and built-in component completions.
- ElfUI Studio commands: component structure, dynamic point report, static preview, binding
  migration, workspace performance report, metadata generation, and performance history export.

## User Commands

- `ElfUI: Restart Language Server`
- `ElfUI: Show Output Channel`
- `ElfUI: Diagnose Integration`
- `ElfUI: Show Component Structure`
- `ElfUI: Show Dynamic Points`
- `ElfUI: Preview Component`
- `ElfUI: Migrate Template Bindings to Expressions`
- `ElfUI: Show Workspace Index Report`
- `ElfUI: Export Workspace Performance Report`
- `ElfUI: Clear Workspace Performance History`
- `ElfUI: Generate Component Metadata`
- `ElfUI: Inject Missing Template Declaration` (`Alt+\`)

`Show Workspace Index Report` retains the latest 20 explicit samples per workspace. Export
writes `.elfui/performance-report.json`; neither feature writes during normal completion.

## Package Metadata

Component packages declare metadata in `package.json`:

```json
{
  "elfui": {
    "languageTools": {
      "components": "./dist/elfui.components.json"
    }
  }
}
```

Each component supports legacy string arrays or structured values:

```json
{
  "components": [
    {
      "exportName": "PackageButton",
      "localName": "PackageButton",
      "tagName": "elf-package-button",
      "props": [
        { "name": "label", "type": "string" },
        { "name": "open", "type": "boolean", "default": false }
      ],
      "emits": [
        { "name": "confirm", "payloadType": "{ value: string }" }
      ],
      "slots": ["default", "footer"],
      "slotScopes": [
        { "name": "footer", "scopeType": "{ action: { disabled: boolean } }" }
      ]
    }
  ]
}
```

`ElfUI: Generate Component Metadata` reuses the cached workspace index, writes only changed
metadata, and adds the default `elfui.languageTools.components` declaration when a workspace
`package.json` does not have one.

Dependency metadata readers accept both the existing package metadata shape and compiler schema
v2 JSON. Legacy Fragment metadata is not indexed.

## Source Layout

```text
src/extension.ts                 VS Code activation, Studio commands, report persistence
src/lsp/client.ts                Language client configuration
src/language-core/source.ts      TypeScript AST source analysis
src/language-service/configuration.ts  Validated extension/LSP settings
src/language-service/            LSP features and workspace/package index
src/language-service/workspaceIndex.ts Workspace index state and per-document option cache
src/shared/elfuiCatalog.ts       Shared beta.20 desktop/Web completion catalog
src/web/                         Browser-safe completion logic and tests
src/typescript-plugin/           Narrow native TS diagnostic suppression
syntaxes/                        TextMate injection grammar
snippets/                        Macro component snippets
test/grammar/                    Token-level grammar checks
test/smoke/                      Real Extension Host and packaged VSIX tests
scripts/                         Build, package, smoke, and M10 verification commands
```

## Verification

Run from the repository root:

```powershell
pnpm typecheck
pnpm test
pnpm smoke
pnpm verify:m10
pnpm smoke:host
pnpm package:vsix
pnpm smoke:vsix
```

`smoke:host` and `smoke:vsix` launch a real VS Code Extension Host and fail on TextMate
token-length mismatches, ElfUI will-save listener failures, or deferred save-formatting failures.
They also enforce first-completion, active-prewarm, warm-completion-p95, and
warm-formatting-p95 budgets and write ignored JSON evidence under `output/`.
The recurring VS Code mutex warning in the test environment is harmless when the command exits
successfully.

`package:vsix` strips source maps from its isolated staging tree and fails if the final VSIX is
larger than 4 MiB. The maintained 0.4.1 release baseline is 2.91 MiB.

The latest maintained Kit baseline is 360 source files, 27 direct macro component entries,
cold indexing under 3 seconds, and warm cached indexing under 750 ms. Use
`ElfUI: Diagnose Integration` first
when a user reports missing completions, colors, or template-local false positives.

## Release

Follow [RELEASING.md](../RELEASING.md). Keep the root extension package and
`elfui-language-features-typescript-plugin/package.json` versions identical. Local VSIX files
are written to `.local-vsix/` and should always pass `pnpm smoke:vsix` before publishing.
