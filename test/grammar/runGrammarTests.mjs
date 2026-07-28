// Token-level tests for the macro-only ElfUI TextMate grammar.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, "..", "..");
const elfuiGrammar = JSON.parse(
  readFileSync(resolve(repoRoot, "syntaxes", "elfui-macro.tmLanguage.json"), "utf8")
);
const tsGrammar = JSON.parse(readFileSync(resolve(root, "TypeScript.tmLanguage.json"), "utf8"));
const onigurumaPath = require.resolve("vscode-oniguruma/release/onig.wasm");
const onigWasm = readFileSync(onigurumaPath);
const oniguruma = require("vscode-oniguruma");
await oniguruma.loadWASM(onigWasm.buffer);
const textmate = require("vscode-textmate");

const tsScope = "source.ts";
const elfScope = elfuiGrammar.scopeName;
const htmlScope = "text.html.basic";
const cssScope = "source.css";
const htmlGrammar = {
  name: "Test HTML",
  scopeName: htmlScope,
  patterns: [{ include: "#tag" }],
  repository: {
    tag: {
      begin: "<",
      end: ">",
      contentName: "meta.tag.html",
      patterns: [
        { match: "[A-Za-z][\\w-]*(?=\\s|/?>)", name: "entity.name.tag.html" },
        { match: "[A-Za-z:@][\\w:.-]*(?=\\s*=)", name: "entity.other.attribute-name.html" },
        { begin: "([\\\"'])", end: "\\1", contentName: "string.quoted.html" }
      ]
    }
  }
};
const cssGrammar = {
  name: "Test CSS",
  scopeName: cssScope,
  patterns: [{ include: "#rule" }],
  repository: {
    rule: {
      begin: "[.#:]?[A-Za-z_-][\\w-]*\\s*\\{",
      end: "\\}",
      contentName: "meta.property-list.css",
      patterns: [{ match: "[A-Za-z-]+(?=\\s*:)", name: "support.type.property-name.css" }]
    }
  }
};

const registry = new textmate.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
    createOnigString: (value) => new oniguruma.OnigString(value)
  }),
  loadGrammar: async (scopeName) => {
    if (scopeName === tsScope) return tsGrammar;
    if (scopeName === elfScope) return elfuiGrammar;
    if (scopeName === htmlScope) return htmlGrammar;
    if (scopeName === cssScope) return cssGrammar;
    return null;
  },
  getInjections: (scopeName) =>
    scopeName === tsScope || scopeName === htmlScope || scopeName === cssScope
      ? [elfScope]
      : undefined
});

const grammar = await registry.loadGrammar(tsScope);
if (!grammar) {
  console.error("Failed to load TypeScript grammar");
  process.exit(1);
}

const tokenize = (source) => {
  const tokens = [];
  let ruleStack = textmate.INITIAL;

  source.split(/\r?\n/).forEach((line, lineNumber) => {
    const result = grammar.tokenizeLine(line, ruleStack);
    ruleStack = result.ruleStack;
    result.tokens.forEach((token) => {
      tokens.push({
        line: lineNumber,
        scopes: token.scopes,
        text: line.slice(token.startIndex, token.endIndex)
      });
    });
  });

  return tokens;
};

const findToken = (tokens, text) => tokens.find((token) => token.text.includes(text));
const expectScope = (token, scope, message) => {
  if (!token || !token.scopes.some((item) => item.includes(scope))) {
    throw new Error(`${message}: expected ${scope}, got ${token?.scopes?.join(", ") ?? "none"}`);
  }
};
const expectNoMacroScope = (tokens, message) => {
  if (tokens.some((token) => token.scopes.some((scope) => scope.includes("elfui")))) {
    throw new Error(`${message}: unexpected ElfUI grammar scope`);
  }
};

const cases = [
  [
    "highlights defineHtml HTML",
    () => {
      const tokens = tokenize('defineHtml(`<div class="card">Hello</div>`);');
      expectScope(findToken(tokens, "div"), "entity.name.tag.html", "defineHtml tag");
      expectScope(findToken(tokens, "class"), "entity.other.attribute-name.html", "defineHtml attr");
    }
  ],
  [
    "highlights multiline defineHtml",
    () => {
      const tokens = tokenize("defineHtml(`\n  <section>\n    <button>Save</button>\n  </section>\n`);");
      expectScope(findToken(tokens, "section"), "entity.name.tag.html", "multiline tag");
      expectScope(findToken(tokens, "button"), "entity.name.tag.html", "multiline button");
    }
  ],
  [
    "highlights defineStyle CSS",
    () => {
      const tokens = tokenize("defineStyle(`\n  :host {\n    color: red;\n  }\n`);");
      expectScope(findToken(tokens, "color"), "support.type.property-name.css", "defineStyle property");
    }
  ],
  [
    "highlights directive expressions and interpolation",
    () => {
      const tokens = tokenize("defineHtml(`<button v-if=\"visible\">${label}</button>`);");
      expectScope(findToken(tokens, "v-if"), "entity.other.attribute-name.directive.elfui", "quoted directive");
      expectScope(findToken(tokens, "visible"), "meta.embedded.expression.elfui", "directive value");
      expectScope(findToken(tokens, "${"), "punctuation.definition.template-expression.begin", "interpolation");
    }
  ],
  [
    "does not activate for legacy chain calls",
    () => {
      expectNoMacroScope(tokenize("Demo.template(`<button>Save</button>`);"), "legacy chain");
      expectNoMacroScope(tokenize("Demo.style(`:host { color: red; }`);"), "legacy chain style");
    }
  ]
];

let passed = 0;
const failures = [];
for (const [name, test] of cases) {
  try {
    test();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failures.push({ error, name });
    console.error(`  FAIL ${name}`);
    console.error(`    ${error.message}`);
  }
}

console.log(`\nElfUI macro grammar: ${passed}/${cases.length} passed`);
if (failures.length > 0) {
  process.exitCode = 1;
}
