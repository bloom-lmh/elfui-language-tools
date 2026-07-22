import { describe, expect, it } from "vitest";
import * as ts from "typescript";

import init from "../index";

const fileName = "Home.ts";

describe("ElfUI TypeScript server plugin", () => {
  it("filters TS missing-name diagnostics for v-for locals inside defineHtml literals", () => {
    const source = `
      declare const defineHtml: (value: unknown) => unknown;

      const userList = [{ age: 35, id: 1, name: "Ada" }];
      const onUserClick = (user: { id: number }, event: MouseEvent) => {
        user.id;
        event.preventDefault();
      };

      export const Home = defineHtml(\`
        <ul>
          <li v-for="user in userList" :key=\${user.id} @click=\${onUserClick(user, $event)}>
            \${user.name} - \${user.age}
          </li>
        </ul>
      \`);
    `;

    const diagnostics = readPluginDiagnostics(source);

    expect(readDiagnosticMessages(diagnostics).some((message) => message.includes("user"))).toBe(
      false
    );
    expect(readDiagnosticMessages(diagnostics).some((message) => message.includes("$event"))).toBe(
      false
    );
  });

  it("filters the multiline Breadcrumb pattern without leaking the local after its tag", () => {
    const source = `
      declare const defineHtml: (value: unknown) => unknown;

      const visibleItems = () => [
        { current: true, disabled: false, ellipsis: false, key: "home", label: "Home", last: false }
      ];
      const onItemClick = (item: { key: string }, event: MouseEvent) => {
        item.key;
        event.preventDefault();
      };

      export const Breadcrumb = defineHtml(\`
        <ol class="breadcrumb-list">
          <li
            v-for="item in visibleItems()"
            :key=\${item.key + ":" + (item.current ? "active" : "idle") + ":" + (item.last ? "last" : "mid")}
            :class=\${["breadcrumb-item", { "is-current": item.current, "is-disabled": item.disabled, "is-ellipsis": item.ellipsis }]}
          >
            <button
              v-if=\${!item.current && !item.ellipsis}
              :disabled=\${item.disabled}
              @click=\${onItemClick(item, $event)}
            >
              \${item.label}
            </button>
            <span v-else :aria-current=\${item.current ? "page" : ""}>\${item.label}</span>
            <span v-if=\${!item.last}>\${item.label}</span>
          </li>
          \${item.label}
        </ol>
      \`);
    `;

    const diagnostics = readPluginDiagnostics(source);
    const messages = readDiagnosticMessages(diagnostics);

    expect(messages.filter((message) => message === "Cannot find name 'item'.")).toHaveLength(1);
    expect(messages.some((message) => message.includes("$event"))).toBe(false);
  });

  it("filters slot-scope locals only inside their template owner", () => {
    const source = `
      declare const defineHtml: (value: unknown) => unknown;

      export const Slots = defineHtml(\`
        <Child>
          <template #item="{ row }">\${row.label}</template>
        </Child>
        \${row.label}
      \`);
    `;

    const diagnostics = readPluginDiagnostics(source);

    expect(readDiagnosticMessages(diagnostics)).toEqual(["Cannot find name 'row'."]);
  });

  it("keeps ordinary TS missing-name diagnostics in defineHtml interpolations", () => {
    const source = `
      declare const defineHtml: (value: unknown) => unknown;

      export const Home = defineHtml(\`
        <div>\${missingValue}</div>
      \`);
    `;

    const diagnostics = readPluginDiagnostics(source);

    expect(readDiagnosticMessages(diagnostics)).toContain(
      "Cannot find name 'missingValue'."
    );
  });

  it("does not filter v-for locals after the owner tag is closed", () => {
    const source = `
      declare const defineHtml: (value: unknown) => unknown;

      const userList = [{ age: 35, id: 1, name: "Ada" }];

      export const Home = defineHtml(\`
        <ul>
          <li v-for="user in userList">\${user.name}</li>
          \${user.name}
        </ul>
      \`);
    `;

    const diagnostics = readPluginDiagnostics(source);

    expect(readDiagnosticMessages(diagnostics)).toContain("Cannot find name 'user'.");
  });

  it("respects the native template-local suppression setting", () => {
    const source = `
      declare const defineHtml: (value: unknown) => unknown;
      const users = [{ id: 1 }];

      export const Home = defineHtml(\`<li v-for="user in users">\${user.id}</li>\`);
    `;

    const diagnostics = readPluginDiagnostics(source, {
      suppressNativeTemplateLocals: false,
    });

    expect(readDiagnosticMessages(diagnostics).some((message) => message.includes("user"))).toBe(true);
  });
});

const readPluginDiagnostics = (
  source: string,
  config?: { suppressNativeTemplateLocals?: boolean },
): ts.Diagnostic[] => {
  const languageService = createLanguageService(source);
  const createInfo = config === undefined ? { languageService } : { config, languageService };
  const plugin = init({ typescript: ts }).create(createInfo);

  try {
    return plugin.getSemanticDiagnostics(fileName);
  } finally {
    languageService.dispose();
  }
};

const createLanguageService = (source: string): ts.LanguageService => {
  const files = new Map<string, { source: string; version: string }>([
    [fileName, { source, version: "1" }]
  ]);
  const host: ts.LanguageServiceHost = {
    fileExists: (candidate) => files.has(candidate) || ts.sys.fileExists(candidate),
    getCompilationSettings: () => ({
      module: ts.ModuleKind.ESNext,
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.Latest
    }),
    getCurrentDirectory: () => "",
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    getScriptFileNames: () => [...files.keys()],
    getScriptSnapshot: (candidate) => {
      const file = files.get(candidate);

      if (file) {
        return ts.ScriptSnapshot.fromString(file.source);
      }

      return ts.sys.fileExists(candidate)
        ? ts.ScriptSnapshot.fromString(ts.sys.readFile(candidate) ?? "")
        : undefined;
    },
    getScriptVersion: (candidate) => files.get(candidate)?.version ?? "0",
    readFile: (candidate) => files.get(candidate)?.source ?? ts.sys.readFile(candidate)
  };

  return ts.createLanguageService(host, ts.createDocumentRegistry());
};

const readDiagnosticMessages = (diagnostics: ts.Diagnostic[]): string[] =>
  diagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
  );
