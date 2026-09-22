/**
 * Structural issue contract emitted by standalone artifacts.
 *
 * It intentionally has no reference to a JIT class or registry. Consumers can
 * copy this shape into an independently maintained application boundary.
 */
export interface PortableValidationIssue {
  readonly path: readonly PropertyKey[];
  readonly code: string;
  readonly expected: string;
  readonly message: string;
  readonly received?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/** Portable validation failure used by generated artifacts with `portableErrors`. */
export class ValidationError extends Error {
  readonly code = "VALIDATION_FAILED" as const;
  readonly issues: readonly PortableValidationIssue[];
  readonly path: readonly PropertyKey[] | undefined;

  constructor(issues: readonly PortableValidationIssue[]) {
    const first = issues[0];
    const path = first === undefined ? undefined : first.path;
    super(first === undefined ? "validation failed" : `${formatPortablePath(first.path)}: ${first.message}`);
    this.name = "ValidationError";
    this.issues = issues;
    this.path = path;
  }
}

/** Portable domain assertion failure used by standalone DDD artifacts. */
export class PortableDomainAssertionError extends Error {
  readonly code = "ASSERTION_FAILED" as const;
  readonly rule: string | undefined;
  readonly field: string | undefined;
  readonly issues: readonly PortableValidationIssue[];

  constructor(
    message: string,
    details: {
      readonly rule?: string;
      readonly field?: string;
      readonly issues?: readonly PortableValidationIssue[];
    } = {}
  ) {
    super(message);
    this.name = "DomainAssertionError";
    this.rule = details.rule;
    this.field = details.field;
    this.issues = details.issues ?? [];
  }
}

/** Portable authorization failure that carries no rejected subject. */
export class PortableAccessDeniedError extends Error {
  readonly code = "ACCESS_DENIED" as const;
  readonly action: string;
  readonly field: string | undefined;
  readonly reason: string | undefined;

  constructor(action: string, field?: string, reason?: string) {
    super(`Access denied for action ${JSON.stringify(action)}`);
    this.name = "AccessDeniedError";
    this.action = action;
    this.field = field;
    this.reason = reason;
  }
}

function formatPortablePath(path: readonly PropertyKey[]): string {
  let output = "";

  for (const segment of path) {
    if (typeof segment === "number") output += `[${segment}]`;
    else output += `${output === "" ? "" : "."}${String(segment)}`;
  }
  return output === "" ? "validation failed" : output;
}
