import { JITError } from "./jit-error.js";

/**
 * One validation failure: where it happened, what failed, and what the
 * schema expected. Designed to be consumed directly (logs, HTTP responses,
 * form field mapping) without any translation layer.
 */
export interface ValidationIssue {
  /** Dot/bracket path from the root, e.g. `"items[2].name"`; `""` is the root. */
  readonly path: string;
  /** Stable machine-readable code, e.g. `"expected_string"`, `"too_small"`. */
  readonly code: string;
  /** Human-readable description of the accepted shape, e.g. `"length >= 3"`. */
  readonly expected: string;
  /** Human-readable message for the failure. */
  readonly message: string;
  /** `typeof` of the rejected value on type mismatches. */
  readonly received?: string;
  /**
   * Machine-readable detail beside the code, for the checks that have one.
   *
   * `message` is presentation and cannot be translated by a caller; a bound
   * can. A check that has nothing structured to add omits the key entirely
   * rather than carrying an empty object, and no issue ever holds the rejected
   * value: that is how a diagnostic ends up in a log with data in it.
   */
  readonly params?: Readonly<Record<string, string | number | boolean | readonly (string | number)[]>>;
}

/**
 * Error thrown by compiled `parse` functions. Carries every collected
 * {@link ValidationIssue} — not just the first failure.
 */
export class JITValidationError extends JITError {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    const first = issues[0];

    super("VALIDATION_FAILED", first ? `${first.path ? `${first.path}: ` : ""}${first.message}` : "validation failed", {
      meta: issues,
    });
    this.name = "JITValidationError";
    this.issues = issues;
  }
}
