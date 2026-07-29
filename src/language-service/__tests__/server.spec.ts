import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { FileChangeType } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
  appendWorkspaceReferences,
  appendWorkspaceRenameEdits,
  applyWatchedFileChangesToIndex,
  createWorkspaceComponentMetadata,
  rebuildWorkspaceComponentIndex,
  rebuildWorkspaceComponentIndexAsync,
  scanPackageComponentMetadataFiles,
  scanSourceFiles,
  scanSourceFilesAsync,
  updateIndexedDocument
} from "../server";
import {
  createElfReferences,
  createElfRenameEdit
} from "../languageService";
import {
  createLanguageServiceOptionsForDocument,
  createWorkspaceComponentIndex
} from "../workspaceIndex";

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
      'import { defineHtml, defineProps } from "@elfui/core";',
      "",
      "defineProps<{ label: string }>();",
      "",
      `export const ${exportName} = defineHtml(\`<button></button>\`);`,
      ""
    ].join("\n"),
    "utf8"
  );

  return fullPath;
};

const writeSource = (root: string, fileName: string, source: string) => {
  const fullPath = path.join(root, fileName);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, source.trimStart(), "utf8");

  return fullPath;
};

const createIndexedDocument = (fileName: string) =>
  TextDocument.create(
    pathToFileURL(fileName).toString(),
    fileName.endsWith("x") ? "typescriptreact" : "typescript",
    1,
    fs.readFileSync(fileName, "utf8")
  );

const positionInside = (document: TextDocument, text: string, occurrence = 0) => {
  const source = document.getText();
  let offset = -1;

  for (let index = 0; index <= occurrence; index += 1) {
    offset = source.indexOf(text, offset + 1);
  }

  if (offset < 0) {
    throw new Error(`Could not find ${text}.`);
  }

  return document.positionAt(offset + Math.max(1, Math.floor(text.length / 2)));
};

const readLocationText = (
  location: { range: { end: { character: number; line: number }; start: { character: number; line: number } }; uri: string },
  documents: Map<string, TextDocument>
) => {
  const document = documents.get(location.uri);

  if (!document) {
    throw new Error(`Missing document for ${location.uri}.`);
  }

  return document.getText(location.range);
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
          emits: [{ name: "confirm", payloadType: "{ value: string }" }],
          exportName: "PackageButton",
          localName: "PackageButton",
          props: [
            { name: "label", type: "string" },
            { default: false, name: "open", type: "boolean" },
            { default: null, name: "description", type: "string | null" }
          ],
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

const writeCompilerV2PackageMetadata = (root: string) => {
  const packageRoot = path.join(root, "node_modules", "@acme", "compiler-v2-kit");
  const metadataPath = path.join(packageRoot, "dist", "elfui.metadata.json");

  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      dependencies: {
        "@acme/compiler-v2-kit": "1.0.0"
      }
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      elfui: {
        languageTools: {
          components: "./dist/elfui.metadata.json"
        }
      },
      name: "@acme/compiler-v2-kit",
      version: "1.0.0"
    }),
    "utf8"
  );
  fs.writeFileSync(
    metadataPath,
    JSON.stringify({
      compilerProtocol: 1,
      components: [
        {
          events: [{ name: "select", typeText: "[value: string]" }],
          exportName: "CompilerButton",
          localName: "CompilerButton",
          props: [{ name: "label", runtimeOption: "String", typeText: "string" }],
          slots: { typeText: "{ default?: () => unknown }" },
          tagName: "elf-compiler-button"
        }
      ],
      diagnostics: { codes: [], errors: 0, warnings: 0 },
      fragments: [],
      schemaVersion: 2,
      sourceId: "src/CompilerButton.ts"
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

  it("scans asynchronously with deterministic traversal and the same limit contract", async () => {
    const root = createTempRoot();

    writeComponent(root, "z/Z.ts", "Z");
    writeComponent(root, "a/B.ts", "B");
    writeComponent(root, "a/A.ts", "A");

    const scan = await scanSourceFilesAsync(root, {
      indexDebounceMs: 0,
      maxScanFiles: 2,
      perfLogging: false
    });

    expect(scan.files.map((fileName) => path.relative(root, fileName).replace(/\\/g, "/"))).toEqual([
      "a/A.ts",
      "a/B.ts"
    ]);
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

  it("reuses cached file metadata during asynchronous rebuilds", async () => {
    const root = createTempRoot();

    writeComponent(root, "Button.ts", "Button");

    const index = createWorkspaceComponentIndex();
    const first = await rebuildWorkspaceComponentIndexAsync([root], index, "initial");
    const second = await rebuildWorkspaceComponentIndexAsync([root], index, "cached");

    expect(first.filesIndexed).toBe(1);
    expect(second.filesIndexed).toBe(0);
    expect(second.filesReused).toBe(1);
    expect(index.componentsByUri.size).toBe(1);
  });

  it("finds and renames component contracts across indexed files", () => {
    const root = createTempRoot();
    const componentFile = writeSource(
      root,
      "Button.ts",
      `
        import { defineEmits, defineHtml, defineProps, defineSlots } from "@elfui/core";

        defineProps<{ label: string }>();
        defineEmits<{ confirm: [value: string] }>();
        defineSlots<{ footer: () => unknown }>();

        export const Button = defineHtml(\`<button><slot name="footer"></slot></button>\`);
      `
    );
    const firstConsumerFile = writeSource(
      root,
      "First.ts",
      `
        import { defineHtml, useComponents } from "@elfui/core";
        import { Button } from "./Button";

        useComponents({ Button });
        export const First = defineHtml(\`
          <Button :label=\${title} @confirm=\${handleConfirm}>
            <template #footer>Footer</template>
          </Button>
        \`);
      `
    );
    const secondConsumerFile = writeSource(
      root,
      "Second.ts",
      `
        import { defineHtml, useComponents } from "@elfui/core";
        import { Button as LocalButton } from "./Button";

        useComponents({ LocalButton });
        export const Second = defineHtml(\`
          <LocalButton :label=\${title} @confirm=\${handleConfirm}>
            <span slot="footer">Footer</span>
          </LocalButton>
        \`);
      `
    );
    const index = createWorkspaceComponentIndex();

    rebuildWorkspaceComponentIndex([root], index, "cross-file");

    const documents = new Map(
      [componentFile, firstConsumerFile, secondConsumerFile].map((fileName) => {
        const document = createIndexedDocument(fileName);
        return [document.uri, document] as const;
      })
    );
    const firstDocument = documents.get(pathToFileURL(firstConsumerFile).toString())!;
    const options = createLanguageServiceOptionsForDocument(
      {},
      index.componentsByUri,
      firstDocument.uri
    );

    const baseComponentReferences = createElfReferences(
      firstDocument,
      positionInside(firstDocument, "Button", 3),
      options
    );
    const componentReferences = appendWorkspaceReferences(
      baseComponentReferences,
      index.componentsByUri
    );
    const propReferences = appendWorkspaceReferences(
      createElfReferences(firstDocument, positionInside(firstDocument, "label"), options),
      index.componentsByUri
    );
    const eventReferences = appendWorkspaceReferences(
      createElfReferences(firstDocument, positionInside(firstDocument, "confirm"), options),
      index.componentsByUri
    );
    const slotReferences = appendWorkspaceReferences(
      createElfReferences(firstDocument, positionInside(firstDocument, "footer"), options),
      index.componentsByUri
    );

    expect(componentReferences.map((item) => readLocationText(item, documents))).toEqual(
      expect.arrayContaining(["Button", "LocalButton"])
    );
    expect(componentReferences.some((item) => item.uri === documents.get(pathToFileURL(secondConsumerFile).toString())!.uri)).toBe(true);
    expect(propReferences.filter((item) => readLocationText(item, documents) === "label")).toHaveLength(3);
    expect(eventReferences.filter((item) => readLocationText(item, documents) === "confirm")).toHaveLength(3);
    expect(slotReferences.filter((item) => readLocationText(item, documents) === "footer")).toHaveLength(3);
    expect(
      [...index.componentsByUri.values()]
        .flatMap((components) => components[0]?.templateReferences ?? [])
        .map((reference) => reference.name)
    ).not.toEqual(expect.arrayContaining(["title", "handleConfirm"]));

    const baseRename = createElfRenameEdit(
      firstDocument,
      positionInside(firstDocument, "Button", 3),
      "ActionButton",
      options
    );

    expect(baseRename).not.toBeNull();

    const rename = appendWorkspaceRenameEdits(
      baseRename!,
      "ActionButton",
      index.componentsByUri
    );
    const secondUri = pathToFileURL(secondConsumerFile).toString();
    const secondEdits = rename.changes?.[secondUri] ?? [];

    expect(secondEdits.map((item) => readLocationText({ range: item.range, uri: secondUri }, documents))).toContain("Button");
    expect(secondEdits.map((item) => readLocationText({ range: item.range, uri: secondUri }, documents))).not.toContain("LocalButton");
  });

  it("drops cross-file references when an indexed consumer is deleted", () => {
    const root = createTempRoot();
    writeSource(
      root,
      "Button.ts",
      `
        import { defineHtml } from "@elfui/core";
        export const Button = defineHtml(\`<button></button>\`);
      `
    );
    const consumerFile = writeSource(
      root,
      "Consumer.ts",
      `
        import { defineHtml, useComponents } from "@elfui/core";
        import { Button } from "./Button";
        useComponents({ Button });
        export const Consumer = defineHtml(\`<Button></Button>\`);
      `
    );
    const index = createWorkspaceComponentIndex();

    rebuildWorkspaceComponentIndex([root], index, "initial");
    const consumerUri = pathToFileURL(consumerFile).toString();

    expect(
      [...index.componentsByUri.values()]
        .flatMap((components) => components[0]?.templateReferences ?? [])
        .some((reference) => reference.targetName === "Button")
    ).toBe(true);

    fs.rmSync(consumerFile);
    applyWatchedFileChangesToIndex(
      [{ type: FileChangeType.Deleted, uri: consumerUri }],
      index
    );

    expect(index.componentsByUri.has(consumerUri)).toBe(false);
  });

  it("resolves default imports through relative index modules and preserves aliases", () => {
    const root = createTempRoot();
    const componentFile = writeSource(
      root,
      "components/index.ts",
      `
        import { defineHtml } from "@elfui/core";
        export default defineHtml(\`<article></article>\`);
      `
    );
    const firstFile = writeSource(
      root,
      "First.ts",
      `
        import { defineHtml, useComponents } from "@elfui/core";
        import Card from "./components";
        useComponents({ Card });
        export const First = defineHtml(\`<Card></Card>\`);
      `
    );
    const secondFile = writeSource(
      root,
      "Second.ts",
      `
        import { defineHtml, useComponents } from "@elfui/core";
        import LocalCard from "./components/index";
        useComponents({ LocalCard });
        export const Second = defineHtml(\`<LocalCard></LocalCard>\`);
      `
    );
    const index = createWorkspaceComponentIndex();

    rebuildWorkspaceComponentIndex([root], index, "default-index");

    const documents = new Map(
      [componentFile, firstFile, secondFile].map((fileName) => {
        const document = createIndexedDocument(fileName);
        return [document.uri, document] as const;
      })
    );
    const firstDocument = documents.get(pathToFileURL(firstFile).toString())!;
    const tagPosition = positionInside(firstDocument, "Card", 3);
    const references = appendWorkspaceReferences(
      createElfReferences(
        firstDocument,
        tagPosition,
        createLanguageServiceOptionsForDocument(
          {},
          index.componentsByUri,
          firstDocument.uri
        )
      ),
      index.componentsByUri,
      { position: tagPosition, uri: firstDocument.uri }
    );

    expect(references.map((item) => readLocationText(item, documents))).toEqual(
      expect.arrayContaining(["Card", "LocalCard"])
    );
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
        'import { defineHtml, defineProps } from "@elfui/core";',
        "",
        "defineProps<{ title: string }>();",
        "",
        "export const First = defineHtml(`<button></button>`);",
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
        'import { defineHtml, defineProps } from "@elfui/core";',
        "",
        "defineProps<{ live: string }>();",
        "",
        "export const Live = defineHtml(`<button></button>`);",
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
      props: ["label", "open", "description"],
      slots: ["default", "footer"],
      tagName: "elf-package-button"
    });
    expect(component?.slotScopes).toEqual([
      {
        name: "footer",
        scopeType: "{ action: { disabled: boolean; label: string } }"
      }
    ]);
    expect(component?.propDetails).toEqual([
      { name: "label", type: "string" },
      { defaultValue: "false", name: "open", type: "boolean" },
      { defaultValue: "null", name: "description", type: "string | null" }
    ]);
    expect(component?.emitDetails).toEqual([
      { name: "confirm", payloadType: "{ value: string }" }
    ]);
    expect(component?.symbols?.map((item) => `${item.kind}:${item.name}`)).toEqual([
      "prop:label",
      "prop:open",
      "prop:description",
      "emit:confirm",
      "slot:default",
      "slot:footer"
    ]);
  });

  it("indexes compiler schema v2 component Metadata JSON", () => {
    const root = createTempRoot();
    const metadataPath = writeCompilerV2PackageMetadata(root);
    const index = createWorkspaceComponentIndex();

    rebuildWorkspaceComponentIndex([root], index, "compiler-v2-metadata");

    const component = [...index.componentsByUri.values()]
      .flat()
      .find((item) => item.localName === "CompilerButton");

    expect(component).toMatchObject({
      emits: ["select"],
      importPath: "@acme/compiler-v2-kit",
      props: ["label"],
      slotsType: "{ default?: () => unknown }",
      tagName: "elf-compiler-button"
    });
    expect(component?.fileName).toBe(metadataPath);
    expect(component?.propDetails).toEqual([{ name: "label", type: "string" }]);
    expect(component?.emitDetails).toEqual([
      { name: "select", payloadType: "[value: string]" }
    ]);
  });

  it("creates package metadata from cached local component exports only", () => {
    const root = createTempRoot();
    writeComponent(root, "GeneratedButton.ts", "GeneratedButton");
    const index = createWorkspaceComponentIndex();

    rebuildWorkspaceComponentIndex([root], index, "metadata-generation");

    expect(createWorkspaceComponentMetadata([root], index.componentsByUri)).toEqual([
      expect.objectContaining({
        emits: [],
        exportName: "GeneratedButton",
        fileName: path.join(root, "GeneratedButton.ts"),
        localName: "GeneratedButton",
        props: [{ name: "label", type: "string" }],
        slots: []
      })
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

  it("reuses per-document project options until the index changes", () => {
    const root = createTempRoot();
    const componentFile = writeComponent(root, "CachedButton.ts", "CachedButton");
    const index = createWorkspaceComponentIndex();
    const documentUri = pathToFileURL(path.join(root, "Consumer.ts")).toString();
    const baseOptions = {};

    rebuildWorkspaceComponentIndex([root], index, "options-cache");

    const first = createLanguageServiceOptionsForDocument(
      baseOptions,
      index.componentsByUri,
      documentUri
    );
    const second = createLanguageServiceOptionsForDocument(
      baseOptions,
      index.componentsByUri,
      documentUri
    );

    expect(second).toBe(first);

    updateIndexedDocument(
      TextDocument.create(
        pathToFileURL(componentFile).toString(),
        "typescript",
        1,
        [
          'import { defineHtml } from "@elfui/core";',
          "",
          "export const CachedButton = defineHtml(`<button></button>`);",
          ""
        ].join("\n")
      ),
      index
    );

    const afterIndexChange = createLanguageServiceOptionsForDocument(
      baseOptions,
      index.componentsByUri,
      documentUri
    );

    expect(afterIndexChange).not.toBe(first);
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

});
