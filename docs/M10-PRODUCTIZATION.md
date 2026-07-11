# M10 Productization Gate

This document records the acceptance gate used to close M10-P2 and M10-P3 for
`tools/vscode-extension`.

## Command

```bash
pnpm --dir tools/vscode-extension verify:m10
```

The gate scans the real `ui-kit/src/components` tree and checks:

- macro/builder component pressure
- `${...}` expression binding pressure
- `v-for` local pressure
- `v-model` pressure
- Shadow DOM selectors, `::part`, `::slotted`, and `--elf-*` CSS token pressure
- cached index reuse and cold/warm performance budget
- Host smoke coverage for `useComponents()` aliases, `defineModel()`,
  `defineSlots<T>()`, dependency package metadata, workspace symbols,
  definition/references/rename, inlay hints, quick fixes, and auto imports

## Current Baseline

Latest local run on 2026-07-10:

| Gate | Result |
| --- | --- |
| ui-kit source files | 257 TS files |
| macro/builder component files | 55 files |
| expression bindings | 1213 |
| `v-for` declarations | 50 |
| `v-model` bindings | 16 |
| `:host` selectors | 444 |
| `::part` / `::slotted` selectors | 16 |
| `--elf-*` token references | 1312 |
| cold scan budget | 50-80 ms observed, budget <= 3000 ms |
| warm cache budget | 3-5 ms observed, budget <= 750 ms |

## Studio Features

M10-P3 is accepted through real VS Code Extension Host coverage for:

- `ElfUI Components` explorer view
- `ElfUI: Show Component Structure`
- `ElfUI: Show Dynamic Points`
- `ElfUI: Preview Component`
- `ElfUI: Migrate Template Bindings to Expressions`
- `ElfUI: Show Workspace Index Report`

The preview is intentionally a static template preview. Runtime mounting remains
framework/application-owned because project dev-server setup varies by app.
