import {
  analyzeElfSource,
  isMacroComponentSource,
  isInsideEmbeddedRegion,
  type ComponentMeta,
  type ComponentUseMeta,
  type EmbeddedRegion
} from "../language-core";
import { compileMacroComponent, type ElfDiagnostic } from "@elfui/compiler/macro-component";
import path from "node:path";
import * as ts from "typescript";
import { getCSSLanguageService } from "vscode-css-languageservice";
import {
  getLanguageService as getHtmlLanguageService,
  TokenType,
  type HTMLDocument,
  type Node as HTMLNode
} from "vscode-html-languageservice";
import {
  CodeActionKind,
  CompletionItemKind,
  DiagnosticSeverity,
  DocumentHighlightKind,
  InlayHintKind,
  InsertTextFormat,
  SymbolKind,
  type Color,
  type ColorInformation,
  type ColorPresentation,
  type CodeAction,
  type CodeActionContext,
  type CompletionItem,
  type CompletionList,
  type Diagnostic,
  type DocumentLink,
  type DocumentHighlight,
  type DocumentSymbol,
  type FoldingRange,
  type FormattingOptions as LspFormattingOptions,
  type Hover,
  type InlayHint,
  type InsertReplaceEdit,
  type LinkedEditingRanges,
  type Location,
  type Position,
  type Range,
  type SemanticTokens,
  type SemanticTokensLegend,
  type SelectionRange,
  type TextEdit,
  type WorkspaceEdit
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

interface ElfFormattingOptions extends LspFormattingOptions {
  wrapLineLength?: number;
}

export type ElfTemplateBindingStyle = "expression" | "quoted";

export interface ElfCompletionOptions {
  eventBindingStyle?: ElfTemplateBindingStyle;
  templateBindingStyle?: ElfTemplateBindingStyle;
}

export interface ElfSemanticTokensOptions {
  enabled?: boolean;
}

export interface ElfProjectComponentSymbol {
  kind: "component" | "emit" | "prop" | "slot";
  name: string;
  range: Range;
}

export interface ElfProjectComponentSlotScope {
  name: string;
  scopeType: string;
}

export interface ElfProjectComponent {
  definition?: Range;
  emits?: string[];
  exportName: "default" | string;
  importPath: string;
  localName: string;
  props?: string[];
  slotScopes?: ElfProjectComponentSlotScope[];
  slots?: string[];
  slotsType?: string | undefined;
  symbols?: ElfProjectComponentSymbol[];
  tagName?: string | null;
  uri?: string;
}

export interface ElfLanguageServiceOptions {
  completion?: ElfCompletionOptions;
  project?: {
    components?: ElfProjectComponent[];
  };
  semanticTokens?: ElfSemanticTokensOptions;
}

interface ResolvedElfCompletionOptions {
  eventBindingStyle: ElfTemplateBindingStyle;
  templateBindingStyle: ElfTemplateBindingStyle;
}

interface ResolvedElfLanguageServiceOptions {
  completion: ResolvedElfCompletionOptions;
  projectComponents: ElfProjectComponent[];
}

interface EmbeddedMappingContext {
  region: EmbeddedRegion;
  virtualDocument: TextDocument;
}

interface EmbeddedDocumentContext extends EmbeddedMappingContext {
  component: ComponentMeta;
  components: ComponentMeta[];
  virtualPosition: Position;
}

interface TemplateExpression {
  locals: Set<string>;
  start: number;
  value: string;
}

interface ElfReferenceTarget {
  component: ComponentMeta;
  name: string;
  range: Range;
}

interface ElfReferenceItem {
  range: Range;
  text: string;
}

interface TemplateComponentDefinition {
  emits: string[];
  localName: string;
  props: string[];
  slotScopes?: ElfProjectComponentSlotScope[];
  slots: string[];
  slotsType?: string | undefined;
}

interface HtmlNodeMatch {
  node: HTMLNode;
  parent: HTMLNode | null;
}

interface ElfSemanticToken {
  length: number;
  modifiers?: Array<(typeof elfSemanticTokenModifiers)[number]>;
  start: number;
  type: (typeof elfSemanticTokenTypes)[number];
}

interface ElfProjectReferenceTarget {
  component: ElfProjectComponent;
  kind: ElfProjectComponentSymbol["kind"];
  name: string;
  owner: ComponentMeta;
  range: Range;
  symbolName: string;
}

type TemplateCompletionContext =
  | {
      kind: "attribute-name";
      prefix: string;
      replaceStart: number;
    }
  | {
      kind: "directive";
      prefix: string;
      replaceStart: number;
    }
  | {
      kind: "event";
      prefix: string;
      replaceStart: number;
    }
  | {
      eventName: string;
      kind: "event-modifier";
      prefix: string;
      replaceStart: number;
    }
  | {
      kind: "expression";
      prefix: string;
      replaceStart: number;
    }
  | {
      kind: "model-modifier";
      prefix: string;
      replaceStart: number;
    }
  | {
      kind: "prop-binding";
      prefix: string;
      replaceStart: number;
    }
  | {
      kind: "slot";
      prefix: string;
      replaceStart: number;
    }
  | {
      kind: "tag";
      mode: "bare" | "open";
      prefix: string;
      replaceStart: number;
    };

const htmlLanguageService = getHtmlLanguageService();
const cssLanguageService = getCSSLanguageService();

export const elfSemanticTokenTypes = [
  "class",
  "property",
  "event",
  "variable",
  "interface",
  "keyword"
] as const;

export const elfSemanticTokenModifiers = ["declaration", "readonly"] as const;

export const elfSemanticTokensLegend: SemanticTokensLegend = {
  tokenModifiers: [...elfSemanticTokenModifiers],
  tokenTypes: [...elfSemanticTokenTypes]
};

const defaultCompletionOptions: ResolvedElfCompletionOptions = {
  eventBindingStyle: "expression",
  templateBindingStyle: "expression"
};

const templateDirectives: Array<
  | {
      label: string;
      placeholder: string;
      value: "expression";
    }
  | {
      label: string;
      value: "for";
    }
  | {
      label: string;
      value: "none";
    }
> = [
  { label: "v-if", placeholder: "condition", value: "expression" },
  { label: "v-else-if", placeholder: "condition", value: "expression" },
  { label: "v-else", value: "none" },
  { label: "v-for", value: "for" },
  { label: "v-model", placeholder: "value", value: "expression" },
  { label: "v-show", placeholder: "visible", value: "expression" },
  { label: "v-text", placeholder: "value", value: "expression" },
  { label: "v-html", placeholder: "html", value: "expression" },
  { label: "v-once", value: "none" },
  { label: "v-memo", placeholder: "[deps]", value: "expression" }
];

const eventModifiers = [".stop", ".prevent", ".capture", ".once", ".passive", ".self"];
const modelModifiers = [".trim", ".number", ".lazy"];
const emitHelpers = ["emit", "$emit"];
const commonDomEvents = [
  "blur",
  "change",
  "click",
  "focus",
  "input",
  "keydown",
  "keyup",
  "mouseenter",
  "mouseleave",
  "submit"
];
const formControlMembers = [
  "form",
  "form.value",
  "form.valid",
  "form.invalid",
  "form.error",
  "form.setValue",
  "form.validate",
  "form.report",
  "form.reset",
  "ctx.form"
];

const templateGlobals = new Set([
  "$event",
  "$value",
  "$emit",
  "Array",
  "Boolean",
  "Date",
  "emit",
  "Intl",
  "JSON",
  "Math",
  "Number",
  "Object",
  "String",
  "false",
  "null",
  "true",
  "undefined"
]);

const templateReservedWords = new Set([
  "as",
  "await",
  "break",
  "case",
  "catch",
  "const",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "for",
  "from",
  "function",
  "if",
  "in",
  "instanceof",
  "let",
  "new",
  "of",
  "return",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "void",
  "while"
]);

const commonHtmlTags = [
  "a",
  "article",
  "aside",
  "button",
  "div",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "header",
  "img",
  "input",
  "label",
  "li",
  "main",
  "nav",
  "p",
  "section",
  "span",
  "ul"
];

const voidHtmlTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

const elfBuiltInComponentTags = new Set([
  "KeepAlive",
  "Suspense",
  "Teleport",
  "Transition",
  "TransitionGroup"
]);

const elfBuiltInComponentCompletions = [
  {
    detail: "ElfUI built-in component",
    label: "Teleport",
    newText: 'Teleport to="${1:body}">$0</Teleport>'
  },
  {
    detail: "ElfUI built-in component",
    label: "Transition",
    newText: 'Transition name="${1:fade}">$0</Transition>'
  },
  {
    detail: "ElfUI built-in component",
    label: "TransitionGroup",
    newText: 'TransitionGroup name="${1:list}" tag="${2:div}">$0</TransitionGroup>'
  },
  {
    detail: "ElfUI built-in component",
    label: "KeepAlive",
    newText: "KeepAlive>$0</KeepAlive>"
  },
  {
    detail: "ElfUI built-in component",
    label: "Suspense",
    newText: "Suspense>$0</Suspense>"
  },
  {
    detail: "ElfUI dynamic component outlet",
    label: "component",
    newText: "component :is=${1:component}></component>"
  }
];

export const createElfCompletionList = (
  document: TextDocument,
  position: Position,
  options: ElfLanguageServiceOptions = {}
): CompletionList => {
  const resolvedOptions = resolveLanguageServiceOptions(options);
  const templateContext = findEmbeddedDocumentContext(document, position, "template");

  if (templateContext) {
    const contextualCompletions = createContextualTemplateCompletions(
      document,
      templateContext,
      resolvedOptions
    );

    if (contextualCompletions) {
      return contextualCompletions;
    }

    const htmlDocument = parseHTML(templateContext);
    const htmlCompletions = htmlLanguageService.doComplete(
      templateContext.virtualDocument,
      templateContext.virtualPosition,
      htmlDocument,
      {
        attributeDefaultValue: "doublequotes"
      }
    );
    const completionContext = resolveCurrentTemplateCompletionContext(templateContext);
    const localComponentCompletions =
      completionContext?.kind === "tag"
        ? createTagCompletions(document, templateContext, completionContext, resolvedOptions)
        : [];

    return {
      isIncomplete: htmlCompletions.isIncomplete,
      items: dedupeCompletionItems([
        ...htmlCompletions.items.map((item) =>
          mapCompletionItem(document, templateContext, item as CompletionItem)
        ),
        ...localComponentCompletions
      ])
    };
  }

  const styleContext = findEmbeddedDocumentContext(document, position, "style");

  if (styleContext) {
    const stylesheet = cssLanguageService.parseStylesheet(styleContext.virtualDocument);
    const cssCompletions = cssLanguageService.doComplete(
      styleContext.virtualDocument,
      styleContext.virtualPosition,
      stylesheet
    );

    return {
      isIncomplete: cssCompletions.isIncomplete,
      items: dedupeCompletionItems([
        ...cssCompletions.items.map((item) =>
          mapCompletionItem(document, styleContext, item as CompletionItem)
        ),
        ...createStyleCompletions(styleContext)
      ])
    };
  }

  return {
    isIncomplete: false,
    items: []
  };
};

export const createElfHover = (document: TextDocument, position: Position): Hover | null => {
  const templateContext = findEmbeddedDocumentContext(document, position, "template");

  if (templateContext) {
    const metadataHover = createTemplateMetadataHover(document, templateContext);

    if (metadataHover) {
      return metadataHover;
    }

    const htmlDocument = parseHTML(templateContext);
    const hover = htmlLanguageService.doHover(
      templateContext.virtualDocument,
      templateContext.virtualPosition,
      htmlDocument,
      {
        documentation: true,
        references: true
      }
    );

    if (hover) {
      return mapHover(document, templateContext, hover as Hover);
    }

    return {
      contents: {
        kind: "markdown",
        value: "ElfUI template string"
      }
    };
  }

  const styleContext = findEmbeddedDocumentContext(document, position, "style");

  if (styleContext) {
    const metadataHover = createStyleMetadataHover(document, styleContext);

    if (metadataHover) {
      return metadataHover;
    }

    const hover = cssLanguageService.doHover(
      styleContext.virtualDocument,
      styleContext.virtualPosition,
      cssLanguageService.parseStylesheet(styleContext.virtualDocument),
      {
        documentation: true,
        references: true
      }
    );

    if (hover) {
      return mapHover(document, styleContext, hover as Hover);
    }

    return {
      contents: {
        kind: "markdown",
        value: "ElfUI style string"
      }
    };
  }

  return null;
};

export const createElfTagComplete = (document: TextDocument, position: Position): string | null => {
  const templateContext = findEmbeddedDocumentContext(document, position, "template");

  if (!templateContext) {
    return null;
  }

  const closeText = htmlLanguageService.doTagComplete(
    templateContext.virtualDocument,
    templateContext.virtualPosition,
    parseHTML(templateContext)
  );

  return closeText?.replace(/\$0/g, "") ?? null;
};

export const createElfQuoteComplete = (
  document: TextDocument,
  position: Position
): string | null => {
  const templateContext = findEmbeddedDocumentContext(document, position, "template");

  if (!templateContext) {
    return null;
  }

  const quoteText = htmlLanguageService.doQuoteComplete(
    templateContext.virtualDocument,
    templateContext.virtualPosition,
    parseHTML(templateContext),
    {
      attributeDefaultValue: "doublequotes"
    }
  );

  return quoteText?.replace(/\$\d+/g, "") ?? null;
};

export const createElfOnTypeFormattingEdits = (
  document: TextDocument,
  position: Position,
  typedCharacter: string
): TextEdit[] => {
  const insertText =
    typedCharacter === ">"
      ? createElfTagComplete(document, position)
      : typedCharacter === "="
        ? createElfQuoteComplete(document, position)
        : null;

  if (!insertText) {
    return [];
  }

  return [
    {
      newText: insertText,
      range: {
        end: position,
        start: position
      }
    }
  ];
};

export const createElfDiagnostics = (
  document: TextDocument,
  options: ElfLanguageServiceOptions = {}
): Diagnostic[] => {
  const source = document.getText();
  const resolvedOptions = resolveLanguageServiceOptions(options);
  const analysis = analyzeElfSource(source, {
    fileName: document.uri
  });
  const macroDiagnostics = analysis.isMacroComponent
    ? createMacroDiagnostics(document, analysis.components)
    : [];

  return [
    ...macroDiagnostics,
    ...analysis.components.flatMap((component) => [
      ...component.templates.flatMap((region) =>
        createTemplateDiagnostics(
          document,
          analysis.components,
          component,
          region,
          resolvedOptions.projectComponents
        )
      ),
      ...component.styles.flatMap((region) => createStyleDiagnostics(document, region))
    ])
  ];
};

const createMacroDiagnostics = (
  document: TextDocument,
  components: ComponentMeta[]
): Diagnostic[] => {
  const source = document.getText();

  if (!isMacroComponentSource(source, document.uri)) {
    return [];
  }

  try {
    return compileMacroComponent(source, {
      filename: documentUriToFileName(document.uri),
      templateTypeCheck: true
    })
      .diagnostics.map((diagnostic) => mapMacroDiagnostic(document, diagnostic))
      .filter(
        (diagnostic) =>
          !isResolvedVForLocalUnknownDiagnostic(document, components, diagnostic) &&
          !isResolvedInterpolationRefValueDiagnostic(document, components, diagnostic) &&
          !isResolvedKnownMacroTemplateDiagnostic(document, components, diagnostic)
      );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return [
      {
        message: `ElfUI macro analysis failed: ${message}`,
        range: {
          end: document.positionAt(Math.min(source.length, 1)),
          start: document.positionAt(0)
        },
        severity: DiagnosticSeverity.Error,
        source: "ElfUI Macro"
      }
    ];
  }
};

const mapMacroDiagnostic = (document: TextDocument, diagnostic: ElfDiagnostic): Diagnostic => {
  const source = document.getText();
  const start = clamp(diagnostic.start ?? 0, 0, source.length);
  const end = clamp(diagnostic.end ?? start, start, source.length);
  const hint = diagnostic.hint ? `\n${diagnostic.hint}` : "";

  return {
    code: diagnostic.code,
    message: `${diagnostic.message}${hint}`,
    range: {
      end: document.positionAt(end),
      start: document.positionAt(start)
    },
    severity:
      diagnostic.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
    source: "ElfUI Macro"
  };
};

const documentUriToFileName = (uri: string): string => {
  try {
    const url = new URL(uri);

    if (url.protocol !== "file:") {
      return uri;
    }

    const pathname = decodeURIComponent(url.pathname);
    const windowsPath = pathname.match(/^\/[A-Za-z]:/) ? pathname.slice(1) : pathname;

    return windowsPath.replace(/\//g, "\\");
  } catch {
    return uri;
  }
};

const resolveDocumentLinkTarget = (documentUri: string, rawTarget: string): string | null => {
  const target = rawTarget.trim();

  if (!target || target.startsWith("#") || target.startsWith("data:")) {
    return null;
  }

  if (/^[A-Za-z][\w+.-]*:/.test(target)) {
    return target;
  }

  if (target.startsWith("//")) {
    return `https:${target}`;
  }

  try {
    return new URL(target, documentUri).toString();
  } catch {
    return null;
  }
};

export const createElfDefinition = (
  document: TextDocument,
  position: Position,
  options: ElfLanguageServiceOptions = {}
): Location[] => {
  const resolvedOptions = resolveLanguageServiceOptions(options);
  const templateContext = findEmbeddedDocumentContext(document, position, "template");

  if (!templateContext) {
    return [];
  }

  const word = readWordAtOffset(document.getText(), document.offsetAt(position));

  if (!word) {
    return [];
  }

  const projectDefinitions = createProjectComponentDefinitions(
    document,
    templateContext,
    resolvedOptions.projectComponents
  );

  if (projectDefinitions.length > 0) {
    return projectDefinitions;
  }

  return templateContext.component.symbols
    .filter((symbol) => symbol.name === word)
    .map((symbol) => ({
      range: {
        end: document.positionAt(symbol.end),
        start: document.positionAt(symbol.start)
      },
      uri: document.uri
    }));
};

const createProjectComponentDefinitions = (
  document: TextDocument,
  context: EmbeddedDocumentContext,
  projectComponents: ElfProjectComponent[]
): Location[] => {
  const target = resolveProjectReferenceTarget(document, context, projectComponents);

  return target
    ? createProjectComponentSymbolLocations(target.component, target.kind, target.symbolName)
    : [];
};

const resolveProjectReferenceTarget = (
  document: TextDocument,
  context: EmbeddedDocumentContext,
  projectComponents: ElfProjectComponent[]
): ElfProjectReferenceTarget | null => {
  if (projectComponents.length === 0) {
    return null;
  }

  const virtualOffset = context.virtualDocument.offsetAt(context.virtualPosition);
  const template = context.virtualDocument.getText();
  const slotWord = readSlotWordRangeAtOffset(template, virtualOffset);

  if (slotWord) {
    const component = findProjectComponentDefinitionForSlot(
      projectComponents,
      context.component,
      slotWord.value
    );

    if (component) {
      return {
        component,
        kind: "slot",
        name: slotWord.value,
        owner: context.component,
        range: mapVirtualRangeByOffsets(
          document,
          context.region,
          context.virtualDocument,
          slotWord.start,
          slotWord.end
        ),
        symbolName: slotWord.value
      };
    }
  }

  const htmlDocument = parseHTML(context);
  const match = findHtmlNodeAtOffset(htmlDocument.roots, virtualOffset);

  if (!match) {
    return null;
  }

  const { node, parent } = match;
  const attribute = findAttributeNameAtOffset(context.virtualDocument, node, virtualOffset);

  if (attribute) {
    const reference = readAttributeProjectReference(attribute);

    if (!reference) {
      return null;
    }

    const ownerNode = reference.kind === "slot" ? (parent ?? node) : node;
    const component =
      (ownerNode.tag
        ? findProjectComponentDefinitionForTag(projectComponents, context.component, ownerNode.tag)
        : null) ??
      (reference.kind === "slot"
        ? findProjectComponentDefinitionForSlot(
            projectComponents,
            context.component,
            reference.name
          )
        : null);

    if (!component) {
      return null;
    }

    const partRange = findAttributeNamePartVirtualRange(template, node, attribute, reference.kind);

    return partRange
      ? {
          component,
          kind: reference.kind,
          name: reference.text,
          owner: context.component,
          range: mapVirtualRangeByOffsets(
            document,
            context.region,
            context.virtualDocument,
            partRange.start,
            partRange.end
          ),
          symbolName: reference.name
        }
      : null;
  }

  if (!node.tag || !isOffsetInNodeStartTagName(node, virtualOffset)) {
    return null;
  }

  const component = findProjectComponentDefinitionForTag(
    projectComponents,
    context.component,
    node.tag
  );

  return component
    ? {
        component,
        kind: "component",
        name: node.tag,
        owner: context.component,
        range: mapVirtualRangeByOffsets(
          document,
          context.region,
          context.virtualDocument,
          node.start + 1,
          node.start + 1 + node.tag.length
        ),
        symbolName: component.localName
      }
    : null;
};

const createProjectComponentSymbolLocations = (
  component: ElfProjectComponent,
  kind: ElfProjectComponentSymbol["kind"],
  name: string
): Location[] => {
  if (!component.uri) {
    return [];
  }

  const range =
    component.symbols?.find((symbol) => isProjectComponentSymbolMatch(symbol, kind, name))?.range ??
    component.definition;

  return range
    ? [
        {
          range,
          uri: component.uri
        }
      ]
    : [];
};

const isProjectComponentSymbolMatch = (
  symbol: ElfProjectComponentSymbol,
  kind: ElfProjectComponentSymbol["kind"],
  name: string
): boolean => {
  if (symbol.kind !== kind) {
    return false;
  }

  return symbol.name === name || toKebabCase(symbol.name) === name;
};

const findHtmlNodeAtOffset = (
  nodes: HTMLNode[],
  offset: number,
  parent: HTMLNode | null = null
): HtmlNodeMatch | null => {
  for (const node of nodes) {
    const nodeEnd = node.end ?? node.startTagEnd ?? node.start;

    if (offset < node.start || offset > nodeEnd) {
      continue;
    }

    const child = findHtmlNodeAtOffset(node.children, offset, node);

    return child ?? { node, parent };
  }

  return null;
};

const findAttributeNameAtOffset = (
  virtualDocument: TextDocument,
  node: HTMLNode,
  offset: number
): string | null => {
  const template = virtualDocument.getText();

  return (
    Object.keys(node.attributes ?? {}).find((attribute) => {
      const range = findAttributeVirtualRange(template, node, attribute);

      return range ? offset >= range.start && offset <= range.end : false;
    }) ?? null
  );
};

const isOffsetInNodeStartTagName = (node: HTMLNode, offset: number): boolean => {
  if (!node.tag) {
    return false;
  }

  const start = node.start + 1;
  const end = start + node.tag.length;

  return offset >= start && offset <= end;
};

const readSlotWordNameAtOffset = (source: string, offset: number): string | null => {
  return readSlotWordRangeAtOffset(source, offset)?.value ?? null;
};

const readSlotWordRangeAtOffset = (
  source: string,
  offset: number
): { end: number; start: number; value: string } | null => {
  const word = readWordRangeAtOffset(source, offset);

  if (!word || source[word.start - 1] !== "#") {
    return null;
  }

  return word;
};

export const createElfDocumentSymbols = (document: TextDocument): DocumentSymbol[] => {
  const analysis = analyzeElfSource(document.getText(), {
    fileName: document.uri
  });

  return analysis.components.map((component, index) => {
    const range = createComponentRange(document, component);
    const children: DocumentSymbol[] = [
      ...component.symbols.map((symbol) => ({
        children: [],
        detail: `ElfUI ${symbol.kind}`,
        kind: symbolKindForComponentSymbol(symbol.kind),
        name: symbol.name,
        range: createRangeFromOffsets(document, symbol.start, symbol.end),
        selectionRange: createRangeFromOffsets(document, symbol.start, symbol.end)
      })),
      ...component.templates.map((region, regionIndex) => ({
        children: [],
        detail: "ElfUI template string",
        kind: SymbolKind.String,
        name: component.templates.length > 1 ? `template #${regionIndex + 1}` : "template",
        range: createRangeFromOffsets(document, region.start, region.end),
        selectionRange: createRangeFromOffsets(document, region.contentStart, region.contentEnd)
      })),
      ...component.styles.map((region, regionIndex) => ({
        children: [],
        detail: "ElfUI style string",
        kind: SymbolKind.String,
        name: component.styles.length > 1 ? `style #${regionIndex + 1}` : "style",
        range: createRangeFromOffsets(document, region.start, region.end),
        selectionRange: createRangeFromOffsets(document, region.contentStart, region.contentEnd)
      }))
    ];

    return {
      children,
      detail: component.macro ? "ElfUI macro component" : "ElfUI chain component",
      kind: SymbolKind.Class,
      name: component.localName ?? component.name ?? component.id ?? `component #${index + 1}`,
      range,
      selectionRange: range
    };
  });
};

export const createElfDocumentLinks = (document: TextDocument): DocumentLink[] => {
  const source = document.getText();
  const analysis = analyzeElfSource(source, {
    fileName: document.uri
  });

  return [
    ...createImportDocumentLinks(document),
    ...analysis.components.flatMap((component) => [
      ...component.templates.flatMap((region) => createTemplateDocumentLinks(document, region)),
      ...component.styles.flatMap((region) => createStyleDocumentLinks(document, region))
    ])
  ];
};

const createImportDocumentLinks = (document: TextDocument): DocumentLink[] => {
  const source = document.getText();
  const sourceFile = createTsSourceFile(source);
  const links: DocumentLink[] = [];

  sourceFile.statements.forEach((statement) => {
    const moduleSpecifier =
      ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
        ? statement.moduleSpecifier
        : null;

    if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) {
      return;
    }

    const target = resolveDocumentLinkTarget(document.uri, moduleSpecifier.text);

    if (!target) {
      return;
    }

    links.push({
      range: createRangeFromOffsets(
        document,
        moduleSpecifier.getStart(sourceFile) + 1,
        moduleSpecifier.getEnd() - 1
      ),
      target
    });
  });

  return links;
};

const createTemplateDocumentLinks = (
  document: TextDocument,
  region: EmbeddedRegion
): DocumentLink[] => {
  const virtualDocument = createVirtualDocument(document.uri, region);
  const htmlDocument = htmlLanguageService.parseHTMLDocument(virtualDocument);
  const template = virtualDocument.getText();
  const links: DocumentLink[] = [];
  const linkAttributes = new Set(["action", "href", "poster", "src"]);
  const visit = (node: HTMLNode) => {
    Object.entries(node.attributes ?? {}).forEach(([attribute, value]) => {
      if (!linkAttributes.has(attribute) || typeof value !== "string") {
        return;
      }

      const valueRange = findAttributeValueVirtualRange(template, node, attribute);
      const target = resolveDocumentLinkTarget(document.uri, unwrapHtmlAttributeValue(value));

      if (!valueRange || !target) {
        return;
      }

      links.push({
        range: mapVirtualRangeByOffsets(
          document,
          region,
          virtualDocument,
          valueRange.start,
          valueRange.end
        ),
        target
      });
    });

    node.children.forEach(visit);
  };

  htmlDocument.roots.forEach(visit);

  return links;
};

const createStyleDocumentLinks = (
  document: TextDocument,
  region: EmbeddedRegion
): DocumentLink[] => {
  const virtualDocument = createVirtualDocument(document.uri, region);
  const style = virtualDocument.getText();
  const links: DocumentLink[] = [];
  const pattern = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)/g;

  for (const match of style.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }

    const raw = match[1] ?? match[2] ?? match[3];

    if (!raw) {
      continue;
    }

    const valueStart = match.index + match[0].indexOf(raw);
    const target = resolveDocumentLinkTarget(document.uri, raw);

    if (!target) {
      continue;
    }

    links.push({
      range: mapVirtualRangeByOffsets(
        document,
        region,
        virtualDocument,
        valueStart,
        valueStart + raw.length
      ),
      target
    });
  }

  return links;
};

export const createElfReferences = (
  document: TextDocument,
  position: Position,
  options: ElfLanguageServiceOptions = {}
): Location[] => {
  const projectTarget = resolveProjectReferenceTargetAtPosition(document, position, options);

  if (projectTarget) {
    return collectProjectReferenceLocations(document, projectTarget);
  }

  const target = resolveElfReferenceTarget(document, position);

  if (!target) {
    return [];
  }

  return collectElfReferenceItems(document, target).map((item) => ({
    range: item.range,
    uri: document.uri
  }));
};

export const createElfDocumentHighlights = (
  document: TextDocument,
  position: Position,
  options: ElfLanguageServiceOptions = {}
): DocumentHighlight[] => {
  const projectTarget = resolveProjectReferenceTargetAtPosition(document, position, options);

  if (projectTarget) {
    return collectProjectReferenceItems(document, projectTarget).map(createDocumentHighlight);
  }

  const target = resolveElfReferenceTarget(document, position);

  if (!target) {
    return [];
  }

  return collectElfReferenceItems(document, target).map(createDocumentHighlight);
};

export const createElfPrepareRename = (
  document: TextDocument,
  position: Position,
  options: ElfLanguageServiceOptions = {}
): { placeholder: string; range: Range } | null => {
  const projectTarget = resolveProjectReferenceTargetAtPosition(document, position, options);

  if (projectTarget) {
    return {
      placeholder: projectTarget.name,
      range: projectTarget.range
    };
  }

  const target = resolveElfReferenceTarget(document, position);

  return target ? { placeholder: target.name, range: target.range } : null;
};

export const createElfRenameEdit = (
  document: TextDocument,
  position: Position,
  newName: string,
  options: ElfLanguageServiceOptions = {}
): WorkspaceEdit | null => {
  const projectTarget = resolveProjectReferenceTargetAtPosition(document, position, options);

  if (projectTarget) {
    if (!isValidRenameName(newName)) {
      return null;
    }

    const edits = collectProjectReferenceItems(document, projectTarget).map((item) => ({
      newText: item.text === toKebabCase(projectTarget.name) ? toKebabCase(newName) : newName,
      range: item.range
    }));
    const declarationEdit = createProjectDeclarationRenameEdit(projectTarget, newName);
    const changes: NonNullable<WorkspaceEdit["changes"]> = {
      [document.uri]: edits
    };

    if (declarationEdit) {
      changes[projectTarget.component.uri!] = [declarationEdit];
    }

    return edits.length > 0 || declarationEdit
      ? {
          changes
        }
      : null;
  }

  const target = resolveElfReferenceTarget(document, position);

  if (!target || !isValidRenameName(newName)) {
    return null;
  }

  const edits = collectElfReferenceItems(document, target).map((item) => ({
    newText: item.text === toKebabCase(target.name) ? toKebabCase(newName) : newName,
    range: item.range
  }));

  return edits.length > 0
    ? {
        changes: {
          [document.uri]: edits
        }
      }
    : null;
};

const createDocumentHighlight = (item: ElfReferenceItem): DocumentHighlight => ({
  kind: DocumentHighlightKind.Text,
  range: item.range
});

export const createElfFoldingRanges = (
  document: TextDocument,
  context?: { rangeLimit?: number }
): FoldingRange[] => {
  const analysis = analyzeElfSource(document.getText(), {
    fileName: document.uri
  });

  return analysis.components.flatMap((component) => [
    ...component.templates.flatMap((region) =>
      createEmbeddedFoldingRanges(document, region, "template", context)
    ),
    ...component.styles.flatMap((region) =>
      createEmbeddedFoldingRanges(document, region, "style", context)
    )
  ]);
};

export const createElfSelectionRanges = (
  document: TextDocument,
  positions: Position[]
): SelectionRange[] =>
  positions.map((position) => {
    const templateContext = findEmbeddedDocumentContext(document, position, "template");

    if (templateContext) {
      const [selectionRange] = htmlLanguageService.getSelectionRanges(
        templateContext.virtualDocument,
        [templateContext.virtualPosition]
      );

      return selectionRange
        ? mapSelectionRange(document, templateContext, selectionRange)
        : createFallbackSelectionRange(position);
    }

    const styleContext = findEmbeddedDocumentContext(document, position, "style");

    if (styleContext) {
      const stylesheet = cssLanguageService.parseStylesheet(styleContext.virtualDocument);
      const [selectionRange] = cssLanguageService.getSelectionRanges(
        styleContext.virtualDocument,
        [styleContext.virtualPosition],
        stylesheet
      );

      return selectionRange
        ? mapSelectionRange(document, styleContext, selectionRange)
        : createFallbackSelectionRange(position);
    }

    return createFallbackSelectionRange(position);
  });

export const createElfLinkedEditingRanges = (
  document: TextDocument,
  position: Position
): LinkedEditingRanges | null => {
  const templateContext = findEmbeddedDocumentContext(document, position, "template");

  if (!templateContext) {
    return null;
  }

  const ranges = htmlLanguageService.findLinkedEditingRanges(
    templateContext.virtualDocument,
    templateContext.virtualPosition,
    parseHTML(templateContext)
  );

  return ranges && ranges.length > 1
    ? {
        ranges: ranges.map((range) =>
          mapVirtualRange(document, templateContext.region, templateContext.virtualDocument, range)
        )
      }
    : null;
};

const createEmbeddedFoldingRanges = (
  document: TextDocument,
  region: EmbeddedRegion,
  kind: EmbeddedRegion["kind"],
  context?: { rangeLimit?: number }
): FoldingRange[] => {
  const virtualDocument = createVirtualDocument(document.uri, region);
  const foldingRanges =
    kind === "template"
      ? htmlLanguageService.getFoldingRanges(virtualDocument, context)
      : cssLanguageService.getFoldingRanges(virtualDocument, context);

  return foldingRanges.map((range) =>
    mapFoldingRange(document, { region, virtualDocument }, range)
  );
};

const mapFoldingRange = (
  document: TextDocument,
  context: EmbeddedMappingContext,
  range: FoldingRange
): FoldingRange => {
  const start = mapVirtualPosition(document, context.region, context.virtualDocument, {
    character: range.startCharacter ?? 0,
    line: range.startLine
  });
  const end = mapVirtualPosition(document, context.region, context.virtualDocument, {
    character: range.endCharacter ?? 0,
    line: range.endLine
  });

  const mapped: FoldingRange = {
    ...range,
    endLine: end.line,
    startLine: start.line
  };

  if (range.startCharacter !== undefined) {
    mapped.startCharacter = start.character;
  }

  if (range.endCharacter !== undefined) {
    mapped.endCharacter = end.character;
  }

  return mapped;
};

const mapSelectionRange = (
  document: TextDocument,
  context: EmbeddedMappingContext,
  selectionRange: SelectionRange
): SelectionRange => {
  const mapped: SelectionRange = {
    range: mapVirtualRange(document, context.region, context.virtualDocument, selectionRange.range)
  };

  if (selectionRange.parent) {
    mapped.parent = mapSelectionRange(document, context, selectionRange.parent);
  }

  return mapped;
};

const createFallbackSelectionRange = (position: Position): SelectionRange => ({
  range: {
    end: position,
    start: position
  }
});

export const createElfSemanticTokens = (
  document: TextDocument,
  range?: Range,
  options: ElfLanguageServiceOptions = {}
): SemanticTokens => {
  const source = document.getText();
  const sourceStart = range ? document.offsetAt(range.start) : 0;
  const sourceEnd = range ? document.offsetAt(range.end) : source.length;
  const analysis = analyzeElfSource(source, {
    fileName: document.uri
  });
  const resolvedOptions = resolveLanguageServiceOptions(options);
  const tokens = analysis.components.flatMap((component) => [
    ...createComponentDeclarationSemanticTokens(component),
    ...component.templates.flatMap((region) =>
      createTemplateSemanticTokens(
        document,
        analysis.components,
        component,
        region,
        resolvedOptions.projectComponents
      )
    )
  ]);

  return encodeSemanticTokens(
    document,
    tokens.filter((token) =>
      isOffsetRangeOverlapping(token.start, token.start + token.length, sourceStart, sourceEnd)
    )
  );
};

const createComponentDeclarationSemanticTokens = (component: ComponentMeta): ElfSemanticToken[] =>
  component.symbols.map((symbol) => ({
    length: Math.max(0, symbol.end - symbol.start),
    modifiers: ["declaration"],
    start: symbol.start,
    type: semanticTokenTypeForComponentSymbol(symbol.kind)
  }));

const createTemplateSemanticTokens = (
  document: TextDocument,
  components: ComponentMeta[],
  component: ComponentMeta,
  region: EmbeddedRegion,
  projectComponents: ElfProjectComponent[]
): ElfSemanticToken[] => {
  const virtualDocument = createVirtualDocument(document.uri, region);
  const htmlDocument = htmlLanguageService.parseHTMLDocument(virtualDocument);
  const tokens: ElfSemanticToken[] = [];
  const pushVirtualToken = (
    start: number,
    end: number,
    type: ElfSemanticToken["type"],
    modifiers?: ElfSemanticToken["modifiers"]
  ) => {
    if (end <= start) {
      return;
    }

    const token: ElfSemanticToken = {
      length: end - start,
      start: region.contentStart + start,
      type
    };

    if (modifiers) {
      token.modifiers = modifiers;
    }

    tokens.push(token);
  };
  const visit = (node: HTMLNode, parent: HTMLNode | null = null) => {
    if (node.tag) {
      const definition =
        findTemplateComponentDefinitionForTag(components, component, node.tag, projectComponents) ??
        (parent?.tag
          ? findTemplateComponentDefinitionForTag(
              components,
              component,
              parent.tag,
              projectComponents
            )
          : null);

      if (definition && node.tag !== "template") {
        pushVirtualToken(node.start + 1, node.start + 1 + node.tag.length, "class");

        if (node.endTagStart !== undefined) {
          pushVirtualToken(node.endTagStart + 2, node.endTagStart + 2 + node.tag.length, "class");
        }
      }

      Object.keys(node.attributes ?? {}).forEach((attribute) => {
        const attributeRange = findAttributeVirtualRange(
          virtualDocument.getText(),
          node,
          attribute
        );

        if (!attributeRange) {
          return;
        }

        const directivePart = readDirectiveNamePart(attribute);

        if (directivePart) {
          pushVirtualToken(
            attributeRange.start + directivePart.start,
            attributeRange.start + directivePart.start + directivePart.text.length,
            "keyword"
          );
        }

        const reference = readAttributeProjectReference(attribute);

        if (!reference || (reference.kind === "prop" && attribute === "v-model")) {
          return;
        }

        const referenceRange = findAttributeNamePartVirtualRange(
          virtualDocument.getText(),
          node,
          attribute,
          reference.kind
        );

        if (!referenceRange) {
          return;
        }

        pushVirtualToken(
          referenceRange.start,
          referenceRange.end,
          semanticTokenTypeForProjectKind(reference.kind)
        );
      });
    }

    node.children.forEach((child) => visit(child, node));
  };

  htmlDocument.roots.forEach((node) => visit(node));
  tokens.push(...createTemplateExpressionSemanticTokens(component, region));

  return tokens;
};

const createTemplateExpressionSemanticTokens = (
  component: ComponentMeta,
  region: EmbeddedRegion
): ElfSemanticToken[] => {
  const knownNames = createKnownTemplateNames(component);

  return collectTemplateExpressions(region.content).flatMap((expression) => {
    const locals = new Set([...expression.locals, ...knownNames]);
    const sanitized = blankStringLiterals(expression.value);
    const tokens: ElfSemanticToken[] = [];
    const identifierPattern = /(?<![\w$])[A-Za-z_$][\w$]*/g;

    for (const match of sanitized.matchAll(identifierPattern)) {
      const name = match[0];
      const index = match.index;

      if (
        index === undefined ||
        !locals.has(name) ||
        templateGlobals.has(name) ||
        templateReservedWords.has(name) ||
        isPropertyAccess(sanitized, index) ||
        isObjectPropertyKey(sanitized, index + name.length)
      ) {
        continue;
      }

      tokens.push({
        length: name.length,
        start: region.contentStart + expression.start + index,
        type: semanticTokenTypeForTemplateName(component, name)
      });
    }

    return tokens;
  });
};

const semanticTokenTypeForComponentSymbol = (
  kind: ComponentMeta["symbols"][number]["kind"]
): ElfSemanticToken["type"] => {
  switch (kind) {
    case "component":
      return "class";
    case "emit":
      return "event";
    case "prop":
      return "property";
    case "setup":
      return "variable";
    case "slot":
      return "interface";
  }
};

const semanticTokenTypeForProjectKind = (
  kind: ElfProjectComponentSymbol["kind"]
): ElfSemanticToken["type"] => {
  switch (kind) {
    case "component":
      return "class";
    case "emit":
      return "event";
    case "prop":
      return "property";
    case "slot":
      return "interface";
  }
};

const semanticTokenTypeForTemplateName = (
  component: ComponentMeta,
  name: string
): ElfSemanticToken["type"] => {
  if (component.props.includes(name)) {
    return "property";
  }

  if (component.emits.includes(name)) {
    return "event";
  }

  if (component.slots.includes(name)) {
    return "interface";
  }

  if (component.uses.some((item) => item.localName === name)) {
    return "class";
  }

  return "variable";
};

const encodeSemanticTokens = (
  document: TextDocument,
  tokens: ElfSemanticToken[]
): SemanticTokens => {
  const data: number[] = [];
  let previousLine = 0;
  let previousCharacter = 0;

  tokens
    .filter((token) => token.length > 0)
    .sort((left, right) => {
      const leftPosition = document.positionAt(left.start);
      const rightPosition = document.positionAt(right.start);

      return (
        leftPosition.line - rightPosition.line || leftPosition.character - rightPosition.character
      );
    })
    .forEach((token) => {
      const position = document.positionAt(token.start);
      const deltaLine = position.line - previousLine;
      const deltaStart =
        deltaLine === 0 ? position.character - previousCharacter : position.character;

      data.push(
        deltaLine,
        deltaStart,
        token.length,
        elfSemanticTokenTypes.indexOf(token.type),
        encodeSemanticTokenModifiers(token.modifiers ?? [])
      );
      previousLine = position.line;
      previousCharacter = position.character;
    });

  return { data };
};

const encodeSemanticTokenModifiers = (
  modifiers: Array<(typeof elfSemanticTokenModifiers)[number]>
): number =>
  modifiers.reduce((mask, modifier) => {
    const index = elfSemanticTokenModifiers.indexOf(modifier);

    return index >= 0 ? mask | (1 << index) : mask;
  }, 0);

const readDirectiveNamePart = (attribute: string): { start: number; text: string } | null => {
  if (attribute.startsWith("v-")) {
    const text = attribute.split(/[.:]/)[0] ?? attribute;

    return { start: 0, text };
  }

  if (attribute.startsWith(":")) {
    return { start: 0, text: ":" };
  }

  if (attribute.startsWith("@")) {
    return { start: 0, text: "@" };
  }

  if (attribute.startsWith("#")) {
    return { start: 0, text: "#" };
  }

  return null;
};

export const createElfInlayHints = (document: TextDocument, range?: Range): InlayHint[] => {
  const analysis = analyzeElfSource(document.getText(), {
    fileName: document.uri
  });
  const sourceStart = range ? document.offsetAt(range.start) : 0;
  const sourceEnd = range ? document.offsetAt(range.end) : document.getText().length;

  return analysis.components.flatMap((component) =>
    component.templates
      .filter((region) => isRegionOverlappingRange(region, sourceStart, sourceEnd))
      .flatMap((region) => createTemplateInlayHints(document, component, region))
  );
};

export const createElfCodeActions = (
  document: TextDocument,
  range: Range,
  context: CodeActionContext,
  options: ElfLanguageServiceOptions = {}
): CodeAction[] => {
  const diagnostics = context.diagnostics.filter(isElfCodeActionDiagnostic);
  const resolvedOptions = resolveLanguageServiceOptions(options);
  const actions = [
    ...createTemplateBindingStyleActions(document, range),
    ...createTemplateComponentAutoImportActions(
      document,
      range,
      diagnostics,
      resolvedOptions.projectComponents
    ),
    ...createTemplateDeclarationCodeActions(document, range, diagnostics)
  ];

  if (diagnostics.length === 0) {
    return actions;
  }

  return actions.map((action) => ({
    ...action,
    diagnostics
  }));
};

const isElfCodeActionDiagnostic = (diagnostic: Diagnostic): boolean =>
  diagnostic.source === "ElfUI" || diagnostic.source === "ElfUI Macro";

export const createElfDocumentColors = (document: TextDocument): ColorInformation[] => {
  const analysis = analyzeElfSource(document.getText(), {
    fileName: document.uri
  });

  return analysis.components.flatMap((component) =>
    component.styles.flatMap((region) => {
      const virtualDocument = createVirtualDocument(document.uri, region);
      const stylesheet = cssLanguageService.parseStylesheet(virtualDocument);

      return cssLanguageService.findDocumentColors(virtualDocument, stylesheet).map((color) => ({
        ...color,
        range: mapVirtualRange(document, region, virtualDocument, color.range)
      }));
    })
  );
};

export const createElfColorPresentations = (
  document: TextDocument,
  color: Color,
  range: Range
): ColorPresentation[] => {
  const styleContext = findEmbeddedDocumentContext(document, range.start, "style");

  if (!styleContext) {
    return [];
  }

  const stylesheet = cssLanguageService.parseStylesheet(styleContext.virtualDocument);
  const virtualRange = mapSourceRange(
    document,
    styleContext.region,
    styleContext.virtualDocument,
    range
  );

  return cssLanguageService
    .getColorPresentations(styleContext.virtualDocument, stylesheet, color, virtualRange)
    .map((presentation) => mapColorPresentation(document, styleContext, presentation));
};

export const createElfFormattingEdits = (
  document: TextDocument,
  options: ElfFormattingOptions
): TextEdit[] => {
  const analysis = analyzeElfSource(document.getText(), {
    fileName: document.uri
  });

  return analysis.components.flatMap((component) => [
    ...component.templates.flatMap((region) => formatEmbeddedRegion(document, region, options)),
    ...component.styles.flatMap((region) => formatEmbeddedRegion(document, region, options))
  ]);
};

export const createElfRangeFormattingEdits = (
  document: TextDocument,
  range: Range,
  options: ElfFormattingOptions
): TextEdit[] => {
  const analysis = analyzeElfSource(document.getText(), {
    fileName: document.uri
  });
  const start = document.offsetAt(range.start);
  const end = document.offsetAt(range.end);

  return analysis.components.flatMap((component) =>
    [...component.templates, ...component.styles]
      .filter((region) => isRegionOverlappingRange(region, start, end))
      .flatMap((region) => formatEmbeddedRegion(document, region, options, range))
  );
};

const createComponentRange = (document: TextDocument, component: ComponentMeta): Range => {
  const offsets = [
    ...component.symbols.flatMap((symbol) => [symbol.start, symbol.end]),
    ...component.templates.flatMap((region) => [region.start, region.end]),
    ...component.styles.flatMap((region) => [region.start, region.end])
  ];

  return offsets.length > 0
    ? createRangeFromOffsets(document, Math.min(...offsets), Math.max(...offsets))
    : createRangeFromOffsets(document, 0, document.getText().length);
};

const createRangeFromOffsets = (document: TextDocument, start: number, end: number): Range => ({
  end: document.positionAt(end),
  start: document.positionAt(start)
});

const symbolKindForComponentSymbol = (
  kind: ComponentMeta["symbols"][number]["kind"]
): SymbolKind => {
  switch (kind) {
    case "component":
      return SymbolKind.Class;
    case "emit":
      return SymbolKind.Event;
    case "prop":
      return SymbolKind.Field;
    case "setup":
      return SymbolKind.Variable;
    case "slot":
      return SymbolKind.Interface;
  }
};

const resolveElfReferenceTarget = (
  document: TextDocument,
  position: Position
): ElfReferenceTarget | null => {
  const source = document.getText();
  const offset = document.offsetAt(position);
  const analysis = analyzeElfSource(source, {
    fileName: document.uri
  });

  for (const component of analysis.components) {
    const sourceSymbol = component.symbols.find(
      (symbol) => offset >= symbol.start && offset <= symbol.end
    );

    if (sourceSymbol) {
      return {
        component,
        name: sourceSymbol.name,
        range: createRangeFromOffsets(document, sourceSymbol.start, sourceSymbol.end)
      };
    }

    const templateRegion = component.templates.find((region) =>
      isInsideEmbeddedRegion(region, offset)
    );

    if (!templateRegion) {
      continue;
    }

    const virtualDocument = createVirtualDocument(document.uri, templateRegion);
    const virtualOffset = clamp(
      offset - templateRegion.contentStart,
      0,
      templateRegion.content.length
    );
    const word = readWordRangeAtOffset(templateRegion.content, virtualOffset);

    if (!word) {
      continue;
    }

    const name = normalizeReferenceName(component, word.value);

    if (!isKnownReferenceName(component, name)) {
      continue;
    }

    return {
      component,
      name,
      range: mapVirtualRangeByOffsets(
        document,
        templateRegion,
        virtualDocument,
        word.start,
        word.end
      )
    };
  }

  const sourceWord = readWordRangeAtOffset(source, offset);

  if (!sourceWord) {
    return null;
  }

  const component = analysis.components.find((item) =>
    item.symbols.some((symbol) => symbol.name === sourceWord.value)
  );

  return component && isKnownReferenceName(component, sourceWord.value)
    ? {
        component,
        name: sourceWord.value,
        range: createRangeFromOffsets(document, sourceWord.start, sourceWord.end)
      }
    : null;
};

const normalizeReferenceName = (component: ComponentMeta, value: string): string => {
  const componentUse = component.uses.find(
    (item) => item.localName === value || toKebabCase(item.localName) === value
  );

  if (componentUse) {
    return componentUse.localName;
  }

  const propName = normalizePropName(value);

  return propName && component.props.includes(propName) ? propName : value;
};

const isKnownReferenceName = (component: ComponentMeta, name: string): boolean =>
  component.props.includes(name) ||
  component.emits.includes(name) ||
  component.setupReturns.includes(name) ||
  component.slots.includes(name) ||
  component.uses.some((item) => item.localName === name);

const collectElfReferenceItems = (
  document: TextDocument,
  target: ElfReferenceTarget
): ElfReferenceItem[] => {
  const aliases = createReferenceAliases(target.component, target.name);
  const seen = new Set<string>();
  const add = (items: ElfReferenceItem[], item: ElfReferenceItem) => {
    const key = `${item.range.start.line}:${item.range.start.character}:${item.range.end.line}:${item.range.end.character}`;

    if (!seen.has(key)) {
      seen.add(key);
      items.push(item);
    }
  };
  const result: ElfReferenceItem[] = [];

  target.component.symbols
    .filter((symbol) => symbol.name === target.name)
    .forEach((symbol) =>
      add(result, {
        range: createRangeFromOffsets(document, symbol.start, symbol.end),
        text: symbol.name
      })
    );

  target.component.templates.forEach((region) => {
    collectTemplateReferenceItems(document, region, aliases).forEach((item) => add(result, item));
  });

  return result;
};

const createReferenceAliases = (component: ComponentMeta, name: string): string[] => {
  const aliases = new Set([name]);

  if (component.props.includes(name) || component.uses.some((item) => item.localName === name)) {
    aliases.add(toKebabCase(name));
  }

  return [...aliases];
};

const collectTemplateReferenceItems = (
  document: TextDocument,
  region: EmbeddedRegion,
  aliases: string[]
): ElfReferenceItem[] => {
  const virtualDocument = createVirtualDocument(document.uri, region);

  return aliases.flatMap((alias) => {
    const pattern = new RegExp(`(?<![\\w$-])${escapeRegExp(alias)}(?![\\w$-])`, "g");
    const matches: ElfReferenceItem[] = [];

    for (const match of region.content.matchAll(pattern)) {
      if (match.index === undefined) {
        continue;
      }

      matches.push({
        range: mapVirtualRangeByOffsets(
          document,
          region,
          virtualDocument,
          match.index,
          match.index + alias.length
        ),
        text: alias
      });
    }

    return matches;
  });
};

const resolveProjectReferenceTargetAtPosition = (
  document: TextDocument,
  position: Position,
  options: ElfLanguageServiceOptions
): ElfProjectReferenceTarget | null => {
  const resolvedOptions = resolveLanguageServiceOptions(options);
  const context = findEmbeddedDocumentContext(document, position, "template");

  return context
    ? resolveProjectReferenceTarget(document, context, resolvedOptions.projectComponents)
    : null;
};

const collectProjectReferenceLocations = (
  document: TextDocument,
  target: ElfProjectReferenceTarget
): Location[] => {
  const currentFileReferences = collectProjectReferenceItems(document, target).map((item) => ({
    range: item.range,
    uri: document.uri
  }));
  const declarationReferences = createProjectComponentSymbolLocations(
    target.component,
    target.kind,
    target.symbolName
  );
  const seen = new Set<string>();

  return [...declarationReferences, ...currentFileReferences].filter((location) => {
    const key = `${location.uri}:${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
};

const createProjectDeclarationRenameEdit = (
  target: ElfProjectReferenceTarget,
  newName: string
): TextEdit | null => {
  if (!target.component.uri || target.name !== target.symbolName) {
    return null;
  }

  const range =
    target.component.symbols?.find((symbol) =>
      isProjectComponentSymbolMatch(symbol, target.kind, target.symbolName)
    )?.range ?? (target.kind === "component" ? target.component.definition : undefined);

  return range
    ? {
        newText: newName,
        range
      }
    : null;
};

const collectProjectReferenceItems = (
  document: TextDocument,
  target: ElfProjectReferenceTarget
): ElfReferenceItem[] =>
  target.owner.templates.flatMap((region) => {
    const virtualDocument = createVirtualDocument(document.uri, region);
    const htmlDocument = htmlLanguageService.parseHTMLDocument(virtualDocument);

    return collectProjectReferencesFromNodes(
      document,
      target,
      region,
      virtualDocument,
      htmlDocument.roots
    );
  });

const collectProjectReferencesFromNodes = (
  document: TextDocument,
  target: ElfProjectReferenceTarget,
  region: EmbeddedRegion,
  virtualDocument: TextDocument,
  nodes: HTMLNode[],
  parent: HTMLNode | null = null
): ElfReferenceItem[] => {
  const result: ElfReferenceItem[] = [];
  const template = virtualDocument.getText();

  nodes.forEach((node) => {
    if (node.tag) {
      const component =
        findProjectComponentDefinitionForTag([target.component], target.owner, node.tag) ??
        (target.kind === "slot" && parent?.tag
          ? findProjectComponentDefinitionForTag([target.component], target.owner, parent.tag)
          : null);

      if (target.kind === "component" && component) {
        result.push({
          range: mapVirtualRangeByOffsets(
            document,
            region,
            virtualDocument,
            node.start + 1,
            node.start + 1 + node.tag.length
          ),
          text: node.tag
        });

        if (node.endTagStart !== undefined) {
          result.push({
            range: mapVirtualRangeByOffsets(
              document,
              region,
              virtualDocument,
              node.endTagStart + 2,
              node.endTagStart + 2 + node.tag.length
            ),
            text: node.tag
          });
        }
      }

      if (component && node.attributes) {
        Object.keys(node.attributes).forEach((attribute) => {
          const reference = readAttributeProjectReference(attribute);

          if (
            !reference ||
            reference.kind !== target.kind ||
            reference.name !== target.symbolName
          ) {
            return;
          }

          const range = findAttributeNamePartVirtualRange(
            template,
            node,
            attribute,
            reference.kind
          );

          if (!range) {
            return;
          }

          result.push({
            range: mapVirtualRangeByOffsets(
              document,
              region,
              virtualDocument,
              range.start,
              range.end
            ),
            text: reference.text
          });
        });
      }
    }

    result.push(
      ...collectProjectReferencesFromNodes(
        document,
        target,
        region,
        virtualDocument,
        node.children,
        node
      )
    );
  });

  return result;
};

const createTemplateInlayHints = (
  document: TextDocument,
  component: ComponentMeta,
  region: EmbeddedRegion
): InlayHint[] => {
  const virtualDocument = createVirtualDocument(document.uri, region);
  const htmlDocument = htmlLanguageService.parseHTMLDocument(virtualDocument);
  const hints: InlayHint[] = [];

  const visit = (node: HTMLNode) => {
    Object.keys(node.attributes ?? {}).forEach((attribute) => {
      const label = createAttributeInlayHintLabel(component, attribute);

      if (!label) {
        return;
      }

      hints.push({
        kind: InlayHintKind.Type,
        label,
        paddingLeft: true,
        position: findAttributeRange(document, region, virtualDocument, node, attribute).end
      });
    });

    node.children.forEach(visit);
  };

  htmlDocument.roots.forEach(visit);

  return hints;
};

const createAttributeInlayHintLabel = (
  component: ComponentMeta,
  attribute: string
): string | null => {
  if (attribute.startsWith("@") || attribute.startsWith("v-on:")) {
    return "event";
  }

  if (attribute.startsWith("#") || attribute === "v-slot" || attribute.startsWith("v-slot:")) {
    return "slot";
  }

  const propName = normalizePropAttributeName(attribute);

  return propName && (component.props.includes(propName) || attribute.startsWith(":"))
    ? "prop"
    : null;
};

const createTemplateBindingStyleActions = (document: TextDocument, range: Range): CodeAction[] => {
  const analysis = analyzeElfSource(document.getText(), {
    fileName: document.uri
  });
  const start = document.offsetAt(range.start);
  const end = document.offsetAt(range.end);

  return analysis.components.flatMap((component) =>
    component.templates.flatMap((region) => [
      ...createQuotedToExpressionActions(document, region, start, end),
      ...createExpressionToQuotedActions(document, region, start, end)
    ])
  );
};

const createQuotedToExpressionActions = (
  document: TextDocument,
  region: EmbeddedRegion,
  sourceStart: number,
  sourceEnd: number
): CodeAction[] => {
  const pattern =
    /(\s)([:@][\w:-]+(?:\.[\w-]+)*|v-(?:if|else-if|show|model|text|html|memo))\s*=\s*(["'])([\s\S]*?)\3/g;
  const actions: CodeAction[] = [];

  for (const match of region.content.matchAll(pattern)) {
    if (match.index === undefined || !match[2]) {
      continue;
    }

    const expression = match[4]?.trim() || "value";
    const localStart = match.index + (match[1]?.length ?? 0);
    const localEnd = match.index + match[0].length;

    if (
      !isOffsetRangeOverlapping(
        region.contentStart + localStart,
        region.contentStart + localEnd,
        sourceStart,
        sourceEnd
      )
    ) {
      continue;
    }

    actions.push({
      edit: {
        changes: {
          [document.uri]: [
            {
              newText: `${match[2]}=\${${expression}}`,
              range: createRangeFromOffsets(
                document,
                region.contentStart + localStart,
                region.contentStart + localEnd
              )
            }
          ]
        }
      },
      kind: CodeActionKind.QuickFix,
      title: "Convert to ElfUI expression binding"
    });
  }

  return actions;
};

const createExpressionToQuotedActions = (
  document: TextDocument,
  region: EmbeddedRegion,
  sourceStart: number,
  sourceEnd: number
): CodeAction[] => {
  const pattern =
    /(\s)([:@][\w:-]+(?:\.[\w-]+)*|v-(?:if|else-if|show|model|text|html|memo))\s*=\s*\$\{([\s\S]*?)\}/g;
  const actions: CodeAction[] = [];

  for (const match of region.content.matchAll(pattern)) {
    if (match.index === undefined || !match[2]) {
      continue;
    }

    const localStart = match.index + (match[1]?.length ?? 0);
    const localEnd = match.index + match[0].length;

    if (
      !isOffsetRangeOverlapping(
        region.contentStart + localStart,
        region.contentStart + localEnd,
        sourceStart,
        sourceEnd
      )
    ) {
      continue;
    }

    actions.push({
      edit: {
        changes: {
          [document.uri]: [
            {
              newText: `${match[2]}="${(match[3] ?? "").trim()}"`,
              range: createRangeFromOffsets(
                document,
                region.contentStart + localStart,
                region.contentStart + localEnd
              )
            }
          ]
        }
      },
      kind: CodeActionKind.QuickFix,
      title: "Convert to quoted ElfUI binding"
    });
  }

  return actions;
};

const isOffsetRangeOverlapping = (
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number
) => leftStart <= rightEnd && leftEnd >= rightStart;

const isValidRenameName = (name: string): boolean => /^[A-Za-z_$][\w$-]*$/.test(name);

const isValidIdentifier = (name: string): boolean => {
  if (!name || templateReservedWords.has(name)) {
    return false;
  }

  const sourceFile = ts.createSourceFile(
    "identifier.ts",
    `const ${name} = 0;`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const parseDiagnostics =
    (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? [];

  if (parseDiagnostics.length > 0) {
    return false;
  }

  const statement = sourceFile.statements[0];

  if (!statement || !ts.isVariableStatement(statement)) {
    return false;
  }

  const declaration = statement.declarationList.declarations[0];

  return Boolean(
    declaration && ts.isIdentifier(declaration.name) && declaration.name.text === name
  );
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const createContextualTemplateCompletions = (
  document: TextDocument,
  context: EmbeddedDocumentContext,
  options: ResolvedElfLanguageServiceOptions
): CompletionList | null => {
  const completionContext = resolveCurrentTemplateCompletionContext(context);

  if (
    !completionContext ||
    (completionContext.kind === "tag" && completionContext.mode === "open")
  ) {
    return null;
  }

  const items = createTemplateCompletionsForContext(document, context, completionContext, options);

  return {
    isIncomplete: false,
    items: filterCompletionItems(completionContext.prefix, dedupeCompletionItems(items))
  };
};

const createTemplateCompletionsForContext = (
  document: TextDocument,
  context: EmbeddedDocumentContext,
  completionContext: TemplateCompletionContext,
  options: ResolvedElfLanguageServiceOptions
): CompletionItem[] => {
  switch (completionContext.kind) {
    case "attribute-name":
      return [
        ...createDirectiveCompletions(document, context, completionContext, options.completion),
        ...createPropBindingCompletions(
          document,
          context,
          completionContext,
          options,
          options.completion
        ),
        ...createEventCompletions(
          document,
          context,
          completionContext,
          options,
          options.completion
        ),
        ...createSlotCompletions(document, context, completionContext, options)
      ];
    case "directive":
      return createDirectiveCompletions(document, context, completionContext, options.completion);
    case "event":
      return createEventCompletions(
        document,
        context,
        completionContext,
        options,
        options.completion
      );
    case "event-modifier":
      return eventModifiers.map((label) =>
        createTemplateCompletionItem(document, context, completionContext, {
          detail: `ElfUI modifier for @${completionContext.eventName}`,
          kind: CompletionItemKind.Property,
          label,
          newText: label
        })
      );
    case "expression":
      return createExpressionCompletions(document, context, completionContext, options);
    case "model-modifier":
      return modelModifiers.map((label) =>
        createTemplateCompletionItem(document, context, completionContext, {
          detail: "ElfUI v-model modifier",
          kind: CompletionItemKind.Property,
          label,
          newText: label
        })
      );
    case "prop-binding":
      return createPropBindingCompletions(
        document,
        context,
        completionContext,
        options,
        options.completion
      );
    case "slot":
      return createSlotCompletions(document, context, completionContext, options);
    case "tag":
      return createTagCompletions(document, context, completionContext, options);
  }
};

const createDirectiveCompletions = (
  document: TextDocument,
  context: EmbeddedDocumentContext,
  completionContext: TemplateCompletionContext,
  completionOptions: ResolvedElfCompletionOptions
): CompletionItem[] =>
  templateDirectives.map((directive) =>
    createTemplateCompletionItem(document, context, completionContext, {
      detail: "ElfUI directive",
      insertTextFormat: InsertTextFormat.Snippet,
      kind: CompletionItemKind.Property,
      label: directive.label,
      newText: createDirectiveCompletionText(directive, completionOptions)
    })
  );

const createEventCompletions = (
  document: TextDocument,
  context: EmbeddedDocumentContext,
  completionContext: TemplateCompletionContext,
  options: ResolvedElfLanguageServiceOptions,
  completionOptions: ResolvedElfCompletionOptions
): CompletionItem[] => {
  const target = readCompletionTarget(context, options);

  return createEventNames(target.emits).map((eventName) =>
    createTemplateCompletionItem(document, context, completionContext, {
      detail: target.emits.includes(eventName) ? "ElfUI emit" : "DOM event",
      insertTextFormat: InsertTextFormat.Snippet,
      kind: CompletionItemKind.Event,
      label: `@${eventName}`,
      newText: createValueBindingSnippet(
        `@${eventName}`,
        completionOptions.eventBindingStyle,
        "handler"
      )
    })
  );
};

const createExpressionCompletions = (
  document: TextDocument,
  context: EmbeddedDocumentContext,
  completionContext: TemplateCompletionContext,
  options: ResolvedElfLanguageServiceOptions
): CompletionItem[] => {
  const tsCompletions = createTypeScriptExpressionCompletions(
    document,
    context,
    completionContext,
    options
  );

  if (isMemberExpressionCompletion(context, completionContext) && tsCompletions.length > 0) {
    return tsCompletions;
  }

  return [
    ...tsCompletions,
    ...createElfScopeExpressionCompletions(document, context, completionContext)
  ];
};

const createElfScopeExpressionCompletions = (
  document: TextDocument,
  context: EmbeddedDocumentContext,
  completionContext: TemplateCompletionContext
): CompletionItem[] => [
  ...emitHelpers.map((label) =>
    createTemplateCompletionItem(document, context, completionContext, {
      detail: "ElfUI emit helper",
      insertTextFormat: InsertTextFormat.Snippet,
      kind: CompletionItemKind.Function,
      label,
      newText: `${label}("$1")`
    })
  ),
  ...context.component.props.map((label) =>
    createTemplateCompletionItem(document, context, completionContext, {
      detail: "ElfUI prop",
      kind: CompletionItemKind.Variable,
      label,
      newText: label
    })
  ),
  ...context.component.setupReturns.map((label) =>
    createTemplateCompletionItem(document, context, completionContext, {
      detail: "ElfUI setup return",
      kind: CompletionItemKind.Variable,
      label,
      newText: label
    })
  ),
  ...createTemplateLocalCompletions(
    document,
    context,
    completionContext,
    context.virtualDocument.getText()
  ),
  ...(context.component.formControl
    ? formControlMembers.map((label) =>
        createTemplateCompletionItem(document, context, completionContext, {
          detail: "ElfUI form control context",
          kind: CompletionItemKind.Property,
          label,
          newText: label
        })
      )
    : [])
];

const createTypeScriptExpressionCompletions = (
  document: TextDocument,
  context: EmbeddedDocumentContext,
  completionContext: TemplateCompletionContext,
  options: ResolvedElfLanguageServiceOptions
): CompletionItem[] => {
  const expression = readExpressionPrefixAtOffset(
    context.virtualDocument.getText(),
    context.virtualDocument.offsetAt(context.virtualPosition)
  );

  if (!expression || !expression.includes(".")) {
    return [];
  }

  let completionEntries = readTypeScriptCompletionsAtExpression(
    document,
    createTypeScriptExpressionSource(
      document.getText(),
      expression,
      createTemplateForLocalDeclarations(
        context.virtualDocument.getText(),
        context.virtualDocument.offsetAt(context.virtualPosition),
        context,
        options.projectComponents
      )
    )
  );

  if (completionEntries.length === 0) {
    completionEntries = readVForMappedTypeScriptCompletions(
      document,
      context.virtualDocument.getText(),
      context.virtualDocument.offsetAt(context.virtualPosition),
      expression
    );
  }

  return completionEntries.slice(0, 80).map((entry) =>
    createTemplateCompletionItem(document, context, completionContext, {
      detail: `TypeScript ${entry.kind}`,
      kind: mapTypeScriptCompletionKind(entry.kind),
      label: entry.name,
      newText: entry.insertText ?? entry.name
    })
  );
};

const isMemberExpressionCompletion = (
  context: EmbeddedDocumentContext,
  completionContext: TemplateCompletionContext
): boolean => {
  const expression = readExpressionPrefixAtOffset(
    context.virtualDocument.getText(),
    context.virtualDocument.offsetAt(context.virtualPosition)
  );

  return completionContext.kind === "expression" && !!expression?.includes(".");
};

const readTypeScriptCompletionsAtExpression = (
  document: TextDocument,
  virtual: { fileName: string; offset: number; source: string }
): ts.CompletionEntry[] =>
  withTypeScriptLanguageService(
    document,
    virtual,
    (service) =>
      service.getCompletionsAtPosition(virtual.fileName, virtual.offset, {
        includeCompletionsForModuleExports: false,
        includeCompletionsWithInsertText: true
      })?.entries ?? []
  );

const withTypeScriptLanguageService = <T>(
  document: TextDocument,
  virtual: { fileName: string; source: string },
  read: (service: ts.LanguageService) => T
): T => {
  const elfuiTypesFileName = "elfui-template-types.d.ts";
  const files = new Map<string, { version: string; source: string }>([
    [virtual.fileName, { source: virtual.source, version: String(document.version) }],
    [elfuiTypesFileName, { source: elfuiTemplateTypes, version: "1" }]
  ]);
  const host: ts.LanguageServiceHost = {
    fileExists: (fileName) =>
      files.has(fileName) ||
      ts.sys.fileExists(fileName) ||
      readTypeScriptLibFile(fileName) !== undefined,
    getCompilationSettings: () => ({
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.Latest
    }),
    getCurrentDirectory: () => "",
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    getScriptFileNames: () => [...files.keys()],
    getScriptSnapshot: (fileName) => {
      const file = files.get(fileName);

      if (file) {
        return ts.ScriptSnapshot.fromString(file.source);
      }

      const libSource = readTypeScriptLibFile(fileName);

      if (libSource !== undefined) {
        return ts.ScriptSnapshot.fromString(libSource);
      }

      if (!ts.sys.fileExists(fileName)) {
        return undefined;
      }

      return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName) ?? "");
    },
    getScriptVersion: (fileName) => files.get(fileName)?.version ?? "0",
    readFile: (fileName) =>
      files.get(fileName)?.source ?? ts.sys.readFile(fileName) ?? readTypeScriptLibFile(fileName)
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  try {
    return read(service);
  } finally {
    service.dispose();
  }
};

const readVForMappedTypeScriptCompletions = (
  document: TextDocument,
  template: string,
  offset: number,
  expression: string
): ts.CompletionEntry[] => {
  const mappedExpression = mapVForLocalMemberExpression(template, offset, expression);

  if (!mappedExpression) {
    return [];
  }

  const completions = readTypeScriptCompletionsAtExpression(
    document,
    createTypeScriptExpressionSource(document.getText(), mappedExpression)
  );

  return completions.length > 0
    ? completions
    : readTypeScriptMembersAtExpression(document, mappedExpression);
};

const mapVForLocalMemberExpression = (
  template: string,
  offset: number,
  expression: string
): string | null => {
  const baseName = readMemberExpressionBaseName(expression);

  if (!baseName) {
    return null;
  }

  const mappings = createVForLocalExpressionMappings(template, offset);
  const mappedBase = mappings.get(baseName);

  return mappedBase ? `${mappedBase}${expression.slice(baseName.length)}` : null;
};

const isResolvedVForLocalUnknownDiagnostic = (
  document: TextDocument,
  components: ComponentMeta[],
  diagnostic: Diagnostic
): boolean => {
  if (diagnostic.code !== "ELF_TEMPLATE_TYPE") {
    return false;
  }

  const parsed = readMacroUnknownLocalDiagnostic(readDiagnosticMessage(diagnostic));

  if (!parsed || readMemberExpressionBaseName(parsed.expression) !== parsed.localName) {
    return false;
  }

  const sourceOffset = document.offsetAt(diagnostic.range.start);
  const region = components
    .flatMap((component) => component.templates)
    .find((candidate) => isInsideEmbeddedRegion(candidate, sourceOffset));

  if (!region) {
    return false;
  }

  const mappedExpression = mapVForLocalMemberExpression(
    region.content,
    sourceOffset - region.contentStart,
    parsed.expression
  );

  if (!mappedExpression) {
    return false;
  }

  const virtual = createTypeScriptExpressionSource(document.getText(), mappedExpression);
  const expressionStart = virtual.offset - mappedExpression.length;
  const expressionEnd = virtual.offset;
  const diagnostics = withTypeScriptLanguageService(document, virtual, (service) =>
    service.getSemanticDiagnostics(virtual.fileName)
  );

  return !diagnostics.some((item) => {
    const start = item.start ?? -1;
    const end = start + (item.length ?? 0);

    return start < expressionEnd && end > expressionStart;
  });
};

const isResolvedInterpolationRefValueDiagnostic = (
  document: TextDocument,
  components: ComponentMeta[],
  diagnostic: Diagnostic
): boolean => {
  if (diagnostic.code !== "ELF_TEMPLATE_TYPE") {
    return false;
  }

  const expression = readMacroInterpolationRefValueDiagnostic(readDiagnosticMessage(diagnostic));

  if (!expression) {
    return false;
  }

  return components
    .flatMap((component) => component.templates)
    .some((region) => {
      const interpolation = findTemplateInterpolationByValue(region.content, expression);

      return (
        interpolation !== null && !hasTypeScriptDiagnosticInExpression(document, interpolation)
      );
  });
};

/** 宏编译器映射偏移时，以原始脚本作用域复核，保留真实缺失名称给快速修复。 */
const isResolvedKnownMacroTemplateDiagnostic = (
  document: TextDocument,
  components: ComponentMeta[],
  diagnostic: Diagnostic
): boolean => {
  if (diagnostic.code !== "ELF_TEMPLATE_TYPE") {
    return false;
  }

  const parsed = readMacroUnknownLocalDiagnostic(readDiagnosticMessage(diagnostic));

  if (!parsed) {
    return false;
  }

  const sourceOffset = document.offsetAt(diagnostic.range.start);
  const component = components.find((candidate) =>
    candidate.templates.some((region) => isInsideEmbeddedRegion(region, sourceOffset))
  );

  if (component?.props.includes(parsed.localName)) {
    return true;
  }

  return !hasTypeScriptDiagnosticInExpression(document, parsed.expression);
};

const readMacroInterpolationRefValueDiagnostic = (message: string): string | null => {
  const match =
    /^Template .+? expression "([\s\S]*?)" at line \d+, column \d+: Property 'value' does not exist\b/.exec(
      message
    );

  return match?.[1] ?? null;
};

const hasTypeScriptDiagnosticInExpression = (
  document: TextDocument,
  expression: string
): boolean => {
  const virtual = createTypeScriptExpressionSource(document.getText(), expression);
  const expressionStart = virtual.offset - expression.length;
  const expressionEnd = virtual.offset;
  const diagnostics = withTypeScriptLanguageService(document, virtual, (service) =>
    service.getSemanticDiagnostics(virtual.fileName)
  );

  return diagnostics.some((item) => {
    const start = item.start ?? -1;
    const end = start + (item.length ?? 0);

    return start < expressionEnd && end > expressionStart;
  });
};

const findTemplateInterpolationByValue = (template: string, expected: string): string | null => {
  let start = template.indexOf("${");

  while (start >= 0) {
    const end = findBalancedTemplateExpressionEnd(template, start);

    if (end === null) {
      return null;
    }

    const expression = template.slice(start + 2, end);

    if (expression.trim() === expected.trim()) {
      return expression;
    }

    start = template.indexOf("${", end + 1);
  }

  return null;
};

const readMacroUnknownLocalDiagnostic = (
  message: string
): { expression: string; localName: string } | null => {
  const unknownMatch =
    /^Template .+? expression "([\s\S]*?)" at line \d+, column \d+: '([^']+)' is of type 'unknown'\.?$/.exec(
      message
    );

  if (unknownMatch?.[1] && unknownMatch[2]) {
    return {
      expression: unknownMatch[1],
      localName: unknownMatch[2]
    };
  }

  const missingNameMatch =
    /^Template .+? expression "([\s\S]*?)" at line \d+, column \d+: ([\s\S]*)$/.exec(message);
  const missingName = missingNameMatch?.[2] ? readCannotFindName(missingNameMatch[2]) : null;

  return missingNameMatch?.[1] && missingName
    ? {
        expression: missingNameMatch[1],
        localName: missingName
      }
    : null;
};

const createUnknownVForListStateEdit = (
  document: TextDocument,
  component: ComponentMeta,
  diagnostic: Diagnostic
): { edit: TextEdit; name: string } | null => {
  const parsed = readMacroUnknownLocalDiagnostic(readDiagnosticMessage(diagnostic));

  if (!parsed) {
    return null;
  }

  const sourceOffset = document.offsetAt(diagnostic.range.start);
  const region = component.templates.find((candidate) =>
    isInsideEmbeddedRegion(candidate, sourceOffset)
  );

  if (!region) {
    return null;
  }

  const sourceExpression = findVForSourceForLocal(
    region.content,
    sourceOffset - region.contentStart,
    parsed.localName
  );

  if (!sourceExpression || !isValidIdentifier(sourceExpression)) {
    return null;
  }

  const source = document.getText();
  const sourceFile = createTsSourceFile(source);
  let call: ts.CallExpression | null = null;
  const visit = (node: ts.Node) => {
    if (call) {
      return;
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === sourceExpression &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      readCallExpressionName(node.initializer) === "useRef" &&
      node.initializer.arguments.length === 0 &&
      !node.initializer.typeArguments?.length
    ) {
      call = node.initializer;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (!call) {
    return null;
  }

  const target = call as ts.CallExpression;
  const callee = target.expression.getText(sourceFile);

  return {
    edit: {
      newText: `${callee}<Record<string, unknown>[]>([])`,
      range: {
        end: document.positionAt(target.getEnd()),
        start: document.positionAt(target.getStart(sourceFile))
      }
    },
    name: sourceExpression
  };
};

const findVForSourceForLocal = (
  template: string,
  offset: number,
  localName: string
): string | null => {
  const vForPattern = /\sv-for\s*=\s*(["'])([\s\S]*?)\1/g;
  let result: string | null = null;

  for (const match of template.matchAll(vForPattern)) {
    if (match.index === undefined || match.index > offset || !match[2]) {
      continue;
    }

    const source = readForSourceExpression(match[2]);

    if (!source) {
      continue;
    }

    const localPart = match[2].slice(0, source.inIndex).trim();

    if (readTemplateLocalDeclarations(localPart).includes(localName)) {
      result = source.expression.trim();
    }
  }

  return result;
};

const readMemberExpressionBaseName = (expression: string): string | null => {
  const match = /^([A-Za-z_$][\w$]*)\./.exec(expression);

  return match?.[1] ?? null;
};

const readTypeScriptMembersAtExpression = (
  document: TextDocument,
  expression: string
): ts.CompletionEntry[] => {
  const targetExpression = expression.replace(/\.$/, "");

  if (!targetExpression) {
    return [];
  }

  const fileName = "elf-template-member.ts";
  const elfuiTypesFileName = "elfui-template-types.d.ts";
  const prefix = `${document.getText()}\n\n${elfTemplateValueHelper}\nconst __elfMemberTarget = (`;
  const source = `${prefix}${targetExpression});\n`;
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    target: ts.ScriptTarget.Latest
  };
  const files = new Map<string, string>([
    [fileName, source],
    [elfuiTypesFileName, elfuiTemplateTypes]
  ]);
  const host = ts.createCompilerHost(compilerOptions);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);

  host.fileExists = (candidate) =>
    files.has(candidate) || fileExists(candidate) || readTypeScriptLibFile(candidate) !== undefined;
  host.readFile = (candidate) =>
    files.get(candidate) ?? readFile(candidate) ?? readTypeScriptLibFile(candidate);
  host.getSourceFile = (candidate, languageVersion) => {
    const content = files.get(candidate) ?? readFile(candidate) ?? readTypeScriptLibFile(candidate);

    return content === undefined
      ? undefined
      : ts.createSourceFile(candidate, content, languageVersion, true);
  };

  const program = ts.createProgram([fileName, elfuiTypesFileName], compilerOptions, host);
  const sourceFile = program.getSourceFile(fileName);

  if (!sourceFile) {
    return [];
  }

  const target = findExpressionNodeContainingRange(
    sourceFile,
    prefix.length,
    prefix.length + targetExpression.length
  );

  if (!target) {
    return [];
  }

  const checker = program.getTypeChecker();
  const type = checker.getTypeAtLocation(target);

  return checker
    .getPropertiesOfType(type)
    .map((symbol) => ({
      kind: isCallableTypeSymbol(symbol)
        ? ts.ScriptElementKind.memberFunctionElement
        : ts.ScriptElementKind.memberVariableElement,
      name: symbol.getName(),
      sortText: symbol.getName()
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
};

const findExpressionNodeContainingRange = (
  sourceFile: ts.SourceFile,
  start: number,
  end: number
): ts.Expression | null => {
  let result: ts.Expression | null = null;
  const visit = (node: ts.Node) => {
    if (result || node.getStart(sourceFile) > start || node.getEnd() < end) {
      return;
    }

    ts.forEachChild(node, visit);

    if (!result && ts.isExpression(node)) {
      result = node;
    }
  };

  visit(sourceFile);

  return result;
};

const isCallableTypeSymbol = (symbol: ts.Symbol): boolean =>
  symbol
    .getDeclarations()
    ?.some(
      (declaration) =>
        ts.isMethodDeclaration(declaration) ||
        ts.isMethodSignature(declaration) ||
        ts.isFunctionDeclaration(declaration)
    ) ?? false;

const readTypeScriptLibFile = (fileName: string): string | undefined => {
  const baseName = path.basename(fileName.replace(/\\/g, "/"));

  if (!/^lib\..+\.d\.ts$/.test(baseName)) {
    return undefined;
  }

  for (const directory of getTypeScriptLibFallbackDirectories()) {
    const candidate = path.join(directory, baseName);

    if (ts.sys.fileExists(candidate)) {
      return ts.sys.readFile(candidate);
    }
  }

  return undefined;
};

const getTypeScriptLibFallbackDirectories = (): string[] => {
  const executingPath = ts.sys.getExecutingFilePath?.();
  const executingDirectory = executingPath ? path.dirname(executingPath) : "";

  return [
    executingDirectory,
    path.join(executingDirectory, "typescript-lib"),
    path.join(ts.sys.getCurrentDirectory(), "tools", "vscode-extension", "dist", "typescript-lib")
  ].filter(Boolean);
};

const createTypeScriptExpressionSource = (
  source: string,
  expression: string,
  templateLocals: string[] = []
): { fileName: string; offset: number; source: string } => {
  const fileName = "elf-template-completion.ts";
  const localSource = templateLocals.map((local) => `  ${local}`).join("\n");
  const prefix = `${source}\n\n${elfTemplateValueHelper}\nfunction __elfTemplateCompletion() {\n${localSource}${localSource ? "\n" : ""}  return (`;
  const suffix = `);\n}\n`;
  const virtualSource = `${prefix}${expression}${suffix}`;

  return {
    fileName,
    offset: prefix.length + expression.length,
    source: virtualSource
  };
};

const elfTemplateValueHelper = `const __elfLanguageServiceValue = <T>(value: T): T extends { readonly value: infer V; peek(): unknown } ? V : T =>
  value as unknown as T extends { readonly value: infer V; peek(): unknown } ? V : T;`;

const mapTypeScriptCompletionKind = (kind: string): CompletionItemKind => {
  switch (kind) {
    case ts.ScriptElementKind.memberFunctionElement:
    case ts.ScriptElementKind.functionElement:
    case ts.ScriptElementKind.localFunctionElement:
      return CompletionItemKind.Function;
    case ts.ScriptElementKind.memberVariableElement:
    case ts.ScriptElementKind.variableElement:
    case ts.ScriptElementKind.letElement:
    case ts.ScriptElementKind.constElement:
      return CompletionItemKind.Variable;
    case ts.ScriptElementKind.interfaceElement:
      return CompletionItemKind.Interface;
    case ts.ScriptElementKind.classElement:
      return CompletionItemKind.Class;
    case ts.ScriptElementKind.enumElement:
      return CompletionItemKind.Enum;
    case ts.ScriptElementKind.keyword:
      return CompletionItemKind.Keyword;
    default:
      return CompletionItemKind.Property;
  }
};

const elfuiTemplateTypes = `
declare module "elfui" {
  export interface ElfTemplateRef<T> {
    value: T;
    peek(): T;
    set(value: T): void;
  }
  export function defineProps<T extends object = { [key: string]: unknown }>(options?: unknown): T;
  export function defineEmits<T = { [key: string]: unknown }>(options?: unknown): T;
  export function defineSlots<T = { [key: string]: unknown }>(): T;
  export function defineHtml<T = unknown>(template: T): unknown;
  export function html(strings: TemplateStringsArray, ...values: unknown[]): string;
  export function css(strings: TemplateStringsArray, ...values: unknown[]): string;
  export function useComponents(components: unknown): void;
  export function useRef<T>(value: T): ElfTemplateRef<T>;
  export function useRef<T = unknown>(): ElfTemplateRef<T>;
  export function useComputed<T>(getter: () => T): Readonly<ElfTemplateRef<T>>;
}
`;

const createTemplateForLocalDeclarations = (
  template: string,
  offset: number,
  context: EmbeddedDocumentContext,
  projectComponents: ElfProjectComponent[]
): string[] => {
  const declarations: string[] = [];
  const vForPattern = /\sv-for\s*=\s*(["'])([\s\S]*?)\1/g;

  for (const match of template.matchAll(vForPattern)) {
    if (match.index === undefined || match.index > offset || !match[2]) {
      continue;
    }

    const source = readForSourceExpression(match[2]);

    if (!source) {
      continue;
    }

    const localPart = match[2].slice(0, source.inIndex).trim();
    const sourceName = `__elfForSource${declarations.length}`;

    declarations.push(`const ${sourceName} = __elfLanguageServiceValue(${source.expression});`);
    declarations.push(...createForLocalDeclarations(localPart, sourceName));
  }

  declarations.push(
    ...createSlotScopeLocalDeclarations(template, offset, context, projectComponents)
  );

  return declarations;
};

const createVForLocalExpressionMappings = (
  template: string,
  offset: number
): Map<string, string> => {
  const mappings = new Map<string, string>();
  const vForPattern = /\sv-for\s*=\s*(["'])([\s\S]*?)\1/g;

  for (const match of template.matchAll(vForPattern)) {
    if (match.index === undefined || match.index > offset || !match[2]) {
      continue;
    }

    const source = readForSourceExpression(match[2]);

    if (!source) {
      continue;
    }

    const localPart = match[2].slice(0, source.inIndex).trim();
    const [value] = parseTemplateBindingParameters(localPart);

    if (!value) {
      continue;
    }

    addVForValueExpressionMappings(
      mappings,
      value.name,
      `__elfLanguageServiceValue(${source.expression.trim()})[0]`
    );
  }

  return mappings;
};

const addVForValueExpressionMappings = (
  mappings: Map<string, string>,
  name: ts.BindingName,
  valueExpression: string
) => {
  if (ts.isIdentifier(name)) {
    mappings.set(name.text, valueExpression);
    return;
  }

  if (ts.isObjectBindingPattern(name)) {
    name.elements.forEach((element) => {
      const access = createObjectBindingElementAccess(element, valueExpression);

      addVForValueExpressionMappings(mappings, element.name, access);
    });
    return;
  }

  name.elements.forEach((element, index) => {
    if (!ts.isOmittedExpression(element)) {
      addVForValueExpressionMappings(mappings, element.name, `${valueExpression}[${index}]`);
    }
  });
};

const createForLocalDeclarations = (localPart: string, sourceName: string): string[] => {
  const parameters = parseTemplateBindingParameters(localPart);
  const [value, key, index] = parameters;

  if (!value) {
    return [];
  }

  const itemTypeName = `${sourceName}Item`;
  const itemValueName = `${sourceName}Value`;

  return [
    `type ${itemTypeName}<T> = T extends readonly (infer Item)[] ? Item : T extends Iterable<infer Item> ? Item : T extends Record<PropertyKey, infer Item> ? Item : unknown;`,
    `const ${itemValueName} = null as unknown as ${itemTypeName}<typeof ${sourceName}>;`,
    ...createForValueLocalDeclarations(value.name, itemValueName),
    ...createForSecondaryLocalDeclarations(key, index)
  ];
};

const createForValueLocalDeclarations = (
  name: ts.BindingName,
  valueExpression: string
): string[] => {
  if (ts.isIdentifier(name)) {
    return [`const ${name.text} = ${valueExpression};`];
  }

  if (ts.isObjectBindingPattern(name)) {
    return name.elements.flatMap((element) => {
      const access = createObjectBindingElementAccess(element, valueExpression);

      return createForValueLocalDeclarations(element.name, access);
    });
  }

  return name.elements.flatMap((element, index) =>
    ts.isOmittedExpression(element)
      ? []
      : createForValueLocalDeclarations(element.name, `${valueExpression}[${index}]`)
  );
};

const createObjectBindingElementAccess = (
  element: ts.BindingElement,
  valueExpression: string
): string => {
  if (element.dotDotDotToken) {
    return valueExpression;
  }

  if (!element.propertyName) {
    return ts.isIdentifier(element.name)
      ? `${valueExpression}.${element.name.text}`
      : valueExpression;
  }

  if (ts.isIdentifier(element.propertyName)) {
    return `${valueExpression}.${element.propertyName.text}`;
  }

  if (ts.isStringLiteralLike(element.propertyName) || ts.isNumericLiteral(element.propertyName)) {
    return `${valueExpression}[${JSON.stringify(element.propertyName.text)}]`;
  }

  return valueExpression;
};

const createForSecondaryLocalDeclarations = (
  key: ts.ParameterDeclaration | undefined,
  index: ts.ParameterDeclaration | undefined
): string[] => [
  ...(key && ts.isIdentifier(key.name) ? [`const ${key.name.text} = "" as string | number;`] : []),
  ...(index && ts.isIdentifier(index.name) ? [`const ${index.name.text} = 0;`] : [])
];

const createSlotScopeLocalDeclarations = (
  template: string,
  offset: number,
  context: EmbeddedDocumentContext,
  projectComponents: ElfProjectComponent[]
): string[] => {
  const htmlDocument = parseHTML(context);
  const scopes = collectActiveSlotScopes(htmlDocument.roots, offset);

  return scopes.flatMap((scope, index) => {
    const parentTag = scope.parent?.tag;
    const binding = readSlotScopeBinding(scope.node);

    if (!parentTag || !binding || !isSafeTemplateBindingPattern(binding.expression)) {
      return [];
    }

    const definition = findTemplateComponentDefinitionForTag(
      context.components,
      context.component,
      parentTag,
      projectComponents
    );

    if (!definition?.slotsType && !definition?.slotScopes?.length) {
      return [];
    }

    const slotMapName = `__ElfSlotMap${index}`;
    const slotScopeName = `__ElfSlotScope${index}`;
    const scopeValueName = `__elfSlotScope${index}`;
    const slotName = JSON.stringify(binding.name);
    const directScope = definition.slotScopes?.find((item) => item.name === binding.name);

    return directScope
      ? [
          `type ${slotScopeName} = ${directScope.scopeType};`,
          `const ${scopeValueName} = null as unknown as ${slotScopeName};`,
          `const ${binding.expression} = ${scopeValueName};`
        ]
      : [
          `type ${slotMapName} = ${definition.slotsType};`,
          `type ${slotScopeName} = ${slotName} extends keyof ${slotMapName} ? NonNullable<${slotMapName}[${slotName}]> extends (scope: infer S, ...args: any[]) => any ? S : unknown : unknown;`,
          `const ${scopeValueName} = null as unknown as ${slotScopeName};`,
          `const ${binding.expression} = ${scopeValueName};`
        ];
  });
};

const collectActiveSlotScopes = (
  nodes: HTMLNode[],
  offset: number,
  parent: HTMLNode | null = null
): Array<{ node: HTMLNode; parent: HTMLNode | null }> => {
  const scopes: Array<{ node: HTMLNode; parent: HTMLNode | null }> = [];

  for (const node of nodes) {
    const nodeEnd = node.end ?? node.startTagEnd ?? node.start;

    if (offset < node.start || offset > nodeEnd) {
      continue;
    }

    if (node.tag === "template" && readSlotScopeBinding(node)) {
      scopes.push({ node, parent });
    }

    scopes.push(...collectActiveSlotScopes(node.children, offset, node));
  }

  return scopes;
};

const readSlotScopeBinding = (node: HTMLNode): { expression: string; name: string } | null => {
  for (const [attribute, value] of Object.entries(node.attributes ?? {})) {
    const name = normalizeSlotAttributeName(attribute);

    const expression = typeof value === "string" ? unwrapHtmlAttributeValue(value).trim() : "";

    if (!name || !expression) {
      continue;
    }

    return {
      expression,
      name
    };
  }

  return null;
};

const unwrapHtmlAttributeValue = (value: string): string =>
  value.length >= 2 &&
  ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ? value.slice(1, -1)
    : value;

const isSafeTemplateBindingPattern = (expression: string): boolean =>
  /^[A-Za-z_$][\w$]*$/.test(expression) ||
  (/^[{[][\s\S]*[}\]]$/.test(expression) && !/[;=]/.test(expression) && !/=>/.test(expression));

const readCompletionTarget = (
  context: EmbeddedDocumentContext,
  options: ResolvedElfLanguageServiceOptions
): Pick<TemplateComponentDefinition, "emits" | "props" | "slots"> => {
  const tag = readCompletionOpenTagName(context);
  const definition = tag
    ? findTemplateComponentDefinitionForTag(
        context.components,
        context.component,
        tag,
        options.projectComponents
      )
    : null;

  return definition ?? context.component;
};

const readCompletionOpenTagName = (context: EmbeddedDocumentContext): string | null => {
  const openTag = readOpenTagFragment(
    context.virtualDocument
      .getText()
      .slice(0, context.virtualDocument.offsetAt(context.virtualPosition))
  );
  const match = /^\/?\s*([A-Za-z][\w-]*)/.exec(openTag?.fragment ?? "");

  return match?.[1] ?? null;
};

const createPropBindingCompletions = (
  document: TextDocument,
  context: EmbeddedDocumentContext,
  completionContext: TemplateCompletionContext,
  options: ResolvedElfLanguageServiceOptions,
  completionOptions: ResolvedElfCompletionOptions
): CompletionItem[] =>
  readCompletionTarget(context, options).props.map((label) =>
    createTemplateCompletionItem(document, context, completionContext, {
      detail: "ElfUI prop binding",
      insertTextFormat: InsertTextFormat.Snippet,
      kind: CompletionItemKind.Variable,
      label: `:${label}`,
      newText: createValueBindingSnippet(`:${label}`, completionOptions.templateBindingStyle, label)
    })
  );

const resolveLanguageServiceOptions = (
  options: ElfLanguageServiceOptions = {}
): ResolvedElfLanguageServiceOptions => ({
  completion: {
    eventBindingStyle: isTemplateBindingStyle(options.completion?.eventBindingStyle)
      ? options.completion.eventBindingStyle
      : defaultCompletionOptions.eventBindingStyle,
    templateBindingStyle: isTemplateBindingStyle(options.completion?.templateBindingStyle)
      ? options.completion.templateBindingStyle
      : defaultCompletionOptions.templateBindingStyle
  },
  projectComponents: options.project?.components?.filter(isUsableProjectComponent) ?? []
});

const isTemplateBindingStyle = (value: unknown): value is ElfTemplateBindingStyle =>
  value === "expression" || value === "quoted";

const isUsableProjectComponent = (component: ElfProjectComponent): boolean =>
  isValidIdentifier(component.localName) &&
  !!component.importPath &&
  (component.exportName === "default" || isValidIdentifier(component.exportName));

const createDirectiveCompletionText = (
  directive: (typeof templateDirectives)[number],
  completionOptions: ResolvedElfCompletionOptions
): string => {
  if (directive.value === "none") {
    return directive.label;
  }

  if (directive.value === "for") {
    return `${directive.label}="\${1:item} in \${2:items}"`;
  }

  return createValueBindingSnippet(
    directive.label,
    completionOptions.templateBindingStyle,
    directive.placeholder
  );
};

const createValueBindingSnippet = (
  attribute: string,
  style: ElfTemplateBindingStyle,
  placeholder: string
): string =>
  style === "quoted" ? `${attribute}="$1"` : createExpressionBindingSnippet(attribute, placeholder);

const createExpressionBindingSnippet = (attribute: string, placeholder: string): string =>
  `${attribute}=\\\${\${1:${placeholder}}}`;

const createSlotCompletions = (
  document: TextDocument,
  context: EmbeddedDocumentContext,
  completionContext: TemplateCompletionContext,
  options: ResolvedElfLanguageServiceOptions
): CompletionItem[] =>
  readCompletionTarget(context, options).slots.map((label) =>
    createTemplateCompletionItem(document, context, completionContext, {
      detail: "ElfUI slot outlet",
      insertTextFormat: InsertTextFormat.Snippet,
      kind: CompletionItemKind.Property,
      label: `#${label}`,
      newText: `#${label}="$1"`
    })
  );

const createTagCompletions = (
  document: TextDocument,
  context: EmbeddedDocumentContext,
  completionContext: TemplateCompletionContext,
  options: ResolvedElfLanguageServiceOptions
): CompletionItem[] => [
  ...commonHtmlTags.map((label) =>
    createTemplateCompletionItem(document, context, completionContext, {
      detail: "HTML element",
      insertTextFormat: InsertTextFormat.Snippet,
      kind: CompletionItemKind.Property,
      label,
      newText: createTagCompletionText(label, completionContext)
    })
  ),
  ...elfBuiltInComponentCompletions.map((item) =>
    createTemplateCompletionItem(document, context, completionContext, {
      detail: item.detail,
      insertTextFormat: InsertTextFormat.Snippet,
      kind: CompletionItemKind.Class,
      label: item.label,
      newText: createBuiltInComponentCompletionText(item.newText, completionContext)
    })
  ),
  ...context.component.uses.map((item) =>
    createTemplateCompletionItem(document, context, completionContext, {
      detail: "ElfUI local component",
      insertTextFormat: InsertTextFormat.Snippet,
      kind: CompletionItemKind.Class,
      label: item.localName,
      newText: createTagCompletionText(item.localName, completionContext)
    })
  ),
  ...createAutoImportComponentCompletions(document, context, completionContext, options)
];

const createTagCompletionText = (tag: string, completionContext: TemplateCompletionContext) => {
  const body = voidHtmlTags.has(tag.toLowerCase()) ? `${tag}>` : `${tag}>$0</${tag}>`;

  return completionContext.kind === "tag" && completionContext.mode === "bare" ? `<${body}` : body;
};

const createBuiltInComponentCompletionText = (
  text: string,
  completionContext: TemplateCompletionContext
) => (completionContext.kind === "tag" && completionContext.mode === "bare" ? `<${text}` : text);

const createAutoImportComponentCompletions = (
  document: TextDocument,
  context: EmbeddedDocumentContext,
  completionContext: TemplateCompletionContext,
  options: ResolvedElfLanguageServiceOptions
): CompletionItem[] => {
  const localComponents = createRegisteredComponentTagNames(context.component);
  const seen = new Set<string>();

  return options.projectComponents.flatMap((component) => {
    const key = `${component.localName}:${component.importPath}`;

    if (seen.has(key) || localComponents.has(component.localName)) {
      return [];
    }

    seen.add(key);

    const additionalTextEdits = createComponentAutoImportEdits(
      document,
      context.component,
      component
    );

    if (additionalTextEdits.length === 0) {
      return [];
    }

    return [
      createTemplateCompletionItem(document, context, completionContext, {
        additionalTextEdits,
        detail: createProjectComponentDetail(component),
        insertTextFormat: InsertTextFormat.Snippet,
        kind: CompletionItemKind.Class,
        label: component.localName,
        newText: createTagCompletionText(component.localName, completionContext)
      })
    ];
  });
};

const createTemplateCompletionItem = (
  document: TextDocument,
  context: EmbeddedDocumentContext,
  completionContext: TemplateCompletionContext,
  item: CompletionItem & { newText: string }
): CompletionItem => {
  const currentOffset = context.virtualDocument.offsetAt(context.virtualPosition);
  const range = {
    end: document.positionAt(context.region.contentStart + currentOffset),
    start: document.positionAt(context.region.contentStart + completionContext.replaceStart)
  };
  const { newText, ...completionItem } = item;

  return {
    ...completionItem,
    textEdit: {
      newText,
      range
    }
  };
};

const createTemplateComponentAutoImportActions = (
  document: TextDocument,
  range: Range,
  diagnostics: Diagnostic[],
  projectComponents: ElfProjectComponent[]
): CodeAction[] => {
  if (projectComponents.length === 0) {
    return [];
  }

  const sourceStart = document.offsetAt(range.start);
  const sourceEnd = document.offsetAt(range.end);
  const analysis = analyzeElfSource(document.getText(), {
    fileName: document.uri
  });
  const actions: CodeAction[] = [];

  diagnostics.forEach((diagnostic) => {
    const tagName = readUnregisteredComponentName(diagnostic);

    if (
      !tagName ||
      !isOffsetRangeOverlapping(
        document.offsetAt(diagnostic.range.start),
        document.offsetAt(diagnostic.range.end),
        sourceStart,
        sourceEnd
      )
    ) {
      return;
    }

    const owner = findComponentByTemplateRange(
      analysis.components,
      document.offsetAt(diagnostic.range.start)
    );
    const component = findProjectComponentForTag(projectComponents, tagName);

    if (!owner || !component) {
      return;
    }

    const edits = createComponentAutoImportEdits(document, owner, component);

    if (edits.length === 0) {
      return;
    }

    actions.push({
      diagnostics: [diagnostic],
      edit: {
        changes: {
          [document.uri]: edits
        }
      },
      kind: CodeActionKind.QuickFix,
      title: `Import and register <${component.localName}>`
    });
  });

  return actions;
};

const readUnregisteredComponentName = (diagnostic: Diagnostic): string | null => {
  const message =
    typeof diagnostic.message === "string" ? diagnostic.message : diagnostic.message.value;
  const match = /^Component <([^>]+)> is not registered with use\(\)\./.exec(message);

  return match?.[1] ?? null;
};

const createTemplateDeclarationCodeActions = (
  document: TextDocument,
  range: Range,
  diagnostics: Diagnostic[]
): CodeAction[] => {
  if (diagnostics.length === 0) {
    return [];
  }

  const sourceStart = document.offsetAt(range.start);
  const sourceEnd = document.offsetAt(range.end);
  const analysis = analyzeElfSource(document.getText(), {
    fileName: document.uri
  });
  const actions: CodeAction[] = [];
  const batchAction = createAllMissingTemplateDeclarationAction(
    document,
    range,
    diagnostics,
    analysis.components
  );

  if (batchAction) {
    actions.push(batchAction);
  }

  diagnostics.forEach((diagnostic) => {
    if (
      !isOffsetRangeOverlapping(
        document.offsetAt(diagnostic.range.start),
        document.offsetAt(diagnostic.range.end),
        sourceStart,
        sourceEnd
      )
    ) {
      return;
    }

    const owner = findComponentByTemplateRange(
      analysis.components,
      document.offsetAt(diagnostic.range.start)
    );
    const parsed = readTemplateDeclarationDiagnostic(diagnostic);

    if (owner) {
      const listStateEdit = createUnknownVForListStateEdit(document, owner, diagnostic);

      if (listStateEdit) {
        pushDeclarationAction(
          actions,
          document,
          diagnostic,
          `Initialize "${listStateEdit.name}" as a typed list state`,
          [listStateEdit.edit]
        );
      }
    }

    if (!owner || !parsed) {
      return;
    }

    if (parsed.kind === "unknown-variable") {
      if (isDirectTemplateEventHandlerDiagnostic(document, owner, diagnostic, parsed.name)) {
        pushDeclarationAction(
          actions,
          document,
          diagnostic,
          `Create handler "${parsed.name}"`,
          createTemplateHandlerDeclarationEdits(document, owner, parsed.name)
        );
        return;
      }

      pushDeclarationAction(
        actions,
        document,
        diagnostic,
        `Create state "${parsed.name}" with useRef()`,
        createTemplateStateDeclarationEdits(document, owner, parsed.name)
      );
      pushDeclarationAction(
        actions,
        document,
        diagnostic,
        `Expose "${parsed.name}" from setup()`,
        createTemplateVariableDeclarationEdits(document, owner, parsed.name)
      );
      pushDeclarationAction(
        actions,
        document,
        diagnostic,
        `Declare prop "${parsed.name}"`,
        createPropDeclarationEdits(document, owner, parsed.name)
      );
      return;
    }

    if (parsed.kind === "missing-handler") {
      pushDeclarationAction(
        actions,
        document,
        diagnostic,
        `Create handler "${parsed.name}"`,
        createTemplateHandlerDeclarationEdits(document, owner, parsed.name)
      );
      return;
    }

    if (parsed.kind === "template-emit") {
      pushDeclarationAction(
        actions,
        document,
        diagnostic,
        `Declare emit "${parsed.name}"`,
        createEmitDeclarationEdits(document, owner, parsed.name)
      );
      return;
    }

    const target = findDeclarationTargetComponent(analysis.components, owner, parsed.tagName);

    if (!target || (target !== owner && target.macro && !target.templates.length)) {
      return;
    }

    if (parsed.kind === "component-prop") {
      pushDeclarationAction(
        actions,
        document,
        diagnostic,
        `Declare prop "${parsed.name}" on <${parsed.tagName}>`,
        createPropDeclarationEdits(document, target, parsed.name)
      );
      return;
    }

    if (parsed.kind === "component-event") {
      pushDeclarationAction(
        actions,
        document,
        diagnostic,
        `Declare emit "${parsed.name}" on <${parsed.tagName}>`,
        createEmitDeclarationEdits(document, target, parsed.name)
      );
      return;
    }

    pushDeclarationAction(
      actions,
      document,
      diagnostic,
      `Declare slot "${parsed.name}" on <${parsed.tagName}>`,
      createSlotDeclarationEdits(document, target, parsed.name)
    );
  });

  return actions;
};

type MissingTemplateDeclaration = {
  kind: "handler" | "state";
  name: string;
  offset: number;
};

const createAllMissingTemplateDeclarationAction = (
  document: TextDocument,
  range: Range,
  diagnostics: Diagnostic[],
  components: ComponentMeta[]
): CodeAction | null => {
  const rangeStart = document.offsetAt(range.start);
  const rangeEnd = document.offsetAt(range.end);
  const owner = diagnostics
    .filter((diagnostic) =>
      isOffsetRangeOverlapping(
        document.offsetAt(diagnostic.range.start),
        document.offsetAt(diagnostic.range.end),
        rangeStart,
        rangeEnd
      )
    )
    .map((diagnostic) => ({
      component: findComponentByTemplateRange(components, document.offsetAt(diagnostic.range.start)),
      declaration: readTemplateDeclarationDiagnostic(diagnostic)
    }))
    .find(
      (candidate) =>
        candidate.component &&
        (candidate.declaration?.kind === "missing-handler" ||
          candidate.declaration?.kind === "unknown-variable")
    )?.component;

  if (!owner) {
    return null;
  }

  const missing = createElfDiagnostics(document)
    .filter(isElfCodeActionDiagnostic)
    .map((diagnostic) => ({
      declaration: readTemplateDeclarationDiagnostic(diagnostic),
      diagnostic,
      owner: findComponentByTemplateRange(components, document.offsetAt(diagnostic.range.start))
    }))
    .flatMap((candidate): MissingTemplateDeclaration[] => {
      if (
        candidate.owner?.id !== owner.id ||
        (candidate.declaration?.kind !== "missing-handler" &&
          candidate.declaration?.kind !== "unknown-variable")
      ) {
        return [];
      }

      return [
        {
          kind:
            candidate.declaration.kind === "missing-handler" ||
            isDirectTemplateEventHandlerDiagnostic(
              document,
              candidate.owner,
              candidate.diagnostic,
              candidate.declaration.name
            )
              ? "handler"
              : "state",
          name: candidate.declaration.name,
          offset: document.offsetAt(candidate.diagnostic.range.start)
        }
      ];
    })
    .sort((left, right) => left.offset - right.offset);
  const stateNames = uniqueMissingDeclarationNames(missing, "state");
  const handlerNames = uniqueMissingDeclarationNames(missing, "handler");

  if (stateNames.length + handlerNames.length < 2) {
    return null;
  }

  const edits = createAllMissingTemplateDeclarationEdits(
    document,
    owner,
    stateNames,
    handlerNames
  );

  if (edits.length === 0) {
    return null;
  }

  return {
    diagnostics,
    edit: {
      changes: {
        [document.uri]: edits
      }
    },
    kind: CodeActionKind.QuickFix,
    title: "Create all missing template state and handlers"
  };
};

const uniqueMissingDeclarationNames = (
  declarations: MissingTemplateDeclaration[],
  kind: MissingTemplateDeclaration["kind"]
): string[] => {
  const names = new Set<string>();

  declarations.forEach((declaration) => {
    if (declaration.kind === kind && isValidIdentifier(declaration.name)) {
      names.add(declaration.name);
    }
  });

  return [...names];
};

const isDirectTemplateEventHandlerDiagnostic = (
  document: TextDocument,
  component: ComponentMeta,
  diagnostic: Diagnostic,
  name: string
): boolean => {
  const source = document.getText();
  const diagnosticStart = document.offsetAt(diagnostic.range.start);
  const region = component.templates.find((candidate) =>
    isInsideEmbeddedRegion(candidate, diagnosticStart)
  );

  if (!region) {
    return false;
  }

  const expressionStart = source.lastIndexOf("${", diagnosticStart);

  if (expressionStart < region.contentStart) {
    return false;
  }

  const expressionEnd = findBalancedTemplateExpressionEnd(source, expressionStart);

  if (expressionEnd === null || diagnosticStart > expressionEnd) {
    return false;
  }

  const expression = source.slice(expressionStart + 2, expressionEnd).trim();

  if (expression !== name && !new RegExp(`^${name}\\s*\\(`).test(expression)) {
    return false;
  }

  let cursor = expressionStart - 1;

  while (cursor >= region.contentStart && /[ \t\r\n]/.test(source[cursor] ?? "")) {
    cursor -= 1;
  }

  if (source[cursor] !== "=") {
    return false;
  }

  cursor -= 1;

  while (cursor >= region.contentStart && /[ \t\r\n]/.test(source[cursor] ?? "")) {
    cursor -= 1;
  }

  const attributeEnd = cursor + 1;

  while (cursor >= region.contentStart && /[^\s<>=]/.test(source[cursor] ?? "")) {
    cursor -= 1;
  }

  const attribute = source.slice(cursor + 1, attributeEnd);

  return attribute.startsWith("@") || attribute.startsWith("v-on:");
};

type TemplateDeclarationDiagnostic =
  | { kind: "component-event"; name: string; tagName: string }
  | { kind: "component-prop"; name: string; tagName: string }
  | { kind: "component-slot"; name: string; tagName: string }
  | { kind: "missing-handler"; name: string }
  | { kind: "template-emit"; name: string }
  | { kind: "unknown-variable"; name: string };

const readTemplateDeclarationDiagnostic = (
  diagnostic: Diagnostic
): TemplateDeclarationDiagnostic | null => {
  const message = readDiagnosticMessage(diagnostic);
  const unknownVariable = /^Unknown template variable "([^"]+)"\.$/.exec(message);

  if (unknownVariable?.[1]) {
    return { kind: "unknown-variable", name: unknownVariable[1] };
  }

  const macroMissingName = readMacroMissingNameDiagnostic(message);

  if (macroMissingName) {
    return macroMissingName;
  }

  const templateEmit = /^Event "([^"]+)" is not declared in emits\(\)\.$/.exec(message);

  if (templateEmit?.[1]) {
    return { kind: "template-emit", name: templateEmit[1] };
  }

  const componentContract = /^(Prop|Event|Slot) "([^"]+)" is not declared on <([^>]+)>\.$/.exec(
    message
  );

  if (!componentContract?.[1] || !componentContract[2] || !componentContract[3]) {
    return null;
  }

  if (componentContract[1] === "Prop") {
    return {
      kind: "component-prop",
      name: componentContract[2],
      tagName: componentContract[3]
    };
  }

  if (componentContract[1] === "Event") {
    return {
      kind: "component-event",
      name: componentContract[2],
      tagName: componentContract[3]
    };
  }

  return {
    kind: "component-slot",
    name: componentContract[2],
    tagName: componentContract[3]
  };
};

const readMacroMissingNameDiagnostic = (message: string): TemplateDeclarationDiagnostic | null => {
  const macroExpression =
    /^Template (.+?) expression "([\s\S]*?)" at line \d+, column \d+: ([\s\S]*)/.exec(message);

  if (!macroExpression?.[1] || !macroExpression[3]) {
    return null;
  }

  const missingName = readCannotFindName(macroExpression[3]);

  if (!missingName || templateGlobals.has(missingName) || !isValidIdentifier(missingName)) {
    return null;
  }

  return macroExpression[1].includes("event")
    ? { kind: "missing-handler", name: missingName }
    : { kind: "unknown-variable", name: missingName };
};

const readCannotFindName = (message: string): string | null => {
  const english = /Cannot find name '([^']+)'/.exec(message);

  if (english?.[1]) {
    return english[1];
  }

  const chinese = /找不到名称[“"]([^”"]+)[”"]/.exec(message);

  return chinese?.[1] ?? null;
};

const readDiagnosticMessage = (diagnostic: Diagnostic): string =>
  typeof diagnostic.message === "string" ? diagnostic.message : diagnostic.message.value;

const pushDeclarationAction = (
  actions: CodeAction[],
  document: TextDocument,
  diagnostic: Diagnostic,
  title: string,
  edits: TextEdit[]
) => {
  if (edits.length === 0) {
    return;
  }

  actions.push({
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: edits
      }
    },
    kind: CodeActionKind.QuickFix,
    title
  });
};

const findDeclarationTargetComponent = (
  components: ComponentMeta[],
  owner: ComponentMeta,
  tagName: string
): ComponentMeta | null => {
  return findComponentDefinitionForTag(components, owner, tagName) ?? null;
};

const findComponentByTemplateRange = (
  components: ComponentMeta[],
  offset: number
): ComponentMeta | null => {
  for (const component of components) {
    if (component.templates.some((region) => isInsideEmbeddedRegion(region, offset))) {
      return component;
    }
  }

  return null;
};

const findProjectComponentForTag = (
  components: ElfProjectComponent[],
  tagName: string
): ElfProjectComponent | null => {
  const normalizedTag = toKebabCase(tagName);

  return (
    components.find(
      (component) =>
        component.localName === tagName ||
        component.tagName === tagName ||
        toKebabCase(component.localName) === normalizedTag ||
        (component.tagName ? toKebabCase(component.tagName) === normalizedTag : false)
    ) ?? null
  );
};

const createProjectComponentDetail = (component: ElfProjectComponent): string => {
  const tag = component.tagName ? ` (${component.tagName})` : "";

  return `ElfUI auto import component${tag}`;
};

const createComponentAutoImportEdits = (
  document: TextDocument,
  owner: ComponentMeta,
  component: ElfProjectComponent
): TextEdit[] => {
  const importEdits = createComponentImportEdits(document, component);
  const registrationEdits = owner.macro
    ? createMacroComponentRegistrationEdits(document, component.localName)
    : createChainComponentRegistrationEdits(document, owner, component.localName);

  return [...importEdits, ...registrationEdits];
};

const createTemplateVariableDeclarationEdits = (
  document: TextDocument,
  component: ComponentMeta,
  name: string
): TextEdit[] => {
  if (!isValidIdentifier(name) || component.setupReturns.includes(name)) {
    return [];
  }

  return component.macro
    ? createMacroVariableDeclarationEdits(document, name)
    : createChainSetupDeclarationEdits(document, component, name);
};

const createTemplateStateDeclarationEdits = (
  document: TextDocument,
  component: ComponentMeta,
  name: string
): TextEdit[] => {
  if (!isValidIdentifier(name) || component.setupReturns.includes(name)) {
    return [];
  }

  return component.macro
    ? createMacroStateDeclarationEdits(document, name)
    : createChainStateDeclarationEdits(document, component, name);
};

const createTemplateHandlerDeclarationEdits = (
  document: TextDocument,
  component: ComponentMeta,
  name: string
): TextEdit[] => {
  if (!isValidIdentifier(name) || component.setupReturns.includes(name)) {
    return [];
  }

  return component.macro
    ? createMacroHandlerDeclarationEdits(document, name)
    : createChainHandlerDeclarationEdits(document, component, name);
};

const createPropDeclarationEdits = (
  document: TextDocument,
  component: ComponentMeta,
  name: string
): TextEdit[] => {
  if (!name || component.props.includes(name)) {
    return [];
  }

  return component.macro
    ? createMacroDefinePropsEdits(document, name)
    : createChainPropDeclarationEdits(document, component, name);
};

const createEmitDeclarationEdits = (
  document: TextDocument,
  component: ComponentMeta,
  name: string
): TextEdit[] => {
  if (!name || component.emits.includes(name)) {
    return [];
  }

  return component.macro
    ? createMacroDefineEmitsEdits(document, name)
    : createChainEmitDeclarationEdits(document, component, name);
};

const createSlotDeclarationEdits = (
  document: TextDocument,
  component: ComponentMeta,
  name: string
): TextEdit[] => {
  if (!name || component.slots.includes(name)) {
    return [];
  }

  return component.macro
    ? createMacroDefineSlotsEdits(document, name)
    : createChainSlotDeclarationEdits(document, component, name);
};

const createMacroVariableDeclarationEdits = (document: TextDocument, name: string): TextEdit[] => {
  const insertOffset = findImportInsertionOffset(document.getText());

  return [
    {
      newText: `const ${name} = undefined;\n`,
      range: createRangeFromOffsets(document, insertOffset, insertOffset)
    }
  ];
};

const createMacroStateDeclarationEdits = (document: TextDocument, name: string): TextEdit[] => {
  const insertOffset = findImportInsertionOffset(document.getText());

  return [
    ...createElfuiNamedImportEdits(document, "useRef"),
    {
      newText: `const ${name} = useRef();\n`,
      range: createRangeFromOffsets(document, insertOffset, insertOffset)
    }
  ];
};

const createMacroHandlerDeclarationEdits = (document: TextDocument, name: string): TextEdit[] => {
  const insertOffset = findImportInsertionOffset(document.getText());

  return [
    {
      newText: `const ${name} = (e: Event) => {\n};\n`,
      range: createRangeFromOffsets(document, insertOffset, insertOffset)
    }
  ];
};

const createChainSetupDeclarationEdits = (
  document: TextDocument,
  component: ComponentMeta,
  name: string
): TextEdit[] => createChainSetupValueDeclarationEdits(document, component, name, "undefined");

const createChainStateDeclarationEdits = (
  document: TextDocument,
  component: ComponentMeta,
  name: string
): TextEdit[] => [
  ...createElfuiNamedImportEdits(document, "useRef"),
  ...createChainSetupValueDeclarationEdits(document, component, name, "useRef()")
];

const createChainHandlerDeclarationEdits = (
  document: TextDocument,
  component: ComponentMeta,
  name: string
): TextEdit[] => createChainSetupValueDeclarationEdits(document, component, name, "(e: Event) => {}");

const createAllMissingTemplateDeclarationEdits = (
  document: TextDocument,
  component: ComponentMeta,
  stateNames: string[],
  handlerNames: string[]
): TextEdit[] => {
  if (stateNames.length === 0 && handlerNames.length === 0) {
    return [];
  }

  return component.macro
    ? createMacroMissingTemplateDeclarationEdits(document, stateNames, handlerNames)
    : createChainMissingTemplateDeclarationEdits(document, component, stateNames, handlerNames);
};

const createMacroMissingTemplateDeclarationEdits = (
  document: TextDocument,
  stateNames: string[],
  handlerNames: string[]
): TextEdit[] => {
  const insertOffset = findImportInsertionOffset(document.getText());
  const declarationText = [
    ...stateNames.map((name) => `const ${name} = useRef();\n`),
    ...handlerNames.map((name) => `const ${name} = (e: Event) => {\n};\n`)
  ].join("");

  return mergeInsertionEdits(
    document,
    insertOffset,
    stateNames.length > 0 ? createElfuiNamedImportEdits(document, "useRef") : [],
    declarationText
  );
};

const createChainMissingTemplateDeclarationEdits = (
  document: TextDocument,
  component: ComponentMeta,
  stateNames: string[],
  handlerNames: string[]
): TextEdit[] => {
  const source = document.getText();
  const properties = [
    ...stateNames.map((name) => createObjectPropertyText(name, "useRef()")),
    ...handlerNames.map((name) => createObjectPropertyText(name, "(e: Event) => {}"))
  ].join(", ");
  const setupObject = findChainSetupReturnObjectRange(source, component.id);

  if (setupObject) {
    return [
      ...(stateNames.length > 0 ? createElfuiNamedImportEdits(document, "useRef") : []),
      createObjectPropertyAppendEdit(document, setupObject, properties)
    ];
  }

  const insertOffset =
    findChainComponentDeclarationEnd(source, component.id) ?? findImportInsertionOffset(source);

  return mergeInsertionEdits(
    document,
    insertOffset,
    stateNames.length > 0 ? createElfuiNamedImportEdits(document, "useRef") : [],
    `\n${component.id}.setup(() => ({ ${properties} }));`
  );
};

const mergeInsertionEdits = (
  document: TextDocument,
  insertOffset: number,
  edits: TextEdit[],
  declarationText: string
): TextEdit[] => {
  const sameOffset = edits.find(
    (edit) =>
      document.offsetAt(edit.range.start) === insertOffset &&
      document.offsetAt(edit.range.end) === insertOffset
  );
  const declarationEdit = {
    newText: declarationText,
    range: createRangeFromOffsets(document, insertOffset, insertOffset)
  };

  if (!sameOffset) {
    return [...edits, declarationEdit];
  }

  return [
    ...edits.filter((edit) => edit !== sameOffset),
    {
      ...sameOffset,
      newText: `${sameOffset.newText}${declarationText}`
    }
  ];
};

const createChainSetupValueDeclarationEdits = (
  document: TextDocument,
  component: ComponentMeta,
  name: string,
  valueText: string
): TextEdit[] => {
  const source = document.getText();
  const setupObject = findChainSetupReturnObjectRange(source, component.id);

  if (setupObject) {
    return [
      createObjectPropertyAppendEdit(
        document,
        setupObject,
        createObjectPropertyText(name, valueText)
      )
    ];
  }

  const insertOffset =
    findChainComponentDeclarationEnd(source, component.id) ?? findImportInsertionOffset(source);

  return [
    {
      newText: `\n${component.id}.setup(() => ({ ${createObjectPropertyText(name, valueText)} }));`,
      range: createRangeFromOffsets(document, insertOffset, insertOffset)
    }
  ];
};

const createChainPropDeclarationEdits = (
  document: TextDocument,
  component: ComponentMeta,
  name: string
): TextEdit[] => {
  const source = document.getText();
  const propsObject = findCallObjectArgumentRange(source, `${component.id}.props`);

  if (propsObject) {
    return [
      createObjectPropertyAppendEdit(
        document,
        propsObject,
        createObjectPropertyText(name, "undefined")
      )
    ];
  }

  const insertOffset =
    findChainComponentDeclarationEnd(source, component.id) ?? findImportInsertionOffset(source);

  return [
    {
      newText: `\n${component.id}.props({ ${createObjectPropertyText(name, "undefined")} });`,
      range: createRangeFromOffsets(document, insertOffset, insertOffset)
    }
  ];
};

const createChainEmitDeclarationEdits = (
  document: TextDocument,
  component: ComponentMeta,
  name: string
): TextEdit[] => {
  const source = document.getText();
  const emitsArray = findCallArrayArgumentRange(source, `${component.id}.emits`);

  if (emitsArray) {
    return [createArrayAppendEdit(document, emitsArray, JSON.stringify(name))];
  }

  const emitsObject = findCallObjectArgumentRange(source, `${component.id}.emits`);

  if (emitsObject) {
    return [
      createObjectPropertyAppendEdit(document, emitsObject, createObjectPropertyText(name, "null"))
    ];
  }

  const insertOffset =
    findChainComponentDeclarationEnd(source, component.id) ?? findImportInsertionOffset(source);

  return [
    {
      newText: `\n${component.id}.emits([${JSON.stringify(name)}]);`,
      range: createRangeFromOffsets(document, insertOffset, insertOffset)
    }
  ];
};

const createChainSlotDeclarationEdits = (
  document: TextDocument,
  component: ComponentMeta,
  name: string
): TextEdit[] => {
  const source = document.getText();
  const slotsObject = findCallObjectArgumentRange(source, `${component.id}.slots`);

  if (slotsObject) {
    return [
      createObjectPropertyAppendEdit(
        document,
        slotsObject,
        createObjectPropertyText(name, "undefined")
      )
    ];
  }

  const insertOffset =
    findChainComponentDeclarationEnd(source, component.id) ?? findImportInsertionOffset(source);

  return [
    {
      newText: `\n${component.id}.slot(${JSON.stringify(name)});`,
      range: createRangeFromOffsets(document, insertOffset, insertOffset)
    }
  ];
};

const createMacroDefinePropsEdits = (document: TextDocument, name: string): TextEdit[] =>
  createMacroDeclarationEdits(
    document,
    "defineProps",
    `${createTypePropertyName(name)}?: unknown`,
    [
      {
        kind: "object",
        text: createObjectPropertyText(name, "undefined")
      },
      {
        kind: "type",
        text: `${createTypePropertyName(name)}?: unknown`
      }
    ]
  );

const createMacroDefineEmitsEdits = (document: TextDocument, name: string): TextEdit[] =>
  createMacroDeclarationEdits(document, "defineEmits", `${createTypePropertyName(name)}: []`, [
    {
      kind: "array",
      text: JSON.stringify(name)
    },
    {
      kind: "object",
      text: createObjectPropertyText(name, "null")
    },
    {
      kind: "type",
      text: `${createTypePropertyName(name)}: []`
    }
  ]);

const createMacroDefineSlotsEdits = (document: TextDocument, name: string): TextEdit[] =>
  createMacroDeclarationEdits(
    document,
    "defineSlots",
    `${createTypePropertyName(name)}: () => unknown`,
    [
      {
        kind: "type",
        text: `${createTypePropertyName(name)}: () => unknown`
      }
    ]
  );

const createMacroDeclarationEdits = (
  document: TextDocument,
  callName: "defineEmits" | "defineProps" | "defineSlots",
  fallbackMemberText: string,
  candidates: Array<{ kind: "array" | "object" | "type"; text: string }>
): TextEdit[] => {
  const source = document.getText();
  const call = findFirstCallExpression(source, callName);

  if (call) {
    const candidate = candidates.find((item) => item.kind === "type");
    const typeLiteral = call.node.typeArguments?.[0];

    if (candidate && typeLiteral && ts.isTypeLiteralNode(typeLiteral)) {
      return [createTypeLiteralAppendEdit(document, typeLiteral, call.sourceFile, candidate.text)];
    }

    const firstArg = call.node.arguments[0];
    const objectCandidate = candidates.find((item) => item.kind === "object");

    if (objectCandidate && firstArg && ts.isObjectLiteralExpression(firstArg)) {
      return [
        createObjectPropertyAppendEdit(
          document,
          nodeRange(firstArg, call.sourceFile),
          objectCandidate.text
        )
      ];
    }

    const arrayCandidate = candidates.find((item) => item.kind === "array");

    if (arrayCandidate && firstArg && ts.isArrayLiteralExpression(firstArg)) {
      return [
        createArrayAppendEdit(document, nodeRange(firstArg, call.sourceFile), arrayCandidate.text)
      ];
    }

    if (!call.node.typeArguments?.length && call.node.arguments.length === 0) {
      return [
        {
          newText: `<{ ${fallbackMemberText} }>`,
          range: createRangeFromOffsets(
            document,
            call.node.expression.getEnd(),
            call.node.expression.getEnd()
          )
        }
      ];
    }

    return [];
  }

  const insertOffset = findImportInsertionOffset(source);

  return [
    ...createElfuiNamedImportEdits(document, callName),
    {
      newText: `${callName}<{ ${fallbackMemberText} }>();\n`,
      range: createRangeFromOffsets(document, insertOffset, insertOffset)
    }
  ];
};

const createComponentImportEdits = (
  document: TextDocument,
  component: ElfProjectComponent
): TextEdit[] => {
  if (hasImportedLocalName(document.getText(), component.localName)) {
    return [];
  }

  const importText =
    component.exportName === "default"
      ? `import ${component.localName} from "${component.importPath}";\n`
      : `import { ${createNamedImportText(component)} } from "${component.importPath}";\n`;
  const insertOffset = findImportInsertionOffset(document.getText());

  return [
    {
      newText: importText,
      range: createRangeFromOffsets(document, insertOffset, insertOffset)
    }
  ];
};

const createNamedImportText = (component: ElfProjectComponent): string =>
  component.exportName === component.localName
    ? component.localName
    : `${component.exportName} as ${component.localName}`;

const hasImportedLocalName = (source: string, localName: string): boolean => {
  const sourceFile = createTsSourceFile(source);

  return sourceFile.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) {
      return false;
    }

    const importClause = statement.importClause;

    if (importClause.name?.text === localName) {
      return true;
    }

    if (!importClause.namedBindings) {
      return false;
    }

    if (ts.isNamespaceImport(importClause.namedBindings)) {
      return importClause.namedBindings.name.text === localName;
    }

    return importClause.namedBindings.elements.some((element) => element.name.text === localName);
  });
};

const createMacroComponentRegistrationEdits = (
  document: TextDocument,
  localName: string
): TextEdit[] => {
  const source = document.getText();
  const useComponentsObject = findCallObjectArgumentRange(source, "useComponents");
  const edits = createUseComponentsImportEdits(document);

  if (useComponentsObject) {
    edits.push(createObjectAppendEdit(document, useComponentsObject, localName));

    return edits;
  }

  const insertOffset = findImportInsertionOffset(source);

  edits.push({
    newText: `\nuseComponents({ ${localName} });\n`,
    range: createRangeFromOffsets(document, insertOffset, insertOffset)
  });

  return edits;
};

const createUseComponentsImportEdits = (document: TextDocument): TextEdit[] => {
  return createElfuiNamedImportEdits(document, "useComponents");
};

const createElfuiNamedImportEdits = (document: TextDocument, importName: string): TextEdit[] => {
  const source = document.getText();
  const sourceFile = createTsSourceFile(source);

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "elfui" ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }

    const namedImports = statement.importClause.namedBindings;

    if (namedImports.elements.some((element) => element.name.text === importName)) {
      return [];
    }

    const closingBraceOffset = source.lastIndexOf("}", namedImports.getEnd());

    if (closingBraceOffset < 0) {
      return [];
    }

    const body = source.slice(namedImports.getStart(sourceFile) + 1, closingBraceOffset);
    const trailingWhitespace = body.match(/\s*$/)?.[0] ?? "";
    const insertOffset = closingBraceOffset - trailingWhitespace.length;
    const prefix = namedImports.elements.length > 0 ? ", " : " ";
    const suffix = trailingWhitespace || " ";

    return [
      {
        newText: `${prefix}${importName}${suffix}`,
        range: createRangeFromOffsets(document, insertOffset, closingBraceOffset)
      }
    ];
  }

  const insertOffset = findImportInsertionOffset(source);

  return [
    {
      newText: `import { ${importName} } from "elfui";\n`,
      range: createRangeFromOffsets(document, insertOffset, insertOffset)
    }
  ];
};

const createChainComponentRegistrationEdits = (
  document: TextDocument,
  owner: ComponentMeta,
  localName: string
): TextEdit[] => {
  const source = document.getText();
  const existingUseObject = findCallObjectArgumentRange(source, `${owner.id}.use`);

  if (existingUseObject) {
    return [createObjectAppendEdit(document, existingUseObject, localName)];
  }

  const insertOffset =
    findChainComponentDeclarationEnd(source, owner.id) ?? findImportInsertionOffset(source);

  return [
    {
      newText: `\n${owner.id}.use({ ${localName} });`,
      range: createRangeFromOffsets(document, insertOffset, insertOffset)
    }
  ];
};

const createObjectAppendEdit = (
  document: TextDocument,
  objectRange: { end: number; start: number },
  localName: string
): TextEdit => {
  return createObjectPropertyAppendEdit(document, objectRange, localName);
};

const createObjectPropertyAppendEdit = (
  document: TextDocument,
  objectRange: { end: number; start: number },
  propertyText: string
): TextEdit => {
  const source = document.getText();
  const body = source.slice(objectRange.start + 1, objectRange.end - 1);
  const insertOffset = objectRange.end - 1;
  const newText = body.trim() ? `, ${propertyText}` : ` ${propertyText} `;

  return {
    newText,
    range: createRangeFromOffsets(document, insertOffset, insertOffset)
  };
};

const createArrayAppendEdit = (
  document: TextDocument,
  arrayRange: { end: number; start: number },
  itemText: string
): TextEdit => {
  const source = document.getText();
  const body = source.slice(arrayRange.start + 1, arrayRange.end - 1);
  const insertOffset = arrayRange.end - 1;

  return {
    newText: body.trim() ? `, ${itemText}` : itemText,
    range: createRangeFromOffsets(document, insertOffset, insertOffset)
  };
};

const createTypeLiteralAppendEdit = (
  document: TextDocument,
  typeLiteral: ts.TypeLiteralNode,
  sourceFile: ts.SourceFile,
  memberText: string
): TextEdit => {
  const source = document.getText();
  const start = typeLiteral.getStart(sourceFile);
  const end = typeLiteral.getEnd();
  const body = source.slice(start + 1, end - 1);
  const insertOffset = end - 1;
  const newText = body.trim() ? `; ${memberText}` : ` ${memberText} `;

  return {
    newText,
    range: createRangeFromOffsets(document, insertOffset, insertOffset)
  };
};

const createObjectPropertyText = (name: string, value: string): string =>
  isValidIdentifier(name) ? `${name}: ${value}` : `${JSON.stringify(name)}: ${value}`;

const createTypePropertyName = (name: string): string =>
  isValidIdentifier(name) ? name : JSON.stringify(name);

const findCallObjectArgumentRange = (
  source: string,
  callName: string
): { end: number; start: number } | null => {
  const escaped = escapeRegExp(callName).replace(/\\\./g, "\\s*\\.\\s*");
  const pattern = new RegExp(`${escaped}\\s*\\(\\s*\\{`, "m");
  const match = pattern.exec(source);

  if (!match) {
    return null;
  }

  const objectStart = match.index + match[0].lastIndexOf("{");
  const objectEnd = findMatchingBrace(source, objectStart);

  return objectEnd === null ? null : { end: objectEnd + 1, start: objectStart };
};

const findCallArrayArgumentRange = (
  source: string,
  callName: string
): { end: number; start: number } | null => {
  const escaped = escapeRegExp(callName).replace(/\\\./g, "\\s*\\.\\s*");
  const pattern = new RegExp(`${escaped}\\s*\\(\\s*\\[`, "m");
  const match = pattern.exec(source);

  if (!match) {
    return null;
  }

  const arrayStart = match.index + match[0].lastIndexOf("[");
  const arrayEnd = findMatchingBracket(source, arrayStart);

  return arrayEnd === null ? null : { end: arrayEnd + 1, start: arrayStart };
};

const findMatchingBrace = (source: string, openOffset: number): number | null => {
  let depth = 0;

  for (let offset = openOffset; offset < source.length; offset += 1) {
    const char = source[offset];

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return offset;
      }
    }
  }

  return null;
};

const findMatchingBracket = (source: string, openOffset: number): number | null => {
  let depth = 0;

  for (let offset = openOffset; offset < source.length; offset += 1) {
    const char = source[offset];

    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;

      if (depth === 0) {
        return offset;
      }
    }
  }

  return null;
};

const findChainSetupReturnObjectRange = (
  source: string,
  componentId: string
): { end: number; start: number } | null => {
  const call = findFirstComponentMethodCall(source, componentId, "setup");
  const firstArg = call?.node.arguments[0];

  if (!call || !firstArg) {
    return null;
  }

  const objectLiteral = readReturnedObjectLiteral(firstArg);

  return objectLiteral ? nodeRange(objectLiteral, call.sourceFile) : null;
};

const readReturnedObjectLiteral = (node: ts.Node): ts.ObjectLiteralExpression | null => {
  if (ts.isParenthesizedExpression(node)) {
    return readReturnedObjectLiteral(node.expression);
  }

  if (ts.isObjectLiteralExpression(node)) {
    return node;
  }

  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (ts.isBlock(node.body)) {
      for (const statement of node.body.statements) {
        if (ts.isReturnStatement(statement) && statement.expression) {
          return readReturnedObjectLiteral(statement.expression);
        }
      }

      return null;
    }

    return readReturnedObjectLiteral(node.body);
  }

  return null;
};

const findFirstCallExpression = (
  source: string,
  callName: string
): { node: ts.CallExpression; sourceFile: ts.SourceFile } | null => {
  const sourceFile = createTsSourceFile(source);
  let result: ts.CallExpression | null = null;
  const visit = (node: ts.Node) => {
    if (result) {
      return;
    }

    if (ts.isCallExpression(node) && readCallExpressionName(node) === callName) {
      result = node;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return result ? { node: result, sourceFile } : null;
};

const readCallExpressionName = (call: ts.CallExpression): string | null => {
  const expression = call.expression;

  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return null;
};

const findFirstComponentMethodCall = (
  source: string,
  componentId: string,
  methodName: string
): { node: ts.CallExpression; sourceFile: ts.SourceFile } | null => {
  const sourceFile = createTsSourceFile(source);
  let result: ts.CallExpression | null = null;
  const visit = (node: ts.Node) => {
    if (result) {
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === methodName &&
      node.expression.expression.getText(sourceFile).replace(/\s/g, "") === componentId
    ) {
      result = node;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return result ? { node: result, sourceFile } : null;
};

const nodeRange = (node: ts.Node, sourceFile: ts.SourceFile): { end: number; start: number } => ({
  end: node.getEnd(),
  start: node.getStart(sourceFile)
});

const findChainComponentDeclarationEnd = (source: string, componentId: string): number | null => {
  const pattern = new RegExp(
    `\\b(?:const|let|var)\\s+${escapeRegExp(componentId)}\\s*=\\s*[\\s\\S]*?createComponent[\\s\\S]*?;`,
    "m"
  );
  const match = pattern.exec(source);

  return match ? match.index + match[0].length : null;
};

const findImportInsertionOffset = (source: string): number => {
  const sourceFile = createTsSourceFile(source);
  let offset = 0;

  sourceFile.statements.forEach((statement) => {
    if (ts.isImportDeclaration(statement)) {
      offset = Math.max(offset, statement.getEnd());
    }
  });

  return offset === 0 ? 0 : skipLineBreaks(source, offset);
};

const skipLineBreaks = (source: string, offset: number): number => {
  let current = offset;

  while (source[current] === "\r" || source[current] === "\n") {
    current += 1;
  }

  return current;
};

const createTsSourceFile = (source: string): ts.SourceFile =>
  ts.createSourceFile("component.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const createEventNames = (emits: string[]): string[] => {
  const names = [...emits, ...commonDomEvents];

  return names.filter((name, index) => names.indexOf(name) === index);
};

const createTemplateLocalCompletions = (
  document: TextDocument,
  context: EmbeddedDocumentContext,
  completionContext: TemplateCompletionContext,
  template: string
): CompletionItem[] =>
  [...collectTemplateLocalNames(template)].map((label) =>
    createTemplateCompletionItem(document, context, completionContext, {
      detail: "ElfUI template local",
      kind: CompletionItemKind.Variable,
      label,
      newText: label
    })
  );

const filterCompletionItems = (prefix: string, items: CompletionItem[]): CompletionItem[] => {
  const normalizedPrefix = prefix.toLowerCase();

  if (!normalizedPrefix) {
    return items;
  }

  return items.filter((item) =>
    readCompletionLabel(item).toLowerCase().startsWith(normalizedPrefix)
  );
};

const readCompletionLabel = (item: CompletionItem): string => item.label;

const resolveCurrentTemplateCompletionContext = (
  context: EmbeddedDocumentContext
): TemplateCompletionContext | null =>
  resolveTemplateCompletionContext(
    context.virtualDocument.getText(),
    context.virtualDocument.offsetAt(context.virtualPosition)
  );

const resolveTemplateCompletionContext = (
  template: string,
  offset: number
): TemplateCompletionContext | null => {
  const prefixSource = template.slice(0, offset);
  const expressionContext = resolveExpressionCompletionContext(prefixSource, offset);

  if (expressionContext) {
    return expressionContext;
  }

  const openTag = readOpenTagFragment(prefixSource);

  if (!openTag) {
    const bareTagMatch = /(?:^|[>\s])([A-Za-z][\w-]*)$/.exec(prefixSource);

    return bareTagMatch
      ? {
          kind: "tag",
          mode: "bare",
          prefix: bareTagMatch[1] ?? "",
          replaceStart: offset - (bareTagMatch[1]?.length ?? 0)
        }
      : null;
  }

  const tagNameMatch = /^\/?\s*([A-Za-z][\w-]*)?$/.exec(openTag.fragment);

  if (tagNameMatch) {
    const prefix = tagNameMatch[1] ?? "";

    return {
      kind: "tag",
      mode: "open",
      prefix,
      replaceStart: offset - prefix.length
    };
  }

  const eventModifierMatch = /(?:^|\s)(@([A-Za-z][\w:-]*))(\.[\w-]*)$/.exec(openTag.fragment);

  if (eventModifierMatch) {
    return {
      eventName: eventModifierMatch[2] ?? "",
      kind: "event-modifier",
      prefix: eventModifierMatch[3] ?? "",
      replaceStart: offset - (eventModifierMatch[3]?.length ?? 0)
    };
  }

  const modelModifierMatch = /(?:^|\s)v-model(\.[\w-]*)$/.exec(openTag.fragment);

  if (modelModifierMatch) {
    return {
      kind: "model-modifier",
      prefix: modelModifierMatch[1] ?? "",
      replaceStart: offset - (modelModifierMatch[1]?.length ?? 0)
    };
  }

  const eventMatch = /(?:^|\s)(@[\w:-]*)$/.exec(openTag.fragment);

  if (eventMatch) {
    return {
      kind: "event",
      prefix: eventMatch[1] ?? "",
      replaceStart: offset - (eventMatch[1]?.length ?? 0)
    };
  }

  const propMatch = /(?:^|\s)(:[\w:-]*)$/.exec(openTag.fragment);

  if (propMatch) {
    return {
      kind: "prop-binding",
      prefix: propMatch[1] ?? "",
      replaceStart: offset - (propMatch[1]?.length ?? 0)
    };
  }

  const slotMatch = /(?:^|\s)(#[\w-]*)$/.exec(openTag.fragment);

  if (slotMatch) {
    return {
      kind: "slot",
      prefix: slotMatch[1] ?? "",
      replaceStart: offset - (slotMatch[1]?.length ?? 0)
    };
  }

  const directiveMatch = /(?:^|\s)(v-[\w:-]*)$/.exec(openTag.fragment);

  if (directiveMatch) {
    return {
      kind: "directive",
      prefix: directiveMatch[1] ?? "",
      replaceStart: offset - (directiveMatch[1]?.length ?? 0)
    };
  }

  const attributeNameMatch = /(?:^|\s)([A-Za-z_][\w:-]*)?$/.exec(openTag.fragment);

  if (attributeNameMatch) {
    const prefix = attributeNameMatch[1] ?? "";

    return {
      kind: "attribute-name",
      prefix,
      replaceStart: offset - prefix.length
    };
  }

  return null;
};

const resolveExpressionCompletionContext = (
  prefixSource: string,
  offset: number
): TemplateCompletionContext | null => {
  const expression = readExpressionPrefixFromSource(prefixSource);

  if (expression === null) {
    return null;
  }

  const prefix = readExpressionCompletionPrefix(expression);

  return {
    kind: "expression",
    prefix,
    replaceStart: offset - prefix.length
  };
};

const readExpressionPrefixAtOffset = (source: string, offset: number): string | null =>
  readExpressionPrefixFromSource(source.slice(0, offset));

const readExpressionPrefixFromSource = (prefixSource: string): string | null => {
  const expressionMatch =
    /(?:\{\{|\$\{|=\s*["']|=\s*\{)\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?[A-Za-z_$\w$]*)?$/.exec(
      prefixSource
    );

  return expressionMatch ? (expressionMatch[1] ?? "") : null;
};

const readExpressionCompletionPrefix = (expression: string): string => {
  const lastDot = expression.lastIndexOf(".");

  return lastDot === -1 ? expression : expression.slice(lastDot + 1);
};

const readOpenTagFragment = (prefixSource: string): { fragment: string } | null => {
  const openTagIndex = prefixSource.lastIndexOf("<");

  if (openTagIndex === -1 || prefixSource.lastIndexOf(">") > openTagIndex) {
    return null;
  }

  const fragment = prefixSource.slice(openTagIndex + 1);

  if (fragment.startsWith("!--")) {
    return null;
  }

  return { fragment };
};

const createStyleCompletions = (context: EmbeddedDocumentContext): CompletionItem[] => {
  const parts = collectComponentTemplatePartNames(context);
  const slots = collectComponentTemplateSlotNames(context);
  const customProperties = collectComponentStyleCustomProperties(context.component);

  return [
    ...createBaseStyleCompletions(),
    ...parts.map((part) =>
      createStyleSnippetCompletion({
        detail: "ElfUI template part selector",
        documentation: `Uses the \`${part}\` part name found in this component template.`,
        insertText: `::part(${part}) {\n  $0\n}`,
        label: `::part(${part})`,
        sortText: `20_part_${part}`
      })
    ),
    ...parts.map((part) =>
      createStyleSnippetCompletion({
        detail: "ElfUI local part attribute selector",
        documentation: `Targets template elements with \`part="${part}"\` inside this component style.`,
        insertText: `[part~="${part}"] {\n  $0\n}`,
        label: `[part~="${part}"]`,
        sortText: `20_part_attribute_${part}`
      })
    ),
    ...slots.map((slot) =>
      createStyleSnippetCompletion({
        detail: "ElfUI slotted content selector",
        documentation:
          slot === "default"
            ? "Targets light DOM children projected into the default slot."
            : `Targets light DOM children assigned to the \`${slot}\` slot.`,
        insertText:
          slot === "default" ? "::slotted(*) {\n  $0\n}" : `::slotted([slot="${slot}"]) {\n  $0\n}`,
        label: slot === "default" ? "::slotted(*)" : `::slotted([slot="${slot}"])`,
        sortText: `21_slot_${slot}`
      })
    ),
    ...customProperties.map((property) => ({
      detail: "ElfUI CSS custom property reference",
      documentation: `References the \`${property}\` custom property declared in this component style.`,
      insertText: `var(${property})`,
      insertTextFormat: InsertTextFormat.Snippet,
      kind: CompletionItemKind.Variable,
      label: `var(${property})`,
      sortText: `30_var_${property}`
    }))
  ];
};

const createBaseStyleCompletions = (): CompletionItem[] => [
  createStyleSnippetCompletion({
    detail: "ElfUI host selector",
    documentation: "Targets the custom element host for this ElfUI component.",
    insertText: ":host {\n  $0\n}",
    label: ":host",
    sortText: "10_host"
  }),
  createStyleSnippetCompletion({
    detail: "ElfUI host state selector",
    documentation: "Targets the host only when it matches the selector inside parentheses.",
    insertText: ":host($1) {\n  $0\n}",
    label: ":host()",
    sortText: "11_host_state"
  }),
  createStyleSnippetCompletion({
    detail: "ElfUI host context selector",
    documentation:
      "Targets the host when an ancestor outside the shadow root matches the selector.",
    insertText: ":host-context($1) {\n  $0\n}",
    label: ":host-context()",
    sortText: "12_host_context"
  }),
  createStyleSnippetCompletion({
    detail: "ElfUI slotted content selector",
    documentation: "Targets light DOM children projected through a slot.",
    insertText: "::slotted($1) {\n  $0\n}",
    label: "::slotted()",
    sortText: "13_slotted"
  }),
  createStyleSnippetCompletion({
    detail: "ElfUI part selector",
    documentation: "Targets a shadow part exposed by a child Web Component.",
    insertText: "::part($1) {\n  $0\n}",
    label: "::part()",
    sortText: "14_part"
  }),
  createStyleSnippetCompletion({
    detail: "Web Components part attribute selector",
    documentation: "Matches elements that expose one or more shadow parts.",
    insertText: '[part~="$1"] {\n  $0\n}',
    label: "[part]",
    sortText: "15_part_attribute"
  }),
  createStyleSnippetCompletion({
    detail: "Web Components slot attribute selector",
    documentation: "Matches light DOM children assigned to a named slot.",
    insertText: '[slot="$1"] {\n  $0\n}',
    label: "[slot]",
    sortText: "16_slot_attribute"
  }),
  createStyleSnippetCompletion({
    detail: "Custom element defined selector",
    documentation: "Matches custom elements after their class has been registered.",
    insertText: ":defined",
    label: ":defined",
    sortText: "17_defined"
  }),
  createStyleSnippetCompletion({
    detail: "Custom state selector",
    documentation: "Matches custom states exposed through ElementInternals.states.",
    insertText: ":state($1)",
    label: ":state()",
    sortText: "18_state"
  }),
  createStyleSnippetCompletion({
    detail: "ElfUI CSS custom property declaration",
    documentation: "Declares a component-scoped design token on the current rule.",
    insertText: "--$1: $2;",
    kind: CompletionItemKind.Variable,
    label: "--custom-property",
    sortText: "19_custom_property"
  }),
  {
    detail: "ElfUI CSS variable usage",
    documentation: "References a CSS custom property.",
    insertText: "var(--$1)",
    insertTextFormat: InsertTextFormat.Snippet,
    kind: CompletionItemKind.Variable,
    label: "var(--*)",
    sortText: "30_var"
  }
];

const createStyleSnippetCompletion = (item: {
  detail: string;
  documentation: string;
  insertText: string;
  kind?: CompletionItemKind;
  label: string;
  sortText: string;
}): CompletionItem => ({
  detail: item.detail,
  documentation: item.documentation,
  insertText: item.insertText,
  insertTextFormat: InsertTextFormat.Snippet,
  kind: item.kind ?? CompletionItemKind.Property,
  label: item.label,
  sortText: item.sortText
});

const collectComponentTemplatePartNames = (context: EmbeddedDocumentContext): string[] => {
  const parts = new Set<string>();

  visitComponentTemplateNodes(context, (node, template) => {
    const value = readStaticTemplateAttributeValue(template, node, "part");

    if (!value) {
      return;
    }

    value
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(isStaticCssName)
      .forEach((part) => parts.add(part));
  });

  return [...parts].sort();
};

const collectComponentTemplateSlotNames = (context: EmbeddedDocumentContext): string[] => {
  const slots = new Set<string>();

  visitComponentTemplateNodes(context, (node, template) => {
    if (node.tag?.toLowerCase() !== "slot") {
      return;
    }

    const slot = readStaticTemplateAttributeValue(template, node, "name") ?? "default";

    if (isStaticCssName(slot)) {
      slots.add(slot);
    }
  });

  return [...slots].sort();
};

const collectComponentStyleCustomProperties = (component: ComponentMeta): string[] => {
  const properties = new Set<string>();

  component.styles.forEach((region) => {
    for (const match of region.content.matchAll(/(^|[;{\s])(--[A-Za-z_][\w-]*)\s*:/g)) {
      const property = match[2];

      if (property) {
        properties.add(property);
      }
    }
  });

  return [...properties].sort();
};

const isStaticCssName = (value: string): boolean => /^[A-Za-z_][\w-]*$/.test(value);

const visitComponentTemplateNodes = (
  context: EmbeddedDocumentContext,
  visit: (node: HTMLNode, template: string) => void
) => {
  context.component.templates.forEach((region) => {
    const virtualDocument = createVirtualDocument(context.virtualDocument.uri, region);
    const htmlDocument = htmlLanguageService.parseHTMLDocument(virtualDocument);
    const template = virtualDocument.getText();
    const walk = (node: HTMLNode) => {
      visit(node, template);
      node.children.forEach(walk);
    };

    htmlDocument.roots.forEach(walk);
  });
};

const readStaticTemplateAttributeValue = (
  template: string,
  node: HTMLNode,
  attribute: string
): string | null => {
  const value = node.attributes?.[attribute];

  if (typeof value !== "string") {
    return null;
  }

  const valueRange = findAttributeValueVirtualRange(template, node, attribute);

  return valueRange
    ? template.slice(valueRange.start, valueRange.end)
    : unwrapHtmlAttributeValue(value);
};

const createStyleMetadataHover = (
  document: TextDocument,
  context: EmbeddedDocumentContext
): Hover | null => {
  const target = readStyleHoverTarget(
    context.virtualDocument.getText(),
    context.virtualDocument.offsetAt(context.virtualPosition)
  );

  if (!target) {
    return null;
  }

  return {
    contents: {
      kind: "markdown",
      value: target.markdown
    },
    range: mapVirtualRangeByOffsets(
      document,
      context.region,
      context.virtualDocument,
      target.start,
      target.end
    )
  };
};

const readStyleHoverTarget = (
  source: string,
  offset: number
): { end: number; markdown: string; start: number } | null => {
  const selectorTarget = readStylePseudoSelectorHoverTarget(source, offset);

  if (selectorTarget) {
    return selectorTarget;
  }

  const attributeTarget = readStyleAttributeSelectorHoverTarget(source, offset);

  if (attributeTarget) {
    return attributeTarget;
  }

  return readStyleCustomPropertyHoverTarget(source, offset);
};

const stylePseudoSelectorHoverDocs: Array<{ markdown: string; token: string }> = [
  {
    markdown:
      "**`:host-context()`** targets this ElfUI component host when an ancestor outside the shadow root matches the selector.",
    token: ":host-context"
  },
  {
    markdown:
      "**`::slotted()`** targets light DOM children projected into this component through a `<slot>`.",
    token: "::slotted"
  },
  {
    markdown:
      "**`::part()`** targets a named shadow part exposed by a child Web Component or by this component for consumers.",
    token: "::part"
  },
  {
    markdown:
      "**`:host()`** targets this ElfUI custom element host when it matches a state selector.",
    token: ":host"
  },
  {
    markdown: "**`:state()`** targets custom states exposed through `ElementInternals.states`.",
    token: ":state"
  },
  {
    markdown: "**`:defined`** matches custom elements after their class has been registered.",
    token: ":defined"
  }
];

const readStylePseudoSelectorHoverTarget = (
  source: string,
  offset: number
): { end: number; markdown: string; start: number } | null => {
  for (const entry of stylePseudoSelectorHoverDocs) {
    let start = source.indexOf(entry.token);

    while (start !== -1) {
      const end = start + entry.token.length;

      if (offset >= start && offset <= end && isStylePseudoSelectorBoundary(source, start, end)) {
        return {
          end,
          markdown: entry.markdown,
          start
        };
      }

      start = source.indexOf(entry.token, end);
    }
  }

  return null;
};

const isStylePseudoSelectorBoundary = (source: string, start: number, end: number): boolean => {
  const before = source[start - 1];
  const after = source[end];

  return before !== ":" && after !== "-";
};

const readStyleAttributeSelectorHoverTarget = (
  source: string,
  offset: number
): { end: number; markdown: string; start: number } | null => {
  const pattern = /\[(part|slot)(?:[^\]]*)\]/g;

  for (const match of source.matchAll(pattern)) {
    if (match.index === undefined || !match[1]) {
      continue;
    }

    const start = match.index + 1;
    const end = start + match[1].length;

    if (offset < match.index || offset > match.index + match[0].length) {
      continue;
    }

    return {
      end,
      markdown:
        match[1] === "part"
          ? "**`[part]`** matches elements that expose one or more Web Components shadow parts."
          : "**`[slot]`** matches light DOM children assigned to a named slot.",
      start
    };
  }

  return null;
};

const readStyleCustomPropertyHoverTarget = (
  source: string,
  offset: number
): { end: number; markdown: string; start: number } | null => {
  const variablePattern = /var\(\s*(--[A-Za-z_][\w-]*)/g;

  for (const match of source.matchAll(variablePattern)) {
    if (match.index === undefined || !match[1]) {
      continue;
    }

    const start = match.index + match[0].indexOf(match[1]);
    const end = start + match[1].length;

    if (offset >= match.index && offset <= match.index + match[0].length) {
      return {
        end,
        markdown: `**\`${match[1]}\`** is an ElfUI CSS custom property reference.`,
        start
      };
    }
  }

  const propertyPattern = /--[A-Za-z_][\w-]*/g;

  for (const match of source.matchAll(propertyPattern)) {
    if (match.index === undefined) {
      continue;
    }

    const start = match.index;
    const end = start + match[0].length;

    if (offset >= start && offset <= end) {
      return {
        end,
        markdown: `**\`${match[0]}\`** is an ElfUI CSS custom property.`,
        start
      };
    }
  }

  return null;
};

const createTemplateMetadataHover = (
  document: TextDocument,
  context: EmbeddedDocumentContext
): Hover | null => {
  const offset = context.virtualDocument.offsetAt(context.virtualPosition);
  const word = readWordRangeAtOffset(context.virtualDocument.getText(), offset);

  if (!word) {
    return null;
  }

  const sourceRange = mapVirtualRangeByOffsets(
    document,
    context.region,
    context.virtualDocument,
    word.start,
    word.end
  );
  const localComponent = context.component.uses.find((item) => item.localName === word.value);

  if (localComponent) {
    return {
      contents: {
        kind: "markdown",
        value: createLocalComponentHover(localComponent)
      },
      range: sourceRange
    };
  }

  if (context.component.props.includes(word.value)) {
    return {
      contents: {
        kind: "markdown",
        value: createSymbolHover("prop", word.value, context.component.propsType)
      },
      range: sourceRange
    };
  }

  if (context.component.emits.includes(word.value)) {
    return {
      contents: {
        kind: "markdown",
        value: createSymbolHover("event", word.value, context.component.emitsType)
      },
      range: sourceRange
    };
  }

  if (context.component.slots.includes(word.value)) {
    return {
      contents: {
        kind: "markdown",
        value: createSymbolHover("slot", word.value, context.component.slotsType)
      },
      range: sourceRange
    };
  }

  if (context.component.setupReturns.includes(word.value)) {
    return {
      contents: {
        kind: "markdown",
        value: `**${word.value}**\n\nElfUI template value from component setup scope.`
      },
      range: sourceRange
    };
  }

  return null;
};

const createLocalComponentHover = (component: ComponentUseMeta): string => {
  const lines = [`**<${component.localName}>**`, "ElfUI local component."];

  if (component.expression) {
    lines.push(`Source: \`${component.expression}\``);
  }

  if (component.propsType) {
    lines.push(`Props: \`${component.propsType}\``);
  }

  if (component.emitsType) {
    lines.push(`Emits: \`${component.emitsType}\``);
  }

  if (component.slotsType) {
    lines.push(`Slots: \`${component.slotsType}\``);
  }

  return lines.join("\n\n");
};

const createSymbolHover = (
  kind: "event" | "prop" | "slot",
  name: string,
  typeName: string | undefined
): string => {
  const lines = [`**${name}**`, `ElfUI ${kind}.`];

  if (typeName) {
    lines.push(`Declared in: \`${typeName}\``);
  }

  return lines.join("\n\n");
};

const findEmbeddedDocumentContext = (
  document: TextDocument,
  position: Position,
  kind: EmbeddedRegion["kind"]
): EmbeddedDocumentContext | null => {
  const offset = document.offsetAt(position);
  const analysis = analyzeElfSource(document.getText(), {
    fileName: document.uri
  });

  for (const component of analysis.components) {
    const regions = kind === "template" ? component.templates : component.styles;
    const region = regions.find((item) => isInsideEmbeddedRegion(item, offset));

    if (region) {
      const virtualDocument = createVirtualDocument(document.uri, region);
      const virtualOffset = clamp(offset - region.contentStart, 0, region.content.length);

      return {
        component,
        components: analysis.components,
        region,
        virtualDocument,
        virtualPosition: virtualDocument.positionAt(virtualOffset)
      };
    }
  }

  return null;
};

const createTemplateDiagnostics = (
  document: TextDocument,
  components: ComponentMeta[],
  component: ComponentMeta,
  region: EmbeddedRegion,
  projectComponents: ElfProjectComponent[]
): Diagnostic[] => {
  const virtualDocument = createVirtualDocument(document.uri, region);
  const htmlVirtualDocument = createHtmlParsingVirtualDocument(document.uri, region);
  const htmlDocument = htmlLanguageService.parseHTMLDocument(htmlVirtualDocument);
  const diagnostics: Diagnostic[] = [];
  const scanner = htmlLanguageService.createScanner(htmlVirtualDocument.getText());

  for (let token = scanner.scan(); token !== TokenType.EOS; token = scanner.scan()) {
    const message = scanner.getTokenError();

    if (!message) {
      continue;
    }

    diagnostics.push({
      message,
      range: mapVirtualRangeByOffsets(
        document,
        region,
        htmlVirtualDocument,
        scanner.getTokenOffset(),
        scanner.getTokenEnd()
      ),
      severity: DiagnosticSeverity.Warning,
      source: "ElfUI"
    });
  }

  collectUnclosedTagDiagnostics(document, region, htmlVirtualDocument, htmlDocument, diagnostics);
  collectUnknownComponentDiagnostics(
    document,
    components,
    component,
    region,
    htmlVirtualDocument,
    htmlDocument,
    projectComponents,
    diagnostics
  );
  collectVModelWritableDiagnostics(document, component, region, virtualDocument, diagnostics);
  if (!component.macro) {
    collectUnknownExpressionDiagnostics(document, component, region, virtualDocument, diagnostics);
  }

  return diagnostics;
};

const createStyleDiagnostics = (document: TextDocument, region: EmbeddedRegion): Diagnostic[] => {
  const virtualDocument = createVirtualDocument(document.uri, region);
  const stylesheet = cssLanguageService.parseStylesheet(virtualDocument);

  return cssLanguageService.doValidation(virtualDocument, stylesheet).map((diagnostic) => ({
    ...diagnostic,
    range: mapVirtualRange(document, region, virtualDocument, diagnostic.range),
    source: "ElfUI"
  }));
};

const formatEmbeddedRegion = (
  document: TextDocument,
  region: EmbeddedRegion,
  options: ElfFormattingOptions,
  sourceRange?: Range
): TextEdit[] => {
  const virtualDocument = createVirtualDocument(document.uri, region);
  const virtualRange = sourceRange
    ? mapSourceRange(document, region, virtualDocument, sourceRange)
    : undefined;
  const formatOptions =
    typeof options.wrapLineLength === "number"
      ? {
          insertSpaces: options.insertSpaces,
          tabSize: options.tabSize,
          wrapLineLength: options.wrapLineLength
        }
      : {
          insertSpaces: options.insertSpaces,
          tabSize: options.tabSize
        };
  const edits =
    region.kind === "template"
      ? htmlLanguageService.format(virtualDocument, virtualRange, {
          ...formatOptions,
          wrapAttributes: "auto"
        })
      : cssLanguageService.format(virtualDocument, virtualRange, formatOptions);

  if (!sourceRange) {
    const formattedContent = applyVirtualTextEdits(
      virtualDocument.getText(),
      virtualDocument,
      edits
    );

    return [
      {
        newText: formatEmbeddedCodeBlock(document, region, formattedContent, options),
        range: {
          end: document.positionAt(region.contentEnd),
          start: document.positionAt(region.contentStart)
        }
      }
    ];
  }

  return edits.map((edit) => mapTextEdit(document, { region, virtualDocument }, edit));
};

const formatEmbeddedCodeBlock = (
  document: TextDocument,
  region: EmbeddedRegion,
  content: string,
  options: ElfFormattingOptions
): string => {
  const trimmedContent = content.trim();
  const closingIndent = readLineIndent(document.getText(), region.start);
  const contentIndent = `${closingIndent}${createIndentUnit(options)}`;

  if (!trimmedContent) {
    return `\n${closingIndent}`;
  }

  return `\n${indentLines(trimmedContent, contentIndent)}\n${closingIndent}`;
};

const createIndentUnit = (options: ElfFormattingOptions) =>
  options.insertSpaces ? " ".repeat(options.tabSize) : "\t";

const indentLines = (content: string, indent: string) =>
  content
    .split("\n")
    .map((line) => (line ? `${indent}${line}` : line))
    .join("\n");

const applyVirtualTextEdits = (source: string, document: TextDocument, edits: TextEdit[]): string =>
  [...edits]
    .sort(
      (left, right) => document.offsetAt(right.range.start) - document.offsetAt(left.range.start)
    )
    .reduce(
      (current, edit) =>
        `${current.slice(0, document.offsetAt(edit.range.start))}${edit.newText}${current.slice(
          document.offsetAt(edit.range.end)
        )}`,
      source
    );

const readLineIndent = (source: string, offset: number): string => {
  const lineStart = Math.max(0, source.lastIndexOf("\n", offset) + 1);
  const indentMatch = /^[ \t]*/.exec(source.slice(lineStart, offset));

  return indentMatch?.[0] ?? "";
};

const isRegionOverlappingRange = (region: EmbeddedRegion, start: number, end: number) =>
  start <= region.contentEnd && end >= region.contentStart;

const collectUnclosedTagDiagnostics = (
  document: TextDocument,
  region: EmbeddedRegion,
  virtualDocument: TextDocument,
  htmlDocument: HTMLDocument,
  diagnostics: Diagnostic[]
) => {
  const visit = (node: HTMLNode) => {
    if (
      node.tag &&
      node.startTagEnd !== undefined &&
      node.endTagStart === undefined &&
      !voidHtmlTags.has(node.tag.toLowerCase())
    ) {
      diagnostics.push({
        message: `Missing closing tag </${node.tag}>.`,
        range: mapVirtualRangeByOffsets(
          document,
          region,
          virtualDocument,
          node.start + 1,
          node.start + 1 + node.tag.length
        ),
        severity: DiagnosticSeverity.Warning,
        source: "ElfUI"
      });
    }

    node.children.forEach(visit);
  };

  htmlDocument.roots.forEach(visit);
};

const collectUnknownComponentDiagnostics = (
  document: TextDocument,
  components: ComponentMeta[],
  component: ComponentMeta,
  region: EmbeddedRegion,
  virtualDocument: TextDocument,
  htmlDocument: HTMLDocument,
  projectComponents: ElfProjectComponent[],
  diagnostics: Diagnostic[]
) => {
  const localComponents = createRegisteredComponentTagNames(component);

  const visit = (node: HTMLNode) => {
    if (
      node.tag &&
      !elfBuiltInComponentTags.has(node.tag) &&
      isComponentLikeTag(node.tag, localComponents) &&
      !localComponents.has(node.tag)
    ) {
      diagnostics.push({
        message: `Component <${node.tag}> is not registered with use().`,
        range: mapVirtualRangeByOffsets(
          document,
          region,
          virtualDocument,
          node.start + 1,
          node.start + 1 + node.tag.length
        ),
        severity: DiagnosticSeverity.Warning,
        source: "ElfUI"
      });
    }

    collectUnknownPropDiagnostics(
      document,
      components,
      component,
      region,
      virtualDocument,
      node,
      projectComponents,
      diagnostics
    );
    collectUnknownEventDiagnostics(
      document,
      components,
      component,
      region,
      virtualDocument,
      node,
      projectComponents,
      diagnostics
    );
    collectUnknownSlotDiagnostics(
      document,
      components,
      component,
      region,
      virtualDocument,
      node,
      projectComponents,
      diagnostics
    );
    node.children.forEach(visit);
  };

  htmlDocument.roots.forEach(visit);
};

const collectUnknownPropDiagnostics = (
  document: TextDocument,
  components: ComponentMeta[],
  owner: ComponentMeta,
  region: EmbeddedRegion,
  virtualDocument: TextDocument,
  node: HTMLNode,
  projectComponents: ElfProjectComponent[],
  diagnostics: Diagnostic[]
) => {
  if (!node.tag || !node.attributes) {
    return;
  }

  const definition = findTemplateComponentDefinitionForTag(
    components,
    owner,
    node.tag,
    projectComponents
  );

  if (!definition || definition.props.length === 0) {
    return;
  }

  const props = new Set(definition.props);

  Object.keys(node.attributes).forEach((attribute) => {
    const propName = normalizePropAttributeName(attribute);

    if (!propName || props.has(propName)) {
      return;
    }

    diagnostics.push({
      message: `Prop "${propName}" is not declared on <${node.tag}>.`,
      range: findAttributeRange(document, region, virtualDocument, node, attribute),
      severity: DiagnosticSeverity.Warning,
      source: "ElfUI"
    });
  });
};

const collectUnknownEventDiagnostics = (
  document: TextDocument,
  components: ComponentMeta[],
  owner: ComponentMeta,
  region: EmbeddedRegion,
  virtualDocument: TextDocument,
  node: HTMLNode,
  projectComponents: ElfProjectComponent[],
  diagnostics: Diagnostic[]
) => {
  if (!node.tag || !node.attributes) {
    return;
  }

  const definition = findTemplateComponentDefinitionForTag(
    components,
    owner,
    node.tag,
    projectComponents
  );

  if (!definition || definition.emits.length === 0) {
    return;
  }

  const emits = new Set(definition.emits);

  Object.keys(node.attributes).forEach((attribute) => {
    const eventName = normalizeEventAttributeName(attribute);

    if (!eventName || emits.has(eventName) || commonDomEvents.includes(eventName)) {
      return;
    }

    diagnostics.push({
      message: `Event "${eventName}" is not declared on <${node.tag}>.`,
      range: findAttributeRange(document, region, virtualDocument, node, attribute),
      severity: DiagnosticSeverity.Warning,
      source: "ElfUI"
    });
  });
};

const collectUnknownSlotDiagnostics = (
  document: TextDocument,
  components: ComponentMeta[],
  owner: ComponentMeta,
  region: EmbeddedRegion,
  virtualDocument: TextDocument,
  node: HTMLNode,
  projectComponents: ElfProjectComponent[],
  diagnostics: Diagnostic[]
) => {
  if (!node.tag) {
    return;
  }

  const definition = findTemplateComponentDefinitionForTag(
    components,
    owner,
    node.tag,
    projectComponents
  );

  if (!definition || definition.slots.length === 0) {
    return;
  }

  const slots = new Set(definition.slots);
  const visitSlotAttribute = (slotNode: HTMLNode, attribute: string) => {
    const slotName = normalizeSlotAttributeName(attribute);

    if (!slotName || slots.has(slotName)) {
      return;
    }

    diagnostics.push({
      message: `Slot "${slotName}" is not declared on <${node.tag}>.`,
      range: findAttributeRange(document, region, virtualDocument, slotNode, attribute),
      severity: DiagnosticSeverity.Warning,
      source: "ElfUI"
    });
  };

  Object.keys(node.attributes ?? {}).forEach((attribute) => visitSlotAttribute(node, attribute));
  node.children
    .filter((child) => child.tag === "template")
    .forEach((child) => {
      Object.keys(child.attributes ?? {}).forEach((attribute) =>
        visitSlotAttribute(child, attribute)
      );
    });
};

const collectVModelWritableDiagnostics = (
  document: TextDocument,
  component: ComponentMeta,
  region: EmbeddedRegion,
  virtualDocument: TextDocument,
  diagnostics: Diagnostic[]
) => {
  const template = virtualDocument.getText();
  const vModelPattern =
    /(?:^|\s)(v-model(?::[\w-]+)?(?:\.[\w-]+)*)\s*=\s*(?:\$\{([\s\S]*?)\}|(["'])([\s\S]*?)\3)/g;

  for (const match of template.matchAll(vModelPattern)) {
    if (match.index === undefined) {
      continue;
    }

    const expression = (match[2] ?? match[4] ?? "").trim();
    const expressionStart = findVModelExpressionStart(match);
    const result = validateVModelExpression(expression, component);

    if (!result) {
      continue;
    }

    diagnostics.push({
      message: result,
      range: mapVirtualRangeByOffsets(
        document,
        region,
        virtualDocument,
        match.index + expressionStart,
        match.index + expressionStart + expression.length
      ),
      severity: DiagnosticSeverity.Warning,
      source: "ElfUI"
    });
  }
};

const collectUnknownExpressionDiagnostics = (
  document: TextDocument,
  component: ComponentMeta,
  region: EmbeddedRegion,
  virtualDocument: TextDocument,
  diagnostics: Diagnostic[]
) => {
  const knownNames = createKnownTemplateNames(component);
  const expressions = collectTemplateExpressions(virtualDocument.getText());

  expressions.forEach((expression) => {
    const locals = new Set([...expression.locals, ...knownNames]);
    const sanitized = blankStringLiterals(expression.value);
    const seen = new Set<string>();
    // Identifiers may start with `$` (e.g. `$event`, `$emit`). Lookbehind avoids
    // matching the tail of `$event` as a separate `event` identifier when the
    // standard `\b` cannot create a boundary before `$`.
    const identifierPattern = /(?<![\w$])[A-Za-z_$][\w$]*/g;

    collectUnknownEmitDiagnostics(
      document,
      component,
      region,
      virtualDocument,
      expression,
      diagnostics
    );

    for (const match of sanitized.matchAll(identifierPattern)) {
      const name = match[0];
      const index = match.index;

      if (
        index === undefined ||
        seen.has(name) ||
        locals.has(name) ||
        templateGlobals.has(name) ||
        templateReservedWords.has(name) ||
        isPropertyAccess(sanitized, index) ||
        isObjectPropertyKey(sanitized, index + name.length)
      ) {
        continue;
      }

      seen.add(name);
      diagnostics.push({
        message: `Unknown template variable "${name}".`,
        range: mapVirtualRangeByOffsets(
          document,
          region,
          virtualDocument,
          expression.start + index,
          expression.start + index + name.length
        ),
        severity: DiagnosticSeverity.Warning,
        source: "ElfUI"
      });
    }
  });
};

const collectUnknownEmitDiagnostics = (
  document: TextDocument,
  component: ComponentMeta,
  region: EmbeddedRegion,
  virtualDocument: TextDocument,
  expression: TemplateExpression,
  diagnostics: Diagnostic[]
) => {
  const declaredEmits = new Set(component.emits);
  const emitPattern = /(?:\bemit|\$emit)\(\s*(["'])([\w:-]+)\1/g;

  for (const match of expression.value.matchAll(emitPattern)) {
    if (match.index === undefined || match[2] === undefined || declaredEmits.has(match[2])) {
      continue;
    }

    const eventOffset = match[0].lastIndexOf(match[2]);

    diagnostics.push({
      message: `Event "${match[2]}" is not declared in emits().`,
      range: mapVirtualRangeByOffsets(
        document,
        region,
        virtualDocument,
        expression.start + match.index + eventOffset,
        expression.start + match.index + eventOffset + match[2].length
      ),
      severity: DiagnosticSeverity.Warning,
      source: "ElfUI"
    });
  }
};

const collectTemplateExpressions = (template: string): TemplateExpression[] => {
  const locals = collectTemplateLocalNames(template);
  const expressions: TemplateExpression[] = [];
  const interpolationPattern = /\{\{([\s\S]*?)\}\}/g;
  const templateInterpolationPattern = /\$\{([\s\S]*?)\}/g;
  const bindingPattern =
    /\s(?:[:@][\w:-]+(?:\.[\w-]+)*|v-(?:bind(?::[\w-]+)?|if|else-if|show|model|text|html|for|memo))\s*=\s*(["'])([\s\S]*?)\1/g;

  for (const match of template.matchAll(interpolationPattern)) {
    if (match.index === undefined || match[1] === undefined) {
      continue;
    }

    expressions.push({
      locals,
      start: match.index + 2,
      value: match[1]
    });
  }

  for (const match of template.matchAll(templateInterpolationPattern)) {
    if (match.index === undefined || match[1] === undefined) {
      continue;
    }

    expressions.push({
      locals,
      start: match.index + 2,
      value: match[1]
    });
  }

  for (const match of template.matchAll(bindingPattern)) {
    if (match.index === undefined || match[2] === undefined) {
      continue;
    }

    const raw = match[0];
    const rawExpressionStart = raw.lastIndexOf(match[2]);
    const forSource = raw.includes("v-for") ? readForSourceExpression(match[2]) : null;
    const value = forSource ? forSource.expression : match[2];
    const start = forSource ? rawExpressionStart + forSource.start : rawExpressionStart;

    if (value === undefined || start === undefined) {
      continue;
    }

    expressions.push({
      locals,
      start: match.index + start,
      value
    });
  }

  return expressions;
};

const collectTemplateLocalNames = (template: string): Set<string> => {
  const locals = new Set<string>();
  const vForPattern = /\sv-for\s*=\s*(["'])([\s\S]*?)\1/g;
  const slotScopePattern = /<template\b[^>]*#[\w-]+(?:\s*=\s*(["'])([\s\S]*?)\1)[^>]*>/g;

  for (const match of template.matchAll(vForPattern)) {
    const declaration = match[2];

    if (!declaration) {
      continue;
    }

    const source = readForSourceExpression(declaration);
    const localPart = source ? declaration.slice(0, source.inIndex).trim() : declaration.trim();

    readTemplateLocalDeclarations(localPart).forEach((name) => locals.add(name));
  }

  for (const match of template.matchAll(slotScopePattern)) {
    if (!match[2]) {
      continue;
    }

    readTemplateLocalDeclarations(match[2]).forEach((name) => locals.add(name));
  }

  return locals;
};

const readTemplateLocalDeclarations = (source: string): string[] =>
  parseTemplateBindingParameters(source).flatMap((parameter) =>
    collectBindingIdentifierNames(parameter.name)
  );

const parseTemplateBindingParameters = (source: string): ts.ParameterDeclaration[] => {
  const parameters = unwrapTemplateBindingParameterList(source);
  const sourceFile = ts.createSourceFile(
    "template-binding.ts",
    `function __elfTemplateBinding(${parameters}) {}`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const [statement] = sourceFile.statements;

  if (!statement || !ts.isFunctionDeclaration(statement)) {
    return [];
  }

  return [...statement.parameters];
};

const unwrapTemplateBindingParameterList = (source: string): string => {
  let current = source.trim();

  while (isWrappedByParentheses(current)) {
    current = current.slice(1, -1).trim();
  }

  return current;
};

const isWrappedByParentheses = (source: string): boolean => {
  if (!source.startsWith("(") || !source.endsWith(")")) {
    return false;
  }

  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char !== ")") {
      continue;
    }

    depth -= 1;

    if (depth === 0 && index < source.length - 1) {
      return false;
    }
  }

  return depth === 0;
};

const collectBindingIdentifierNames = (name: ts.BindingName): string[] => {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }

  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : collectBindingIdentifierNames(element.name)
  );
};

const readForSourceExpression = (
  expression: string
): { expression: string; inIndex: number; start: number } | null => {
  const match = /\s(?:in|of)\s/.exec(expression);

  if (!match?.index) {
    return null;
  }

  const start = match.index + match[0].length;

  return {
    expression: expression.slice(start),
    inIndex: match.index,
    start
  };
};

const createKnownTemplateNames = (component: ComponentMeta): Set<string> =>
  new Set([
    ...component.props,
    ...component.setupReturns,
    ...component.uses.map((item) => item.localName),
    ...component.slots,
    ...(component.formControl ? ["ctx", "form"] : [])
  ]);

const blankStringLiterals = (source: string) =>
  source.replace(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g, (value) => " ".repeat(value.length));

const isPropertyAccess = (source: string, index: number) => {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const char = source[cursor];

    if (char === ".") {
      return true;
    }

    if (char && !/\s/.test(char)) {
      return false;
    }
  }

  return false;
};

const isObjectPropertyKey = (source: string, end: number) => {
  for (let cursor = end; cursor < source.length; cursor += 1) {
    const char = source[cursor];

    if (char === ":") {
      return true;
    }

    if (char && !/\s/.test(char)) {
      return false;
    }
  }

  return false;
};

const createRegisteredComponentTagNames = (component: ComponentMeta): Set<string> =>
  new Set(component.uses.flatMap((item) => [item.localName, toKebabCase(item.localName)]));

const isLocalComponentTag = (tag: string) => /^[A-Z]/.test(tag);

const isComponentLikeTag = (tag: string, registeredComponentTags: Set<string>) =>
  isLocalComponentTag(tag) || registeredComponentTags.has(tag);

const findComponentDefinitionForTag = (
  components: ComponentMeta[],
  owner: ComponentMeta,
  tag: string
): ComponentMeta | undefined => {
  const direct = components.find((component) => isComponentDefinitionTagMatch(component, tag));

  if (direct) {
    return direct;
  }

  const registration = owner.uses.find(
    (item) => item.localName === tag || toKebabCase(item.localName) === tag
  );

  if (!registration?.expression) {
    return undefined;
  }

  return components.find((component) =>
    [
      component.id,
      component.localName,
      component.name,
      component.name ? toKebabCase(component.name) : undefined
    ].includes(registration.expression)
  );
};

const findTemplateComponentDefinitionForTag = (
  components: ComponentMeta[],
  owner: ComponentMeta,
  tag: string,
  projectComponents: ElfProjectComponent[]
): TemplateComponentDefinition | null => {
  if (!isKnownComponentUsage(owner, tag, projectComponents)) {
    return null;
  }

  const sameFileDefinition = findComponentDefinitionForTag(components, owner, tag);

  if (sameFileDefinition) {
    return {
      emits: sameFileDefinition.emits,
      localName: sameFileDefinition.localName ?? sameFileDefinition.id,
      props: sameFileDefinition.props,
      slots: sameFileDefinition.slots,
      slotsType: sameFileDefinition.slotsType
    };
  }

  const projectDefinition = findProjectComponentDefinitionForTag(projectComponents, owner, tag);

  if (projectDefinition) {
    return {
      emits: projectDefinition.emits ?? [],
      localName: projectDefinition.localName,
      props: projectDefinition.props ?? [],
      slotScopes: projectDefinition.slotScopes ?? [],
      slots: projectDefinition.slots ?? [],
      slotsType: projectDefinition.slotsType
    };
  }

  const registration = findComponentRegistrationForTag(owner, tag);

  return registration?.slotsType
    ? {
        emits: [],
        localName: registration.localName,
        props: [],
        slots: [],
        slotsType: registration.slotsType
      }
    : null;
};

const isKnownComponentUsage = (
  owner: ComponentMeta,
  tag: string,
  projectComponents: ElfProjectComponent[]
): boolean =>
  isComponentLikeTag(tag, createRegisteredComponentTagNames(owner)) ||
  findProjectComponentDefinitionForTag(projectComponents, owner, tag) !== null;

const findProjectComponentDefinitionForTag = (
  components: ElfProjectComponent[],
  owner: ComponentMeta,
  tag: string
): ElfProjectComponent | null => {
  for (const registration of owner.uses) {
    const definition = components.find((component) =>
      isProjectComponentRegistrationMatch(component, registration, tag)
    );

    if (definition) {
      return definition;
    }
  }

  return null;
};

const findProjectComponentDefinitionForSlot = (
  components: ElfProjectComponent[],
  owner: ComponentMeta,
  slotName: string
): ElfProjectComponent | null => {
  const matches = owner.uses.flatMap((registration) =>
    components.filter(
      (component) =>
        isProjectComponentRegistrationMatch(component, registration, registration.localName) &&
        (component.slots ?? []).includes(slotName)
    )
  );

  return matches.length === 1 ? (matches[0] ?? null) : null;
};

const findComponentRegistrationForTag = (
  owner: ComponentMeta,
  tag: string
): ComponentUseMeta | null =>
  owner.uses.find((item) => item.localName === tag || toKebabCase(item.localName) === tag) ?? null;

const isProjectComponentRegistrationMatch = (
  component: ElfProjectComponent,
  registration: ComponentUseMeta,
  tag: string
): boolean => {
  const registeredNames = [
    registration.localName,
    toKebabCase(registration.localName),
    registration.expression
  ].filter(isNonEmptyString);
  const componentNames = [
    component.localName,
    toKebabCase(component.localName),
    component.tagName ?? undefined,
    component.tagName ? toKebabCase(component.tagName) : undefined,
    component.exportName === "default" ? undefined : component.exportName
  ].filter(isNonEmptyString);
  const registrationMatchesComponent =
    !registration.expression ||
    componentNames.includes(registration.expression) ||
    componentNames.includes(toKebabCase(registration.expression));
  const tagMatchesRegistration = registeredNames.includes(tag);
  const tagMatchesComponent = componentNames.includes(tag) && registrationMatchesComponent;

  return registrationMatchesComponent && (tagMatchesRegistration || tagMatchesComponent);
};

const isComponentDefinitionTagMatch = (component: ComponentMeta, tag: string): boolean =>
  [
    component.id,
    component.localName,
    component.name,
    toKebabCase(component.id),
    component.localName ? toKebabCase(component.localName) : undefined,
    component.name ? toKebabCase(component.name) : undefined
  ].includes(tag);

const findVModelExpressionStart = (match: RegExpMatchArray): number => {
  const raw = match[0];

  if (match[2] !== undefined) {
    const expressionStart = raw.indexOf("${");

    return expressionStart >= 0 ? expressionStart + 2 : raw.length;
  }

  if (match[4] !== undefined) {
    const expressionStart = raw.lastIndexOf(match[4]);

    return expressionStart >= 0 ? expressionStart : raw.length;
  }

  return raw.length;
};

const validateVModelExpression = (expression: string, component: ComponentMeta): string | null => {
  if (!expression) {
    return "v-model requires a writable target.";
  }

  const parsed = parseTemplateExpression(expression);

  if (!parsed || !isWritableAssignmentTarget(parsed)) {
    return `v-model target "${expression}" is not writable.`;
  }

  const rootName = readAssignmentRootName(parsed);

  if (rootName && (rootName === "props" || component.props.includes(rootName))) {
    return `v-model target "${expression}" is a prop and cannot be assigned.`;
  }

  return null;
};

const parseTemplateExpression = (expression: string): ts.Expression | null => {
  const sourceFile = ts.createSourceFile(
    "elf-v-model-expression.ts",
    `(${expression});`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const statement = sourceFile.statements[0];
  const parseDiagnostics =
    (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? [];

  if (parseDiagnostics.length > 0 || !statement || !ts.isExpressionStatement(statement)) {
    return null;
  }

  return unwrapAssignmentTargetExpression(statement.expression);
};

const unwrapAssignmentTargetExpression = (expression: ts.Expression): ts.Expression => {
  if (ts.isParenthesizedExpression(expression)) {
    return unwrapAssignmentTargetExpression(expression.expression);
  }

  if (ts.isNonNullExpression(expression)) {
    return unwrapAssignmentTargetExpression(expression.expression);
  }

  return expression;
};

const isWritableAssignmentTarget = (expression: ts.Expression): boolean => {
  const target = unwrapAssignmentTargetExpression(expression);

  if (ts.isIdentifier(target)) {
    return true;
  }

  if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
    return !hasOptionalAccessToken(target);
  }

  return false;
};

const readAssignmentRootName = (expression: ts.Expression): string | null => {
  const target = unwrapAssignmentTargetExpression(expression);

  if (ts.isIdentifier(target)) {
    return target.text;
  }

  if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
    return readAssignmentRootName(target.expression);
  }

  return null;
};

const hasOptionalAccessToken = (
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression
): boolean => Boolean((expression as { questionDotToken?: ts.QuestionDotToken }).questionDotToken);

const normalizePropAttributeName = (attribute: string): string | null => {
  if (
    attribute.startsWith("@") ||
    attribute.startsWith("v-on:") ||
    attribute.startsWith("#") ||
    attribute.startsWith("data-") ||
    attribute.startsWith("aria-") ||
    attribute === "v-slot" ||
    attribute.startsWith("v-slot:") ||
    ["class", "id", "key", "part", "ref", "slot", "style"].includes(attribute)
  ) {
    return null;
  }

  if (attribute === "v-model") {
    return "modelValue";
  }

  if (attribute.startsWith(":")) {
    return normalizePropName(attribute.slice(1));
  }

  if (attribute.startsWith("v-bind:")) {
    return normalizePropName(attribute.slice("v-bind:".length));
  }

  if (attribute.startsWith(".")) {
    return normalizePropName(attribute.slice(1));
  }

  if (attribute.startsWith("v-model:")) {
    return normalizePropName(attribute.slice("v-model:".length));
  }

  return normalizePropName(attribute);
};

const normalizeEventAttributeName = (attribute: string): string | null => {
  if (attribute.startsWith("@")) {
    return normalizeEventName(attribute.slice(1));
  }

  if (attribute.startsWith("v-on:")) {
    return normalizeEventName(attribute.slice("v-on:".length));
  }

  return null;
};

const normalizeEventName = (name: string): string | null => {
  const cleanName = name.split(".")[0] ?? name;

  return cleanName && !cleanName.startsWith("[") ? cleanName : null;
};

const normalizeSlotAttributeName = (attribute: string): string | null => {
  if (attribute === "v-slot" || attribute === "#") {
    return "default";
  }

  if (attribute.startsWith("#")) {
    return normalizeSlotName(attribute.slice(1));
  }

  if (attribute.startsWith("v-slot:")) {
    return normalizeSlotName(attribute.slice("v-slot:".length));
  }

  return null;
};

const normalizeSlotName = (name: string): string | null => {
  const cleanName = name.split(".")[0] ?? name;

  return cleanName && !cleanName.startsWith("[") ? cleanName : null;
};

const normalizePropName = (name: string): string | null => {
  if (!name || name.startsWith("[") || name.includes("]")) {
    return null;
  }

  return toCamelCase(name.split(".")[0] ?? name);
};

const toCamelCase = (value: string): string =>
  value.replace(/-([a-z0-9])/gi, (_, char: string) => char.toUpperCase());

const toKebabCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();

const findAttributeRange = (
  document: TextDocument,
  region: EmbeddedRegion,
  virtualDocument: TextDocument,
  node: HTMLNode,
  attribute: string
): Range => {
  const template = virtualDocument.getText();
  const attributeRange = findAttributeVirtualRange(template, node, attribute);
  const start = attributeRange?.start ?? node.start + 1;
  const end = attributeRange?.end ?? start + attribute.length;

  return mapVirtualRangeByOffsets(document, region, virtualDocument, start, end);
};

const findAttributeVirtualRange = (
  template: string,
  node: HTMLNode,
  attribute: string
): { end: number; start: number } | null => {
  const startTag = template.slice(node.start, node.startTagEnd ?? node.start);
  const match = new RegExp(`(?:^|\\s)(${escapeRegExp(attribute)})(?=\\s|=|$)`).exec(startTag);

  if (!match || match.index === undefined || match[1] === undefined) {
    return null;
  }

  const leadingWhitespace = match[0].indexOf(match[1]);
  const start = node.start + match.index + leadingWhitespace;

  return {
    end: start + attribute.length,
    start
  };
};

const findAttributeValueVirtualRange = (
  template: string,
  node: HTMLNode,
  attribute: string
): { end: number; start: number } | null => {
  const attributeRange = findAttributeVirtualRange(template, node, attribute);

  if (!attributeRange) {
    return null;
  }

  const startTag = template.slice(attributeRange.end, node.startTagEnd ?? attributeRange.end);
  const match = /^\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/.exec(startTag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];

  if (!match || value === undefined) {
    return null;
  }

  const valueStart = attributeRange.end + match[0].indexOf(value);

  return {
    end: valueStart + value.length,
    start: valueStart
  };
};

const findAttributeNamePartVirtualRange = (
  template: string,
  node: HTMLNode,
  attribute: string,
  kind: ElfProjectComponentSymbol["kind"]
): { end: number; start: number } | null => {
  const range = findAttributeVirtualRange(template, node, attribute);
  const part = readAttributeReferencePart(attribute, kind);

  return range && part
    ? {
        end: range.start + part.start + part.text.length,
        start: range.start + part.start
      }
    : null;
};

const readAttributeProjectReference = (
  attribute: string
): { kind: ElfProjectComponentSymbol["kind"]; name: string; text: string } | null => {
  const propName = normalizePropAttributeName(attribute);

  if (propName) {
    const part = readAttributeReferencePart(attribute, "prop");

    return part ? { kind: "prop", name: propName, text: part.text } : null;
  }

  const eventName = normalizeEventAttributeName(attribute);

  if (eventName) {
    const part = readAttributeReferencePart(attribute, "emit");

    return part ? { kind: "emit", name: eventName, text: part.text } : null;
  }

  const slotName = normalizeSlotAttributeName(attribute);

  if (slotName) {
    const part = readAttributeReferencePart(attribute, "slot");

    return part ? { kind: "slot", name: slotName, text: part.text } : null;
  }

  return null;
};

const readAttributeReferencePart = (
  attribute: string,
  kind: ElfProjectComponentSymbol["kind"]
): { start: number; text: string } | null => {
  const prefix = readAttributeReferencePrefix(attribute, kind);

  if (prefix === null) {
    return null;
  }

  const raw = attribute.slice(prefix);
  const text = raw.split(".")[0] ?? raw;

  return text ? { start: prefix, text } : null;
};

const readAttributeReferencePrefix = (
  attribute: string,
  kind: ElfProjectComponentSymbol["kind"]
): number | null => {
  if (kind === "prop") {
    if (attribute.startsWith("v-model:")) return "v-model:".length;
    if (attribute === "v-model") return 0;
    if (attribute.startsWith("v-bind:")) return "v-bind:".length;
    if (attribute.startsWith(":") || attribute.startsWith(".")) return 1;

    return 0;
  }

  if (kind === "emit") {
    if (attribute.startsWith("v-on:")) return "v-on:".length;
    if (attribute.startsWith("@")) return 1;

    return null;
  }

  if (kind === "slot") {
    if (attribute.startsWith("v-slot:")) return "v-slot:".length;
    if (attribute.startsWith("#")) return 1;
    if (attribute === "v-slot") return 0;

    return null;
  }

  return null;
};

const readWordAtOffset = (source: string, offset: number): string | null => {
  return readWordRangeAtOffset(source, offset)?.value ?? null;
};

const readWordRangeAtOffset = (
  source: string,
  offset: number
): { end: number; start: number; value: string } | null => {
  let start = offset;
  let end = offset;

  while (start > 0 && isWordCharacter(source[start - 1])) {
    start -= 1;
  }

  while (end < source.length && isWordCharacter(source[end])) {
    end += 1;
  }

  return start === end ? null : { end, start, value: source.slice(start, end) };
};

const isWordCharacter = (char: string | undefined) => Boolean(char && /[\w$-]/.test(char));

const isNonEmptyString = (value: string | undefined): value is string => Boolean(value);

const parseHTML = (context: EmbeddedDocumentContext) =>
  htmlLanguageService.parseHTMLDocument(context.virtualDocument);

const createVirtualDocument = (sourceUri: string, region: EmbeddedRegion) =>
  TextDocument.create(
    `${sourceUri}.${region.kind}-${region.contentStart}.${region.languageId}`,
    region.languageId,
    0,
    region.content
  );

const createHtmlParsingVirtualDocument = (sourceUri: string, region: EmbeddedRegion) =>
  TextDocument.create(
    `${sourceUri}.${region.kind}-${region.contentStart}.html`,
    "html",
    0,
    sanitizeTemplateForHtmlParsing(region.content)
  );

const sanitizeTemplateForHtmlParsing = (template: string): string => {
  const characters = template.split("");
  let index = 0;

  while (index < template.length) {
    if (template.startsWith("${", index)) {
      const end = findBalancedTemplateExpressionEnd(template, index);

      if (end === null) {
        index += 2;
        continue;
      }

      if (isAttributeExpressionStart(template, index)) {
        characters[index] = '"';
        for (let cursor = index + 1; cursor < end; cursor += 1) {
          characters[cursor] = preserveLineBreakPlaceholder(characters[cursor]);
        }
        characters[end] = '"';
      } else {
        blankRangePreservingLines(characters, index, end + 1);
      }

      index = end + 1;
      continue;
    }

    if (template.startsWith("{{", index)) {
      const end = template.indexOf("}}", index + 2);

      if (end === -1) {
        index += 2;
        continue;
      }

      blankRangePreservingLines(characters, index, end + 2);
      index = end + 2;
      continue;
    }

    index += 1;
  }

  return characters.join("");
};

const findBalancedTemplateExpressionEnd = (source: string, start: number): number | null => {
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;

  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];

    if (!char) {
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
};

const isAttributeExpressionStart = (template: string, expressionStart: number): boolean => {
  let cursor = expressionStart - 1;

  while (cursor >= 0 && /[ \t\r\n]/.test(template[cursor] ?? "")) {
    cursor -= 1;
  }

  if (template[cursor] !== "=") {
    return false;
  }

  let openTag = -1;
  let quote: '"' | "'" | null = null;
  let index = 0;

  while (index < cursor) {
    if (!quote && template.startsWith("${", index)) {
      const end = findBalancedTemplateExpressionEnd(template, index);

      if (end === null) {
        return false;
      }

      index = end + 1;
      continue;
    }

    const char = template[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      }

      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }

    if (char === "<") {
      openTag = index;
    } else if (char === ">") {
      openTag = -1;
    }

    index += 1;
  }

  return openTag >= 0;
};

const blankRangePreservingLines = (characters: string[], start: number, end: number) => {
  for (let index = start; index < end; index += 1) {
    characters[index] = preserveLineBreakPlaceholder(characters[index]);
  }
};

const preserveLineBreakPlaceholder = (value: string | undefined): string =>
  value === "\n" || value === "\r" ? value : " ";

const mapCompletionItem = (
  document: TextDocument,
  context: EmbeddedMappingContext,
  item: CompletionItem
): CompletionItem => {
  const mapped: CompletionItem = { ...item };

  if (item.additionalTextEdits) {
    mapped.additionalTextEdits = item.additionalTextEdits.map((edit) =>
      mapTextEdit(document, context, edit)
    );
  }

  if (item.textEdit) {
    mapped.textEdit = mapCompletionTextEdit(document, context, item.textEdit);
  }

  return mapped;
};

const mapHover = (document: TextDocument, context: EmbeddedMappingContext, hover: Hover): Hover => {
  if (!hover.range) {
    return hover;
  }

  return {
    ...hover,
    range: mapVirtualRange(document, context.region, context.virtualDocument, hover.range)
  };
};

const mapColorPresentation = (
  document: TextDocument,
  context: EmbeddedMappingContext,
  presentation: ColorPresentation
): ColorPresentation => {
  const mapped: ColorPresentation = { ...presentation };

  if (presentation.additionalTextEdits) {
    mapped.additionalTextEdits = presentation.additionalTextEdits.map((edit) =>
      mapTextEdit(document, context, edit)
    );
  }

  if (presentation.textEdit) {
    mapped.textEdit = mapTextEdit(document, context, presentation.textEdit);
  }

  return mapped;
};

const mapCompletionTextEdit = (
  document: TextDocument,
  context: EmbeddedMappingContext,
  edit: NonNullable<CompletionItem["textEdit"]>
): NonNullable<CompletionItem["textEdit"]> => {
  if (isInsertReplaceEdit(edit)) {
    return {
      ...edit,
      insert: mapVirtualRange(document, context.region, context.virtualDocument, edit.insert),
      replace: mapVirtualRange(document, context.region, context.virtualDocument, edit.replace)
    };
  }

  return mapTextEdit(document, context, edit);
};

const mapTextEdit = (
  document: TextDocument,
  context: EmbeddedMappingContext,
  edit: TextEdit
): TextEdit => ({
  ...edit,
  range: mapVirtualRange(document, context.region, context.virtualDocument, edit.range)
});

const mapVirtualRange = (
  document: TextDocument,
  region: EmbeddedRegion,
  virtualDocument: TextDocument,
  range: Range
): Range => ({
  end: mapVirtualPosition(document, region, virtualDocument, range.end),
  start: mapVirtualPosition(document, region, virtualDocument, range.start)
});

const mapSourceRange = (
  document: TextDocument,
  region: EmbeddedRegion,
  virtualDocument: TextDocument,
  range: Range
): Range => ({
  end: mapSourcePosition(document, region, virtualDocument, range.end),
  start: mapSourcePosition(document, region, virtualDocument, range.start)
});

const mapVirtualRangeByOffsets = (
  document: TextDocument,
  region: EmbeddedRegion,
  virtualDocument: TextDocument,
  start: number,
  end: number
): Range =>
  mapVirtualRange(document, region, virtualDocument, {
    end: virtualDocument.positionAt(end),
    start: virtualDocument.positionAt(start)
  });

const mapVirtualPosition = (
  document: TextDocument,
  region: EmbeddedRegion,
  virtualDocument: TextDocument,
  position: Position
): Position => document.positionAt(region.contentStart + virtualDocument.offsetAt(position));

const mapSourcePosition = (
  document: TextDocument,
  region: EmbeddedRegion,
  virtualDocument: TextDocument,
  position: Position
): Position =>
  virtualDocument.positionAt(
    clamp(document.offsetAt(position) - region.contentStart, 0, region.content.length)
  );

const dedupeCompletionItems = (items: CompletionItem[]): CompletionItem[] => {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = `${item.label}:${item.detail ?? ""}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
};

const isInsertReplaceEdit = (edit: TextEdit | InsertReplaceEdit): edit is InsertReplaceEdit =>
  "insert" in edit && "replace" in edit;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
