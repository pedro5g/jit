import type { Path } from "../core/ast/index.js";

/**
 * Stable error codes thrown by compiled JIT operations.
 */
export type JITErrorCode =
  | "JIT_AOT_001_ARTIFACT_EXECUTED"
  | "JIT_AOT_002_CAPTURED_RUNTIME_VALUE"
  | "JIT_AOT_003_DUPLICATE_EXPORT"
  | "JIT_AOT_004_UNSERIALIZABLE_DESCRIPTOR"
  | "JIT_AOT_005_EXTERNAL_REFERENCE_INVALID"
  | "JIT_AOT_006_GENERATED_PACKAGE_STALE"
  | "JIT_AOT_007_OUTPUT_WRITE_FAILED"
  | "JIT_AOT_008_IMPORT_MAPPING_MISSING"
  | "JIT_AOT_009_ARTIFACT_NAME_COLLISION"
  | "JIT_AOT_010_UNSUPPORTED_TARGET"
  | "JIT_AOT_011_COLLECTION_TIMEOUT"
  | "JIT_AOT_012_INVALID_GENERATED_DECLARATION"
  | "INVALID_QUERY"
  | "INVALID_UPDATE"
  | "INVALID_MAPPER"
  | "INVALID_OPERATION"
  | "UNSUPPORTED_SCHEMA"
  | "READONLY_FIELD"
  | "REFINE_FAILED"
  | "VALIDATION_FAILED";

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
