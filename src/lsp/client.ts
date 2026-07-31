import path from "node:path";
import { performance } from "node:perf_hooks";
import * as vscode from "vscode";
import {
  LanguageClient,
  RevealOutputChannelOn,
  State,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions
} from "vscode-languageclient/node";

import { BoundedLatencyRecorder, type LatencyDistribution } from "../shared/performance";
import { resolveAttributeWrapping, type ElfAttributeWrapping } from "./formatting";

const supportedLanguages = ["typescript", "typescriptreact", "javascript", "javascriptreact"];
type ElfDocumentFormattingOptions = vscode.FormattingOptions & {
  bracketSameLine?: boolean;
  wrapAttributes?: ElfAttributeWrapping;
  wrapLineLength?: number;
};
const clientFeaturePerformance = {
  codeAction: new BoundedLatencyRecorder(),
  completion: new BoundedLatencyRecorder(),
  formatting: new BoundedLatencyRecorder()
};

export interface LanguageClientPerformanceSummary {
  codeAction: LatencyDistribution;
  completion: LatencyDistribution;
  formatting: LatencyDistribution;
}

export const resolveDocumentFormattingOptions = (
  document: vscode.TextDocument,
  options: vscode.FormattingOptions
): ElfDocumentFormattingOptions => {
  const elfuiFormatting = vscode.workspace.getConfiguration(
    "elfui.languageFeatures.formatting",
    document.uri
  );
  const prettier = vscode.workspace.getConfiguration("prettier", document.uri);
  const elfuiPrintWidth = elfuiFormatting.get<number | null>("printWidth");
  const prettierPrintWidth = prettier.get<number>("printWidth");
  const editorWordWrapColumn = vscode.workspace
    .getConfiguration("editor", document.uri)
    .get<number>("wordWrapColumn");
  const wrapLineLength = [
    elfuiPrintWidth,
    prettierPrintWidth,
    editorWordWrapColumn
  ].find(isValidPrintWidth);
  const configuredAttributeWrapping = elfuiFormatting.get<string | null>("wrapAttributes");
  const wrapAttributes = resolveAttributeWrapping(
    configuredAttributeWrapping,
    prettier.get<boolean>("singleAttributePerLine", false)
  );
  const bracketSameLine = prettier.get<boolean>("bracketSameLine", false);

  return {
    ...options,
    bracketSameLine,
    ...(wrapAttributes ? { wrapAttributes } : {}),
    ...(wrapLineLength === undefined
      ? {}
      : { wrapLineLength: Math.round(wrapLineLength) })
  };
};

export const readLanguageClientPerformanceSummary = (): LanguageClientPerformanceSummary => ({
  codeAction: clientFeaturePerformance.codeAction.summary(),
  completion: clientFeaturePerformance.completion.summary(),
  formatting: clientFeaturePerformance.formatting.summary()
});

export const resetLanguageClientPerformance = (): void => {
  Object.values(clientFeaturePerformance).forEach((recorder) => recorder.reset());
};

export const startElfLanguageClient = async (
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel
): Promise<LanguageClient | undefined> => {
  const configuration = vscode.workspace.getConfiguration("elfui.languageFeatures");

  if (!configuration.get("enabled", true)) {
    outputChannel.appendLine("ElfUI language features are disabled.");

    return undefined;
  }

  const serverModule = context.asAbsolutePath(path.join("dist", "lsp-server.js"));
  const serverOptions: ServerOptions = {
    debug: {
      module: serverModule,
      options: {
        execArgv: ["--nolazy", "--inspect=6009"]
      },
      transport: TransportKind.ipc
    },
    run: {
      module: serverModule,
      transport: TransportKind.ipc
    }
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: supportedLanguages.flatMap((language) => [
      { language, scheme: "file" },
      { language, scheme: "untitled" }
    ]),
    initializationOptions: {
      activeDocumentUri: vscode.window.activeTextEditor?.document.uri.toString(),
      activeDocumentTracking: true,
      elfui: {
        languageFeatures: {
          completion: {
            eventBindingStyle: configuration.get("completion.eventBindingStyle", "expression"),
            templateBindingStyle: configuration.get("completion.templateBindingStyle", "expression")
          },
          semanticTokens: {
            enabled: configuration.get("semanticTokens.enabled", false)
          },
          workspace: {
            indexDebounceMs: configuration.get("workspace.indexDebounceMs", 250),
            maxScanFiles: configuration.get("workspace.maxScanFiles", 10000),
            perfLogging: configuration.get("workspace.perfLogging", false)
          }
        }
      }
    },
    middleware: {
      provideCodeActions: (document, range, actionContext, token, next) =>
        measureClientFeature("codeAction", () =>
          next(document, range, actionContext, token)
        ),
      provideCompletionItem: (document, position, completionContext, token, next) =>
        measureClientFeature("completion", () =>
          next(document, position, completionContext, token)
        ),
      provideDocumentFormattingEdits: (document, options, token, next) =>
        measureClientFeature("formatting", () =>
          next(document, resolveDocumentFormattingOptions(document, options), token)
        ),
      provideDocumentRangeFormattingEdits: (document, range, options, token, next) =>
        measureClientFeature("formatting", () =>
          next(document, range, resolveDocumentFormattingOptions(document, options), token)
        ),
      provideDocumentRangesFormattingEdits: (document, ranges, options, token, next) =>
        measureClientFeature("formatting", () =>
          next(document, ranges, resolveDocumentFormattingOptions(document, options), token)
        ),
      provideOnTypeFormattingEdits: (document, position, character, options, token, next) =>
        measureClientFeature("formatting", () =>
          next(
            document,
            position,
            character,
            resolveDocumentFormattingOptions(document, options),
            token
          )
        )
    },
    outputChannel,
    revealOutputChannelOn: RevealOutputChannelOn.Never,
    synchronize: {
      configurationSection: "elfui",
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{ts,tsx,js,jsx,json}")
    }
  };
  const client = new LanguageClient(
    "elfui-language-server",
    "ElfUI Language Server",
    serverOptions,
    clientOptions
  );

  outputChannel.appendLine(`Starting ElfUI language server: ${serverModule}`);
  await client.start();
  outputChannel.appendLine("ElfUI language server is ready.");

  return client;
};

const measureClientFeature = async <Result>(
  feature: keyof typeof clientFeaturePerformance,
  callback: () => vscode.ProviderResult<Result>
): Promise<Result | null | undefined> => {
  const started = performance.now();

  try {
    return await callback();
  } finally {
    clientFeaturePerformance[feature].record(performance.now() - started);
  }
};

const isValidPrintWidth = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 20;

export const stopElfLanguageClient = async (
  client: LanguageClient | undefined,
  outputChannel: vscode.OutputChannel
) => {
  if (!client) {
    return;
  }

  if (client.state !== State.Running) {
    outputChannel.appendLine(
      `ElfUI language server stop skipped: client state is ${client.state}.`
    );

    return;
  }

  try {
    await client.stop();
    outputChannel.appendLine("ElfUI language server stopped.");
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);

    outputChannel.appendLine(`ElfUI language server stop failed: ${message}`);
  }
};
