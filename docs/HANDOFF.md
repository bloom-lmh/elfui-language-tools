# ElfUI Language Tools Maintenance Handoff

Last updated: 2026-07-31

This repository, `E:\elfui-language-tools`, is the
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

Current maintained baseline: `0.4.5` fully released.

Current maintenance cycle: `0.4.5` is fully released. The complete local and GitHub gates passed,
Marketplace public discovery returns `0.4.5`, annotated tag `v0.4.5` is pushed to Gitee and
GitHub, and the public GitHub Release contains the verified VSIX asset. Only this final handoff
sync remains to be committed and pushed.

## 2. 已经做的工作

- Removed language-core, language-service, TypeScript plugin, grammar, snippet, formatting,
  metadata, navigation, and smoke coverage for `fragment` / `defineFragment`.
- Upgraded compiler metadata consumption from beta.13 through beta.21.
- Moved initial/full indexing off the interactive LSP path, added asynchronous scans, incremental
  watcher updates, dynamic workspace folders, scan limits, cache reuse, and performance history.
- Added cached cross-file component/prop/event/slot references and rename with import-alias
  preservation.
- Shared the beta.21 completion catalog between desktop and Web extension entries.
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
- Corrected the diagnostics benchmark to build first and run beside `dist/typescript-lib`, with an
  optional local compiler source override for pre-release integration measurements.
- Added an explicit Host runner fallback to the isolated downloaded VS Code 1.90 archive when the
  user installation is unavailable during an update.
- Published all seven ElfUI `0.1.0-beta.21` packages after the complete Linux release gate passed,
  then pinned Language Tools to `@elfui/compiler@0.1.0-beta.21`.
- Packaged Language Tools 0.4.2 at 2.92 MiB and published it to the VS Code Marketplace.
- Made full-document embedded HTML formatting remove accumulated host indentation before invoking
  the HTML formatter and normalize markup-line indentation inside multiline `pre` content.
  Repeated formatting and save formatting are now idempotent for the reported nested
  `pre > code > span` case.
- Changed the managed ElfUI component-tag name default to Dracula Cyan (`#8BE9FD`) with italic
  TextMate styling while continuing to honor a configured custom foreground color. Tag
  punctuation retains the active theme's styling.
- Embedded HTML formatting now maps `prettier.singleAttributePerLine: true` to the HTML language
  service's `force-expand-multiline` strategy. Users can override it explicitly with
  `elfui.languageFeatures.formatting.wrapAttributes`.
- Added a `prettier` embedded-HTML wrapping strategy for the default
  `prettier.singleAttributePerLine: false` case. It reuses protected template expressions, keeps
  short tags compact, expands over-width start tags to one attribute per line, follows
  `prettier.bracketSameLine`, and stays idempotent across repeated document/save formatting.
- Extended unit and real development/packaged Host coverage to assert the reported Button layout:
  long start tags expand, short multi-attribute `slot`/`span` tags remain on one line, and the
  closing bracket is placed on its own line when configured.
- Component `:key` bindings no longer surface the beta.21 compiler's reserved-attribute prop-name
  false positive. Diagnostics within the key expression remain active.
- TextMate highlighting now supports multiline generic arguments in `defineHtml<...>(...)` and
  explicitly named bare HTML/CSS template strings, while leaving unrelated template strings alone.
- Confirmed the reported quoted-template diagnostics are real strict-template errors:
  `category.items[0]` can be undefined with unchecked indexed access, and template refs are
  auto-unwrapped, so quoted expressions must not use `.value`.

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
6. Profile beta.21 under a controlled low-contention host before attempting another compiler
   optimization. Program reuse is now bounded in the compiler and unchanged Language Tools
   repeats are already cached and batched.

## 4. 当前问题

- `src/language-service/languageService.ts` is still 8,617 lines and mixes embedded document
  caching, completion, diagnostics, navigation, formatting, and semantic token providers.
- `src/language-service/server.ts` is still 3,003 lines. Configuration and index state are split,
  but package metadata parsing, source scanning, reference indexing, and LSP orchestration still
  share one module.
- `src/extension.ts` is 2,301 lines and contains Studio-oriented source analysis that partially
  duplicates `language-core`.
- Compiler template compilation remains the dominant cold diagnostic cost after beta.21's bounded
  program reuse. The controlled direct benchmark improved cold/second-pass time by 23.7%/25.1%;
  the latest Language Tools release-candidate run was collected under unrelated Windows process
  contention and is not used as the comparative baseline. Diagnostics run after a 300 ms idle
  window and are postponed by interactive requests, while unchanged repeats are cached.
- The M10 CI pressure gate depends on checking out `bloom-lmh/elfui-kit`; upstream availability is
  therefore part of CI reliability.
- The local VS Code test process still logs the recurring updater mutex warning, but development
  and packaged Host suites both launch and complete successfully.
- Transient Windows process contention previously pushed compiler-heavy language-service tests
  past their existing per-test timeouts. The authoritative `0.4.4` release run later passed the
  original `pnpm test` command without changing thresholds; keep the original limits and rerun
  under lower contention before treating a timeout-only result as a regression.

## Verification Snapshot

Latest confirmed locally on 2026-07-31 for the `0.4.5` release candidate:

- `pnpm typecheck`: passed; it also passed inside both development Host build and VSIX packaging.
- `pnpm test`: 7 files, 105 tests passed in 25.65 seconds with the original timeout thresholds.
- `pnpm smoke`: extension startup and 12/12 grammar cases passed.
- `pnpm verify:m10`: passed with 417 Kit source files, 125 style files, 25 macro components,
  98.2 ms cold indexing, and 542/542 warm cache reuse in 24.3 ms.
- `pnpm smoke:host`: 18/18 passed, including Prettier-style embedded save formatting and three
  stable saves. Activation was 551.26 ms, active prewarm 72.32 ms, first completion 43.71 ms,
  warm completion p95 34.49 ms, and warm formatting p95 6.79 ms. The suite passed all enforced
  budgets despite transient Windows process contention during metadata generation.
- `pnpm package:vsix`: 115 files and 3,059,278 bytes (2.92 MiB), below the 4 MiB budget. SHA-256:
  `186F781A1D385B3F44FCD5883088E01ECF27A700B438A2BD39C344435132080B`.
- `pnpm smoke:vsix`: 18/18 packaged-extension Host tests passed. Activation was 533.27 ms,
  active prewarm 72.79 ms, first completion 28.28 ms, warm completion p95 4.71 ms, and warm
  formatting p95 1.20 ms.
- `git diff --check`: passed; the working tree contains only this maintenance cycle's tracked
  edits and its new changeset.

Latest confirmed locally on 2026-07-30 for the `0.4.4` release candidate:

- `pnpm typecheck`: passed with unused-code checks enabled.
- `pnpm test`: 7 files, 104 tests passed in 24.73 seconds with the original timeout thresholds.
- `pnpm smoke`: extension startup and 12/12 grammar cases passed, including multiline generics,
  named bare HTML/CSS templates, interpolation, and the unrelated-template negative case.
- `pnpm verify:m10`: passed with 400 Kit source files, 122 style files, 25 macro components, an
  82.8 ms cold scan, and 522/522 warm cache reuse in 19.0 ms.
- `pnpm smoke:host`: 18/18 development-extension Host tests passed, including explicit
  per-attribute save formatting and repeated formatting idempotency. Activation was 562.2 ms,
  active prewarm 100.2 ms, first completion 42.27 ms, warm completion p95 21.40 ms, and warm
  formatting p95 9.49 ms.
- `pnpm package:vsix`: 115 files and 3,058,552 bytes (2.92 MiB), below the 4 MiB budget. SHA-256:
  `B3F4A72659A5C11D122E71E26D920562392BA2C33AB161271CC59C521B10E53B`.
- `pnpm smoke:vsix`: 18/18 packaged-extension Host tests passed. Activation was 756.3 ms, active
  prewarm 84.8 ms, first completion 32.47 ms, warm completion p95 5.33 ms, and warm formatting p95
  1.55 ms.

Latest confirmed release baseline for `0.4.3`:

- `pnpm typecheck`: passed with unused-code checks enabled.
- `pnpm test`: 7 files, 99 tests passed.
- `pnpm smoke`: extension startup, Windows/Linux/macOS extraction selection, and 9/9 grammar
  cases passed.
- `pnpm verify:m10`: 387 Kit source files, 28 macro components, cold index 79.2 ms, warm
  505/505 cache reuse in 3.3 ms.
- `pnpm smoke:host`: 18/18 development-extension Host tests passed in 39 seconds, including
  repeated save-format idempotency and cyan italic component-tag styling. Activation was
  595.1 ms, active prewarm 71.8 ms, first completion 19.49 ms, warm completion p95 4.53 ms,
  and warm formatting p95 2.01 ms.
- `pnpm package:vsix`: 115 files, 2.92 MiB, below the 4 MiB budget.
- `pnpm smoke:vsix`: 18/18 packaged-extension Host tests passed in 28 seconds, including the same
  formatting and highlighting coverage.
- Corrected `pnpm benchmark:diagnostics` with npm beta.20: 117 Kit macro files; 59,061.0 ms cold,
  10.4 ms aggregate repeat, 58,945.3 ms compiler compilation, and 2.8 ms filtering.
- Local incremental compiler integration: 51,915.7 ms cold and 3.9 ms aggregate repeat, a 12.1%
  cold reduction against npm beta.20; compiler compilation was 51,799.6 ms.
- Published beta.21 release-candidate benchmark: 117 Kit macro files; 64,173.1 ms cold under
  current Windows process contention, 4.5 ms aggregate repeat, 64,052.4 ms compiler compilation,
  and 0.7 ms filtering. This run confirms package integration but is not a controlled performance
  comparison.
- Prior 0.4.1 `pnpm smoke:host` baseline: 18/18 development-extension Host tests passed with clean
  Host logs in 24 seconds. Activation was 524.9 ms, latest server startup 317.1 ms, prewarm
  74.3 ms, first completion 22.90 ms, warm completion p95 5.17 ms, and warm formatting p95
  1.19 ms.
- Prior 0.4.1 `pnpm smoke:vsix` baseline: 18/18 packaged-extension Host tests passed on Windows
  with clean Host logs in 24 seconds. Activation was 511.3 ms, latest server startup 472.5 ms,
  prewarm 66.6 ms, first completion 24.78 ms, warm completion p95 3.74 ms, and warm formatting p95
  1.27 ms.
- Prior GitHub workflow `30420440673`: build, 91 tests, smoke, development Host, package, and Linux
  packaged Host all passed; only the now-optional missing-`VSCE_PAT` publication step failed.
- GitHub release workflow `30463741357`: build, 98 tests, smoke/grammar, development Host,
  packaging, packaged VSIX Host, and GitHub Release creation all passed on Linux.

## Release State

- Released version: `0.4.5`.
- Local release artifact:
  `.local-vsix/elfui-language-features-0.4.5.vsix` (3,059,278 bytes), SHA-256
  `186F781A1D385B3F44FCD5883088E01ECF27A700B438A2BD39C344435132080B`.
- Release commit `0be9121` is pushed to Gitee and GitHub `main`. GitHub required-rule bypass was
  accepted for the direct maintained-main push.
- An initial Marketplace attempt failed before upload with `TF400813`; a user-supplied one-time
  PAT then published `SWUST-WEBLAB-LMH.elfui-language-features v0.4.5` successfully. The PAT was
  not written to `.vsce` or the repository, the process environment was cleared, and the clipboard
  was overwritten. Public Gallery discovery now confirms `0.4.5` as the latest of 38 versions.
- Annotated tag `v0.4.5` points to Marketplace-publication record commit `bec5703` and is pushed to
  Gitee and GitHub.
- GitHub workflow `30644574802` completed successfully and created the public Release:
  `https://github.com/bloom-lmh/elfui-language-tools/releases/tag/v0.4.5`.
- GitHub Release asset: `elfui-language-features-0.4.5.vsix` (3,059,081 bytes).
- Feature commit `ff0cb82`, release commit `488ef6a`, and tag `v0.4.4` are pushed to Gitee and
  GitHub. Package versions remain aligned at `0.4.4`.
- Marketplace: published as `SWUST-WEBLAB-LMH.elfui-language-features v0.4.4`; the public Gallery
  API confirms `0.4.4` with update timestamp `2026-07-30T16:04:26.24Z`.
- GitHub workflow `30559905440` completed successfully and created the public Release:
  `https://github.com/bloom-lmh/elfui-language-tools/releases/tag/v0.4.4`.
- GitHub Release asset: `elfui-language-features-0.4.4.vsix` (3,058,357 bytes).
- Local release artifact: `.local-vsix/elfui-language-features-0.4.4.vsix` (3,058,552 bytes),
  SHA-256 `B3F4A72659A5C11D122E71E26D920562392BA2C33AB161271CC59C521B10E53B`.
- The one-time Marketplace PAT was not persisted in the process environment or `.vsce`; because it
  was disclosed outside the credential store, it must remain revoked after this release.
- The repeated-save formatting fix, cyan italic component-tag default, regression coverage,
  version bump, full local release gate, and Marketplace publication are complete.
- Release commit `d1ee25e` and tag `v0.4.3` are pushed to Gitee and GitHub.
- GitHub workflow `30513172166` completed successfully and created the public Release with its
  3,057,605-byte VSIX asset.
- Editor maintenance commits `80c2daf` and `998f0a9`; formatting/highlighting/navigation fixes and
  interactive-priority diagnostic scheduling are fully verified and pushed to Gitee and GitHub
  `main`.
- Diagnostics cache/batching and benchmark commit: `7c4c81f`; fully verified and pushed to Gitee
  and GitHub `main`.
- Compiler incremental diagnostics commits `27d5b41` and `59ea441` are verified and pushed in the
  `elfui` repository. ElfUI release commit `5c918a7`, tag `v0.1.0-beta.21`, release workflow
  `30462473620`, all seven npm packages, and the GitHub prerelease are complete.
- Corrected benchmark, Host fallback, and beta.21 dependency changes are verified through
  typecheck, unit tests, smoke/grammar, M10, diagnostics benchmarking, and VSIX packaging.
- Previous release: Marketplace `0.4.0` published; `v0.4.0` pushed to Gitee/GitHub; GitHub Release
  workflow failed only at Linux VSIX extraction.
- Release commit: `036ce90`; pushed to Gitee and GitHub `main`.
- Release-workflow follow-up: `5627d44`; pushed to Gitee and GitHub `main`.
- Marketplace: published as `SWUST-WEBLAB-LMH.elfui-language-features v0.4.3`.
- Release commit: `6031197`; pushed to Gitee and GitHub `main`.
- Git tag: `v0.4.3`; pushed to Gitee and GitHub.
- GitHub Release: `https://github.com/bloom-lmh/elfui-language-tools/releases/tag/v0.4.3`;
  verified VSIX asset uploaded (3,057,605 bytes).
- Local artifact: `.local-vsix/elfui-language-features-0.4.3.vsix` (3,057,604 bytes).

## Current Capability

- Embedded HTML/CSS grammar and formatting for ElfUI macro template strings,
  including save formatting alongside a separate TS/JS formatter such as Prettier.
- LSP completion, hover, diagnostics, definitions, references, rename, document symbols,
  inlay hints, code actions, document links, folding, selection, linked editing, and color
  providers in ElfUI regions.
- Local macro support for beta.21 `defineHtml`, `defineProps`, `defineEmits`, `defineSlots`,
  `defineModel`, `defineOptions`, `defineDirective`, and `useComponents`. The removed
  `fragment` / `defineFragment` protocol is intentionally unsupported.
- `@elfui/compiler@0.1.0-beta.21` metadata schema v2 is the source of truth for structured
  components, source ranges, compiler protocol, and diagnostic summaries.
- Asynchronous, cached workspace and dependency component indexing with a 10,000-file default,
  incremental watcher updates, dynamic workspace folders, auto import, and structured metadata.
- Cached cross-file component, prop, event, and slot references/rename with import-alias
  preservation.
- TypeScript server filtering narrowly scoped to false-positive template locals and
  auto-unwrapped `useRef()` comparisons and semantic classifications inside ElfUI-only HTML/CSS
  comments.
- The Web entry uses the shared beta.21 API catalog for macro/runtime, lifecycle, host/form/
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
src/shared/elfuiCatalog.ts       Shared beta.21 desktop/Web completion catalog
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
larger than 4 MiB. The maintained 0.4.2 release baseline is 2.92 MiB.

The latest maintained Kit baseline is 380 source files, 27 direct macro component entries,
cold indexing under 3 seconds, and warm cached indexing under 750 ms. Use
`ElfUI: Diagnose Integration` first
when a user reports missing completions, colors, or template-local false positives.

## Release

Follow [RELEASING.md](../RELEASING.md). Keep the root extension package and
`elfui-language-features-typescript-plugin/package.json` versions identical. Local VSIX files
are written to `.local-vsix/` and should always pass `pnpm smoke:vsix` before publishing.
