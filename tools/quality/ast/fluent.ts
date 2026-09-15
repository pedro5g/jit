import ts from "typescript";
import type { QualityContext } from "../core/context.js";
import { isTestFile, toRepoPath } from "../core/paths.js";

export interface FluentOperation {
  readonly name: string;
  readonly path: string;
  readonly line: number;
  readonly family: string;
  readonly signature: string;
}

const EXCLUDED_NAMES = new Set(["constructor", "then", "catch", "finally", "toString", "valueOf"]);

export function collectFluentOperations(context: QualityContext): FluentOperation[] {
  const result: FluentOperation[] = [];
  for (const file of context.files) {
    if (
      isTestFile(file) ||
      (!file.startsWith("packages/jit/src/core/builder/") &&
        !file.startsWith("packages/jit/src/factories/") &&
        !file.startsWith("packages/jit/src/classes/"))
    )
      continue;
    const source = context.tsProgram.getSourceFile(`${context.root}/${file}`);
    if (!source) continue;
    const currentSource = source;
    function visit(node: ts.Node): void {
      if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
        const name = node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
        if (name && !EXCLUDED_NAMES.has(name) && isFluentCandidate(node, currentSource)) {
          result.push({
            name,
            path: toRepoPath(context.root, currentSource.fileName),
            line: currentSource.getLineAndCharacterOfPosition(node.getStart(currentSource)).line + 1,
            family: familyForPath(file),
            signature: node.getText(currentSource).replace(/\s+/g, " ").slice(0, 240),
          });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const map = new Map<string, FluentOperation>();
  for (const item of result) map.set(`${item.name}:${item.family}`, item);
  return [...map.values()].sort((left, right) =>
    [left.family, left.name].join("\u0000").localeCompare([right.family, right.name].join("\u0000"))
  );
}

function isFluentCandidate(node: ts.Node, source: ts.SourceFile): boolean {
  const text = node.getText(source);
  return (
    /Builder|Plan|Artifact|Chain|Schema|RuntimeClass|Factory/.test(text) || source.fileName.includes("core/builder")
  );
}

function familyForPath(file: string): string {
  if (file.includes("core/builder")) return "builder";
  if (file.includes("factories/class") || file.includes("classes/")) return "class";
  if (file.includes("factories/cqrs") || file.includes("factories/query")) return "cqrs";
  if (file.includes("factories/ddd")) return "ddd";
  return "factory";
}
