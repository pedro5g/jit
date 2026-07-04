import type { Path } from "../core/ast/index.js";

export type JITErrorCode = "INVALID_QUERY" | "INVALID_UPDATE" | "READONLY_FIELD" | "REFINE_FAILED";

export interface JITErrorOptions {
  readonly path?: Path;
  readonly meta?: unknown;
}

export class JITError extends Error {
  readonly code: JITErrorCode;
  readonly path: Path | undefined;
  readonly meta: unknown;

  constructor(code: JITErrorCode, message: string, options: JITErrorOptions = {}) {
    super(message);
    this.name = "JITError";
    this.code = code;
    this.path = options.path;
    this.meta = options.meta;
  }
}
