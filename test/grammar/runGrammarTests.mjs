// Token-level tests for the ElfUI TextMate grammar.
//
// A tiny HTML grammar lets us verify the ElfUI injection inside attributes.
// VS Code uses its full HTML grammar; this fixture only models tags/attributes.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, "..", "..");
const elfuiGrammarPath = resolve(repoRoot, "syntaxes", "elfui-chain.tmLanguage.json");
const tsGrammarPath = resolve(root, "TypeScript.tmLanguage.json");

const elfuiGrammar = JSON.parse(readFileSync(elfuiGrammarPath, "utf8"));
const tsGrammar = JSON.parse(readFileSync(tsGrammarPath, "utf8"));

const onigurumaPath = require.resolve("vscode-oniguruma/release/onig.wasm");
const onigWasm = readFileSync(onigurumaPath);

const oniguruma = require("vscode-oniguruma");
await oniguruma.loadWASM(onigWasm.buffer);

const textmate = require("vscode-textmate");

const tsScope = "source.ts";
const elfScope = elfuiGrammar.scopeName;
const htmlScope = "text.html.basic";
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
        {
          match: "[A-Za-z][\\w-]*(?=\\s|/?>)",
          name: "entity.name.tag.html"
        },
        {
          match: "[A-Za-z:@][\\w:.-]*(?=\\s*=)",
          name: "entity.other.attribute-name.html"
        },
        {
          begin: "([\\\"'])",
          end: "\\1",
          contentName: "string.quoted.html"
        }
      ]
    }
  }
};

const registry = new textmate.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
    createOnigString: (s) => new oniguruma.OnigString(s)
  }),
  loadGrammar: async (scopeName) => {
    if (scopeName === tsScope) return tsGrammar;
    if (scopeName === elfScope) return elfuiGrammar;
    if (scopeName === htmlScope) return htmlGrammar;
    return null;
  },
  getInjections: (scopeName) =>
    scopeName === tsScope || scopeName === htmlScope ? [elfScope] : undefined
});

const grammar = await registry.loadGrammar(tsScope);
if (!grammar) {
  console.error("Failed to load TypeScript grammar");
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];

function tokenize(source) {
  const lines = source.split(/\r?\n/);
  let ruleStack = textmate.INITIAL;
  const all = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const result = grammar.tokenizeLine(line, ruleStack);
    ruleStack = result.ruleStack;
    for (const token of result.tokens) {
      all.push({
        line: i,
        startIndex: token.startIndex,
        endIndex: token.endIndex,
        text: line.slice(token.startIndex, token.endIndex),
        scopes: token.scopes
      });
    }
  }
  return all;
}

function findContaining(tokens, substring, line) {
  return tokens.find((t) => (line === undefined || t.line === line) && t.text.includes(substring));
}

function assertion(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  PASS " + name);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    console.error("  FAIL " + name);
    console.error("    " + error.message);
  }
}

function expectScope(token, scope, message) {
  if (!token) {
    throw new Error("expected to find a token but got none. " + (message ?? ""));
  }
  if (!token.scopes.some((s) => s.includes(scope))) {
    throw new Error(
      'expected token "' +
        token.text +
        '" to include scope "' +
        scope +
        '", got [' +
        token.scopes.join(", ") +
        "]. " +
        (message ?? "")
    );
  }
}

function expectNoScope(token, scope, message) {
  if (!token) return;
  if (token.scopes.some((s) => s.includes(scope))) {
    throw new Error(
      'expected token "' +
        token.text +
        '" to NOT include scope "' +
        scope +
        '", got [' +
        token.scopes.join(", ") +
        "]. " +
        (message ?? "")
    );
  }
}

console.log("ElfUI grammar token tests:");

{
  console.log("\n  case: same-line .template(\`<div>...\`)");
  const source = [
    'import { ElfUI } from "elfui";',
    "const C = ElfUI.createComponent();",
    'C.template(\`<div class="card">{{ count }}</div>\`);'
  ].join("\n");
  const tokens = tokenize(source);

  const htmlBody = tokens.find((token) => token.line === 2 && token.text === "<");
  assertion("opens HTML region on <div> body", () => {
    expectScope(htmlBody, "meta.embedded.block.html");
  });
  assertion("recognizes 'template' as ElfUI function", () => {
    const t = tokens.find((t) => t.text === "template" && t.line === 2);
    expectScope(t, "support.function.elfui.template");
  });
}

{
  console.log("\n  case: multi-line template");
  const source = [
    "C.template(\`",
    '  <article class="card">',
    "    <slot></slot>",
    "  </article>",
    "\`);"
  ].join("\n");
  const tokens = tokenize(source);
  const articleLine = tokens.find((token) => token.line === 1 && token.text === "<");
  const slotLine = tokens.find((token) => token.line === 2 && token.text === "<");
  assertion("opens HTML region on multi-line body line 1", () => {
    expectScope(articleLine, "meta.embedded.block.html");
  });
  assertion("keeps HTML region on multi-line body line 2", () => {
    expectScope(slotLine, "meta.embedded.block.html");
  });
}

{
  console.log("\n  case: multi-line .template( with backtick on the NEXT line");
  // This is the exact pattern in the user's screenshot:
  //   .template(
  //     \`<section>...</section>\`
  //   );
  const source = [
    "C.template(",
    '  \`<section class="playground">',
    "    <slot></slot>",
    "  </section>\`",
    ");"
  ].join("\n");
  const tokens = tokenize(source);
  const sectionLine = tokens.find((token) => token.line === 1 && token.text === "<");
  const slotLine = tokens.find((token) => token.line === 2 && token.text === "<");
  assertion("multi-line template with backtick on next line: line 1 in HTML", () => {
    expectScope(sectionLine, "meta.embedded.block.html");
  });
  assertion("multi-line template with backtick on next line: line 2 in HTML", () => {
    expectScope(slotLine, "meta.embedded.block.html");
  });
}

{
  console.log("\n  case: chained calls");
  const source = [
    "ElfUI.createComponent()",
    '  .name("Card")',
    "  .template(\`<button>{{ label }}</button>\`)",
    "  .style(\`button { color: red; }\`);"
  ].join("\n");
  const tokens = tokenize(source);
  const buttonHtml = tokens.find((token) => token.line === 2 && token.text === "<");
  const cssBody = findContaining(tokens, "color: red", 3);
  assertion("opens HTML region after chained .template(", () => {
    expectScope(buttonHtml, "meta.embedded.block.html");
  });
  assertion("opens CSS region after chained .style(", () => {
    expectScope(cssBody, "meta.embedded.block.css");
  });
}

{
  console.log("\n  case: NOT triggering on lookalikes");
  const source = [
    "function getTemplate() {}",
    'const x = "this template stuff";',
    "const myTemplate = \`<div>not html</div>\`;"
  ].join("\n");
  const tokens = tokenize(source);
  const myTemplateBody = findContaining(tokens, "<div", 2);
  assertion("plain backtick literal <div> is NOT HTML", () => {
    expectNoScope(myTemplateBody, "meta.embedded.block.html");
  });
}

{
  console.log("\n  case: NOT triggering inside comment");
  const source = ["// .template(\`<div></div>\`)", "/* .template(\`<div></div>\`) */"].join("\n");
  const tokens = tokenize(source);
  const line0Div = findContaining(tokens, "<div", 0);
  const line1Div = findContaining(tokens, "<div", 1);
  assertion("<div> inside line comment is not HTML", () => {
    expectNoScope(line0Div, "meta.embedded.block.html");
  });
  assertion("<div> inside block comment is not HTML", () => {
    expectNoScope(line1Div, "meta.embedded.block.html");
  });
}

{
  console.log("\n  case: globalStyle / theme");
  const source = [
    "ElfUI.globalStyle(\`body { margin: 0; }\`);",
    'ElfUI.theme("elf-card", \`.title { color: red; }\`);'
  ].join("\n");
  const tokens = tokenize(source);
  const marginBody = findContaining(tokens, "margin", 0);
  const themeBody = findContaining(tokens, "color: red", 1);
  assertion("globalStyle opens CSS region", () => {
    expectScope(marginBody, "meta.embedded.block.css");
  });
  assertion("theme(target, css) opens CSS region for css arg", () => {
    expectScope(themeBody, "meta.embedded.block.css");
  });
}

{
  console.log("\n  case: \${interpolation} tokenizes without crashing");
  let crashed = false;
  try {
    tokenize("C.template(\`<div>\${count + 1}</div>\`);");
  } catch (error) {
    crashed = true;
    console.error(error);
  }
  assertion("\${count} interpolation tokenizes successfully", () => {
    if (crashed) throw new Error("tokenization crashed");
  });
}

{
  console.log("\n  case: macro html and quoted directive expressions");
  const source = [
    'import { defineHtml, html } from "elfui";',
    "const select = (user) => user;",
    'const View = defineHtml(html`<li v-if="user.active" :key="user.id" @click="select(user, $event)" class="row">{{ user.name }}</li>`);'
  ].join("\n");
  const tokens = tokenize(source);
  const htmlBody = tokens.find((token) => token.line === 2 && token.text === "<");
  const macro = tokens.find((token) => token.line === 2 && token.text === "html");
  const expression = tokens.find(
    (token) => token.line === 2 && token.text === "user" && token.startIndex === 39
  );
  const staticValue = tokens.find((token) => token.line === 2 && token.text === "row");

  assertion("opens HTML region for html`...`", () => {
    expectScope(htmlBody, "meta.embedded.block.html");
  });
  assertion("recognizes 'html' as an ElfUI template macro", () => {
    expectScope(macro, "support.function.elfui.template");
  });
  assertion("embeds quoted directive values as TypeScript expressions", () => {
    expectScope(expression, "meta.embedded.expression.elfui");
    expectScope(expression, "source.ts");
  });
  assertion("keeps static HTML attributes out of the expression scope", () => {
    expectNoScope(staticValue, "meta.embedded.expression.elfui");
  });
}

{
  console.log("\n  case: ElfUI component tag scopes");
  const source =
    'const View = defineHtml(html`<CustomButton></CustomButton><elf-button></elf-button><button></button>`);';
  const tokens = tokenize(source);
  const customComponent = tokens.find((token) => token.text === "CustomButton");
  const kebabComponent = tokens.find((token) => token.text === "elf-button");
  const nativeButton = tokens.find((token) => token.text === "button");

  assertion("marks PascalCase component tags with the ElfUI color scope", () => {
    expectScope(customComponent, "support.class.component.elfui");
  });
  assertion("marks custom-element component tags with the ElfUI color scope", () => {
    expectScope(kebabComponent, "support.class.component.elfui");
  });
  assertion("does not mark native HTML tags as ElfUI components", () => {
    expectNoScope(nativeButton, "support.class.component.elfui");
  });
}

{
  console.log("\n  case: chain template quoted directive expressions");
  const source = 'Card.template(`<button :disabled="isDisabled" title="Save">Save</button>`);';
  const tokens = tokenize(source);
  const expression = tokens.find((token) => token.text === "isDisabled");
  const staticValue = tokens.find((token) => token.text === "Save");

  assertion("embeds chain quoted bindings as TypeScript expressions", () => {
    expectScope(expression, "meta.embedded.expression.elfui");
    expectScope(expression, "source.ts");
  });
  assertion("keeps chain static attributes out of the expression scope", () => {
    expectNoScope(staticValue, "meta.embedded.expression.elfui");
  });
}

{
  console.log("\n  case: not triggered by 'template' inside identifier");
  const source = [
    "const myTemplateName = 'foo';",
    "function getTemplate(){return null;}",
    "obj.notATemplate(value);"
  ].join("\n");
  const tokens = tokenize(source);
  const stray = tokens.find((t) =>
    t.scopes.some((s) => s.includes("support.function.elfui.template"))
  );
  assertion("none of the lookalikes get tagged as ElfUI template", () => {
    if (stray) {
      throw new Error(
        'unexpected ElfUI template tag on token "' + stray.text + '" (line ' + stray.line + ")"
      );
    }
  });
}

console.log("\n  " + passed + " passed, " + failed + " failed");

if (failed > 0) {
  console.error("\nFailures:");
  for (const f of failures) {
    console.error("  " + f.name + ": " + f.error.message);
  }
  process.exit(1);
}
