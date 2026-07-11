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
const skipVerify = process.argv.includes("--skip-verify");
const typeScriptPluginDir = path.join(
  packageRoot,
  "elfui-language-features-typescript-plugin"
);
const typeScriptPluginName = "elfui-language-features-typescript-plugin";

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(outFile, { force: true });

if (!skipVerify) {
  run("pnpm", ["build"]);
  run("pnpm", ["smoke"]);
}

run("pnpm", ["exec", "vsce", "package", "--no-dependencies", "--out", outFile]);
injectTypeScriptServerPlugin(outFile);

const stat = fs.statSync(outFile);

if (!stat.isFile() || stat.size <= 0) {
  throw new Error(`VSIX package was not created: ${outFile}`);
}

console.log(`ElfUI VS Code extension package created: ${outFile}`);
console.log(`Package size: ${formatBytes(stat.size)}`);

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

function injectTypeScriptServerPlugin(vsixPath) {
  const files = ["index.js", "package.json"].map((fileName) =>
    path.join(typeScriptPluginDir, fileName)
  );

  files.forEach((fileName) => {
    if (!fs.existsSync(fileName)) {
      throw new Error(`Missing TypeScript server plugin file: ${fileName}`);
    }
  });

  if (process.platform === "win32") {
    const archivePath = quotePowerShell(vsixPath);
    const pluginPath = quotePowerShell(typeScriptPluginDir);
    const script = [
      "Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop;",
      "Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop;",
      `$archive = [System.IO.Compression.ZipFile]::Open(${archivePath}, [System.IO.Compression.ZipArchiveMode]::Update);`,
      "try {",
      `  Get-ChildItem -LiteralPath ${pluginPath} -File | ForEach-Object {`,
      `    $entryName = 'extension/node_modules/${typeScriptPluginName}/' + $_.Name;`,
      "    $existing = $archive.GetEntry($entryName);",
      "    if ($null -ne $existing) { $existing.Delete(); }",
      "    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null;",
      "  };",
      `  @('index.js', 'package.json') | ForEach-Object { if ($null -eq $archive.GetEntry('extension/node_modules/${typeScriptPluginName}/' + $_)) { throw \"TypeScript plugin entry was not packaged: $_\"; } };`,
      "} finally {",
      "  $archive.Dispose();",
      "}"
    ].join("\n");

    run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], packageRoot, false);
    return;
  }

  const stagingDir = path.join(outDir, ".typescript-plugin-staging");
  const stagedPluginDir = path.join(
    stagingDir,
    "extension",
    "node_modules",
    typeScriptPluginName
  );

  fs.rmSync(stagingDir, { force: true, recursive: true });
  fs.mkdirSync(stagedPluginDir, { recursive: true });
  files.forEach((fileName) => fs.copyFileSync(fileName, path.join(stagedPluginDir, path.basename(fileName))));

  try {
    run("zip", ["-q", "-ur", vsixPath, "extension/node_modules"], stagingDir);
  } finally {
    fs.rmSync(stagingDir, { force: true, recursive: true });
  }
}

function quotePowerShell(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
