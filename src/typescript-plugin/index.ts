import type * as ts from "typescript";

interface TypeScriptServerPluginModules {
  typescript: typeof ts;
}

interface TypeScriptServerPluginCreateInfo {
  config?: {
    suppressNativeTemplateLocals?: unknown;
  };
  languageService: ts.LanguageService;
}

const cannotFindNameCode = 2304;
const cannotFindNameSuggestionCode = 2552;

interface HtmlTemplateExpressionContext {
  contentEnd: number;
  contentStart: number;
}

interface TemplateTag {
  closing: boolean;
  end: number;
  name: string;
  selfClosing: boolean;
  start: number;
}

interface TemplateLocalScope {
  end: number;
  names: string[];
  start: number;
}

const init = (modules: TypeScriptServerPluginModules) => {
  const tsModule = modules.typescript;
  let configuration: { suppressNativeTemplateLocals: boolean } = {
    suppressNativeTemplateLocals: true
  };

  return {
    create(info: TypeScriptServerPluginCreateInfo): ts.LanguageService {
      configuration = readPluginConfiguration(info.config);
      const proxy = createLanguageServiceProxy(info.languageService);
      const getSemanticDiagnostics = info.languageService.getSemanticDiagnostics.bind(
        info.languageService
      );

      proxy.getSemanticDiagnostics = (fileName) => {
        const diagnostics = getSemanticDiagnostics(fileName);
        const sourceFile = info.languageService.getProgram()?.getSourceFile(fileName);

        if (!sourceFile || !configuration.suppressNativeTemplateLocals) {
          return diagnostics;
        }

        const templatePropNames = collectDeclaredTemplatePropNames(tsModule, sourceFile);

        return diagnostics.filter(
          (diagnostic) =>
            !isElfTemplateLocalDiagnostic(tsModule, sourceFile, templatePropNames, diagnostic)
        );
      };

      return proxy;
    },
    onConfigurationChanged(nextConfiguration: unknown) {
      configuration = readPluginConfiguration(nextConfiguration);
    },
  };
};

const createLanguageServiceProxy = (languageService: ts.LanguageService): ts.LanguageService => {
  const proxy = Object.create(null) as ts.LanguageService;

  for (const key of Object.keys(languageService) as Array<keyof ts.LanguageService>) {
    const value = languageService[key];

    (proxy as unknown as Record<keyof ts.LanguageService, unknown>)[key] =
      typeof value === "function" ? value.bind(languageService) : value;
  }

  return proxy;
};

const readPluginConfiguration = (
  value: unknown,
): { suppressNativeTemplateLocals: boolean } => {
  if (typeof value !== "object" || value === null) {
    return { suppressNativeTemplateLocals: true };
  }

  const suppressNativeTemplateLocals =
    (value as { suppressNativeTemplateLocals?: unknown }).suppressNativeTemplateLocals;

  return {
    suppressNativeTemplateLocals:
      suppressNativeTemplateLocals === undefined ? true : suppressNativeTemplateLocals === true,
  };
};

const isElfTemplateLocalDiagnostic = (
  tsModule: typeof ts,
  sourceFile: ts.SourceFile,
  templatePropNames: Set<string>,
  diagnostic: ts.Diagnostic
): boolean => {
  if (!isMissingNameDiagnostic(diagnostic.code) || diagnostic.start === undefined) {
    return false;
  }

  const localName = readDiagnosticIdentifier(sourceFile.text, diagnostic);

  if (!localName) {
    return false;
  }

  const templateContext = findHtmlTemplateExpressionContext(
    tsModule,
    sourceFile,
    diagnostic.start
  );

  if (!templateContext) {
    return false;
  }

  if (
    localName === "$event" &&
    isEventBindingTemplateExpression(sourceFile.text, diagnostic.start, templateContext.contentStart)
  ) {
    return true;
  }

  if (templatePropNames.has(localName)) {
    return true;
  }

  const templateContent = sourceFile.text.slice(
    templateContext.contentStart,
    templateContext.contentEnd,
  );
  const diagnosticOffset = diagnostic.start - templateContext.contentStart;

  return hasActiveTemplateLocal(tsModule, templateContent, diagnosticOffset, localName);
};

const collectDeclaredTemplatePropNames = (
  tsModule: typeof ts,
  sourceFile: ts.SourceFile
): Set<string> => {
  const names = new Set<string>();

  const visit = (node: ts.Node) => {
    if (
      tsModule.isCallExpression(node) &&
      tsModule.isIdentifier(node.expression) &&
      node.expression.text === "defineProps"
    ) {
      const options = node.arguments[0];

      if (options && tsModule.isObjectLiteralExpression(options)) {
        options.properties.forEach((property) => {
          const name = readPropertyName(tsModule, property.name);

          if (name) {
            names.add(name);
          }
        });
      }

      const typeArgument = node.typeArguments?.[0];

      if (typeArgument && tsModule.isTypeLiteralNode(typeArgument)) {
        typeArgument.members.forEach((member) => {
          const name = readPropertyName(tsModule, member.name);

          if (name) {
            names.add(name);
          }
        });
      }
    }

    tsModule.forEachChild(node, visit);
  };

  visit(sourceFile);

  return names;
};

const readPropertyName = (tsModule: typeof ts, name: ts.PropertyName | undefined): string | null => {
  if (!name) {
    return null;
  }

  if (tsModule.isIdentifier(name) || tsModule.isStringLiteral(name) || tsModule.isNumericLiteral(name)) {
    return name.text;
  }

  return null;
};

const isMissingNameDiagnostic = (code: number): boolean =>
  code === cannotFindNameCode || code === cannotFindNameSuggestionCode;

const readDiagnosticIdentifier = (
  source: string,
  diagnostic: ts.Diagnostic
): string | null => {
  const start = diagnostic.start ?? -1;
  const length = diagnostic.length ?? 0;
  const text = start >= 0 && length > 0 ? source.slice(start, start + length) : "";

  if (isIdentifierText(text)) {
    return text;
  }

  const message =
    typeof diagnostic.messageText === "string" ? diagnostic.messageText : undefined;
  const match = message ? /Cannot find name '([^']+)'/.exec(message) : null;

  return match?.[1] && isIdentifierText(match[1]) ? match[1] : null;
};

const findHtmlTemplateExpressionContext = (
  tsModule: typeof ts,
  sourceFile: ts.SourceFile,
  offset: number
): HtmlTemplateExpressionContext | null => {
  let result: HtmlTemplateExpressionContext | null = null;

  const visit = (node: ts.Node) => {
    if (result) {
      return;
    }

    const template = readDefineHtmlTemplate(tsModule, node);

    if (template) {
      for (const span of template.templateSpans) {
        if (offset >= span.expression.getStart(sourceFile) && offset < span.expression.getEnd()) {
          result = {
            contentEnd: template.getEnd() - 1,
            contentStart: template.getStart(sourceFile) + 1
          };
          return;
        }
      }
    }

    tsModule.forEachChild(node, visit);
  };

  visit(sourceFile);

  return result;
};

const readDefineHtmlTemplate = (
  tsModule: typeof ts,
  node: ts.Node
): ts.TemplateExpression | null => {
  if (
    !tsModule.isCallExpression(node) ||
    !tsModule.isIdentifier(node.expression) ||
    node.expression.text !== "defineHtml"
  ) {
    return null;
  }

  const template = node.arguments[0];
  return template && tsModule.isTemplateExpression(template) ? template : null;
};

const isEventBindingTemplateExpression = (
  source: string,
  diagnosticStart: number,
  contentStart: number
): boolean => {
  const expressionStart = source.lastIndexOf("${", diagnosticStart);

  if (expressionStart < contentStart) {
    return false;
  }

  let cursor = expressionStart - 1;

  while (cursor >= contentStart && /[ \t\r\n]/.test(source[cursor] ?? "")) {
    cursor -= 1;
  }

  if (source[cursor] !== "=") {
    return false;
  }

  cursor -= 1;

  while (cursor >= contentStart && /[ \t\r\n]/.test(source[cursor] ?? "")) {
    cursor -= 1;
  }

  const attributeEnd = cursor + 1;

  while (cursor >= contentStart && /[^\s<>=]/.test(source[cursor] ?? "")) {
    cursor -= 1;
  }

  const attributeName = source.slice(cursor + 1, attributeEnd);

  return attributeName.startsWith("@") || attributeName.startsWith("v-on:");
};

const hasActiveTemplateLocal = (
  tsModule: typeof ts,
  templateContent: string,
  diagnosticOffset: number,
  localName: string
): boolean => {
  return collectTemplateLocalScopes(tsModule, templateContent).some(
    (scope) =>
      diagnosticOffset >= scope.start &&
      diagnosticOffset < scope.end &&
      scope.names.includes(localName),
  );
};

const collectTemplateLocalScopes = (
  tsModule: typeof ts,
  templateContent: string,
): TemplateLocalScope[] => {
  const tags = collectTemplateTags(templateContent);
  const scopes: TemplateLocalScope[] = [];
  const declarations = [
    {
      pattern: /\sv-for\s*=\s*(["'])([\s\S]*?)\1/g,
      readLocalPart: readForLocalPart,
    },
    {
      pattern: /\s(?:#[\w-]*|v-slot(?::[\w-]+)?)\s*=\s*(["'])([\s\S]*?)\1/g,
      readLocalPart: (value: string) => value.trim() || null,
    },
  ];

  for (const declaration of declarations) {
    for (const match of templateContent.matchAll(declaration.pattern)) {
      if (match.index === undefined || !match[2]) {
        continue;
      }

      const owner = tags.find(
        (tag) =>
          !tag.closing &&
          tag.start <= match.index! &&
          match.index! < tag.end,
      );
      const localPart = declaration.readLocalPart(match[2]);

      if (!owner || !localPart) {
        continue;
      }

      const names = readTemplateLocalDeclarations(tsModule, localPart);

      if (names.length === 0) {
        continue;
      }

      scopes.push({
        end: readTemplateScopeEnd(tags, owner, templateContent.length),
        names,
        start: owner.start,
      });
    }
  }

  return scopes;
};

const collectTemplateTags = (templateContent: string): TemplateTag[] => {
  const tags: TemplateTag[] = [];
  let cursor = 0;

  while (cursor < templateContent.length) {
    if (templateContent.startsWith("${", cursor)) {
      const expressionEnd = findTemplateExpressionEnd(templateContent, cursor);
      cursor = expressionEnd === null ? cursor + 2 : expressionEnd + 1;
      continue;
    }

    if (templateContent.startsWith("<!--", cursor)) {
      const commentEnd = templateContent.indexOf("-->", cursor + 4);
      cursor = commentEnd === -1 ? templateContent.length : commentEnd + 3;
      continue;
    }

    if (templateContent[cursor] !== "<") {
      cursor += 1;
      continue;
    }

    const tag = readTemplateTag(templateContent, cursor);

    if (!tag) {
      cursor += 1;
      continue;
    }

    tags.push(tag);
    cursor = tag.end;
  }

  return tags;
};

const readTemplateTag = (source: string, start: number): TemplateTag | null => {
  const header = /^<\s*(\/)?\s*([A-Za-z][\w-]*)\b/.exec(source.slice(start));

  if (!header?.[2]) {
    return null;
  }

  const end = findTemplateTagEnd(source, start);

  if (end === null) {
    return null;
  }

  return {
    closing: header[1] === "/",
    end,
    name: header[2].toLowerCase(),
    selfClosing: /\/\s*>$/.test(source.slice(start, end)),
    start,
  };
};

const findTemplateTagEnd = (source: string, start: number): number | null => {
  let quote: '"' | "'" | null = null;
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

    if (source.startsWith("${", index)) {
      const expressionEnd = findTemplateExpressionEnd(source, index);
      index = expressionEnd ?? index + 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === ">") {
      return index + 1;
    }
  }

  return null;
};

const readTemplateScopeEnd = (
  tags: TemplateTag[],
  owner: TemplateTag,
  fallback: number,
): number => {
  if (owner.selfClosing) {
    return owner.end;
  }

  let depth = 1;

  for (const tag of tags) {
    if (tag.start <= owner.start || tag.name !== owner.name) {
      continue;
    }

    if (tag.closing) {
      depth -= 1;

      if (depth === 0) {
        return tag.end;
      }

      continue;
    }

    if (!tag.selfClosing) {
      depth += 1;
    }
  }

  return fallback;
};

const readForLocalPart = (expression: string): string | null => {
  const match = /^([\s\S]+?)\s+in\s+[\s\S]+$/.exec(expression.trim());

  return match?.[1]?.trim() || null;
};

const readTemplateLocalDeclarations = (
  tsModule: typeof ts,
  localPart: string
): string[] => {
  const parameters = parseTemplateBindingParameters(tsModule, localPart);

  return parameters.flatMap((parameter) => readBindingNames(tsModule, parameter.name));
};

const parseTemplateBindingParameters = (
  tsModule: typeof ts,
  localPart: string
): ts.ParameterDeclaration[] => {
  const trimmed = localPart.trim();
  const parameterText = trimmed.startsWith("(") ? trimmed : `(${trimmed})`;
  const sourceFile = tsModule.createSourceFile(
    "elf-v-for-local.ts",
    `${parameterText} => null;`,
    tsModule.ScriptTarget.Latest,
    true,
    tsModule.ScriptKind.TS
  );
  const statement = sourceFile.statements[0];

  if (
    !statement ||
    !tsModule.isExpressionStatement(statement) ||
    !tsModule.isArrowFunction(statement.expression)
  ) {
    return [];
  }

  return [...statement.expression.parameters];
};

const readBindingNames = (tsModule: typeof ts, name: ts.BindingName): string[] => {
  if (tsModule.isIdentifier(name)) {
    return [name.text];
  }

  if (tsModule.isObjectBindingPattern(name)) {
    return name.elements.flatMap((element) => readBindingNames(tsModule, element.name));
  }

  return name.elements.flatMap((element) =>
    tsModule.isBindingElement(element) ? readBindingNames(tsModule, element.name) : []
  );
};

const findTemplateExpressionEnd = (source: string, start: number): number | null => {
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

const isIdentifierText = (text: string): boolean => /^[A-Za-z_$][\w$]*$/.test(text);

export default init;
