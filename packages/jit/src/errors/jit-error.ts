import type { Path } from "../core/ast/index.js";

/**
 * Stable error codes thrown by compiled JIT operations.
 */
export type JITErrorCode =
  | "INVALID_QUERY"
  | "INVALID_UPDATE"
  | "INVALID_MAPPER"
  | "INVALID_OPERATION"
  | "UNSUPPORTED_SCHEMA"
  | "READONLY_FIELD"
  | "REFINE_FAILED";

/**
 * Optional structured details attached to a `JITError`.
 */
export interface JITErrorOptions {
  readonly path?: Path;
  readonly meta?: unknown;
}

/**
 * Error type thrown by JIT compilers and generated runtime functions.
 */
export class JITError extends Error {
  readonly code: JITErrorCode;
  readonly path: Path | undefined;
  readonly meta: unknown;

  /**
   * Creates a JIT error with a stable code and optional structured details.
   *
   * @param code - The stable machine-readable error code.
   * @param message - The human-readable error message.
   * @param options - Optional path and metadata details.
   */
  constructor(code: JITErrorCode, message: string, options: JITErrorOptions = {}) {
    super(message);
    this.name = "JITError";
    this.code = code;
    this.path = options.path;
    this.meta = options.meta;
  }
}
