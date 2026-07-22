import * as ts from "typescript";
import {
  compileMacroComponent,
  type MacroComponentMetadata,
  type MacroExportedComponentMetadata,
  type MacroLocalComponentMetadata
} from "@elfui/compiler/macro-component";
import { analyzeElfMacroUsage } from "@elfui/compiler/vite";

export type EmbeddedRegionKind = "template" | "style";
export type EmbeddedRegionMethod =
  | "css"
  | "defineHtml"
  | "defineStyle"
  | "globalStyle"
  | "html"
  | "style"
  | "template";

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

const macroRuntimePackages = ["elfui", "@elfui/core"];

export const createEmptyComponentMeta = (id: string): ComponentMeta => ({
  emits: [],
  formControl: false,
  id,
  macro: false,
  name: null,
  props: [],
  propDetails: [],
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

  const ensureComponent = (id: string) => {
    const existing = components.get(id);

    if (existing) {
      return existing;
    }

    const component = createEmptyComponentMeta(id);
    components.set(id, component);

    return component;
  };

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (containsCreateComponentCall(node.initializer)) {
        const component = ensureComponent(node.name.text);
        applyBuilderCallChain(node.initializer, component, sourceFile);
      }

      const standaloneRegion = readStandaloneEmbeddedRegion(
        node.name.text,
        node.initializer,
        sourceFile
      );

      if (standaloneRegion) {
        const component = ensureComponent(
          `standalone:${node.name.text}:${standaloneRegion.contentStart}`
        );

        if (standaloneRegion.kind === "template") {
          component.templates.push(standaloneRegion);
        } else {
          component.styles.push(standaloneRegion);
        }
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = readBuilderReceiverIdentifier(node.expression.expression);

      if (receiver) {
        const component = components.get(receiver);

        if (component) {
          applyBuilderCallChain(node, component, sourceFile);

          return;
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (macroComponent) {
    applyMacroAnalysis(source, sourceFile, components, fileName);
  }

  return {
    components: [...components.values()],
    fileName,
    isMacroComponent: macroComponent
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
) => {
  const templateRegions = [
    ...collectTaggedTemplateRegions(sourceFile, "html", "template"),
    ...collectDefineHtmlRegions(sourceFile)
  ];
  const styleRegions = [
    ...collectTaggedTemplateRegions(sourceFile, "css", "style"),
    ...collectDefineStyleRegions(sourceFile)
  ];
  const typeMembers = collectTopLevelTypeMembers(sourceFile);
  const symbols = collectMacroSymbols(sourceFile, typeMembers);
  const metadata = readMacroMetadata(source, fileName, symbols);
  const componentMetadata = metadata.components.length
    ? metadata.components
    : [
        {
          emitNames: [],
          emitsType: "Record<string, unknown[]>",
          exportName: "default" as const,
          name: "macro-component",
          propNames: [],
          propsType: "Record<string, unknown>",
          slotsType: "Record<string, unknown>"
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
};

const readMacroMetadata = (
  source: string,
  fileName: string,
  symbols: MacroSymbols
): MacroComponentMetadata => {
  try {
    return compileMacroComponent(source, {
      filename: fileName,
      templateTypeCheck: false
    }).metadata;
  } catch {
    return {
      components: [],
      exposed: [],
      filename: fileName,
      localComponents: symbols.uses.map((item) => ({
        constructorType: "unknown",
        emitsType: "Record<string, unknown[]>",
        expression: item.name,
        name: item.name,
        propsType: "Record<string, unknown>",
        slotsType: "Record<string, unknown>"
      }))
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
  component.name = item.name;
  component.exportName = item.exportName;
  if (item.localName) component.localName = item.localName;
  component.propsType = item.propsType;
  component.emitsType = item.emitsType;
  component.slotsType = item.slotsType;

  appendUnique(component.props, [...item.propNames, ...symbols.props.map((prop) => prop.name)]);
  appendPropDetails(component.propDetails, symbols.props);
  appendUnique(component.emits, [...item.emitNames, ...symbols.emits.map((emit) => emit.name)]);
  appendUnique(
    component.slots,
    symbols.slots.map((slot) => slot.name)
  );
  appendUnique(component.setupReturns, [
    ...metadata.exposed,
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

const containsCreateComponentCall = (node: ts.Node): boolean => {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "createComponent"
  ) {
    return true;
  }

  return node.getChildCount() > 0 && node.getChildren().some(containsCreateComponentCall);
};

const applyBuilderCallChain = (
  node: ts.Expression,
  component: MutableComponentMeta,
  sourceFile: ts.SourceFile
) => {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return;
  }

  const receiver = node.expression.expression;

  if (ts.isCallExpression(receiver)) {
    applyBuilderCallChain(receiver, component, sourceFile);
  }

  applyBuilderMethod(node.expression.name.text, node.arguments, node, component, sourceFile);
};

const readBuilderReceiverIdentifier = (node: ts.Expression): string | null => {
  if (ts.isIdentifier(node)) {
    return node.text;
  }

  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    return readBuilderReceiverIdentifier(node.expression.expression);
  }

  return null;
};

const applyBuilderMethod = (
  method: string,
  args: ts.NodeArray<ts.Expression>,
  call: ts.CallExpression,
  component: MutableComponentMeta,
  sourceFile: ts.SourceFile
) => {
  const firstArg = args[0];

  if (method === "name" && firstArg) {
    component.name = readStaticString(firstArg) ?? component.name;
    return;
  }

  if (method === "props" && firstArg) {
    const props = readObjectProperties(firstArg, sourceFile);

    appendUnique(
      component.props,
      props.map((item) => item.name)
    );
    appendPropDetails(component.propDetails, props);
    appendSymbols(component.symbols, props, "prop");

    return;
  }

  if (method === "emits" && firstArg) {
    const arrayEmits = readStringArrayEntries(firstArg, sourceFile);
    const objectEmits = readObjectProperties(firstArg, sourceFile);
    const emits = [...arrayEmits, ...objectEmits];

    appendUnique(
      component.emits,
      emits.map((item) => item.name)
    );
    appendSymbols(component.symbols, emits, "emit");

    return;
  }

  if (method === "setup" && firstArg) {
    const setupReturns = readSetupReturnSymbols(firstArg, sourceFile);

    appendUnique(
      component.setupReturns,
      setupReturns.map((item) => item.name)
    );
    appendSymbols(component.symbols, setupReturns, "setup");

    return;
  }

  if ((method === "state" || method === "events") && firstArg) {
    const names = readObjectLikeEntries(firstArg, sourceFile);

    appendUnique(
      component.setupReturns,
      names.map((item) => item.name)
    );
    appendSymbols(component.symbols, names, "setup");

    return;
  }

  if (method === "use" && firstArg) {
    appendUses(component.uses, readUseRegistrations(args, sourceFile));
    appendSymbols(component.symbols, readUseRegistrationSymbols(args, sourceFile), "component");

    return;
  }

  if (method === "slot" && firstArg) {
    const slot = readStaticStringEntry(firstArg, sourceFile);

    appendUnique(component.slots, [slot?.name].filter(isString));

    if (slot) {
      appendSymbols(component.symbols, [slot], "slot");
    }

    return;
  }

  if (method === "slots" && firstArg) {
    const slots = readObjectProperties(firstArg, sourceFile);

    appendUnique(
      component.slots,
      slots.map((item) => item.name)
    );
    appendSymbols(component.symbols, slots, "slot");

    return;
  }

  if (method === "formControl") {
    component.formControl = true;
    return;
  }

  if ((method === "template" || method === "style" || method === "globalStyle") && firstArg) {
    const region = readEmbeddedRegion(method, firstArg, call, sourceFile);

    if (!region) {
      return;
    }

    if (method === "template") {
      component.templates.push(region);
    } else {
      component.styles.push(region);
    }
  }
};

const readEmbeddedRegion = (
  method: "template" | "style" | "globalStyle",
  node: ts.Expression,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile
): EmbeddedRegion | null => {
  const embeddedString = readEmbeddedString(node, sourceFile);

  if (embeddedString === null) {
    return null;
  }

  return {
    content: embeddedString.content,
    contentEnd: embeddedString.contentEnd,
    contentStart: embeddedString.contentStart,
    end: call.getEnd(),
    kind: method === "template" ? "template" : "style",
    languageId: method === "template" ? "html" : "css",
    method,
    start: call.getStart(sourceFile)
  };
};

const readStandaloneEmbeddedRegion = (
  name: string,
  node: ts.Expression,
  sourceFile: ts.SourceFile
): EmbeddedRegion | null => {
  const method = inferStandaloneEmbeddedMethod(name);

  if (!method) {
    return null;
  }

  const embeddedString = readEmbeddedString(node, sourceFile);

  if (!embeddedString) {
    return null;
  }

  return {
    content: embeddedString.content,
    contentEnd: embeddedString.contentEnd,
    contentStart: embeddedString.contentStart,
    end: node.getEnd(),
    kind: method === "template" ? "template" : "style",
    languageId: method === "template" ? "html" : "css",
    method,
    start: node.getStart(sourceFile)
  };
};

const inferStandaloneEmbeddedMethod = (name: string): "template" | "style" | null => {
  const normalized = name.toLowerCase();

  if (normalized === "css" || normalized === "style" || normalized.endsWith("style")) {
    return "style";
  }

  if (
    normalized === "str" ||
    normalized === "html" ||
    normalized === "template" ||
    normalized.endsWith("template")
  ) {
    return "template";
  }

  return null;
};

const collectTaggedTemplateRegions = (
  sourceFile: ts.SourceFile,
  tagName: "css" | "html",
  kind: EmbeddedRegionKind
): EmbeddedRegion[] => {
  const regions: EmbeddedRegion[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isIdentifier(node.tag) &&
      node.tag.text === tagName
    ) {
      const embeddedString = readEmbeddedString(node.template, sourceFile);

      if (embeddedString) {
        regions.push({
          content: embeddedString.content,
          contentEnd: embeddedString.contentEnd,
          contentStart: embeddedString.contentStart,
          end: node.getEnd(),
          kind,
          languageId: kind === "template" ? "html" : "css",
          method: tagName,
          start: node.getStart(sourceFile)
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return regions;
};

const collectDefineStyleRegions = (sourceFile: ts.SourceFile): EmbeddedRegion[] => {
  const regions: EmbeddedRegion[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = callExpressionName(node);

      if (name === "defineStyle" || name === "globalStyle") {
        const args = name === "defineStyle" ? node.arguments : node.arguments.slice(0, 1);
        for (const arg of args) {
          const embeddedString = readEmbeddedString(arg, sourceFile);
          if (!embeddedString) continue;
          regions.push({
            content: embeddedString.content,
            contentEnd: embeddedString.contentEnd,
            contentStart: embeddedString.contentStart,
            end: node.getEnd(),
            kind: "style",
            languageId: "css",
            method: name === "globalStyle" ? "globalStyle" : "defineStyle",
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

const readObjectLikeEntries = (node: ts.Node, sourceFile: ts.SourceFile): NamedMeta[] => {
  if (ts.isObjectLiteralExpression(node)) {
    return readObjectProperties(node, sourceFile);
  }

  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const expressionBody = ts.isBlock(node.body) ? null : unwrapExpression(node.body);

    if (expressionBody && ts.isObjectLiteralExpression(expressionBody)) {
      return readObjectProperties(expressionBody, sourceFile);
    }

    if (ts.isBlock(node.body)) {
      return node.body.statements.flatMap((statement) =>
        ts.isReturnStatement(statement) && statement.expression
          ? readObjectProperties(statement.expression, sourceFile)
          : []
      );
    }
  }

  return [];
};

const readObjectPropertyNames = (node: ts.Node): string[] => {
  if (!ts.isObjectLiteralExpression(node)) {
    return [];
  }

  return node.properties.flatMap((property) => {
    if (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) {
      return readPropertyName(property.name);
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      return property.name.text;
    }

    return [];
  });
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

const readSetupReturnSymbols = (node: ts.Node, sourceFile: ts.SourceFile): NamedMeta[] => {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
    return [];
  }

  const expressionBody = ts.isBlock(node.body) ? null : unwrapExpression(node.body);

  if (expressionBody && ts.isObjectLiteralExpression(expressionBody)) {
    return readObjectProperties(expressionBody, sourceFile);
  }

  if (ts.isBlock(node.body)) {
    const names: NamedMeta[] = [];

    node.body.statements.forEach((statement) => {
      if (ts.isReturnStatement(statement) && statement.expression) {
        appendNamed(names, readObjectProperties(statement.expression, sourceFile));
      }
    });

    return names;
  }

  return [];
};

const unwrapExpression = (node: ts.Expression): ts.Expression => {
  if (ts.isParenthesizedExpression(node)) {
    return unwrapExpression(node.expression);
  }

  return node;
};

const readUseRegistrations = (
  args: ts.NodeArray<ts.Expression>,
  sourceFile: ts.SourceFile
): ComponentUseMeta[] => {
  const firstArg = args[0];

  if (!firstArg) {
    return [];
  }

  const alias = args[1] ? readStaticString(args[1]) : null;

  if (alias) {
    return [
      {
        expression: firstArg.getText(sourceFile),
        localName: alias,
        source: "alias"
      }
    ];
  }

  if (ts.isObjectLiteralExpression(firstArg)) {
    return readUseObjectRegistrations(firstArg, sourceFile);
  }

  if (ts.isArrayLiteralExpression(firstArg)) {
    return firstArg.elements.flatMap((element) => {
      if (ts.isIdentifier(element)) {
        return [
          {
            expression: element.text,
            localName: element.text,
            source: "array" as const
          }
        ];
      }

      return [];
    });
  }

  if (ts.isIdentifier(firstArg)) {
    return [{ expression: firstArg.text, localName: firstArg.text, source: "array" }];
  }

  return [];
};

const readUseObjectRegistrations = (
  node: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile
): ComponentUseMeta[] =>
  node.properties.flatMap((property) => {
    if (ts.isPropertyAssignment(property)) {
      return readPropertyName(property.name).map((localName) => ({
        expression: property.initializer.getText(sourceFile),
        localName,
        source: "object" as const
      }));
    }

    if (ts.isMethodDeclaration(property)) {
      return readPropertyName(property.name).map((localName) => ({
        localName,
        source: "object" as const
      }));
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      return [
        {
          expression: property.name.text,
          localName: property.name.text,
          source: "object" as const
        }
      ];
    }

    return [];
  });

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

const isString = (value: string | null | undefined): value is string => typeof value === "string";

const isNamed = (value: NamedMeta | null): value is NamedMeta => value !== null;
