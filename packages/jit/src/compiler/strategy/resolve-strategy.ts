import type * as ATS from "../../core/ats/index.js";
import type { HashStrategy, OrderDirection } from "../../core/hints/index.js";
import { JITError } from "../../errors/index.js";
import { resolveCompilerHints, resolveHintKey } from "../resolvers/resolve-hints.js";

/** Describes the JIT array equal strategy contract used by the public API. */
export type ArrayEqualStrategy =
  | { readonly type: "loop" }
  | { readonly type: "map"; readonly key: string }
  | { readonly type: "binary-search"; readonly key: string; readonly direction: OrderDirection | undefined };

/** Describes the JIT equal strategy contract used by the public API. */
export interface EqualStrategy {
  readonly type: "equal";
  readonly array: ArrayEqualStrategy;
  readonly hash:
    | { readonly type: "none" }
    | { readonly type: "hash-short-circuit"; readonly strategy: HashStrategy | undefined };
}

/** Returns the JIT resolve equal strategy result for the supplied input. */
export function resolveEqualStrategy(schema: ATS.AnyTypeSchema): EqualStrategy {
  const { base, hints } = resolveCompilerHints(schema);
  const identifyKey = resolveHintKey(hints.index?.key ?? hints.collection?.identify);
  const entityKey = resolveHintKey(hints.entity?.key);
  const key = identifyKey ?? entityKey;
  const ordered = hints.order ?? hints.collection?.ordered;

  if (ordered && !key) {
    throw new JITError("INVALID_OPERATION", "ordered() requires a string key for compiler strategies");
  }

  return {
    type: "equal",
    array:
      base.type === "array" && ordered && key
        ? { type: "binary-search", key, direction: resolveDirection(ordered.direction) }
        : base.type === "array" && (hints.index || hints.collection?.indexed === true) && key
          ? { type: "map", key }
          : { type: "loop" },
    hash: hints.hash ? { type: "hash-short-circuit", strategy: hints.hash.strategy } : { type: "none" },
  };
}

function resolveDirection(direction: unknown): OrderDirection | undefined {
  return direction === "asc" || direction === "desc" ? direction : undefined;
}
