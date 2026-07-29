import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ElfLanguageServiceOptions,
  ElfProjectComponent,
  ElfProjectComponentSlotScope,
  ElfProjectComponentSymbol
} from "./languageService";
import {
  defaultWorkspaceIndexOptions,
  type WorkspaceIndexOptions
} from "./configuration";

export interface IndexedProjectComponent extends ElfProjectComponent {
  fileName: string;
  packageImportPath?: string;
  templateReferences?: IndexedTemplateReference[];
  uri: string;
}

export interface IndexedTemplateReference {
  kind: ElfProjectComponentSymbol["kind"];
  name: string;
  range: ElfProjectComponentSymbol["range"];
  renameWithTarget: boolean;
  targetName: string;
  targetSource?: string;
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

export interface GeneratedComponentMetadata {
  emits: string[];
  exportName: "default" | string;
  fileName: string;
  localName: string;
  props: Array<string | { default?: boolean | null | number | string; name: string; type?: string }>;
  slotScopes: ElfProjectComponentSlotScope[];
  slots: string[];
  tagName?: string;
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
  revision: number;
}

const componentMapRevisions = new WeakMap<
  Map<string, IndexedProjectComponent[]>,
  number
>();
const documentLanguageServiceOptionsCache = new WeakMap<
  Map<string, IndexedProjectComponent[]>,
  Map<
    string,
    {
      baseOptions: ElfLanguageServiceOptions;
      options: ElfLanguageServiceOptions;
      revision: number;
    }
  >
>();

export const createWorkspaceComponentIndex = (
  options: Partial<WorkspaceIndexOptions> = {}
): WorkspaceComponentIndex => {
  const componentsByUri = new Map<string, IndexedProjectComponent[]>();

  componentMapRevisions.set(componentsByUri, 0);

  return {
    componentsByUri,
    fileCacheByUri: new Map(),
    options: {
      ...defaultWorkspaceIndexOptions,
      ...options
    },
    revision: 0
  };
};

export const bumpWorkspaceIndexRevision = (index: WorkspaceComponentIndex) => {
  index.revision += 1;
  componentMapRevisions.set(index.componentsByUri, index.revision);
};

export const createLanguageServiceOptionsForDocument = (
  baseOptions: ElfLanguageServiceOptions,
  componentsByUri: Map<string, IndexedProjectComponent[]>,
  documentUri: string
): ElfLanguageServiceOptions => {
  const revision = componentMapRevisions.get(componentsByUri) ?? 0;
  let cache = documentLanguageServiceOptionsCache.get(componentsByUri);

  if (!cache) {
    cache = new Map();
    documentLanguageServiceOptionsCache.set(componentsByUri, cache);
  }

  const cached = cache.get(documentUri);

  if (cached?.baseOptions === baseOptions && cached.revision === revision) {
    return cached.options;
  }

  const options: ElfLanguageServiceOptions = {
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
  };

  cache.set(documentUri, {
    baseOptions,
    options,
    revision
  });

  return options;
};

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

export const documentUriToFileName = (uri: string): string | null => {
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
};
