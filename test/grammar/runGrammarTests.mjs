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

if (/text\.html/.test(elfuiGrammar.injectionSelector ?? "")) {
  throw new Error("ElfUI grammar must not inject into its own embedded HTML scopes");
}

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
const findTokens = (tokens, text) => tokens.filter((token) => token.text.includes(text));
const expectScope = (token, scope, message) => {
  if (!token || !token.scopes.some((item) => item.includes(scope))) {
    throw new Error(`${message}: expected ${scope}, got ${token?.scopes?.join(", ") ?? "none"}`);
  }
};
const expectNoScope = (token, scope, message) => {
  if (token?.scopes.some((item) => item.includes(scope))) {
    throw new Error(`${message}: did not expect ${scope}, got ${token.scopes.join(", ")}`);
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
    "keeps escaped nested templates inside defineHtml attributes",
    () => {
      const tokens = tokenize(
        [
          "defineHtml(`",
          '  <button type="button" class="tag-remove" :data-key="entry.key"',
          '    :aria-label="\\`Remove \\${entry.label}\\`"',
          "    @click=${onRemoveClick}>×</button>",
          "`);"
        ].join("\n")
      );

      expectScope(
        findToken(tokens, ":aria-label"),
        "entity.other.attribute-name.directive.elfui",
        "attribute before escaped nested template"
      );
      expectScope(
        findToken(tokens, "@click"),
        "entity.other.attribute-name.directive.elfui",
        "attribute after escaped nested template"
      );
      expectScope(
        findToken(tokens, "onRemoveClick"),
        "meta.template.expression.ts",
        "expression after escaped nested template"
      );
      expectScope(
        findTokens(tokens, "button").at(-1),
        "entity.name.tag.html",
        "closing tag after escaped nested template"
      );
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
      const vForTokens = tokenize(
        'defineHtml(`<td v-for="(value, index) in summaryCells()" :key="index">{{ value }}</td>`);'
      );
      expectScope(findToken(tokens, "v-if"), "entity.other.attribute-name.directive.elfui", "quoted directive");
      expectScope(findToken(tokens, "visible"), "meta.embedded.expression.elfui", "directive value");
      expectScope(findToken(tokens, "${"), "punctuation.definition.template-expression.begin", "interpolation");
      expectScope(
        findToken(vForTokens, "v-for"),
        "entity.other.attribute-name.directive.elfui",
        "v-for directive"
      );
      expectScope(
        findToken(vForTokens, "value"),
        "meta.embedded.expression.elfui",
        "v-for value local"
      );
      expectScope(
        findToken(vForTokens, "index"),
        "meta.embedded.expression.elfui",
        "v-for index local"
      );
      expectScope(
        findToken(vForTokens, "summaryCells"),
        "meta.embedded.expression.elfui",
        "v-for source"
      );
    }
  ],
  [
    "keeps HTML comments out of template expression highlighting",
    () => {
      const tokens = tokenize(
        [
          "defineHtml(`",
          "<!--",
          "  <CommentedButton v-if=\"hidden\">${hidden} {{ hidden }}</CommentedButton>",
          "-->",
          "`);"
        ].join("\n")
      );
      const tag = findToken(tokens, "CommentedButton");
      const expressions = findTokens(tokens, "hidden");

      expectScope(tag, "comment.block.html", "commented tag");
      expectNoScope(tag, "entity.name.tag.component.elfui", "commented component");
      if (expressions.length === 0) {
        throw new Error("commented expressions: expected at least one matching token");
      }
      expressions.forEach((expression, index) => {
        expectScope(expression, "comment.block.html", `commented expression ${index + 1}`);
        expectNoScope(
          expression,
          "meta.embedded.expression.elfui",
          `commented expression ${index + 1}`
        );
        expectNoScope(
          expression,
          "meta.template.expression.ts",
          `commented template interpolation ${index + 1}`
        );
      });
    }
  ],
  [
    "keeps commented parentheses out of bracket coloring scopes",
    () => {
      const tokens = tokenize(
        [
          "defineHtml(`",
          '<!-- <span v-if=${!hasValue() && !(props.filterable && openState)}>',
          "  ${placeholderText()}",
          "</span> -->",
          "`);"
        ].join("\n")
      );
      const parentheses = tokens.filter(
        (token) =>
          (token.text === "(" || token.text === ")") &&
          token.scopes.some((scope) => scope.includes("comment.block.html"))
      );

      if (parentheses.length !== 6) {
        throw new Error(`commented parentheses: expected 6, got ${parentheses.length}`);
      }
      parentheses.forEach((parenthesis, index) => {
        expectScope(
          parenthesis,
          "comment.block.html",
          `commented parenthesis ${index + 1}`
        );
        expectNoScope(
          parenthesis,
          "meta.brace.round",
          `commented parenthesis ${index + 1}`
        );
        expectNoScope(
          parenthesis,
          "punctuation.section.parens",
          `commented parenthesis ${index + 1}`
        );
      });
    }
  ],
  [
    "keeps CSS comments out of interpolation highlighting",
    () => {
      const tokens = tokenize("defineStyle(`/* .hidden { color: ${commentedColor}; } */`);");
      const expression = findToken(tokens, "commentedColor");

      expectScope(expression, "comment.block.css", "commented CSS expression");
      expectNoScope(expression, "meta.template.expression.ts", "commented CSS expression");
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
