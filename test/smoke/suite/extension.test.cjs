const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const extensionManifest = require("../../../package.json");

const EXTENSION_ID = `${extensionManifest.publisher}.${extensionManifest.name}`;
const WORKSPACE_ROOT = path.resolve(__dirname, "..", "workspace");
const FIXTURE_PATH = path.join(WORKSPACE_ROOT, "chain-smoke.ts");
const PACKAGE_JSON_PATH = path.join(WORKSPACE_ROOT, "package.json");
const EXTERNAL_PACKAGE_ROOT = path.join(WORKSPACE_ROOT, "node_modules", "@acme", "elfui-kit");
const CURSOR = "/*cursor*/";

suite("ElfUI Language Features Smoke", function () {
  this.timeout(120000);

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);

    assert(extension, `Expected extension ${EXTENSION_ID} to be available.`);

    if (!extension.isActive) {
      await extension.activate();
    }

    await waitFor(
      () => vscode.extensions.getExtension(EXTENSION_ID)?.isActive === true,
      "extension activation"
    );
  });

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("activates the extension", async () => {
    assert.equal(vscode.extensions.getExtension(EXTENSION_ID)?.isActive, true);
  });

  test("registers expected commands", async () => {
    const commands = await vscode.commands.getCommands(true);

    assert(
      commands.includes("elfui.restartLanguageServer"),
      "Expected elfui.restartLanguageServer command to be registered."
    );
    assert(
      commands.includes("elfui.showOutputChannel"),
      "Expected elfui.showOutputChannel command to be registered."
    );
    [
      "elfui.showComponentStructure",
      "elfui.diagnoseIntegration",
      "elfui.showDynamicPoints",
      "elfui.previewComponent",
      "elfui.migrateTemplateBindings",
      "elfui.showWorkspaceIndexReport",
      "elfui.exportWorkspacePerformanceReport",
      "elfui.clearWorkspacePerformanceHistory",
      "elfui.generateWorkspaceComponentMetadata"
    ].forEach((command) => {
      assert(commands.includes(command), `Expected ${command} command to be registered.`);
    });
  });

  test("provides completions in template with backtick on the next line (multi-line wrapped)", async () => {
    // This matches the user's screenshot 1 pattern:
    //   .template(
    //     `<button @click=...
    //   `
    //   );
    const { document, position } = await openFixtureWithCursor(
      [
        'import { defineHtml } from "@elfui/core";',
        "",
        "export default defineHtml(",
        `  \`<button @${CURSOR}></button>\``,
        ");",
        ""
      ].join("\n")
    );

    const items = await waitForCompletionLabels(document, position, ["@click"]);

    assert(hasCompletionLabel(items, "@click"), "Expected event completion in wrapped template.");
  });

  test("provides framework built-in component completions", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { defineHtml } from "elfui";',
        "",
        "export const Demo = defineHtml(`",
        `  <Trans${CURSOR}`,
        "`);",
        ""
      ].join("\n")
    );

    const items = await waitForCompletionLabels(document, position, ["Transition", "Teleport"]);

    assert(hasCompletionLabel(items, "Transition"), "Expected Transition built-in completion.");
    assert(hasCompletionLabel(items, "Teleport"), "Expected Teleport built-in completion.");
  });

  test("provides focused attribute completions", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { ElfUI } from "elfui";',
        'import Icon from "./Icon";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.props({ disabled: Boolean });",
        'Demo.emits(["submit"]);',
        "Demo.use({ LocalIcon: Icon });",
        'Demo.slot("footer");',
        "Demo.setup(() => ({ count: 0 }));",
        "Demo.template(`",
        `  <button ${CURSOR}></button>`,
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );

    const items = await waitForCompletionLabels(document, position, [
      ":disabled",
      "@submit",
      "v-if",
      "#footer"
    ]);

    assert(hasCompletionLabel(items, ":disabled"), "Expected prop binding completion.");
    assert(hasCompletionLabel(items, "@submit"), "Expected emit completion.");
    assert(hasCompletionLabel(items, "v-if"), "Expected directive completion.");
    assert(hasCompletionLabel(items, "#footer"), "Expected slot completion.");
    assert(!hasCompletionLabel(items, "emit"), "Did not expect expression helper completion.");
    assert(!hasCompletionLabel(items, "LocalIcon"), "Did not expect component tag completion.");
    assert(!hasCompletionLabel(items, "count"), "Did not expect setup variable completion.");
  });

  test("provides event-only completions for @ context", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { ElfUI } from "elfui";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.props({ disabled: Boolean });",
        'Demo.emits(["submit"]);',
        "Demo.template(`",
        `  <button @${CURSOR}></button>`,
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );

    const items = await waitForCompletionLabels(document, position, ["@click", "@submit"]);
    const clickCompletion = items.find((item) => getCompletionLabel(item.label) === "@click");

    assert(hasCompletionLabel(items, "@click"), "Expected DOM event completion.");
    assert(hasCompletionLabel(items, "@submit"), "Expected declared emit completion.");
    assert(!hasCompletionLabel(items, ":disabled"), "Did not expect prop binding completion.");
    assert(!hasCompletionLabel(items, "v-if"), "Did not expect directive completion.");
    assert.match(getCompletionInsertedText(clickCompletion), /@click=\\\$\{\$\{1:handler\}\}/);
  });

  test("provides event modifier-only completions after event dots", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { ElfUI } from "elfui";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.props({ disabled: Boolean });",
        'Demo.emits(["submit"]);',
        "Demo.template(`",
        `  <button @click.${CURSOR}></button>`,
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );

    const items = await waitForCompletionLabels(document, position, [".stop", ".prevent"]);

    assert(hasCompletionLabel(items, ".stop"), "Expected event modifier completion.");
    assert(hasCompletionLabel(items, ".prevent"), "Expected event modifier completion.");
    assert(!hasCompletionLabel(items, "@click"), "Did not expect event name completion.");
    assert(!hasCompletionLabel(items, ":disabled"), "Did not expect prop binding completion.");
  });

  test("auto-completes quotes after event assignments", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { ElfUI } from "elfui";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.template(`",
        `  <button @click=${CURSOR}></button>`,
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );

    const edits = await vscode.commands.executeCommand(
      "vscode.executeFormatOnTypeProvider",
      document.uri,
      position,
      "=",
      { insertSpaces: true, tabSize: 2 }
    );

    assert(
      Array.isArray(edits) && edits.some((edit) => edit.newText === '""'),
      'Expected on-type formatting to insert "".'
    );
  });

  test("provides symbols, references, inlay hints and binding code actions", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { ElfUI } from "elfui";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.props({ disabled: Boolean });",
        'Demo.emits(["submit"]);',
        "Demo.setup(() => ({ count: 0, save() {} }));",
        "Demo.template(`",
        `  <button :disabled="disabled" @click=\${save} :title="count">{{ count${CURSOR} }}</button>`,
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );

    const symbols = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeDocumentSymbolProvider",
        document.uri
      );

      return Array.isArray(value) && value.length > 0 ? value : undefined;
    }, "document symbols");
    const demoSymbol = symbols.find(
      (item) => item.name === "Demo" && item.detail === "ElfUI chain component"
    );
    const childNames = demoSymbol?.children?.map((item) => item.name) ?? [];

    assert(demoSymbol, "Expected Demo document symbol.");
    assert(childNames.includes("count"), "Expected count child symbol.");
    assert(childNames.includes("template"), "Expected template child symbol.");

    const references = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeReferenceProvider",
        document.uri,
        position
      );

      return Array.isArray(value) && value.length >= 3 ? value : undefined;
    }, "template references");

    assert(references.length >= 3, "Expected declaration and template references for count.");

    const highlights = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeDocumentHighlights",
        document.uri,
        position
      );

      return Array.isArray(value) && value.length >= 3 ? value : undefined;
    }, "document highlights");

    assert(highlights.length >= 3, "Expected document highlights for count.");

    const hints = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeInlayHintProvider",
        document.uri,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length))
      );

      return Array.isArray(value) && value.length > 0 ? value : undefined;
    }, "inlay hints");
    const hintLabels = hints.map((item) =>
      typeof item.label === "string" ? item.label : item.label.map((part) => part.value).join("")
    );

    assert(hintLabels.includes("prop"), "Expected prop inlay hint.");
    assert(hintLabels.includes("event"), "Expected event inlay hint.");

    const disabledStart = document.positionAt(document.getText().indexOf(":disabled"));
    const disabledEnd = document.positionAt(
      document.getText().indexOf(':disabled="disabled"') + ':disabled="disabled"'.length
    );
    const actions = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeCodeActionProvider",
        document.uri,
        new vscode.Range(disabledStart, disabledEnd)
      );

      return Array.isArray(value) && value.length > 0 ? value : undefined;
    }, "binding code actions");

    assert(
      actions.some((item) => item.title === "Convert to ElfUI expression binding"),
      "Expected binding style code action."
    );

    const commands = await vscode.commands.getCommands(true);

    if (commands.includes("vscode.provideDocumentSemanticTokens")) {
      const semanticTokens = await waitFor(async () => {
        const value = await vscode.commands.executeCommand(
          "vscode.provideDocumentSemanticTokens",
          document.uri
        );

        return value?.data?.length > 0 ? value : undefined;
      }, "semantic tokens");

      assert(semanticTokens.data.length > 0, "Expected semantic tokens.");
    }
  });

  test("provides declaration quick fixes for template diagnostics", async () => {
    const document = await openFixture(
      [
        'import { ElfUI } from "elfui";',
        "",
        "const Demo = ElfUI.createComponent();",
        'Demo.emits(["submit"]);',
        "Demo.setup(() => ({ count: 0 }));",
        "Demo.template(`",
        "  <button @click=\"emit('cancel')\">{{ count }} {{ missingValue }}</button>",
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );
    const diagnostics = await waitFor(async () => {
      const value = vscode.languages.getDiagnostics(document.uri);

      return value.some((item) => item.message.includes("missingValue")) &&
        value.some((item) => item.message.includes('"cancel"'))
        ? value
        : undefined;
    }, "template declaration diagnostics");
    const missingDiagnostic = diagnostics.find((item) => item.message.includes("missingValue"));
    const cancelDiagnostic = diagnostics.find((item) => item.message.includes('"cancel"'));
    const missingActions = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeCodeActionProvider",
        document.uri,
        missingDiagnostic.range
      );

      return Array.isArray(value) && value.length > 0 ? value : undefined;
    }, "unknown variable quick fixes");
    const cancelActions = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeCodeActionProvider",
        document.uri,
        cancelDiagnostic.range
      );

      return Array.isArray(value) && value.length > 0 ? value : undefined;
    }, "emit quick fixes");

    assert(
      missingActions.some((item) => item.title === 'Expose "missingValue" from setup()'),
      "Expected setup declaration quick fix."
    );
    assert(
      missingActions.some((item) => item.title === 'Declare prop "missingValue"'),
      "Expected prop declaration quick fix."
    );
    assert(
      cancelActions.some((item) => item.title === 'Declare emit "cancel"'),
      "Expected emit declaration quick fix."
    );
  });

  test("provides macro quick fixes for missing state and handlers", async () => {
    const document = await openFixture(
      [
        'import { defineHtml } from "elfui";',
        "",
        "export default defineHtml(`",
        "  <main>",
        "    <h1>{{ title }}</h1>",
        "    <button type=\"button\" @blur=${handler}>Save</button>",
        "  </main>",
        "`);",
        ""
      ].join("\n")
    );
    const diagnostics = await waitFor(async () => {
      const value = vscode.languages.getDiagnostics(document.uri);

      return value.some((item) => item.message.includes("title")) &&
        value.some((item) => item.message.includes("handler"))
        ? value
        : undefined;
    }, "macro missing state and handler diagnostics");
    const titleDiagnostic = diagnostics.find((item) => item.message.includes("title"));
    const handlerDiagnostic = diagnostics.find((item) => item.message.includes("handler"));
    const titleActions = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeCodeActionProvider",
        document.uri,
        titleDiagnostic.range
      );

      return Array.isArray(value) && value.length > 0 ? value : undefined;
    }, "macro state quick fixes");
    const handlerActions = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeCodeActionProvider",
        document.uri,
        handlerDiagnostic.range
      );

      return Array.isArray(value) && value.length > 0 ? value : undefined;
    }, "macro handler quick fixes");

    assert(
      titleActions.some((item) => item.title === 'Create state "title" with useRef()'),
      "Expected useRef state quick fix."
    );
    assert(
      handlerActions.some((item) => item.title === 'Create handler "handler"'),
      "Expected handler quick fix."
    );
    const batchAction = titleActions.find(
      (item) => item.title === "Create all missing template state and handlers"
    );

    assert(batchAction, "Expected batch template declaration quick fix.");
  });

  test("supports quoted v-for completions and repairs untyped list states", async () => {
    const { document: completionDocument, position } = await openFixtureWithCursor(
      [
        'import { defineHtml, useRef } from "elfui";',
        "",
        'const userList = useRef([{ age: 35, name: "Ada" }]);',
        "",
        "export const Home = defineHtml(`",
        "  <ul>",
        `    <li v-for="user in userList" :key="user.${CURSOR}">{{ user.name }}</li>`,
        "  </ul>",
        "`);",
        ""
      ].join("\n")
    );
    const items = await waitForCompletionLabels(completionDocument, position, ["age", "name"]);

    assert(hasCompletionLabel(items, "age"), "Expected age completion in a quoted v-for binding.");
    assert(
      hasCompletionLabel(items, "name"),
      "Expected name completion in a quoted v-for binding."
    );

    const { document: mustacheDocument, position: mustachePosition } = await openFixtureWithCursor(
      [
        'import { defineHtml, defineProps, useRef } from "elfui";',
        "",
        'const props = defineProps({ title: { type: String, default: "" } });',
        'const userList = useRef([{ age: 35, id: 1, name: "Ada" }]);',
        "",
        "export const Home = defineHtml(`",
        "  <ul>",
        `    <li v-for="user in userList" :key="user.id">{{ user.${CURSOR} }}</li>`,
        "  </ul>",
        "`);",
        ""
      ].join("\n")
    );
    const mustacheItems = await waitForCompletionLabels(mustacheDocument, mustachePosition, [
      "age",
      "id",
      "name"
    ]);

    assert(
      hasCompletionLabel(mustacheItems, "name"),
      "Expected name completion in a mustache v-for interpolation."
    );

    const tsDiagnosticDocument = await openFixture(
      [
        'import { defineHtml, useRef } from "elfui";',
        "",
        'const userList = useRef([{ age: 35, id: 1, name: "Ada" }]);',
        "const onUserClick = (user, event) => { event.preventDefault(); return user.id; };",
        "",
        "export const Home = defineHtml(`",
        "  <ul>",
        '    <li v-for="user in userList" :key=${user.id} @click=${onUserClick(user, $event)}>${user.name} - ${user.age}</li>',
        "  </ul>",
        '  <div>${title}</div>',
        "  <div>${missingValue}</div>",
        "`);",
        ""
      ].join("\n")
    );
    const tsDiagnostics = await waitFor(async () => {
      const value = vscode.languages.getDiagnostics(tsDiagnosticDocument.uri);

      return value.some((item) => item.message.includes("missingValue")) ? value : undefined;
    }, "TypeScript template interpolation diagnostics");

    assert(
      !tsDiagnostics.some((item) => item.code === 2304 && item.message.includes("'user'")),
      "Expected TypeScript server plugin to suppress v-for local missing-name diagnostics."
    );
    assert(
      !tsDiagnostics.some(
        (item) =>
          item.message.includes("Cannot find name 'user'") ||
          (item.message.includes("找不到名称") && item.message.includes("user"))
      ),
      "Expected all ElfUI diagnostics to suppress v-for local missing-name diagnostics."
    );
    assert(
      !tsDiagnostics.some((item) => item.code === 2304 && item.message.includes("'$event'")),
      "Expected TypeScript server plugin to suppress event local missing-name diagnostics."
    );
    assert(
      !tsDiagnostics.some((item) => item.code === 2552 && item.message.includes("'title'")),
      "Expected TypeScript server plugin to suppress defineProps template shorthand diagnostics."
    );

    const breadcrumbDocument = await openFixture(
      [
        'import { defineHtml } from "elfui";',
        "",
        'const props = { separator: "/" };',
        'const visibleItems = () => [{ current: true, disabled: false, ellipsis: false, key: "home", label: "Home", last: false }];',
        "const onItemClick = (item, event) => { event.preventDefault(); return item.key; };",
        "",
        "export const Breadcrumb = defineHtml(`",
        '  <nav class="breadcrumb" aria-label="breadcrumb">',
        '    <ol class="breadcrumb-list">',
        "      <li",
        '        v-for="item in visibleItems()"',
        '        :key=${item.key + ":" + (item.current ? "active" : "idle") + ":" + (item.last ? "last" : "mid")}',
        '        :class=${["breadcrumb-item", { "is-current": item.current, "is-disabled": item.disabled, "is-ellipsis": item.ellipsis }]}',
        "      >",
        '        <button v-if=${!item.current && !item.ellipsis} type="button" class="breadcrumb-link" :disabled=${item.disabled} @click=${onItemClick(item, $event)}>${item.label}</button>',
        '        <span v-else class="breadcrumb-text" :aria-current=${item.current ? "page" : ""}>${item.label}</span>',
        '        <span v-if=${!item.last} class="breadcrumb-separator" aria-hidden="true">${props.separator || "/"}</span>',
        "      </li>",
        "    </ol>",
        "  </nav>",
        "`);",
        ""
      ].join("\n")
    );

    await wait(700);

    assert(
      !vscode.languages
        .getDiagnostics(breadcrumbDocument.uri)
        .some((item) => item.message.includes("Unexpected character in tag")),
      "Expected expression bindings to be hidden from the HTML scanner."
    );
    const breadcrumbDiagnostics = vscode.languages.getDiagnostics(breadcrumbDocument.uri);
    const integration = await vscode.commands.executeCommand("elfui.diagnoseIntegration");

    assert(
      !breadcrumbDiagnostics.some(
        (item) =>
          item.code === 2304 &&
          (item.message.includes("'item'") || item.message.includes("'$event'"))
      ),
      `Expected the TypeScript plugin to suppress Breadcrumb v-for local false positives. Diagnostics: ${breadcrumbDiagnostics
        .map((item) => `${item.source ?? "unknown"}:${item.code}:${item.message}`)
        .join("; ")}. Integration: ${JSON.stringify(integration)}`
    );

    assert.equal(integration.document.uri, breadcrumbDocument.uri.toString());
    assert.equal(integration.document.hasElfTemplate, true);
    assert(integration.document.componentCount >= 1, "Expected integration component count.");
    assert(integration.document.templateRegions.length >= 1, "Expected integration template regions.");
    assert(
      typeof integration.diagnostics.bySource === "object",
      "Expected diagnostics grouped by source."
    );
    assert.equal(
      integration.typeScriptPlugin.observableState,
      "effective",
      "Expected the integration diagnostic to observe active template-local suppression."
    );

    const document = await openFixture(
      [
        'import { defineHtml, useRef } from "elfui";',
        "",
        "const userList = useRef();",
        "",
        "export const Home = defineHtml(`",
        "  <ul>",
        '    <li v-for="user in userList" :key="user.name">${user.name}</li>',
        "  </ul>",
        "`);",
        ""
      ].join("\n")
    );
    const diagnostic = await waitFor(async () => {
      const value = vscode.languages.getDiagnostics(document.uri);

      return value.find((item) => item.message.includes("'user' is of type 'unknown'"));
    }, "untyped v-for local diagnostic");
    const actions = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeCodeActionProvider",
        document.uri,
        diagnostic.range
      );

      return Array.isArray(value) && value.length > 0 ? value : undefined;
    }, "typed list state quick fix");
    const action = actions.find(
      (item) => item.title === 'Initialize "userList" as a typed list state'
    );

    assert(action?.edit, "Expected a typed list state quick fix edit.");
    await vscode.workspace.applyEdit(action.edit);

    await waitFor(async () => {
      const value = vscode.languages.getDiagnostics(document.uri);

      return value.some((item) => item.message.includes("is of type 'unknown'"))
        ? undefined
        : value;
    }, "typed list state diagnostics cleanup");
    assert(
      document.getText().includes("useRef<Record<string, unknown>[]>([])"),
      "Expected the quick fix to initialize a typed list state."
    );
  });

  test("provides document links for imports, template assets and style URLs", async () => {
    const document = await openFixture(
      [
        'import Icon from "./Icon";',
        'import { ElfUI } from "elfui";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.template(`",
        '  <img src="./assets/logo.svg"><a href="https://example.com/docs"></a>',
        "`);",
        'Demo.style(`:host { background-image: url("./assets/bg.png"); }`);',
        "Demo.build();",
        ""
      ].join("\n")
    );
    const links = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeLinkProvider",
        document.uri
      );

      return Array.isArray(value) && value.length >= 3 ? value : undefined;
    }, "document links");
    const targets = links.map((item) => item.target?.toString?.() ?? String(item.target ?? ""));

    assert(
      targets.some((target) => target.includes("/Icon")),
      "Expected import document link."
    );
    assert(
      targets.some((target) => target.includes("assets/logo.svg")),
      "Expected template asset document link."
    );
    assert(
      targets.some((target) => target.includes("assets/bg.png")),
      "Expected style URL document link."
    );
    assert(targets.includes("https://example.com/docs"), "Expected external href document link.");
  });

  test("auto-imports workspace components from completions and quick fixes", async () => {
    const importedPath = path.join(WORKSPACE_ROOT, "ImportedButton.ts");

    fs.writeFileSync(
      importedPath,
      [
        'import { defineEmits, defineHtml, defineProps, defineSlots } from "elfui";',
        "",
        "interface Props {",
        "  label: string;",
        "  open?: boolean;",
        "}",
        "",
        "defineProps<Props>();",
        "defineEmits<{ submit: [] }>();",
        "defineSlots<{ item: (scope: { row: { id: number; label: string } }) => unknown }>();",
        "",
        "export const ImportedButton = defineHtml(`<button></button>`);",
        ""
      ].join("\n"),
      "utf8"
    );

    const importedDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(importedPath));
    await vscode.window.showTextDocument(importedDocument, { preview: false });
    await wait(500);

    const workspaceSymbols = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeWorkspaceSymbolProvider",
        "ImportedButton"
      );

      return Array.isArray(value) && value.some((item) => item.name === "ImportedButton")
        ? value
        : undefined;
    }, "workspace component symbols");

    assert(
      workspaceSymbols.some((item) => item.name === "ImportedButton"),
      "Expected workspace symbol for imported component."
    );
    assert(
      workspaceSymbols.some((item) => item.name === "ImportedButton.label"),
      "Expected workspace symbol for imported component prop."
    );

    const { document, position } = await openFixtureWithCursor(
      [
        'import { ElfUI } from "elfui";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.template(`",
        `  <Imported${CURSOR}`,
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );
    const items = await waitForCompletionLabels(document, position, ["ImportedButton"]);
    const completion = items.find((item) => getCompletionLabel(item.label) === "ImportedButton");
    const additionalText = completion?.additionalTextEdits?.map((edit) => edit.newText) ?? [];

    assert(completion, "Expected imported component completion.");
    assert(
      additionalText.some((text) => text.includes('ImportedButton } from "./ImportedButton"')),
      "Expected imported component completion to add an import."
    );
    assert(
      additionalText.some((text) => text.includes("Demo.use({ ImportedButton });")),
      "Expected imported component completion to register the component."
    );

    const quickFixDocument = await openFixture(
      [
        'import { ElfUI } from "elfui";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.template(`",
        "  <ImportedButton></ImportedButton>",
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );
    const diagnostic = await waitFor(async () => {
      const value = vscode.languages
        .getDiagnostics(quickFixDocument.uri)
        .find((item) => item.message.includes("ImportedButton"));

      return value;
    }, "unregistered component diagnostic");
    const actions = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeCodeActionProvider",
        quickFixDocument.uri,
        diagnostic.range
      );

      return Array.isArray(value) && value.length > 0 ? value : undefined;
    }, "component auto import code action");

    assert(
      actions.some((item) => item.title === "Import and register <ImportedButton>"),
      "Expected auto import component quick fix."
    );

    const metadataDocument = await openFixture(
      [
        'import { ElfUI } from "elfui";',
        'import { ImportedButton } from "./ImportedButton";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.use({ ImportedButton });",
        "Demo.setup(() => ({ label: 'Save', open: true, save() {} }));",
        "Demo.template(`",
        '  <ImportedButton :label="label" :missing="label" v-model:ghost="open" @submit="save" @cancel="save">',
        '    <template #item="{ row }">{{ row.label }}</template>',
        "    <template #ghost></template>",
        "  </ImportedButton>",
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );
    const metadataMessages = await waitFor(async () => {
      const value = vscode.languages
        .getDiagnostics(metadataDocument.uri)
        .map((item) => item.message);

      return value.some((message) => message.includes('Prop "missing"')) &&
        value.some((message) => message.includes('Event "cancel"')) &&
        value.some((message) => message.includes('Slot "ghost"'))
        ? value
        : undefined;
    }, "workspace component metadata diagnostics");

    assert(
      metadataMessages.some((message) => message.includes('Prop "ghost"')),
      "Expected v-model argument to use workspace prop metadata."
    );

    const metadataText = metadataDocument.getText();
    const importedUri = importedDocument.uri.toString();
    const tagDefinition = await waitForDefinitionTarget(
      metadataDocument,
      metadataDocument.positionAt(metadataText.indexOf("<ImportedButton") + 2),
      importedUri,
      "workspace component tag definition"
    );
    const propDefinition = await waitForDefinitionTarget(
      metadataDocument,
      metadataDocument.positionAt(metadataText.indexOf(":label") + 2),
      importedUri,
      "workspace component prop definition"
    );
    const eventDefinition = await waitForDefinitionTarget(
      metadataDocument,
      metadataDocument.positionAt(metadataText.indexOf("@submit") + 2),
      importedUri,
      "workspace component event definition"
    );

    assert(tagDefinition, "Expected workspace component tag definition.");
    assert(propDefinition, "Expected workspace component prop definition.");
    assert(eventDefinition, "Expected workspace component event definition.");

    const tagReferences = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeReferenceProvider",
        metadataDocument.uri,
        metadataDocument.positionAt(metadataText.indexOf("<ImportedButton") + 2)
      );

      return Array.isArray(value) && value.length >= 3 ? value : undefined;
    }, "workspace component tag references");
    const propReferences = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeReferenceProvider",
        metadataDocument.uri,
        metadataDocument.positionAt(metadataText.indexOf(":label") + 2)
      );

      return Array.isArray(value) && value.length >= 2 ? value : undefined;
    }, "workspace component prop references");
    const renameEdit = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeDocumentRenameProvider",
        metadataDocument.uri,
        metadataDocument.positionAt(metadataText.indexOf("<ImportedButton") + 2),
        "SecondaryButton"
      );

      return readWorkspaceEditTexts(value).length > 0 ? value : undefined;
    }, "workspace component current-file rename");
    const renameTexts = readWorkspaceEditTexts(renameEdit);
    const renameUris = readWorkspaceEditUris(renameEdit);

    assert(tagReferences.length >= 3, "Expected workspace component tag references.");
    assert(propReferences.length >= 2, "Expected workspace component prop references.");
    assert(renameTexts.includes("SecondaryButton"), "Expected current-file component rename edit.");
    assert(
      renameUris.includes(importedUri),
      "Expected workspace component rename to include the external declaration file."
    );

    const tagHighlights = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeDocumentHighlights",
        metadataDocument.uri,
        metadataDocument.positionAt(metadataText.indexOf("<ImportedButton") + 2)
      );

      return Array.isArray(value) && value.length >= 2 ? value : undefined;
    }, "workspace component tag highlights");

    assert(tagHighlights.length >= 2, "Expected workspace component tag highlights.");

    const slotScopeLabels = await waitForCompletionLabels(
      metadataDocument,
      metadataDocument.positionAt(metadataText.indexOf("{{ row.") + "{{ row.".length),
      ["id", "label"]
    );

    assert(hasCompletionLabel(slotScopeLabels, "id"), "Expected scoped slot row.id completion.");
    assert(
      hasCompletionLabel(slotScopeLabels, "label"),
      "Expected scoped slot row.label completion."
    );
  });

  test("indexes external package component metadata for completions and diagnostics", async () => {
    cleanupExternalPackageMetadata();
    writeExternalPackageMetadata();

    try {
      await vscode.commands.executeCommand("elfui.restartLanguageServer");
      await wait(1000);

      const { document, position } = await openFixtureWithCursor(
        [
          'import { ElfUI } from "elfui";',
          "",
          "const Demo = ElfUI.createComponent();",
          "Demo.template(`",
          `  <Package${CURSOR}`,
          "`);",
          "Demo.build();",
          ""
        ].join("\n")
      );
      const items = await waitForCompletionLabels(document, position, ["PackageButton"]);
      const completion = items.find((item) => getCompletionLabel(item.label) === "PackageButton");
      const additionalText = completion?.additionalTextEdits?.map((edit) => edit.newText) ?? [];

      assert(completion, "Expected external package component completion.");
      assert(
        additionalText.some((text) => text.includes('PackageButton } from "@acme/elfui-kit"')),
        "Expected external package completion to import from the package name."
      );
      assert(
        additionalText.some((text) => text.includes("Demo.use({ PackageButton });")),
        "Expected external package completion to register the component."
      );

      const usageDocument = await openFixture(
        [
          'import { ElfUI } from "elfui";',
          'import { PackageButton } from "@acme/elfui-kit";',
          "",
          "const Demo = ElfUI.createComponent();",
          "Demo.use({ PackageButton });",
          "Demo.setup(() => ({",
          '  action: { label: "Save", disabled: false },',
          "  confirm() {},",
          "  label: 'Save',",
          "  open: true",
          "}));",
          "Demo.template(`",
          '  <PackageButton :label="label" v-model:open="open" @confirm="confirm">',
          '    <template #footer="{ action }">{{ action.disabled }}</template>',
          "  </PackageButton>",
          "`);",
          "Demo.build();",
          ""
        ].join("\n")
      );
      const usageText = usageDocument.getText();
      const slotScopeLabels = await waitForCompletionLabels(
        usageDocument,
        usageDocument.positionAt(usageText.indexOf("{{ action.") + "{{ action.".length),
        ["disabled", "label"]
      );
      const diagnostics = vscode.languages
        .getDiagnostics(usageDocument.uri)
        .map((item) => item.message);

      assert(
        hasCompletionLabel(slotScopeLabels, "disabled"),
        "Expected package slot scope disabled completion."
      );
      assert(
        hasCompletionLabel(slotScopeLabels, "label"),
        "Expected package slot scope label completion."
      );
      assert(
        !diagnostics.some(
          (message) =>
            message.includes('Prop "label"') ||
            message.includes('Prop "open"') ||
            message.includes('Event "confirm"') ||
            message.includes('Slot "footer"') ||
            message.includes("PackageButton")
        ),
        `Expected external package component usage to be clean. Diagnostics: ${diagnostics.join("; ")}`
      );

      const componentHover = await waitForHoverText(
        usageDocument,
        usageDocument.positionAt(usageText.indexOf("<PackageButton") + 1),
        "Props: `label`, `open`"
      );
      const slotHover = await waitForHoverText(
        usageDocument,
        usageDocument.positionAt(usageText.indexOf("#footer") + 1),
        "Scope: `{ action: { disabled: boolean; label: string } }`"
      );
      const propHover = await waitForHoverText(
        usageDocument,
        usageDocument.positionAt(usageText.indexOf(":open") + 1),
        "Type: `boolean`"
      );
      const eventHover = await waitForHoverText(
        usageDocument,
        usageDocument.positionAt(usageText.indexOf("@confirm") + 1),
        "Payload: `{ value: string }`"
      );

      assert.match(componentHover, /@acme\/elfui-kit/, "Expected package import hover metadata.");
      assert.match(slotHover, /ElfUI slot/, "Expected package slot hover metadata.");
      assert.match(propHover, /Default: `false`/, "Expected package prop default hover metadata.");
      assert.match(eventHover, /ElfUI event/, "Expected package event hover metadata.");
    } finally {
      cleanupExternalPackageMetadata();
      await vscode.commands.executeCommand("elfui.restartLanguageServer");
      await wait(500);
    }
  });

  test("generates package metadata from cached workspace components", async () => {
    const componentPath = path.join(WORKSPACE_ROOT, "GeneratedMetadataButton.ts");
    const metadataPath = path.join(WORKSPACE_ROOT, "elfui.components.json");
    const originalPackage = readFileIfPresent(PACKAGE_JSON_PATH);
    const originalMetadata = readFileIfPresent(metadataPath);

    try {
      fs.writeFileSync(
        PACKAGE_JSON_PATH,
        JSON.stringify({ name: "generated-elfui-kit", version: "1.0.0" }, null, 2),
        "utf8"
      );
      fs.writeFileSync(
        componentPath,
        [
          'import { defineHtml, defineProps } from "elfui";',
          "",
          "interface Props { label: string; }",
          "defineProps<Props>();",
          "",
          "export const GeneratedMetadataButton = defineHtml(`<button>{{ label }}</button>`);",
          ""
        ].join("\n"),
        "utf8"
      );
      await vscode.commands.executeCommand("elfui.restartLanguageServer");
      await wait(1000);

      const first = await vscode.commands.executeCommand("elfui.generateWorkspaceComponentMetadata");
      const firstResult = Array.isArray(first) ? first[0] : undefined;
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));

      assert.equal(firstResult?.components >= 1, true, "Expected generated component metadata.");
      assert.equal(firstResult?.manifestUpdated, true, "Expected package metadata declaration update.");
      assert.equal(firstResult?.metadataWritten, true, "Expected metadata file write.");
      assert.equal(packageJson.elfui?.languageTools?.components, "./elfui.components.json");
      assert.deepEqual(
        metadata.components.find((item) => item.localName === "GeneratedMetadataButton")?.props,
        [{ name: "label", type: "string" }]
      );

      const second = await vscode.commands.executeCommand("elfui.generateWorkspaceComponentMetadata");
      const secondResult = Array.isArray(second) ? second[0] : undefined;

      assert.equal(secondResult?.manifestUpdated, false, "Expected unchanged manifest to skip writes.");
      assert.equal(secondResult?.metadataWritten, false, "Expected unchanged metadata to skip writes.");
    } finally {
      restoreFile(PACKAGE_JSON_PATH, originalPackage);
      restoreFile(metadataPath, originalMetadata);
      fs.rmSync(componentPath, { force: true });
      await vscode.commands.executeCommand("elfui.restartLanguageServer");
      await wait(500);
    }
  });

  test("indexes ui-kit style macro components with aliases, models and typed slots", async () => {
    const actionPath = path.join(WORKSPACE_ROOT, "DialogActionButton.ts");
    const dialogPath = path.join(WORKSPACE_ROOT, "UiDialog.ts");

    fs.writeFileSync(
      actionPath,
      [
        'import { defineHtml } from "elfui";',
        "",
        "export const DialogActionButton = defineHtml(`<button><slot></slot></button>`);",
        ""
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      dialogPath,
      [
        'import { defineEmits, defineHtml, defineModel, defineProps, defineSlots, useComponents } from "elfui";',
        'import { DialogActionButton } from "./DialogActionButton";',
        "",
        "interface DialogProps {",
        "  title: string;",
        "  disabled?: boolean;",
        "}",
        "",
        "defineProps<DialogProps>();",
        'const open = defineModel("open");',
        "const value = defineModel();",
        "defineEmits<{ confirm: [] }>();",
        "defineSlots<{",
        "  footer: (scope: { action: { label: string; disabled: boolean } }) => unknown;",
        "}>();",
        "useComponents({ DialogAction: DialogActionButton });",
        "",
        "export const UiDialog = defineHtml(`",
        "  <article>",
        "    <header>{{ title }}</header>",
        "    <DialogAction>{{ value }}</DialogAction>",
        '    <footer><slot name="footer"></slot></footer>',
        "  </article>",
        "`);",
        ""
      ].join("\n"),
      "utf8"
    );

    const dialogDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(dialogPath));
    await vscode.window.showTextDocument(dialogDocument, { preview: false });

    const workspaceSymbols = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeWorkspaceSymbolProvider",
        "UiDialog"
      );

      return Array.isArray(value) &&
        value.some((item) => item.name === "UiDialog") &&
        value.some((item) => item.name === "UiDialog.open")
        ? value
        : undefined;
    }, "ui-kit macro workspace symbols");

    assert(
      workspaceSymbols.some((item) => item.name === "UiDialog.footer"),
      "Expected typed slot symbol from defineSlots."
    );

    const { document: completionDocument, position } = await openFixtureWithCursor(
      [
        'import { ElfUI } from "elfui";',
        'import { UiDialog } from "./UiDialog";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.use({ ModalAlias: UiDialog });",
        "Demo.template(`",
        `  <ModalAlias ${CURSOR}></ModalAlias>`,
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );
    const completionItems = await waitForCompletionLabels(completionDocument, position, [
      ":title",
      "@confirm",
      "#footer"
    ]);

    assert(hasCompletionLabel(completionItems, ":title"), "Expected prop completion from macro.");
    assert(hasCompletionLabel(completionItems, "@confirm"), "Expected emit completion from macro.");
    assert(hasCompletionLabel(completionItems, "#footer"), "Expected slot completion from macro.");

    const usageDocument = await openFixture(
      [
        'import { ElfUI } from "elfui";',
        'import { UiDialog } from "./UiDialog";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.use({ ModalAlias: UiDialog });",
        "Demo.setup(() => ({",
        '  action: { label: "Save", disabled: false },',
        "  confirm() {},",
        "  open: true,",
        '  title: "Settings",',
        '  value: "draft"',
        "}));",
        "Demo.template(`",
        '  <ModalAlias :title="title" v-model:open="open" v-model="value" @confirm="confirm">',
        '    <template #footer="{ action }">{{ action.label }}</template>',
        "  </ModalAlias>",
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );
    const usageText = usageDocument.getText();
    const slotScopeLabels = await waitForCompletionLabels(
      usageDocument,
      usageDocument.positionAt(usageText.indexOf("{{ action.") + "{{ action.".length),
      ["label", "disabled"]
    );

    assert(hasCompletionLabel(slotScopeLabels, "label"), "Expected slot scope label completion.");
    assert(
      hasCompletionLabel(slotScopeLabels, "disabled"),
      "Expected slot scope disabled completion."
    );

    const diagnostics = vscode.languages
      .getDiagnostics(usageDocument.uri)
      .map((item) => item.message);

    assert(
      !diagnostics.some(
        (message) =>
          message.includes('Prop "open"') ||
          message.includes('Prop "modelValue"') ||
          message.includes('Event "confirm"') ||
          message.includes('Slot "footer"') ||
          message.includes("ModalAlias")
      ),
      `Expected ui-kit macro alias usage to be clean. Diagnostics: ${diagnostics.join("; ")}`
    );
  });

  test("provides TypeScript member completions inside template expressions", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { defineHtml, defineProps } from "elfui";',
        "",
        "interface Props {",
        "  disabled?: boolean;",
        "  label: string;",
        "}",
        "",
        "const props = defineProps<Props>();",
        "export const Demo = defineHtml(`",
        `  <button :title=\${props.${CURSOR}label}></button>`,
        "`);",
        ""
      ].join("\n")
    );

    const items = await waitForCompletionLabels(document, position, ["disabled", "label"]);

    assert(hasCompletionLabel(items, "disabled"), "Expected typed prop completion.");
    assert(hasCompletionLabel(items, "label"), "Expected typed prop completion.");
  });

  test("provides DOM event member completions inside template expressions", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { defineHtml } from "elfui";',
        "",
        "export const Demo = defineHtml(`",
        `  <input @input=\${$event.${CURSOR}} />`,
        "`);",
        ""
      ].join("\n")
    );

    const items = await waitForCompletionLabels(document, position, ["data", "inputType"]);

    assert(hasCompletionLabel(items, "data"), "Expected InputEvent data completion.");
    assert(hasCompletionLabel(items, "inputType"), "Expected InputEvent inputType completion.");
  });

  test("provides ElfUI Studio structure, dynamic point, preview, migration and index commands", async () => {
    const studioDocument = await openFixture(
      [
        'import { defineHtml, useRef } from "elfui";',
        "",
        "const users = useRef([{ id: 1, name: 'Ada' }]);",
        "const save = () => {};",
        "const title = 'Users';",
        "const visible = true;",
        "",
        "export const StudioDemo = defineHtml(`",
        '  <section :title=${title} v-if=${visible}>',
        '    <button @click=${save}>{{ title }}</button>',
        '    <ul><li v-for="user in users" :key=${user.id}>${user.name}</li></ul>',
        "  </section>",
        "`);",
        ""
      ].join("\n")
    );

    const structure = await vscode.commands.executeCommand("elfui.showComponentStructure");

    assert.equal(structure.components, 1);
    assert(structure.dynamicPoints >= 5, "Expected structure summary to include dynamic points.");

    const dynamicReport = await vscode.commands.executeCommand("elfui.showDynamicPoints");

    assert.equal(dynamicReport.components, 1);
    assert(
      dynamicReport.points.some((point) => point.effect.includes("branch")),
      "Expected branch dynamic point report."
    );
    assert(
      dynamicReport.points.some((point) => point.effect.includes("list")),
      "Expected list dynamic point report."
    );

    const preview = await vscode.commands.executeCommand("elfui.previewComponent");

    assert.equal(preview.component, "StudioDemo");
    assert(preview.htmlLength > 500, "Expected preview webview content.");

    const indexReport = await vscode.commands.executeCommand("elfui.showWorkspaceIndexReport");

    assert(indexReport.filesScanned > 0, "Expected workspace index report to scan files.");
    assert(indexReport.durationMs >= 0, "Expected workspace index report duration.");
    assert(
      indexReport.languageServer?.index?.length > 0,
      "Expected workspace index report to include language-server index samples.",
    );
    assert(
      indexReport.languageServer?.completion?.count > 0,
      "Expected workspace index report to include language-server completion latency.",
    );
    assert(
      indexReport.history?.some((item) => item.recordedAt === indexReport.recordedAt),
      "Expected workspace index report to persist its latest sample.",
    );

    await vscode.window.showTextDocument(studioDocument, { preview: false });

    const migrationDocument = await openFixture(
      [
        'import { ElfUI } from "elfui";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.setup(() => ({ items: [], save() {}, title: 'Hi', visible: true }));",
        "Demo.template(`",
        '  <button v-if="visible" :title="title" @click="save" v-for="item in items">{{ item }}</button>',
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );
    const migrated = await vscode.commands.executeCommand("elfui.migrateTemplateBindings");
    const migratedText = migrationDocument.getText();

    assert.equal(migrated, 3);
    assert(migratedText.includes("v-if=${visible}"), "Expected v-if migration.");
    assert(migratedText.includes(":title=${title}"), "Expected dynamic prop migration.");
    assert(migratedText.includes("@click=${save}"), "Expected event migration.");
    assert(
      migratedText.includes('v-for="item in items"'),
      "Expected v-for declaration to stay quoted."
    );
  });

  test("exports and clears workspace performance history", async () => {
    const performancePath = path.join(WORKSPACE_ROOT, ".elfui", "performance-report.json");
    const originalReport = readFileIfPresent(performancePath);

    try {
      const indexReport = await vscode.commands.executeCommand("elfui.showWorkspaceIndexReport");
      const exported = await vscode.commands.executeCommand("elfui.exportWorkspacePerformanceReport");
      const exportedReport = JSON.parse(fs.readFileSync(performancePath, "utf8"));

      assert.equal(exported?.history >= 1, true, "Expected exported performance history.");
      assert.equal(exported?.wrote, true, "Expected performance export write.");
      assert(
        exportedReport.reports.some((item) => item.recordedAt === indexReport.recordedAt),
        "Expected exported report history to include the latest scan."
      );

      const cleared = await vscode.commands.executeCommand("elfui.clearWorkspacePerformanceHistory");

      assert.equal(cleared >= 1, true, "Expected persisted performance history to clear.");

      const refreshed = await vscode.commands.executeCommand("elfui.showWorkspaceIndexReport");

      assert.equal(refreshed.history.length, 1, "Expected new report history after clearing.");
    } finally {
      restoreFile(performancePath, originalReport);
      removeDirectoryIfEmpty(path.dirname(performancePath));
      await vscode.commands.executeCommand("elfui.clearWorkspacePerformanceHistory");
    }
  });

  test("provides style completions", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { ElfUI } from "elfui";',
        "",
        "const Demo = ElfUI.createComponent();",
        'Demo.template(`<button part="control"></button><slot name="prefix"></slot>`);',
        "Demo.style(`",
        "  :host { --elf-accent: red; }",
        `  :host { col${CURSOR} }`,
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );

    const items = await waitForCompletionLabels(document, position, [
      "color",
      ":host",
      ":host-context()",
      "::part(control)",
      '[part~="control"]',
      '::slotted([slot="prefix"])',
      "var(--*)",
      "var(--elf-accent)"
    ]);

    assert(hasCompletionLabel(items, "color"), "Expected CSS completion.");
    assert(hasCompletionLabel(items, ":host"), "Expected ElfUI host snippet completion.");
    assert(
      hasCompletionLabel(items, ":host-context()"),
      "Expected ElfUI host context snippet completion."
    );
    assert(
      hasCompletionLabel(items, "::part(control)"),
      "Expected template part selector completion."
    );
    assert(
      hasCompletionLabel(items, '[part~="control"]'),
      "Expected local part attribute selector completion."
    );
    assert(
      hasCompletionLabel(items, '::slotted([slot="prefix"])'),
      "Expected template slot selector completion."
    );
    assert(hasCompletionLabel(items, "var(--*)"), "Expected ElfUI CSS variable completion.");
    assert(
      hasCompletionLabel(items, "var(--elf-accent)"),
      "Expected declared CSS variable completion."
    );
  });

  test("provides globalStyle completions", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { ElfUI } from "elfui";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.globalStyle(`",
        `  :root { col${CURSOR} }`,
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );

    const items = await waitForCompletionLabels(document, position, ["color", ":host", "var(--*)"]);

    assert(hasCompletionLabel(items, "color"), "Expected CSS completion.");
    assert(hasCompletionLabel(items, ":host"), "Expected ElfUI host snippet completion.");
    assert(hasCompletionLabel(items, "var(--*)"), "Expected ElfUI CSS variable completion.");
  });

  test("provides Web Components style hover help", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { ElfUI } from "elfui";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.style(`",
        `  :host-context${CURSOR}(.dark) {`,
        "    --elf-accent: red;",
        "    color: var(--elf-accent);",
        "  }",
        "  ::part(control) { color: red; }",
        '  ::slotted([slot="prefix"]) { color: blue; }',
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );

    const hoverText = await waitForHoverText(document, position, ":host-context()");

    assert.match(hoverText, /ElfUI component host/, "Expected ElfUI style hover text.");
  });

  test("auto-completes closing tags", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { ElfUI } from "elfui";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.template(`",
        `  <div>${CURSOR}`,
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );

    const edits = await vscode.commands.executeCommand(
      "vscode.executeFormatOnTypeProvider",
      document.uri,
      position,
      ">",
      { insertSpaces: true, tabSize: 2 }
    );

    assert(
      Array.isArray(edits) && edits.some((edit) => edit.newText === "</div>"),
      "Expected on-type formatting to insert </div>."
    );
  });

  test("provides folding, selection and linked editing ranges", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { ElfUI } from "elfui";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.template(`",
        "  <section>",
        `    <button>${CURSOR}Save</button>`,
        "  </section>",
        "`);",
        "Demo.style(`",
        "  :host {",
        "    color: red;",
        "  }",
        "`);",
        "Demo.build();",
        ""
      ].join("\n")
    );
    const text = document.getText();
    const foldingRanges = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeFoldingRangeProvider",
        document.uri
      );

      return Array.isArray(value) && value.some((range) => range.end > range.start)
        ? value
        : undefined;
    }, "folding ranges");
    const selectionRanges = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeSelectionRangeProvider",
        document.uri,
        [position]
      );

      return Array.isArray(value) && value[0]?.range?.contains(position) ? value : undefined;
    }, "selection ranges");
    const commands = await vscode.commands.getCommands(true);
    let linked = [];

    if (commands.includes("vscode.executeLinkedEditingRangeProvider")) {
      linked = await waitFor(async () => {
        const value = await vscode.commands.executeCommand(
          "vscode.executeLinkedEditingRangeProvider",
          document.uri,
          document.positionAt(text.indexOf("<button") + 2)
        );
        const ranges = Array.isArray(value) ? value : value?.ranges;

        return Array.isArray(ranges) && ranges.length >= 2 ? ranges : undefined;
      }, "linked editing ranges");
    }

    assert(foldingRanges.length >= 2, "Expected embedded folding ranges.");
    assert(selectionRanges.length >= 1, "Expected embedded selection range.");
    assert(
      linked.length >= 2 || !commands.includes("vscode.executeLinkedEditingRangeProvider"),
      "Expected linked editing ranges for <button> pair when VS Code exposes the execute command."
    );
  });

  test("formats embedded template and style strings", async () => {
    const document = await openFixture(
      [
        'import { ElfUI } from "elfui";',
        "",
        "const Demo = ElfUI.createComponent();",
        "Demo.template(`<section>",
        "<button>{{ count }}</button>",
        "</section>`);",
        "Demo.style(`:host{color:red;display:block;}`);",
        "Demo.build();",
        ""
      ].join("\n")
    );

    const edits = await waitFor(async () => {
      const value = await vscode.commands.executeCommand(
        "vscode.executeFormatDocumentProvider",
        document.uri,
        { insertSpaces: true, tabSize: 2 }
      );

      return Array.isArray(value) && value.length > 0 ? value : undefined;
    }, "document formatting edits");
    const formatted = applyTextEdits(document.getText(), document, edits);

    assert.match(
      formatted,
      /Demo\.template\(`\n\s*<section>\n\s*<button>{{ count }}<\/button>\n\s*<\/section>/
    );
    assert.match(
      formatted,
      /Demo\.style\(`\n\s*:host \{\n\s*color: red;\n\s*display: block;\n\s*\}/
    );
  });

  test("applies the configured component tag color to real ElfUI TextMate scopes", async () => {
    const editorConfiguration = vscode.workspace.getConfiguration("editor");
    const rule = await waitFor(
      () => readElfComponentTagColorRule(editorConfiguration, "#4299e1"),
      () =>
        `configured component tag color rule; current value: ${JSON.stringify(
          editorConfiguration.get("tokenColorCustomizations", {})
        )}`
    );

    assert.deepEqual(rule.scope, [
      "support.class.component.elfui",
      "entity.name.tag.component.elfui",
      "punctuation.definition.tag.elfui"
    ]);
    assert.equal(rule.settings.foreground, "#4299e1");
  });
});

function writeExternalPackageMetadata() {
  const metadataPath = path.join(EXTERNAL_PACKAGE_ROOT, "dist", "elfui.components.json");

  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(
    PACKAGE_JSON_PATH,
    JSON.stringify(
      {
        dependencies: {
          "@acme/elfui-kit": "1.0.0"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  fs.writeFileSync(
    path.join(EXTERNAL_PACKAGE_ROOT, "package.json"),
    JSON.stringify(
      {
        elfui: {
          languageTools: {
            components: "./dist/elfui.components.json"
          }
        },
        name: "@acme/elfui-kit",
        version: "1.0.0"
      },
      null,
      2
    ),
    "utf8"
  );
  fs.writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        components: [
          {
            emits: [{ name: "confirm", payloadType: "{ value: string }" }],
            exportName: "PackageButton",
            localName: "PackageButton",
            props: [
              { name: "label", type: "string" },
              { default: false, name: "open", type: "boolean" }
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
      },
      null,
      2
    ),
    "utf8"
  );
}

function cleanupExternalPackageMetadata() {
  fs.rmSync(PACKAGE_JSON_PATH, { force: true });
  fs.rmSync(EXTERNAL_PACKAGE_ROOT, { force: true, recursive: true });
  removeDirectoryIfEmpty(path.dirname(EXTERNAL_PACKAGE_ROOT));
  removeDirectoryIfEmpty(path.join(WORKSPACE_ROOT, "node_modules"));
}

function readFileIfPresent(fileName) {
  try {
    return fs.readFileSync(fileName, "utf8");
  } catch {
    return undefined;
  }
}

function restoreFile(fileName, content) {
  if (content === undefined) {
    fs.rmSync(fileName, { force: true });
    return;
  }

  fs.mkdirSync(path.dirname(fileName), { recursive: true });
  fs.writeFileSync(fileName, content, "utf8");
}

function removeDirectoryIfEmpty(directory) {
  try {
    fs.rmdirSync(directory);
  } catch {
    // Keep non-empty or missing directories untouched.
  }
}

async function openFixture(content) {
  fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  const fixtureUri = vscode.Uri.file(FIXTURE_PATH);
  const existing = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === fixtureUri.toString()
  );

  if (existing?.isDirty) {
    await existing.save();
  }

  fs.writeFileSync(FIXTURE_PATH, content, "utf8");

  const document = await vscode.workspace.openTextDocument(fixtureUri);
  await vscode.window.showTextDocument(document, { preview: false });

  await waitFor(
    () => (document.getText() === content ? document : undefined),
    "fixture source update"
  );

  return document;
}

async function openFixtureWithCursor(contentWithCursor) {
  const cursorOffset = contentWithCursor.indexOf(CURSOR);

  assert.notEqual(cursorOffset, -1, `Expected fixture content to include ${CURSOR}.`);

  const document = await openFixture(contentWithCursor.replace(CURSOR, ""));
  const position = document.positionAt(cursorOffset);
  const editor = vscode.window.activeTextEditor;

  if (editor && editor.document.uri.toString() === document.uri.toString()) {
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
  }

  return { document, position };
}

async function waitForCompletionLabels(document, position, labels) {
  let lastLabels = [];

  return waitFor(
    async () => {
      const completionList = await vscode.commands.executeCommand(
        "vscode.executeCompletionItemProvider",
        document.uri,
        position
      );

      if (!completionList) {
        return undefined;
      }

      const items = completionList.items ?? [];
      lastLabels = items.map((item) => getCompletionLabel(item.label)).filter(Boolean);

      return labels.every((label) => hasCompletionLabel(items, label)) ? items : undefined;
    },
    () =>
      `completion labels: ${labels.join(", ")}; last labels: ${lastLabels.slice(0, 60).join(", ")}`
  );
}

async function waitForHoverText(document, position, expectedText) {
  let lastText = "";

  return waitFor(
    async () => {
      const hovers = await vscode.commands.executeCommand(
        "vscode.executeHoverProvider",
        document.uri,
        position
      );

      lastText = Array.isArray(hovers) ? hovers.map(readHoverText).join("\n") : "";

      return lastText.includes(expectedText) ? lastText : undefined;
    },
    () => `hover text containing ${expectedText}; last text: ${lastText.slice(0, 300)}`
  );
}

async function waitForDefinitionTarget(document, positionOrPositions, targetUri, description) {
  const positions = Array.isArray(positionOrPositions)
    ? positionOrPositions
    : [positionOrPositions];

  return waitFor(async () => {
    for (const position of positions) {
      const definitions = await vscode.commands.executeCommand(
        "vscode.executeDefinitionProvider",
        document.uri,
        position
      );

      if (!Array.isArray(definitions)) {
        continue;
      }

      const definition = definitions.find((item) => readDefinitionUri(item) === targetUri);

      if (definition) {
        return definition;
      }
    }

    return undefined;
  }, description);
}

function readDefinitionUri(definition) {
  return definition.targetUri?.toString?.() ?? definition.uri?.toString?.() ?? "";
}

function readWorkspaceEditTexts(edit) {
  if (!edit) {
    return [];
  }

  if (typeof edit.entries === "function") {
    return edit.entries().flatMap(([, edits]) => edits.map((item) => item.newText));
  }

  return Object.values(edit.changes ?? {})
    .flat()
    .map((item) => item.newText);
}

function readWorkspaceEditUris(edit) {
  if (!edit) {
    return [];
  }

  if (typeof edit.entries === "function") {
    return edit.entries().map(([uri]) => uri.toString());
  }

  return Object.keys(edit.changes ?? {});
}

function readElfComponentTagColorRule(configuration, foreground) {
  const customizations = configuration.get("tokenColorCustomizations", {});
  const rules = Array.isArray(customizations?.textMateRules) ? customizations.textMateRules : [];

  return rules.find(
    (rule) =>
      rule?.name === "ElfUI component tag color" && rule?.settings?.foreground === foreground
  );
}

function hasCompletionLabel(items, expectedLabel) {
  return items.some((item) => getCompletionLabel(item.label) === expectedLabel);
}

function getCompletionLabel(label) {
  return typeof label === "string" ? label : label?.label;
}

function getCompletionInsertedText(item) {
  if (!item) {
    return "";
  }

  if (typeof item.insertText === "string") {
    return item.insertText;
  }

  if (item.insertText?.value) {
    return item.insertText.value;
  }

  if (item.textEdit?.newText) {
    return item.textEdit.newText;
  }

  if (item.textEdit?.text) {
    return item.textEdit.text;
  }

  return "";
}

function readHoverText(hover) {
  return (hover?.contents ?? []).map(readHoverContentText).join("\n");
}

function readHoverContentText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (typeof content?.value === "string") {
    return content.value;
  }

  return "";
}

function applyTextEdits(text, document, edits) {
  return [...edits]
    .sort(
      (left, right) => document.offsetAt(right.range.start) - document.offsetAt(left.range.start)
    )
    .reduce(
      (current, edit) =>
        `${current.slice(0, document.offsetAt(edit.range.start))}${edit.newText}${current.slice(
          document.offsetAt(edit.range.end)
        )}`,
      text
    );
}

async function waitFor(factory, description, timeoutMs = 20000, intervalMs = 200) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const value = await factory();

    if (value) {
      return value;
    }

    await wait(intervalMs);
  }

  const resolvedDescription = typeof description === "function" ? description() : description;

  throw new Error(`Timed out while waiting for ${resolvedDescription}.`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
