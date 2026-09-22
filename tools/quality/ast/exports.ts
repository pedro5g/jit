import { readFileSync } from "node:fs";
import ts from "typescript";
import type { QualityContext } from "../core/context.js";
import { toRepoPath } from "../core/paths.js";
import { sourceFile } from "./imports.js";

export interface PublicSymbol {
  readonly name: string;
  readonly path: string;
  readonly line: number;
  readonly kind: string;
  readonly documented: boolean;
  readonly apiPath?: string;
}

export function collectPublicSymbols(context: QualityContext): PublicSymbol[] {
  const result: PublicSymbol[] = [];
  const visited = new Set<string>();
  for (const entry of context.config.publicEntryPoints) collectFromFile(context, entry, visited, result);
  return deduplicateSymbols(result);
}

function collectFromFile(context: QualityContext, file: string, visited: Set<string>, result: PublicSymbol[]): void {
  const source = sourceFile(context, file);
  if (!source || visited.has(source.fileName)) return;
  visited.add(source.fileName);
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (collectReExport(context, source, statement, visited, result)) continue;
      for (const element of statement.exportClause && ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements
        : []) {
        result.push(symbolRecord(context, source, element.name.text, statement, "export"));
      }
      continue;
    }
    if (!hasExportModifier(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name))
          result.push(symbolRecord(context, source, declaration.name.text, statement, "variable"));
    } else if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    ) {
      if (statement.name)
        result.push(symbolRecord(context, source, statement.name.text, statement, ts.SyntaxKind[statement.kind]));
    }
  }
}

function collectReExport(
  context: QualityContext,
  source: ts.SourceFile,
  statement: ts.ExportDeclaration,
  visited: Set<string>,
  result: PublicSymbol[]
): boolean {
  if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) return false;
  const target = ts.resolveModuleName(
    statement.moduleSpecifier.text,
    source.fileName,
    context.tsProgram.getCompilerOptions(),
    ts.sys
  ).resolvedModule?.resolvedFileName;
  if (!target) return false;

  const targetPath = toRepoPath(context.root, target);
  collectFromFile(context, targetPath, visited, result);
  for (const element of statement.exportClause && ts.isNamedExports(statement.exportClause)
    ? statement.exportClause.elements
    : []) {
    const targetName = element.propertyName?.text ?? element.name.text;
    const targetSymbol =
      [...result].reverse().find((symbol) => symbol.path === targetPath && symbol.name === targetName) ??
      [...result].reverse().find((symbol) => symbol.name === targetName);
    result.push({
      name: element.name.text,
      path: targetSymbol?.path ?? targetPath,
      line: targetSymbol?.line ?? source.getLineAndCharacterOfPosition(element.getStart(source)).line + 1,
      kind: "export",
      documented: targetSymbol?.documented ?? false,
      apiPath: element.name.text,
    });
  }
  return true;
}

function symbolRecord(
  context: QualityContext,
  source: ts.SourceFile,
  name: string,
  node: ts.Node,
  kind: string
): PublicSymbol {
  return {
    name,
    path: toRepoPath(context.root, source.fileName),
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    kind,
    documented: hasDocumentation(node, source),
  };
}

function hasDocumentation(node: ts.Node, source: ts.SourceFile): boolean {
  const text = readFileSync(source.fileName, "utf8");
  let candidate: ts.Node | undefined = node;
  for (let depth = 0; candidate && depth < 3; depth += 1) {
    if (
      (ts.getLeadingCommentRanges(text, candidate.getFullStart()) ?? []).some((range) =>
        text.slice(range.pos, range.end).startsWith("/**")
      )
    )
      return true;
    candidate = candidate.parent;
  }

  if (ts.isFunctionDeclaration(node) && node.name) {
    const index = source.statements.indexOf(node);

    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const sibling = source.statements[previous];

      if (!ts.isFunctionDeclaration(sibling) || sibling.name?.text !== node.name.text) break;
      if (
        (ts.getLeadingCommentRanges(text, sibling.getFullStart()) ?? []).some((range) =>
          text.slice(range.pos, range.end).startsWith("/**")
        )
      )
        return true;
    }
  }

  return false;
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false)
  );
}

function deduplicateSymbols(symbols: readonly PublicSymbol[]): PublicSymbol[] {
  const map = new Map<string, PublicSymbol>();
  for (const symbol of symbols) map.set(`${symbol.path}:${symbol.name}`, symbol);
  return [...map.values()].sort((left, right) =>
    [left.path, left.line, left.name].join("\u0000").localeCompare([right.path, right.line, right.name].join("\u0000"))
  );
}
