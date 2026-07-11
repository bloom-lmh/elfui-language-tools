import path from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient,
  RevealOutputChannelOn,
  State,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions
} from "vscode-languageclient/node";

const supportedLanguages = ["typescript", "typescriptreact", "javascript", "javascriptreact"];

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
            maxScanFiles: configuration.get("workspace.maxScanFiles", 1000),
            perfLogging: configuration.get("workspace.perfLogging", false)
          }
        }
      }
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
