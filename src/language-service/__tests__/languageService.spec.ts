import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
  createElfCompletionList,
  createElfCodeActions,
  createElfColorPresentations,
  createElfDefinition,
  createElfDiagnostics,
  createElfDocumentSymbols,
  createElfDocumentColors,
  createElfDocumentHighlights,
  createElfDocumentLinks,
  createElfFoldingRanges,
  createElfFormattingEdits,
  createElfHover,
  createElfInlayHints,
  createElfLinkedEditingRanges,
  createElfOnTypeFormattingEdits,
  createElfPrepareRename,
  createElfRangeFormattingEdits,
  createElfReferences,
  createElfRenameEdit,
  createElfSelectionRanges,
  createElfSemanticTokens,
  createElfTagComplete,
  elfSemanticTokensLegend
} from "../languageService";
import { elfuiDemoFixture } from "../../language-core/__fixtures__/elfuiDemo";

const createDocument = (source: string) =>
  TextDocument.create("file:///Demo.ts", "typescript", 0, source);

const positionAfter = (document: TextDocument, source: string, marker: string) =>
  document.positionAt(source.indexOf(marker) + marker.length);

const readRange = (
  document: TextDocument,
  range: {
    end: { character: number; line: number };
    start: { character: number; line: number };
  }
) => document.getText().slice(document.offsetAt(range.start), document.offsetAt(range.end));

const readCompletionNewText = (item: { insertText?: string; textEdit?: { newText: string } }) =>
  item.textEdit?.newText ?? item.insertText ?? "";

const readDiagnosticMessages = (diagnostics: ReturnType<typeof createElfDiagnostics>): string[] =>
  diagnostics.map((item) => (typeof item.message === "string" ? item.message : item.message.value));

const readUiKitComponent = (...segments: string[]) => {
  const candidates = [
    path.resolve(process.cwd(), "..", "elfui-kit", "src", "components", ...segments),
    path.resolve(process.cwd(), "..", "..", "ui-kit", "src", "components", ...segments)
  ];
  const filePath = candidates.find((candidate) => existsSync(candidate));

  return filePath ? readFileSync(filePath, "utf8") : null;
};

const readHoverText = (hover: Awaited<ReturnType<typeof createElfHover>>): string => {
  const contents = hover?.contents;

  if (!contents) {
    return "";
  }

  if (typeof contents === "string") {
    return contents;
  }

  if (Array.isArray(contents)) {
    return contents.map((item) => (typeof item === "string" ? item : item.value)).join("\n");
  }

  return contents.value;
};

const readSelectionRangeTexts = (
  document: TextDocument,
  selectionRange: {
    parent?: {
      parent?: unknown;
      range: {
        end: { character: number; line: number };
        start: { character: number; line: number };
      };
    };
    range: {
      end: { character: number; line: number };
      start: { character: number; line: number };
    };
  }
): string[] => {
  const texts: string[] = [];
  let current: typeof selectionRange | undefined = selectionRange;

  while (current) {
    texts.push(readRange(document, current.range));
    current = current.parent as typeof selectionRange | undefined;
  }

  return texts;
};

const readSemanticTokenEntries = (
  document: TextDocument,
  tokens: ReturnType<typeof createElfSemanticTokens>
) => {
  const entries: Array<{ modifiers: string[]; text: string; type: string }> = [];
  let line = 0;
  let character = 0;

  for (let index = 0; index < tokens.data.length; index += 5) {
    const deltaLine = tokens.data[index] ?? 0;
    const deltaStart = tokens.data[index + 1] ?? 0;
    const length = tokens.data[index + 2] ?? 0;
    const typeIndex = tokens.data[index + 3] ?? 0;
    const modifierMask = tokens.data[index + 4] ?? 0;

    line += deltaLine;
    character = deltaLine === 0 ? character + deltaStart : deltaStart;

    const start = document.offsetAt({ character, line });
    entries.push({
      modifiers: elfSemanticTokensLegend.tokenModifiers.filter(
        (_modifier, modifierIndex) => (modifierMask & (1 << modifierIndex)) !== 0
      ),
      text: document.getText().slice(start, start + length),
      type: elfSemanticTokensLegend.tokenTypes[typeIndex] ?? ""
    });
  }

  return entries;
};

const applyTextEdits = (
  source: string,
  edits: Array<{
    newText: string;
    range: {
      end: { character: number; line: number };
      start: { character: number; line: number };
    };
  }>
) => {
  const document = createDocument(source);

  return [...edits]
    .sort(
      (left, right) => document.offsetAt(right.range.start) - document.offsetAt(left.range.start)
    )
    .reduce(
      (current, edit) =>
        `${current.slice(0, document.offsetAt(edit.range.start))}${edit.newText}${current.slice(
          document.offsetAt(edit.range.end)
        )}`,
      source
    );
};

describe("ElfUI language service", () => {
  it("does not provide language features for legacy chain builder regions", () => {
    const source = `
      const Demo = ElfUI.createComponent();
      Demo.template(\`<di\`);
      Demo.style(\`:host { col }\`);
    `;
    const document = createDocument(source);
    const completions = createElfCompletionList(
      document,
      positionAfter(document, source, "<di")
    );
    const formatting = createElfFormattingEdits(document, {
      insertSpaces: true,
      tabSize: 2
    });

    expect(completions.items).toEqual([]);
    expect(formatting).toEqual([]);
    expect(createElfDiagnostics(document)).toEqual([]);
  });

  it("keeps warm macro completion and formatting in the millisecond budget", () => {
    const source = `
      import { defineHtml, defineStyle } from "@elfui/core";

      const save = () => {};
      export const Demo = defineHtml(\`<section v-if="condition"><button @click=\\\${save}></button></section>\`);
      defineStyle(\`:host{color:red;display:block;}\`);
    `;
    const document = TextDocument.create("file:///macro-performance.ts", "typescript", 1, source);
    const position = positionAfter(document, source, "@click");
    const declarationPosition = positionAfter(document, source, "condition");
    const declarationRange = { end: declarationPosition, start: declarationPosition };

    createElfCompletionList(document, position);
    createElfFormattingEdits(document, { insertSpaces: true, tabSize: 2 });
    createElfCodeActions(document, declarationRange, { diagnostics: [] });

    const completionStart = performance.now();
    for (let index = 0; index < 10; index += 1) {
      createElfCompletionList(document, position);
    }
    const completionAverage = (performance.now() - completionStart) / 10;

    const formattingStart = performance.now();
    for (let index = 0; index < 10; index += 1) {
      createElfFormattingEdits(document, { insertSpaces: true, tabSize: 2 });
    }
    const formattingAverage = (performance.now() - formattingStart) / 10;

    const declarationStart = performance.now();
    for (let index = 0; index < 10; index += 1) {
      createElfCodeActions(document, declarationRange, { diagnostics: [] });
    }
    const declarationAverage = (performance.now() - declarationStart) / 10;

    expect(completionAverage).toBeLessThan(50);
    expect(formattingAverage).toBeLessThan(50);
    expect(declarationAverage).toBeLessThan(50);
  });

  it("merges nested inline Fragment formatting without overlapping edits", () => {
    const source = `
      import { defineHtml, fragment } from "@elfui/core";

      export const Demo = defineHtml(\`<main>\${fragment\`<section><strong>Value</strong></section>\`}</main>\`);
    `;
    const document = createDocument(source);
    const edits = createElfFormattingEdits(document, {
      insertSpaces: true,
      tabSize: 2
    });
    const formatted = applyTextEdits(source, edits);

    expect(edits).toHaveLength(1);
    expect(formatted).toContain("fragment`");
    expect(formatted).toContain("<section>");
    expect(formatted).toContain("<strong>Value</strong>");
  });

  it("keeps warm Fragment completion and formatting in the millisecond budget", () => {
    const source = `
      import { defineFragment, defineHtml } from "@elfui/core";

      interface CardProps {
        label: string;
      }

      const Card = defineFragment<CardProps>(({ label }) => \`
        <article>\${label.toUpperCase()}</article>
      \`);

      export const Demo = defineHtml(\`<main><Card :label=\${"value"} /></main>\`);
    `;
    const document = TextDocument.create("file:///fragment-performance.ts", "typescript", 1, source);
    const position = positionAfter(document, source, "${label.");

    createElfCompletionList(document, position);
    createElfFormattingEdits(document, { insertSpaces: true, tabSize: 2 });

    const completionStart = performance.now();
    for (let index = 0; index < 10; index += 1) {
      createElfCompletionList(document, position);
    }
    const completionAverage = (performance.now() - completionStart) / 10;

    const formattingStart = performance.now();
    for (let index = 0; index < 10; index += 1) {
      createElfFormattingEdits(document, { insertSpaces: true, tabSize: 2 });
    }
    const formattingAverage = (performance.now() - formattingStart) / 10;

    expect(completionAverage).toBeLessThan(50);
    expect(formattingAverage).toBeLessThan(50);
  });

  it("provides event completions for @elfui/core macro components", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      export default defineHtml(\`<button @\`);
    `;
    const document = createDocument(source);
    const completions = createElfCompletionList(
      document,
      document.positionAt(source.lastIndexOf("@") + 1)
    );
    expect(completions.items.map((item) => item.label)).toContain("@click");

    const directiveSource = source.replace("<button @", "<button v-");
    const directiveDocument = createDocument(directiveSource);
    const directiveCompletions = createElfCompletionList(
      directiveDocument,
      positionAfter(directiveDocument, directiveSource, "v-")
    );

    expect(directiveCompletions.items.map((item) => item.label)).toContain("v-if");
  });

  it("keeps the @elfui/core demo page free of template parser diagnostics", () => {
    const document = TextDocument.create("file:///App.ts", "typescript", 0, elfuiDemoFixture);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));
    const completionPosition = document.positionAt(elfuiDemoFixture.indexOf("@click") + 1);
    const completions = createElfCompletionList(document, completionPosition);

    expect(diagnostics.some((item) => item.includes("Unexpected character in tag"))).toBe(false);
    expect(diagnostics.some((item) => item.includes("not registered with use()"))).toBe(false);
    expect(completions.items.map((item) => item.label)).toContain("@click");
  });

  it("completes framework built-in components in template tags", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      export const Demo = defineHtml(\`<Trans\`);
    `;
    const document = createDocument(source);
    const completions = createElfCompletionList(document, positionAfter(document, source, "<Trans"));
    const transition = completions.items.find((item) => item.label === "Transition");

    expect(transition).toBeDefined();
    expect(readCompletionNewText(transition!)).toBe('Transition name="${1:fade}">$0</Transition>');
    expect(completions.items.some((item) => item.label === "Teleport")).toBe(true);
    expect(completions.items.some((item) => item.label === "KeepAlive")).toBe(true);
  });

  it("preserves existing expression event handlers when changing an event name", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      const handleClick = () => {};
      export const Demo = defineHtml(\`<button @m|k=\${handleClick}></button>\`);
    `.replace("|", "");
    const document = createDocument(source);
    const cursorOffset = source.indexOf("@mk") + "@m".length;
    const completion = createElfCompletionList(
      document,
      document.positionAt(cursorOffset),
    ).items.find((item) => item.label === "@mouseover");

    expect(completion).toBeDefined();
    expect(readCompletionNewText(completion!)).toBe("@mouseover");
    const edit = completion?.textEdit;
    expect(edit && "range" in edit).toBe(true);
    if (!edit || !("range" in edit)) throw new Error("Expected a completion text edit.");
    expect(applyTextEdits(source, [edit])).toContain(
      "@mouseover=${handleClick}",
    );
    expect(applyTextEdits(source, [edit])).not.toContain(
      "${handler}",
    );
  });

  it("preserves existing quoted event handlers when changing an event name", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      const handleClick = () => {};
      export const Demo = defineHtml(\`<button @m|k="handleClick"></button>\`);
    `.replace("|", "");
    const document = createDocument(source);
    const cursorOffset = source.indexOf("@mk") + "@m".length;
    const completion = createElfCompletionList(
      document,
      document.positionAt(cursorOffset),
      { completion: { eventBindingStyle: "quoted" } },
    ).items.find((item) => item.label === "@mouseover");

    expect(completion).toBeDefined();
    expect(readCompletionNewText(completion!)).toBe("@mouseover");
    const edit = completion?.textEdit;
    expect(edit && "range" in edit).toBe(true);
    if (!edit || !("range" in edit)) throw new Error("Expected a completion text edit.");
    expect(applyTextEdits(source, [edit])).toContain(
      '@mouseover="handleClick"',
    );
  });

  it("does not report missing closing tags for explicit SVG self-closing elements", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      export default defineHtml(\`
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <path d="M8 8 L16 16" />
        </svg>
      \`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics.some((item) => item.includes("Missing closing tag"))).toBe(false);
  });

  it("does not require framework built-in components to be registered", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      export const Demo = defineHtml(\`
        <Teleport to="body"><Transition><span>ready</span></Transition></Teleport>
      \`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics.some((item) => item.includes("Teleport"))).toBe(false);
    expect(diagnostics.some((item) => item.includes("Transition"))).toBe(false);
  });

  it("anchors shorthand slot hints after the complete slot attribute", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      export default defineHtml(\`<template #header></template>\`);
    `;
    const document = createDocument(source);
    const hint = createElfInlayHints(document).find((item) => item.label === "slot");

    expect(hint).toBeDefined();
    expect(document.offsetAt(hint!.position)).toBe(source.indexOf("#header") + "#header".length);
  });

  it("does not render hints at a tag fallback position when an attribute cannot be located", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      export default defineHtml(\`<button @click=\${onClick} :aria-selected=\${isSelected()}></button>\`);
    `;
    const document = createDocument(source);
    const hints = createElfInlayHints(document);
    const positions = hints.map((hint) => document.offsetAt(hint.position));

    expect(positions).toContain(source.indexOf("@click") + "@click".length);
    expect(positions).toContain(
      source.indexOf(":aria-selected") + ":aria-selected".length
    );
    expect(positions).not.toContain(source.indexOf("<button") + 1);
  });

  it("creates useRef state quick fixes for macro missing template names", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      export default defineHtml(\`<h1>{{ 标题 }}</h1>\`);
    `;
    const document = createDocument(source);
    const diagnostic = createElfDiagnostics(document).find((item) =>
      readDiagnosticMessages([item]).some((message) => message.includes("标题"))
    );
    const actions = createElfCodeActions(document, diagnostic!.range, {
      diagnostics: [diagnostic!]
    });
    const action = actions.find((item) => item.title === 'Create state "标题" with useRef()');
    const edits = action?.edit?.changes?.[document.uri] ?? [];
    const editTexts = edits.map((item) => item.newText);
    const formatted = applyTextEdits(source, edits);

    expect(action).toBeDefined();
    expect(editTexts).toContain(", useRef ");
    expect(editTexts).toContain("const 标题 = useRef();\n");
    expect(formatted).toContain('import { defineHtml, useRef } from "@elfui/core";');
    expect(formatted).toContain("const 标题 = useRef();");
  });

  it("creates handler quick fixes for macro missing event handlers", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      export default defineHtml(\`<button @blur=\${handler}></button>\`);
    `;
    const document = createDocument(source);
    const diagnostic = createElfDiagnostics(document).find((item) =>
      readDiagnosticMessages([item]).some(
        (message) => message.includes("Template event expression") && message.includes("handler")
      )
    );
    const actions = createElfCodeActions(document, diagnostic!.range, {
      diagnostics: [diagnostic!]
    });
    const action = actions.find((item) => item.title === 'Create handler "handler"');
    const editTexts = action?.edit?.changes?.[document.uri]?.map((item) => item.newText) ?? [];

    expect(action).toBeDefined();
    expect(editTexts).toContain("const handler = (e: Event) => {\n};\n");
  });

  it("infers missing state and handler actions at the cursor before diagnostics arrive", () => {
    const stateSource = `
      import { defineHtml } from "@elfui/core";

      export default defineHtml(\`<main v-if="condition"></main>\`);
    `;
    const stateDocument = createDocument(stateSource);
    const statePosition = positionAfter(stateDocument, stateSource, "condition");
    const stateAction = createElfCodeActions(
      stateDocument,
      { end: statePosition, start: statePosition },
      { diagnostics: [] }
    ).find((item) => item.title === 'Create state "condition" with useRef()');
    const stateResult = applyTextEdits(
      stateSource,
      stateAction?.edit?.changes?.[stateDocument.uri] ?? []
    );

    expect(stateResult).toContain("const condition = useRef();");

    const handlerSource = `
      import { defineHtml } from "@elfui/core";

      export default defineHtml(\`<button @click=\${handleClick}></button>\`);
    `;
    const handlerDocument = createDocument(handlerSource);
    const handlerPosition = positionAfter(handlerDocument, handlerSource, "handleClick");
    const handlerAction = createElfCodeActions(
      handlerDocument,
      { end: handlerPosition, start: handlerPosition },
      { diagnostics: [] }
    ).find((item) => item.title === 'Create handler "handleClick"');
    const handlerResult = applyTextEdits(
      handlerSource,
      handlerAction?.edit?.changes?.[handlerDocument.uri] ?? []
    );

    expect(handlerResult).toContain("const handleClick = (e: Event) => {");

    const methodSource = `
      import { defineHtml } from "@elfui/core";

      export default defineHtml(\`<main v-if="canOpen()"></main>\`);
    `;
    const methodDocument = createDocument(methodSource);
    const methodPosition = positionAfter(methodDocument, methodSource, "canOpen");
    const methodDiagnostic = createElfDiagnostics(methodDocument).find((item) =>
      readDiagnosticMessages([item]).some((message) => message.includes("canOpen"))
    );
    const methodAction = createElfCodeActions(
      methodDocument,
      { end: methodPosition, start: methodPosition },
      { diagnostics: methodDiagnostic ? [methodDiagnostic] : [] }
    ).find((item) => item.title === 'Create method "canOpen"');
    const methodResult = applyTextEdits(
      methodSource,
      methodAction?.edit?.changes?.[methodDocument.uri] ?? []
    );

    expect(methodResult).toContain("const canOpen = () => {");
    expect(methodResult).not.toContain("const canOpen = useRef();");
  });

  it("keeps HTML comments silent for diagnostics and completions", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      export default defineHtml(\`
        <!-- <button @click=\${commentedHandler}>{{ commentedState }}</button> -->
        <button @click=\${liveHandler}></button>
      \`);
    `;
    const document = createDocument(source);
    const messages = readDiagnosticMessages(createElfDiagnostics(document));
    const commentPosition = positionAfter(document, source, "commentedHandler");
    const completions = createElfCompletionList(document, commentPosition);

    expect(messages.some((message) => message.includes("commentedHandler"))).toBe(false);
    expect(messages.some((message) => message.includes("commentedState"))).toBe(false);
    expect(messages.some((message) => message.includes("liveHandler"))).toBe(true);
    expect(completions.items).toHaveLength(0);
  });

  it("adds useRef to the existing @elfui/core import", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      export default defineHtml(\`<h1>{{ title }}</h1>\`);
    `;
    const document = createDocument(source);
    const diagnostic = createElfDiagnostics(document).find((item) =>
      readDiagnosticMessages([item]).some((message) => message.includes("title"))
    );
    const action = createElfCodeActions(document, diagnostic!.range, {
      diagnostics: [diagnostic!]
    }).find((item) => item.title === 'Create state "title" with useRef()');
    const formatted = applyTextEdits(source, action?.edit?.changes?.[document.uri] ?? []);

    expect(formatted).toContain('import { defineHtml, useRef } from "@elfui/core";');
    expect(formatted).not.toContain('from "elfui"');
  });

  it("creates all missing macro states before event handlers", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      export default defineHtml(\`
        <section>
          {{ title }} {{ subtitle }}
          <button @blur=\${onBlur}></button>
          <button @click=\${save}></button>
        </section>
      \`);
    `;
    const document = createDocument(source);
    const diagnostics = createElfDiagnostics(document);
    const diagnostic = diagnostics.find((item) =>
      readDiagnosticMessages([item]).some((message) => message.includes("title"))
    );
    const actions = createElfCodeActions(document, diagnostic!.range, {
      diagnostics: [diagnostic!]
    });
    const action = actions.find(
      (item) => item.title === "Create all missing template state and handlers"
    );
    const formatted = applyTextEdits(source, action?.edit?.changes?.[document.uri] ?? []);

    expect(action).toBeDefined();
    expect(formatted).toContain('import { defineHtml, useRef } from "@elfui/core";');
    expect(formatted.indexOf("const title = useRef();")).toBeLessThan(
      formatted.indexOf("const subtitle = useRef();")
    );
    expect(formatted.indexOf("const subtitle = useRef();")).toBeLessThan(
      formatted.indexOf("const onBlur = (e: Event) => {")
    );
    expect(formatted.indexOf("const onBlur = (e: Event) => {")).toBeLessThan(
      formatted.indexOf("const save = (e: Event) => {")
    );
  });

  it("provides auto import quick fixes for unregistered workspace components", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      export const Demo = defineHtml(\`
        <ImportedButton></ImportedButton>
      \`);
    `;
    const document = createDocument(source);
    const diagnostic = createElfDiagnostics(document).find((item) =>
      (typeof item.message === "string" ? item.message : item.message.value).includes(
        "ImportedButton"
      )
    );
    const actions = createElfCodeActions(
      document,
      diagnostic!.range,
      { diagnostics: [diagnostic!] },
      {
        project: {
          components: [
            {
              exportName: "ImportedButton",
              importPath: "./ImportedButton",
              localName: "ImportedButton",
              tagName: "elf-imported-button"
            }
          ]
        }
      }
    );
    const action = actions.find((item) => item.title === "Import and register <ImportedButton>");
    const editTexts = action?.edit?.changes?.[document.uri]?.map((item) => item.newText) ?? [];

    expect(action).toBeDefined();
    expect(editTexts).toContain('import { ImportedButton } from "./ImportedButton";\n');
    expect(editTexts).toContain(", useComponents ");
    expect(editTexts).toContain("\nuseComponents({ ImportedButton });\n");
  });

  it("uses TypeScript virtual files for template member completions", () => {
    const source = `
      import { defineHtml, defineProps } from "@elfui/core";

      interface Props {
        disabled?: boolean;
        label: string;
      }

      const props = defineProps<Props>();
      const user = {
        active: true,
        name: "Ada"
      };

      export const Demo = defineHtml(\`
        <button :title=\${props.label}>{{ user.name }}</button>
      \`);
    `;
    const document = createDocument(source);
    const propsLabels = createElfCompletionList(
      document,
      positionAfter(document, source, "${props.")
    ).items.map((item) => item.label);
    const userLabels = createElfCompletionList(
      document,
      positionAfter(document, source, "{{ user.")
    ).items.map((item) => item.label);

    expect(propsLabels).toContain("disabled");
    expect(propsLabels).toContain("label");
    expect(userLabels).toContain("active");
    expect(userLabels).toContain("name");
  });

  it("types useTemplateRef values from @elfui/core in direct templates", () => {
    const source = `
      import { defineHtml, onMounted, onUnmounted, useTemplateRef } from "@elfui/core";

      const chart = useTemplateRef<HTMLDivElement>("chart");
      onMounted(() => chart.value?.focus());
      onUnmounted(() => chart.value?.blur());

      export default defineHtml(\`
        <div ref="chart" :data-owner=\${chart.value.}></div>
      \`);
    `;
    const document = createDocument(source);
    const labels = createElfCompletionList(
      document,
      positionAfter(document, source, "${chart.value.")
    ).items.map((item) => item.label);

    expect(labels).toContain("accessKey");
  });

  it("shows individual macro prop types and defaults in template hover", () => {
    const source = `
      import { defineHtml, defineProps } from "@elfui/core";

      interface Props {
        title?: string;
      }

      defineProps<Props>({ title: { type: String, default: "Hello" } });

      export default defineHtml(\`<section :title=\${title}></section>\`);
    `;
    const document = createDocument(source);
    const hover = createElfHover(document, positionAfter(document, source, "${title"));
    const hoverText = readHoverText(hover);

    expect(hoverText).toContain("Type: `string | undefined`");
    expect(hoverText).toContain('Default: `"Hello"`');
  });

  it("uses DOM event types for $event member completions", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      export const Demo = defineHtml(\`
        <input @input=\${$event.} />
        <button @keydown=\${$event.}>Save</button>
      \`);
    `;
    const document = createDocument(source);
    const inputLabels = createElfCompletionList(
      document,
      positionAfter(document, source, "@input=${$event.")
    ).items.map((item) => item.label);
    const keyLabels = createElfCompletionList(
      document,
      positionAfter(document, source, "@keydown=${$event.")
    ).items.map((item) => item.label);

    expect(inputLabels).toContain("data");
    expect(inputLabels).toContain("inputType");
    expect(inputLabels).toContain("target");
    expect(keyLabels).toContain("code");
    expect(keyLabels).toContain("key");
  });

  it("uses v-for source types for template local member completions", () => {
    const source = `
      import { defineHtml, defineProps } from "@elfui/core";

      interface Item {
        id: number;
        label: string;
      }

      interface Props {
        items: Item[];
      }

      const props = defineProps<Props>();

      export const Demo = defineHtml(\`
        <ul>
          <li v-for="item in props.items">{{ item.label }}</li>
        </ul>
      \`);
    `;
    const document = createDocument(source);
    const labels = createElfCompletionList(
      document,
      positionAfter(document, source, "{{ item.")
    ).items.map((item) => item.label);

    expect(labels).toContain("id");
    expect(labels).toContain("label");
  });

  it("provides typed v-for member completions inside quoted bindings", () => {
    const source = `
      import { defineHtml, useRef } from "@elfui/core";

      const userList = useRef([
        { age: 35, name: "Ada" }
      ]);

      export const Home = defineHtml(\`
        <ul>
          <li v-for="user in userList" :key="user.">{{ user.name }}</li>
        </ul>
      \`);
    `;
    const document = createDocument(source);
    const labels = createElfCompletionList(
      document,
      positionAfter(document, source, ':key="user.')
    ).items.map((item) => item.label);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(labels).toContain("age");
    expect(labels).toContain("name");
    expect(diagnostics.some((item) => item.includes("is of type 'unknown'"))).toBe(false);
  });

  it("provides typed v-for member completions inside mustache interpolations", () => {
    const source = `
      import { defineHtml, useRef } from "@elfui/core";

      const userList = useRef([
        { age: 35, id: 1, name: "Ada" }
      ]);

      export const Home = defineHtml(\`
        <ul>
          <li v-for="user in userList" :key="user.id">{{ user. }}</li>
        </ul>
      \`);
    `;
    const document = createDocument(source);
    const labels = createElfCompletionList(
      document,
      positionAfter(document, source, "{{ user.")
    ).items.map((item) => item.label);

    expect(labels).toContain("age");
    expect(labels).toContain("id");
    expect(labels).toContain("name");
  });

  it("does not report macro TS missing-name diagnostics for v-for locals inside template interpolations", () => {
    const source = `
      import { defineHtml, useRef } from "@elfui/core";

      const userList = useRef([
        { age: 35, id: 1, name: "Ada" }
      ]);

      export const Home = defineHtml(\`
        <ul>
          <li v-for="user in userList" :key=\${user.id}>\${user.name} - \${user.age}</li>
        </ul>
        <div>\${missingValue}</div>
      \`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics.some((item) => item.includes("Cannot find name 'user'"))).toBe(false);
    expect(diagnostics.some((item) => item.includes("找不到名称") && item.includes("user"))).toBe(
      false
    );
    expect(diagnostics.some((item) => item.includes("missingValue"))).toBe(true);
  });

  it("repairs untyped useRef lists reported through v-for locals", () => {
    const source = `
      import { defineHtml, useRef } from "@elfui/core";

      const userList = useRef();

      export const Home = defineHtml(\`
        <ul>
          <li v-for="user in userList" :key="user.name">\${user.name}</li>
        </ul>
      \`);
    `;
    const document = createDocument(source);
    const diagnostic = createElfDiagnostics(document).find((item) =>
      readDiagnosticMessages([item])[0]?.includes("'user' is of type 'unknown'")
    );

    expect(diagnostic).toBeDefined();

    const actions = createElfCodeActions(document, diagnostic!.range, {
      diagnostics: [diagnostic!]
    });
    const action = actions.find(
      (item) => item.title === 'Initialize "userList" as a typed list state'
    );
    const formatted = applyTextEdits(source, action?.edit?.changes?.[document.uri] ?? []);
    const fixedDocument = createDocument(formatted);
    const fixedDiagnostics = readDiagnosticMessages(createElfDiagnostics(fixedDocument));

    expect(action).toBeDefined();
    expect(formatted).toContain("const userList = useRef<Record<string, unknown>[]>([]);");
    expect(fixedDiagnostics.some((item) => item.includes("is of type 'unknown'"))).toBe(false);
  });

  it("uses destructured v-for source types for template local member completions", () => {
    const source = `
      import { defineHtml, defineProps } from "@elfui/core";

      interface Row {
        disabled: boolean;
        id: number;
        label: string;
      }

      interface Cell {
        value: string;
      }

      interface Props {
        groups: Array<{ cells: Cell[]; row: Row }>;
      }

      const props = defineProps<Props>();

      export const Demo = defineHtml(\`
        <ul>
          <li v-for="{ row } in props.groups">{{ row.label }}</li>
          <li v-for="({ row: current }, groupIndex) in props.groups">{{ current.disabled }} {{ groupIndex }}</li>
          <li v-for="{ cells: [first] } in props.groups">{{ first.value }}</li>
        </ul>
      \`);
    `;
    const document = createDocument(source);
    const rowLabels = createElfCompletionList(
      document,
      positionAfter(document, source, "{{ row.")
    ).items.map((item) => item.label);
    const currentLabels = createElfCompletionList(
      document,
      positionAfter(document, source, "{{ current.")
    ).items.map((item) => item.label);
    const firstLabels = createElfCompletionList(
      document,
      positionAfter(document, source, "{{ first.")
    ).items.map((item) => item.label);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(rowLabels).toContain("id");
    expect(rowLabels).toContain("label");
    expect(currentLabels).toContain("disabled");
    expect(currentLabels).toContain("label");
    expect(firstLabels).toContain("value");
    expect(diagnostics.some((item) => item.includes('"row"'))).toBe(false);
    expect(diagnostics.some((item) => item.includes('"current"'))).toBe(false);
    expect(diagnostics.some((item) => item.includes('"first"'))).toBe(false);
    expect(diagnostics.some((item) => item.includes('"groupIndex"'))).toBe(false);
  });

  it("keeps expression-bound object attributes intact while formatting templates", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      const View = defineHtml(\`<button
        :class=\${{
          'is-disabled': item.disabled,
          'is-divided': item.divided,
          'is-selected': isSelected(item)
        }}
        :disabled=\${item.disabled}
      >Save</button>\`);
    `;
    const document = createDocument(source);
    const formatted = applyTextEdits(
      source,
      createElfFormattingEdits(document, {
        insertSpaces: true,
        tabSize: 2
      })
    );

    expect(formatted).toContain(":class=${{");
    const classLine = formatted.split("\n").find((line) => line.includes(":class=${{")) ?? "";
    const memberLine =
      formatted.split("\n").find((line) => line.includes("'is-disabled': item.disabled")) ?? "";
    const closeLine = formatted.split("\n").find((line) => line.trim() === "}}") ?? "";
    const indentSize = (line: string) => line.match(/^[ \t]*/)?.[0].length ?? 0;

    expect(indentSize(memberLine)).toBe(indentSize(classLine) + 2);
    expect(indentSize(closeLine)).toBe(indentSize(classLine));
    expect(formatted).toContain("'is-disabled': item.disabled");
    expect(formatted).toContain("'is-divided': item.divided");
    expect(formatted).toContain("'is-selected': isSelected(item)");
    expect(formatted).toContain(":disabled=${item.disabled}");
    expect(formatted).not.toContain('prop="{');
  });

  it("keeps multiline quoted bindings in named Fragments idempotent across saves", () => {
    const source = [
      'import { defineFragment, defineHtml } from "@elfui/core";',
      "",
      "const MenuPanel = defineFragment(() => `",
      '  <button :class="{',
      "                            'is-disabled': child.disabled,",
      "                            'is-selected': isSelected(child)",
      '                          }">',
      "    {{ child.label }}</button>",
      "`);",
      "",
      "export const Menu = defineHtml(`",
      "  <MenuPanel />",
      "`);",
      ""
    ].join("\n");
    const format = (current: string) =>
      applyTextEdits(
        current,
        createElfFormattingEdits(createDocument(current), {
          insertSpaces: true,
          tabSize: 2
        })
      );
    const formattedOnce = format(source);
    const formattedTwice = format(formattedOnce);
    const formattedThreeTimes = format(formattedTwice);
    const lines = formattedOnce.split("\n");
    const attributeLine = lines.find((line) => line.includes(':class="{')) ?? "";
    const memberLine = lines.find((line) => line.includes("'is-disabled'")) ?? "";
    const closingLine = lines.find((line) => line.includes('}"')) ?? "";
    const indentSize = (line: string) => line.match(/^[ \t]*/)?.[0].length ?? 0;

    expect(formattedTwice).toBe(formattedOnce);
    expect(formattedThreeTimes).toBe(formattedOnce);
    expect(indentSize(memberLine)).toBe(indentSize(attributeLine) + 2);
    expect(indentSize(closingLine)).toBe(indentSize(attributeLine));
    expect(formattedOnce).toContain("<MenuPanel />");
  });

  it("reports macro template TypeScript diagnostics", () => {
    const source = `
      /// <!--@elf component-->
      import { defineHtml, defineProps } from "@elfui/core";

      interface Props {
        disabled: boolean;
      }

      const props = defineProps<Props>();

      export default defineHtml(\`
        <button :disabled=\${props.disabeld}></button>
      \`);
    `;
    const document = TextDocument.create("file:///Demo.elf.ts", "typescript", 0, source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics.some((item) => item.includes("disabeld"))).toBe(true);
  });

  it("accepts beta.13 direct defineHtml literals", () => {
    const source = `
      /// <!--@elf component-->
      import { defineHtml, defineProps } from "@elfui/core";

      interface Props {
        disabled: boolean;
      }

      const props = defineProps<Props>();

      export default defineHtml(\`
        <button :disabled=\${props.disabeld}></button>
      \`);
    `;
    const document = TextDocument.create("file:///Direct.elf.ts", "typescript", 0, source);
    const diagnostics = createElfDiagnostics(document);
    expect(
      diagnostics.some(
        (item) =>
          item.code === "ELF_MACRO_DEFINE_HTML_TEMPLATE" || item.code === "ELF_MACRO_NO_TEMPLATE"
      )
    ).toBe(false);
  });

  it("does not report valid macro handlers and exposed props as missing", () => {
    const source = `
      import { defineHtml, defineProps } from "@elfui/core";

      interface Props {
        title: string;
      }

      const props = defineProps<Props>();
      const toggleTheme = () => props.title;

      export default defineHtml<Props>(\`
        <button @click="toggleTheme">\${title}</button>
      \`);
    `;
    const document = TextDocument.create("file:///AppShell.ts", "typescript", 0, source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics.some((item) => item.includes("toggleTheme"))).toBe(false);
    expect(diagnostics.some((item) => item.includes("title"))).toBe(false);
  });

  it("does not report packaged lib false positives in macro template diagnostics", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      interface MenuItem {
        badge?: string;
        disabled?: boolean;
        divider?: boolean;
        group?: boolean;
        hasChildren?: boolean;
        icon?: string;
        index: string;
        label: string;
      }

      const getHorizontalPanelItems = (): MenuItem[] => [
        { index: "home", label: "Home" }
      ];
      const itemClass = (item: MenuItem) => ["menu-item", item.disabled ? "is-disabled" : ""];
      const onItemClick = (item: MenuItem, event: MouseEvent) => {
        event.preventDefault();
        return item.index;
      };

      export const Menu = defineHtml(\`
        <div v-if="getHorizontalPanelItems().length > 0" class="horizontal-panel">
          <template v-for="item in getHorizontalPanelItems()" :key="item.index">
            <hr v-if="item.divider" class="menu-divider" />
            <strong v-else-if="item.group" class="menu-group-title">{{ item.label }}</strong>
            <button
              v-else
              type="button"
              :class="itemClass(item)"
              :disabled="item.disabled"
              :title="item.label"
              @click="onItemClick(item, $event)"
            >
              <span v-if="item.icon" class="menu-icon">{{ item.icon }}</span>
              <span class="menu-label">{{ item.label }}</span>
              <span v-if="item.badge" class="menu-badge">{{ item.badge }}</span>
              <span v-if="item.hasChildren" class="menu-arrow"></span>
            </button>
          </template>
        </div>
      \`);
    `;
    const document = TextDocument.create("file:///Menu.ts", "typescript", 0, source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics.some((item) => item.includes("getHorizontalPanelItems().length"))).toBe(
      false
    );
    expect(diagnostics.some((item) => item.includes("Cannot find name 'Array'"))).toBe(false);
    expect(diagnostics.some((item) => item.includes("Cannot find name 'MouseEvent'"))).toBe(false);
    expect(diagnostics).toEqual([]);
  });

  it("does not report HTML scanner errors for expression bindings with quotes", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      const props = { separator: "/" };
      const visibleItems = () => [
        { current: true, disabled: false, ellipsis: false, key: "home", label: "Home", last: false }
      ];
      const onItemClick = (item: { key: string }, event: MouseEvent) => {
        item.key;
        event.preventDefault();
      };

      export const Breadcrumb = defineHtml(\`
        <nav class="breadcrumb" aria-label="breadcrumb">
          <ol class="breadcrumb-list">
            <li
              v-for="item in visibleItems()"
              :key=\${item.key + ":" + (item.current ? "active" : "idle") + ":" + (item.last ? "last" : "mid")}
              :class=\${["breadcrumb-item", { "is-current": item.current, "is-disabled": item.disabled, "is-ellipsis": item.ellipsis }]}
            >
              <button
                v-if=\${!item.current && !item.ellipsis}
                type="button"
                class="breadcrumb-link"
                :disabled=\${item.disabled}
                @click=\${onItemClick(item, $event)}
              >
                \${item.label}
              </button>
              <span v-else class="breadcrumb-text" :aria-current=\${item.current ? "page" : ""}>
                \${item.label}
              </span>
              <span v-if=\${!item.last} class="breadcrumb-separator" aria-hidden="true">
                \${props.separator || "/"}
              </span>
            </li>
          </ol>
        </nav>
      \`);
    `;
    const document = TextDocument.create("file:///Breadcrumb.ts", "typescript", 0, source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics.some((item) => item.includes("Unexpected character in tag"))).toBe(false);
  });

  it("does not report HTML scanner errors for the ui-kit Menu template", () => {
    const source = readUiKitComponent("Navigation", "Menu", "index.ts");

    if (!source) {
      return;
    }

    const document = TextDocument.create("file:///Menu.ts", "typescript", 0, source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document)).filter((item) =>
      item.includes("Unexpected character in tag")
    );

    expect(diagnostics).toEqual([]);
  });

  it("keeps useRef values valid in the ui-kit Dropdown template", () => {
    const source = readUiKitComponent("Navigation", "Dropdown", "index.ts");

    if (!source) {
      return;
    }

    const document = TextDocument.create("file:///Dropdown.ts", "typescript", 0, source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document)).filter((item) =>
      item.includes("Property 'value' does not exist")
    );

    expect(diagnostics).toEqual([]);
  });

  it("keeps useRef values typed inside interpolation bindings", () => {
    const source = `
      import { defineHtml, useRef } from "@elfui/core";

      const hoveredIndex = useRef("");
      const getHoveredChildren = () => [];
      const findItem = (index: string) => ({ index });
      const popperClass = (name: string, item: { index: string }) => [name, item.index];

      export const Menu = defineHtml(\`
        <div
          v-if=\${getHoveredChildren().length > 0}
          :class=\${popperClass("collapse-popup", findItem(hoveredIndex.value))}
        ></div>
      \`);
    `;
    const document = TextDocument.create("file:///Menu.ts", "typescript", 0, source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics.some((item) => item.includes("Property 'value' does not exist"))).toBe(
      false
    );
  });

  it("keeps real property errors for ordinary interpolation bindings", () => {
    const source = `
      import { defineHtml } from "@elfui/core";

      const item = { id: "home" };

      export const Menu = defineHtml(\`<div :class=\${item.value}></div>\`);
    `;
    const document = TextDocument.create("file:///Menu.ts", "typescript", 0, source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics.some((item) => item.includes("Property 'value' does not exist"))).toBe(true);
  });

  it("provides macro local component completions and hover metadata", () => {
    const source = `
      /// <!--@elf component-->
      import { defineHtml, useComponents } from "@elfui/core";
      import { LocalIcon } from "./LocalIcon";

      useComponents({ LocalIcon });

      export default defineHtml(\`
        <Loc
      \`);
    `;
    const document = TextDocument.create("file:///Demo.elf.ts", "typescript", 0, source);
    const labels = createElfCompletionList(
      document,
      positionAfter(document, source, "<Loc")
    ).items.map((item) => item.label);

    expect(labels).toContain("LocalIcon");

    const hoverSource = source.replace("<Loc", "<LocalIcon></LocalIcon>");
    const hoverDocument = TextDocument.create("file:///Demo.elf.ts", "typescript", 0, hoverSource);
    const hover = createElfHover(
      hoverDocument,
      positionAfter(hoverDocument, hoverSource, "<LocalIcon")
    );

    expect(readHoverText(hover)).toContain("ElfUI local component");
    expect(readHoverText(hover)).toContain("LocalIcon");
  });

  it("provides indexed component metadata on tags, props, events and slots", () => {
    const source = `
      import { defineHtml, useComponents } from "@elfui/core";
      import { PackageButton } from "@acme/elfui-kit";

      const onConfirm = () => {};
      const visible = true;
      useComponents({ PackageButton });

      export default defineHtml(\`
        <PackageButton :open=\${visible} @confirm=\${onConfirm}>
          <template #footer="footer">Footer</template>
        </PackageButton>
      \`);
    `;
    const document = createDocument(source);
    const options = {
      project: {
        components: [
          {
            emits: ["confirm"],
            emitDetails: [{ name: "confirm", payloadType: "{ value: string }" }],
            exportName: "PackageButton" as const,
            importPath: "@acme/elfui-kit",
            localName: "PackageButton",
            propDetails: [{ defaultValue: "false", name: "open", type: "boolean" }],
            props: ["open"],
            slotScopes: [{ name: "footer", scopeType: "{ close(): void }" }],
            slots: ["footer"],
            tagName: "elf-package-button"
          }
        ]
      }
    };

    expect(
      readHoverText(createElfHover(document, positionAfter(document, source, "<PackageButton"), options))
    ).toContain("Props: `open`");
    expect(
      readHoverText(createElfHover(document, positionAfter(document, source, ":open"), options))
    ).toContain("Import: `@acme/elfui-kit`");
    expect(
      readHoverText(createElfHover(document, positionAfter(document, source, ":open"), options))
    ).toContain("Type: `boolean`");
    expect(
      readHoverText(createElfHover(document, positionAfter(document, source, ":open"), options))
    ).toContain("Default: `false`");
    expect(
      readHoverText(createElfHover(document, positionAfter(document, source, "@confirm"), options))
    ).toContain("ElfUI event");
    expect(
      readHoverText(createElfHover(document, positionAfter(document, source, "@confirm"), options))
    ).toContain("Payload: `{ value: string }`");
    expect(
      readHoverText(createElfHover(document, positionAfter(document, source, "#footer"), options))
    ).toContain("Scope: `{ close(): void }`");
  });

  it("supports named Fragment completion, props, definition, references and rename", () => {
    const source = `
      import { defineFragment, defineHtml } from "@elfui/core";

      interface CardProps {
        label: string;
        selected?: boolean;
      }

      const SummaryCard = defineFragment<CardProps>(
        ({ label, selected }) => \`
          <article :class=\${selected ? "selected" : ""}>
            \${label.toUpperCase()}
          </article>
        \`
      );

      export const Dashboard = defineHtml(\`
        <main>
          <SummaryCard :
        </main>
      \`);
    `;
    const document = TextDocument.create(
      "file:///E:/项目/组件库/汇总.ts",
      "typescript",
      0,
      source
    );
    const tagLabels = createElfCompletionList(
      document,
      positionAfter(document, source, "<Summary")
    ).items.map((item) => item.label);
    const propLabels = createElfCompletionList(
      document,
      positionAfter(document, source, "<SummaryCard :")
    ).items.map((item) => item.label);
    const definition = createElfDefinition(
      document,
      positionAfter(document, source, "<SummaryCard")
    );
    const references = createElfReferences(
      document,
      positionAfter(document, source, "const SummaryCard")
    );
    const rename = createElfRenameEdit(
      document,
      positionAfter(document, source, "const SummaryCard"),
      "CompactCard"
    );
    const renamed = applyTextEdits(source, rename?.changes?.[document.uri] ?? []);
    const fragmentMemberLabels = createElfCompletionList(
      document,
      positionAfter(document, source, "${label.")
    ).items.map((item) => item.label);

    expect(tagLabels).toContain("SummaryCard");
    expect(propLabels).toEqual(expect.arrayContaining([":label", ":selected"]));
    expect(definition).toHaveLength(1);
    expect(readRange(document, definition[0]!.range)).toBe("SummaryCard");
    expect(references.map((item) => readRange(document, item.range))).toEqual(
      expect.arrayContaining(["SummaryCard", "SummaryCard"])
    );
    expect(renamed).toContain("const CompactCard");
    expect(renamed).toContain("<CompactCard :");
    expect(fragmentMemberLabels).toContain("charAt");
  });

  it("maps beta.13 Fragment cycle diagnostics from structured ranges", () => {
    const source = `
      import { defineFragment, defineHtml } from "@elfui/core";

      const First = defineFragment(() => \`<Second />\`);
      const Second = defineFragment(() => \`<First />\`);

      export default defineHtml(\`<First />\`);
    `;
    const document = createDocument(source);
    const diagnostic = createElfDiagnostics(document).find(
      (item) => item.code === "ELF_MACRO_FRAGMENT_CYCLE"
    );

    expect(diagnostic).toBeDefined();
    expect(document.offsetAt(diagnostic!.range.start)).toBeGreaterThan(0);
    expect(diagnostic?.data).toMatchObject({
      fragment: expect.any(String),
      sourceId: expect.any(String)
    });
  });
});
