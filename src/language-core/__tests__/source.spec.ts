import { describe, expect, it } from "vitest";

import { elfuiDemoFixture } from "../__fixtures__/elfuiDemo";
import { analyzeElfSource, isInsideEmbeddedRegion } from "../source";

describe("analyzeElfSource", () => {
  it("ignores legacy chain builder components", () => {
    const result = analyzeElfSource(`
      const Demo = ElfUI.createComponent();
      Demo.template(\`<button>Save</button>\`);
      Demo.style(\`:host { color: red; }\`);
    `);

    expect(result.components).toEqual([]);
    expect(result.isMacroComponent).toBe(false);
  });

  it("collects macro component metadata and embedded regions", () => {
    const source = `
      import { defineEmits, defineHtml, defineProps, defineSlots, defineStyle, useComponents } from "@elfui/core";
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

      const Button = defineHtml(\`
        <LocalIcon :label=\${props.label}>
          <template #item="{ id }">{{ id }}</template>
        </LocalIcon>
      \`);

      defineStyle(\`
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

  it("collects direct defineHtml and multi-argument defineStyle regions", () => {
    const source = `
      import { defineHtml, defineStyle } from "@elfui/core";

      defineStyle(
        \`:host { display: block; }\`,
        \`.direct { color: red; }\`
      );

      export default defineHtml(\`
        <button class="direct" @click=\${handleClick}>\${label}</button>
      \`);
    `;
    const result = analyzeElfSource(source, { fileName: "Direct.ts" });
    const component = result.components[0];

    expect(result.isMacroComponent).toBe(true);
    expect(component?.templates).toHaveLength(1);
    expect(component?.templates[0]?.method).toBe("defineHtml");
    expect(component?.templates[0]?.content).toContain("@click=${handleClick}");
    expect(component?.styles).toHaveLength(2);
    expect(component?.styles.map((style) => style.content)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(":host"),
        expect.stringContaining(".direct")
      ])
    );
  });

  it("does not treat removed html and css tags as embedded ElfUI regions", () => {
    const result = analyzeElfSource(`
      import { defineHtml, defineStyle } from "@elfui/core";

      declare const html: (strings: TemplateStringsArray) => string;
      declare const css: (strings: TemplateStringsArray) => string;

      export default defineHtml(html\`<button>Legacy</button>\`);
      defineStyle(css\`:host { display: block; }\`);
    `);

    expect(result.components.flatMap((component) => component.templates)).toHaveLength(0);
    expect(result.components.flatMap((component) => component.styles)).toHaveLength(0);
  });

  it("keeps lifecycle hooks and typed template refs in macro setup scope", () => {
    const result = analyzeElfSource(`
      import { defineHtml, onMounted, onUnmounted, useTemplateRef } from "@elfui/core";

      const chart = useTemplateRef<HTMLDivElement>("chart");
      onMounted(() => chart.value?.focus());
      onUnmounted(() => chart.value?.blur());

      export default defineHtml(\`<div ref="chart"></div>\`);
    `);

    const component = result.components[0];

    expect(component?.templates[0]?.content).toContain('ref="chart"');
    expect(component?.setupReturns).toContain("chart");
  });

  it("collects individual macro prop types and static defaults", () => {
    const result = analyzeElfSource(`
      import { defineHtml, defineProps } from "@elfui/core";

      interface Props {
        count: number;
        title?: string;
      }

      defineProps<Props>({
        count: { type: Number, default: 1 },
        title: { type: String, default: "Hello" }
      });

      export default defineHtml(\`<section>{{ title }}</section>\`);
    `);
    const details = result.components[0]?.propDetails;

    expect(details).toEqual(
      expect.arrayContaining([
        { defaultValue: "1", name: "count", type: "number" },
        { defaultValue: '"Hello"', name: "title", type: "string | undefined" }
      ])
    );
  });

  it("recognizes macro components imported from @elfui/core", () => {
    const result = analyzeElfSource(
      `
        import { defineHtml } from "@elfui/core";

        export default defineHtml(\`<button @click="save" v-if="visible">Save</button>\`);
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
      import { defineHtml, defineModel } from "@elfui/core";

      const open = defineModel("open");
      const value = defineModel();

      export const Dialog = defineHtml(\`
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
