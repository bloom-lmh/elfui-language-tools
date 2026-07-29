import * as vscode from "vscode";
import {
  createWebApiCompletions,
  createWebTemplateCompletions
} from "./web/completion";

const supportedLanguages = ["typescript", "typescriptreact", "javascript", "javascriptreact"];

const completion = (
  label: string,
  detail: string,
  insertText: string
): vscode.CompletionItem => {
  const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
  item.detail = detail;
  item.insertText = new vscode.SnippetString(insertText);
  item.sortText = `0-${label}`;
  return item;
};

const hasElfTemplate = (document: vscode.TextDocument, position?: vscode.Position) => {
  const source = document.getText(
    position ? new vscode.Range(new vscode.Position(0, 0), position) : undefined
  );
  const matches = [...source.matchAll(/\bdefineHtml\s*(?:<[^`]*?>\s*)?\(\s*`/g)];
  const match = matches.at(-1);
  const openingBacktick = match ? match.index + match[0].lastIndexOf("`") : -1;

  return openingBacktick >= 0 && source.lastIndexOf("`") === openingBacktick;
};

const isSupportedDocument = (document: vscode.TextDocument) =>
  supportedLanguages.includes(document.languageId);

const createTemplateCompletionItems = (
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.CompletionItem[] => {
  const source = document.getText();
  const offset = document.offsetAt(position);
  const result = createWebTemplateCompletions(source, offset);
  const range = new vscode.Range(
    document.positionAt(result.replaceStart),
    document.positionAt(result.replaceEnd)
  );

  return result.entries.map((entry) => {
    const item = completion(entry.label, entry.detail, entry.insertText);
    item.range = range;
    return item;
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
        const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
        const apiCompletions = createWebApiCompletions(linePrefix);

        if (!hasElfTemplate(document) && apiCompletions.length === 0) {
          return undefined;
        }

        return hasElfTemplate(document, position)
          ? createTemplateCompletionItems(document, position)
          : apiCompletions.map((item) =>
              completion(item.label, item.detail, item.insertText)
            );
      }
    },
    "<",
    " ",
    "@",
    ":",
    "#",
    ".",
    "-",
    "v"
  );

  const hover = vscode.languages.registerHoverProvider(supportedLanguages, {
    provideHover(document, position) {
      if (!hasElfTemplate(document, position)) return undefined;
      const line = document.lineAt(position.line);
      const offset = position.character;
      const token =
        /(?:v-[\w-]+|@[\w:-]+|:[\w:-]+|#[\w-]+)/g;
      const match = [...line.text.matchAll(token)].find(
        (item) =>
          item.index !== undefined &&
          offset >= item.index &&
          offset <= item.index + item[0].length
      );

      if (!match) return undefined;

      return new vscode.Hover(
        new vscode.MarkdownString(
          `ElfUI template syntax \`${match[0]}\`. Dynamic values use expression bindings such as \`@click=\${handler}\`.`
        )
      );
    }
  });

  const diagnose = vscode.commands.registerCommand("elfui.diagnoseIntegration", () => {
    const message = [
      "ElfUI Web editor assistance is active.",
      "Beta.17 API, directive, modifier, built-in component completions, snippets, and TextMate grammar run in the browser.",
      "The Node language server, workspace index, and TypeScript server plugin remain desktop VS Code features."
    ].join("\n");
    output.appendLine(message);
    output.show(true);
    void vscode.window.showInformationMessage(
      "ElfUI Web assistance is active. See the ElfUI output channel for details."
    );
  });

  const showOutput = vscode.commands.registerCommand(
    "elfui.showOutputChannel",
    () => output.show(true)
  );
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
  ].map((command) =>
    vscode.commands.registerCommand(command, () =>
      vscode.window.showInformationMessage(
        "This ElfUI command requires the desktop VS Code language server."
      )
    )
  );

  context.subscriptions.push(
    output,
    status,
    provider,
    hover,
    diagnose,
    showOutput,
    ...unsupported
  );
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatus));
  updateStatus();
  output.appendLine("ElfUI Web editor assistance activated.");
};

export const deactivate = () => undefined;
