import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { TextDocument } from "vscode-languageserver-textdocument";

const root = path.resolve(import.meta.dirname, "..");
const kitRoot = path.resolve(
  process.env.ELFUI_KIT_ROOT ?? path.join(root, "..", "elfui-kit")
);
const componentRoot = path.join(kitRoot, "src", "components");

if (!existsSync(componentRoot)) {
  throw new Error(`ElfUI Kit component root not found: ${componentRoot}`);
}

const bundlePath = path.join(
  tmpdir(),
  `elfui-language-service-diagnostics-${process.pid}.cjs`
);
const require = createRequire(import.meta.url);

try {
  await build({
    bundle: true,
    entryPoints: [path.join(root, "src", "language-service", "languageService.ts")],
    format: "cjs",
    loader: {
      ".json": "json"
    },
    mainFields: ["module", "main"],
    outfile: bundlePath,
    platform: "node",
    sourcemap: false,
    target: "node20"
  });

  const languageService = require(bundlePath);
  const fileFilter = process.env.ELFUI_DIAGNOSTICS_BENCH_FILTER
    ? new RegExp(process.env.ELFUI_DIAGNOSTICS_BENCH_FILTER, "i")
    : null;
  const files = collectMacroComponentFiles(componentRoot).filter(
    (fileName) =>
      !fileFilter ||
      fileFilter.test(path.relative(componentRoot, fileName).replace(/\\/g, "/"))
  );
  const rows = files.map((fileName) => {
    const source = readFileSync(fileName, "utf8");
    const document = TextDocument.create(
      pathToFileURL(fileName).toString(),
      "typescript",
      1,
      source
    );
    const preparationStarted = performance.now();

    languageService.prepareElfDocument(document);

    const preparationDurationMs = performance.now() - preparationStarted;
    const coldStarted = performance.now();
    const performanceResult = {};
    const diagnostics = languageService.createElfDiagnostics(
      document,
      undefined,
      performanceResult
    );
    const coldDurationMs = performance.now() - coldStarted;
    const warmStarted = performance.now();

    languageService.createElfDiagnostics(document);

    return {
      bytes: Buffer.byteLength(source),
      coldDurationMs,
      compilerDiagnosticCount: performanceResult.compilerDiagnosticCount,
      diagnostics: diagnostics.length,
      file: path.relative(componentRoot, fileName).replace(/\\/g, "/"),
      macroCompilationDurationMs: performanceResult.macroCompilationDurationMs,
      macroDurationMs: performanceResult.macroDurationMs,
      macroFilteringDurationMs: performanceResult.macroFilteringDurationMs,
      preparationDurationMs,
      styleDurationMs: performanceResult.styleDurationMs,
      suppressedCommentDiagnosticCount:
        performanceResult.suppressedCommentDiagnosticCount,
      suppressedKnownDiagnosticCount:
        performanceResult.suppressedKnownDiagnosticCount,
      suppressedRefDiagnosticCount:
        performanceResult.suppressedRefDiagnosticCount,
      suppressedVForDiagnosticCount:
        performanceResult.suppressedVForDiagnosticCount,
      templateDurationMs: performanceResult.templateDurationMs,
      warmDurationMs: performance.now() - warmStarted
    };
  });
  const report = {
    files: rows.length,
    generatedAt: new Date().toISOString(),
    results: rows,
    slowest: [...rows]
      .sort((left, right) => right.coldDurationMs - left.coldDurationMs)
      .slice(0, 12),
    totalColdDurationMs: sum(rows, "coldDurationMs"),
    totalMacroCompilationDurationMs: sum(rows, "macroCompilationDurationMs"),
    totalMacroFilteringDurationMs: sum(rows, "macroFilteringDurationMs"),
    totalPreparationDurationMs: sum(rows, "preparationDurationMs"),
    totalSuppressedCommentDiagnostics: sum(rows, "suppressedCommentDiagnosticCount"),
    totalSuppressedKnownDiagnostics: sum(rows, "suppressedKnownDiagnosticCount"),
    totalSuppressedRefDiagnostics: sum(rows, "suppressedRefDiagnosticCount"),
    totalSuppressedVForDiagnostics: sum(rows, "suppressedVForDiagnosticCount"),
    totalWarmDurationMs: sum(rows, "warmDurationMs")
  };
  const outputDirectory = path.join(root, "output");
  const outputPath = path.join(outputDirectory, "diagnostics-performance.json");

  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`ElfUI diagnostics benchmark: ${rows.length} macro files`);
  console.log(`  preparation total: ${report.totalPreparationDurationMs.toFixed(1)}ms`);
  console.log(`  cold total: ${report.totalColdDurationMs.toFixed(1)}ms`);
  console.log(`  repeat total: ${report.totalWarmDurationMs.toFixed(1)}ms`);
  console.log(
    `  macro compile/filter: ${report.totalMacroCompilationDurationMs.toFixed(1)}ms / ${report.totalMacroFilteringDurationMs.toFixed(1)}ms`
  );
  report.slowest.forEach((row) => {
    console.log(
      `  ${row.preparationDurationMs.toFixed(1)}ms prep / ${row.coldDurationMs.toFixed(1)}ms cold / ${row.warmDurationMs.toFixed(1)}ms repeat` +
      ` (${row.macroDurationMs.toFixed(1)}ms macro: ${row.macroCompilationDurationMs.toFixed(1)}ms compile + ${row.macroFilteringDurationMs.toFixed(1)}ms filter,` +
      ` ${row.templateDurationMs.toFixed(1)}ms HTML, ${row.styleDurationMs.toFixed(1)}ms CSS;` +
      ` ${row.compilerDiagnosticCount} compiler -> ${row.diagnostics} kept, suppressed comment/v-for/ref/known` +
      ` ${row.suppressedCommentDiagnosticCount}/${row.suppressedVForDiagnosticCount}/${row.suppressedRefDiagnosticCount}/${row.suppressedKnownDiagnosticCount})  ${row.file}`
    );
  });
  console.log(`Report: ${outputPath}`);
} finally {
  rmSync(bundlePath, { force: true });
}

function collectMacroComponentFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);

      return entry.isDirectory()
        ? collectMacroComponentFiles(entryPath)
        : entry.isFile() && /\.[cm]?tsx?$/.test(entry.name)
          ? [entryPath]
          : [];
    })
    .filter((fileName) => readFileSync(fileName, "utf8").includes("defineHtml"))
    .sort();
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + row[key], 0);
}
