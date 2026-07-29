const fs = require("node:fs");
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");
const { assertHostLogsClean } = require("./assertHostLogs.cjs");

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
  const extensionTestsPath = path.resolve(__dirname, "suite", "index.cjs");
  const workspacePath = path.resolve(__dirname, "workspace");
  const vscodeExecutablePath = resolveLocalVSCodeExecutable();
  const cachePath = path.resolve(extensionDevelopmentPath, ".vscode-test");
  const startedAt = Date.now();

  fs.mkdirSync(workspacePath, { recursive: true });

  await runTests({
    cachePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspacePath, "--disable-extensions"],
    timeout: 120000,
    version: "1.90.0",
    vscodeExecutablePath
  });
  assertHostLogsClean(cachePath, startedAt);
}

function resolveLocalVSCodeExecutable() {
  const candidates = [
    process.env.VSCODE_SMOKE_EXECUTABLE,
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe"),
    path.join("C:", "Program Files", "Microsoft VS Code", "Code.exe")
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
