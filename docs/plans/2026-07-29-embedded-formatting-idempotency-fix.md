# Embedded Formatting Idempotency Fix

Date: 2026-07-29

## Goal

Keep embedded `defineHtml()` formatting idempotent when whitespace-sensitive `pre` / `code`
content contains deeply nested inline markup. Repeated document formatting or save formatting
must produce the same text instead of adding another host-indentation prefix on every pass.

## Work

- [x] Reproduce the reported nested `pre > code > span` template with the effective VS Code
  indentation settings.
- [x] Add unit coverage that formats the same document repeatedly and compares every pass.
- [x] Fix host indentation restoration without changing meaningful whitespace inside
  whitespace-sensitive HTML elements.
- [x] Add real Host save-formatting coverage when the local or CI Host is available.
- [x] Run typecheck, unit, grammar/smoke, M10, Host, and package gates as applicable.
- [x] Update the maintenance handoff with confirmed results.

## Result

- Full-document template formatting removes the host indentation before invoking the HTML
  formatter and normalizes markup-line indentation inside multiline `pre` regions.
- Unit coverage verifies three identical formatting passes with fixed options.
- Development and packaged Host coverage verifies stable repeated saves after editor
  configuration propagation.
- ElfUI component tag names now default to Dracula Cyan (`#8BE9FD`) with italic TextMate styling;
  tag punctuation keeps the active theme's styling.

## Constraints

- Preserve literal text whitespace inside `pre`, `code`, `textarea`, and other HTML regions where
  whitespace can be meaningful.
- Continue honoring effective `editor.insertSpaces`, `editor.tabSize`, and print-width settings.
- The first formatting pass may normalize malformed indentation; every subsequent pass must be a
  no-op.
- Do not change TypeScript formatting outside ElfUI embedded regions.
