# ElfUI Language Features

VS Code language features for ElfUI macro and chain components.

## StackBlitz Codeflow / VS Code for the Web

The extension now has a browser entry point. In a web extension host such as
StackBlitz Codeflow, it provides the ElfUI TextMate grammar, macro snippets,
directive completions, macro completions, and the `ElfUI: Diagnose Integration`
command without requiring a native process.

The full language server, workspace component index, TypeScript server plugin,
and ElfUI Studio commands still require the Node extension host used by desktop
VS Code. This distinction is intentional: the web entry never claims that the
Node IPC language server is running.

To use the web experience, open the repository in Codeflow, open **Extensions**,
and install the packaged VSIX. The local package command creates it at
`.local-vsix/elfui-language-features-X.Y.Z.vsix`:

```bash
pnpm package:vsix
```

For the ElfUI StackBlitz starter, open
`https://pr.new/bloom-lmh/elfui-playground` in Codeflow, then install the VSIX
from the Extensions pane. Once the extension is published to the Visual Studio
Marketplace, the same pane can install it by name instead.

## Features

- Macro component support for ordinary `.ts` / `.tsx` files that export `defineHtml()` components.
- Realtime macro diagnostics from the ElfUI macro compiler, including template TypeScript errors, slot checks, and structured source ranges.
- Macro-aware completion and hover for `defineProps()`, `defineEmits()`, `defineSlots()`, `defineHtml()`, `useComponents()`, lifecycle hooks, and typed `useTemplateRef()` values.
- Template prop hover for local macro components includes the individual TypeScript type and statically declared default value when available.
- Hover metadata for indexed workspace and package components, including import source, typed props with static defaults, events, slots, and typed slot scopes.
- HTML completion, hover, diagnostics, and closing tag support inside `defineHtml(\`...\`)` and builder `.template(\`...\`)` regions.
- ElfUI-aware template completion for `props()`, `setup()` returns, `emits()`, `use()` components, slot locals, and `ctx.form`.
- Full expression completion and diagnostics in `${...}`, quoted binding, and `{{...}}` styles, including typed `v-for` locals from `useRef()` lists.
- Contextual DOM event typing for `$event` in event bindings, including `MouseEvent`, `KeyboardEvent`, and `InputEvent` member completions.
- Quoted dynamic bindings such as `:key="item.id"`, `v-if="visible"`, and `@click="select(item)"` are highlighted as TypeScript expressions, while ordinary HTML values such as `class="row"` remain strings.
- A bundled TypeScript server plugin suppresses native TS missing-name false positives only for active `v-for` locals, slot-scope locals, and `$event` inside `defineHtml(\`...\`)` `${...}` expressions; ordinary TypeScript diagnostics remain intact.
- HTML/CSS syntax highlighting inside `defineHtml(\`...\`)`, `defineStyle(\`...\`)`, and builder template/style regions through embedded TextMate scopes.
- HTML/CSS document and range formatting inside `defineHtml(\`...\`)`, `defineStyle(\`...\`)`, and builder template/style regions.
- Document and range formatting providers for ElfUI template and style strings; save-time formatting remains under the editor or Prettier's control.
- CSS completion, hover, diagnostics, and color preview inside `.style(\`...\`)`, including Web Components selectors such as `:host-context()`, `::slotted()`, `::part()`, template-derived `part`/`slot` selector snippets, and declared CSS custom property references.
- Diagnostics for unknown template variables, unregistered local components, undeclared emit calls, non-writable `v-model` targets, and component prop/event/slot mismatches from same-file or workspace metadata.
- Go to Definition, References, and Document Highlight for same-file template symbols and workspace component tags, props, events, and slots.
- Rename for same-file template symbols, current-file workspace component usages, and matching external declarations when the template name is the real exported name.
- Workspace Symbols for indexed ElfUI components and their props, events, and slots.
- Dependency package component metadata from `package.json` declarations, so component libraries can provide completions, diagnostics, definitions, and auto imports without scanning `node_modules`.
- `ElfUI: Generate Component Metadata` creates package metadata from the cached local component index and only writes files whose generated content changed.
- Document Links for TS import/export paths, template asset links, and CSS `url(...)` references inside ElfUI embedded regions.
- Folding Range, Selection Range, and Linked Editing Range support inside embedded template and style strings.
- Optional Semantic Tokens for ElfUI component declarations, template component tags, props, events, slots, setup values, template locals, and directives.
- Quick Fixes for declaring unknown template variables, initializing untyped `v-for` list states, undeclared emits, and same-file component prop/event/slot mismatches.
- ElfUI Studio tools: an `ElfUI Components` explorer view, dynamic point/effect reports, a static component preview, a template binding migration command, and a persistent workspace performance report with language-server index and completion latency metrics.
- Snippets for macro components: `elfc` creates a minimal `defineHtml()` component skeleton, `elfinit` creates a ready-to-run component template, and `elflifecycle` creates lifecycle hooks with a typed template ref.

## Settings

- `elfui.languageFeatures.enabled`: enable or disable the language server.
- `elfui.languageFeatures.completion.templateBindingStyle`: template directive and prop snippet style, `expression` or `quoted`.
- `elfui.languageFeatures.completion.eventBindingStyle`: event snippet style, `expression` or `quoted`.
- `elfui.languageFeatures.semanticTokens.enabled`: enable ElfUI semantic tokens. The default is `false` so TypeScript keeps its built-in semantic highlighting.
- `elfui.languageFeatures.diagnostics.suppressNativeTemplateLocals`: suppress native TS missing-name false positives only for ElfUI template locals. The default is `true`.
- `elfui.languageFeatures.workspace.maxScanFiles`: maximum number of workspace TS/JS source files scanned for component metadata.
- `elfui.languageFeatures.workspace.indexDebounceMs`: debounce delay before rebuilding the workspace component index after file changes.
- `elfui.languageFeatures.workspace.perfLogging`: log workspace index timing and cache stats to the ElfUI language server output.
- `elfui.languageFeatures.componentTagColor`: component tag color for ElfUI template strings. Set to `null` to stop managing the color.

Use `ElfUI: Restart Language Server` after changing local language-server builds during development. `ElfUI: Diagnose Integration` reports the active extension version, language-server state, TypeScript plugin configuration, recognized template-region line ranges, diagnostic counts grouped by source, and whether a native template-local false positive is still present.

`ElfUI: Show Workspace Index Report` stores the latest 20 explicit report scans in VS Code workspace state. It also displays the current language-server startup time, recent index samples, and aggregate completion latency without adding per-request disk writes. `ElfUI: Export Workspace Performance Report` writes the collected history to `.elfui/performance-report.json`; `ElfUI: Clear Workspace Performance History` clears only the current workspace's saved samples.

## Component Package Metadata

ElfUI component libraries can expose language-tool metadata from their package manifest:

```json
{
  "name": "@acme/elfui-kit",
  "elfui": {
    "languageTools": {
      "components": "./dist/elfui.components.json"
    }
  }
}
```

The metadata JSON can list exported components:

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
        {
          "name": "footer",
          "scopeType": "{ action: { disabled: boolean; label: string } }"
        }
      ]
    }
  ]
}
```

`importPath` is optional and defaults to the package name. `props` and `emits` also accept the legacy string form such as `["label", "open"]` or `["confirm"]`; use the structured form to show prop type/default value and event payload type in template hover.

Run `ElfUI: Generate Component Metadata` in a component-library workspace to write `elfui.components.json` (or the existing declared metadata path). When `package.json` exists without an ElfUI metadata declaration, the command adds `elfui.languageTools.components` automatically. It uses the language server's cached workspace index and skips unchanged writes.

## Local Development

```bash
pnpm test
pnpm build
pnpm smoke
pnpm smoke:host
pnpm verify:m10
pnpm package:vsix
```

The smoke host suite starts a real VS Code Extension Host and covers activation, template completions, declaration quick fixes, document links, workspace symbols, style completions, closing tags, semantic tokens, embedded formatting, and ElfUI Studio commands.

`verify:m10` scans the real `ui-kit/src/components` tree as the M10 pressure gate. It verifies macro component coverage, `v-for`/`v-model`/`${...}` pressure, Web Components CSS token coverage, cached index performance, and test coverage for `useComponents()` aliases, `defineModel()`, `defineSlots<T>()`, and dependency package metadata.

`package:vsix` writes a local installable package to `.local-vsix/`.
Install it with:

```bash
code --install-extension .local-vsix/elfui-language-features-X.Y.Z.vsix --force
```

For `v-for` locals, prefer template expressions when possible:

```ts
defineHtml(`<li v-for="user in userList" :key="user.id">{{ user.name }} - {{ user.age }}</li>`);
```

Quoted bindings such as `:key="user.id"` and mustache interpolations such as `{{ user.name }}` are the most natural template-level syntax and both receive `user.` member completion. `${user.name}` remains supported for text interpolation; the extension filters TypeScript's host-language `Cannot find name 'user'` false positive when `user` comes from an active `v-for`.
