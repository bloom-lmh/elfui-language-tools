# ElfUI Language Tools Maintenance Handoff

Last updated: 2026-07-13

This repository, `E:\dev_projects\elfui-official\elfui-language-tools`, is the
only maintained home for the ElfUI VS Code extension. Do not modify the retired
`E:\dev_projects\elfui\tools\vscode-extension` copy.

## Current Capability

- Embedded HTML/CSS grammar and formatting for ElfUI macro and builder template strings.
- LSP completion, hover, diagnostics, definitions, references, rename, document symbols,
  inlay hints, code actions, document links, folding, selection, linked editing, and color
  providers in ElfUI regions.
- Local macro support for `defineHtml`, `defineProps`, `defineEmits`, `defineSlots`,
  `defineModel`, and `useComponents`, including typed prop/default hover and typed `$event`
  completion.
- Workspace and dependency component indexing with auto import, structured package metadata,
  typed prop/default hover, event payload hover, and typed slot scopes.
- TypeScript server filtering narrowly scoped to false-positive template locals and
  auto-unwrapped `useRef()` comparisons.
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

## Source Layout

```text
src/extension.ts                 VS Code activation, Studio commands, report persistence
src/lsp/client.ts                Language client configuration
src/language-core/source.ts      TypeScript AST source analysis
src/language-service/            LSP features and workspace/package index
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

`smoke:host` and `smoke:vsix` launch a real VS Code Extension Host. The recurring VS Code
mutex warning in the test environment is harmless when the command exits successfully.

The latest M10 baseline is 257 source files, 55 macro/builder component files, cold indexing
under 3 seconds, and warm cached indexing under 750 ms. Use `ElfUI: Diagnose Integration` first
when a user reports missing completions, colors, or template-local false positives.

## Release

Follow [RELEASING.md](../RELEASING.md). Keep the root extension package and
`elfui-language-features-typescript-plugin/package.json` versions identical. Local VSIX files
are written to `.local-vsix/` and should always pass `pnpm smoke:vsix` before publishing.
