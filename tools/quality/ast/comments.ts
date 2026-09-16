import { readFileSync } from "node:fs";
import ts from "typescript";
import type { QualityContext } from "../core/context.js";
import { toRepoPath } from "../core/paths.js";

export interface CommentRecord {
  readonly path: string;
  readonly line: number;
  readonly text: string;
  readonly kind: "line" | "block";
  readonly nodeKind?: string;
}

export function collectComments(context: QualityContext): CommentRecord[] {
  const result: CommentRecord[] = [];
  for (const file of context.files) {
    const source = context.tsProgram.getSourceFile(`${context.root}/${file}`);
    if (!source) continue;
    const currentSource = source;
    const text = readFileSync(source.fileName, "utf8");
    function visit(node: ts.Node): void {
      for (const range of [
        ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
      ]) {
        const raw = text.slice(range.pos, range.end);
        const value = raw
          .replace(/^\/\/?\s?/, "")
          .replace(/^\/\*\s?/, "")
          .replace(/\s?\*\/$/, "")
          .trim();
        result.push({
          path: toRepoPath(context.root, currentSource.fileName),
          line: currentSource.getLineAndCharacterOfPosition(range.pos).line + 1,
          text: value,
          kind: range.kind === ts.SyntaxKind.SingleLineCommentTrivia ? "line" : "block",
          nodeKind: ts.SyntaxKind[node.kind],
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return deduplicateComments(result);
}

function deduplicateComments(comments: readonly CommentRecord[]): CommentRecord[] {
  const seen = new Set<string>();
  return comments.filter((comment) => {
    const key = `${comment.path}:${comment.line}:${comment.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isAllowedComment(text: string): boolean {
  return (
    /^(?:INVARIANT|PERF|SAFETY|COMPAT|CODEGEN|WORKAROUND):\b/.test(text) ||
    /^@(?:__PURE__|ts-expect-error|ts-ignore|ts-nocheck|deprecated|param|returns|template|example|remarks|see)\b/.test(
      text
    ) ||
    /^(?:Copyright|Licensed)\b/i.test(text)
  );
}

export function isTrivialComment(text: string): boolean {
  return (
    /^(?:increment|decrement|check|loop|return|create|set|get|call|assign|initialize|initialize the|handle)\b/i.test(
      text
    ) && text.length < 80
  );
}

export function isCommentedCode(text: string): boolean {
  const value = text.trim();
  if (/^\*?\s*(?:example|param|returns)\b/i.test(value)) return false;
  return (
    /^(?:if|for|while|switch|catch)\s*\(/.test(value) ||
    /^(?:const|let|var|return|throw|import|export)\b/.test(value) ||
    /^(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(|^(?:[A-Za-z_$][\w$]*)\s*(?:\+\+|--)/.test(value)
  );
}
