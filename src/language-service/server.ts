import fs from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as ts from "typescript";
import {
  FileChangeType,
  SymbolKind,
  TextDocuments,
  TextDocumentSyncKind,
  type Connection,
  type FileEvent,
  type InitializeResult,
  type SymbolInformation
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import { analyzeElfSource, type ComponentMeta } from "../language-core";
import {
  createElfCompletionList,
  createElfColorPresentations,
  createElfCodeActions,
  createElfDefinition,
  createElfDiagnostics,
  createElfDocumentColors,
  createElfDocumentHighlights,
  createElfDocumentLinks,
  createElfDocumentSymbols,
  createElfFoldingRanges,
  createElfFormattingEdits,
  createElfHover,
  createElfInlayHints,
  createElfLinkedEditingRanges,
  createElfOnTypeFormattingEdits,
  createElfRangeFormattingEdits,
  createElfPrepareRename,
  createElfReferences,
  createElfRenameEdit,
  createElfSelectionRanges,
  createElfSemanticTokens,
  elfSemanticTokensLegend,
  type ElfLanguageServiceOptions,
  type ElfProjectComponent,
  type ElfProjectComponentProp,
  type ElfProjectComponentSlotScope,
  type ElfProjectComponentSymbol,
  type ElfTemplateBindingStyle
} from "./languageService";

export interface IndexedProjectComponent extends ElfProjectComponent {
  fileName: string;
  packageImportPath?: string;
  uri: string;
}

export interface WorkspaceIndexOptions {
  indexDebounceMs: number;
  maxScanFiles: number;
  perfLogging: boolean;
}

export interface WorkspaceIndexStats {
  durationMs: number;
  filesIndexed: number;
  filesRemoved: number;
  filesReused: number;
  filesScanned: number;
  filesSkipped: number;
  reason: string;
  truncated: boolean;
}

export interface CompletionPerformanceStats {
  averageDurationMs: number;
  count: number;
  maxDurationMs: number;
}

export interface WorkspaceIndexPerformanceSample extends WorkspaceIndexStats {
  recordedAt: number;
}

export interface LanguageServerPerformanceSummary {
  completion: CompletionPerformanceStats;
  index: WorkspaceIndexPerformanceSample[];
}

interface WorkspaceIndexFileCacheEntry {
  components: IndexedProjectComponent[];
  mtimeMs: number;
  size: number;
}

export interface WorkspaceComponentIndex {
  componentsByUri: Map<string, IndexedProjectComponent[]>;
  fileCacheByUri: Map<string, WorkspaceIndexFileCacheEntry>;
  options: WorkspaceIndexOptions;
}

export const defaultWorkspaceIndexOptions: WorkspaceIndexOptions = {
  indexDebounceMs: 250,
  maxScanFiles: 1000,
  perfLogging: false
};

const performanceSampleLimit = 20;

export const createWorkspaceComponentIndex = (
  options: Partial<WorkspaceIndexOptions> = {}
): WorkspaceComponentIndex => ({
  componentsByUri: new Map(),
  fileCacheByUri: new Map(),
  options: {
    ...defaultWorkspaceIndexOptions,
    ...options
  }
});

export const startElfLanguageServer = (connection: Connection) => {
  const documents = new TextDocuments(TextDocument);
  let languageServiceOptions: ElfLanguageServiceOptions = {};
  let workspaceRoots: string[] = [];
  const workspaceIndex = createWorkspaceComponentIndex();
  const indexedComponentsByUri = workspaceIndex.componentsByUri;
  let pendingWorkspaceIndexTimer: ReturnType<typeof setTimeout> | undefined;
  const indexPerformanceHistory: WorkspaceIndexPerformanceSample[] = [];
  const completionPerformance = {
    count: 0,
    maxDurationMs: 0,
    totalDurationMs: 0
  };

  const logWorkspaceIndexStats = (stats: WorkspaceIndexStats) => {
    if (!workspaceIndex.options.perfLogging) {
      return;
    }

    connection.console.info(
      [
        `[ElfUI] workspace index ${stats.reason}:`,
        `${stats.filesScanned} scanned`,
        `${stats.filesIndexed} indexed`,
        `${stats.filesReused} reused`,
        `${stats.filesSkipped} skipped`,
        `${stats.filesRemoved} removed`,
        `${stats.durationMs.toFixed(1)}ms`,
        stats.truncated ? "(truncated)" : ""
      ]
        .filter(Boolean)
        .join(" ")
    );
  };

  const recordWorkspaceIndexStats = (stats: WorkspaceIndexStats) => {
    indexPerformanceHistory.push({ ...stats, recordedAt: Date.now() });

    if (indexPerformanceHistory.length > performanceSampleLimit) {
      indexPerformanceHistory.splice(0, indexPerformanceHistory.length - performanceSampleLimit);
    }

    logWorkspaceIndexStats(stats);
  };

  const recordCompletionDuration = (durationMs: number) => {
    completionPerformance.count += 1;
    completionPerformance.totalDurationMs += durationMs;
    completionPerformance.maxDurationMs = Math.max(completionPerformance.maxDurationMs, durationMs);
  };

  const refreshOpenDocuments = () => {
    documents.all().forEach((document) => {
      updateIndexedDocument(document, workspaceIndex);
      publishDiagnostics(document);
    });
  };

  const rebuildWorkspaceIndexNow = (reason: string) => {
    const stats = rebuildWorkspaceComponentIndex(workspaceRoots, workspaceIndex, reason);

    recordWorkspaceIndexStats(stats);
    refreshOpenDocuments();
  };

  const scheduleWorkspaceIndexRebuild = (reason: string) => {
    if (pendingWorkspaceIndexTimer) {
      clearTimeout(pendingWorkspaceIndexTimer);
    }

    pendingWorkspaceIndexTimer = setTimeout(() => {
      pendingWorkspaceIndexTimer = undefined;
      rebuildWorkspaceIndexNow(reason);
    }, workspaceIndex.options.indexDebounceMs);
  };

  connection.onInitialize((params): InitializeResult => {
    languageServiceOptions = readLanguageServiceOptions(params.initializationOptions);
    workspaceIndex.options = readWorkspaceIndexOptions(params.initializationOptions);
    workspaceRoots = readWorkspaceRoots(params.workspaceFolders, params.rootUri ?? undefined);
    recordWorkspaceIndexStats(
      rebuildWorkspaceComponentIndex(workspaceRoots, workspaceIndex, "initialize")
    );

    const semanticTokensProvider = languageServiceOptions.semanticTokens?.enabled
      ? {
          full: true,
          legend: elfSemanticTokensLegend,
          range: true
        }
      : undefined;

    return {
      capabilities: {
        completionProvider: {
          triggerCharacters: ["<", " ", ":", "@", "#", ".", "-", '"', "'"]
        },
        documentOnTypeFormattingProvider: {
          firstTriggerCharacter: ">",
          moreTriggerCharacter: ["="]
        },
        documentFormattingProvider: true,
        documentRangeFormattingProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        documentHighlightProvider: true,
        documentLinkProvider: {
          resolveProvider: false
        },
        documentSymbolProvider: true,
        foldingRangeProvider: true,
        linkedEditingRangeProvider: true,
        renameProvider: {
          prepareProvider: true
        },
        selectionRangeProvider: true,
        ...(semanticTokensProvider ? { semanticTokensProvider } : {}),
        inlayHintProvider: true,
        codeActionProvider: true,
        colorProvider: true,
        hoverProvider: true,
        textDocumentSync: TextDocumentSyncKind.Incremental,
        workspaceSymbolProvider: true
      }
    };
  });

  connection.onDidChangeConfiguration((change) => {
    languageServiceOptions = readLanguageServiceOptions(change.settings);
    const nextWorkspaceIndexOptions = readWorkspaceIndexOptions(change.settings);
    const indexOptionsChanged = !isWorkspaceIndexOptionsEqual(
      workspaceIndex.options,
      nextWorkspaceIndexOptions
    );

    workspaceIndex.options = nextWorkspaceIndexOptions;

    if (indexOptionsChanged) {
      workspaceIndex.fileCacheByUri.clear();
      scheduleWorkspaceIndexRebuild("configuration");
    }
  });

  connection.onDidChangeWatchedFiles((params) => {
    const stats = applyWatchedFileChangesToIndex(params.changes, workspaceIndex, "watch");

    recordWorkspaceIndexStats(stats);
    scheduleWorkspaceIndexRebuild("watch");
  });

  connection.onRequest("elfui/getPerformanceSummary", (): LanguageServerPerformanceSummary => ({
    completion: {
      averageDurationMs:
        completionPerformance.count > 0
          ? completionPerformance.totalDurationMs / completionPerformance.count
          : 0,
      count: completionPerformance.count,
      maxDurationMs: completionPerformance.maxDurationMs
    },
    index: [...indexPerformanceHistory]
  }));

  connection.onWorkspaceSymbol((params) =>
    createWorkspaceSymbols(params.query, indexedComponentsByUri)
  );

  connection.onCompletion((params) => {
    const started = performance.now();
    const document = documents.get(params.textDocument.uri);
    const result = document
      ? createElfCompletionList(
          document,
          params.position,
          createLanguageServiceOptionsForDocument(
            languageServiceOptions,
            indexedComponentsByUri,
            document.uri
          )
        )
      : {
          isIncomplete: false,
          items: []
        };

    recordCompletionDuration(performance.now() - started);

    return result;
  });

  connection.onHover((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return null;
    }

    return createElfHover(
      document,
      params.position,
      createLanguageServiceOptionsForDocument(
        languageServiceOptions,
        indexedComponentsByUri,
        document.uri
      )
    );
  });

  connection.onDefinition((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    return createElfDefinition(
      document,
      params.position,
      createLanguageServiceOptionsForDocument(
        languageServiceOptions,
        indexedComponentsByUri,
        document.uri
      )
    );
  });

  connection.onReferences((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    return createElfReferences(
      document,
      params.position,
      createLanguageServiceOptionsForDocument(
        languageServiceOptions,
        indexedComponentsByUri,
        document.uri
      )
    );
  });

  connection.onDocumentHighlight((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    return createElfDocumentHighlights(
      document,
      params.position,
      createLanguageServiceOptionsForDocument(
        languageServiceOptions,
        indexedComponentsByUri,
        document.uri
      )
    );
  });

  connection.onDocumentSymbol((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    return createElfDocumentSymbols(document);
  });

  connection.onDocumentLinks((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    return createElfDocumentLinks(document);
  });

  connection.onFoldingRanges((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    return createElfFoldingRanges(document);
  });

  connection.onSelectionRanges((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    return createElfSelectionRanges(document, params.positions);
  });

  connection.languages.onLinkedEditingRange((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return null;
    }

    return createElfLinkedEditingRanges(document, params.position);
  });

  connection.languages.semanticTokens.on((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return {
        data: []
      };
    }

    return createElfSemanticTokens(
      document,
      undefined,
      createLanguageServiceOptionsForDocument(
        languageServiceOptions,
        indexedComponentsByUri,
        document.uri
      )
    );
  });

  connection.languages.semanticTokens.onRange((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return {
        data: []
      };
    }

    return createElfSemanticTokens(
      document,
      params.range,
      createLanguageServiceOptionsForDocument(
        languageServiceOptions,
        indexedComponentsByUri,
        document.uri
      )
    );
  });

  connection.onPrepareRename((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return null;
    }

    return createElfPrepareRename(
      document,
      params.position,
      createLanguageServiceOptionsForDocument(
        languageServiceOptions,
        indexedComponentsByUri,
        document.uri
      )
    );
  });

  connection.onRenameRequest((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return null;
    }

    return createElfRenameEdit(
      document,
      params.position,
      params.newName,
      createLanguageServiceOptionsForDocument(
        languageServiceOptions,
        indexedComponentsByUri,
        document.uri
      )
    );
  });

  connection.languages.inlayHint.on((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    return createElfInlayHints(document, params.range);
  });

  connection.onCodeAction((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    return createElfCodeActions(
      document,
      params.range,
      params.context,
      createLanguageServiceOptionsForDocument(
        languageServiceOptions,
        indexedComponentsByUri,
        document.uri
      )
    );
  });

  connection.onDocumentColor((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    return createElfDocumentColors(document);
  });

  connection.onColorPresentation((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    return createElfColorPresentations(document, params.color, params.range);
  });

  connection.onDocumentFormatting((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    return createElfFormattingEdits(document, params.options);
  });

  connection.onDocumentRangeFormatting((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    return createElfRangeFormattingEdits(document, params.range, params.options);
  });

  connection.onDocumentOnTypeFormatting((params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    return createElfOnTypeFormattingEdits(document, params.position, params.ch);
  });

  documents.onDidOpen((change) => {
    updateIndexedDocument(change.document, workspaceIndex);
    publishDiagnostics(change.document);
  });

  documents.onDidChangeContent((change) => {
    updateIndexedDocument(change.document, workspaceIndex);
    publishDiagnostics(change.document);
  });

  documents.onDidClose((change) => {
    connection.sendDiagnostics({
      diagnostics: [],
      uri: change.document.uri
    });
  });

  documents.listen(connection);
  connection.listen();

  function publishDiagnostics(document: TextDocument) {
    connection.sendDiagnostics({
      diagnostics: createElfDiagnostics(
        document,
        createLanguageServiceOptionsForDocument(
          languageServiceOptions,
          indexedComponentsByUri,
          document.uri
        )
      ),
      uri: document.uri
    });
  }
};

export const readLanguageServiceOptions = (settings: unknown): ElfLanguageServiceOptions => {
  const record = isRecord(settings) ? settings : {};
  const elfui = isRecord(record.elfui) ? record.elfui : record;
  const languageFeatures = isRecord(elfui.languageFeatures) ? elfui.languageFeatures : elfui;
  const completion = isRecord(languageFeatures.completion) ? languageFeatures.completion : {};
  const semanticTokens = isRecord(languageFeatures.semanticTokens)
    ? languageFeatures.semanticTokens
    : {};
  const completionOptions: NonNullable<ElfLanguageServiceOptions["completion"]> = {};
  const eventBindingStyle = readBindingStyle(completion.eventBindingStyle);
  const templateBindingStyle = readBindingStyle(completion.templateBindingStyle);

  if (eventBindingStyle) {
    completionOptions.eventBindingStyle = eventBindingStyle;
  }

  if (templateBindingStyle) {
    completionOptions.templateBindingStyle = templateBindingStyle;
  }

  return {
    completion: completionOptions,
    semanticTokens: {
      enabled: semanticTokens.enabled === true
    }
  };
};

const readBindingStyle = (value: unknown): ElfTemplateBindingStyle | undefined =>
  value === "expression" || value === "quoted" ? value : undefined;

export const readWorkspaceIndexOptions = (settings: unknown): WorkspaceIndexOptions => {
  const record = isRecord(settings) ? settings : {};
  const elfui = isRecord(record.elfui) ? record.elfui : record;
  const languageFeatures = isRecord(elfui.languageFeatures) ? elfui.languageFeatures : elfui;
  const workspace = isRecord(languageFeatures.workspace) ? languageFeatures.workspace : {};

  return {
    indexDebounceMs: readNonNegativeInteger(
      workspace.indexDebounceMs,
      defaultWorkspaceIndexOptions.indexDebounceMs
    ),
    maxScanFiles: readPositiveInteger(
      workspace.maxScanFiles,
      defaultWorkspaceIndexOptions.maxScanFiles
    ),
    perfLogging:
      typeof workspace.perfLogging === "boolean"
        ? workspace.perfLogging
        : defaultWorkspaceIndexOptions.perfLogging
  };
};

const isWorkspaceIndexOptionsEqual = (
  left: WorkspaceIndexOptions,
  right: WorkspaceIndexOptions
): boolean =>
  left.indexDebounceMs === right.indexDebounceMs &&
  left.maxScanFiles === right.maxScanFiles &&
  left.perfLogging === right.perfLogging;

const readPositiveInteger = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;

const readNonNegativeInteger = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;

const createWorkspaceSymbols = (
  query: string,
  componentsByUri: Map<string, IndexedProjectComponent[]>
): SymbolInformation[] => {
  const normalizedQuery = query.trim().toLowerCase();
  const symbols = [...componentsByUri.values()].flatMap((components) =>
    components.flatMap((component) => createWorkspaceSymbolsForComponent(component))
  );

  return symbols.filter((symbol) => isWorkspaceSymbolMatch(symbol, normalizedQuery)).slice(0, 200);
};

const createWorkspaceSymbolsForComponent = (
  component: IndexedProjectComponent
): SymbolInformation[] => {
  const componentRange = component.definition ?? createZeroRange();
  const componentSymbols: SymbolInformation[] = [
    {
      kind: SymbolKind.Class,
      location: {
        range: componentRange,
        uri: component.uri
      },
      name: component.localName
    }
  ];

  if (component.tagName && component.tagName !== component.localName) {
    componentSymbols.push({
      kind: SymbolKind.Class,
      location: {
        range: componentRange,
        uri: component.uri
      },
      name: component.tagName
    });
  }

  component.symbols?.forEach((symbol) => {
    componentSymbols.push({
      containerName: component.localName,
      kind: symbolKindForProjectSymbol(symbol.kind),
      location: {
        range: symbol.range,
        uri: component.uri
      },
      name: `${component.localName}.${symbol.name}`
    });
  });

  return componentSymbols;
};

const isWorkspaceSymbolMatch = (symbol: SymbolInformation, normalizedQuery: string): boolean => {
  if (!normalizedQuery) {
    return true;
  }

  const haystack = `${symbol.name} ${symbol.containerName ?? ""}`.toLowerCase();

  return haystack.includes(normalizedQuery);
};

const symbolKindForProjectSymbol = (kind: ElfProjectComponentSymbol["kind"]): SymbolKind => {
  switch (kind) {
    case "component":
      return SymbolKind.Class;
    case "emit":
      return SymbolKind.Event;
    case "prop":
      return SymbolKind.Field;
    case "slot":
      return SymbolKind.Interface;
  }
};

const createZeroRange = () => ({
  end: { character: 0, line: 0 },
  start: { character: 0, line: 0 }
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readWorkspaceRoots = (
  workspaceFolders: Array<{ uri: string }> | null | undefined,
  rootUri: string | undefined
): string[] => {
  const uris = workspaceFolders?.length ? workspaceFolders.map((folder) => folder.uri) : [rootUri];

  return uris.filter(isString).flatMap((uri) => {
    try {
      return [fileURLToPath(uri)];
    } catch {
      return [];
    }
  });
};

export const rebuildWorkspaceComponentIndex = (
  workspaceRoots: string[],
  index: WorkspaceComponentIndex,
  reason = "rebuild"
): WorkspaceIndexStats => {
  const start = performance.now();
  const seenUris = new Set<string>();
  const stats: WorkspaceIndexStats = {
    durationMs: 0,
    filesIndexed: 0,
    filesRemoved: 0,
    filesReused: 0,
    filesScanned: 0,
    filesSkipped: 0,
    reason,
    truncated: false
  };

  workspaceRoots.forEach((root) => {
    const scan = scanSourceFiles(root, index.options);
    const packageMetadataFiles = scanPackageComponentMetadataFiles(root);

    stats.filesScanned += scan.files.length;
    stats.truncated ||= scan.truncated;
    scan.files.forEach((fileName) => {
      const uri = pathToFileURL(fileName).toString();
      const result = updateIndexedFile(fileName, index);

      seenUris.add(uri);
      incrementIndexStats(stats, result);
    });

    stats.filesScanned += packageMetadataFiles.length;
    packageMetadataFiles.forEach((metadataFile) => {
      const uri = pathToFileURL(metadataFile.fileName).toString();
      const result = updateIndexedPackageMetadataFile(metadataFile, index);

      seenUris.add(uri);
      incrementIndexStats(stats, result);
    });
  });

  if (!stats.truncated) {
    [...index.componentsByUri.keys()].forEach((uri) => {
      if (seenUris.has(uri) || documentsAreUntitled(uri)) {
        return;
      }

      index.componentsByUri.delete(uri);
      index.fileCacheByUri.delete(uri);
      stats.filesRemoved += 1;
    });
  }

  stats.durationMs = performance.now() - start;

  return stats;
};

export const updateIndexedDocument = (
  document: TextDocument,
  index: WorkspaceComponentIndex
): boolean => {
  const fileName = documentUriToFileName(document.uri);

  if (!fileName || !isIndexableSourceFile(fileName)) {
    return false;
  }

  index.componentsByUri.set(
    document.uri,
    readIndexedComponents(document.getText(), fileName, document.uri)
  );
  index.fileCacheByUri.delete(document.uri);

  return true;
};

export const applyWatchedFileChangesToIndex = (
  changes: FileEvent[],
  index: WorkspaceComponentIndex,
  reason = "watch"
): WorkspaceIndexStats => {
  const start = performance.now();
  const stats: WorkspaceIndexStats = {
    durationMs: 0,
    filesIndexed: 0,
    filesRemoved: 0,
    filesReused: 0,
    filesScanned: 0,
    filesSkipped: 0,
    reason,
    truncated: false
  };

  changes.forEach((change) => {
    const fileName = documentUriToFileName(change.uri);

    if (!fileName || !isIndexableSourceFile(fileName)) {
      return;
    }

    stats.filesScanned += 1;

    if (change.type === FileChangeType.Deleted) {
      index.componentsByUri.delete(change.uri);
      index.fileCacheByUri.delete(change.uri);
      stats.filesRemoved += 1;
      return;
    }

    incrementIndexStats(stats, updateIndexedFile(fileName, index));
  });

  stats.durationMs = performance.now() - start;

  return stats;
};

export const updateIndexedFile = (
  fileName: string,
  index: WorkspaceComponentIndex
): "indexed" | "reused" | "skipped" => {
  if (!isIndexableSourceFile(fileName)) {
    return "skipped";
  }

  try {
    const uri = pathToFileURL(fileName).toString();
    const stat = fs.statSync(fileName);
    const cached = index.fileCacheByUri.get(uri);

    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      index.componentsByUri.set(uri, cached.components);

      return "reused";
    }

    const source = fs.readFileSync(fileName, "utf8");
    const components = readIndexedComponents(source, fileName, uri);

    index.componentsByUri.set(uri, components);
    index.fileCacheByUri.set(uri, {
      components,
      mtimeMs: stat.mtimeMs,
      size: stat.size
    });

    return "indexed";
  } catch {
    // Ignore unreadable files; the index is a best-effort editing aid.
    return "skipped";
  }
};

interface PackageComponentMetadataFile {
  fileName: string;
  packageName: string;
}

export const scanPackageComponentMetadataFiles = (root: string): PackageComponentMetadataFile[] => {
  const dependencyNames = readWorkspacePackageDependencyNames(root);
  const files: PackageComponentMetadataFile[] = [];
  const seen = new Set<string>();

  dependencyNames.forEach((packageName) => {
    const packageRoot = resolveNodeModulePackageRoot(root, packageName);

    if (!packageRoot) {
      return;
    }

    const packageJson = readJsonFile(path.join(packageRoot, "package.json"));

    if (!isRecord(packageJson)) {
      return;
    }

    readPackageMetadataDeclarations(packageJson).forEach((declaration) => {
      const fileName = resolvePackageMetadataFile(packageRoot, declaration);

      if (!fileName || seen.has(fileName)) {
        return;
      }

      seen.add(fileName);
      files.push({
        fileName,
        packageName
      });
    });
  });

  return files;
};

const updateIndexedPackageMetadataFile = (
  metadataFile: PackageComponentMetadataFile,
  index: WorkspaceComponentIndex
): "indexed" | "reused" | "skipped" => {
  try {
    const uri = pathToFileURL(metadataFile.fileName).toString();
    const stat = fs.statSync(metadataFile.fileName);
    const cached = index.fileCacheByUri.get(uri);

    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      index.componentsByUri.set(uri, cached.components);

      return "reused";
    }

    const source = fs.readFileSync(metadataFile.fileName, "utf8");
    const components = readIndexedPackageMetadataComponents(
      source,
      metadataFile.fileName,
      uri,
      metadataFile.packageName
    );

    index.componentsByUri.set(uri, components);
    index.fileCacheByUri.set(uri, {
      components,
      mtimeMs: stat.mtimeMs,
      size: stat.size
    });

    return "indexed";
  } catch {
    return "skipped";
  }
};

const readWorkspacePackageDependencyNames = (root: string): string[] => {
  const packageJson = readJsonFile(path.join(root, "package.json"));

  if (!isRecord(packageJson)) {
    return [];
  }

  const names = new Set<string>();

  ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].forEach(
    (field) => {
      const dependencies = packageJson[field];

      if (!isRecord(dependencies)) {
        return;
      }

      Object.keys(dependencies).forEach((name) => {
        if (isSafePackageName(name)) {
          names.add(name);
        }
      });
    }
  );

  return [...names].sort();
};

const resolveNodeModulePackageRoot = (root: string, packageName: string): string | null => {
  const nodeModulesRoot = path.resolve(root, "node_modules");
  const packageRoot = path.resolve(nodeModulesRoot, ...packageName.split("/"));
  const packageJson = path.join(packageRoot, "package.json");

  if (!isPathInside(packageRoot, nodeModulesRoot) || !fs.existsSync(packageJson)) {
    return null;
  }

  return packageRoot;
};

const isSafePackageName = (packageName: string): boolean => {
  const segments = packageName.split("/");

  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return false;
  }

  if (segments[0]?.startsWith("@")) {
    return segments.length === 2;
  }

  return segments.length === 1;
};

const readPackageMetadataDeclarations = (packageJson: Record<string, unknown>): string[] => {
  const declarations = [
    readNestedStringOrStringArray(packageJson, ["elfui", "languageTools", "components"]),
    readNestedStringOrStringArray(packageJson, ["elfui", "components"]),
    readNestedStringOrStringArray(packageJson, ["elfuiLanguage", "components"])
  ].flat();

  return [...new Set(declarations)].filter((item) => item.length > 0);
};

const readNestedStringOrStringArray = (
  value: Record<string, unknown>,
  pathSegments: string[]
): string[] => {
  let current: unknown = value;

  for (const segment of pathSegments) {
    if (!isRecord(current)) {
      return [];
    }

    current = current[segment];
  }

  if (isString(current)) {
    return [current];
  }

  if (Array.isArray(current)) {
    return current.filter(isString);
  }

  return [];
};

const resolvePackageMetadataFile = (packageRoot: string, declaration: string): string | null => {
  if (path.isAbsolute(declaration) || !declaration.toLowerCase().endsWith(".json")) {
    return null;
  }

  const fileName = path.resolve(packageRoot, declaration);

  if (!isPathInside(fileName, packageRoot) || !fs.existsSync(fileName)) {
    return null;
  }

  return fileName;
};

const isPathInside = (candidate: string, root: string): boolean => {
  const relativePath = path.relative(root, candidate);

  return (
    relativePath === "" ||
    (!!relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
};

const readJsonFile = (fileName: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(fileName, "utf8"));
  } catch {
    return null;
  }
};

const readIndexedPackageMetadataComponents = (
  source: string,
  fileName: string,
  uri: string,
  packageName: string
): IndexedProjectComponent[] => {
  const metadata = readPackageComponentMetadata(source);

  return metadata.flatMap((entry) =>
    readIndexedPackageMetadataComponent(entry, fileName, uri, packageName)
  );
};

const readPackageComponentMetadata = (source: string): Record<string, unknown>[] => {
  const value = readJsonSource(source);
  const entries = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.components)
      ? value.components
      : [];

  return entries.filter(isRecord);
};

const readJsonSource = (source: string): unknown => {
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
};

const readIndexedPackageMetadataComponent = (
  entry: Record<string, unknown>,
  fileName: string,
  uri: string,
  packageName: string
): IndexedProjectComponent[] => {
  const rawExportName = readString(entry.exportName);
  const rawLocalName = readString(entry.localName);
  const exportName = rawExportName ?? rawLocalName;

  if (!exportName || (exportName !== "default" && !isValidIdentifier(exportName))) {
    return [];
  }

  const localName =
    rawLocalName ?? (exportName === "default" ? readString(entry.name) : exportName);

  if (!localName || !isValidIdentifier(localName)) {
    return [];
  }

  const importPath = readString(entry.importPath) ?? packageName;
  const propMetadata = readPackageComponentProps(entry.props);
  const props = propMetadata.names;
  const emits = readNameArray(entry.emits);
  const slots = readNameArray(entry.slots);
  const slotScopes = readPackageComponentSlotScopes(entry.slotScopes);
  const symbols = createPackageComponentSymbols(props, emits, slots);
  const definition = createZeroRange();

  return [
    {
      definition,
      emits,
      exportName,
      fileName,
      importPath,
      localName,
      packageImportPath: importPath,
      propDetails: propMetadata.details,
      props,
      slotScopes,
      slots,
      slotsType: readString(entry.slotsType),
      symbols,
      tagName: readString(entry.tagName) ?? null,
      uri
    }
  ];
};

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const readNameArray = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter(readName))] : [];

const readName = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const readPackageComponentProps = (
  value: unknown
): { details: ElfProjectComponentProp[]; names: string[] } => {
  if (!Array.isArray(value)) {
    return { details: [], names: [] };
  }

  const details = new Map<string, ElfProjectComponentProp>();

  value.forEach((item) => {
    if (readName(item)) {
      if (!details.has(item)) {
        details.set(item, { name: item });
      }
      return;
    }

    if (!isRecord(item)) {
      return;
    }

    const name = readString(item.name);

    if (!name) {
      return;
    }

    const existing = details.get(name) ?? { name };
    const type = readString(item.type);
    const defaultValue = readPackagePropDefaultValue(
      Object.hasOwn(item, "default") ? item.default : item.defaultValue
    );

    details.set(name, {
      ...existing,
      ...(type ? { type } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {})
    });
  });

  return {
    details: [...details.values()],
    names: [...details.keys()]
  };
};

const readPackagePropDefaultValue = (value: unknown): string | undefined => {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return JSON.stringify(value);
  }

  return undefined;
};

const readPackageComponentSlotScopes = (value: unknown): ElfProjectComponentSlotScope[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isRecord(item)) {
          return [];
        }

        const name = readString(item.name);
        const scopeType = readString(item.scopeType);

        return name && scopeType ? [{ name, scopeType }] : [];
      })
    : [];

const createPackageComponentSymbols = (
  props: string[],
  emits: string[],
  slots: string[]
): ElfProjectComponentSymbol[] => {
  const range = createZeroRange();

  return [
    ...props.map((name) => ({ kind: "prop" as const, name, range })),
    ...emits.map((name) => ({ kind: "emit" as const, name, range })),
    ...slots.map((name) => ({ kind: "slot" as const, name, range }))
  ];
};

export const scanSourceFiles = (
  root: string,
  options: WorkspaceIndexOptions = defaultWorkspaceIndexOptions
): { files: string[]; truncated: boolean } => {
  const files: string[] = [];
  let truncated = false;
  const visit = (directory: string) => {
    if (files.length >= options.maxScanFiles) {
      truncated = true;
      return;
    }

    if (isIgnoredDirectory(directory)) {
      return;
    }

    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.forEach((entry) => {
      if (files.length >= options.maxScanFiles) {
        truncated = true;
        return;
      }

      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(entryPath);
        return;
      }

      if (entry.isFile() && isIndexableSourceFile(entryPath)) {
        files.push(entryPath);

        if (files.length >= options.maxScanFiles) {
          truncated = true;
        }
      }
    });
  };

  visit(root);

  return { files, truncated };
};

const incrementIndexStats = (
  stats: WorkspaceIndexStats,
  result: "indexed" | "reused" | "skipped"
) => {
  if (result === "indexed") {
    stats.filesIndexed += 1;
    return;
  }

  if (result === "reused") {
    stats.filesReused += 1;
    return;
  }

  stats.filesSkipped += 1;
};

const documentsAreUntitled = (uri: string): boolean => uri.startsWith("untitled:");

const isIgnoredDirectory = (directory: string): boolean => {
  const baseName = path.basename(directory).toLowerCase();

  return [
    ".git",
    ".pnpm-store",
    ".vscode-test",
    "coverage",
    "dist",
    "node_modules",
    "output"
  ].includes(baseName);
};

const isIndexableSourceFile = (fileName: string): boolean =>
  /\.(?:elf\.)?[cm]?[jt]sx?$/.test(fileName.replace(/\\/g, "/"));

const readIndexedComponents = (
  source: string,
  fileName: string,
  uri: string
): IndexedProjectComponent[] => {
  const analysis = analyzeElfSource(source, { fileName });
  const exports = collectStaticExports(source, fileName);
  const document = TextDocument.create(uri, readLanguageId(fileName), 0, source);
  const sourceFile = createTsSourceFile(source, fileName);

  return analysis.components.flatMap((component) => {
    const exportName = readComponentExportName(component, exports);

    if (!exportName) {
      return [];
    }

    const localName = readComponentLocalName(component, exportName, fileName);

    if (!isValidIdentifier(localName)) {
      return [];
    }

    const definition = findComponentDefinitionRange(
      document,
      sourceFile,
      component,
      exportName,
      localName
    );
    const slotsType = findDefineSlotsTypeFallback(sourceFile) ?? component.slotsType;
    const slotScopes = findDefineSlotScopesFallback(sourceFile);
    const indexedComponent: IndexedProjectComponent = {
      emits: component.emits,
      exportName,
      fileName,
      importPath: "",
      localName,
      propDetails: component.propDetails,
      props: component.props,
      slotScopes,
      slots: component.slots,
      slotsType,
      symbols: createIndexedComponentSymbols(document, component),
      tagName: component.name,
      uri
    };

    if (definition) {
      indexedComponent.definition = definition;
    }

    return [indexedComponent];
  });
};

const readLanguageId = (fileName: string): string => {
  const normalized = fileName.toLowerCase();

  if (normalized.endsWith(".tsx")) return "typescriptreact";
  if (normalized.endsWith(".jsx")) return "javascriptreact";
  if (normalized.endsWith(".js") || normalized.endsWith(".mjs") || normalized.endsWith(".cjs")) {
    return "javascript";
  }

  return "typescript";
};

const createIndexedComponentSymbols = (
  document: TextDocument,
  component: ComponentMeta
): ElfProjectComponentSymbol[] =>
  component.symbols.flatMap((symbol) => {
    const kind = toProjectComponentSymbolKind(symbol.kind);

    return kind
      ? [
          {
            kind,
            name: symbol.name,
            range: {
              end: document.positionAt(symbol.end),
              start: document.positionAt(symbol.start)
            }
          }
        ]
      : [];
  });

const toProjectComponentSymbolKind = (
  kind: ComponentMeta["symbols"][number]["kind"]
): ElfProjectComponentSymbol["kind"] | null => {
  switch (kind) {
    case "emit":
      return "emit";
    case "prop":
      return "prop";
    case "slot":
      return "slot";
    default:
      return null;
  }
};

const findComponentDefinitionRange = (
  document: TextDocument,
  sourceFile: ts.SourceFile,
  component: ComponentMeta,
  exportName: "default" | string,
  localName: string
): ElfProjectComponent["definition"] => {
  const candidates = new Set(
    [
      component.id,
      component.localName,
      component.exportName === "default" ? undefined : component.exportName,
      exportName === "default" ? localName : exportName,
      localName
    ].filter(isString)
  );

  const range = findNamedDeclarationRange(sourceFile, candidates);

  if (range) {
    return {
      end: document.positionAt(range.end),
      start: document.positionAt(range.start)
    };
  }

  return undefined;
};

const findNamedDeclarationRange = (
  sourceFile: ts.SourceFile,
  candidates: Set<string>
): { end: number; start: number } | null => {
  let result: { end: number; start: number } | null = null;
  const visit = (node: ts.Node) => {
    if (result) {
      return;
    }

    if (
      (ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      candidates.has(node.name.text)
    ) {
      result = {
        end: node.name.getEnd(),
        start: node.name.getStart(sourceFile)
      };
      return;
    }

    if (
      ts.isExportAssignment(node) &&
      ts.isIdentifier(node.expression) &&
      candidates.has(node.expression.text)
    ) {
      result = {
        end: node.expression.getEnd(),
        start: node.expression.getStart(sourceFile)
      };
      return;
    }

    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      const element = node.exportClause.elements.find((item) => candidates.has(item.name.text));

      if (element) {
        result = {
          end: element.name.getEnd(),
          start: element.name.getStart(sourceFile)
        };
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return result;
};

const findDefineSlotsTypeFallback = (sourceFile: ts.SourceFile): string | undefined => {
  let result: string | undefined;
  const visit = (node: ts.Node) => {
    if (result) {
      return;
    }

    if (
      ts.isCallExpression(node) &&
      callExpressionName(node) === "defineSlots" &&
      node.typeArguments?.[0]
    ) {
      result = node.typeArguments[0].getText(sourceFile);
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return result;
};

const findDefineSlotScopesFallback = (
  sourceFile: ts.SourceFile
): ElfProjectComponentSlotScope[] => {
  const slotsType = findDefineSlotsTypeNode(sourceFile);

  return slotsType ? readSlotScopesFromTypeNode(slotsType, sourceFile) : [];
};

const findDefineSlotsTypeNode = (sourceFile: ts.SourceFile): ts.TypeNode | null => {
  let result: ts.TypeNode | null = null;
  const visit = (node: ts.Node) => {
    if (result) {
      return;
    }

    if (
      ts.isCallExpression(node) &&
      callExpressionName(node) === "defineSlots" &&
      node.typeArguments?.[0]
    ) {
      result = node.typeArguments[0];
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return result;
};

const readSlotScopesFromTypeNode = (
  node: ts.TypeNode,
  sourceFile: ts.SourceFile
): ElfProjectComponentSlotScope[] => {
  if (ts.isTypeLiteralNode(node)) {
    return readSlotScopesFromTypeMembers(node.members, sourceFile);
  }

  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const declaration = findTopLevelTypeDeclaration(sourceFile, node.typeName.text);

    if (declaration && ts.isInterfaceDeclaration(declaration)) {
      return readSlotScopesFromTypeMembers(declaration.members, sourceFile);
    }

    if (declaration && ts.isTypeAliasDeclaration(declaration)) {
      return readSlotScopesFromTypeNode(declaration.type, sourceFile);
    }
  }

  return [];
};

const readSlotScopesFromTypeMembers = (
  members: ts.NodeArray<ts.TypeElement>,
  sourceFile: ts.SourceFile
): ElfProjectComponentSlotScope[] =>
  members.flatMap((member) => {
    const name = "name" in member && member.name ? readPropertyName(member.name, sourceFile) : null;
    const scopeType = readSlotScopeParameterType(member, sourceFile);

    return name && scopeType ? [{ name, scopeType }] : [];
  });

const readSlotScopeParameterType = (
  member: ts.TypeElement,
  sourceFile: ts.SourceFile
): string | null => {
  const parameter =
    ts.isPropertySignature(member) && member.type && ts.isFunctionTypeNode(member.type)
      ? member.type.parameters[0]
      : ts.isMethodSignature(member)
        ? member.parameters[0]
        : undefined;

  return parameter?.type?.getText(sourceFile) ?? null;
};

const findTopLevelTypeDeclaration = (
  sourceFile: ts.SourceFile,
  name: string
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | null => {
  for (const statement of sourceFile.statements) {
    if (
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
      statement.name.text === name
    ) {
      return statement;
    }
  }

  return null;
};

const readPropertyName = (name: ts.PropertyName, sourceFile: ts.SourceFile): string | null => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  if (ts.isComputedPropertyName(name)) {
    const expression = name.expression;

    return ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)
      ? expression.text
      : expression.getText(sourceFile);
  }

  return null;
};

const callExpressionName = (call: ts.CallExpression): string | null => {
  const expression = call.expression;

  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return null;
};

const readComponentExportName = (
  component: ComponentMeta,
  exports: { defaultName: string | null; named: Set<string> }
): "default" | string | null => {
  if (component.exportName) {
    return component.exportName;
  }

  if (exports.defaultName === component.id) {
    return "default";
  }

  return exports.named.has(component.id) ? component.id : null;
};

const collectStaticExports = (
  source: string,
  fileName: string
): { defaultName: string | null; named: Set<string> } => {
  const sourceFile = createTsSourceFile(source, fileName);
  const named = new Set<string>();
  let defaultName: string | null = null;

  sourceFile.statements.forEach((statement) => {
    if (ts.canHaveModifiers(statement)) {
      const modifiers = ts.getModifiers(statement) ?? [];
      const isExported = modifiers.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
      );

      if (isExported && ts.isVariableStatement(statement)) {
        statement.declarationList.declarations.forEach((declaration) => {
          if (ts.isIdentifier(declaration.name)) {
            named.add(declaration.name.text);
          }
        });
      }
    }

    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause)) {
        statement.exportClause.elements.forEach((element) => named.add(element.name.text));
      }
      return;
    }

    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      defaultName = statement.expression.text;
    }
  });

  return { defaultName, named };
};

const createTsSourceFile = (source: string, fileName: string): ts.SourceFile =>
  ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

const readComponentLocalName = (
  component: ComponentMeta,
  exportName: "default" | string,
  fileName: string
): string =>
  component.localName ??
  (exportName === "default"
    ? toPascalCase(path.basename(fileName).replace(/\..*$/, ""))
    : exportName);

export const createLanguageServiceOptionsForDocument = (
  baseOptions: ElfLanguageServiceOptions,
  componentsByUri: Map<string, IndexedProjectComponent[]>,
  documentUri: string
): ElfLanguageServiceOptions => ({
  ...baseOptions,
  project: {
    components: [...componentsByUri.values()]
      .flat()
      .filter((component) => component.uri !== documentUri)
      .map((component) => ({
        ...component,
        importPath:
          component.packageImportPath ?? createRelativeImportPath(documentUri, component.uri)
      }))
      .filter((component) => component.importPath.length > 0)
  }
});

const createRelativeImportPath = (fromUri: string, toUri: string): string => {
  const fromFileName = documentUriToFileName(fromUri);
  const toFileName = documentUriToFileName(toUri);

  if (!fromFileName || !toFileName) {
    return "";
  }

  const fromDirectory = path.dirname(fromFileName);
  const withoutExtension = toFileName.replace(/\.(?:elf\.)?[cm]?[jt]sx?$/, "");
  let relativePath = path.relative(fromDirectory, withoutExtension).replace(/\\/g, "/");

  if (!relativePath.startsWith(".")) {
    relativePath = `./${relativePath}`;
  }

  return relativePath;
};

const documentUriToFileName = (uri: string): string | null => {
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
};

const toPascalCase = (value: string): string =>
  value
    .replace(/(?:^|[-_\s]+)([A-Za-z0-9])/g, (_, char: string) => char.toUpperCase())
    .replace(/[^A-Za-z0-9_$]/g, "");

const isValidIdentifier = (name: string): boolean => /^[A-Za-z_$][\w$]*$/.test(name);

const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
