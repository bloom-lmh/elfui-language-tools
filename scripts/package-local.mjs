import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const packageJsonPath = path.join(packageRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const outDir = path.join(packageRoot, ".local-vsix");
const outFile = path.join(outDir, `${packageJson.name}-${packageJson.version}.vsix`);
const stageDir = path.join(outDir, ".package-stage");
const typeScriptPluginName = "elfui-language-features-typescript-plugin";
const maxVsixBytes = 4 * 1024 * 1024;
const skipVerify = process.argv.includes("--skip-verify");

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(outFile, { force: true });

if (!skipVerify) {
  run("pnpm", ["build"]);
  run("pnpm", ["smoke"]);
}

preparePackageStage();

try {
  run(
    process.execPath,
    [path.join(packageRoot, "node_modules", "@vscode", "vsce", "vsce"), "package", "--out", outFile],
    stageDir,
    false
  );
} finally {
  fs.rmSync(stageDir, { force: true, recursive: true });
}

const stat = fs.statSync(outFile);

if (!stat.isFile() || stat.size <= 0) {
  throw new Error(`VSIX package was not created: ${outFile}`);
}

if (stat.size > maxVsixBytes) {
  throw new Error(
    `VSIX package exceeds the ${formatBytes(maxVsixBytes)} budget: ${formatBytes(stat.size)}`
  );
}

console.log(`ElfUI VS Code extension package created: ${outFile}`);
console.log(`Package size: ${formatBytes(stat.size)}`);

function preparePackageStage() {
  const pluginSourceDir = path.join(packageRoot, "elfui-language-features-typescript-plugin");
  const pluginTargetDir = path.join(stageDir, "node_modules", typeScriptPluginName);
  const stageManifest = {
    ...packageJson,
    dependencies: {
      [typeScriptPluginName]: packageJson.version
    },
    scripts: Object.fromEntries(
      Object.entries(packageJson.scripts ?? {}).filter(([name]) => name !== "vscode:prepublish")
    )
  };

  fs.rmSync(stageDir, { force: true, recursive: true });
  fs.mkdirSync(stageDir, { recursive: true });

  ["dist", "images", "snippets", "syntaxes"].forEach((name) => {
    fs.cpSync(path.join(packageRoot, name), path.join(stageDir, name), { recursive: true });
  });
  removeSourceMaps(path.join(stageDir, "dist"));
  ["LICENSE.txt", "README.md"].forEach((name) => {
    fs.copyFileSync(path.join(packageRoot, name), path.join(stageDir, name));
  });
  fs.cpSync(pluginSourceDir, pluginTargetDir, { recursive: true });
  removeSourceMaps(path.join(pluginTargetDir, "dist"));
  fs.writeFileSync(path.join(stageDir, "package.json"), `${JSON.stringify(stageManifest, null, 2)}\n`);
  assertNoSourceMaps(stageDir);
}

function removeSourceMaps(directory) {
  if (!fs.existsSync(directory)) return;

  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      removeSourceMaps(entryPath);
    } else if (entry.isFile() && entry.name.endsWith(".map")) {
      fs.rmSync(entryPath);
    }
  });
}

function assertNoSourceMaps(directory) {
  const pending = [directory];

  while (pending.length > 0) {
    const current = pending.pop();

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".map")) {
        throw new Error(`Source map leaked into VSIX staging: ${entryPath}`);
      }
    }
  }
}

function run(command, args, cwd = packageRoot, shell = process.platform === "win32") {
  const result = spawnSync(command, args, {
    cwd,
    shell,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function formatBytes(bytes) {
  const mib = bytes / 1024 / 1024;

  return `${mib.toFixed(2)} MiB`;
}
