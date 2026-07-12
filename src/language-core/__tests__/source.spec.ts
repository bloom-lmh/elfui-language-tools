import { describe, expect, it } from "vitest";

import { basicChainFixture } from "../__fixtures__/basicChain";
import { elfuiDemoFixture } from "../__fixtures__/elfuiDemo";
import { analyzeElfSource, isInsideEmbeddedRegion } from "../source";

describe("analyzeElfSource", () => {
  it("collects chain builder metadata from separated calls", () => {
    const result = analyzeElfSource(basicChainFixture, { fileName: "Demo.ts" });

    const component = result.components[0];

    expect(component?.name).toBe("DemoButton");
    expect(component?.props).toEqual(["label", "disabled"]);
    expect(component?.emits).toEqual(["click", "focus"]);
    expect(component?.uses.map((item) => item.localName)).toEqual(["LocalIcon"]);
    expect(component?.uses.map((item) => item.expression)).toEqual(["Icon"]);
    expect(component?.setupReturns).toEqual(["count", "handleClick"]);
    expect(component?.symbols.map((item) => `${item.kind}:${item.name}`)).toEqual([
      "prop:label",
      "prop:disabled",
      "emit:click",
      "emit:focus",
      "component:LocalIcon",
      "setup:count",
      "setup:handleClick"
    ]);
    expect(component?.formControl).toBe(true);
    expect(component?.templates[0]?.content).toContain("<LocalIcon>");
    expect(component?.styles[0]?.content).toContain("display: inline-block");
  });

  it("tracks embedded region offsets", () => {
    const source = "const Demo = ElfUI.createComponent(); Demo.template(`<div>{{ count }}</div>`);";
    const result = analyzeElfSource(source);
    const template = result.components[0]?.templates[0];

    expect(template).toBeDefined();

    if (!template) {
      return;
    }

    const inside = source.indexOf("count");

    expect(isInsideEmbeddedRegion(template, inside)).toBe(true);
    expect(isInsideEmbeddedRegion(template, 0)).toBe(false);
  });

  it("tracks template strings with JavaScript interpolations", () => {
    const source = `
      const Demo = ElfUI.createComponent();
      Demo.setup(() => ({ count: 0 }));
      Demo.template(\`<div>\${count}</div>\`);
    `;
    const result = analyzeElfSource(source);
    const template = result.components[0]?.templates[0];

    expect(template?.content).toContain("${count}");

    if (!template) {
      return;
    }

    expect(isInsideEmbeddedRegion(template, source.indexOf("count}</div>"))).toBe(true);
  });

  it("collects chained calls after a builder variable declaration", () => {
    const result = analyzeElfSource(`
      const Card = ElfUI.createComponent();

      Card
        .name("UserCard")
        .props({ userName: String })
        .emits({ submit: null })
        .use(LocalBadge, "UserBadge")
        .slot("footer", "<button>Save</button>")
        .slots({ header: "<h2></h2>" })
        .setup(() => ({
          title: "User",
          save() {}
        }))
        .template("<article>{{ title }}</article>")
        .style(":host { display: block; }");
    `);

    const component = result.components[0];

    expect(component?.name).toBe("UserCard");
    expect(component?.props).toEqual(["userName"]);
    expect(component?.emits).toEqual(["submit"]);
    expect(component?.uses).toEqual([
      { expression: "LocalBadge", localName: "UserBadge", source: "alias" }
    ]);
    expect(component?.slots).toEqual(["footer", "header"]);
    expect(component?.setupReturns).toEqual(["title", "save"]);
    expect(component?.templates).toHaveLength(1);
    expect(component?.styles).toHaveLength(1);
  });

  it("collects inline builder chains and array use registrations", () => {
    const result = analyzeElfSource(`
      const Field = ElfUI.createComponent()
        .name("FormField")
        .props({ modelValue: String })
        .use([FieldLabel, FieldMessage])
        .setup(function () {
          return {
            error: "",
            validate() {}
          };
        })
        .template("<label>{{ error }}</label>");
    `);

    const component = result.components[0];

    expect(component?.name).toBe("FormField");
    expect(component?.props).toEqual(["modelValue"]);
    expect(component?.uses).toEqual([
      { expression: "FieldLabel", localName: "FieldLabel", source: "array" },
      { expression: "FieldMessage", localName: "FieldMessage", source: "array" }
    ]);
    expect(component?.setupReturns).toEqual(["error", "validate"]);
    expect(component?.templates[0]?.content).toBe("<label>{{ error }}</label>");
  });

  it("collects state and events as template-visible setup names", () => {
    const result = analyzeElfSource(`
      const Demo = ElfUI.createComponent()
        .state({ count: 0 })
        .state(() => ({ label: "Count" }))
        .events({
          handleClick() {},
          submit: () => {}
        })
        .template("<button @click='handleClick'>{{ count }} {{ label }}</button>");
    `);

    const component = result.components[0];

    expect(component?.setupReturns).toEqual(["count", "label", "handleClick", "submit"]);
  });

  it("collects standalone template and style strings from conventional variable names", () => {
    const result = analyzeElfSource(`
      const str = \`<div>{{ value }}</div>\`;
      const css = \`:host { color: red; }\`;
    `);

    expect(result.components.flatMap((item) => item.templates)).toHaveLength(1);
    expect(result.components.flatMap((item) => item.styles)).toHaveLength(1);
    expect(result.components.flatMap((item) => item.templates)[0]?.content).toContain("<div>");
    expect(result.components.flatMap((item) => item.styles)[0]?.content).toContain("color");
  });

  it("collects globalStyle strings as style regions", () => {
    const result = analyzeElfSource(`
      const Theme = ElfUI.createComponent()
        .name("ThemeShell")
        .globalStyle(":root { --brand-color: red; }")
        .template("<slot></slot>");
    `);

    const component = result.components[0];

    expect(component?.styles).toHaveLength(1);
    expect(component?.styles[0]?.method).toBe("globalStyle");
    expect(component?.styles[0]?.kind).toBe("style");
    expect(component?.styles[0]?.content).toContain("--brand-color");
  });

  it("collects macro component metadata and embedded regions", () => {
    const source = `
      import {
        css,
        defineEmits,
        defineHtml,
        defineProps,
        defineSlots,
        defineStyle,
        html,
        useComponents
      } from "elfui";
      import { LocalIcon } from "./LocalIcon";

      interface Props {
        label: string;
        disabled?: boolean;
      }

      const props = defineProps<Props>({
        label: String,
        disabled: Boolean
      });
      const emit = defineEmits<{ submit: [id: string] }>();
      defineSlots<{
        default?: () => unknown;
        item: (scope: { id: string }) => unknown;
      }>();
      useComponents({ LocalIcon });

      const Button = defineHtml(html\`
        <LocalIcon :label=\${props.label}>
          <template #item="{ id }">{{ id }}</template>
        </LocalIcon>
      \`);

      defineStyle(css\`
        :host {
          display: inline-flex;
        }
      \`);

      export { Button };
    `;
    const result = analyzeElfSource(source, { fileName: "Button.ts" });
    const component = result.components.find((item) => item.exportName === "Button");

    expect(result.isMacroComponent).toBe(true);
    expect(component?.macro).toBe(true);
    expect(component?.name).toBe("elf-button");
    expect(component?.props).toEqual(["label", "disabled"]);
    expect(component?.emits).toEqual(["submit"]);
    expect(component?.slots).toEqual(["default", "item"]);
    expect(component?.setupReturns).toEqual(expect.arrayContaining(["props", "emit"]));
    expect(component?.uses.map((item) => item.localName)).toEqual(["LocalIcon"]);
    expect(component?.templates[0]?.content).toContain("<LocalIcon");
    expect(component?.styles[0]?.content).toContain("display");
  });

  it("recognizes macro components imported from @elfui/core", () => {
    const result = analyzeElfSource(
      `
        import { defineHtml, html } from "@elfui/core";

        export default defineHtml(html\`<button @click="save" v-if="visible">Save</button>\`);
      `,
      { fileName: "Home.ts" }
    );

    expect(result.isMacroComponent).toBe(true);
    expect(result.components[0]?.macro).toBe(true);
    expect(result.components[0]?.templates[0]?.content).toContain("@click");
  });

  it("keeps the real @elfui/core demo page inside a macro template region", () => {
    const result = analyzeElfSource(elfuiDemoFixture, { fileName: "App.ts" });
    const template = result.components[0]?.templates[0];

    expect(result.isMacroComponent).toBe(true);
    expect(result.components[0]?.macro).toBe(true);
    expect(template?.content).toContain("<elf-router-view>");
    expect(template?.content).toContain("@click=${toggleTheme}");
  });

  it("collects defineModel props and update emits from macro components", () => {
    const source = `
      import { defineHtml, defineModel, html } from "elfui";

      const open = defineModel("open");
      const value = defineModel();

      export const Dialog = defineHtml(html\`
        <dialog :open=\${open}>{{ value }}</dialog>
      \`);
    `;
    const result = analyzeElfSource(source, { fileName: "Dialog.ts" });
    const component = result.components.find((item) => item.exportName === "Dialog");

    expect(result.isMacroComponent).toBe(true);
    expect(component?.props).toEqual(expect.arrayContaining(["open", "modelValue"]));
    expect(component?.emits).toEqual(expect.arrayContaining(["update:open", "update:modelValue"]));
    expect(component?.setupReturns).toEqual(expect.arrayContaining(["open", "value"]));
    expect(component?.symbols.map((item) => `${item.kind}:${item.name}`)).toEqual(
      expect.arrayContaining([
        "prop:open",
        "prop:modelValue",
        "emit:update:open",
        "emit:update:modelValue",
        "setup:open",
        "setup:value"
      ])
    );
  });
});
