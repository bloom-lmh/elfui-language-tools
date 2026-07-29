import {
  elfApiCompletions,
  elfBuiltInComponentCompletions,
  elfCommonDomEvents,
  elfEventModifiers,
  elfModelModifiers,
  elfTemplateDirectives,
  type ElfApiCompletion
} from "../shared/elfuiCatalog";

export interface WebCompletionEntry {
  detail: string;
  insertText: string;
  label: string;
}

export interface WebTemplateCompletionResult {
  entries: WebCompletionEntry[];
  replaceEnd: number;
  replaceStart: number;
}

const createDirectiveInsertText = (
  directive: (typeof elfTemplateDirectives)[number]
): string => {
  if (directive.value === "none") return directive.label;
  if (directive.value === "for") {
    return directive.label + "=\\${${1:item} of ${2:items}}";
  }
  return directive.label + "=\\${${1:" + directive.placeholder + "}}";
};

const directiveEntries: WebCompletionEntry[] = elfTemplateDirectives.map((directive) => ({
  detail: "ElfUI template directive",
  insertText: createDirectiveInsertText(directive),
  label: directive.label
}));

const eventEntries: WebCompletionEntry[] = elfCommonDomEvents.map((name) => ({
  detail: "DOM event listener",
  insertText: `@${name}=\\\${\${1:handler}}`,
  label: `@${name}`
}));

const bindingEntries: WebCompletionEntry[] = [
  {
    detail: "Dynamic class binding",
    insertText: ":class=\\${${1:classes}}",
    label: ":class"
  },
  {
    detail: "Dynamic style binding",
    insertText: ":style=\\${${1:styles}}",
    label: ":style"
  },
  {
    detail: "Named slot",
    insertText: "#default",
    label: "#default"
  }
];

const builtInEntries: WebCompletionEntry[] = elfBuiltInComponentCompletions.map((item) => ({
  detail: item.detail,
  insertText: item.newText,
  label: item.label
}));

export const createWebApiCompletions = (linePrefix: string): readonly ElfApiCompletion[] => {
  const prefix = /[A-Za-z_$][\w$]*$/.exec(linePrefix)?.[0] ?? "";

  if (prefix.length < 2) return [];

  return elfApiCompletions.filter((item) => isFuzzyMatch(item.label, prefix));
};

export const createWebTemplateCompletions = (
  template: string,
  offset: number
): WebTemplateCompletionResult => {
  const prefixSource = template.slice(0, offset);
  const openTagStart = prefixSource.lastIndexOf("<");
  const closeTagEnd = prefixSource.lastIndexOf(">");

  if (openTagStart <= closeTagEnd) {
    return result([...directiveEntries, ...eventEntries, ...bindingEntries], offset, offset);
  }

  const openTag = prefixSource.slice(openTagStart + 1);
  const tagMatch = /^\/?\s*([A-Za-z][\w-]*)?$/.exec(openTag);
  if (tagMatch) {
    const prefix = tagMatch[1] ?? "";
    return result(
      builtInEntries.filter((item) =>
        item.label.toLowerCase().startsWith(prefix.toLowerCase())
      ),
      offset - prefix.length,
      offset
    );
  }

  const eventModifier = /@[\w:-]+(\.[\w-]*)$/.exec(openTag);
  if (eventModifier?.[1]) {
    return result(
      elfEventModifiers.map((label) => ({
        detail: "ElfUI event modifier",
        insertText: label,
        label
      })),
      offset - eventModifier[1].length,
      offset
    );
  }

  const modelModifier = /v-model(\.[\w-]*)$/.exec(openTag);
  if (modelModifier?.[1]) {
    return result(
      elfModelModifiers.map((label) => ({
        detail: "ElfUI model modifier",
        insertText: label,
        label
      })),
      offset - modelModifier[1].length,
      offset
    );
  }

  return createPrefixedResult(openTag, template, offset, [
    { entries: eventEntries, pattern: /(@[\w:-]*)$/ },
    {
      entries: bindingEntries.filter((item) => item.label.startsWith(":")),
      pattern: /(:[\w:-]*)$/
    },
    {
      entries: bindingEntries.filter((item) => item.label.startsWith("#")),
      pattern: /(#[\w-]*)$/
    },
    { entries: directiveEntries, pattern: /(v-[\w:-]*)$/ }
  ]);
};

const createPrefixedResult = (
  openTag: string,
  template: string,
  offset: number,
  groups: Array<{ entries: WebCompletionEntry[]; pattern: RegExp }>
): WebTemplateCompletionResult => {
  for (const group of groups) {
    const prefix = group.pattern.exec(openTag)?.[1];
    if (prefix !== undefined) {
      const nameRemainder = /^[\w:-]*/.exec(template.slice(offset))?.[0] ?? "";
      const afterName = template.slice(offset + nameRemainder.length);
      const preserveFollowingAttribute =
        ["@", ":", "#", "v-"].includes(prefix) &&
        nameRemainder.length > 0 &&
        /^\s*=/.test(afterName);
      const hasExistingValue =
        !preserveFollowingAttribute && /^(?:\.[\w-]+)*\s*=/.test(afterName);
      const entries = group.entries
        .filter((item) =>
          item.label.toLowerCase().startsWith(prefix.toLowerCase())
        )
        .map((item) => ({
          ...item,
          insertText: hasExistingValue
            ? item.label
            : preserveFollowingAttribute
              ? `${item.insertText} `
              : item.insertText
        }));

      return result(
        entries,
        offset - prefix.length,
        preserveFollowingAttribute ? offset : offset + nameRemainder.length
      );
    }
  }

  return result([...directiveEntries, ...eventEntries, ...bindingEntries], offset, offset);
};

const result = (
  entries: WebCompletionEntry[],
  replaceStart: number,
  replaceEnd: number
): WebTemplateCompletionResult => ({
  entries,
  replaceEnd,
  replaceStart
});

const isFuzzyMatch = (value: string, query: string): boolean => {
  const normalizedValue = value.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  let queryIndex = 0;

  for (const character of normalizedValue) {
    if (character === normalizedQuery[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === normalizedQuery.length) return true;
    }
  }

  return false;
};
