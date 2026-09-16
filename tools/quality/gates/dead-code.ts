import { collectPublicSymbols } from "../ast/exports.js";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { runLocalBinary } from "../core/process.js";

interface KnipIssue {
  readonly file?: string;
  readonly name?: string;
}

interface KnipDetail {
  readonly name?: string;
  readonly file?: string;
}

const NEXT_ENTRY_EXPORTS = new Set([
  "default",
  "metadata",
  "viewport",
  "generateMetadata",
  "generateStaticParams",
  "runtime",
  "dynamic",
  "revalidate",
  "preferredRegion",
  "maxDuration",
  "fetchCache",
  "dynamicParams",
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "alt",
  "contentType",
  "size",
]);

export function deadCodeGate(context: QualityContext): QualityFinding[] {
  if (context.mode === "block" && context.changedFiles.length === 0) return [];
  const result = runLocalBinary(context.root, "knip", ["--reporter", "json", "--no-progress"]);
  if (!result.stdout.trim())
    return result.status === 0
      ? []
      : [
          finding({
            code: "QG-DEAD-000",
            gate: "dead-code",
            severity: "warning",
            title: "Knip did not produce JSON output",
            message: result.stderr.trim() || "Knip exited without a report.",
            remediation: "Keep the Knip configuration aligned with workspace exports and entrypoints.",
          }),
        ];
  let report: unknown;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    return [
      finding({
        code: "QG-DEAD-002",
        gate: "dead-code",
        severity: "warning",
        title: "Knip JSON output could not be parsed",
        message: result.stdout.slice(0, 300),
        remediation: "Pin the configured Knip reporter format or update the adapter.",
      }),
    ];
  }
  const issues = flattenKnip(report);
  const publicSymbols = collectPublicSymbols(context);
  const publicExports = new Set(publicSymbols.map((symbol) => `${symbol.path}:${symbol.name}`));
  const publicNames = new Set(publicSymbols.map((symbol) => symbol.name));
  return issues.flatMap((issue) => deadFinding(context, issue, publicExports, publicNames));
}

function deadFinding(
  context: QualityContext,
  issue: KnipIssue,
  publicExports: ReadonlySet<string>,
  publicNames: ReadonlySet<string>
): QualityFinding[] {
  const path = issue.file?.replace(`${context.root}/`, "").replaceAll("\\", "/");
  if (issue.name?.startsWith("duplicates: ")) return [];
  if (
    path &&
    (isPublicExport(issue.name, path, publicExports) ||
      isReexportedPackageSymbol(issue.name, path, publicNames) ||
      isIntentionalIntegrationExport(issue.name, path))
  )
    return [];

  const changed = path ? context.changedFiles.includes(path) : false;
  const fingerprint = finding({
    code: "QG-DEAD-001",
    gate: "dead-code",
    severity: "warning",
    ...(path ? { path } : {}),
    title: "Knip found an unreachable or unused item",
    message: issue.name ?? "Unclassified Knip issue",
    remediation: "Confirm that the item is not a public export; remove it only after the public API inventory agrees.",
  });
  const known = context.baseline?.deadCodeFindings?.includes(fingerprint.fingerprint ?? "") ?? false;
  return [{ ...fingerprint, severity: changed && !known ? "error" : "warning" }];
}

function isPublicExport(name: string | undefined, path: string, publicExports: ReadonlySet<string>): boolean {
  const match = /^(?:exports|types|nsExports|nsTypes): (.+)$/.exec(name ?? "");
  return match !== null && publicExports.has(`${path}:${match[1]}`);
}

function isReexportedPackageSymbol(name: string | undefined, path: string, publicNames: ReadonlySet<string>): boolean {
  const match = /^(?:exports|types|nsExports|nsTypes): (.+)$/.exec(name ?? "");
  return path.startsWith("packages/jit/src/") && match !== null && publicNames.has(match[1]);
}

function isIntentionalIntegrationExport(name: string | undefined, path: string): boolean {
  return (
    (path === "tools/quality/core/context.ts" && name === "types: QualityConfig") ||
    isGeneratedArtifact(path) ||
    isBenchmarkFixture(path) ||
    isExampleConfig(name, path) ||
    isNextEntryExport(name, path)
  );
}

function isGeneratedArtifact(path: string): boolean {
  return path.startsWith("apps/site/lib/lab/generated/") || path.startsWith("packages/examples/compiled/");
}

function isBenchmarkFixture(path: string): boolean {
  return (
    /^bench\/validate\/typia-(?:src|gen)\//.test(path) ||
    /^bench\/types\/typeof-performance\.(?:before|after)\.ts$/.test(path)
  );
}

function isExampleConfig(name: string | undefined, path: string): boolean {
  return (
    (path === "packages/examples/jit.config.ts" ||
      path === "apps/site/next.config.ts" ||
      path === "tests/vitest.config.ts") &&
    name === "exports: default"
  );
}

function isNextEntryExport(name: string | undefined, path: string): boolean {
  if (!path.startsWith("apps/site/app/")) return false;
  const filename = path.slice(path.lastIndexOf("/") + 1);
  return (
    NEXT_ENTRY_EXPORTS.has(name?.replace(/^(?:exports|types|nsExports|nsTypes): /, "") ?? "") &&
    /(?:page|layout|route|manifest|robots|sitemap|not-found|opengraph-image)\.(?:ts|tsx)$/.test(filename)
  );
}

function flattenKnip(value: unknown): KnipIssue[] {
  if (!value || typeof value !== "object") return [];
  const issues = (value as { readonly issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((entry) => flattenKnipIssue(entry));
}

function flattenKnipIssue(value: unknown): KnipIssue[] {
  if (!value || typeof value !== "object") return [];
  const issue = value as KnipIssue & Record<string, unknown>;
  const issuePath = typeof issue.file === "string" ? issue.file : undefined;
  return Object.entries(issue).flatMap(([kind, details]) => flattenKnipDetails(issuePath, kind, details));
}

function flattenKnipDetails(issuePath: string | undefined, kind: string, details: unknown): KnipIssue[] {
  if (kind === "file" || !Array.isArray(details)) return [];
  return details.flatMap((detail) => flattenKnipDetail(issuePath, kind, detail));
}

function flattenKnipDetail(issuePath: string | undefined, kind: string, detail: unknown): KnipIssue[] {
  if (typeof detail === "string") return [issueFinding(issuePath, `${kind}: ${detail}`)];
  if (Array.isArray(detail)) return flattenKnipNames(issuePath, kind, detail);
  if (!detail || typeof detail !== "object") return [];
  const item = detail as KnipDetail;
  if (kind === "files") return [issueFinding(item.name ?? item.file, "unreferenced file")];
  return item.name === undefined ? [] : [issueFinding(issuePath, `${kind}: ${item.name}`)];
}

function flattenKnipNames(issuePath: string | undefined, kind: string, details: readonly unknown[]): KnipIssue[] {
  const names = details
    .filter((item): item is KnipDetail => Boolean(item && typeof item === "object"))
    .map((item) => item.name)
    .filter((name): name is string => name !== undefined);
  return names.length > 0 ? [issueFinding(issuePath, `${kind}: ${names.join(", ")}`)] : [];
}

function issueFinding(file: string | undefined, name: string): KnipIssue {
  return file === undefined ? { name } : { file, name };
}
