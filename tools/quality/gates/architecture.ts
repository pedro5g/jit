import ts from "typescript";
import { collectImportEdges, type ImportEdge } from "../ast/imports.js";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { isTestFile } from "../core/paths.js";

export function architectureGate(context: QualityContext): QualityFinding[] {
  const edges = collectImportEdges(context);
  const adjacency = new Map<string, string[]>();
  const changed = new Set(context.changedFiles);
  const findings = edgeFindings(context, edges, changed, adjacency);

  findings.push(...cycleFindings(adjacency, changed), ...fanOutFindings(context, adjacency));
  return findings;
}

function edgeFindings(
  context: QualityContext,
  edges: readonly ImportEdge[],
  changed: ReadonlySet<string>,
  adjacency: Map<string, string[]>
): QualityFinding[] {
  const findings: QualityFinding[] = [];
  for (const edge of edges) {
    const boundary = boundaryFinding(context, edge, changed);
    if (boundary) findings.push(boundary);
    if (!edge.typeOnly) {
      const targets = adjacency.get(edge.from) ?? [];
      targets.push(edge.to);
      adjacency.set(edge.from, targets);
    }
  }
  return findings;
}

function boundaryFinding(
  context: QualityContext,
  edge: ImportEdge,
  changed: ReadonlySet<string>
): QualityFinding | undefined {
  const internalPackageImport =
    edge.from.startsWith("packages/jit/src/") && /^@jit-compiler\/jit(?:\/|$)/.test(edge.specifier);
  if (internalPackageImport && !isTestFile(edge.from))
    return architectureFinding(
      edge,
      "QG-ARCH-002",
      "Internal source imports the package root",
      "Import the local emitted module path instead of routing through the public package entrypoint."
    );

  const fromLayer = layerFor(context, edge.from);
  const toLayer = layerFor(context, edge.to);
  if (
    isTestFile(edge.from) ||
    edge.typeOnly ||
    !fromLayer ||
    !toLayer ||
    fromLayer === toLayer ||
    allowedDependency(context, fromLayer, toLayer)
  )
    return undefined;

  return finding({
    code: "QG-ARCH-001",
    gate: "architecture",
    severity: changed.has(edge.from) ? "error" : "warning",
    path: edge.from,
    line: edge.line,
    title: "Import crosses a forbidden layer boundary",
    message: `${fromLayer} cannot depend on ${toLayer} (${edge.specifier}).`,
    remediation:
      "Move the dependency behind the existing lower-level contract or update quality.config.ts only when the architecture document changes.",
  });
}

function cycleFindings(
  adjacency: ReadonlyMap<string, readonly string[]>,
  changed: ReadonlySet<string>
): QualityFinding[] {
  return findCycles(adjacency).map((cycle) =>
    finding({
      code: "QG-ARCH-003",
      gate: "architecture",
      severity: cycle.some((file) => changed.has(file)) ? "error" : "warning",
      path: cycle[0],
      title: "Import cycle detected",
      message: cycle.join(" -> "),
      evidence: ["The graph was resolved with the TypeScript Compiler API."],
      remediation:
        "Break the cycle through a lower-level contract, a type-only import, or a narrowly scoped shared module.",
    })
  );
}

function fanOutFindings(context: QualityContext, adjacency: ReadonlyMap<string, readonly string[]>): QualityFinding[] {
  return [...adjacency].flatMap(([file, targets]) =>
    targets.length > 12 && !isBarrelModule(context, file) && !context.config.compositionRoots.includes(file)
      ? [
          finding({
            code: "QG-ARCH-004",
            gate: "architecture",
            severity: "warning",
            path: file,
            title: "High import fan-out",
            message: `${targets.length} internal modules are imported by this file.`,
            remediation: "Check whether the file is becoming a dependency-cycle hub.",
          }),
        ]
      : []
  );
}

function isBarrelModule(context: QualityContext, file: string): boolean {
  const source = context.tsProgram.getSourceFile(`${context.root}/${file}`);
  return (
    source?.statements.every(
      (statement) =>
        ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement)
    ) ?? false
  );
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
