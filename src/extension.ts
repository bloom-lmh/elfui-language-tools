import * as vscode from "vscode";
import { State, type LanguageClient } from "vscode-languageclient/node";

import path from "node:path";
import { performance } from "node:perf_hooks";
import { startElfLanguageClient, stopElfLanguageClient } from "./lsp/client";

let languageClient: LanguageClient | undefined;
let languageServerStartupMs: number | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let componentStructureProvider: ElfComponentStructureProvider | undefined;
let typeScriptPluginConfiguration: TypeScriptPluginConfiguration = {
  message: "TypeScript plugin configuration has not been requested yet.",
  state: "not-requested",
};

const typeScriptPluginId = "elfui-language-features-typescript-plugin";
const nativeMissingNameCodes = new Set([2304, 2552]);
const workspacePerformanceHistoryKey = "elfui.workspacePerformanceHistory";
const workspacePerformanceHistoryLimit = 20;

interface LanguageServerPerformanceSummary {
  completion: {
    averageDurationMs: number;
    count: number;
    maxDurationMs: number;
  };
  index: Array<{
    durationMs: number;
    filesIndexed: number;
    filesReused: number;
    filesScanned: number;
    reason: string;
    recordedAt: number;
    truncated: boolean;
  }>;
}

interface WorkspaceIndexReportSnapshot {
  components: number;
  durationMs: number;
  filesScanned: number;
  languageServer?: LanguageServerPerformanceSummary;
  languageServerStartupMs?: number;
  recordedAt: number;
  styles: number;
  templates: number;
  truncated: boolean;
}

interface WorkspaceIndexReport extends WorkspaceIndexReportSnapshot {
  history: WorkspaceIndexReportSnapshot[];
}

interface GeneratedComponentMetadata {
  emits: string[];
  exportName: "default" | string;
  fileName: string;
  localName: string;
  props: Array<string | { default?: boolean | null | number | string; name: string; type?: string }>;
  slotScopes: Array<{ name: string; scopeType: string }>;
  slots: string[];
  tagName?: string;
}

interface MetadataGenerationResult {
  components: number;
  manifestUpdated: boolean;
  metadataUri: string;
  metadataWritten: boolean;
  workspace: string;
}

interface TypeScriptPluginConfiguration {
  message: string;
  state: "configured" | "not-requested" | "unavailable" | "unsupported";
}

interface TypeScriptLanguageFeaturesApi {
  configurePlugin?: (pluginId: string, configuration: Record<string, unknown>) => void;
}

interface TypeScriptLanguageFeaturesExports {
  getAPI?: (version: number) => TypeScriptLanguageFeaturesApi | undefined;
}

interface ElfIntegrationReport {
  diagnostics: {
    bySource: Record<string, number>;
    nativeTemplateLocalFalsePositives: Array<{
      code: number | string;
      message: string;
      name: string;
      source: string;
    }>;
    total: number;
  };
  document: {
    componentCount: number;
    hasElfTemplate: boolean;
    languageId: string | null;
    templateRegions: Array<{
      endLine: number;
      startLine: number;
    }>;
    uri: string | null;
  };
  extension: {
    version: string;
  };
  languageServer: "disabled" | "running" | "starting" | "stopped";
  typeScriptPlugin: {
    configuration: TypeScriptPluginConfiguration;
    extensionActive: boolean;
    observableState:
      | "effective"
      | "likely-not-active"
      | "not-observable"
      | "not-supported";
    suppressionEnabled: boolean;
  };
}

const componentTagColorScopes = [
  "support.class.component.elfui",
  "entity.name.tag.component.elfui",
  "punctuation.definition.tag.elfui",
];

const componentTagColorRule = {
  name: "ElfUI component tag color",
  scope: componentTagColorScopes,
  settings: {
    foreground: "#4FC1FF",
  },
};

export const activate = async (context: vscode.ExtensionContext) => {
  outputChannel = vscode.window.createOutputChannel("ElfUI");
  context.subscriptions.push(outputChannel);

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.command = "elfui.showOutputChannel";
  statusBarItem.tooltip = "ElfUI Language Server: click to show output";
  context.subscriptions.push(statusBarItem);
  setStatusBar("starting");

  outputChannel.appendLine("Activating ElfUI language features...");

  try {
    await applyComponentTagColor();
    componentStructureProvider = new ElfComponentStructureProvider();
    context.subscriptions.push(
      vscode.window.createTreeView("elfui.componentStructure", {
        showCollapseAll: true,
        treeDataProvider: componentStructureProvider,
      }),
    );
    const languageServerStarted = performance.now();
    languageClient = await startElfLanguageClient(context, outputChannel);
    languageServerStartupMs = languageClient ? performance.now() - languageServerStarted : undefined;
    await configureTypeScriptPlugin();
    setStatusBar(
      languageClient && languageClient.state === State.Running
        ? "ready"
        : "disabled",
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "elfui.restartLanguageServer",
        async () => {
          await restartLanguageClient(context);
        },
      ),
      vscode.commands.registerCommand("elfui.showOutputChannel", () => {
        outputChannel?.show(true);
      }),
      vscode.commands.registerCommand("elfui.diagnoseIntegration", async () => {
        await configureTypeScriptPlugin();

        return diagnoseIntegration(context);
      }),
      vscode.commands.registerCommand("elfui.showComponentStructure", () => {
        componentStructureProvider?.refresh();
        void vscode.commands.executeCommand("workbench.view.explorer");

        return readActiveStudioAnalysis()?.summary ?? null;
      }),
      vscode.commands.registerCommand("elfui.showDynamicPoints", () =>
        showDynamicPointReport(context),
      ),
      vscode.commands.registerCommand("elfui.previewComponent", () =>
        showComponentPreview(context),
      ),
      vscode.commands.registerCommand("elfui.migrateTemplateBindings", () =>
        migrateActiveTemplateBindings(),
      ),
      vscode.commands.registerCommand("elfui.showWorkspaceIndexReport", () =>
        showWorkspaceIndexReport(context),
      ),
      vscode.commands.registerCommand("elfui.exportWorkspacePerformanceReport", () =>
        exportWorkspacePerformanceReport(context),
      ),
      vscode.commands.registerCommand("elfui.clearWorkspacePerformanceHistory", () =>
        clearWorkspacePerformanceHistory(context),
      ),
      vscode.commands.registerCommand("elfui.generateWorkspaceComponentMetadata", () =>
        generateWorkspaceComponentMetadata(context),
      ),
      vscode.commands.registerCommand(
        "elfui.revealRange",
        async (uri: vscode.Uri, start: number, end: number) => {
          const document = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(document, {
            preview: false,
          });
          const range = new vscode.Range(
            document.positionAt(start),
            document.positionAt(end),
          );

          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        },
      ),
      vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (!event.affectsConfiguration("elfui.languageFeatures")) {
          return;
        }

        await applyComponentTagColor();
        await configureTypeScriptPlugin();
        await restartLanguageClient(context);
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        updateStatusBarVisibility(editor);
        componentStructureProvider?.refresh();
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          vscode.window.activeTextEditor?.document.uri.toString() ===
          event.document.uri.toString()
        ) {
          componentStructureProvider?.refresh();
        }
      }),
      new vscode.Disposable(() => {
        void stopElfLanguageClient(languageClient, outputChannel!);
      }),
    );

    updateStatusBarVisibility(vscode.window.activeTextEditor);
    outputChannel.appendLine("ElfUI language features activated.");
  } catch (error) {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);

    outputChannel.appendLine(`ElfUI activation failed: ${message}`);
    outputChannel.show(true);
    setStatusBar("error");
    void vscode.window.showErrorMessage(
      "ElfUI language features failed to activate. Open the 'ElfUI' output channel for details.",
    );
    throw error;
  }
};

export const deactivate = async () => {
  await stopElfLanguageClient(
    languageClient,
    outputChannel ?? vscode.window.createOutputChannel("ElfUI"),
  );
  languageClient = undefined;
};

const restartLanguageClient = async (context: vscode.ExtensionContext) => {
  if (!outputChannel) {
    return;
  }

  outputChannel.appendLine("Restarting ElfUI language server...");
  setStatusBar("starting");
  await stopElfLanguageClient(languageClient, outputChannel);
  languageClient = undefined;
  const languageServerStarted = performance.now();
  languageClient = await startElfLanguageClient(context, outputChannel);
  languageServerStartupMs = languageClient ? performance.now() - languageServerStarted : undefined;
  setStatusBar(
    languageClient && languageClient.state === State.Running
      ? "ready"
      : "disabled",
  );
};

const configureTypeScriptPlugin = async (): Promise<void> => {
  const suppressionEnabled = vscode.workspace
    .getConfiguration("elfui.languageFeatures")
    .get("diagnostics.suppressNativeTemplateLocals", true);
  const typeScriptExtension = vscode.extensions.getExtension<TypeScriptLanguageFeaturesExports>(
    "vscode.typescript-language-features",
  );

  if (!typeScriptExtension) {
    typeScriptPluginConfiguration = {
      message: "VS Code TypeScript Language Features extension was not found.",
      state: "unavailable",
    };
    outputChannel?.appendLine(`ElfUI TypeScript plugin: ${typeScriptPluginConfiguration.message}`);

    return;
  }

  try {
    const exports = await typeScriptExtension.activate();
    const api = exports?.getAPI?.(0);

    if (!api?.configurePlugin) {
      typeScriptPluginConfiguration = {
        message: "The installed TypeScript Language Features API cannot configure server plugins.",
        state: "unsupported",
      };
      outputChannel?.appendLine(`ElfUI TypeScript plugin: ${typeScriptPluginConfiguration.message}`);

      return;
    }

    api.configurePlugin(typeScriptPluginId, {
      suppressNativeTemplateLocals: suppressionEnabled,
    });
    typeScriptPluginConfiguration = {
      message: `Configured native template-local suppression: ${suppressionEnabled}.`,
      state: "configured",
    };
    outputChannel?.appendLine(`ElfUI TypeScript plugin: ${typeScriptPluginConfiguration.message}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    typeScriptPluginConfiguration = {
      message: `Could not configure the TypeScript server plugin: ${message}`,
      state: "unavailable",
    };
    outputChannel?.appendLine(`ElfUI TypeScript plugin: ${typeScriptPluginConfiguration.message}`);
  }
};

const diagnoseIntegration = (context: vscode.ExtensionContext): ElfIntegrationReport => {
  const document = vscode.window.activeTextEditor?.document;
  const analysis = readActiveStudioAnalysis();
  const templates = analysis?.components.flatMap((component) => component.templates) ?? [];
  const nativeTemplateLocalNames = new Set(
    templates.flatMap((template) => collectNativeTemplateLocalNames(template.content)),
  );
  const nativeTemplateLocalFalsePositives = document
    ? vscode.languages
        .getDiagnostics(document.uri)
        .flatMap((diagnostic) => {
          const offset = document.offsetAt(diagnostic.range.start);
          const name = document.getText(diagnostic.range);
          const diagnosticCode =
            typeof diagnostic.code === "object"
              ? diagnostic.code.value
              : diagnostic.code;
          const isInTemplate = templates.some(
            (template) => offset >= template.contentStart && offset < template.contentEnd,
          );

          if (
            !isInTemplate ||
            !nativeMissingNameCodes.has(Number(diagnosticCode)) ||
            diagnostic.source?.toLowerCase() === "elfui" ||
            !nativeTemplateLocalNames.has(name)
          ) {
            return [];
          }

          return [
            {
              code: diagnosticCode ?? "unknown",
              message: diagnostic.message,
              name,
              source: diagnostic.source ?? "TypeScript",
            },
          ];
        })
        .slice(0, 20)
    : [];
  const documentDiagnostics = document ? vscode.languages.getDiagnostics(document.uri) : [];
  const diagnosticSources = documentDiagnostics.reduce<Record<string, number>>(
    (result, diagnostic) => {
      const source = diagnostic.source || "unknown";
      result[source] = (result[source] ?? 0) + 1;
      return result;
    },
    {},
  );
  const languageServer = readLanguageServerState();
  const typeScriptExtension = vscode.extensions.getExtension(
    "vscode.typescript-language-features",
  );
  const suppressionEnabled = vscode.workspace
    .getConfiguration("elfui.languageFeatures")
    .get("diagnostics.suppressNativeTemplateLocals", true);
  const observableState =
    !document || !isSupportedLanguage(document.languageId) || templates.length === 0
      ? "not-supported"
      : nativeTemplateLocalFalsePositives.length > 0
        ? "likely-not-active"
        : nativeTemplateLocalNames.size > 0
          ? "effective"
          : "not-observable";
  const report: ElfIntegrationReport = {
    diagnostics: {
      bySource: diagnosticSources,
      nativeTemplateLocalFalsePositives,
      total: documentDiagnostics.length,
    },
    document: {
      componentCount: analysis?.components.length ?? 0,
      hasElfTemplate: templates.length > 0,
      languageId: document?.languageId ?? null,
      templateRegions: document
        ? templates.map((template) => ({
            endLine: document.positionAt(template.contentEnd).line + 1,
            startLine: document.positionAt(template.contentStart).line + 1,
          }))
        : [],
      uri: document?.uri.toString() ?? null,
    },
    extension: {
      version: String(context.extension.packageJSON.version ?? "unknown"),
    },
    languageServer,
    typeScriptPlugin: {
      configuration: typeScriptPluginConfiguration,
      extensionActive: typeScriptExtension?.isActive ?? false,
      observableState,
      suppressionEnabled,
    },
  };

  outputChannel?.appendLine("ElfUI integration diagnostic:");
  outputChannel?.appendLine(JSON.stringify(report, null, 2));

  return report;
};

const readLanguageServerState = (): ElfIntegrationReport["languageServer"] => {
  if (!languageClient) {
    return "disabled";
  }

  if (languageClient.state === State.Running) {
    return "running";
  }

  return languageClient.state === State.Starting ? "starting" : "stopped";
};

const collectNativeTemplateLocalNames = (template: string): string[] => {
  const names = new Set<string>();
  const vForPattern = /\sv-for\s*=\s*(["'])([\s\S]*?)\1/g;

  for (const match of template.matchAll(vForPattern)) {
    const localPart = /^([\s\S]+?)\s+in\s+[\s\S]+$/.exec(match[2] ?? "")?.[1];

    for (const name of localPart?.match(/[A-Za-z_$][\w$]*/g) ?? []) {
      names.add(name);
    }
  }

  if (/\s(?:@|v-on:)[\w:-]+(?:\.[\w-]+)*\s*=\s*\$\{[\s\S]*?\$event/.test(template)) {
    names.add("$event");
  }

  return [...names];
};

type StatusKind = "starting" | "ready" | "error" | "disabled";

const setStatusBar = (kind: StatusKind) => {
  if (!statusBarItem) {
    return;
  }

  switch (kind) {
    case "starting":
      statusBarItem.text = "$(sync~spin) ElfUI";
      statusBarItem.tooltip = "ElfUI Language Server: starting...";
      statusBarItem.backgroundColor = undefined;
      break;
    case "ready":
      statusBarItem.text = "$(check) ElfUI";
      statusBarItem.tooltip =
        "ElfUI Language Server: ready. Click to open output. Use 'ElfUI: Restart Language Server' to reload.";
      statusBarItem.backgroundColor = undefined;
      break;
    case "error":
      statusBarItem.text = "$(error) ElfUI";
      statusBarItem.tooltip =
        "ElfUI Language Server: failed. Click to open output.";
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground",
      );
      break;
    case "disabled":
      statusBarItem.text = "$(circle-slash) ElfUI";
      statusBarItem.tooltip =
        "ElfUI Language Server: disabled (set elfui.languageFeatures.enabled to true).";
      statusBarItem.backgroundColor = undefined;
      break;
  }
};

const updateStatusBarVisibility = (editor: vscode.TextEditor | undefined) => {
  if (!statusBarItem) {
    return;
  }

  if (editor && isSupportedLanguage(editor.document.languageId)) {
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
};

const applyComponentTagColor = async () => {
  const configuration = vscode.workspace.getConfiguration(
    "elfui.languageFeatures",
  );
  const color = configuration.get<string | null>(
    "componentTagColor",
    "#4FC1FF",
  );
  const workbenchConfiguration = vscode.workspace.getConfiguration("editor");
  const customizations = workbenchConfiguration.get<Record<string, unknown>>(
    "tokenColorCustomizations",
    {},
  );
  const rules = Array.isArray(customizations.textMateRules)
    ? customizations.textMateRules
    : [];
  const nextRules = rules.filter((rule) => !isElfComponentTagColorRule(rule));

  if (color) {
    nextRules.push({
      ...componentTagColorRule,
      settings: {
        foreground: color,
      },
    });
  }

  await workbenchConfiguration.update(
    "tokenColorCustomizations",
    {
      ...customizations,
      textMateRules: nextRules,
    },
    vscode.ConfigurationTarget.Global,
  );
};

const isElfComponentTagColorRule = (rule: unknown) => {
  if (typeof rule !== "object" || rule === null) {
    return false;
  }

  const candidate = rule as { name?: unknown; scope?: unknown };

  if (candidate.name === componentTagColorRule.name) {
    return true;
  }

  if (typeof candidate.scope === "string") {
    return componentTagColorScopes.includes(candidate.scope);
  }

  return (
    Array.isArray(candidate.scope) &&
    candidate.scope.some(
      (scope): scope is string =>
        typeof scope === "string" && componentTagColorScopes.includes(scope),
    )
  );
};

const isSupportedLanguage = (languageId: string) =>
  ["typescript", "typescriptreact", "javascript", "javascriptreact"].includes(languageId);

interface StudioAnalysis {
  components: StudioComponentMeta[];
  document: vscode.TextDocument;
  dynamicPoints: ElfDynamicPoint[];
  summary: {
    components: number;
    dynamicPoints: number;
    styles: number;
    templates: number;
  };
}

interface StudioComponentMeta {
  emits: string[];
  exportName?: string;
  id: string;
  localName?: string;
  macro: boolean;
  name: string | null;
  props: string[];
  setupReturns: string[];
  slots: string[];
  styles: StudioRegion[];
  symbols: StudioSymbol[];
  templates: StudioRegion[];
  uses: Array<{ localName: string }>;
}

interface StudioRegion {
  content: string;
  contentEnd: number;
  contentStart: number;
  kind: "style" | "template";
}

interface StudioSymbol {
  end: number;
  kind: "component";
  start: number;
}

interface ElfDynamicPoint {
  attribute?: string;
  effect: string;
  expression: string;
  kind: string;
  offset: number;
}

interface StructureNode {
  children?: StructureNode[];
  commandRange?: { end: number; start: number };
  description?: string;
  icon?: vscode.ThemeIcon;
  label: string;
}

class ElfComponentStructureProvider implements vscode.TreeDataProvider<StructureNode> {
  private readonly changeEmitter = new vscode.EventEmitter<StructureNode | undefined>();

  readonly onDidChangeTreeData = this.changeEmitter.event;

  refresh() {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(node: StructureNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.children?.length
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    if (node.description !== undefined) {
      item.description = node.description;
    }

    if (node.icon) {
      item.iconPath = node.icon;
    }

    const document = vscode.window.activeTextEditor?.document;

    if (document && node.commandRange) {
      item.command = {
        arguments: [
          document.uri,
          node.commandRange.start,
          node.commandRange.end,
        ],
        command: "elfui.revealRange",
        title: "Reveal",
      };
    }

    return item;
  }

  getChildren(node?: StructureNode): StructureNode[] {
    if (node) {
      return node.children ?? [];
    }

    const analysis = readActiveStudioAnalysis();

    if (!analysis) {
      return [
        {
          description: "Open a TS/JS file with ElfUI components",
          icon: new vscode.ThemeIcon("info"),
          label: "No active ElfUI component",
        },
      ];
    }

    return analysis.components.map((component) =>
      createComponentStructureNode(component, analysis.dynamicPoints),
    );
  }
}

const readActiveStudioAnalysis = (): StudioAnalysis | null => {
  const document = vscode.window.activeTextEditor?.document;

  if (!document || !isSupportedLanguage(document.languageId)) {
    return null;
  }

  const source = document.getText();
  const components = analyzeStudioSource(source);
  const dynamicPoints = components.flatMap((component) =>
    component.templates.flatMap((region) => collectDynamicPoints(region)),
  );

  return {
    components,
    document,
    dynamicPoints,
    summary: {
      components: components.length,
      dynamicPoints: dynamicPoints.length,
      styles: components.reduce(
        (count, component) => count + component.styles.length,
        0,
      ),
      templates: components.reduce(
        (count, component) => count + component.templates.length,
        0,
      ),
    },
  };
};

const analyzeStudioSource = (source: string): StudioComponentMeta[] => {
  const templates = [
    ...collectTemplateLiteralRegions(source, /\bdefineHtml\s*(?:<[^`]*?>\s*)?\(\s*`/g, "template"),
    ...collectTemplateLiteralRegions(source, /\.template\s*\(\s*`/g, "template"),
  ];
  const styles = [
    ...collectTemplateLiteralRegions(source, /\.(?:style|globalStyle)\s*\(\s*`/g, "style"),
    ...collectTemplateLiteralRegions(source, /\bdefineStyle\s*\(\s*`/g, "style"),
  ];

  if (templates.length === 0 && styles.length === 0) {
    return [];
  }

  const componentName = readStudioComponentName(source);
  const component: StudioComponentMeta = {
    emits: readStudioEmits(source),
    id: componentName ?? "elfui-component",
    macro: /\bdefineHtml\s*\(/.test(source),
    name: componentName,
    props: readStudioProps(source),
    setupReturns: readStudioSetupReturns(source),
    slots: readStudioSlots(source),
    styles,
    symbols: [],
    templates,
    uses: readStudioUses(source).map((localName) => ({ localName })),
  };

  if (componentName) {
    component.exportName = componentName;
    component.localName = componentName;

    const start = source.indexOf(componentName);

    if (start >= 0) {
      component.symbols.push({
        end: start + componentName.length,
        kind: "component",
        start,
      });
    }
  }

  return [component];
};

const collectTemplateLiteralRegions = (
  source: string,
  pattern: RegExp,
  kind: StudioRegion["kind"],
): StudioRegion[] => {
  const regions: StudioRegion[] = [];

  for (const match of source.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }

    const raw = match[0];
    const tickOffset = raw.lastIndexOf("`");

    if (tickOffset < 0) {
      continue;
    }

    const tickStart = match.index + tickOffset;
    const tickEnd = findTemplateLiteralEnd(source, tickStart);

    if (tickEnd === null) {
      continue;
    }

    regions.push({
      content: source.slice(tickStart + 1, tickEnd),
      contentEnd: tickEnd,
      contentStart: tickStart + 1,
      kind,
    });
  }

  return regions;
};

const findTemplateLiteralEnd = (source: string, tickStart: number): number | null => {
  let escaped = false;

  for (let index = tickStart + 1; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "`") {
      return index;
    }
  }

  return null;
};

const readStudioComponentName = (source: string): string | null =>
  /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*defineHtml\b/.exec(source)?.[1] ??
  /const\s+([A-Za-z_$][\w$]*)\s*=\s*defineHtml\b/.exec(source)?.[1] ??
  /const\s+([A-Za-z_$][\w$]*)\s*=\s*[\s\S]*?createComponent\s*\(/.exec(source)?.[1] ??
  null;

const readStudioProps = (source: string): string[] =>
  unique([
    ...extractTypeMemberNames(source, /defineProps\s*<([\s\S]*?)>\s*\(/g),
    ...extractObjectKeys(source, /\.props\s*\(\s*\{([\s\S]*?)\}\s*\)/g),
    ...[...source.matchAll(/defineModel\s*\(\s*(?:(["'])([\w-]+)\1)?/g)].map((match) =>
      match[2] ? normalizeModelPropName(match[2]) : "modelValue",
    ),
  ]);

const readStudioEmits = (source: string): string[] =>
  unique([
    ...extractTypeMemberNames(source, /defineEmits\s*<([\s\S]*?)>\s*\(/g),
    ...extractStringValues(source, /\.emits\s*\(\s*\[([\s\S]*?)\]\s*\)/g),
  ]);

const readStudioSlots = (source: string): string[] =>
  unique([
    ...extractTypeMemberNames(source, /defineSlots\s*<([\s\S]*?)>\s*\(/g),
    ...extractStringValues(source, /\.slot\s*\(\s*(["'])([\w:-]+)\1/g),
  ]);

const readStudioUses = (source: string): string[] =>
  unique([
    ...extractObjectKeys(source, /useComponents\s*\(\s*\{([\s\S]*?)\}\s*\)/g),
    ...extractObjectKeys(source, /\.use\s*\(\s*\{([\s\S]*?)\}\s*\)/g),
  ]);

const readStudioSetupReturns = (source: string): string[] => {
  const setupObject =
    /\.setup\s*\(\s*\(\s*\)\s*=>\s*\(\s*\{([\s\S]*?)\}\s*\)\s*\)/.exec(source)?.[1] ??
    /\.setup\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?return\s+\{([\s\S]*?)\}/.exec(source)?.[1] ??
    "";

  return unique([
    ...extractObjectKeysFromBody(setupObject),
    ...[...source.matchAll(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)].map(
      (match) => match[1] ?? "",
    ),
  ]).filter(Boolean);
};

const extractTypeMemberNames = (source: string, pattern: RegExp): string[] =>
  [...source.matchAll(pattern)].flatMap((match) =>
    match[1] ? [...match[1].matchAll(/([A-Za-z_$][\w$-]*)\??\s*:/g)].map((item) => item[1] ?? "") : [],
  );

const extractObjectKeys = (source: string, pattern: RegExp): string[] =>
  [...source.matchAll(pattern)].flatMap((match) =>
    match[1]
      ? extractObjectKeysFromBody(match[1])
      : [],
  );

const extractObjectKeysFromBody = (body: string): string[] =>
  [...body.matchAll(/(?:^|[,{\s])([A-Za-z_$][\w$-]*)\s*(?::|,|$)/g)].map(
    (item) => item[1] ?? "",
  );

const extractStringValues = (source: string, pattern: RegExp): string[] =>
  [...source.matchAll(pattern)].flatMap((match) => {
    if (match[2] && !match[1]?.includes(",")) {
      return [match[2]];
    }

    const body = match[1] ?? "";

    return [...body.matchAll(/(["'])([\w:-]+)\1/g)].map((item) => item[2] ?? "");
  });

const normalizeModelPropName = (name: string): string =>
  name === "model-value" ? "modelValue" : name;

const unique = (values: string[]): string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const createComponentStructureNode = (
  component: StudioComponentMeta,
  dynamicPoints: ElfDynamicPoint[],
): StructureNode => {
  const componentSymbol = component.symbols.find((item) => item.kind === "component");
  const componentDynamics = dynamicPoints.filter((point) =>
    component.templates.some(
      (region) =>
        point.offset >= region.contentStart && point.offset <= region.contentEnd,
    ),
  );
  const node: StructureNode = {
    children: [
      createListNode("Props", component.props, "symbol-property"),
      createListNode("Emits", component.emits, "radio-tower"),
      createListNode("Slots", component.slots, "symbol-namespace"),
      createListNode("Setup", component.setupReturns, "symbol-variable"),
      createListNode(
        "Local Components",
        component.uses.map((item) => item.localName),
        "symbol-class",
      ),
      createRegionNode("Templates", component.templates, "code"),
      createRegionNode("Styles", component.styles, "symbol-color"),
      createDynamicPointNode(componentDynamics),
    ],
    description: component.name ?? component.exportName ?? component.id,
    icon: new vscode.ThemeIcon(component.macro ? "symbol-interface" : "symbol-class"),
    label: component.localName ?? component.exportName ?? component.name ?? component.id,
  };

  if (componentSymbol) {
    node.commandRange = {
      end: componentSymbol.end,
      start: componentSymbol.start,
    };
  }

  return node;
};

const createListNode = (
  label: string,
  values: string[],
  icon: string,
): StructureNode => ({
  children: values.map((value) => ({
    icon: new vscode.ThemeIcon(icon),
    label: value,
  })),
  description: String(values.length),
  icon: new vscode.ThemeIcon(icon),
  label,
});

const createRegionNode = (
  label: string,
  regions: StudioRegion[],
  icon: string,
): StructureNode => ({
  children: regions.map((region, index) => ({
    commandRange: {
      end: region.contentEnd,
      start: region.contentStart,
    },
    description: `${region.content.split(/\r?\n/).length} lines`,
    icon: new vscode.ThemeIcon(icon),
    label: `${region.kind} #${index + 1}`,
  })),
  description: String(regions.length),
  icon: new vscode.ThemeIcon(icon),
  label,
});

const createDynamicPointNode = (points: ElfDynamicPoint[]): StructureNode => ({
  children: points.map((point) => ({
    commandRange: {
      end: point.offset + Math.max(point.expression.length, 1),
      start: point.offset,
    },
    description: point.effect,
    icon: new vscode.ThemeIcon(point.kind === "event" ? "zap" : "pulse"),
    label: point.attribute ? `${point.attribute}: ${point.expression}` : point.expression,
  })),
  description: String(points.length),
  icon: new vscode.ThemeIcon("pulse"),
  label: "Dynamic Points",
});

const showDynamicPointReport = (context: vscode.ExtensionContext) => {
  const analysis = readActiveStudioAnalysis();

  if (!analysis) {
    void vscode.window.showInformationMessage("Open an ElfUI TS/JS file first.");
    return null;
  }

  const panel = vscode.window.createWebviewPanel(
    "elfuiDynamicPoints",
    "ElfUI Dynamic Points",
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      localResourceRoots: [context.extensionUri],
    },
  );

  panel.webview.html = createDynamicPointReportHtml(analysis);

  return {
    ...analysis.summary,
    points: analysis.dynamicPoints.map(({ effect, expression, kind }) => ({
      effect,
      expression,
      kind,
    })),
  };
};

const showComponentPreview = (context: vscode.ExtensionContext) => {
  const analysis = readActiveStudioAnalysis();
  const component = analysis?.components.find((item) => item.templates.length > 0);
  const template = component?.templates[0];

  if (!analysis || !component || !template) {
    void vscode.window.showInformationMessage("Open an ElfUI component with a template first.");
    return null;
  }

  const panel = vscode.window.createWebviewPanel(
    "elfuiComponentPreview",
    "ElfUI Component Preview",
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      localResourceRoots: [context.extensionUri],
    },
  );
  const previewHtml = createComponentPreviewHtml(component, template);

  panel.webview.html = previewHtml;

  return {
    component: component.localName ?? component.exportName ?? component.name,
    htmlLength: previewHtml.length,
  };
};

const migrateActiveTemplateBindings = async (): Promise<number> => {
  const analysis = readActiveStudioAnalysis();

  if (!analysis) {
    void vscode.window.showInformationMessage("Open an ElfUI TS/JS file first.");
    return 0;
  }

  const edit = new vscode.WorkspaceEdit();
  let count = 0;

  analysis.components.forEach((component) => {
    component.templates.forEach((region) => {
      for (const migration of collectTemplateBindingMigrations(region)) {
        edit.replace(
          analysis.document.uri,
          new vscode.Range(
            analysis.document.positionAt(region.contentStart + migration.start),
            analysis.document.positionAt(region.contentStart + migration.end),
          ),
          migration.newText,
        );
        count += 1;
      }
    });
  });

  if (count === 0) {
    void vscode.window.showInformationMessage("No quoted ElfUI bindings need migration.");
    return 0;
  }

  await vscode.workspace.applyEdit(edit);
  void vscode.window.showInformationMessage(
    `Migrated ${count} ElfUI template binding${count === 1 ? "" : "s"}.`,
  );

  return count;
};

const generateWorkspaceComponentMetadata = async (
  context: vscode.ExtensionContext,
): Promise<MetadataGenerationResult[]> => {
  if (!languageClient || languageClient.state !== State.Running) {
    void vscode.window.showInformationMessage("Start the ElfUI language server before generating metadata.");

    return [];
  }

  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  if (workspaceFolders.length === 0) {
    void vscode.window.showInformationMessage("Open an ElfUI workspace before generating metadata.");

    return [];
  }

  let components: GeneratedComponentMetadata[];

  try {
    components = await languageClient.sendRequest<GeneratedComponentMetadata[]>(
      "elfui/getWorkspaceComponentMetadata",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    outputChannel?.appendLine(`ElfUI metadata generation failed: ${message}`);
    void vscode.window.showErrorMessage("ElfUI could not read workspace component metadata.");

    return [];
  }

  const results = await Promise.all(
    workspaceFolders.map((folder) => generateWorkspaceMetadataFile(folder, components)),
  );
  const generatedComponents = results.reduce((count, result) => count + result.components, 0);

  void vscode.window.showInformationMessage(
    `Generated ElfUI metadata for ${generatedComponents} component${generatedComponents === 1 ? "" : "s"}.`,
  );

  return results;
};

const generateWorkspaceMetadataFile = async (
  folder: vscode.WorkspaceFolder,
  components: GeneratedComponentMetadata[],
): Promise<MetadataGenerationResult> => {
  const packageUri = vscode.Uri.joinPath(folder.uri, "package.json");
  const packageJson = await readWorkspaceJson(packageUri);
  const declaredMetadataPath = readMetadataRelativePath(packageJson);
  const relativeMetadataPath = declaredMetadataPath ?? "elfui.components.json";
  const metadataUri = vscode.Uri.joinPath(folder.uri, ...relativeMetadataPath.split("/"));
  const localComponents = components
    .filter((component) => isFileInWorkspaceFolder(component.fileName, folder.uri.fsPath))
    .map(({ fileName: _fileName, ...component }) => component);
  const metadataWritten = await writeWorkspaceTextIfChanged(
    metadataUri,
    `${JSON.stringify({ components: localComponents }, null, 2)}\n`,
  );
  const nextPackageJson = packageJson && !declaredMetadataPath
    ? withMetadataDeclaration(packageJson, relativeMetadataPath)
    : null;
  const manifestUpdated = nextPackageJson
    ? await writeWorkspaceTextIfChanged(packageUri, `${JSON.stringify(nextPackageJson, null, 2)}\n`)
    : false;

  return {
    components: localComponents.length,
    manifestUpdated,
    metadataUri: metadataUri.toString(),
    metadataWritten,
    workspace: folder.uri.toString(),
  };
};

const readWorkspaceJson = async (uri: vscode.Uri): Promise<Record<string, unknown> | null> => {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));

    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
};

const readMetadataRelativePath = (packageJson: Record<string, unknown> | null): string | null => {
  if (!packageJson || !isRecord(packageJson.elfui) || !isRecord(packageJson.elfui.languageTools)) {
    return null;
  }

  const declaration = packageJson.elfui.languageTools.components;

  if (typeof declaration !== "string") {
    return null;
  }

  const normalized = declaration.replace(/\\/g, "/").replace(/^\.\//, "");

  return isSafeMetadataRelativePath(normalized) ? normalized : null;
};

const isSafeMetadataRelativePath = (value: string): boolean =>
  value.length > 0 &&
  value.toLowerCase().endsWith(".json") &&
  !path.isAbsolute(value) &&
  !value.split("/").some((segment) => !segment || segment === "." || segment === "..");

const withMetadataDeclaration = (
  packageJson: Record<string, unknown>,
  relativeMetadataPath: string,
): Record<string, unknown> => {
  const elfui = isRecord(packageJson.elfui) ? packageJson.elfui : {};
  const languageTools = isRecord(elfui.languageTools) ? elfui.languageTools : {};

  return {
    ...packageJson,
    elfui: {
      ...elfui,
      languageTools: {
        ...languageTools,
        components: `./${relativeMetadataPath}`,
      },
    },
  };
};

const isFileInWorkspaceFolder = (fileName: string, workspacePath: string): boolean => {
  const relativePath = path.relative(workspacePath, fileName);

  return relativePath === "" || (!!relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

const writeWorkspaceTextIfChanged = async (uri: vscode.Uri, text: string): Promise<boolean> => {
  try {
    const current = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");

    if (current === text) {
      return false;
    }
  } catch {
    // The target is new or unreadable, so write the generated source below.
  }

  await vscode.workspace.fs.createDirectory(parentUri(uri));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, "utf8"));

  return true;
};

const parentUri = (uri: vscode.Uri): vscode.Uri => {
  const separator = uri.path.lastIndexOf("/");

  return uri.with({ path: separator > 0 ? uri.path.slice(0, separator) : "/" });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const exportWorkspacePerformanceReport = async (
  context: vscode.ExtensionContext,
): Promise<{ history: number; uri: string; wrote: boolean } | null> => {
  const folder = vscode.workspace.workspaceFolders?.[0];

  if (!folder) {
    void vscode.window.showInformationMessage("Open an ElfUI workspace before exporting performance data.");

    return null;
  }

  const history = readWorkspacePerformanceHistory(context);
  const uri = vscode.Uri.joinPath(folder.uri, ".elfui", "performance-report.json");
  const report = {
    exportedAt: new Date().toISOString(),
    languageServer: await requestLanguageServerPerformanceSummary(),
    languageServerStartupMs,
    reports: history,
    workspace: folder.uri.toString(),
  };
  const wrote = await writeWorkspaceTextIfChanged(uri, `${JSON.stringify(report, null, 2)}\n`);

  void vscode.window.showInformationMessage(
    `${wrote ? "Exported" : "Updated"} ElfUI performance report: ${uri.fsPath}`,
  );

  return { history: history.length, uri: uri.toString(), wrote };
};

const clearWorkspacePerformanceHistory = async (
  context: vscode.ExtensionContext,
): Promise<number> => {
  const history = readWorkspacePerformanceHistory(context);

  await context.workspaceState.update(workspacePerformanceHistoryKey, undefined);
  void vscode.window.showInformationMessage("Cleared ElfUI workspace performance history.");

  return history.length;
};

const showWorkspaceIndexReport = async (context: vscode.ExtensionContext) => {
  const started = performance.now();
  const maxScanFiles = vscode.workspace
    .getConfiguration("elfui.languageFeatures")
    .get("workspace.maxScanFiles", 1000);
  const files = await vscode.workspace.findFiles(
    "**/*.{ts,tsx,js,jsx}",
    "{**/node_modules/**,**/dist/**,**/.vscode-test/**}",
    maxScanFiles,
  );
  const analyses = await mapWithConcurrency(files, 8, async (uri) => {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);

      return analyzeStudioSource(Buffer.from(bytes).toString("utf8"));
    } catch (error) {
      outputChannel?.appendLine(
        `ElfUI workspace report skipped ${uri.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return [];
    }
  });
  const components = analyses.flat();
  const snapshot: WorkspaceIndexReportSnapshot = {
    components: components.length,
    durationMs: performance.now() - started,
    filesScanned: files.length,
    languageServer: await requestLanguageServerPerformanceSummary(),
    ...(languageServerStartupMs !== undefined ? { languageServerStartupMs } : {}),
    recordedAt: Date.now(),
    styles: components.reduce((count, component) => count + component.styles.length, 0),
    templates: components.reduce((count, component) => count + component.templates.length, 0),
    truncated: files.length >= maxScanFiles,
  };
  const history = [snapshot, ...readWorkspacePerformanceHistory(context)].slice(
    0,
    workspacePerformanceHistoryLimit,
  );

  await context.workspaceState.update(workspacePerformanceHistoryKey, history);

  const report: WorkspaceIndexReport = { ...snapshot, history };
  const panel = vscode.window.createWebviewPanel(
    "elfuiWorkspaceIndexReport",
    "ElfUI Workspace Index",
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      localResourceRoots: [context.extensionUri],
    },
  );

  panel.webview.html = createWorkspaceIndexReportHtml(report);

  return report;
};

const requestLanguageServerPerformanceSummary = async (): Promise<
  LanguageServerPerformanceSummary | undefined
> => {
  if (!languageClient || languageClient.state !== State.Running) {
    return undefined;
  }

  try {
    return await languageClient.sendRequest<LanguageServerPerformanceSummary>(
      "elfui/getPerformanceSummary",
    );
  } catch (error) {
    outputChannel?.appendLine(
      `ElfUI workspace report could not read language-server performance: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    return undefined;
  }
};

const readWorkspacePerformanceHistory = (
  context: vscode.ExtensionContext,
): WorkspaceIndexReportSnapshot[] => {
  const stored = context.workspaceState.get<unknown>(workspacePerformanceHistoryKey, []);

  return Array.isArray(stored) ? stored.filter(isWorkspaceIndexReportSnapshot) : [];
};

const isWorkspaceIndexReportSnapshot = (
  value: unknown,
): value is WorkspaceIndexReportSnapshot => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return [
    candidate.components,
    candidate.durationMs,
    candidate.filesScanned,
    candidate.recordedAt,
    candidate.styles,
    candidate.templates,
  ].every((item) => typeof item === "number" && Number.isFinite(item)) && typeof candidate.truncated === "boolean";
};

const mapWithConcurrency = async <Value, Result>(
  values: readonly Value[],
  concurrency: number,
  callback: (value: Value) => Promise<Result>,
): Promise<Result[]> => {
  const results = new Array<Result>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), values.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;

        nextIndex += 1;
        results[index] = await callback(values[index]!);
      }
    }),
  );

  return results;
};

const collectDynamicPoints = (region: StudioRegion): ElfDynamicPoint[] => {
  const points: ElfDynamicPoint[] = [];
  const content = region.content;
  const quotedBindingPattern =
    /\s((?::[\w:-]+|@[\w:-]+|v-(?:bind(?::[\w-]+)?|if|else-if|show|model|text|html|for|memo))(?:\.[\w-]+)*)\s*=\s*(["'])([\s\S]*?)\2/g;

  for (const match of content.matchAll(quotedBindingPattern)) {
    if (match.index === undefined || !match[1] || match[3] === undefined) {
      continue;
    }

    const valueStart = match.index + match[0].lastIndexOf(match[3]);

    points.push({
      attribute: match[1],
      effect: readEffectKind(match[1]),
      expression: match[3].trim(),
      kind: readDynamicPointKind(match[1]),
      offset: region.contentStart + valueStart,
    });
  }

  collectExpressionBindingPoints(content, region.contentStart, points);
  collectMustachePoints(content, region.contentStart, points);

  return points.sort((left, right) => left.offset - right.offset);
};

const collectExpressionBindingPoints = (
  content: string,
  contentStart: number,
  points: ElfDynamicPoint[],
) => {
  let cursor = 0;

  while (cursor < content.length) {
    const start = content.indexOf("${", cursor);

    if (start === -1) {
      return;
    }

    const end = findBalancedTemplateExpressionEnd(content, start);

    if (end === null) {
      cursor = start + 2;
      continue;
    }

    const attribute = readAttributeBeforeExpression(content, start);
    const expression = content.slice(start + 2, end).trim();

    const point: ElfDynamicPoint = {
      effect: attribute ? readEffectKind(attribute) : "text() effect",
      expression,
      kind: attribute ? readDynamicPointKind(attribute) : "text",
      offset: contentStart + start + 2,
    };

    if (attribute) {
      point.attribute = attribute;
    }

    points.push(point);

    cursor = end + 1;
  }
};

const collectMustachePoints = (
  content: string,
  contentStart: number,
  points: ElfDynamicPoint[],
) => {
  const pattern = /\{\{([\s\S]*?)\}\}/g;

  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined || match[1] === undefined) {
      continue;
    }

    points.push({
      effect: "text() effect",
      expression: match[1].trim(),
      kind: "text",
      offset: contentStart + match.index + 2,
    });
  }
};

const collectTemplateBindingMigrations = (
  region: StudioRegion,
): Array<{ end: number; newText: string; start: number }> => {
  const migrations: Array<{ end: number; newText: string; start: number }> = [];
  const pattern =
    /(\s(?:[:@][\w:-]+(?:\.[\w-]+)*|v-(?:bind(?::[\w-]+)?|if|else-if|show|model|text|html|memo)(?:\.[\w-]+)*)\s*=\s*)(["'])([\s\S]*?)\2/g;

  for (const match of region.content.matchAll(pattern)) {
    if (match.index === undefined || !match[1] || match[3] === undefined) {
      continue;
    }

    const value = match[3].trim();

    if (!value || value.startsWith("${")) {
      continue;
    }

    migrations.push({
      end: match.index + match[0].length,
      newText: `${match[1]}\${${value}}`,
      start: match.index,
    });
  }

  return migrations;
};

const readDynamicPointKind = (attribute: string): string => {
  if (attribute.startsWith("@") || attribute.startsWith("v-on:")) return "event";
  if (attribute === "v-for") return "list";
  if (attribute === "v-if" || attribute === "v-else-if") return "branch";
  if (attribute === "v-model") return "model";
  if (attribute === "v-show") return "show";
  if (attribute === ":class") return "class";
  if (attribute === ":style") return "style";
  if (attribute.startsWith(":") || attribute.startsWith("v-bind")) return "binding";

  return "directive";
};

const readEffectKind = (attribute: string): string => {
  const kind = readDynamicPointKind(attribute);

  switch (kind) {
    case "branch":
      return "branch() control effect";
    case "class":
      return "cls() effect";
    case "event":
      return "on() listener binding";
    case "list":
      return "list() keyed effect";
    case "model":
      return "model setter/listener pair";
    case "show":
      return "show() style effect";
    case "style":
      return "sty() effect";
    default:
      return "attr()/prop() effect";
  }
};

const readAttributeBeforeExpression = (content: string, expressionStart: number): string | null => {
  let cursor = expressionStart - 1;

  while (cursor >= 0 && /[ \t\r\n]/.test(content[cursor] ?? "")) {
    cursor -= 1;
  }

  if (content[cursor] !== "=") {
    return null;
  }

  cursor -= 1;

  while (cursor >= 0 && /[ \t\r\n]/.test(content[cursor] ?? "")) {
    cursor -= 1;
  }

  const end = cursor + 1;

  while (cursor >= 0 && /[^\s<>=]/.test(content[cursor] ?? "")) {
    cursor -= 1;
  }

  return content.slice(cursor + 1, end) || null;
};

const findBalancedTemplateExpressionEnd = (
  source: string,
  start: number,
): number | null => {
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;

  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];

    if (!char) {
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
};

const createDynamicPointReportHtml = (analysis: StudioAnalysis): string => {
  const rows = analysis.dynamicPoints
    .map(
      (point) => `
        <tr>
          <td>${escapeHtml(point.kind)}</td>
          <td>${escapeHtml(point.attribute ?? "text")}</td>
          <td><code>${escapeHtml(point.expression)}</code></td>
          <td>${escapeHtml(point.effect)}</td>
        </tr>`,
    )
    .join("");

  return createStudioHtml(
    "Dynamic points",
    `
      <p>${analysis.summary.components} component(s), ${analysis.summary.templates} template(s), ${analysis.summary.dynamicPoints} dynamic point(s).</p>
      <table>
        <thead><tr><th>Kind</th><th>Target</th><th>Expression</th><th>Compiled effect</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `,
  );
};

const createComponentPreviewHtml = (
  component: StudioComponentMeta,
  template: StudioRegion,
): string => {
  const staticHtml = createStaticPreviewHtml(template.content);
  const title = component.localName ?? component.exportName ?? component.name ?? "ElfUI component";

  return createStudioHtml(
    "Component preview",
    `
      <p>${escapeHtml(String(title))}</p>
      <iframe sandbox="" srcdoc="${escapeAttribute(staticHtml)}"></iframe>
      <h2>Template</h2>
      <pre><code>${escapeHtml(template.content.trim())}</code></pre>
    `,
  );
};

const createWorkspaceIndexReportHtml = (report: WorkspaceIndexReport): string => {
  const latestIndex = report.languageServer?.index.at(-1);
  const completion = report.languageServer?.completion;
  const historyRows = report.history
    .slice(0, 5)
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(new Date(item.recordedAt).toLocaleString())}</td>
          <td>${item.filesScanned}</td>
          <td>${item.components}</td>
          <td>${item.durationMs.toFixed(1)}ms</td>
        </tr>`,
    )
    .join("");

  return createStudioHtml(
    "Workspace index",
    `
      <table>
        <tbody>
          <tr><th>Files scanned</th><td>${report.filesScanned}</td></tr>
          <tr><th>Components</th><td>${report.components}</td></tr>
          <tr><th>Templates</th><td>${report.templates}</td></tr>
          <tr><th>Styles</th><td>${report.styles}</td></tr>
          <tr><th>Report scan</th><td>${report.durationMs.toFixed(1)}ms</td></tr>
          <tr><th>Truncated</th><td>${report.truncated ? "yes" : "no"}</td></tr>
          <tr><th>Language server startup</th><td>${formatDuration(report.languageServerStartupMs)}</td></tr>
          <tr><th>Latest language-server index</th><td>${formatIndexDuration(latestIndex)}</td></tr>
          <tr><th>Completion latency</th><td>${formatCompletionLatency(completion)}</td></tr>
        </tbody>
      </table>
      <h2>Recent report scans</h2>
      <table>
        <thead><tr><th>Recorded</th><th>Files</th><th>Components</th><th>Duration</th></tr></thead>
        <tbody>${historyRows || "<tr><td colspan=\"4\">No samples</td></tr>"}</tbody>
      </table>
    `,
  );
};

const formatDuration = (durationMs: number | undefined): string =>
  durationMs === undefined ? "unavailable" : `${durationMs.toFixed(1)}ms`;

const formatIndexDuration = (
  sample: LanguageServerPerformanceSummary["index"][number] | undefined,
): string =>
  sample
    ? `${sample.durationMs.toFixed(1)}ms (${sample.reason}, ${sample.filesScanned} files)`
    : "unavailable";

const formatCompletionLatency = (
  completion: LanguageServerPerformanceSummary["completion"] | undefined,
): string =>
  completion && completion.count > 0
    ? `${completion.averageDurationMs.toFixed(1)}ms avg, ${completion.maxDurationMs.toFixed(1)}ms max (${completion.count} requests)`
    : "unavailable";

const createStaticPreviewHtml = (template: string): string => {
  const withoutScripts = template.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  const withoutDirectiveAttributes = withoutScripts
    .replace(/\s(?:v-[\w:-]+|[:@][\w:-]+)(?:\.[\w-]+)*\s*=\s*\$\{[\s\S]*?\}/g, "")
    .replace(/\s(?:v-[\w:-]+|[:@][\w:-]+)(?:\.[\w-]+)*\s*=\s*(["'])[\s\S]*?\1/g, "")
    .replace(/\son\w+\s*=\s*(["'])[\s\S]*?\1/gi, "");
  const withPlaceholders = withoutDirectiveAttributes
    .replace(/\$\{([\s\S]*?)\}/g, (_, expression: string) =>
      `<span class="elf-expr">${escapeHtml(expression.trim())}</span>`,
    )
    .replace(/\{\{([\s\S]*?)\}\}/g, (_, expression: string) =>
      `<span class="elf-expr">${escapeHtml(expression.trim())}</span>`,
    );

  return `
    <!doctype html>
    <meta charset="utf-8" />
    <style>
      body { font: 13px system-ui, sans-serif; padding: 12px; color: #202124; }
      .elf-expr { display: inline-block; padding: 1px 5px; border: 1px solid #8ab4f8; border-radius: 4px; color: #174ea6; background: #e8f0fe; }
    </style>
    ${withPlaceholders}
  `;
};

const createStudioHtml = (title: string, body: string): string => `
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        body { font: 13px var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
        h1 { font-size: 18px; margin: 0 0 12px; }
        h2 { font-size: 14px; margin: 20px 0 8px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border-bottom: 1px solid var(--vscode-panel-border); padding: 6px 8px; text-align: left; vertical-align: top; }
        code, pre { font-family: var(--vscode-editor-font-family); }
        pre { overflow: auto; padding: 12px; background: var(--vscode-editor-background); }
        iframe { width: 100%; min-height: 220px; border: 1px solid var(--vscode-panel-border); background: white; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(title)}</h1>
      ${body}
    </body>
  </html>
`;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const escapeAttribute = (value: string): string =>
  escapeHtml(value).replace(/'/g, "&#39;");
