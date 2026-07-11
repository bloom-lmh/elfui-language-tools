import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { FileChangeType } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
  applyWatchedFileChangesToIndex,
  createLanguageServiceOptionsForDocument,
  createWorkspaceComponentIndex,
  readLanguageServiceOptions,
  readWorkspaceIndexOptions,
  rebuildWorkspaceComponentIndex,
  scanPackageComponentMetadataFiles,
  scanSourceFiles,
  updateIndexedDocument
} from "../server";

const tempRoots: string[] = [];

afterEach(() => {
  tempRoots.splice(0).forEach((root) => {
    fs.rmSync(root, { force: true, recursive: true });
  });
});

const createTempRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "elfui-vscode-index-"));

  tempRoots.push(root);

  return root;
};

const writeComponent = (root: string, fileName: string, exportName: string) => {
  const fullPath = path.join(root, fileName);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(
    fullPath,
    [
      'import { defineHtml, defineProps, html } from "elfui";',
      "",
      "defineProps<{ label: string }>();",
      "",
      `export const ${exportName} = defineHtml(html\`<button></button>\`);`,
      ""
    ].join("\n"),
    "utf8"
  );

  return fullPath;
};

const writePackageComponentMetadata = (root: string) => {
  const packageRoot = path.join(root, "node_modules", "@acme", "elfui-kit");
  const metadataPath = path.join(packageRoot, "dist", "elfui.components.json");

  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      dependencies: {
        "@acme/elfui-kit": "1.0.0"
      }
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      elfui: {
        languageTools: {
          components: "./dist/elfui.components.json"
        }
      },
      name: "@acme/elfui-kit",
      version: "1.0.0"
    }),
    "utf8"
  );
  fs.writeFileSync(
    metadataPath,
    JSON.stringify({
      components: [
        {
          emits: ["confirm"],
          exportName: "PackageButton",
          localName: "PackageButton",
          props: ["label", "open"],
          slotScopes: [
            {
              name: "footer",
              scopeType: "{ action: { disabled: boolean; label: string } }"
            }
          ],
          slots: ["default", "footer"],
          tagName: "elf-package-button"
        }
      ]
    }),
    "utf8"
  );

  return metadataPath;
};

describe("workspace component index", () => {
  it("honors the scan limit and reports truncation", () => {
    const root = createTempRoot();

    writeComponent(root, "A.ts", "A");
    writeComponent(root, "B.ts", "B");
    writeComponent(root, "C.ts", "C");

    const scan = scanSourceFiles(root, {
      indexDebounceMs: 0,
      maxScanFiles: 2,
      perfLogging: false
    });

    expect(scan.files).toHaveLength(2);
    expect(scan.truncated).toBe(true);
  });

  it("reuses cached file metadata during rebuilds", () => {
    const root = createTempRoot();

    writeComponent(root, "Button.ts", "Button");

    const index = createWorkspaceComponentIndex();
    const first = rebuildWorkspaceComponentIndex([root], index, "initial");
    const second = rebuildWorkspaceComponentIndex([root], index, "cached");

    expect(first.filesIndexed).toBe(1);
    expect(second.filesIndexed).toBe(0);
    expect(second.filesReused).toBe(1);
    expect(index.componentsByUri.size).toBe(1);
  });

  it("indexes components and package metadata across multiple workspace roots", () => {
    const appRoot = createTempRoot();
    const kitRoot = createTempRoot();

    const appFile = writeComponent(appRoot, "AppButton.ts", "AppButton");
    const kitFile = writeComponent(kitRoot, "KitButton.ts", "KitButton");
    const metadataPath = writePackageComponentMetadata(kitRoot);
    const index = createWorkspaceComponentIndex();
    const stats = rebuildWorkspaceComponentIndex([appRoot, kitRoot], index, "multi-root");
    const components = [...index.componentsByUri.values()].flat();

    expect(stats.filesIndexed).toBe(3);
    expect(index.componentsByUri.has(pathToFileURL(appFile).toString())).toBe(true);
    expect(index.componentsByUri.has(pathToFileURL(kitFile).toString())).toBe(true);
    expect(index.componentsByUri.has(pathToFileURL(metadataPath).toString())).toBe(true);
    expect(components.map((item) => item.localName).sort()).toEqual([
      "AppButton",
      "KitButton",
      "PackageButton"
    ]);
  });

  it("does not evict cached files when a rebuild is scan-limited", () => {
    const root = createTempRoot();

    writeComponent(root, "A.ts", "A");
    writeComponent(root, "B.ts", "B");
    writeComponent(root, "C.ts", "C");

    const index = createWorkspaceComponentIndex();

    rebuildWorkspaceComponentIndex([root], index, "full");
    index.options.maxScanFiles = 1;

    const limited = rebuildWorkspaceComponentIndex([root], index, "limited");

    expect(limited.truncated).toBe(true);
    expect(limited.filesRemoved).toBe(0);
    expect(index.componentsByUri.size).toBe(3);
  });

  it("applies watched file updates and deletions incrementally", () => {
    const root = createTempRoot();
    const firstFile = writeComponent(root, "First.ts", "First");
    const secondFile = writeComponent(root, "Second.ts", "Second");
    const index = createWorkspaceComponentIndex();

    rebuildWorkspaceComponentIndex([root], index, "initial");

    fs.writeFileSync(
      firstFile,
      [
        'import { defineHtml, defineProps, html } from "elfui";',
        "",
        "defineProps<{ title: string }>();",
        "",
        "export const First = defineHtml(html`<button></button>`);",
        ""
      ].join("\n"),
      "utf8"
    );

    const updateStats = applyWatchedFileChangesToIndex(
      [
        {
          type: FileChangeType.Changed,
          uri: pathToFileURL(firstFile).toString()
        }
      ],
      index
    );

    expect(updateStats.filesIndexed).toBe(1);
    expect(index.componentsByUri.get(pathToFileURL(firstFile).toString())?.[0]?.props).toContain(
      "title"
    );

    const deleteStats = applyWatchedFileChangesToIndex(
      [
        {
          type: FileChangeType.Deleted,
          uri: pathToFileURL(secondFile).toString()
        }
      ],
      index
    );

    expect(deleteStats.filesRemoved).toBe(1);
    expect(index.componentsByUri.has(pathToFileURL(secondFile).toString())).toBe(false);
  });

  it("keeps open document metadata ahead of the disk cache", () => {
    const root = createTempRoot();
    const fileName = writeComponent(root, "Live.ts", "Live");
    const index = createWorkspaceComponentIndex();
    const uri = pathToFileURL(fileName).toString();

    rebuildWorkspaceComponentIndex([root], index, "initial");

    const document = TextDocument.create(
      uri,
      "typescript",
      1,
      [
        'import { defineHtml, defineProps, html } from "elfui";',
        "",
        "defineProps<{ live: string }>();",
        "",
        "export const Live = defineHtml(html`<button></button>`);",
        ""
      ].join("\n")
    );

    expect(updateIndexedDocument(document, index)).toBe(true);
    expect(index.componentsByUri.get(uri)?.[0]?.props).toContain("live");
    expect(index.fileCacheByUri.has(uri)).toBe(false);
  });

  it("indexes dependency package component metadata", () => {
    const root = createTempRoot();
    const metadataPath = writePackageComponentMetadata(root);
    const index = createWorkspaceComponentIndex();
    const discovered = scanPackageComponentMetadataFiles(root);
    const first = rebuildWorkspaceComponentIndex([root], index, "packages");
    const second = rebuildWorkspaceComponentIndex([root], index, "packages-cached");
    const components = [...index.componentsByUri.values()].flat();
    const component = components.find((item) => item.localName === "PackageButton");

    expect(discovered.map((item) => item.fileName)).toEqual([metadataPath]);
    expect(first.filesIndexed).toBe(1);
    expect(second.filesReused).toBe(1);
    expect(component).toMatchObject({
      emits: ["confirm"],
      exportName: "PackageButton",
      importPath: "@acme/elfui-kit",
      localName: "PackageButton",
      packageImportPath: "@acme/elfui-kit",
      props: ["label", "open"],
      slots: ["default", "footer"],
      tagName: "elf-package-button"
    });
    expect(component?.slotScopes).toEqual([
      {
        name: "footer",
        scopeType: "{ action: { disabled: boolean; label: string } }"
      }
    ]);
    expect(component?.symbols?.map((item) => `${item.kind}:${item.name}`)).toEqual([
      "prop:label",
      "prop:open",
      "emit:confirm",
      "slot:default",
      "slot:footer"
    ]);
  });

  it("keeps dependency package import paths in language service options", () => {
    const root = createTempRoot();
    writePackageComponentMetadata(root);

    const consumerPath = path.join(root, "Consumer.ts");
    const index = createWorkspaceComponentIndex();

    rebuildWorkspaceComponentIndex([root], index, "packages");

    const options = createLanguageServiceOptionsForDocument(
      {},
      index.componentsByUri,
      pathToFileURL(consumerPath).toString()
    );

    expect(
      options.project?.components?.find((item) => item.localName === "PackageButton")
    ).toMatchObject({
      importPath: "@acme/elfui-kit"
    });
  });

  it("ignores malformed dependency package metadata without throwing", () => {
    const root = createTempRoot();
    const packageRoot = path.join(root, "node_modules", "broken-kit");
    const metadataPath = path.join(packageRoot, "dist", "elfui.components.json");

    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        dependencies: {
          "broken-kit": "1.0.0"
        }
      }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        elfui: {
          languageTools: {
            components: "./dist/elfui.components.json"
          }
        },
        name: "broken-kit",
        version: "1.0.0"
      }),
      "utf8"
    );
    fs.writeFileSync(
      metadataPath,
      JSON.stringify({
        components: [
          null,
          {
            exportName: "not valid",
            localName: "Broken Button"
          },
          {
            emits: [false],
            exportName: "SafeButton",
            props: [1],
            slots: [{}]
          }
        ]
      }),
      "utf8"
    );

    const index = createWorkspaceComponentIndex();
    const stats = rebuildWorkspaceComponentIndex([root], index, "broken-package");
    const components = [...index.componentsByUri.values()].flat();

    expect(stats.filesIndexed).toBe(1);
    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({
      emits: [],
      localName: "SafeButton",
      props: [],
      slots: []
    });
  });

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
      maxScanFiles: 1000,
      perfLogging: false
    });
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
});
