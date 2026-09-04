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
  | "ACCESS_DENIED"
  | "UNSUPPORTED_SCHEMA"
  | "READONLY_FIELD"
  | "REFINE_FAILED"
  | "VALIDATION_FAILED"
  | "ASSERTION_FAILED"
  | "CLASS_MEMBER_ALREADY_EXISTS"
  | "CLASS_OVERWRITE_TARGET_NOT_FOUND"
  | "DDD_CAPABILITY_SCHEMA_CONFLICT";

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

/** Compact authorization failure that deliberately never retains the subject. */
export class AccessDeniedError extends JITError {
  readonly action: string;
  readonly field: string | undefined;
  readonly reason: string | undefined;
  readonly ruleId: string | undefined;

  constructor(action: string, field?: string, reason?: string, ruleId?: string) {
    super("ACCESS_DENIED", `Access denied for action ${JSON.stringify(action)}`);
    this.name = "AccessDeniedError";
    this.action = action;
    this.field = field;
    this.reason = reason;
    this.ruleId = ruleId;
  }
}
