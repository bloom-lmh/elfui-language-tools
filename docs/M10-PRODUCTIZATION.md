# M10 Productization Gate

This document records the acceptance gate used to close M10-P2 and M10-P3 for
this repository.

## Command

```bash
pnpm verify:m10
```

The gate scans the maintained `elfui-kit/src/components` tree and checks:

- macro component pressure
- `${...}` expression binding pressure
- `v-for` local pressure
- `v-model` pressure
- Shadow DOM selectors, `::part`, `::slotted`, and `--elf-*` CSS token pressure
- cached index reuse and cold/warm performance budget
- Host smoke coverage for `useComponents()` aliases, `defineModel()`,
  `defineSlots<T>()`, dependency package metadata, workspace symbols,
  definition/references/rename, inlay hints, quick fixes, and auto imports
- asynchronous scan limits/cache reuse and cached cross-file component contract rename
- real Host logs, including hard failures on TextMate token-length mismatches, ElfUI will-save
  listener errors, and deferred save-formatting failures

## Current Baseline

Latest local baseline on 2026-07-29:

| Gate | Result |
| --- | --- |
| elfui-kit source files | 360 TS files |
| macro component files | 27 files |
| expression bindings | 2380 |
| `v-for` declarations | 68 |
| `v-model` bindings | 16 |
| `:host` selectors | 766 |
| `::part` / `::slotted` selectors | 83 |
| `--elf-*` token references | 2049 |
| cold scan budget | 45.8 ms observed, budget <= 3000 ms |
| warm cache budget | 3.0 ms observed, budget <= 750 ms |

## Studio Features

M10-P3 is accepted through real VS Code Extension Host coverage for:

- `ElfUI Components` explorer view
- `ElfUI: Show Component Structure`
- `ElfUI: Show Dynamic Points`
- `ElfUI: Preview Component`
- `ElfUI: Migrate Template Bindings to Expressions`
- `ElfUI: Show Workspace Index Report`
- `ElfUI: Generate Component Metadata`
- `ElfUI: Export Workspace Performance Report`

The preview is intentionally a static template preview. Runtime mounting remains
framework/application-owned because project dev-server setup varies by app.
