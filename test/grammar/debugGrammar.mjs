// Quick debug: dump tokens for a sample input.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, "..", "..");
const elfuiGrammar = JSON.parse(
  readFileSync(
    resolve(repoRoot, "syntaxes", "elfui-chain.tmLanguage.json"),
    "utf8",
  ),
);
const tsGrammar = JSON.parse(
  readFileSync(resolve(root, "TypeScript.tmLanguage.json"), "utf8"),
);

const onig = require("vscode-oniguruma");
await onig.loadWASM(
  readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).buffer,
);

const tm = require("vscode-textmate");

const registry = new tm.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (p) => new onig.OnigScanner(p),
    createOnigString: (s) => new onig.OnigString(s),
  }),
  loadGrammar: async (s) =>
    s === "source.ts"
      ? tsGrammar
      : s === elfuiGrammar.scopeName
        ? elfuiGrammar
        : null,
  getInjections: (s) =>
    s === "source.ts" ? [elfuiGrammar.scopeName] : undefined,
});

const grammar = await registry.loadGrammar("source.ts");

const sample =
  process.argv[2] ?? 'C.template(`<div class="card">{{ count }}</div>`);';

console.log("Source:", JSON.stringify(sample));
console.log();

let stack = tm.INITIAL;
const lines = sample.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const r = grammar.tokenizeLine(line, stack);
  stack = r.ruleStack;
  console.log(`Line ${i}: ${JSON.stringify(line)}`);
  for (const t of r.tokens) {
    const text = line.slice(t.startIndex, t.endIndex);
    console.log(
      `  [${t.startIndex}-${t.endIndex}] ${JSON.stringify(text).padEnd(15)} : ${t.scopes.join(" / ")}`,
    );
  }
}
