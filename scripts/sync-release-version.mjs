import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionManifestPath = path.join(packageRoot, "package.json");
const pluginManifestPath = path.join(
  packageRoot,
  "elfui-language-features-typescript-plugin",
  "package.json"
);
const extensionManifest = readManifest(extensionManifestPath);
const pluginManifest = readManifest(pluginManifestPath);

if (pluginManifest.version !== extensionManifest.version) {
  pluginManifest.version = extensionManifest.version;
  fs.writeFileSync(pluginManifestPath, `${JSON.stringify(pluginManifest, null, 2)}\n`);
}

console.log(`Synchronized extension manifests at ${extensionManifest.version}.`);

function readManifest(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
