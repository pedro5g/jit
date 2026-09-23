import { JITError } from "./jit-error.js";

/**
 * One validation failure: where it happened, what failed, and what the
 * schema expected. Designed to be consumed directly (logs, HTTP responses,
 * form field mapping) without any translation layer.
 */
export interface IssueDescriptor {
  /** Stable machine-readable issue identity. */
  readonly code: string;
  /** Structured path from the root; `[]` is the root. */
  readonly path: readonly PropertyKey[];
  /** Human-readable description of the accepted shape, when available. */
  readonly expected?: string;
  /** `typeof` of the rejected value on type mismatches, when available. */
  readonly received?: string;
  /** Machine-readable values used by locale formatters. */
  readonly params?: Readonly<Record<string, unknown>>;
  /** Current presentation message, retained for compatibility/fallback. */
  readonly message?: string;
}

/**
 * One validation failure emitted by a compiled diagnostic operation.
 *
 * `code`, `path` and `params` are the stable contract. `message` is a
 * presentation chosen by the compiler and may be replaced by `JIT.error`.
 */
export interface ValidationIssue extends IssueDescriptor {
  /** Structured path from the root, e.g. `["items", 2, "name"]`; `[]` is the root. */
  readonly path: readonly PropertyKey[];
  /** Stable machine-readable code, e.g. `"expected_string"`, `"too_small"`. */
  /** Human-readable description of the accepted shape, e.g. `"length >= 3"`. */
  readonly expected: string;
  /** Human-readable message for the failure. */
  readonly message: string;
  /** `typeof` of the rejected value on type mismatches. */
  /**
   * Machine-readable detail beside the code, for the checks that have one.
   *
   * `message` is presentation and cannot be translated by a caller; a bound
   * can. A check that has nothing structured to add omits the key entirely
   * rather than carrying an empty object, and no issue ever holds the rejected
   * value: that is how a diagnostic ends up in a log with data in it.
   */
}

/**
 * Error thrown by compiled `parse` functions. Carries every collected
 * {@link ValidationIssue} — not just the first failure.
 */
export class JITValidationError extends JITError {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    const first = issues[0];

    const path = first === undefined ? "" : formatIssuePath(first.path);

    super(
      "VALIDATION_FAILED",
      first ? `${path === "" ? "" : `${path}: `}${first.message ?? first.code}` : "validation failed",
      {
        meta: issues,
      }
    );
    this.name = "JITValidationError";
    this.issues = issues;
  }
}

/** Human-readable formatting is an error-message concern, not issue identity. */
function formatIssuePath(path: readonly PropertyKey[]): string {
  let output = "";

  for (const segment of path) {
    if (typeof segment === "number") output += `[${segment}]`;
    else output += `${output === "" ? "" : "."}${String(segment)}`;
  }
  return output;
}
