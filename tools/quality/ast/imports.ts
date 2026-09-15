import { resolve } from "node:path";
import ts from "typescript";
import type { QualityContext } from "../core/context.js";
import { toRepoPath } from "../core/paths.js";

export interface ImportEdge {
  readonly from: string;
  readonly to: string;
  readonly specifier: string;
  readonly line: number;
  readonly typeOnly: boolean;
}

export function collectImportEdges(context: QualityContext): ImportEdge[] {
  const edges: ImportEdge[] = [];
  for (const file of context.files) {
    const source = sourceFile(context, file);
    if (!source) continue;
    const currentSource = source;
    const from = toRepoPath(context.root, currentSource.fileName);
    function visit(node: ts.Node): void {
      const imported = moduleSpecifier(node);
      if (imported) {
        const { specifier, typeOnly } = imported;
        const target = resolveTarget(context, currentSource, specifier);
        if (target) {
          const line = currentSource.getLineAndCharacterOfPosition(node.getStart(currentSource)).line + 1;
          edges.push({ from, to: toRepoPath(context.root, target), specifier, line, typeOnly });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return edges.sort((left, right) =>
    [left.from, left.to, left.line, left.specifier]
      .join("\u0000")
      .localeCompare([right.from, right.to, right.line, right.specifier].join("\u0000"))
  );
}

export function sourceFile(context: QualityContext, file: string): ts.SourceFile | undefined {
  return context.tsProgram.getSourceFile(resolve(context.root, file));
}

function moduleSpecifier(node: ts.Node): { readonly specifier: string; readonly typeOnly: boolean } | undefined {
  if (ts.isImportDeclaration(node)) {
    return node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
      ? { specifier: node.moduleSpecifier.text, typeOnly: node.importClause?.isTypeOnly ?? false }
      : undefined;
  }
  if (ts.isExportDeclaration(node)) {
    return node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
      ? { specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly }
      : undefined;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    ts.isStringLiteral(node.moduleReference.expression)
  )
    return { specifier: node.moduleReference.expression.text, typeOnly: false };
  return undefined;
}

function resolveTarget(context: QualityContext, source: ts.SourceFile, specifier: string): string | undefined {
  const result = ts.resolveModuleName(
    specifier,
    source.fileName,
    context.tsProgram.getCompilerOptions(),
    ts.sys
  ).resolvedModule;
  if (!result || result.isExternalLibraryImport) return undefined;
  return result.resolvedFileName;
}
