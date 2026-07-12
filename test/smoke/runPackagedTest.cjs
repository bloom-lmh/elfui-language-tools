const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const extensionRoot = path.resolve(__dirname, "..", "..");
  const manifest = require(path.join(extensionRoot, "package.json"));
  const vsixPath = path.join(
    extensionRoot,
    ".local-vsix",
    `${manifest.name}-${manifest.version}.vsix`
  );
  const unpackedRoot = path.join(extensionRoot, ".vscode-test-packaged", "extension");
  const extensionDevelopmentPath = path.join(unpackedRoot, "extension");

  if (!fs.existsSync(vsixPath)) {
    throw new Error(`Missing VSIX package: ${vsixPath}`);
  }

  fs.rmSync(unpackedRoot, { force: true, recursive: true });
  fs.mkdirSync(unpackedRoot, { recursive: true });
  childProcess.execFileSync("tar", ["-xf", vsixPath, "-C", unpackedRoot], { stdio: "inherit" });

  await runTests({
    cachePath: path.join(extensionRoot, ".vscode-test-packaged", "runtime"),
    extensionDevelopmentPath,
    extensionTestsPath: path.join(extensionRoot, "test", "smoke", "suite", "index.cjs"),
    launchArgs: [path.join(extensionRoot, "test", "smoke", "workspace"), "--disable-extensions"],
    timeout: 120000,
    version: "1.90.0",
    vscodeExecutablePath: resolveLocalVSCodeExecutable()
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
