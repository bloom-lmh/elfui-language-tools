# ElfUI Language Features — 交接文档

最近一次更新：2026-05-16

本文档面向接手维护这个 VS Code 扩展的人。读完后你应该清楚：

1. 当前插件具备哪些功能，怎么验证
2. 仓库结构：扩展、语言服务器、模板语法、测试、打包
3. 已完成的工作清单
4. 已知限制和下一步路线
5. 常见排错路径

---

## 1. 当前能力（Status：稳定可用）

### 1.1 语法高亮（TextMate Grammar）

文件：`syntaxes/elfui-chain.tmLanguage.json`（由 `scripts/write-grammar.mjs` 生成）

注入到 `source.ts` 和 `source.js`，**排除 comment 和 string 范围**。已覆盖：

| 场景                                                   | 状态                                          |
| ------------------------------------------------------ | --------------------------------------------- |
| 同行 `.template(\`<body>\`)`                           | ✅ HTML 高亮                                  |
| 多行 `.template(\`\n <body>\n\`)`                      | ✅ HTML 高亮                                  |
| 多行 wrapped `.template(\n  \`<body>\`\n)`             | ✅ HTML 高亮（截图 1 场景）                   |
| 链式调用 `.name(...).template(\`...\`).style(\`...\`)` | ✅                                            |
| `.style(\`...\`)`/`.globalStyle(\`...\`)`              | ✅ CSS 高亮                                   |
| `.theme("tag", \`...\`)`                               | ✅ CSS 高亮（处理逗号分隔参数）               |
| 模板内 `${count + 1}`                                  | ✅ 切回 TS scope，按 TS 表达式渲染            |
| 注释里 `// .template(\`...\`)`                         | ✅ 不误识别                                   |
| `getTemplate()` / `myTemplate()` 同名函数              | ✅ 不误识别                                   |
| PascalCase 组件标签 `<UserCard>`                       | ✅ 独立 scope `support.class.component.elfui` |
| kebab-case Custom Element `<elf-button>`               | ✅ 同上                                       |

### 1.2 语言服务（LSP）

文件：`packages/language-server`（不在 `apps/vscode-extension` 下，是 monorepo 的独立包，但通过 `apps/vscode-extension/scripts/build.mjs` 一起打包到 extension dist）

LSP 提供：

- **补全（Completion）**
  - 标签名 `<` 后补全已注册组件
  - 属性 `:` 后补全 props（来自 `.props({...})`）
  - 事件 `@` 后补全 emit 名（来自 `.emits([...])`）+ 常见 DOM 事件
  - 事件修饰符 `@click.` 后补全 `.stop` `.prevent` `.capture` `.once` `.passive` `.self`
  - `v-model.` 后补全 `.trim` `.number` `.lazy`
  - `v-` 后补全 `v-if` `v-else-if` `v-else` `v-for` `v-show` `v-text` `v-html`
  - 模板表达式中补全 setup 返回值、props、`$event` `$emit` `$attrs` 等
  - slot 名 `<template #` 后补全
  - CSS 内补全：CSS 属性、`:host`、`::part()`、`var(--*)`
- **诊断（Diagnostic）**
  - 未知模板变量
  - 未注册的本地组件 `<MissingIcon>`
  - 未声明的 emit 调用
  - 未关闭的 HTML 标签
  - 同文件内子组件 prop mismatch
- **悬停（Hover）**：显示 props / emit 类型信息
- **跳转定义（Go to Definition）**：从模板里的 `count` 跳到 setup 里的声明
- **格式化（Formatting）**：保存时自动格式化模板和样式字符串
  - 整文档 / 选区 / 输入触发（`>` 自动闭合标签、`=` 自动加引号）
- **颜色预览（Color Provider）**：CSS 字符串里的 `#fff` `rgb(...)` 等显示色块

### 1.3 编辑器集成

- **状态栏**：右下角 `ElfUI ✓`（运行中）/ `↻ ElfUI`（启动中）/ `! ElfUI`（错误）/ `⊘ ElfUI`（禁用）；点击打开输出面板
- **命令**
  - `ElfUI: Restart Language Server`
  - `ElfUI: Show Output Channel`
- **配置项**（VS Code 设置）
  - `elfui.languageFeatures.enabled`：启用 / 禁用
  - `elfui.languageFeatures.formatOnSave`：保存时格式化嵌入区域
  - `elfui.languageFeatures.format.tabSize`：嵌入区域格式化 tab size
  - `elfui.languageFeatures.format.wrapLineLength`：行宽
  - `elfui.languageFeatures.componentTagColor`：组件标签颜色（默认 `#4FC1FF`）
- **触发激活**：打开任意 TS / JS 文件时自动激活；保存时自动格式化

---

## 2. 仓库结构

```
apps/vscode-extension/
├── package.json                       # 扩展 manifest
├── README.md                          # 用户文档
├── tsconfig.json
├── elfui-language-features-*.vsix     # 打包产物（gitignore）
├── docs/
│   └── HANDOFF.md                     # 本文档
├── examples/
│   └── chain-component.ts             # 手动测试用例
├── scripts/
│   ├── build.mjs                      # esbuild 打包 extension + lsp-server
│   ├── smoke.mjs                      # 离线 smoke：检查产物结构 + 启动 LSP server
│   ├── write-grammar.mjs              # 用 Node 生成 grammar JSON（解决格式化对原文件的破坏）
│   └── write-grammar-tests.mjs        # 同上，生成 grammar 测试
├── src/
│   ├── extension.ts                   # 入口：激活、状态栏、命令、format-on-save
│   └── lsp/
│       └── client.ts                  # 启动 LSP 客户端
├── syntaxes/
│   └── elfui-chain.tmLanguage.json    # TextMate grammar（自动生成）
└── test/
    ├── grammar/
    │   ├── TypeScript.tmLanguage.json # 第三方 host grammar，仅测试用（gitignore by .prettierignore / cspell）
    │   ├── runGrammarTests.mjs        # 自动生成的 grammar 测试
    │   └── debugGrammar.mjs           # 调试 token 输出
    └── smoke/
        ├── runTest.cjs                # @vscode/test-electron 入口
        ├── suite/
        │   ├── extension.test.cjs     # 11 个端到端测试
        │   └── index.cjs              # mocha 配置
        └── workspace/                 # 测试 fixture（运行时生成）
```

LSP 后端独立在仓库根目录：

```
packages/language-core/                # AST 静态分析（识别 createComponent 调用、props、emits、setup return 等）
packages/language-server/              # LSP 服务器（基于 vscode-languageserver + html / css language services）
```

打包时由 `apps/vscode-extension/scripts/build.mjs` 把 `packages/language-server/src/node.ts` 打成 `dist/lsp-server.js`，把 `apps/vscode-extension/src/extension.ts` 打成 `dist/extension.js`。

---

## 3. 测试矩阵

### 3.1 单元测试

| 套件                     | 范围                                                      | 命令                                        |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------- |
| `@elfui/language-core`   | AST 模型 / 区域识别 / 组件元信息提取                      | `pnpm --filter @elfui/language-core test`   |
| `@elfui/language-server` | LSP 各 provider（completion、hover、format、diagnostics） | `pnpm --filter @elfui/language-server test` |

### 3.2 Grammar Token 测试（自动化、无需 VS Code）

文件：`test/grammar/runGrammarTests.mjs`

工作原理：用 `vscode-textmate` + `vscode-oniguruma` 加载 host TS grammar 和我们的 elfui injection grammar，对一组真实代码片段做 tokenize，断言每个 token 的 scope 列表。

| 用例数 | 覆盖                                                                                                                               |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 15     | 同行、多行、wrapped 多行、链式、theme(target, css)、注释/字符串排除、lookalikes 排除、PascalCase/kebab 标签、interpolation 切回 TS |

命令：

```bash
pnpm --filter elfui-language-features test:grammar
```

或集成到 smoke：

```bash
pnpm --filter elfui-language-features smoke    # 离线 smoke + grammar tests
```

### 3.3 Extension Host smoke（端到端）

文件：`test/smoke/suite/extension.test.cjs`

启动真实 VS Code Extension Host（通过 `@vscode/test-electron`），打开 fixture 文件，调用 `vscode.executeCompletionItemProvider` / `vscode.executeFormatDocumentProvider` 等命令，断言返回结果。

| 测试                                                            | 描述                                              |
| --------------------------------------------------------------- | ------------------------------------------------- |
| activates the extension                                         | 扩展正常激活                                      |
| registers expected commands                                     | 注册了 restartLanguageServer 和 showOutputChannel |
| provides focused attribute completions                          | 模板内 `<button \|>` 补全属性                     |
| provides event-only completions for @ context                   | `@\|` 只补事件名                                  |
| provides event modifier-only completions after event dots       | `@click.\|` 只补修饰符                            |
| auto-completes quotes after event assignments                   | `@click=\|` 自动插 `""`                           |
| provides style completions                                      | `.style()` 内补 CSS                               |
| provides globalStyle completions                                | `.globalStyle()` 内补 CSS                         |
| auto-completes closing tags                                     | `<div>\|` 自动补 `</div>`                         |
| formats embedded template and style strings                     | 整文档格式化                                      |
| provides completions in template with backtick on the next line | wrapped 多行模板内仍能补全（截图 1 场景）         |

命令：

```bash
pnpm --filter elfui-language-features smoke:host
```

### 3.4 整合命令

```bash
pnpm language:verify
```

跑：language-core 测试 + language-server 测试 + 扩展 typecheck + 扩展构建 + smoke（离线 smoke + grammar tests）。**未包含 smoke:host**（需要下载 VS Code 环境，慢、有时候 mutex 问题），手动定期跑。

---

## 4. 已完成的工作

### 4.1 Grammar 重写（2026-05）

**问题**：

- 之前用 `\\b((?:[\\w$]+\\s*\\.\\s*)?template)\\s*\\(\\s*(\`)`太宽松：误命中`getTemplate()` 等
- 没有排除 comment / string，注释里的示例代码会被当模板高亮
- `theme("tag", \`...\`)` 因为参数中间逗号匹配不上
- 只覆盖同行模式，多行 wrapped 写法不识别
- 历史 0.1.7 VSIX 由于打包时 grammar 文件被破坏成 0 字节，所有用户都看不到高亮

**修复**：

1. `injectionSelector` 改成 `L:source.ts -comment -string`
2. begin 用 lookbehind `(?:(?<=\\.)|\\b)`，区分 `.template(` 和裸 `template(`
3. 拆出 `templateCall` / `templateCallMultiLine` / `styleCall` / `styleCallMultiLine` / `themeCall` / `themeCallMultiLine` 6 条规则
4. 用 Node 脚本 `write-grammar.mjs` 生成 grammar JSON，避免 prettier / IDE 格式化破坏
5. 加了 15 个 token 级测试覆盖所有变体

### 4.2 Extension 端

- 状态栏指示器（启动 / 运行 / 错误 / 禁用 4 态）
- `elfui.showOutputChannel` 命令
- 已有的 format-on-save、自动 closing tag、自动引号、token color 配置等保留

### 4.3 测试基础设施

- Grammar token 自动化测试（15 用例）
- 多行模板补全 E2E 测试（覆盖截图 1 场景）
- 命令注册验证测试
- 集成到 `pnpm language:smoke` 和 `pnpm language:verify`

---

## 5. 已知限制 / 路线图

### 5.1 短期（阶段 1 — 痛点修复）

| 项                          | 描述                                                                                                                                                 | 估算 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **嵌入式语言注册**          | 让 `template(\`...\`)`内部的 tab/indent 真正按 HTML 走（现在还是按 TS）。需要`vscode.languages.setLanguageConfiguration` + virtual document provider | 1 天 |
| **SemanticTokens provider** | 把组件标签、props、setup return、emit name 按真实角色着色（不再依赖正则）                                                                            | 1 天 |
| **Code Actions**            | 「将 `<MyButton>` 加入 `.use()`」/「将 unknownVar 加入 setup return」/「将事件名加入 `.emits()`」快速修复                                            | 1 天 |

### 5.2 中期（阶段 2 — 导航与重构）

| 项                             | 描述                                                                        | 估算   |
| ------------------------------ | --------------------------------------------------------------------------- | ------ |
| **Find All References**        | 从 setup 中的 `count` 找到模板里所有引用                                    | 0.5 天 |
| **Rename Symbol**              | 重命名 setup return 字段时同步改模板                                        | 1 天   |
| **Document Symbols / Outline** | 在大纲里展示组件的 props / emits / setup return / template / style 层级     | 0.5 天 |
| **Definition 增强**            | 模板里 `<Card>` 跳到 import；`@click="handleSave"` 跳到 setup 里 handleSave | 0.5 天 |

### 5.3 长期（阶段 3 — 类型驱动智能）

- 类型驱动的 props 补全（推导 `PropType<T>`）
- 事件 handler 类型 hint
- slot 智能补全（带 slot props 类型）
- Inlay hints（props 推断类型 / 模板表达式类型）
- 未使用 import / props / setup return 高亮
- Convert refactoring（提升 setup 字段为 props 等）

### 5.4 阶段 4 — 生态

- 主题图标、Marketplace 截图、changelog
- Document highlights（光标在 `count` 上时模板里所有 `count` 高亮）
- Format-on-paste
- Workspace symbol search（`Ctrl+T` 找组件）

详细排期见仓库根目录 README 或我之前给的「24 项改进计划」。

---

## 6. 常见排错

### 6.1 装了扩展但模板内不高亮

1. 检查 VS Code 右下状态栏是否显示 `ElfUI ✓`
   - 没有 → 扩展未激活，看 Output 面板（`ElfUI` 频道）
2. 命令面板运行 `Developer: Inspect Editor Tokens and Scopes`，把光标放到模板内 HTML 上
   - 应该看到 `meta.embedded.block.html` 和 `text.html.derivative` scope
   - 没有 → grammar 没有生效，可能装的是旧 VSIX（0.1.7 的 grammar 文件是 0 字节）
3. 重新装 0.1.8+ VSIX：`Ctrl+Shift+P` → `Extensions: Install from VSIX`

### 6.2 状态栏显示 `! ElfUI`

打开 Output 面板看错误信息。常见原因：

- `dist/lsp-server.js` 不存在（构建失败）
- Node 版本不匹配
- 端口冲突（少见）

### 6.3 补全不出现

1. 检查 `elfui.languageFeatures.enabled` 是否为 true
2. 命令面板运行 `ElfUI: Restart Language Server`
3. 看 Output 面板有没有 LSP error
4. 在最小 fixture 里复现：用 `apps/vscode-extension/examples/chain-component.ts`

### 6.4 grammar 改了但不生效

VS Code 缓存 grammar 文件。改 grammar 后需要：

1. 重新打包 VSIX（`pnpm --filter elfui-language-features package:vsix`）
2. 卸载旧扩展，装新 VSIX，重新加载窗口
3. 或者用 Extension Development Host（`F5`）

### 6.5 grammar 文件被意外清空

历史问题：直接 `fs_write` JSON grammar 文件曾经导致内容丢失（fileSystem 写入异常）。**始终用 `node scripts/write-grammar.mjs` 重新生成**。

---

## 7. 发布流程（手动）

1. 确认 `package.json` 的 `version` 已 bump
2. 跑 `pnpm language:verify`（必须全绿）
3. 跑 `pnpm --filter elfui-language-features smoke:host`（必须全绿）
4. 跑 `pnpm --filter elfui-language-features package:vsix`
5. 把 `apps/vscode-extension/elfui-language-features-X.Y.Z.vsix` 上传到 Marketplace（`vsce publish` 或手动 portal）

未来可考虑 changeset / GitHub Action 自动化。

---

## 8. 关键依赖版本

| 依赖                          | 版本                                | 用途                  |
| ----------------------------- | ----------------------------------- | --------------------- |
| `vscode-languageclient`       | ^9.0.1                              | LSP 客户端            |
| `vscode-languageserver`       | （内嵌于 packages/language-server） | LSP 服务端            |
| `vscode-html-languageservice` | （内嵌）                            | HTML 嵌入区域语言服务 |
| `vscode-css-languageservice`  | （内嵌）                            | CSS 嵌入区域语言服务  |
| `vscode-textmate` ^9          | 仅 grammar 测试用                   | 不进 runtime          |
| `vscode-oniguruma` ^2         | 仅 grammar 测试用                   | 不进 runtime          |
| `@vscode/vsce` ^3             | 打包 VSIX                           | dev only              |
| `@vscode/test-electron` ^2    | 跑 smoke:host                       | dev only              |
| `mocha` ^11                   | smoke 测试运行器                    | dev only              |
| `esbuild` ^0.28               | 构建 extension + lsp-server bundle  | dev only              |
| VS Code engine                | ^1.90                               | 最低支持版本          |

---

## 9. 联系信息 / 设计原则

ElfUI 的核心定位：「Vue 风格语法 + 标准 Web Components 交付」。这个扩展的目标是让 ElfUI 的链式 API 在 VS Code 里达到接近 Vue SFC 的编辑体验。

**设计取舍**：

- **嵌入式语言**：选择 textmate 注入 + LSP 双轨而不是 virtual document，是为了更轻量、跟 VS Code 内置的 HTML/CSS 服务无缝整合
- **不做 SFC**：用户已确认放弃 `.elf` 单文件组件，所有组件都用链式 API 编写
- **不做 JSX/TSX**：用户已确认删除 JSX/TSX 支持，只保留 template + render function（runtime API）
- **状态栏可见性**：因为之前用户报告"语法提示丢失"，加状态栏作为第一道反馈

如有疑问，先看本文档的「常见排错」，再翻 `packages/language-core/src/source.ts` 和 `packages/language-server/src/languageService.ts`，最后到 `apps/vscode-extension/src/extension.ts`。
