import { collectConsumerVisibleApi } from "../ast/consumer-api.js";
import { collectPublicSymbols } from "../ast/exports.js";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";

export function publicApiGate(context: QualityContext): QualityFinding[] {
  const topLevel = collectPublicSymbols(context)
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
  const members = collectConsumerVisibleApi(context)
    .filter((symbol) => !symbol.documented && symbol.apiPath.includes("."))
    .map((symbol) =>
      finding({
        code: "QG-DOC-002",
        gate: "public-api",
        severity: changedSymbol(context, symbol) ? "error" : "warning",
        path: symbol.path,
        line: symbol.line,
        title: "Consumer-visible member lacks useful JSDoc",
        message: `${symbol.apiPath} is visible through a public entrypoint without documentation in the published type surface.`,
        remediation: "Document the member where its consumer-facing type is declared, then verify the built .d.ts.",
      })
    );
  return [...topLevel, ...members];
}

function changedSymbol(context: QualityContext, symbol: { readonly path: string; readonly line: number }): boolean {
  return (context.changedRanges.get(symbol.path) ?? []).some(
    (range) => symbol.line >= range.start && symbol.line <= range.end
  );
}
