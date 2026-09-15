import { collectPublicSymbols } from "../ast/exports.js";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";

export function publicApiGate(context: QualityContext): QualityFinding[] {
  return collectPublicSymbols(context)
    .filter((symbol) => !symbol.documented)
    .map((symbol) =>
      finding({
        code: "QG-DOC-001",
        gate: "public-api",
        severity: changedSymbol(context, symbol) ? "error" : "warning",
        path: symbol.path,
        line: symbol.line,
        title: "Public export lacks contract documentation",
        message: `${symbol.kind} ${symbol.name} is exported from a public entrypoint without JSDoc.`,
        remediation:
          "Document semantics, restrictions, effects, errors, repeatability and compatibility where relevant.",
      })
    );
}

function changedSymbol(context: QualityContext, symbol: { readonly path: string; readonly line: number }): boolean {
  return (context.changedRanges.get(symbol.path) ?? []).some(
    (range) => symbol.line >= range.start && symbol.line <= range.end
  );
}
