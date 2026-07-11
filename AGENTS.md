# AGENTS.md

## 维护范围

- 本仓库是 ElfUI VS Code 插件的唯一维护位置。
- 负责语言服务器、TypeScript Server Plugin、TextMate grammar、snippets、Extension Host 测试和 VSIX 打包。
- 不要回写或同步修改 `E:\dev_projects\elfui\tools\vscode-extension`；该路径已迁移停止维护。

## 工作规范

- 与用户交流使用简洁中文；提交使用 Conventional Commits。
- 修改前先阅读相关源码、测试和 `docs/HANDOFF.md` / `docs/M10-PRODUCTIZATION.md`。
- 修改后至少运行对应测试；涉及扩展行为时运行 `pnpm smoke:host`，打包交付时运行 `pnpm package:vsix`。
- 修改后保持 `pnpm test`、`pnpm typecheck`、`pnpm smoke` 和 `pnpm verify:m10` 可通过。
- VSIX 输出位于 `.local-vsix/`，版本必须与根 `package.json` 及 TypeScript 插件 `package.json` 保持一致。
