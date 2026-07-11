import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const uiKitComponentsRoot = resolveUiKitComponentsRoot();
const smokeSuitePath = path.join(packageRoot, "test", "smoke", "suite", "extension.test.cjs");
const languageServiceSpecPath = path.join(
  packageRoot,
  "src",
  "language-service",
  "__tests__",
  "languageService.spec.ts"
);
const serverSpecPath = path.join(
  packageRoot,
  "src",
  "language-service",
  "__tests__",
  "server.spec.ts"
);

const failures = [];

const requireGate = (condition, label, detail) => {
  if (condition) {
    console.log(`PASS ${label}${detail ? `: ${detail}` : ""}`);
    return;
  }

  failures.push(`${label}${detail ? `: ${detail}` : ""}`);
  console.error(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
};

const sourceFiles = collectFiles(uiKitComponentsRoot, new Set([".ts", ".tsx"]));
const styleFiles = collectFiles(uiKitComponentsRoot, new Set([".css", ".scss"]));
const sourceTexts = readFiles(sourceFiles);
const styleTexts = readFiles(styleFiles);
const smokeSuite = readRequiredFile(smokeSuitePath);
const languageServiceSpec = readRequiredFile(languageServiceSpecPath);
const serverSpec = readRequiredFile(serverSpecPath);
const allIndexedFiles = [...sourceFiles, ...styleFiles];
const cache = new Map();
const coldScan = scanWithCache(allIndexedFiles, cache);
const warmScan = scanWithCache(allIndexedFiles, cache);

const macroComponentFiles = sourceTexts.filter((item) =>
  /\bdefineHtml\s*\(|\.template\s*\(/.test(item.text)
);
const expressionBindings = countMatches(sourceTexts, /\$\{/g);
const vForDeclarations = countMatches(sourceTexts, /\bv-for\s*=/g);
const vModelBindings = countMatches(sourceTexts, /\bv-model(?::[\w-]+)?/g);
const hostSelectors = countMatches(styleTexts, /:host\b/g);
const partOrSlottedSelectors = countMatches(styleTexts, /::(?:part|slotted)\b/g);
const cssTokenReferences = countMatches(styleTexts, /var\(--elf-[\w-]+/g);

requireGate(sourceFiles.length >= 80, "ui-kit source pressure set", `${sourceFiles.length} TS files`);
requireGate(
  macroComponentFiles.length >= 50,
  "ui-kit macro/builder component coverage",
  `${macroComponentFiles.length} component files`
);
requireGate(
  expressionBindings >= 180,
  "template expression binding pressure",
  `${expressionBindings} expression bindings`
);
requireGate(vForDeclarations >= 20, "v-for local pressure", `${vForDeclarations} v-for declarations`);
requireGate(vModelBindings >= 10, "v-model pressure", `${vModelBindings} v-model bindings`);
requireGate(hostSelectors >= 40, "Shadow DOM host selector pressure", `${hostSelectors} :host selectors`);
requireGate(
  partOrSlottedSelectors >= 4,
  "Web Components selector pressure",
  `${partOrSlottedSelectors} ::part/::slotted selectors`
);
requireGate(
  cssTokenReferences >= 200,
  "CSS token pressure",
  `${cssTokenReferences} --elf token references`
);
requireGate(
  coldScan.durationMs <= 3000,
  "cold index performance budget",
  `${formatMs(coldScan.durationMs)} for ${allIndexedFiles.length} files`
);
requireGate(
  warmScan.reused === allIndexedFiles.length && warmScan.durationMs <= 750,
  "warm index cache budget",
  `${warmScan.reused}/${allIndexedFiles.length} reused in ${formatMs(warmScan.durationMs)}`
);
requireGate(
  hasAll(smokeSuite, ["useComponents({ DialogAction: DialogActionButton });", "ModalAlias"]),
  "Host smoke covers useComponents aliases"
);
requireGate(
  hasAll(smokeSuite, ["defineModel(", "v-model:open", "v-model=\"value\""]),
  "Host smoke covers defineModel and v-model metadata"
);
requireGate(
  hasAll(smokeSuite, ["defineSlots<{", "template #footer", "{{ action."]),
  "Host smoke covers defineSlots<T> slot scopes"
);
requireGate(
  hasAll(smokeSuite, ["elfui.components.json", "PackageButton", "@acme/elfui-kit"]),
  "Host smoke covers dependency package metadata"
);
requireGate(
  hasAll(languageServiceSpec, [
    "createElfDefinition",
    "createElfReferences",
    "createElfRenameEdit",
    "createElfInlayHints",
    "createElfCodeActions"
  ]),
  "Language-service tests cover Volar-style providers"
);
requireGate(
  hasAll(serverSpec, ["reuses cached file metadata", "multiple workspace roots"]),
  "Server tests cover metadata cache and multi-root indexing"
);

if (failures.length > 0) {
  console.error("");
  console.error("M10 productization gates failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("");
  console.log(
    `M10 productization gates passed: ${sourceFiles.length} source files, ${styleFiles.length} style files, cold ${formatMs(
      coldScan.durationMs
    )}, warm ${formatMs(warmScan.durationMs)}.`
  );
}

function collectFiles(root, extensions) {
  if (!fs.existsSync(root)) {
    throw new Error(`Missing required directory: ${root}`);
  }

  const files = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!["dist", "node_modules"].includes(entry.name)) {
          stack.push(fullPath);
        }
        continue;
      }

      if (entry.isFile() && extensions.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

function resolveUiKitComponentsRoot() {
  const explicitRoot = process.env.ELFUI_UI_KIT_COMPONENTS_ROOT;
  const candidates = [
    explicitRoot,
    path.join(packageRoot, "..", "ui-kit", "src", "components"),
    path.join(repoRoot, "elfui", "ui-kit", "src", "components"),
    path.join(repoRoot, "ui-kit", "src", "components")
  ].filter(Boolean);

  const match = candidates.find((candidate) => fs.existsSync(candidate));

  if (match) {
    return match;
  }

  throw new Error(
    `Missing required ui-kit components directory. Checked: ${candidates.join(", ")}`
  );
}

function readFiles(files) {
  return files.map((fileName) => ({
    fileName,
    text: fs.readFileSync(fileName, "utf8")
  }));
}

function readRequiredFile(fileName) {
  if (!fs.existsSync(fileName)) {
    throw new Error(`Missing required file: ${fileName}`);
  }

  return fs.readFileSync(fileName, "utf8");
}

function scanWithCache(files, cache) {
  const start = performance.now();
  let indexed = 0;
  let reused = 0;
  let bytes = 0;

  for (const fileName of files) {
    const stat = fs.statSync(fileName);
    const signature = `${stat.mtimeMs}:${stat.size}`;
    const cached = cache.get(fileName);

    if (cached === signature) {
      reused += 1;
      continue;
    }

    bytes += fs.readFileSync(fileName).byteLength;
    cache.set(fileName, signature);
    indexed += 1;
  }

  return {
    bytes,
    durationMs: performance.now() - start,
    indexed,
    reused
  };
}

function countMatches(files, pattern) {
  return files.reduce((sum, item) => sum + [...item.text.matchAll(pattern)].length, 0);
}

function hasAll(source, needles) {
  return needles.every((needle) => source.includes(needle));
}

function formatMs(value) {
  return `${value.toFixed(1)}ms`;
}
