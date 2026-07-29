import type {
  ElfLanguageServiceOptions,
  ElfTemplateBindingStyle
} from "./languageService";

export interface WorkspaceIndexOptions {
  indexDebounceMs: number;
  maxScanFiles: number;
  perfLogging: boolean;
}

export const defaultWorkspaceIndexOptions: WorkspaceIndexOptions = {
  indexDebounceMs: 250,
  maxScanFiles: 10_000,
  perfLogging: false
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

export const areWorkspaceIndexOptionsEqual = (
  left: WorkspaceIndexOptions,
  right: WorkspaceIndexOptions
): boolean =>
  left.indexDebounceMs === right.indexDebounceMs &&
  left.maxScanFiles === right.maxScanFiles &&
  left.perfLogging === right.perfLogging;

const readBindingStyle = (value: unknown): ElfTemplateBindingStyle | undefined =>
  value === "expression" || value === "quoted" ? value : undefined;

const readPositiveInteger = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;

const readNonNegativeInteger = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
