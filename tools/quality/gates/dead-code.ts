import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { runLocalBinary } from "../core/process.js";

interface KnipIssue {
  readonly file?: string;
  readonly symbol?: string;
  readonly dependency?: string;
  readonly name?: string;
}

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
  return issues.map((issue) => {
    const path = issue.file?.replace(`${context.root}/`, "").replaceAll("\\", "/");
    const changed = path ? context.changedFiles.includes(path) : false;
    const fingerprint = finding({
      code: "QG-DEAD-001",
      gate: "dead-code",
      severity: "warning",
      ...(path ? { path } : {}),
      title: "Knip found an unreachable or unused item",
      message: issue.symbol ?? issue.dependency ?? issue.name ?? "Unclassified Knip issue",
      remediation:
        "Confirm that the item is not a public export; remove it only after the public API inventory agrees.",
    });
    const known = context.baseline?.deadCodeFindings?.includes(fingerprint.fingerprint ?? "") ?? false;
    return { ...fingerprint, severity: changed && !known ? "error" : "warning" };
  });
}

function flattenKnip(value: unknown): KnipIssue[] {
  if (!value || typeof value !== "object") return [];
  const result: KnipIssue[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) {
      for (const entry of item) {
        if (typeof entry === "string") result.push({ file: entry, name: key });
        else if (entry && typeof entry === "object") result.push(entry as KnipIssue);
      }
    } else if (item && typeof item === "object") result.push(...flattenKnip(item));
  }
  return result;
}
