import { collectImportEdges } from "../ast/imports.js";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { isTestFile } from "../core/paths.js";

export function architectureGate(context: QualityContext): QualityFinding[] {
  const edges = collectImportEdges(context);
  const findings: QualityFinding[] = [];
  const adjacency = new Map<string, string[]>();
  const changed = new Set(context.changedFiles);

  for (const edge of edges) {
    const fromLayer = layerFor(context, edge.from);
    const toLayer = layerFor(context, edge.to);
    const internalPackageImport =
      edge.from.startsWith("packages/jit/src/") && /^@jit-compiler\/jit(?:\/|$)/.test(edge.specifier);
    if (internalPackageImport && !isTestFile(edge.from))
      findings.push(
        architectureFinding(
          edge,
          "QG-ARCH-002",
          "Internal source imports the package root",
          "Import the local emitted module path instead of routing through the public package entrypoint."
        )
      );
    if (
      !isTestFile(edge.from) &&
      !edge.typeOnly &&
      fromLayer &&
      toLayer &&
      fromLayer !== toLayer &&
      !allowedDependency(context, fromLayer, toLayer)
    ) {
      const severity = changed.has(edge.from) ? "error" : "warning";
      findings.push(
        finding({
          code: "QG-ARCH-001",
          gate: "architecture",
          severity,
          path: edge.from,
          line: edge.line,
          title: "Import crosses a forbidden layer boundary",
          message: `${fromLayer} cannot depend on ${toLayer} (${edge.specifier}).`,
          remediation: `Move the dependency behind the existing lower-level contract or update quality.config.ts only when the architecture document changes.`,
        })
      );
    }
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
  }

  for (const cycle of findCycles(adjacency)) {
    const isChanged = cycle.some((file) => changed.has(file));
    findings.push(
      finding({
        code: "QG-ARCH-003",
        gate: "architecture",
        severity: isChanged ? "error" : "warning",
        path: cycle[0],
        title: "Import cycle detected",
        message: cycle.join(" -> "),
        evidence: ["The graph was resolved with the TypeScript Compiler API."],
        remediation:
          "Break the cycle through a lower-level contract, a type-only import, or a narrowly scoped shared module.",
      })
    );
  }

  for (const [file, targets] of adjacency) {
    if (targets.length > 12)
      findings.push(
        finding({
          code: "QG-ARCH-004",
          gate: "architecture",
          severity: "warning",
          path: file,
          title: "High import fan-out",
          message: `${targets.length} internal modules are imported by this file.`,
          remediation: "Check whether the file is becoming a dependency-cycle hub.",
        })
      );
  }
  return findings;
}

function layerFor(context: QualityContext, file: string): string | undefined {
  return context.config.layers.find((layer) => layer.patterns.some((pattern: string) => matchPattern(file, pattern)))
    ?.name;
}

function allowedDependency(context: QualityContext, from: string, to: string): boolean {
  return context.config.layers.find((layer) => layer.name === from)?.dependsOn.includes(to) ?? false;
}

function matchPattern(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "@@DOUBLE@@")
    .replaceAll("*", "[^/]*")
    .replaceAll("@@DOUBLE@@", ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function architectureFinding(
  edge: { readonly from: string; readonly line: number; readonly specifier: string },
  code: string,
  title: string,
  remediation: string
): QualityFinding {
  return finding({
    code,
    gate: "architecture",
    severity: "error",
    path: edge.from,
    line: edge.line,
    title,
    message: `Resolved import ${edge.specifier}.`,
    remediation,
  });
}

function findCycles(adjacency: ReadonlyMap<string, readonly string[]>): string[][] {
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  function visit(node: string): void {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      if (start >= 0) cycles.push([...stack.slice(start), node]);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const child of adjacency.get(node) ?? []) visit(child);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }
  for (const node of adjacency.keys()) visit(node);
  const unique = new Map<string, string[]>();
  for (const cycle of cycles) {
    const members = cycle.slice(0, -1);
    const rotations = members.map((_, index) => [...members.slice(index), ...members.slice(0, index)].join("\u0000"));
    unique.set([...rotations].sort()[0] ?? members.join("\u0000"), cycle);
  }
  return [...unique.values()].sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")));
}
