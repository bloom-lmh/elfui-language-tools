# ElfUI Language Tools Maintenance Handoff

Last updated: 2026-07-29

This repository, `E:\dev_projects\elfui-official\elfui-language-tools`, is the
only maintained home for the ElfUI VS Code extension. Do not modify the retired
`E:\dev_projects\elfui\tools\vscode-extension` copy.

## Continuity Protocol

This file is the required state ledger for ongoing maintenance, not a one-time summary.

- Read it before changing code.
- Update it when a maintenance cycle starts and again before handoff, commit, or release.
- Keep `Current Work`, `Completed This Cycle`, `Known Issues`, `Next Work`, `Verification
  Snapshot`, and `Release State` aligned with the working tree.
- Record only confirmed results. If a gate has not run, mark it pending instead of carrying
  forward an older result.
- Keep long-form release history in `CHANGELOG.md` and Git; keep this document focused on the
  latest actionable state.

## Current Work

Status: `0.4.1` published; GitHub Release completion in progress.

The current cycle aligns Language Tools with `@elfui/compiler@0.1.0-beta.17`, removes the retired
Fragment authoring protocol, improves workspace indexing and cross-file navigation, reduces VSIX
size, separates configuration/index state from server orchestration, and strengthens CI plus real
Extension Host coverage.

Version `0.4.0` is published to the VS Code Marketplace, and commit `1e2809a` plus tag `v0.4.0`
are on Gitee and GitHub. GitHub Release workflow run `30419657827` passed build, unit, smoke,
development Host, and packaging gates but failed before packaged Host startup because Ubuntu GNU
tar cannot extract the ZIP-based VSIX. Version `0.4.1` changes packaged smoke extraction to use
`unzip` on Linux/macOS while retaining the working Windows tar path. Workflow run `30420440673`
then passed the Linux packaged Host gate but stopped because the repository does not configure
`VSCE_PAT`; the already-successful local Marketplace publication remains authoritative.

No changes are required in `elfui`, `elfui-docs`, or `elfui-kit` for this release. Those repositories
were used as read-only compatibility and pressure-test inputs.

## Completed This Cycle

- Removed language-core, language-service, TypeScript plugin, grammar, snippet, formatting,
  metadata, navigation, and smoke coverage for `fragment` / `defineFragment`.
- Upgraded compiler metadata consumption from beta.13 to beta.17.
- Moved initial/full indexing off the interactive LSP path, added asynchronous scans, incremental
  watcher updates, dynamic workspace folders, scan limits, cache reuse, and performance history.
- Added cached cross-file component/prop/event/slot references and rename with import-alias
  preservation.
- Shared the beta.17 completion catalog between desktop and Web extension entries.
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

## Known Issues

- `src/language-service/languageService.ts` is still 8,587 lines and mixes embedded document
  caching, completion, diagnostics, navigation, formatting, and semantic token providers.
- `src/language-service/server.ts` is still 2,863 lines. Configuration and index state are split,
  but package metadata parsing, source scanning, reference indexing, and LSP orchestration still
  share one module.
- `src/extension.ts` is about 2,000 lines and contains Studio-oriented source analysis that
  partially duplicates `language-core`.
- Real first-use Host workflows can take seconds while TypeScript and the workspace index warm up;
  internal warm completion/formatting and index budgets pass, but end-to-end latency should keep
  being measured on larger workspaces.
- The M10 CI pressure gate depends on checking out `bloom-lmh/elfui-kit`; upstream availability is
  therefore part of CI reliability.
- The `v0.4.0` GitHub Release was not created because workflow run `30419657827` failed at Linux
  VSIX extraction. The Marketplace release is valid; `0.4.1` is the non-destructive follow-up.
- GitHub does not currently expose a `VSCE_PAT` repository secret. Local `vsce publish` works; the
  release workflow now skips that optional duplicate publication instead of blocking GitHub Release.

## Next Work

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

## Verification Snapshot

Latest confirmed locally on 2026-07-29 for `0.4.1`:

- `pnpm typecheck`: passed with unused-code checks enabled.
- `pnpm test`: 6 files, 91 tests passed when run serially as in CI.
- `pnpm smoke`: extension startup, Windows/Linux/macOS extraction selection, and 7/7 grammar
  cases passed.
- `pnpm verify:m10`: 360 Kit source files, 27 macro components, cold index 131.1 ms, warm
  472/472 cache reuse in 4.5 ms.
- `pnpm smoke:host`: 18/18 development-extension Host tests passed with clean Host logs.
- `pnpm package:vsix`: 115 files, 2.91 MiB, below the 4 MiB budget.
- `pnpm smoke:vsix`: 18/18 packaged-extension Host tests passed on Windows with clean Host logs.
- GitHub workflow `30420440673`: build, 91 tests, smoke, development Host, package, and Linux
  packaged Host all passed; only the now-optional missing-`VSCE_PAT` publication step failed.

## Release State

- Released version: `0.4.1`.
- Previous release: Marketplace `0.4.0` published; `v0.4.0` pushed to Gitee/GitHub; GitHub Release
  workflow failed only at Linux VSIX extraction.
- Release commit: `036ce90`; pushed to Gitee and GitHub `main`.
- Marketplace: published as `SWUST-WEBLAB-LMH.elfui-language-features v0.4.1`.
- Git tag: `v0.4.1`; pushed to Gitee and GitHub.
- GitHub Release: creation and VSIX upload are pending after the missing-secret workflow stop.
- Local artifact: `.local-vsix/elfui-language-features-0.4.1.vsix`.

## Current Capability

- Embedded HTML/CSS grammar and formatting for ElfUI macro template strings,
  including save formatting alongside a separate TS/JS formatter such as Prettier.
- LSP completion, hover, diagnostics, definitions, references, rename, document symbols,
  inlay hints, code actions, document links, folding, selection, linked editing, and color
  providers in ElfUI regions.
- Local macro support for beta.17 `defineHtml`, `defineProps`, `defineEmits`, `defineSlots`,
  `defineModel`, `defineOptions`, `defineDirective`, and `useComponents`. The removed
  `fragment` / `defineFragment` protocol is intentionally unsupported.
- `@elfui/compiler@0.1.0-beta.17` metadata schema v2 is the source of truth for structured
  components, source ranges, compiler protocol, and diagnostic summaries.
- Asynchronous, cached workspace and dependency component indexing with a 10,000-file default,
  incremental watcher updates, dynamic workspace folders, auto import, and structured metadata.
- Cached cross-file component, prop, event, and slot references/rename with import-alias
  preservation.
- TypeScript server filtering narrowly scoped to false-positive template locals and
  auto-unwrapped `useRef()` comparisons and semantic classifications inside ElfUI-only HTML/CSS
  comments.
- The Web entry uses the shared beta.17 API catalog for macro/runtime, lifecycle, host/form/
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
src/shared/elfuiCatalog.ts       Shared beta.17 desktop/Web completion catalog
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
The recurring VS Code mutex warning in the test environment is harmless when the command exits
successfully.

`package:vsix` strips source maps from its isolated staging tree and fails if the final VSIX is
larger than 4 MiB. The maintained 0.4.0 release-candidate baseline is 2.91 MiB.

The latest maintained Kit baseline is 360 source files, 27 direct macro component entries,
cold indexing under 3 seconds, and warm cached indexing under 750 ms. Use
`ElfUI: Diagnose Integration` first
when a user reports missing completions, colors, or template-local false positives.

## Release

Follow [RELEASING.md](../RELEASING.md). Keep the root extension package and
`elfui-language-features-typescript-plugin/package.json` versions identical. Local VSIX files
are written to `.local-vsix/` and should always pass `pnpm smoke:vsix` before publishing.
