import * as vscode from "vscode";

const supportedLanguages = ["typescript", "typescriptreact", "javascript", "javascriptreact"];

const macroCompletions = [
  completion("defineHtml", "defineHtml(`…`)", "defineHtml(`${1:<main>$0</main>}`)"),
  completion("defineStyle", "defineStyle(`…`)", "defineStyle(`${1::host { display: block; }}$0`)"),
  completion(
    "defineFragment",
    "Create a typed local Fragment",
    "defineFragment<${1:Props}>((props) => `${2:<div>$0</div>}`)"
  ),
  completion("fragment", "Create an inline Fragment", "fragment`${1:<div>$0</div>}`"),
  completion("useRef", "Create reactive state", "useRef(${1:initialValue})"),
  completion("useTemplateRef", "Create a typed template ref", "useTemplateRef<${1:HTMLElement}>(\"${2:element}\")"),
  completion("useComputed", "Create derived state", "useComputed(() => ${1:value})"),
  completion("useId", "Create a stable component ID", "useId(\"${1:elf}\")"),
  completion("onMounted", "Run after the component template mounts", "onMounted(() => {\n  $0\n})"),
  completion("onUnmounted", "Run before the component unmounts", "onUnmounted(() => {\n  $0\n})"),
  completion("createApp", "Mount an ElfUI application", "createApp(${1:App}).mount(\"#app\")")
];

const templateCompletions = [
  completion("v-if", "Conditional rendering", "v-if=\\${${1:condition}}"),
  completion("v-for", "List rendering", "v-for=\\${${1:item} of ${2:items}}"),
  completion("v-model", "Two-way form binding", "v-model=\\${${1:value}}"),
  completion("v-show", "Toggle visibility", "v-show=\\${${1:visible}}"),
  completion("@click", "Click listener", "@click=\\${${1:handler}}"),
  completion("@mouseover", "Mouse over listener", "@mouseover=\\${${1:handler}}"),
  completion(":class", "Dynamic class", ":class=\\${${1:classes}}"),
  completion(":style", "Dynamic style", ":style=\\${${1:styles}}")
];

function completion(label: string, detail: string, insertText: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
  item.detail = detail;
  item.insertText = new vscode.SnippetString(insertText);
  item.sortText = `0-${label}`;
  return item;
}

const hasElfTemplate = (document: vscode.TextDocument, position?: vscode.Position) => {
  const source = document.getText(
    position ? new vscode.Range(new vscode.Position(0, 0), position) : undefined
  );
  const matches = [
    ...source.matchAll(/\b(?:defineHtml\s*(?:<[^`]*?>\s*)?\(\s*|fragment\s*)`/g)
  ];
  const match = matches.at(-1);
  const openingBacktick = match ? match.index + match[0].lastIndexOf("`") : -1;

  return openingBacktick >= 0 && source.lastIndexOf("`") === openingBacktick;
};

const isSupportedDocument = (document: vscode.TextDocument) =>
  supportedLanguages.includes(document.languageId);

const createWebTemplateCompletions = (
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.CompletionItem[] => {
  const source = document.getText();
  const offset = document.offsetAt(position);
  const eventMatch = /(?:^|\s)(@[\w:-]*)$/.exec(source.slice(0, offset));

  if (!eventMatch?.[1]) {
    return templateCompletions;
  }

  const nameRemainder = /^[\w:-]*/.exec(source.slice(offset))?.[0] ?? "";
  const afterName = source.slice(offset + nameRemainder.length);
  const hasExistingValue = /^(?:\.[\w-]+)*\s*=/.test(afterName);
  const range = new vscode.Range(
    document.positionAt(offset - eventMatch[1].length),
    document.positionAt(offset + nameRemainder.length),
  );

  return templateCompletions.map((item) => {
    const label = typeof item.label === "string" ? item.label : item.label.label;

    if (!label.startsWith("@")) {
      return item;
    }

    const completionItem = new vscode.CompletionItem(label, item.kind);
    completionItem.detail = item.detail;
    completionItem.insertText = hasExistingValue
      ? new vscode.SnippetString(label)
      : item.insertText;
    completionItem.range = range;
    completionItem.sortText = item.sortText;
    return completionItem;
  });
};

export const activate = (context: vscode.ExtensionContext) => {
  const output = vscode.window.createOutputChannel("ElfUI");
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = "$(symbol-key) ElfUI Web";
  status.tooltip = "ElfUI web editor assistance is active";

  const updateStatus = (editor = vscode.window.activeTextEditor) => {
    if (editor && isSupportedDocument(editor.document)) {
      status.show();
    } else {
      status.hide();
    }
  };

  const provider = vscode.languages.registerCompletionItemProvider(
    supportedLanguages,
    {
      provideCompletionItems(document, position) {
        if (!hasElfTemplate(document) && !/\b(?:defineFragment|defineHtml|defineStyle|fragment|useRef|useTemplateRef|useComputed|useId|onMounted|onUnmounted|createApp)\w*$/.test(
          document.lineAt(position.line).text.slice(0, position.character)
        )) {
          return undefined;
        }

        return hasElfTemplate(document, position)
          ? createWebTemplateCompletions(document, position)
          : macroCompletions;
      }
    },
    "@",
    ":",
    "v"
  );

  const hover = vscode.languages.registerHoverProvider(supportedLanguages, {
    provideHover(document, position) {
      if (!hasElfTemplate(document, position)) return undefined;
      const word = document.getText(document.getWordRangeAtPosition(position));
      if (!word || !["v", "click", "class", "style", "model", "show", "for", "if"].includes(word)) {
        return undefined;
      }

      return new vscode.Hover(
        new vscode.MarkdownString("ElfUI template directive. Use expression bindings such as `@click=${handler}`.")
      );
    }
  });

  const diagnose = vscode.commands.registerCommand("elfui.diagnoseIntegration", () => {
    const message = [
      "ElfUI Web editor assistance is active.",
      "Macro and directive completions, snippets, and TextMate grammar run in the browser.",
      "The Node language server and TypeScript server plugin remain desktop VS Code features."
    ].join("\n");
    output.appendLine(message);
    output.show(true);
    void vscode.window.showInformationMessage("ElfUI Web assistance is active. See the ElfUI output channel for details.");
  });

  const showOutput = vscode.commands.registerCommand("elfui.showOutputChannel", () => output.show(true));
  const unsupported = [
    "elfui.restartLanguageServer",
    "elfui.showComponentStructure",
    "elfui.showDynamicPoints",
    "elfui.previewComponent",
    "elfui.migrateTemplateBindings",
    "elfui.showWorkspaceIndexReport",
    "elfui.exportWorkspacePerformanceReport",
    "elfui.clearWorkspacePerformanceHistory",
    "elfui.generateWorkspaceComponentMetadata",
    "elfui.injectMissingTemplateDeclaration"
  ].map((command) => vscode.commands.registerCommand(command, () =>
    vscode.window.showInformationMessage("This ElfUI command requires the desktop VS Code language server.")
  ));

  context.subscriptions.push(output, status, provider, hover, diagnose, showOutput, ...unsupported);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatus));
  updateStatus();
  output.appendLine("ElfUI Web editor assistance activated.");
};

export const deactivate = () => undefined;
