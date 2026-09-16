import type * as ATS from "../../core/ats/index.js";
import type { CompileHints } from "../../core/hints/index.js";
import { resolveHints } from "../../core/hints/index.js";
import { resolveWrappers } from "./resolve-wrappers.js";

/** Describes the JIT resolved compiler hints contract used by the public API. */
export interface ResolvedCompilerHints {
  readonly base: ATS.AnyTypeSchema;
  readonly hints: CompileHints;
}

/** Returns the JIT resolve compiler hints result for the supplied input. */
export function resolveCompilerHints(schema: ATS.AnyTypeSchema): ResolvedCompilerHints {
  const resolved = resolveWrappers(schema);

  return {
    base: resolved.base,
    hints: resolveHints(schema),
  };
}

/** Returns the JIT resolve hint key result for the supplied input. */
export function resolveHintKey(key: unknown): string | undefined {
  if (typeof key === "string") return key;
  if (Array.isArray(key) && key.length === 1 && typeof key[0] === "string") return key[0];
  return undefined;
}

/** Provides the JIT type operation for the supplied input. */
export type { CompileHints };
