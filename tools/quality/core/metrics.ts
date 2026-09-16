import { readFileSync } from "node:fs";
import ts from "typescript";
import type { QualityContext } from "./context.js";
import { isProductionTypeScriptFile, isTestFile, toRepoPath } from "./paths.js";

export interface FileMetrics {
  readonly logicalLoc: number;
  readonly exports: number;
  readonly imports: number;
  readonly fanOut: number;
  readonly functions: number;
  readonly maxFunctionLoc: number;
  readonly maxComplexity: number;
  readonly maxNesting: number;
}

export function collectMetrics(context: QualityContext): Record<string, FileMetrics> {
  const result: Record<string, FileMetrics> = {};
  for (const file of context.files) {
    const source = context.tsProgram.getSourceFile(`${context.root}/${file}`) ?? context.tsProgram.getSourceFile(file);
    if (!source) continue;
    result[file] = metricsForSource(context, source);
  }
  return result;
}

function metricsForSource(context: QualityContext, source: ts.SourceFile): FileMetrics {
  const text = readFileSync(source.fileName, "utf8");
  const logicalLoc = text
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.trim() && !line.trim().startsWith("//") && !line.trim().startsWith("/*") && !line.trim().startsWith("*")
    ).length;
  let exports = 0;
  let imports = 0;
  let functions = 0;
  let maxFunctionLoc = 0;
  let maxComplexity = 1;
  let maxNesting = 0;

  function visit(node: ts.Node, nesting: number): void {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) imports += 1;
    if (hasExportModifier(node) || ts.isExportDeclaration(node)) exports += 1;
    const functionLike =
      ts.isFunctionLike(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node);
    if (functionLike) {
      functions += 1;
      const body = "body" in node && node.body && typeof node.body === "object" ? (node.body as ts.Node) : undefined;
      if (body)
        maxFunctionLoc = Math.max(
          maxFunctionLoc,
          source.getLineAndCharacterOfPosition(body.end).line - source.getLineAndCharacterOfPosition(body.pos).line + 1
        );
      maxComplexity = Math.max(maxComplexity, complexityOf(body));
    }
    maxNesting = Math.max(maxNesting, nesting);
    const nextNesting = isNestingNode(node) ? nesting + 1 : nesting;
    ts.forEachChild(node, (child) => visit(child, nextNesting));
  }

  visit(source, 0);
  const isSource = isProductionTypeScriptFile(toRepoPath(context.root, source.fileName));
  return {
    logicalLoc,
    exports,
    imports,
    fanOut: imports,
    functions,
    maxFunctionLoc,
    maxComplexity,
    maxNesting,
    ...(isSource || isTestFile(toRepoPath(context.root, source.fileName)) ? {} : {}),
  };
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false)
  );
}

function isNestingNode(node: ts.Node): boolean {
  return (
    ts.isIfStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isSwitchStatement(node) ||
    ts.isTryStatement(node) ||
    ts.isConditionalExpression(node)
  );
}

function complexityOf(node: ts.Node | undefined): number {
  if (!node) return 1;
  let complexity = 1;
  function visit(child: ts.Node): void {
    if (
      ts.isIfStatement(child) ||
      ts.isForStatement(child) ||
      ts.isForOfStatement(child) ||
      ts.isForInStatement(child) ||
      ts.isWhileStatement(child) ||
      ts.isDoStatement(child) ||
      ts.isCaseClause(child) ||
      ts.isCatchClause(child) ||
      ts.isConditionalExpression(child) ||
      child.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      child.kind === ts.SyntaxKind.BarBarToken ||
      child.kind === ts.SyntaxKind.QuestionQuestionToken
    )
      complexity += 1;
    ts.forEachChild(child, visit);
  }
  ts.forEachChild(node, visit);
  return complexity;
}
