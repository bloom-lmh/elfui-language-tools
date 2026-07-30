import { describe, expect, it } from "vitest";

import { resolveAttributeWrapping } from "../../lsp/formatting";
import {
  areWorkspaceIndexOptionsEqual,
  readLanguageServiceOptions,
  readWorkspaceIndexOptions
} from "../configuration";

describe("language service configuration", () => {
  it("reads workspace index settings with guarded defaults", () => {
    const options = readWorkspaceIndexOptions({
      elfui: {
        languageFeatures: {
          workspace: {
            indexDebounceMs: 12.8,
            maxScanFiles: 5.2,
            perfLogging: true
          }
        }
      }
    });
    const fallback = readWorkspaceIndexOptions({
      elfui: {
        languageFeatures: {
          workspace: {
            indexDebounceMs: -1,
            maxScanFiles: 0,
            perfLogging: "yes"
          }
        }
      }
    });

    expect(options).toEqual({
      indexDebounceMs: 12,
      maxScanFiles: 5,
      perfLogging: true
    });
    expect(fallback).toEqual({
      indexDebounceMs: 250,
      maxScanFiles: 10000,
      perfLogging: false
    });
  });

  it("compares every setting that controls index rebuild behavior", () => {
    const baseline = readWorkspaceIndexOptions({});

    expect(areWorkspaceIndexOptionsEqual(baseline, { ...baseline })).toBe(true);
    expect(
      areWorkspaceIndexOptionsEqual(baseline, {
        ...baseline,
        indexDebounceMs: baseline.indexDebounceMs + 1
      })
    ).toBe(false);
    expect(
      areWorkspaceIndexOptionsEqual(baseline, {
        ...baseline,
        maxScanFiles: baseline.maxScanFiles + 1
      })
    ).toBe(false);
    expect(
      areWorkspaceIndexOptionsEqual(baseline, {
        ...baseline,
        perfLogging: !baseline.perfLogging
      })
    ).toBe(false);
  });

  it("keeps ElfUI semantic tokens disabled by default", () => {
    expect(readLanguageServiceOptions({}).semanticTokens).toEqual({
      enabled: false
    });
    expect(
      readLanguageServiceOptions({
        elfui: {
          languageFeatures: {
            semanticTokens: {
              enabled: true
            }
          }
        }
      }).semanticTokens
    ).toEqual({
      enabled: true
    });
  });

  it("maps Prettier singleAttributePerLine to expanded multiline attributes", () => {
    expect(resolveAttributeWrapping(undefined, true)).toBe("force-expand-multiline");
    expect(resolveAttributeWrapping(null, false)).toBeUndefined();
  });

  it("keeps an explicit ElfUI attribute wrapping strategy authoritative", () => {
    expect(resolveAttributeWrapping("force-aligned", true)).toBe("force-aligned");
    expect(resolveAttributeWrapping("unsupported", true)).toBe("force-expand-multiline");
  });
});
