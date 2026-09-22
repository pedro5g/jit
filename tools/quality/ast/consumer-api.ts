import { readFileSync } from "node:fs";
import ts from "typescript";
import type { QualityContext } from "../core/context.js";
import { toRepoPath } from "../core/paths.js";
import type { PublicSymbol } from "./exports.js";
import { sourceFile } from "./imports.js";

/** One callable, namespace, static member, or fluent return member visible to consumers. */
export interface ConsumerVisibleApiSymbol extends PublicSymbol {
  readonly apiPath: string;
}

interface ApiWalkState {
  readonly result: ConsumerVisibleApiSymbol[];
  readonly seenPaths: Set<string>;
  readonly expandedDeclarations: Set<string>;
}

const SKIPPED_FUNCTION_MEMBERS = new Set([
  "arguments",
  "apply",
  "bind",
  "call",
  "caller",
  "constructor",
  "length",
  "name",
  "prototype",
  "toString",
]);

/**
 * Follows the published TypeScript surface through namespace properties and
 * callable return types. It asks the checker for documentation, matching what
 * an installed consumer sees in editor hover text.
 */
export function collectConsumerVisibleApi(context: QualityContext): readonly ConsumerVisibleApiSymbol[] {
  const checker = context.tsProgram.getTypeChecker();
  const state: ApiWalkState = { result: [], seenPaths: new Set<string>(), expandedDeclarations: new Set<string>() };

  for (const entryPoint of context.config.publicEntryPoints) {
    const source = sourceFile(context, entryPoint);
    if (!source) continue;
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      visitSymbol(context, checker, state, resolveAlias(checker, exported), exported.name, 0);
    }
  }

  return state.result.sort((left, right) => left.apiPath.localeCompare(right.apiPath));
}

function visitSymbol(
  context: QualityContext,
  checker: ts.TypeChecker,
  state: ApiWalkState,
  symbol: ts.Symbol,
  apiPath: string,
  depth: number
): void {
  if (state.result.length >= 10_000) return;
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (!declaration || !isRepositoryDeclaration(context, declaration)) return;
  const declarationKey = `${declaration.getSourceFile().fileName}:${declaration.getStart()}`;
  const pathKey = `${apiPath}|${declarationKey}`;
  if (state.seenPaths.has(pathKey)) return;
  state.seenPaths.add(pathKey);
  state.result.push({
    name: symbol.name,
    apiPath,
    path: toRepoPath(context.root, declaration.getSourceFile().fileName),
    line: declaration.getSourceFile().getLineAndCharacterOfPosition(declaration.getStart()).line + 1,
    kind: symbol.flags & ts.SymbolFlags.Namespace ? "namespace" : "member",
    documented: hasCheckerDocumentation(symbol, checker) || hasSourceDocumentation(declaration),
  });
  if (depth >= 3 || state.expandedDeclarations.has(declarationKey)) return;
  state.expandedDeclarations.add(declarationKey);

  expandSymbol(context, checker, state, symbol, declaration, apiPath, depth);
}

function expandSymbol(
  context: QualityContext,
  checker: ts.TypeChecker,
  state: ApiWalkState,
  symbol: ts.Symbol,
  declaration: ts.Declaration,
  apiPath: string,
  depth: number
): void {
  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  const signatures = type.getCallSignatures();
  if (!shouldExpandSymbol(symbol, signatures, depth)) return;
  visitProperties(context, checker, state, type.getProperties(), apiPath, depth);
  const signature = signatures[0];
  if (signature && depth <= 1) visitType(context, checker, state, signature.getReturnType(), apiPath, depth + 1);
}

function shouldExpandSymbol(symbol: ts.Symbol, signatures: readonly ts.Signature[], depth: number): boolean {
  return depth === 0 || signatures.length > 0 || (symbol.flags & ts.SymbolFlags.Namespace) !== 0;
}

function visitProperties(
  context: QualityContext,
  checker: ts.TypeChecker,
  state: ApiWalkState,
  properties: readonly ts.Symbol[],
  apiPath: string,
  depth: number
): void {
  for (const property of properties) {
    if (SKIPPED_FUNCTION_MEMBERS.has(property.name)) continue;
    visitSymbol(context, checker, state, property, `${apiPath}.${property.name}`, depth + 1);
  }
}

function visitType(
  context: QualityContext,
  checker: ts.TypeChecker,
  state: ApiWalkState,
  type: ts.Type,
  apiPath: string,
  depth: number
): void {
  if (depth > 3 || !isExpandableType(type)) return;
  for (const property of type.getProperties()) {
    if (SKIPPED_FUNCTION_MEMBERS.has(property.name)) continue;
    visitSymbol(context, checker, state, property, `${apiPath}.${property.name}`, depth);
  }
}

function isRepositoryDeclaration(context: QualityContext, node: ts.Node): boolean {
  const path = toRepoPath(context.root, node.getSourceFile().fileName);
  return !path.startsWith("node_modules/") && !path.startsWith("dist/") && !path.startsWith(".quality/");
}

function isExpandableType(type: ts.Type): boolean {
  return (
    (type.flags &
      (ts.TypeFlags.Any |
        ts.TypeFlags.Unknown |
        ts.TypeFlags.Never |
        ts.TypeFlags.Void |
        ts.TypeFlags.Undefined |
        ts.TypeFlags.Null |
        ts.TypeFlags.StringLike |
        ts.TypeFlags.NumberLike |
        ts.TypeFlags.BooleanLike |
        ts.TypeFlags.ESSymbolLike |
        ts.TypeFlags.BigIntLike)) ===
    0
  );
}

function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function hasCheckerDocumentation(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  return ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim().length > 0;
}

function hasSourceDocumentation(node: ts.Node): boolean {
  const source = node.getSourceFile();
  const text = readFileSync(source.fileName, "utf8");
  return (ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []).some((range) =>
    text.slice(range.pos, range.end).startsWith("/**")
  );
}
