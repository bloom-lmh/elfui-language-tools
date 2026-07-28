const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const extensionManifest = require("../../../package.json");

const EXTENSION_ID = `${extensionManifest.publisher}.${extensionManifest.name}`;
const WORKSPACE_ROOT = path.resolve(__dirname, "..", "workspace");
const FIXTURE_PATH = path.join(WORKSPACE_ROOT, "macro-smoke.ts");
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
      "elfui.generateWorkspaceComponentMetadata",
      "elfui.injectMissingTemplateDeclaration"
    ].forEach((command) => {
      assert(commands.includes(command), `Expected ${command} command to be registered.`);
    });
  });

  test("provides completions in template with backtick on the next line (multi-line wrapped)", async () => {
    // This covers wrapped defineHtml template strings.
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
        'import { defineHtml } from "@elfui/core";',
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

  test("keeps an existing handler when replacing an event name", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { defineHtml } from "@elfui/core";',
        "",
        "const handleClick = () => {};",
        `export const Demo = defineHtml(\`<button @m${CURSOR}k=\${handleClick}></button>\`);`,
        ""
      ].join("\n")
    );
    const items = await waitForCompletionLabels(document, position, ["@mouseover"]);
    const completion = items.find((item) => getCompletionLabel(item.label) === "@mouseover");

    const completionRange =
      completion?.range instanceof vscode.Range
        ? completion.range
        : completion?.range?.replacing ?? completion?.textEdit?.range;
    const completionText = getCompletionInsertedText(completion);

    assert(completionRange, "Expected @mouseover to provide a replacement range.");
    assert.equal(completionText, "@mouseover", "Expected only the event name to be inserted.");
    const completed = applyTextEdits(document.getText(), document, [
      { newText: completionText, range: completionRange }
    ]);

    assert(completed.includes("@mouseover=${handleClick}"), "Expected the existing handler to remain.");
    assert(!completed.includes("${handler}"), "Did not expect a duplicate handler snippet.");
    assert(!completed.includes("k=${handleClick}"), "Did not expect a trailing event-name fragment.");
  });

  test("provides macro quick fixes for missing state and handlers", async () => {
    const document = await openFixture(
      [
        'import { defineHtml } from "@elfui/core";',
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

  test("injects the missing declaration at the cursor with Alt+backslash command", async () => {
    const { document: stateDocument } = await openFixtureWithCursor(
      [
        'import { defineHtml } from "@elfui/core";',
        "",
        `export default defineHtml(\`<main v-if="condition${CURSOR}"></main>\`);`,
        ""
      ].join("\n")
    );
    const stateResult = await vscode.commands.executeCommand(
      "elfui.injectMissingTemplateDeclaration"
    );

    assert.equal(stateResult, 'Create state "condition" with useRef()');
    await waitFor(
      () => stateDocument.getText().includes("const condition = useRef();"),
      "Alt+backslash state declaration"
    );

    const { document: handlerDocument } = await openFixtureWithCursor(
      [
        'import { defineHtml } from "@elfui/core";',
        "",
        `export default defineHtml(\`<button @click=\${handleClick${CURSOR}}></button>\`);`,
        ""
      ].join("\n")
    );
    const handlerResult = await vscode.commands.executeCommand(
      "elfui.injectMissingTemplateDeclaration"
    );

    assert.equal(handlerResult, 'Create handler "handleClick"');
    await waitFor(
      () => handlerDocument.getText().includes("const handleClick = (e: Event) => {"),
      "Alt+backslash handler declaration"
    );

    const { document: methodDocument } = await openFixtureWithCursor(
      [
        'import { defineHtml } from "@elfui/core";',
        "",
        `export default defineHtml(\`<main v-if="canOpen${CURSOR}()"></main>\`);`,
        ""
      ].join("\n")
    );
    const methodResult = await vscode.commands.executeCommand(
      "elfui.injectMissingTemplateDeclaration"
    );

    assert.equal(methodResult, 'Create method "canOpen"');
    await waitFor(
      () => methodDocument.getText().includes("const canOpen = () => {"),
      "Alt+backslash method declaration"
    );
  });

  test("supports quoted v-for completions and repairs untyped list states", async () => {
    const { document: completionDocument, position } = await openFixtureWithCursor(
      [
        'import { defineHtml, useRef } from "@elfui/core";',
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
        'import { defineHtml, defineProps, useRef } from "@elfui/core";',
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
        'import { defineHtml, useRef } from "@elfui/core";',
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
        'import { defineHtml } from "@elfui/core";',
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
        'import { defineHtml, useRef } from "@elfui/core";',
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
          'import { defineHtml, defineProps } from "@elfui/core";',
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

  test("provides TypeScript member completions inside template expressions", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { defineHtml, defineProps } from "@elfui/core";',
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

  test("provides named Fragment props and same-file definition in the real host", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { defineFragment, defineHtml } from "@elfui/core";',
        "",
        "interface CardProps {",
        "  label: string;",
        "  selected?: boolean;",
        "}",
        "",
        "const SummaryCard = defineFragment<CardProps>(({ label }) => `",
        "  <article>${label.toUpperCase()}</article>",
        "`);",
        "",
        "export const Demo = defineHtml(`",
        `  <SummaryCard ${CURSOR}:label=\${"value"} />`,
        "`);",
        ""
      ].join("\n")
    );
    const items = await waitForCompletionLabels(document, position, [":label", ":selected"]);
    const tagOffset = document.getText().lastIndexOf("<SummaryCard") + 2;
    const definition = await waitForDefinitionTarget(
      document,
      document.positionAt(tagOffset),
      document.uri.toString(),
      "named Fragment same-file definition"
    );

    assert(hasCompletionLabel(items, ":label"), "Expected named Fragment prop completion.");
    assert(hasCompletionLabel(items, ":selected"), "Expected optional Fragment prop completion.");
    assert(definition, "Expected named Fragment definition.");
  });

  test("provides DOM event member completions inside template expressions", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { defineHtml } from "@elfui/core";',
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

  test("formats embedded regions on save while another formatter owns TypeScript", async () => {
    const document = await openFixture(
      [
        'import { defineHtml, defineStyle } from "@elfui/core";',
        "",
        "const view = defineHtml(`<section><button>{{ count }}</button></section>`);",
        "const styles = defineStyle(`:host{color:red;display:block;}`);",
        "export { view };",
        ""
      ].join("\n")
    );
    const editor = vscode.window.activeTextEditor;

    assert(editor, "Expected an active editor for save formatting.");

    await waitFor(async () => {
      const edits = await vscode.commands.executeCommand(
        "vscode.executeFormatDocumentProvider",
        document.uri,
        { insertSpaces: true, tabSize: 2 }
      );

      return Array.isArray(edits) && edits.length > 0 ? edits : undefined;
    }, "save-format fixture synchronization");

    const editorConfiguration = vscode.workspace.getConfiguration("editor", document);
    const previousFormatOnSave = editorConfiguration.inspect("formatOnSave")?.workspaceValue;
    const previousDefaultFormatter = editorConfiguration.inspect("defaultFormatter")?.workspaceValue;

    try {
      await editorConfiguration.update(
        "formatOnSave",
        true,
        vscode.ConfigurationTarget.Workspace
      );
      await editorConfiguration.update(
        "defaultFormatter",
        "vscode.typescript-language-features",
        vscode.ConfigurationTarget.Workspace
      );
      await editor.edit((editBuilder) => {
        editBuilder.insert(document.positionAt(document.getText().length), " ");
      });

      assert.equal(document.isDirty, true, "Expected the fixture to be dirty before save.");
      assert.equal(await document.save(), true, "Expected the fixture save to succeed.");

      await waitFor(
        () =>
          /defineHtml\(`\n\s*<section><button>{{ count }}<\/button><\/section>/.test(
            document.getText()
          ) &&
          /defineStyle\(`\n\s*:host \{\n\s*color: red;\n\s*display: block;\n\s*\}/.test(
            document.getText()
          ),
        "embedded save formatting"
      );
    } finally {
      await editorConfiguration.update(
        "formatOnSave",
        previousFormatOnSave,
        vscode.ConfigurationTarget.Workspace
      );
      await editorConfiguration.update(
        "defaultFormatter",
        previousDefaultFormatter,
        vscode.ConfigurationTarget.Workspace
      );
    }
  });

  test("keeps named Fragment formatting idempotent across repeated saves", async () => {
    const document = await openFixture(
      [
        'import { defineFragment, defineHtml } from "@elfui/core";',
        "",
        "const MenuPanel = defineFragment(() => `",
        "  <button :class=\"{",
        "                          'is-disabled': item.disabled,",
        "                          'is-selected': isSelected(item)",
        "                        }\">{{ item.label }}</button>",
        "`);",
        "",
        "export const Menu = defineHtml(`<MenuPanel />`);",
        ""
      ].join("\n")
    );
    const firstEdits = await waitFor(async () => {
      const edits = await vscode.commands.executeCommand(
        "vscode.executeFormatDocumentProvider",
        document.uri,
        { insertSpaces: true, tabSize: 2 }
      );

      return Array.isArray(edits) && edits.length > 0 ? edits : undefined;
    }, "named Fragment formatting");
    const workspaceEdit = new vscode.WorkspaceEdit();

    firstEdits.forEach((edit) => workspaceEdit.replace(document.uri, edit.range, edit.newText));
    assert.equal(await vscode.workspace.applyEdit(workspaceEdit), true);

    const formattedOnce = document.getText();
    const formattedTwice = await waitFor(async () => {
      const secondEdits = await vscode.commands.executeCommand(
        "vscode.executeFormatDocumentProvider",
        document.uri,
        { insertSpaces: true, tabSize: 2 }
      );
      const candidate = applyTextEdits(formattedOnce, document, secondEdits ?? []);

      return candidate === formattedOnce ? candidate : undefined;
    }, "synchronized idempotent Fragment formatting");

    assert.equal(formattedTwice, formattedOnce);
    assert.match(
      formattedOnce,
      /:class="\{\n\s+'is-disabled': item\.disabled,\n\s+'is-selected': isSelected\(item\)\n\s+\}"/
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

  test("covers macro aliases, models and typed slot scopes", async () => {
    const { document, position } = await openFixtureWithCursor(
      [
        'import { defineHtml, defineModel, defineSlots, useComponents } from "@elfui/core";',
        'import { DialogActionButton } from "./DialogActionButton";',
        "",
        'const open = defineModel<boolean>("open");',
        "const value = defineModel<string>();",
        "const plain = defineModel();",
        "defineSlots<{",
        "  footer?: (scope: { action: { disabled: boolean; label: string } }) => unknown;",
        "}>();",
        "useComponents({ DialogAction: DialogActionButton });",
        "useComponents({ ModalAlias: DialogActionButton });",
        "export default defineHtml(`",
        `  <ModalA${CURSOR}`,
        '  <ModalAlias v-model:open="open">',
        '    <input v-model="value">',
        "    <template #footer=\"{ action }\">{{ action.disabled }}</template>",
        "  </ModalAlias>",
        "`);",
        ""
      ].join("\n")
    );

    const items = await waitForCompletionLabels(document, position, ["ModalAlias"]);

    assert(hasCompletionLabel(items, "ModalAlias"), "Expected useComponents alias completion.");
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

  let document;

  if (existing) {
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      existing.positionAt(0),
      existing.positionAt(existing.getText().length)
    );

    edit.replace(existing.uri, fullRange, content);
    assert(await vscode.workspace.applyEdit(edit), "Expected fixture WorkspaceEdit to apply.");
    await existing.save();
    document = existing;
  } else {
    fs.writeFileSync(FIXTURE_PATH, content, "utf8");
    document = await vscode.workspace.openTextDocument(fixtureUri);
  }

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
