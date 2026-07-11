import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const target = resolve(root, "syntaxes", "elfui-chain.tmLanguage.json");

// Reusable patterns for each call kind
const captures = {
  templateOpen: {
    1: { name: "support.function.elfui.template entity.name.function.elfui" },
    2: { name: "punctuation.section.parens.begin.elfui meta.brace.round.ts" },
  },
  styleOpen: {
    1: { name: "support.function.elfui.style entity.name.function.elfui" },
    2: { name: "punctuation.section.parens.begin.elfui meta.brace.round.ts" },
  },
  backtickAndCloseParen: {
    1: {
      name: "punctuation.definition.string.template.end.elfui string.template.ts",
    },
    2: { name: "punctuation.section.parens.end.elfui meta.brace.round.ts" },
  },
};

const htmlBodyPatterns = [
  { include: "#interpolation" },
  { include: "#elfuiComponentTag" },
  { include: "text.html.basic" },
];

const cssBodyPatterns = [
  { include: "#interpolation" },
  { include: "source.css" },
];

// Same-line variants: `.template(` `\`` `<body>` `\`` `)`
const templateCall = {
  begin: "(?:(?<=\\.)|\\b)(template)\\s*(\\()\\s*(`)",
  beginCaptures: {
    1: captures.templateOpen[1],
    2: captures.templateOpen[2],
    3: {
      name: "punctuation.definition.string.template.begin.elfui string.template.ts",
    },
  },
  end: "(`)\\s*(\\))?",
  endCaptures: captures.backtickAndCloseParen,
  contentName: "meta.embedded.block.html text.html.derivative",
  patterns: htmlBodyPatterns,
};

const styleCall = {
  begin: "(?:(?<=\\.)|\\b)(style|globalStyle)\\s*(\\()\\s*(`)",
  beginCaptures: {
    1: captures.styleOpen[1],
    2: captures.styleOpen[2],
    3: {
      name: "punctuation.definition.string.template.begin.elfui string.template.ts",
    },
  },
  end: "(`)\\s*(\\))?",
  endCaptures: captures.backtickAndCloseParen,
  contentName: "meta.embedded.block.css source.css",
  patterns: cssBodyPatterns,
};

const themeCall = {
  begin: "(?:(?<=\\.)|\\b)(theme)\\s*(\\()(?:[^`]*,\\s*)?(`)",
  beginCaptures: {
    1: captures.styleOpen[1],
    2: captures.styleOpen[2],
    3: {
      name: "punctuation.definition.string.template.begin.elfui string.template.ts",
    },
  },
  end: "(`)\\s*(\\))?",
  endCaptures: captures.backtickAndCloseParen,
  contentName: "meta.embedded.block.css source.css",
  patterns: cssBodyPatterns,
};

// Multi-line variants: `.template(` then NEWLINE; the backtick is on the next line.
// We open at `.template(` and end at the closing `)`. Inside we match a backtick
// pair as a nested rule whose body gets the embedded-language scope.
const makeMultiLine = (
  functionRegex,
  openCaptures,
  contentName,
  bodyPatterns,
) => ({
  begin: `(?:(?<=\\.)|\\b)(${functionRegex})\\s*(\\()(?=\\s*$)`,
  beginCaptures: openCaptures,
  end: "\\)",
  endCaptures: {
    0: { name: "punctuation.section.parens.end.elfui meta.brace.round.ts" },
  },
  patterns: [
    {
      begin: "`",
      beginCaptures: {
        0: {
          name: "punctuation.definition.string.template.begin.elfui string.template.ts",
        },
      },
      end: "`",
      endCaptures: {
        0: {
          name: "punctuation.definition.string.template.end.elfui string.template.ts",
        },
      },
      contentName,
      patterns: bodyPatterns,
    },
    // Skip leading commas / strings / args before the backtick (e.g. theme target).
    { include: "source.ts" },
  ],
});

const templateCallMultiLine = makeMultiLine(
  "template",
  captures.templateOpen,
  "meta.embedded.block.html text.html.derivative",
  htmlBodyPatterns,
);

const styleCallMultiLine = makeMultiLine(
  "style|globalStyle",
  captures.styleOpen,
  "meta.embedded.block.css source.css",
  cssBodyPatterns,
);

const themeCallMultiLine = makeMultiLine(
  "theme",
  captures.styleOpen,
  "meta.embedded.block.css source.css",
  cssBodyPatterns,
);

const grammar = {
  name: "ElfUI Chain Embedded Languages",
  scopeName: "elfui.chain.injection",
  injectionSelector:
    "L:source.ts -comment -string, L:source.js -comment -string",
  patterns: [
    { include: "#templateCall" },
    { include: "#templateCallMultiLine" },
    { include: "#styleCall" },
    { include: "#styleCallMultiLine" },
    { include: "#themeCall" },
    { include: "#themeCallMultiLine" },
  ],
  repository: {
    templateCall,
    templateCallMultiLine,
    styleCall,
    styleCallMultiLine,
    themeCall,
    themeCallMultiLine,
    elfuiComponentTag: {
      match: "(</?)([A-Z][A-Za-z0-9]*|[a-z][a-z0-9]*-[a-z0-9-]+)\\b",
      captures: {
        1: { name: "punctuation.definition.tag.html" },
        2: {
          name: "support.class.component.elfui entity.name.tag.component.elfui",
        },
      },
    },
    interpolation: {
      begin: "\\$\\{",
      end: "\\}",
      beginCaptures: {
        0: { name: "punctuation.definition.template-expression.begin.ts" },
      },
      endCaptures: {
        0: { name: "punctuation.definition.template-expression.end.ts" },
      },
      contentName: "meta.template.expression.ts",
      patterns: [{ include: "source.ts" }],
    },
  },
};

writeFileSync(target, JSON.stringify(grammar, null, 2) + "\n", "utf8");
console.log(`Wrote ${target}`);
