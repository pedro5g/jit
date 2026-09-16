type QualitySeverity = "error" | "warning";

export interface QualityFinding {
  readonly code: string;
  readonly gate: string;
  readonly severity: QualitySeverity;
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
  readonly title: string;
  readonly message: string;
  readonly evidence?: readonly string[];
  readonly remediation?: string;
  readonly fingerprint?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function finding(input: QualityFinding): QualityFinding {
  return {
    ...input,
    fingerprint: input.fingerprint ?? fingerprintOf(input),
  };
}

function fingerprintOf(input: Pick<QualityFinding, "code" | "path" | "line" | "message">): string {
  return [input.code, input.path ?? "", input.line ?? "", input.message].join("|");
}

export function sortFindings(findings: readonly QualityFinding[]): QualityFinding[] {
  return [...findings].sort((left, right) => {
    const leftKey = [left.gate, left.path ?? "", left.line ?? 0, left.column ?? 0, left.code, left.message].join(
      "\u0000"
    );
    const rightKey = [right.gate, right.path ?? "", right.line ?? 0, right.column ?? 0, right.code, right.message].join(
      "\u0000"
    );
    return leftKey.localeCompare(rightKey);
  });
}
