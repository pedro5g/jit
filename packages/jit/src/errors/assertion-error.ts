import { JITError } from "./jit-error.js";

/**
 * A domain invariant that did not hold.
 *
 * This is deliberately not a validation error. Schema validation asks whether
 * a value has the declared shape; an assertion asks whether the domain permits
 * that value at all, and the two fail for different reasons and are answered
 * by different people. The error carries what a caller can act on — which rule
 * failed and which field it spoke about — and never the rejected value, which
 * would put domain data into a log by default.
 */
export class DomainAssertionError extends JITError {
  /** Identifier of the failed assertion, when one was declared. */
  readonly rule: string | undefined;
  /** Field the assertion spoke about, when the condition names exactly one. */
  readonly field: string | undefined;
  /**
   * Every invariant that did not hold, in declaration order.
   *
   * The shape is the one a validation failure uses, so a caller reads
   * `error.issues` without asking which kind of failure it was holding.
   */
  readonly issues: readonly AssertionIssueLike[];

  constructor(
    message: string,
    details?: { readonly rule?: string; readonly field?: string; readonly issues?: readonly AssertionIssueLike[] }
  ) {
    super("ASSERTION_FAILED", message, details?.field === undefined ? {} : { path: [details.field] });
    this.name = "DomainAssertionError";
    this.rule = details?.rule;
    this.field = details?.field;
    this.issues = details?.issues ?? [];
  }
}

/** One assertion failure, in the same shape a validation issue takes. */
export interface AssertionIssueLike {
  readonly path: string;
  readonly code: string;
  readonly expected: string;
  readonly message: string;
}
