# Formatting, Highlighting, and Alt+\ Navigation Fix Plan

Date: 2026-07-29

## Goal

Fix four editor-facing regressions before continuing compiler-diagnostic performance work:

1. Embedded HTML/CSS formatting must inherit the effective VS Code `tabSize` and print-width
   preference.
2. Escaped nested template literals inside `defineHtml()` attributes must not terminate the outer
   TextMate region.
3. Parentheses inside commented-out ElfUI HTML must remain comment tokens and must not receive
   bracket-pair coloring.
4. `Alt+\` declaration injection must reveal and select the generated method/state name.

## Implementation

- Resolve formatting options at the Language Client boundary so document, range, multi-range,
  on-type, and deferred save formatting all receive the same effective indentation and line width.
- Add an ElfUI print-width setting with a compatibility fallback to `prettier.printWidth`.
- Harden TextMate template terminators against escaped backticks and make comment punctuation
  consume bracket characters as comment tokens.
- After applying the selected quick fix, locate the generated declaration in the updated document,
  reveal it, and select its identifier.
- Add focused language-service, grammar, and real Extension Host regression coverage.

## Verification

- `pnpm typecheck`: passed.
- `pnpm test`: 7 files, 96 tests passed.
- `pnpm smoke`: passed, including 9/9 grammar cases.
- `pnpm verify:m10`: passed; 371 Kit TS files, 56.1 ms cold index, 485/485 reused
  in 3.6 ms.
- `pnpm smoke:host`: 18/18 passed with clean Host logs.
- `pnpm package:vsix`: 115 files, 2.91 MiB.
- `pnpm smoke:vsix`: 18/18 passed with clean Host logs.
- `git diff --check`: passed.

Measured development Host: 588.0 ms activation, 317.3 ms latest server startup, 71.7 ms
prewarm, 26.00 ms first completion, 4.44 ms warm completion p95, and 1.44 ms warm formatting
p95.

Measured packaged Host: 574.0 ms activation, 358.4 ms latest server startup, 64.3 ms prewarm,
25.03 ms first completion, 4.65 ms warm completion p95, and 2.37 ms warm formatting p95.

## Outcome

All four editor regressions are fixed. The follow-on diagnostics hotspot was also addressed at
the scheduling boundary: interactive requests postpone pending compiler diagnostics until a
300 ms idle window, while diagnostics still publish after editing settles. Client-only
formatting and color changes no longer restart the language server.

## Scope

Compiler-diagnostic performance optimization is intentionally paused until these four regressions
are fixed and the complete gate set passes.
