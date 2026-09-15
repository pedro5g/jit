import { collectComments, isAllowedComment, isCommentedCode, isTrivialComment } from "../ast/comments.js";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { isTestFile } from "../core/paths.js";

export function commentsGate(context: QualityContext): QualityFinding[] {
  const findings: QualityFinding[] = [];
  for (const comment of collectComments(context)) {
    const changed = context.changedFiles.includes(comment.path);
    const isDocumentation =
      comment.text.startsWith("*") ||
      comment.text.startsWith("@") ||
      (comment.kind === "block" && comment.text.length > 120);
    if (isDocumentation || isAllowedComment(comment.text) || isTestFile(comment.path)) continue;
    if (isCommentedCode(comment.text))
      findings.push(
        commentFinding(
          comment,
          "QG-COMMENT-002",
          "Commented-out code",
          "Delete stale code; use version control for history.",
          changed
        )
      );
    else if (/\bTODO\b/i.test(comment.text) && !/(?:QG-|#\d+|https?:\/\/|owner:|until:)/i.test(comment.text))
      findings.push(
        commentFinding(
          comment,
          "QG-COMMENT-003",
          "TODO has no traceable context",
          "Add an issue/reference, owner or explicit completion condition.",
          changed
        )
      );
    else if (isTrivialComment(comment.text))
      findings.push(
        commentFinding(
          comment,
          "QG-COMMENT-001",
          "Narrative implementation comment",
          "Express the invariant through code/tests or keep only a technical rationale.",
          changed
        )
      );
  }
  return findings;
}

function commentFinding(
  comment: { readonly path: string; readonly line: number; readonly text: string },
  code: string,
  title: string,
  remediation: string,
  changed: boolean
): QualityFinding {
  return finding({
    code,
    gate: "comments",
    severity: changed ? "error" : "warning",
    path: comment.path,
    line: comment.line,
    title,
    message: comment.text,
    remediation,
  });
}
