const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");
const { assertHostLogsClean } = require("./assertHostLogs.cjs");

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
  const cachePath = path.join(extensionRoot, ".vscode-test-packaged", "runtime");
  const startedAt = Date.now();

  if (!fs.existsSync(vsixPath)) {
    throw new Error(`Missing VSIX package: ${vsixPath}`);
  }

  fs.rmSync(unpackedRoot, { force: true, recursive: true });
  fs.mkdirSync(unpackedRoot, { recursive: true });
  extractVsix(vsixPath, unpackedRoot);

  await runTests({
    cachePath,
    extensionDevelopmentPath,
    extensionTestsPath: path.join(extensionRoot, "test", "smoke", "suite", "index.cjs"),
    launchArgs: [path.join(extensionRoot, "test", "smoke", "workspace"), "--disable-extensions"],
    timeout: 120000,
    version: "1.90.0",
    vscodeExecutablePath: resolveLocalVSCodeExecutable()
  });
  assertHostLogsClean(
    [cachePath, path.join(extensionRoot, ".vscode-test")],
    startedAt
  );
}

function extractVsix(vsixPath, destination) {
  const extraction = resolveVsixExtractionCommand(process.platform, vsixPath, destination);

  childProcess.execFileSync(extraction.command, extraction.args, {
    stdio: "inherit"
  });
}

function resolveVsixExtractionCommand(platform, vsixPath, destination) {
  return platform === "win32"
    ? { args: ["-xf", vsixPath, "-C", destination], command: "tar" }
    : { args: ["-q", "-o", vsixPath, "-d", destination], command: "unzip" };
}

function resolveLocalVSCodeExecutable() {
  if (process.env.VSCODE_SMOKE_USE_DOWNLOADED === "1") {
    return undefined;
  }

  const candidates = [
    process.env.VSCODE_SMOKE_EXECUTABLE,
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe"),
    path.join("C:", "Program Files", "Microsoft VS Code", "Code.exe")
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

exports.resolveVsixExtractionCommand = resolveVsixExtractionCommand;

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
