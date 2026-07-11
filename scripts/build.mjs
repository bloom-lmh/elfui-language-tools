import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const distDir = path.join(packageRoot, "dist");
const bundledTypeScriptLibDir = path.join(distDir, "typescript-lib");
const typeScriptPluginPackageDir = path.join(
  packageRoot,
  "elfui-language-features-typescript-plugin"
);
const typeScriptPluginRuntimeDir = path.join(
  packageRoot,
  "node_modules",
  "elfui-language-features-typescript-plugin"
);
const watchMode = process.argv.includes("--watch");

const baseConfig = {
  bundle: true,
  format: "cjs",
  loader: {
    ".json": "json"
  },
  mainFields: ["module", "main"],
  platform: "node",
  sourcemap: true,
  target: "node20",
  tsconfig: path.join(repoRoot, "tsconfig.base.json")
};

const buildConfigs = [
  {
    ...baseConfig,
    entryPoints: [path.join(packageRoot, "src", "extension.ts")],
    external: ["vscode"],
    outfile: path.join(distDir, "extension.js")
  },
  {
    ...baseConfig,
    entryPoints: [path.join(packageRoot, "src", "language-service", "node.ts")],
    outfile: path.join(distDir, "lsp-server.js")
  },
  {
    ...baseConfig,
    entryPoints: [path.join(packageRoot, "src", "typescript-plugin", "index.ts")],
    outfile: path.join(distDir, "typescript-plugin.js")
  }
];

fs.rmSync(distDir, { force: true, recursive: true });
fs.mkdirSync(distDir, { recursive: true });
copyTypeScriptLibFiles();

if (watchMode) {
  const contexts = await Promise.all(buildConfigs.map((config) => context(config)));

  await Promise.all(contexts.map((item) => item.watch()));
  console.log("Watching ElfUI VS Code extension and language server...");
} else {
  await Promise.all(buildConfigs.map((config) => build(config)));
  syncTypeScriptServerPlugin();
}

function copyTypeScriptLibFiles() {
  const typeScriptLibDir = path.dirname(require.resolve("typescript"));
  const files = fs
    .readdirSync(typeScriptLibDir)
    .filter((fileName) => /^lib\..+\.d\.ts$/.test(fileName));

  fs.mkdirSync(bundledTypeScriptLibDir, { recursive: true });

  files.forEach((fileName) => {
    fs.copyFileSync(
      path.join(typeScriptLibDir, fileName),
      path.join(bundledTypeScriptLibDir, fileName)
    );
  });
}

function syncTypeScriptServerPlugin() {
  fs.rmSync(typeScriptPluginRuntimeDir, { force: true, recursive: true });
  fs.mkdirSync(typeScriptPluginRuntimeDir, { recursive: true });

  ["index.js", "package.json"].forEach((fileName) => {
    fs.copyFileSync(
      path.join(typeScriptPluginPackageDir, fileName),
      path.join(typeScriptPluginRuntimeDir, fileName)
    );
  });
}
