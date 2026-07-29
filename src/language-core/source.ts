import * as ts from "typescript";
import { ELFUI_COMPILER_PROTOCOL_VERSION } from "@elfui/compiler";
import {
  compileMacroComponent,
  type MacroComponentMetadata,
  type MacroExportedComponentMetadata,
  type MacroLocalComponentMetadata,
  type MacroSourceRange
} from "@elfui/compiler/macro-component";
import { analyzeElfMacroUsage } from "@elfui/compiler/vite";

export type EmbeddedRegionKind = "template" | "style";
export type EmbeddedRegionMethod = "defineHtml" | "defineStyle";

export interface EmbeddedRegion {
  content: string;
  contentEnd: number;
  contentStart: number;
  end: number;
  kind: EmbeddedRegionKind;
  languageId: "html" | "css";
  method: EmbeddedRegionMethod;
  start: number;
}

export interface ComponentUseMeta {
  emitsType?: string;
  expression?: string;
  localName: string;
  propDetails?: ComponentPropMeta[];
  props?: string[];
  propsType?: string;
  slotsType?: string;
  source: "alias" | "array" | "macro" | "object";
}

export type ComponentSymbolKind = "component" | "emit" | "prop" | "setup" | "slot";

export interface ComponentSymbolMeta {
  end: number;
  kind: ComponentSymbolKind;
  name: string;
  start: number;
}

export interface ComponentPropMeta {
  defaultValue?: string;
  name: string;
  type?: string;
}

export interface ComponentMeta {
  emits: string[];
  emitsType?: string;
  exportName?: "default" | string;
  formControl: boolean;
  id: string;
  localName?: string;
  macro: boolean;
  name: string | null;
  props: string[];
  propDetails: ComponentPropMeta[];
  propsType?: string;
  referenceTemplates: EmbeddedRegion[];
  setupReturns: string[];
  slots: string[];
  slotsType?: string;
  styles: EmbeddedRegion[];
  symbols: ComponentSymbolMeta[];
  templates: EmbeddedRegion[];
  uses: ComponentUseMeta[];
}

export interface SourceAnalysisResult {
  components: ComponentMeta[];
  fileName: string;
  isMacroComponent: boolean;
  metadata?: MacroComponentMetadata;
}

export interface AnalyzeElfSourceOptions {
  fileName?: string;
  scriptKind?: ts.ScriptKind;
}

type MutableComponentMeta = ComponentMeta;

interface NamedMeta {
  defaultValue?: string;
  end: number;
  name: string;
  start: number;
  type?: string;
}

interface MacroSymbols {
  emits: NamedMeta[];
  props: NamedMeta[];
  setupReturns: NamedMeta[];
  slots: NamedMeta[];
  uses: NamedMeta[];
}

const macroRuntimePackages = ["@elfui/core"];

export const createEmptyComponentMeta = (id: string): ComponentMeta => ({
  emits: [],
  formControl: false,
  id,
  macro: false,
  name: null,
  props: [],
  propDetails: [],
  referenceTemplates: [],
  setupReturns: [],
  slots: [],
  styles: [],
  symbols: [],
  templates: [],
  uses: []
});

export const analyzeElfSource = (
  source: string,
  options: AnalyzeElfSourceOptions = {}
): SourceAnalysisResult => {
  const fileName = options.fileName ?? "anonymous.ts";
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    options.scriptKind ?? inferScriptKind(fileName)
  );
  const components = new Map<string, MutableComponentMeta>();
  const macroComponent = isMacroComponentSource(source, fileName);
  let metadata: MacroComponentMetadata | undefined;

  if (macroComponent) {
    metadata = applyMacroAnalysis(source, sourceFile, components, fileName);
  }

  return {
    components: [...components.values()],
    fileName,
    isMacroComponent: macroComponent,
    ...(metadata ? { metadata } : {})
  };
};

export const isMacroComponentSource = (source: string, fileName = "anonymous.ts"): boolean => {
  const cleanFileName = fileName.replace(/[?#].*$/, "").toLowerCase();

  return (
    /\.elf\.[cm]?[jt]sx?$/.test(cleanFileName) ||
    hasElfComponentPragma(source) ||
    macroRuntimePackages.some(
      (runtimePackage) => analyzeElfMacroUsage(source, runtimePackage, fileName).hasMacroComponentExport
    )
  );
};

export const isInsideEmbeddedRegion = (region: EmbeddedRegion, offset: number) =>
  offset >= region.contentStart && offset <= region.contentEnd;

const applyMacroAnalysis = (
  source: string,
  sourceFile: ts.SourceFile,
  components: Map<string, MutableComponentMeta>,
  fileName: string
): MacroComponentMetadata => {
  const templateRegions = collectDefineHtmlRegions(sourceFile);
  const styleRegions = collectDefineStyleRegions(sourceFile);
  const typeMembers = collectTopLevelTypeMembers(sourceFile);
  const symbols = collectMacroSymbols(sourceFile, typeMembers);
  const metadata = readMacroMetadata(source, fileName, symbols);
  const componentMetadata: MacroExportedComponentMetadata[] = metadata.components.length
    ? metadata.components
    : [
        {
          emitNames: [],
          emitsType: "Record<string, unknown[]>",
          exportName: "default" as const,
          name: "macro-component",
          propNames: [],
          propsType: "Record<string, unknown>",
          runtimePropOptions: {},
          slotsType: "Record<string, unknown>",
          tagName: "macro-component",
          source: createEmptyMacroSourceRange(),
          props: [],
          events: [],
          slots: { typeText: "Record<string, unknown>" },
          expose: [],
          models: [],
          options: {}
        }
      ];

  componentMetadata.forEach((item, index) => {
    const id =
      item.localName ??
      (item.exportName === "default"
        ? `macro:default:${fileName}`
        : `macro:${item.exportName}:${fileName}`);
    const component = ensureMapComponent(components, id);

    applyMacroMetadata(component, item, metadata, symbols);

    const templateRegion =
      templateRegions[index] ?? (componentMetadata.length === 1 ? templateRegions[0] : undefined);

    if (templateRegion && !component.templates.includes(templateRegion)) {
      component.templates.push(templateRegion);
    }

    appendRegions(component.styles, styleRegions);
  });

  components.forEach((component) => {
    component.referenceTemplates = templateRegions;
  });

  return metadata;
};

const readMacroMetadata = (
  source: string,
  fileName: string,
  symbols: MacroSymbols
): MacroComponentMetadata => {
  try {
    return compileMacroComponent(source, {
      filename: fileName,
      sourceId: fileName.replace(/\\/g, "/"),
      templateTypeCheck: false
    }).metadata;
  } catch {
    return {
      schemaVersion: 2,
      compilerProtocol: ELFUI_COMPILER_PROTOCOL_VERSION,
      components: [],
      diagnostics: {
        codes: [],
        errors: 0,
        warnings: 0
      },
      exposed: [],
      filename: fileName,
      localComponents: symbols.uses.map((item) => ({
        constructorType: "unknown",
        emitsType: "Record<string, unknown[]>",
        expression: item.name,
        name: item.name,
        propsType: "Record<string, unknown>",
        slotsType: "Record<string, unknown>"
      })),
      sourceId: fileName
    };
  }
};

const applyMacroMetadata = (
  component: MutableComponentMeta,
  item: MacroExportedComponentMetadata,
  metadata: MacroComponentMetadata,
  symbols: MacroSymbols
) => {
  component.macro = true;
  component.name = item.tagName;
  component.exportName = item.exportName;
  if (item.localName) component.localName = item.localName;
  component.propsType = item.propsType;
  component.emitsType = item.emitsType;
  component.slotsType = item.slots.typeText;

  appendUnique(component.props, [
    ...item.props.map((prop) => prop.name),
    ...symbols.props.map((prop) => prop.name)
  ]);
  appendPropDetails(
    component.propDetails,
    item.props.map((prop) => ({
      end: item.source.end,
      name: prop.name,
      start: item.source.start,
      type: prop.typeText
    }))
  );
  appendPropDetails(component.propDetails, symbols.props);
  appendUnique(component.emits, [
    ...item.events.map((event) => event.name),
    ...symbols.emits.map((emit) => emit.name)
  ]);
  appendUnique(
    component.slots,
    symbols.slots.map((slot) => slot.name)
  );
  appendUnique(component.setupReturns, [
    ...item.expose,
    ...symbols.setupReturns.map((setup) => setup.name)
  ]);
  appendUses(component.uses, metadata.localComponents.map(toMacroUseMeta));
  appendSymbols(component.symbols, symbols.props, "prop");
  appendSymbols(component.symbols, symbols.emits, "emit");
  appendSymbols(component.symbols, symbols.slots, "slot");
  appendSymbols(component.symbols, symbols.setupReturns, "setup");
  appendSymbols(component.symbols, symbols.uses, "component");
};

const toMacroUseMeta = (item: MacroLocalComponentMetadata): ComponentUseMeta => ({
  emitsType: item.emitsType,
  expression: item.expression,
  localName: item.name,
  propsType: item.propsType,
  slotsType: item.slotsType,
  source: "macro"
});

const createEmptyMacroSourceRange = (): MacroSourceRange => ({
  column: 1,
  end: 0,
  endColumn: 1,
  endLine: 1,
  line: 1,
  start: 0
});

const ensureMapComponent = (components: Map<string, MutableComponentMeta>, id: string) => {
  const existing = components.get(id);

  if (existing) {
    return existing;
  }

  const component = createEmptyComponentMeta(id);
  components.set(id, component);

  return component;
};

const inferScriptKind = (fileName: string) => {
  if (fileName.endsWith(".js")) {
    return ts.ScriptKind.JS;
  }

  return ts.ScriptKind.TS;
};

const collectDefineStyleRegions = (sourceFile: ts.SourceFile): EmbeddedRegion[] => {
  const regions: EmbeddedRegion[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = callExpressionName(node);

      if (name === "defineStyle") {
        for (const arg of node.arguments) {
          const embeddedString = readEmbeddedString(arg, sourceFile);
          if (!embeddedString) continue;
          regions.push({
            content: embeddedString.content,
            contentEnd: embeddedString.contentEnd,
            contentStart: embeddedString.contentStart,
            end: node.getEnd(),
            kind: "style",
            languageId: "css",
            method: "defineStyle",
            start: node.getStart(sourceFile)
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return regions;
};

const collectDefineHtmlRegions = (sourceFile: ts.SourceFile): EmbeddedRegion[] => {
  const regions: EmbeddedRegion[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && callExpressionName(node) === "defineHtml") {
      const first = node.arguments[0];
      const embeddedString = first ? readEmbeddedString(first, sourceFile) : null;
      if (embeddedString) {
        regions.push({
          content: embeddedString.content,
          contentEnd: embeddedString.contentEnd,
          contentStart: embeddedString.contentStart,
          end: node.getEnd(),
          kind: "template",
          languageId: "html",
          method: "defineHtml",
          start: node.getStart(sourceFile)
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return regions;
};

const hasElfComponentPragma = (source: string): boolean => {
  const header = source.slice(0, 1024);

  return /^\/\/\/[ \t]*<!--[ \t]*@elf[ \t]+component[ \t]*-->[ \t]*$/m.test(header);
};

const collectTopLevelTypeMembers = (sourceFile: ts.SourceFile): Map<string, NamedMeta[]> => {
  const result = new Map<string, NamedMeta[]>();

  sourceFile.statements.forEach((statement) => {
    if (ts.isInterfaceDeclaration(statement)) {
      result.set(statement.name.text, readTypeMembers(statement, sourceFile));
      return;
    }

    if (ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)) {
      result.set(statement.name.text, readTypeMembers(statement.type, sourceFile));
    }
  });

  return result;
};

const collectMacroSymbols = (
  sourceFile: ts.SourceFile,
  typeMembers: Map<string, NamedMeta[]>
): MacroSymbols => {
  const symbols: MacroSymbols = {
    emits: [],
    props: [],
    setupReturns: [],
    slots: [],
    uses: []
  };

  const visitTopLevelCall = (call: ts.CallExpression, localName: string | null) => {
    const name = callExpressionName(call);

    if (name === "defineProps") {
      appendNamed(symbols.props, readPropsFromMacroCall(call, sourceFile, typeMembers));
      if (localName) appendNamed(symbols.setupReturns, [identifierMeta(localName, call)]);
      return;
    }

    if (name === "defineEmits") {
      appendNamed(symbols.emits, readEmitsFromMacroCall(call, sourceFile, typeMembers));
      if (localName) appendNamed(symbols.setupReturns, [identifierMeta(localName, call)]);
      return;
    }

    if (name === "defineSlots") {
      appendNamed(symbols.slots, readSlotsFromMacroCall(call, sourceFile, typeMembers));
      if (localName) appendNamed(symbols.setupReturns, [identifierMeta(localName, call)]);
      return;
    }

    if (name === "defineModel") {
      const model = readModelFromMacroCall(call, sourceFile);

      appendNamed(symbols.props, [model.prop]);
      appendNamed(symbols.emits, [model.emit]);
      if (localName) appendNamed(symbols.setupReturns, [identifierMeta(localName, call)]);
      return;
    }

    if (name === "useComponents") {
      appendNamed(symbols.uses, readUseRegistrationSymbols(call.arguments, sourceFile));
    }
  };

  sourceFile.statements.forEach((statement) => {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      appendNamed(symbols.setupReturns, [
        {
          end: statement.name.getEnd(),
          name: statement.name.text,
          start: statement.name.getStart(sourceFile)
        }
      ]);
      return;
    }

    if (ts.isVariableStatement(statement)) {
      statement.declarationList.declarations.forEach((declaration) => {
        const localNames = readBindingNameMeta(declaration.name, sourceFile);
        const initializer = declaration.initializer
          ? unwrapExpression(declaration.initializer)
          : null;

        if (initializer && ts.isCallExpression(initializer)) {
          const name = callExpressionName(initializer);

          if (name === "defineHtml") {
            return;
          }

          localNames.forEach((localName) => visitTopLevelCall(initializer, localName.name));

          if (
            name === "defineProps" ||
            name === "defineEmits" ||
            name === "defineSlots" ||
            name === "defineModel"
          ) {
            return;
          }
        }

        appendNamed(symbols.setupReturns, localNames);
      });
      return;
    }

    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
      visitTopLevelCall(statement.expression, null);
    }
  });

  return symbols;
};

const readPropsFromMacroCall = (
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  typeMembers: Map<string, NamedMeta[]>
): NamedMeta[] => {
  const first = call.arguments[0];
  const fromArgument =
    first && ts.isArrayLiteralExpression(first)
      ? readStringArrayEntries(first, sourceFile)
      : first && ts.isObjectLiteralExpression(first)
        ? readObjectProperties(first, sourceFile)
        : [];

  return [
    ...fromArgument,
    ...readMembersFromTypeArgument(call.typeArguments?.[0], sourceFile, typeMembers)
  ];
};

const readEmitsFromMacroCall = (
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  typeMembers: Map<string, NamedMeta[]>
): NamedMeta[] => {
  const first = call.arguments[0];
  const fromArgument =
    first && ts.isArrayLiteralExpression(first)
      ? readStringArrayEntries(first, sourceFile)
      : first && ts.isObjectLiteralExpression(first)
        ? readObjectProperties(first, sourceFile)
        : [];

  return [
    ...fromArgument,
    ...readMembersFromTypeArgument(call.typeArguments?.[0], sourceFile, typeMembers)
  ];
};

const readSlotsFromMacroCall = (
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  typeMembers: Map<string, NamedMeta[]>
): NamedMeta[] => readMembersFromTypeArgument(call.typeArguments?.[0], sourceFile, typeMembers);

const readModelFromMacroCall = (
  call: ts.CallExpression,
  sourceFile: ts.SourceFile
): { emit: NamedMeta; prop: NamedMeta } => {
  const first = call.arguments[0];
  const prop = first ? readStaticStringEntry(first, sourceFile) : null;
  const propName = prop?.name || "modelValue";
  const modelMeta = prop ?? identifierMeta(propName, call);

  return {
    emit: {
      end: modelMeta.end,
      name: `update:${propName}`,
      start: modelMeta.start
    },
    prop: {
      end: modelMeta.end,
      name: propName,
      start: modelMeta.start
    }
  };
};

const readMembersFromTypeArgument = (
  typeNode: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  typeMembers: Map<string, NamedMeta[]>
): NamedMeta[] => {
  if (!typeNode) {
    return [];
  }

  if (ts.isTypeLiteralNode(typeNode)) {
    return readTypeMembers(typeNode, sourceFile);
  }

  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    return typeMembers.get(typeNode.typeName.text) ?? [];
  }

  return [];
};

const readTypeMembers = (
  node: ts.InterfaceDeclaration | ts.TypeLiteralNode,
  sourceFile: ts.SourceFile
): NamedMeta[] =>
  node.members.flatMap((member) => {
    if (!(ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) || !member.name) {
      return [];
    }

    const type = member.type
      ? `${member.type.getText(sourceFile)}${member.questionToken ? " | undefined" : ""}`
      : undefined;

    return readPropertyNameMeta(member.name, sourceFile).map((item) => ({ ...item, type }));
  });

const callExpressionName = (call: ts.CallExpression): string | null => {
  const expression = call.expression;

  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return null;
};

const readBindingNameMeta = (name: ts.BindingName, sourceFile: ts.SourceFile): NamedMeta[] => {
  if (ts.isIdentifier(name)) {
    return [
      {
        end: name.getEnd(),
        name: name.text,
        start: name.getStart(sourceFile)
      }
    ];
  }

  if (ts.isObjectBindingPattern(name)) {
    return name.elements.flatMap((element) => readBindingNameMeta(element.name, sourceFile));
  }

  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? readBindingNameMeta(element.name, sourceFile) : []
  );
};

const identifierMeta = (name: string, node: ts.Node): NamedMeta => ({
  end: node.getEnd(),
  name,
  start: node.getStart()
});

const readStaticString = (node: ts.Node): string | null => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  return null;
};

const readEmbeddedString = (
  node: ts.Node,
  sourceFile: ts.SourceFile
): { content: string; contentEnd: number; contentStart: number } | null => {
  if (
    !ts.isStringLiteral(node) &&
    !ts.isNoSubstitutionTemplateLiteral(node) &&
    !ts.isTemplateExpression(node)
  ) {
    return null;
  }

  const contentStart = node.getStart(sourceFile) + 1;
  const contentEnd = Math.max(contentStart, node.getEnd() - 1);

  return {
    content: sourceFile.text.slice(contentStart, contentEnd),
    contentEnd,
    contentStart
  };
};

const readStaticStringEntry = (node: ts.Node, sourceFile: ts.SourceFile): NamedMeta | null => {
  const name = readStaticString(node);

  if (name === null) {
    return null;
  }

  return {
    end: Math.max(node.getStart(sourceFile) + 1, node.getEnd() - 1),
    name,
    start: node.getStart(sourceFile) + 1
  };
};

const readObjectProperties = (node: ts.Node, sourceFile: ts.SourceFile): NamedMeta[] => {
  if (!ts.isObjectLiteralExpression(node)) {
    return [];
  }

  return node.properties.flatMap((property) => {
    if (ts.isPropertyAssignment(property)) {
      return readPropertyNameMeta(property.name, sourceFile).map((item) => ({
        ...item,
        ...readRuntimePropDetails(property.initializer, sourceFile)
      }));
    }

    if (ts.isMethodDeclaration(property)) {
      return readPropertyNameMeta(property.name, sourceFile);
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      return [
        {
          end: property.name.getEnd(),
          name: property.name.text,
          start: property.name.getStart(sourceFile)
        }
      ];
    }

    return [];
  });
};

const readRuntimePropDetails = (
  initializer: ts.Expression,
  sourceFile: ts.SourceFile
): Pick<NamedMeta, "defaultValue" | "type"> => {
  if (ts.isIdentifier(initializer)) {
    return { type: readRuntimeConstructorType(initializer.text) };
  }

  if (!ts.isObjectLiteralExpression(initializer)) {
    return {};
  }

  const typeProperty = initializer.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && readPropertyName(property.name).includes("type")
  );
  const defaultProperty = initializer.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && readPropertyName(property.name).includes("default")
  );
  const type = typeProperty
    ? readRuntimePropType(typeProperty.initializer, sourceFile)
    : undefined;
  const defaultValue = defaultProperty
    ? readStaticDefaultValue(defaultProperty.initializer, sourceFile)
    : undefined;

  return { defaultValue, type };
};

const readRuntimePropType = (node: ts.Expression, sourceFile: ts.SourceFile): string | undefined => {
  if (ts.isIdentifier(node)) {
    return readRuntimeConstructorType(node.text);
  }

  if (ts.isArrayLiteralExpression(node)) {
    const types = node.elements
      .filter(ts.isIdentifier)
      .map((element) => readRuntimeConstructorType(element.text) ?? element.text);

    return types.length ? types.join(" | ") : undefined;
  }

  return node.getText(sourceFile);
};

const readRuntimeConstructorType = (name: string): string | undefined => {
  switch (name) {
    case "Boolean":
      return "boolean";
    case "Number":
      return "number";
    case "String":
      return "string";
    case "Array":
      return "unknown[]";
    case "Object":
      return "Record<string, unknown>";
    default:
      return undefined;
  }
};

const readStaticDefaultValue = (node: ts.Expression, sourceFile: ts.SourceFile): string | undefined => {
  if (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  ) {
    return node.getText(sourceFile);
  }

  return undefined;
};

const readStringArrayEntries = (node: ts.Node, sourceFile: ts.SourceFile): NamedMeta[] => {
  if (!ts.isArrayLiteralExpression(node)) {
    return [];
  }

  return node.elements.map((element) => readStaticStringEntry(element, sourceFile)).filter(isNamed);
};

const unwrapExpression = (node: ts.Expression): ts.Expression => {
  if (ts.isParenthesizedExpression(node)) {
    return unwrapExpression(node.expression);
  }

  return node;
};

const readUseRegistrationSymbols = (
  args: ts.NodeArray<ts.Expression>,
  sourceFile: ts.SourceFile
): NamedMeta[] => {
  const firstArg = args[0];

  if (!firstArg) {
    return [];
  }

  const alias = args[1] ? readStaticStringEntry(args[1], sourceFile) : null;

  if (alias) {
    return [alias];
  }

  if (ts.isObjectLiteralExpression(firstArg)) {
    return readObjectProperties(firstArg, sourceFile);
  }

  if (ts.isArrayLiteralExpression(firstArg)) {
    return firstArg.elements.flatMap((element) => {
      if (ts.isIdentifier(element)) {
        return [
          {
            end: element.getEnd(),
            name: element.text,
            start: element.getStart(sourceFile)
          }
        ];
      }

      return [];
    });
  }

  if (ts.isIdentifier(firstArg)) {
    return [
      {
        end: firstArg.getEnd(),
        name: firstArg.text,
        start: firstArg.getStart(sourceFile)
      }
    ];
  }

  return [];
};

const readPropertyName = (name: ts.PropertyName): string[] => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return [name.text];
  }

  return [];
};

const readPropertyNameMeta = (name: ts.PropertyName, sourceFile: ts.SourceFile): NamedMeta[] => {
  if (ts.isIdentifier(name) || ts.isNumericLiteral(name)) {
    return [
      {
        end: name.getEnd(),
        name: name.text,
        start: name.getStart(sourceFile)
      }
    ];
  }

  if (ts.isStringLiteral(name)) {
    return [
      {
        end: Math.max(name.getStart(sourceFile) + 1, name.getEnd() - 1),
        name: name.text,
        start: name.getStart(sourceFile) + 1
      }
    ];
  }

  return [];
};

const appendUnique = (target: string[], values: readonly string[]) => {
  values.forEach((value) => {
    if (!target.includes(value)) {
      target.push(value);
    }
  });
};

const appendRegions = (target: EmbeddedRegion[], values: readonly EmbeddedRegion[]) => {
  values.forEach((value) => {
    if (
      !target.some(
        (item) =>
          item.kind === value.kind &&
          item.contentStart === value.contentStart &&
          item.contentEnd === value.contentEnd
      )
    ) {
      target.push(value);
    }
  });
};

const appendUses = (target: ComponentUseMeta[], values: readonly ComponentUseMeta[]) => {
  values.forEach((value) => {
    if (!target.some((item) => item.localName === value.localName)) {
      target.push(value);
    }
  });
};

const appendPropDetails = (target: ComponentPropMeta[], values: readonly NamedMeta[]) => {
  values.forEach((value) => {
    const existing = target.find((item) => item.name === value.name);

    if (existing) {
      if (value.type) existing.type = value.type;
      if (value.defaultValue) existing.defaultValue = value.defaultValue;
      return;
    }

    target.push({
      defaultValue: value.defaultValue,
      name: value.name,
      type: value.type
    });
  });
};

const appendNamed = (target: NamedMeta[], values: readonly NamedMeta[]) => {
  values.forEach((value) => {
    const existing = target.find((item) => item.name === value.name);

    if (!existing) {
      target.push(value);
      return;
    }

    if (value.type) existing.type = value.type;
    if (value.defaultValue) existing.defaultValue = value.defaultValue;
  });
};

const appendSymbols = (
  target: ComponentSymbolMeta[],
  values: readonly NamedMeta[],
  kind: ComponentSymbolKind
) => {
  values.forEach((value) => {
    if (!target.some((item) => item.kind === kind && item.name === value.name)) {
      target.push({
        ...value,
        kind
      });
    }
  });
};

const isNamed = (value: NamedMeta | null): value is NamedMeta => value !== null;
