import { describe, expect, it } from "vitest";

import { elfApiCompletions } from "../shared/elfuiCatalog";
import {
  createWebApiCompletions,
  createWebTemplateCompletions
} from "./completion";

describe("web completion catalog", () => {
  it("covers beta.20 macro, host, form, observer, and lifecycle APIs", () => {
    const labels = elfApiCompletions.map((item) => item.label);

    expect(labels).toEqual(
      expect.arrayContaining([
        "defineProps",
        "defineEmits",
        "defineModel",
        "defineSlots",
        "defineOptions",
        "defineExpose",
        "defineDirective",
        "useComponents",
        "useHost",
        "useFormControlContext",
        "useResizeObserver",
        "onBeforeMount",
        "onUpdated",
        "onErrorCaptured"
      ])
    );
    expect(labels).not.toEqual(expect.arrayContaining(["defineFragment", "fragment"]));
  });

  it("completes partial API names without requiring the old full-name whitelist", () => {
    expect(createWebApiCompletions("const props = defi").map((item) => item.label)).toEqual(
      expect.arrayContaining(["defineProps", "defineEmits", "defineHtml"])
    );
    expect(createWebApiCompletions("uR").map((item) => item.label)).toEqual(
      expect.arrayContaining(["useRef", "useReactive", "useResizeObserver"])
    );
  });

  it("provides directives, modifiers, events, slots, and built-in components", () => {
    expect(labelsFor("<button v-")).toContain("v-if");
    expect(labelsFor("<button @click.")).toContain(".prevent");
    expect(labelsFor("<button v-model.")).toContain(".trim");
    expect(labelsFor("<button @")).toContain("@click");
    expect(labelsFor("<template #")).toContain("#default");
    expect(labelsFor("<Trans")).toEqual(
      expect.arrayContaining(["Transition", "TransitionGroup"])
    );
  });

  it("preserves existing attribute values and adjacent attributes", () => {
    const partial = "<button @click=${existing}>";
    const partialOffset = partial.indexOf("click") + 2;
    const partialResult = createWebTemplateCompletions(partial, partialOffset);
    const click = partialResult.entries.find((item) => item.label === "@click");

    expect(click?.insertText).toBe("@click");
    expect(partial.slice(partialResult.replaceStart, partialResult.replaceEnd)).toBe("@click");

    const adjacent = "<button @click=${existing}>";
    const adjacentOffset = adjacent.indexOf("@") + 1;
    const adjacentResult = createWebTemplateCompletions(adjacent, adjacentOffset);
    const mouseover = adjacentResult.entries.find((item) => item.label === "@mouseover");

    expect(adjacent.slice(adjacentResult.replaceStart, adjacentResult.replaceEnd)).toBe("@");
    expect(mouseover?.insertText.endsWith(" ")).toBe(true);
  });
});

const labelsFor = (source: string) =>
  createWebTemplateCompletions(source, source.length).entries.map((item) => item.label);
