const fs = require("node:fs");
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
  const extensionTestsPath = path.resolve(__dirname, "suite", "index.cjs");
  const workspacePath = path.resolve(__dirname, "workspace");
  const vscodeExecutablePath = resolveLocalVSCodeExecutable();

  fs.mkdirSync(workspacePath, { recursive: true });

  await runTests({
    cachePath: path.resolve(extensionDevelopmentPath, ".vscode-test"),
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspacePath, "--disable-extensions"],
    timeout: 120000,
    version: "1.90.0",
    vscodeExecutablePath
  });
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
