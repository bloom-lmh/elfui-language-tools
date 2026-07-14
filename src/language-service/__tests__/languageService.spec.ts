import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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
  it("uses the HTML language service for template tag completions", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`<\`);
    `;
    const document = createDocument(source);
    const completions = createElfCompletionList(document, positionAfter(document, source, "<"));

    expect(completions.items.some((item) => item.label === "div")).toBe(true);
    expect(completions.items.some((item) => item.label === "button")).toBe(true);
  });

  it("provides event completions for @elfui/core macro components", () => {
    const source = `
      import { defineHtml, html } from "@elfui/core";

      export default defineHtml(html\`<button @\`);
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
      import { defineHtml, html } from "elfui";

      export const Demo = defineHtml(html\`<Trans\`);
    `;
    const document = createDocument(source);
    const completions = createElfCompletionList(document, positionAfter(document, source, "<Trans"));
    const transition = completions.items.find((item) => item.label === "Transition");

    expect(transition).toBeDefined();
    expect(readCompletionNewText(transition!)).toBe('Transition name="${1:fade}">$0</Transition>');
    expect(completions.items.some((item) => item.label === "Teleport")).toBe(true);
    expect(completions.items.some((item) => item.label === "KeepAlive")).toBe(true);
  });

  it("keeps attribute-name completions focused on template attributes", () => {
    const source = `
      import { ElfUI } from "elfui";
      import Icon from "./Icon";

      const Demo = ElfUI.createComponent();
      Demo.props({ disabled: Boolean });
      Demo.emits(["submit"]);
      Demo.use({ LocalIcon: Icon });
      Demo.slot("footer");
      Demo.setup(() => ({
        count: 0,
        submit() {}
      }));
      Demo.template(\`<button \`);
    `;
    const document = createDocument(source);
    const completions = createElfCompletionList(
      document,
      positionAfter(document, source, "<button ")
    );
    const labels = completions.items.map((item) => item.label);
    const vIfCompletion = completions.items.find((item) => item.label === "v-if");
    const vForCompletion = completions.items.find((item) => item.label === "v-for");
    const vMemoCompletion = completions.items.find((item) => item.label === "v-memo");

    expect(labels).toContain("v-if");
    expect(labels).toContain("v-once");
    expect(labels).toContain("v-memo");
    expect(labels).toContain(":disabled");
    expect(labels).toContain("@submit");
    expect(labels).toContain("#footer");
    expect(labels.includes("emit")).toBe(false);
    expect(labels.includes("LocalIcon")).toBe(false);
    expect(labels.includes("count")).toBe(false);
    expect(vIfCompletion?.sortText).toBe("0100");
    expect(vForCompletion?.sortText).toBe("0101");
    expect(readCompletionNewText(vIfCompletion!)).toBe("v-if=\\${${1:condition}}");
    expect(readCompletionNewText(vForCompletion!)).toBe('v-for="${1:item} in ${2:items}"');
    expect(readCompletionNewText(vMemoCompletion!)).toBe("v-memo=\\${${1:[deps]}}");
  });

  it("uses registered project component metadata for attribute completions", () => {
    const source = `
      import { ElfUI } from "elfui";
      import { UiDialog } from "./UiDialog";

      const Demo = ElfUI.createComponent();
      Demo.props({ disabled: Boolean });
      Demo.use({ ModalAlias: UiDialog });
      Demo.template(\`<ModalAlias \`);
    `;
    const document = createDocument(source);
    const completions = createElfCompletionList(
      document,
      positionAfter(document, source, "<ModalAlias "),
      {
        project: {
          components: [
            {
              emits: ["confirm"],
              exportName: "UiDialog",
              importPath: "./UiDialog",
              localName: "UiDialog",
              props: ["title", "open", "modelValue"],
              slots: ["footer"]
            }
          ]
        }
      }
    );
    const labels = completions.items.map((item) => item.label);

    expect(labels).toContain(":title");
    expect(labels).toContain("@confirm");
    expect(labels).toContain("#footer");
    expect(labels).not.toContain(":disabled");
  });

  it("filters event and modifier completions by template context", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.props({ disabled: Boolean });
      Demo.emits(["submit"]);
      Demo.template(\`<button @\`);
    `;
    const document = createDocument(source);
    const eventCompletions = createElfCompletionList(
      document,
      positionAfter(document, source, "<button @")
    );
    const eventLabels = eventCompletions.items.map((item) => item.label);
    const clickCompletion = eventCompletions.items.find((item) => item.label === "@click");

    expect(eventLabels).toContain("@click");
    expect(eventLabels).toContain("@submit");
    expect(eventLabels.includes(":disabled")).toBe(false);
    expect(eventLabels.includes("v-if")).toBe(false);
    expect(readCompletionNewText(clickCompletion!)).toBe("@click=\\${${1:handler}}");

    const modifierSource = source.replace("<button @", "<button @click.");
    const modifierDocument = createDocument(modifierSource);
    const modifierLabels = createElfCompletionList(
      modifierDocument,
      positionAfter(modifierDocument, modifierSource, "@click.")
    ).items.map((item) => item.label);

    expect(modifierLabels).toContain(".stop");
    expect(modifierLabels).toContain(".prevent");
    expect(modifierLabels.includes("@click")).toBe(false);
    expect(modifierLabels.includes(":disabled")).toBe(false);
  });

  it("completes bare HTML tag names as paired tags", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`div\`);
    `;
    const document = createDocument(source);
    const completions = createElfCompletionList(document, positionAfter(document, source, "div"));
    const divCompletion = completions.items.find((item) => item.label === "div");

    expect(readCompletionNewText(divCompletion!)).toBe("<div>$0</div>");
  });

  it("completes bare local component names as paired tags", () => {
    const source = `
      import { ElfUI } from "elfui";
      import Home from "./Home";

      const Demo = ElfUI.createComponent();
      Demo.use({ Home });
      Demo.template(\`Home\`);
    `;
    const document = createDocument(source);
    const completions = createElfCompletionList(
      document,
      positionAfter(document, source, "Demo.template(`Home")
    );
    const homeCompletion = completions.items.find((item) => item.label === "Home");

    expect(readCompletionNewText(homeCompletion!)).toBe("<Home>$0</Home>");
  });

  it("filters prop binding completions by template context", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.props({ disabled: Boolean });
      Demo.emits(["submit"]);
      Demo.template(\`<button :\`);
    `;
    const document = createDocument(source);
    const completions = createElfCompletionList(
      document,
      positionAfter(document, source, "<button :")
    );
    const labels = completions.items.map((item) => item.label);
    const disabledCompletion = completions.items.find((item) => item.label === ":disabled");

    expect(labels).toEqual([":disabled"]);
    expect(readCompletionNewText(disabledCompletion!)).toBe(":disabled=\\${${1:disabled}}");
  });

  it("keeps quoted binding snippets available through completion options", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.props({ disabled: Boolean });
      Demo.emits(["submit"]);
      Demo.template(\`<button @\`);
    `;
    const document = createDocument(source);
    const eventCompletion = createElfCompletionList(
      document,
      positionAfter(document, source, "<button @"),
      {
        completion: {
          eventBindingStyle: "quoted",
          templateBindingStyle: "quoted"
        }
      }
    ).items.find((item) => item.label === "@click");

    expect(readCompletionNewText(eventCompletion!)).toBe('@click="$1"');

    const propSource = source.replace("<button @", "<button :");
    const propDocument = createDocument(propSource);
    const propCompletion = createElfCompletionList(
      propDocument,
      positionAfter(propDocument, propSource, "<button :"),
      {
        completion: {
          eventBindingStyle: "quoted",
          templateBindingStyle: "quoted"
        }
      }
    ).items.find((item) => item.label === ":disabled");

    expect(readCompletionNewText(propCompletion!)).toBe(':disabled="$1"');
  });

  it("auto-completes quotes after attribute assignments", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`<button @click=\`);
    `;
    const document = createDocument(source);
    const position = positionAfter(document, source, "@click=");
    const edits = createElfOnTypeFormattingEdits(document, position, "=");

    expect(edits.map((item) => item.newText)).toContain('""');
  });

  it("completes closing tags for template strings", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`<div>\`);
    `;
    const document = createDocument(source);

    expect(createElfTagComplete(document, positionAfter(document, source, "<div>"))).toBe("</div>");
  });

  it("reports basic HTML diagnostics inside template strings", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`<section><div></section>\`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics.some((item) => item.includes("Missing closing tag"))).toBe(true);
  });

  it("does not report missing closing tags for explicit SVG self-closing elements", () => {
    const source = `
      import { defineHtml, html } from "elfui";

      export default defineHtml(html\`
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

  it("reports unknown template variables and unregistered local components", () => {
    const source = `
      import { ElfUI } from "elfui";
      import Icon from "./Icon";

      const Demo = ElfUI.createComponent();
      Demo.use({ LocalIcon: Icon });
      Demo.setup(() => ({ count: 0 }));
      Demo.template(\`
        <section>
          <LocalIcon></LocalIcon>
          <MissingIcon></MissingIcon>
          {{ count }} {{ missingValue }}
        </section>
      \`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics).toContain('Unknown template variable "missingValue".');
    expect(diagnostics).toContain("Component <MissingIcon> is not registered with use().");
    expect(diagnostics.some((item) => item.includes("LocalIcon"))).toBe(false);
    expect(diagnostics.some((item) => item.includes('"count"'))).toBe(false);
  });

  it("does not require framework built-in components to be registered", () => {
    const source = `
      import { defineHtml, html } from "elfui";

      export const Demo = defineHtml(html\`
        <Teleport to="body"><Transition><span>ready</span></Transition></Teleport>
      \`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics.some((item) => item.includes("Teleport"))).toBe(false);
    expect(diagnostics.some((item) => item.includes("Transition"))).toBe(false);
  });

  it("recognises $event and $value as built-in template variables", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.setup(() => ({
        select: (_value: string, _event: Event) => undefined,
        update: (_value: string) => undefined
      }));
      Demo.template(\`
        <button @click="select($event.target.value, $event)"></button>
        <input @input="update($event.target.value)" v-model="$value" />
      \`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics.some((item) => item.includes('"event"'))).toBe(false);
    expect(diagnostics.some((item) => item.includes('"value"'))).toBe(false);
    expect(diagnostics.some((item) => item.includes('"$event"'))).toBe(false);
    expect(diagnostics.some((item) => item.includes('"$value"'))).toBe(false);
  });

  it("keeps language features active in templates with JavaScript interpolations", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.setup(() => ({ count: 0 }));
      Demo.template(\`<section>\${count} \${missingValue}</section>\`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));
    const labels = createElfCompletionList(
      document,
      positionAfter(document, source, "${count")
    ).items.map((item) => item.label);

    expect(labels).toContain("count");
    expect(diagnostics).toContain('Unknown template variable "missingValue".');
    expect(diagnostics.some((item) => item.includes('"count"'))).toBe(false);
  });

  it("reports template emit calls that are not declared", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.emits(["submit"]);
      Demo.template(\`<button @click="emit('cancel')"></button>\`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics).toContain('Event "cancel" is not declared in emits().');
  });

  it("reports obvious prop mismatches for same-file local components", () => {
    const source = `
      import { ElfUI } from "elfui";

      const ChildCard = ElfUI.createComponent();
      ChildCard.props({ title: String });
      ChildCard.template(\`<article>{{ title }}</article>\`);

      const Demo = ElfUI.createComponent();
      Demo.use([ChildCard]);
      Demo.template(\`<ChildCard :missing="1"></ChildCard>\`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics).toContain('Prop "missing" is not declared on <ChildCard>.');
  });

  it("normalizes kebab-case component tags and prop names for same-file diagnostics", () => {
    const source = `
      import { ElfUI } from "elfui";

      const ChildCard = ElfUI.createComponent();
      ChildCard.props({
        beforeClose: Function,
        modelValue: String,
        open: Boolean
      });
      ChildCard.template(\`<article></article>\`);

      const Demo = ElfUI.createComponent();
      Demo.use({ "child-card": ChildCard });
      Demo.setup(() => ({
        beforeClose() {},
        missing: 1,
        open: true,
        value: "demo"
      }));
      Demo.template(\`
        <child-card
          :before-close="beforeClose"
          v-model="value"
          v-model:open="open"
          data-kind="demo"
        ></child-card>
        <child-card :missing-prop="missing"></child-card>
      \`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics).toContain('Prop "missingProp" is not declared on <child-card>.');
    expect(diagnostics.some((item) => item.includes("beforeClose"))).toBe(false);
    expect(diagnostics.some((item) => item.includes("modelValue"))).toBe(false);
    expect(diagnostics.some((item) => item.includes("dataKind"))).toBe(false);
    expect(diagnostics.some((item) => item.includes("not registered"))).toBe(false);
  });

  it("reports non-writable v-model targets and readonly props", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.props({ title: String });
      Demo.setup(() => ({
        form: { value: "" },
        save() {},
        value: ""
      }));
      Demo.template(\`
        <input v-model="value" />
        <input v-model="form.value" />
        <input v-model="title" />
        <input v-model="save()" />
      \`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics).toContain('v-model target "title" is a prop and cannot be assigned.');
    expect(diagnostics).toContain('v-model target "save()" is not writable.');
    expect(diagnostics.some((item) => item.includes('"value" is not writable'))).toBe(false);
    expect(diagnostics.some((item) => item.includes('"form.value" is not writable'))).toBe(false);
  });

  it("uses workspace component metadata for prop, event and slot diagnostics", () => {
    const source = `
      import { ElfUI } from "elfui";
      import { ImportedButton } from "./ImportedButton";

      const Demo = ElfUI.createComponent();
      Demo.use({ PrimaryButton: ImportedButton });
      Demo.setup(() => ({
        label: "Save",
        open: true,
        save() {}
      }));
      Demo.template(\`
        <PrimaryButton
          :label="label"
          :missing="label"
          v-model:open="open"
          v-model:ghost="open"
          @submit="save"
          @cancel="save"
          @click="save"
        >
          <template #item="{ row }">{{ row.label }}</template>
          <template #ghost></template>
        </PrimaryButton>
      \`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(
      createElfDiagnostics(document, {
        project: {
          components: [
            {
              emits: ["submit"],
              exportName: "ImportedButton",
              importPath: "./ImportedButton",
              localName: "ImportedButton",
              props: ["label", "modelValue", "open"],
              slots: ["item"],
              tagName: "elf-imported-button"
            }
          ]
        }
      })
    );

    expect(diagnostics).toContain('Prop "missing" is not declared on <PrimaryButton>.');
    expect(diagnostics).toContain('Prop "ghost" is not declared on <PrimaryButton>.');
    expect(diagnostics).toContain('Event "cancel" is not declared on <PrimaryButton>.');
    expect(diagnostics).toContain('Slot "ghost" is not declared on <PrimaryButton>.');
    expect(diagnostics.some((item) => item.includes('Prop "label"'))).toBe(false);
    expect(diagnostics.some((item) => item.includes('Prop "open"'))).toBe(false);
    expect(diagnostics.some((item) => item.includes('Event "submit"'))).toBe(false);
    expect(diagnostics.some((item) => item.includes('Event "click"'))).toBe(false);
    expect(diagnostics.some((item) => item.includes('Slot "item"'))).toBe(false);
  });

  it("collects v-memo expressions for template variable diagnostics", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.setup(() => ({ deps: [1] }));
      Demo.template(\`
        <section v-memo="[deps]">{{ deps }}</section>
        <section v-memo="[missingDeps]"></section>
      \`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics).toContain('Unknown template variable "missingDeps".');
    expect(diagnostics.some((item) => item.includes('"deps"'))).toBe(false);
  });

  it("provides definitions for template identifiers", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.props({ disabled: Boolean });
      Demo.setup(() => ({ count: 0 }));
      Demo.template(\`<button :disabled="disabled">{{ count }}</button>\`);
    `;
    const document = createDocument(source);
    const definitions = createElfDefinition(document, positionAfter(document, source, "{{ count"));

    expect(definitions).toHaveLength(1);
    expect(definitions[0] ? readRange(document, definitions[0].range) : "").toBe("count");
  });

  it("provides definitions for workspace component tags, props, events and slots", () => {
    const source = `
      import { ElfUI } from "elfui";
      import { ImportedButton } from "./ImportedButton";

      const Demo = ElfUI.createComponent();
      Demo.use({ PrimaryButton: ImportedButton });
      Demo.setup(() => ({ label: "Save", save() {} }));
      Demo.template(\`
        <PrimaryButton :label="label" @submit="save">
          <template #item="{ row }">{{ row.label }}</template>
        </PrimaryButton>
      \`);
    `;
    const document = createDocument(source);
    const project = {
      components: [
        {
          definition: {
            end: { character: 33, line: 1 },
            start: { character: 20, line: 1 }
          },
          emits: ["submit"],
          exportName: "ImportedButton",
          importPath: "./ImportedButton",
          localName: "ImportedButton",
          props: ["label"],
          slots: ["item"],
          symbols: [
            {
              kind: "component" as const,
              name: "ImportedButton",
              range: {
                end: { character: 33, line: 1 },
                start: { character: 20, line: 1 }
              }
            },
            {
              kind: "prop" as const,
              name: "label",
              range: {
                end: { character: 9, line: 4 },
                start: { character: 4, line: 4 }
              }
            },
            {
              kind: "emit" as const,
              name: "submit",
              range: {
                end: { character: 10, line: 5 },
                start: { character: 4, line: 5 }
              }
            },
            {
              kind: "slot" as const,
              name: "item",
              range: {
                end: { character: 8, line: 6 },
                start: { character: 4, line: 6 }
              }
            }
          ],
          tagName: "elf-imported-button",
          uri: "file:///ImportedButton.ts"
        }
      ]
    };
    const tagDefinition = createElfDefinition(
      document,
      positionAfter(document, source, "<PrimaryButton"),
      { project }
    )[0];
    const propDefinition = createElfDefinition(
      document,
      positionAfter(document, source, ":label"),
      { project }
    )[0];
    const eventDefinition = createElfDefinition(
      document,
      positionAfter(document, source, "@submit"),
      { project }
    )[0];
    const slotDefinition = createElfDefinition(document, positionAfter(document, source, "#item"), {
      project
    })[0];

    expect(tagDefinition?.uri).toBe("file:///ImportedButton.ts");
    expect(tagDefinition?.range.start.line).toBe(1);
    expect(propDefinition?.range.start.line).toBe(4);
    expect(eventDefinition?.range.start.line).toBe(5);
    expect(slotDefinition?.range.start.line).toBe(6);
  });

  it("provides references and current-file rename edits for workspace component usage", () => {
    const source = `
      import { ElfUI } from "elfui";
      import { ImportedButton } from "./ImportedButton";

      const Demo = ElfUI.createComponent();
      Demo.use({ PrimaryButton: ImportedButton });
      Demo.setup(() => ({ label: "Save", save() {} }));
      Demo.template(\`
        <PrimaryButton :label="label" @submit="save"></PrimaryButton>
        <PrimaryButton :label="label"></PrimaryButton>
      \`);
    `;
    const document = createDocument(source);
    const project = {
      components: [
        {
          definition: {
            end: { character: 33, line: 1 },
            start: { character: 20, line: 1 }
          },
          emits: ["submit"],
          exportName: "ImportedButton",
          importPath: "./ImportedButton",
          localName: "ImportedButton",
          props: ["label"],
          slots: [],
          symbols: [
            {
              kind: "component" as const,
              name: "ImportedButton",
              range: {
                end: { character: 33, line: 1 },
                start: { character: 20, line: 1 }
              }
            },
            {
              kind: "prop" as const,
              name: "label",
              range: {
                end: { character: 9, line: 4 },
                start: { character: 4, line: 4 }
              }
            },
            {
              kind: "emit" as const,
              name: "submit",
              range: {
                end: { character: 10, line: 5 },
                start: { character: 4, line: 5 }
              }
            }
          ],
          tagName: "elf-imported-button",
          uri: "file:///ImportedButton.ts"
        }
      ]
    };
    const tagReferences = createElfReferences(
      document,
      positionAfter(document, source, "<PrimaryButton"),
      { project }
    );
    const propReferences = createElfReferences(
      document,
      positionAfter(document, source, ":label"),
      { project }
    );
    const eventReferences = createElfReferences(
      document,
      positionAfter(document, source, "@submit"),
      { project }
    );
    const prepare = createElfPrepareRename(
      document,
      positionAfter(document, source, "<PrimaryButton"),
      { project }
    );
    const tagRename = createElfRenameEdit(
      document,
      positionAfter(document, source, "<PrimaryButton"),
      "SecondaryButton",
      { project }
    );
    const propRename = createElfRenameEdit(
      document,
      positionAfter(document, source, ":label"),
      "title",
      { project }
    );
    const directSource = source
      .replace("Demo.use({ PrimaryButton: ImportedButton });", "Demo.use({ ImportedButton });")
      .replaceAll("PrimaryButton", "ImportedButton");
    const directDocument = createDocument(directSource);
    const directRename = createElfRenameEdit(
      directDocument,
      positionAfter(directDocument, directSource, "<ImportedButton"),
      "RenamedButton",
      { project }
    );
    const tagFormatted = applyTextEdits(source, tagRename?.changes?.[document.uri] ?? []);
    const propFormatted = applyTextEdits(source, propRename?.changes?.[document.uri] ?? []);

    expect(tagReferences.filter((item) => item.uri === "file:///ImportedButton.ts")).toHaveLength(
      1
    );
    expect(tagReferences.filter((item) => item.uri === document.uri)).toHaveLength(4);
    expect(propReferences.filter((item) => item.uri === document.uri)).toHaveLength(2);
    expect(eventReferences.filter((item) => item.uri === document.uri)).toHaveLength(1);
    expect(prepare?.placeholder).toBe("PrimaryButton");
    expect(tagFormatted).toContain(
      '<SecondaryButton :label="label" @submit="save"></SecondaryButton>'
    );
    expect(tagFormatted).toContain('<SecondaryButton :label="label"></SecondaryButton>');
    expect(propFormatted).toContain(':title="label" @submit="save"');
    expect(propFormatted).toContain('<PrimaryButton :title="label"></PrimaryButton>');
    expect(Object.keys(tagRename?.changes ?? {})).toEqual([document.uri]);
    expect(directRename?.changes?.["file:///ImportedButton.ts"]?.[0]?.newText).toBe(
      "RenamedButton"
    );
  });

  it("provides document symbols for components, declarations and embedded regions", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.props({ disabled: Boolean });
      Demo.emits(["submit"]);
      Demo.setup(() => ({ count: 0 }));
      Demo.template(\`<button>{{ count }}</button>\`);
      Demo.style(\`:host { color: red; }\`);
    `;
    const document = createDocument(source);
    const symbols = createElfDocumentSymbols(document);
    const demo = symbols.find((item) => item.name === "Demo");
    const childNames = demo?.children?.map((item) => item.name) ?? [];

    expect(demo?.detail).toBe("ElfUI chain component");
    expect(childNames).toContain("disabled");
    expect(childNames).toContain("submit");
    expect(childNames).toContain("count");
    expect(childNames).toContain("template");
    expect(childNames).toContain("style");
  });

  it("provides document links for imports, template assets and style URLs", () => {
    const source = `
      import Icon from "./Icon";
      export { Badge } from "./Badge";
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`<img src="./assets/logo.svg"><a href="https://example.com/docs"></a>\`);
      Demo.style(\`:host { background-image: url("./assets/bg.png"); }\`);
    `;
    const document = createDocument(source);
    const links = createElfDocumentLinks(document);
    const linkTexts = links.map((item) => readRange(document, item.range));

    expect(linkTexts).toContain("./Icon");
    expect(linkTexts).toContain("./Badge");
    expect(linkTexts).toContain("./assets/logo.svg");
    expect(linkTexts).toContain("https://example.com/docs");
    expect(linkTexts).toContain("./assets/bg.png");
    expect(links.find((item) => readRange(document, item.range) === "./Icon")?.target).toContain(
      "/Icon"
    );
    expect(
      links.find((item) => readRange(document, item.range) === "https://example.com/docs")?.target
    ).toBe("https://example.com/docs");
  });

  it("provides references and rename edits for same-file template symbols", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.setup(() => ({ count: 0 }));
      Demo.template(\`<button :title="count">{{ count }}</button>\`);
    `;
    const document = createDocument(source);
    const position = positionAfter(document, source, "{{ count");
    const references = createElfReferences(document, position);
    const prepare = createElfPrepareRename(document, position);
    const edit = createElfRenameEdit(document, position, "total");
    const formatted = applyTextEdits(source, edit?.changes?.[document.uri] ?? []);

    expect(references.map((item) => readRange(document, item.range))).toEqual([
      "count",
      "count",
      "count"
    ]);
    expect(prepare?.placeholder).toBe("count");
    expect(formatted).toContain("Demo.setup(() => ({ total: 0 }))");
    expect(formatted).toContain('<button :title="total">{{ total }}</button>');
  });

  it("provides document highlights for same-file template symbols", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.setup(() => ({ count: 0 }));
      Demo.template(\`<button :title="count">{{ count }}</button>\`);
    `;
    const document = createDocument(source);
    const highlights = createElfDocumentHighlights(
      document,
      positionAfter(document, source, "{{ count")
    );

    expect(highlights.map((item) => readRange(document, item.range))).toEqual([
      "count",
      "count",
      "count"
    ]);
  });

  it("provides document highlights for workspace component usages", () => {
    const source = `
      import { ElfUI } from "elfui";
      import { ImportedButton } from "./ImportedButton";

      const Demo = ElfUI.createComponent();
      Demo.use({ PrimaryButton: ImportedButton });
      Demo.setup(() => ({ label: "Save", save() {} }));
      Demo.template(\`
        <PrimaryButton :label="label" @submit="save"></PrimaryButton>
        <PrimaryButton :label="label"></PrimaryButton>
      \`);
    `;
    const document = createDocument(source);
    const project = {
      components: [
        {
          emits: ["submit"],
          exportName: "ImportedButton",
          importPath: "./ImportedButton",
          localName: "ImportedButton",
          props: ["label"],
          slots: [],
          tagName: "elf-imported-button",
          uri: "file:///ImportedButton.ts"
        }
      ]
    };
    const tagHighlights = createElfDocumentHighlights(
      document,
      positionAfter(document, source, "<PrimaryButton"),
      { project }
    );
    const propHighlights = createElfDocumentHighlights(
      document,
      positionAfter(document, source, ":label"),
      { project }
    );

    expect(tagHighlights.map((item) => readRange(document, item.range))).toEqual([
      "PrimaryButton",
      "PrimaryButton",
      "PrimaryButton",
      "PrimaryButton"
    ]);
    expect(propHighlights.map((item) => readRange(document, item.range))).toEqual([
      "label",
      "label"
    ]);
  });

  it("provides folding ranges for embedded template and style regions", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`
        <section>
          <div>
            <span>Hi</span>
          </div>
        </section>
      \`);
      Demo.style(\`
        :host {
          color: red;
        }
      \`);
    `;
    const document = createDocument(source);
    const lines = source.split(/\r?\n/);
    const ranges = createElfFoldingRanges(document);

    expect(
      ranges.some(
        (range) => lines[range.startLine]?.includes("<section") && range.endLine > range.startLine
      )
    ).toBe(true);
    expect(
      ranges.some(
        (range) => lines[range.startLine]?.includes(":host") && range.endLine > range.startLine
      )
    ).toBe(true);
  });

  it("provides selection ranges inside embedded template and style regions", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`<button :title="count">Save</button>\`);
      Demo.style(\`:host { color: red; }\`);
    `;
    const document = createDocument(source);
    const [tagSelection] = createElfSelectionRanges(document, [
      positionAfter(document, source, "<button")
    ]);
    const [styleSelection] = createElfSelectionRanges(document, [
      positionAfter(document, source, "color")
    ]);

    expect(
      tagSelection
        ? readSelectionRangeTexts(document, tagSelection).some((text) => text.startsWith("button"))
        : false
    ).toBe(true);
    expect(styleSelection ? readSelectionRangeTexts(document, styleSelection) : []).toContain(
      "color"
    );
  });

  it("provides linked editing ranges for embedded template tag pairs", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`<section><button>Save</button></section>\`);
    `;
    const document = createDocument(source);
    const linked = createElfLinkedEditingRanges(
      document,
      positionAfter(document, source, "<button")
    );

    expect(linked?.ranges.map((range) => readRange(document, range))).toEqual(["button", "button"]);
  });

  it("provides inlay hints for prop, event and slot bindings", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.props({ disabled: Boolean });
      Demo.emits(["submit"]);
      Demo.slot("footer");
      Demo.template(\`<button :disabled="disabled" @submit="emit('submit')" #footer></button>\`);
    `;
    const document = createDocument(source);
    const labels = createElfInlayHints(document).map((item) => item.label);

    expect(labels).toContain("prop");
    expect(labels).toContain("event");
    expect(labels).toContain("slot");
  });

  it("anchors shorthand slot hints after the complete slot attribute", () => {
    const source = `
      import { defineHtml, html } from "@elfui/core";

      export default defineHtml(html\`<template #header></template>\`);
    `;
    const document = createDocument(source);
    const hint = createElfInlayHints(document).find((item) => item.label === "slot");

    expect(hint).toBeDefined();
    expect(document.offsetAt(hint!.position)).toBe(source.indexOf("#header") + "#header".length);
  });

  it("does not render hints at a tag fallback position when an attribute cannot be located", () => {
    const source = `
      import { defineHtml, html } from "@elfui/core";

      export default defineHtml(html\`<button @click=\${onClick} :aria-selected=\${isSelected()}></button>\`);
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

  it("provides semantic tokens for ElfUI declarations and template usages", () => {
    const source = `
      import { ElfUI } from "elfui";
      import Icon from "./Icon";

      const Demo = ElfUI.createComponent();
      Demo.props({ disabled: Boolean });
      Demo.emits(["submit"]);
      Demo.slot("footer");
      Demo.use({ LocalIcon: Icon });
      Demo.setup(() => ({ count: 0 }));
      Demo.template(\`
        <LocalIcon v-if="count" :disabled="disabled" @submit="emit('submit')" #footer>
          {{ count }}
        </LocalIcon>
      \`);
    `;
    const document = createDocument(source);
    const entries = readSemanticTokenEntries(document, createElfSemanticTokens(document));

    expect(entries).toContainEqual(
      expect.objectContaining({ modifiers: ["declaration"], text: "disabled", type: "property" })
    );
    expect(entries).toContainEqual(
      expect.objectContaining({ modifiers: ["declaration"], text: "LocalIcon", type: "class" })
    );
    expect(entries).toContainEqual(expect.objectContaining({ text: "v-if", type: "keyword" }));
    expect(entries).toContainEqual(expect.objectContaining({ text: "disabled", type: "property" }));
    expect(entries).toContainEqual(expect.objectContaining({ text: "submit", type: "event" }));
    expect(entries).toContainEqual(expect.objectContaining({ text: "footer", type: "interface" }));
    expect(entries).toContainEqual(expect.objectContaining({ text: "count", type: "variable" }));
  });

  it("provides quick fixes for quoted and expression binding styles", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`<button :disabled="disabled" @click=\${save}></button>\`);
    `;
    const document = createDocument(source);
    const quotedActions = createElfCodeActions(
      document,
      {
        end: positionAfter(document, source, ':disabled="disabled"'),
        start: positionAfter(document, source, ":disabled")
      },
      { diagnostics: [] }
    );
    const expressionActions = createElfCodeActions(
      document,
      {
        end: positionAfter(document, source, "@click=${save}"),
        start: positionAfter(document, source, "@click")
      },
      { diagnostics: [] }
    );
    const quotedEdit = quotedActions[0]?.edit?.changes?.[document.uri]?.[0];
    const expressionEdit = expressionActions[0]?.edit?.changes?.[document.uri]?.[0];

    expect(quotedActions.map((item) => item.title)).toContain(
      "Convert to ElfUI expression binding"
    );
    expect(quotedEdit?.newText).toBe(":disabled=${disabled}");
    expect(expressionActions.map((item) => item.title)).toContain(
      "Convert to quoted ElfUI binding"
    );
    expect(expressionEdit?.newText).toBe('@click="save"');
  });

  it("provides quick fixes for unknown template variables", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.setup(() => ({ count: 0 }));
      Demo.template(\`{{ count }} {{ missingValue }}\`);
    `;
    const document = createDocument(source);
    const diagnostic = createElfDiagnostics(document).find((item) =>
      readDiagnosticMessages([item]).some((message) => message.includes("missingValue"))
    );
    const actions = createElfCodeActions(document, diagnostic!.range, {
      diagnostics: [diagnostic!]
    });
    const setupAction = actions.find((item) => item.title === 'Expose "missingValue" from setup()');
    const propAction = actions.find((item) => item.title === 'Declare prop "missingValue"');
    const setupTexts =
      setupAction?.edit?.changes?.[document.uri]?.map((item) => item.newText) ?? [];
    const propTexts = propAction?.edit?.changes?.[document.uri]?.map((item) => item.newText) ?? [];

    expect(setupAction).toBeDefined();
    expect(propAction).toBeDefined();
    expect(setupTexts).toContain(", missingValue: undefined");
    expect(propTexts).toContain("\nDemo.props({ missingValue: undefined });");
  });

  it("creates useRef state quick fixes for macro missing template names", () => {
    const source = `
      import { defineHtml, html } from "elfui";

      export default defineHtml(html\`<h1>{{ 标题 }}</h1>\`);
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
    expect(formatted).toContain('import { defineHtml, html, useRef } from "elfui";');
    expect(formatted).toContain("const 标题 = useRef();");
  });

  it("creates handler quick fixes for macro missing event handlers", () => {
    const source = `
      import { defineHtml, html } from "elfui";

      export default defineHtml(html\`<button @blur=\${handler}></button>\`);
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

  it("adds useRef to the existing @elfui/core import", () => {
    const source = `
      import { defineHtml, html } from "@elfui/core";

      export default defineHtml(html\`<h1>{{ title }}</h1>\`);
    `;
    const document = createDocument(source);
    const diagnostic = createElfDiagnostics(document).find((item) =>
      readDiagnosticMessages([item]).some((message) => message.includes("title"))
    );
    const action = createElfCodeActions(document, diagnostic!.range, {
      diagnostics: [diagnostic!]
    }).find((item) => item.title === 'Create state "title" with useRef()');
    const formatted = applyTextEdits(source, action?.edit?.changes?.[document.uri] ?? []);

    expect(formatted).toContain('import { defineHtml, html, useRef } from "@elfui/core";');
    expect(formatted).not.toContain('from "elfui"');
  });

  it("creates all missing macro states before event handlers", () => {
    const source = `
      import { defineHtml, html } from "elfui";

      export default defineHtml(html\`
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
    expect(formatted).toContain('import { defineHtml, html, useRef } from "elfui";');
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

  it("creates all missing chain states before event handlers", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.setup(() => ({ existing: true }));
      Demo.template(\`<button @blur=\${onBlur}>{{ title }}</button>\`);
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
    expect(formatted).toContain('import { ElfUI, useRef } from "elfui";');
    expect(formatted).toContain("title: useRef()");
    expect(formatted).toContain("onBlur: (e: Event) => {}");
    expect(formatted.indexOf("title: useRef()")).toBeLessThan(
      formatted.indexOf("onBlur: (e: Event) => {}")
    );
  });

  it("provides quick fixes for undeclared template emits", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.emits(["submit"]);
      Demo.template(\`<button @click="emit('cancel')"></button>\`);
    `;
    const document = createDocument(source);
    const diagnostic = createElfDiagnostics(document).find((item) =>
      readDiagnosticMessages([item]).some((message) => message.includes('"cancel"'))
    );
    const actions = createElfCodeActions(document, diagnostic!.range, {
      diagnostics: [diagnostic!]
    });
    const action = actions.find((item) => item.title === 'Declare emit "cancel"');
    const editTexts = action?.edit?.changes?.[document.uri]?.map((item) => item.newText) ?? [];

    expect(action).toBeDefined();
    expect(editTexts).toContain(', "cancel"');
  });

  it("provides quick fixes for same-file component prop, event and slot declarations", () => {
    const source = `
      import { ElfUI } from "elfui";

      const ChildCard = ElfUI.createComponent();
      ChildCard.props({ title: String });
      ChildCard.emits(["submit"]);
      ChildCard.slot("item");
      ChildCard.template(\`<article></article>\`);

      const Demo = ElfUI.createComponent();
      Demo.use({ ChildCard });
      Demo.setup(() => ({ save() {}, value: "x" }));
      Demo.template(\`
        <ChildCard :missing="value" @cancel="save">
          <template #ghost></template>
        </ChildCard>
      \`);
    `;
    const document = createDocument(source);
    const diagnostics = createElfDiagnostics(document);
    const actions = diagnostics.flatMap((diagnostic) =>
      createElfCodeActions(document, diagnostic.range, { diagnostics: [diagnostic] })
    );
    const titles = actions.map((item) => item.title);
    const editTexts = actions.flatMap(
      (item) => item.edit?.changes?.[document.uri]?.map((edit) => edit.newText) ?? []
    );

    expect(titles).toContain('Declare prop "missing" on <ChildCard>');
    expect(titles).toContain('Declare emit "cancel" on <ChildCard>');
    expect(titles).toContain('Declare slot "ghost" on <ChildCard>');
    expect(editTexts).toContain(", missing: undefined");
    expect(editTexts).toContain(', "cancel"');
    expect(editTexts).toContain('\nChildCard.slot("ghost");');
  });

  it("completes workspace components with auto import edits in chain templates", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`<Imported\`);
    `;
    const document = createDocument(source);
    const completion = createElfCompletionList(
      document,
      positionAfter(document, source, "<Imported"),
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
    ).items.find((item) => item.label === "ImportedButton");
    const additionalText = completion?.additionalTextEdits?.map((item) => item.newText) ?? [];

    expect(readCompletionNewText(completion!)).toBe("ImportedButton>$0</ImportedButton>");
    expect(additionalText).toContain('import { ImportedButton } from "./ImportedButton";\n');
    expect(additionalText).toContain("\nDemo.use({ ImportedButton });");
  });

  it("provides auto import quick fixes for unregistered workspace components", () => {
    const source = `
      import { defineHtml, html } from "elfui";

      export const Demo = defineHtml(html\`
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

  it("suggests state and events in template expressions", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.state({ count: 0 });
      Demo.events({ handleClick() {} });
      Demo.template(\`{{ \`);
    `;
    const document = createDocument(source);
    const labels = createElfCompletionList(
      document,
      positionAfter(document, source, "{{ ")
    ).items.map((item) => item.label);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(labels).toContain("count");
    expect(labels).toContain("handleClick");
    expect(diagnostics.some((item) => item.includes('"count"'))).toBe(false);
    expect(diagnostics.some((item) => item.includes('"handleClick"'))).toBe(false);
  });

  it("uses TypeScript virtual files for template member completions", () => {
    const source = `
      import { defineHtml, defineProps, html } from "elfui";

      interface Props {
        disabled?: boolean;
        label: string;
      }

      const props = defineProps<Props>();
      const user = {
        active: true,
        name: "Ada"
      };

      export const Demo = defineHtml(html\`
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

  it("shows individual macro prop types and defaults in template hover", () => {
    const source = `
      import { defineHtml, defineProps, html } from "elfui";

      interface Props {
        title?: string;
      }

      defineProps<Props>({ title: { type: String, default: "Hello" } });

      export default defineHtml(html\`<section :title=\${title}></section>\`);
    `;
    const document = createDocument(source);
    const hover = createElfHover(document, positionAfter(document, source, "${title"));
    const hoverText = readHoverText(hover);

    expect(hoverText).toContain("Type: `string | undefined`");
    expect(hoverText).toContain('Default: `"Hello"`');
  });

  it("uses DOM event types for $event member completions", () => {
    const source = `
      import { defineHtml, html } from "elfui";

      export const Demo = defineHtml(html\`
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
      import { defineHtml, defineProps, html } from "elfui";

      interface Item {
        id: number;
        label: string;
      }

      interface Props {
        items: Item[];
      }

      const props = defineProps<Props>();

      export const Demo = defineHtml(html\`
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
      import { defineHtml, html, useRef } from "elfui";

      const userList = useRef([
        { age: 35, name: "Ada" }
      ]);

      export const Home = defineHtml(html\`
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
      import { defineHtml, html, useRef } from "elfui";

      const userList = useRef([
        { age: 35, id: 1, name: "Ada" }
      ]);

      export const Home = defineHtml(html\`
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
      import { defineHtml, html, useRef } from "elfui";

      const userList = useRef([
        { age: 35, id: 1, name: "Ada" }
      ]);

      export const Home = defineHtml(html\`
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
      import { defineHtml, html, useRef } from "elfui";

      const userList = useRef();

      export const Home = defineHtml(html\`
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
      import { defineHtml, defineProps, html } from "elfui";

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

      export const Demo = defineHtml(html\`
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

  it("uses workspace slot scope types for template local member completions", () => {
    const source = `
      import { ElfUI } from "elfui";
      import { ImportedButton } from "./ImportedButton";

      const Demo = ElfUI.createComponent();
      Demo.use({ ImportedButton });
      Demo.template(\`
        <ImportedButton>
          <template v-slot:item="{ row }">{{ row.label }}</template>
        </ImportedButton>
      \`);
    `;
    const document = createDocument(source);
    const labels = createElfCompletionList(document, positionAfter(document, source, "{{ row."), {
      project: {
        components: [
          {
            exportName: "ImportedButton",
            importPath: "./ImportedButton",
            localName: "ImportedButton",
            slotScopes: [
              {
                name: "item",
                scopeType: "{ row: { id: number; label: string } }"
              }
            ],
            slots: ["item"],
            slotsType: "{ item: (scope: { row: { id: number; label: string } }) => unknown }"
          }
        ]
      }
    }).items.map((item) => item.label);

    expect(labels).toContain("id");
    expect(labels).toContain("label");
  });

  it("provides HTML completions in standalone template strings", () => {
    const source = "const str = `di`;";
    const document = createDocument(source);
    const completion = createElfCompletionList(
      document,
      positionAfter(document, source, "di")
    ).items.find((item) => item.label === "div");

    expect(readCompletionNewText(completion!)).toBe("<div>$0</div>");
  });

  it("provides CSS completions in standalone css strings", () => {
    const source = "const css = `:host { col }`;";
    const document = createDocument(source);
    const labels = createElfCompletionList(
      document,
      positionAfter(document, source, "col")
    ).items.map((item) => item.label);

    expect(labels).toContain("color");
    expect(labels).toContain(":host");
  });

  it("suggests form control context for form controls", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.formControl();
      Demo.template(\`<input :value="\`);
    `;
    const document = createDocument(source);
    const labels = createElfCompletionList(
      document,
      positionAfter(document, source, '<input :value="')
    ).items.map((item) => item.label);

    expect(labels).toContain("form.valid");
    expect(labels).toContain("ctx.form");
  });

  it("uses the CSS language service for style completions and diagnostics", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.style(\`:host { col }\`);
    `;
    const document = createDocument(source);
    const labels = createElfCompletionList(
      document,
      positionAfter(document, source, "col")
    ).items.map((item) => item.label);

    expect(labels).toContain("color");
    expect(labels).toContain(":host");
    expect(labels).toContain("var(--*)");
  });

  it("uses the CSS language service for globalStyle completions", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.globalStyle(\`:root { col }\`);
    `;
    const document = createDocument(source);
    const labels = createElfCompletionList(
      document,
      positionAfter(document, source, "col")
    ).items.map((item) => item.label);

    expect(labels).toContain("color");
    expect(labels).toContain(":host");
    expect(labels).toContain("var(--*)");
  });

  it("provides ElfUI Web Components style completions from template metadata", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`
        <button part="control icon"></button>
        <slot></slot>
        <slot name="prefix"></slot>
      \`);
      Demo.style(\`
        :host {
          --elf-accent: red;
        }

        ::pa
      \`);
    `;
    const document = createDocument(source);
    const labels = createElfCompletionList(
      document,
      positionAfter(document, source, "::pa")
    ).items.map((item) => item.label);

    expect(labels).toContain(":host-context()");
    expect(labels).toContain("::slotted()");
    expect(labels).toContain("::part(control)");
    expect(labels).toContain("::part(icon)");
    expect(labels).toContain('[part~="control"]');
    expect(labels).toContain("::slotted(*)");
    expect(labels).toContain('::slotted([slot="prefix"])');
    expect(labels).toContain("[part]");
    expect(labels).toContain("[slot]");
    expect(labels).toContain("--custom-property");
    expect(labels).toContain("var(--elf-accent)");
  });

  it("provides ElfUI Web Components style hover help", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.style(\`
        :host-context(.dark) {
          --elf-accent: red;
          color: var(--elf-accent);
        }

        ::part(control) {
          color: red;
        }

        ::slotted([slot="prefix"]) {
          color: blue;
        }

        [part~="control"] {
          display: block;
        }
      \`);
    `;
    const document = createDocument(source);

    expect(
      readHoverText(createElfHover(document, positionAfter(document, source, ":host-context")))
    ).toContain("`:host-context()`");
    expect(
      readHoverText(createElfHover(document, positionAfter(document, source, "::part")))
    ).toContain("`::part()`");
    expect(
      readHoverText(createElfHover(document, positionAfter(document, source, "::slotted")))
    ).toContain("`::slotted()`");
    expect(
      readHoverText(createElfHover(document, positionAfter(document, source, "[part")))
    ).toContain("`[part]`");
    expect(
      readHoverText(createElfHover(document, positionAfter(document, source, "var(--elf-accent")))
    ).toContain("CSS custom property reference");
  });

  it("reports CSS diagnostics and maps style colors", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.style(\`
        :host {
          unknown-prop: 1;
          color: #ff0000;
        }
      \`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));
    const colors = createElfDocumentColors(document);

    expect(diagnostics.some((item) => item.includes("Unknown property"))).toBe(true);
    expect(colors).toHaveLength(1);
    expect(readRange(document, colors[0]!.range)).toBe("#ff0000");
    expect(
      createElfColorPresentations(document, colors[0]!.color, colors[0]!.range).some(
        (item) => item.label === "rgb(255, 0, 0)"
      )
    ).toBe(true);
  });

  it("formats template and style strings", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`<section>
<button>{{ count }}</button>
</section>\`);
      Demo.style(\`:host{color:red;display:block;}\`);
    `;
    const document = createDocument(source);
    const formatted = applyTextEdits(
      source,
      createElfFormattingEdits(document, {
        insertSpaces: true,
        tabSize: 2
      })
    );

    expect(formatted).toContain(
      "Demo.template(`\n        <section>\n          <button>{{ count }}</button>\n        </section>"
    );
    expect(formatted).toContain(
      "Demo.style(`\n        :host {\n          color: red;\n          display: block;\n        }"
    );
  });

  it("indents every formatted embedded line with tabSize", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`<section>
<button>{{ count }}</button>
</section>\`);
    `;
    const document = createDocument(source);
    const formatted = applyTextEdits(
      source,
      createElfFormattingEdits(document, {
        insertSpaces: true,
        tabSize: 4
      })
    );

    expect(formatted).toContain(
      "Demo.template(`\n          <section>\n              <button>{{ count }}</button>\n          </section>"
    );
  });

  it("passes wrapLineLength to embedded HTML formatting", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`<section><button class="primary raised wide" data-state="active" aria-label="Submit the current form">Submit</button></section>\`);
    `;
    const document = createDocument(source);
    const formatted = applyTextEdits(
      source,
      createElfFormattingEdits(document, {
        insertSpaces: true,
        tabSize: 2,
        wrapLineLength: 40
      })
    );

    expect(formatted).toContain('\n            class="primary raised wide"');
  });

  it("keeps expression-bound object attributes intact while formatting templates", () => {
    const source = `
      import { defineHtml, html } from "@elfui/core";

      const View = defineHtml(html\`<button
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

  it("formats only the selected embedded range", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`<section>
<button>{{ count }}</button>
</section>\`);
      Demo.style(\`:host{color:red;}\`);
    `;
    const document = createDocument(source);
    const formatted = applyTextEdits(
      source,
      createElfRangeFormattingEdits(
        document,
        {
          end: positionAfter(document, source, "</section>"),
          start: document.positionAt(source.indexOf("<section>"))
        },
        {
          insertSpaces: true,
          tabSize: 2
        }
      )
    );

    expect(formatted).toContain("<section>\n  <button>{{ count }}</button>\n</section>");
    expect(formatted).toContain("Demo.style(`:host{color:red;}`)");
  });

  it("treats scoped slot declarations as template locals", () => {
    const source = `
      import { ElfUI } from "elfui";

      const Demo = ElfUI.createComponent();
      Demo.template(\`
        <template #default="{ row }">
          {{ row.label }}
        </template>
      \`);
    `;
    const document = createDocument(source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));
    const labels = createElfCompletionList(
      document,
      positionAfter(document, source, "{{ row")
    ).items.map((item) => item.label);

    expect(diagnostics.some((item) => item.includes('"row"'))).toBe(false);
    expect(labels).toContain("row");
  });

  it("reports macro template TypeScript diagnostics", () => {
    const source = `
      /// <!--@elf component-->
      import { defineHtml, defineProps, html } from "elfui";

      interface Props {
        disabled: boolean;
      }

      const props = defineProps<Props>();

      export default defineHtml(html\`
        <button :disabled=\${props.disabeld}></button>
      \`);
    `;
    const document = TextDocument.create("file:///Demo.elf.ts", "typescript", 0, source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics.some((item) => item.includes("disabeld"))).toBe(true);
  });

  it("does not report valid macro handlers and exposed props as missing", () => {
    const source = `
      import { defineHtml, defineProps, html } from "elfui";

      interface Props {
        title: string;
      }

      const props = defineProps<Props>();
      const toggleTheme = () => props.title;

      export default defineHtml<Props>(html\`
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
      import { defineHtml, html } from "elfui";

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

      export const Menu = defineHtml(html\`
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
      import { defineHtml, html } from "elfui";

      const props = { separator: "/" };
      const visibleItems = () => [
        { current: true, disabled: false, ellipsis: false, key: "home", label: "Home", last: false }
      ];
      const onItemClick = (item: { key: string }, event: MouseEvent) => {
        item.key;
        event.preventDefault();
      };

      export const Breadcrumb = defineHtml(html\`
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
      import { defineHtml, html, useRef } from "elfui";

      const hoveredIndex = useRef("");
      const getHoveredChildren = () => [];
      const findItem = (index: string) => ({ index });
      const popperClass = (name: string, item: { index: string }) => [name, item.index];

      export const Menu = defineHtml(html\`
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
      import { defineHtml, html } from "elfui";

      const item = { id: "home" };

      export const Menu = defineHtml(html\`<div :class=\${item.value}></div>\`);
    `;
    const document = TextDocument.create("file:///Menu.ts", "typescript", 0, source);
    const diagnostics = readDiagnosticMessages(createElfDiagnostics(document));

    expect(diagnostics.some((item) => item.includes("Property 'value' does not exist"))).toBe(true);
  });

  it("provides macro local component completions and hover metadata", () => {
    const source = `
      /// <!--@elf component-->
      import { defineHtml, html, useComponents } from "elfui";
      import { LocalIcon } from "./LocalIcon";

      useComponents({ LocalIcon });

      export default defineHtml(html\`
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
      import { defineHtml, html, useComponents } from "elfui";
      import { PackageButton } from "@acme/elfui-kit";

      const onConfirm = () => {};
      const visible = true;
      useComponents({ PackageButton });

      export default defineHtml(html\`
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
});
