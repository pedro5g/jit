import type * as ATS from "../../core/ats/index.js";
import type { HashStrategy, OrderDirection } from "../../core/hints/index.js";
import { resolveCompilerHints, resolveHintKey } from "../resolvers/resolve-hints.js";

export type ArrayEqualStrategy =
  | { readonly type: "loop" }
  | { readonly type: "map"; readonly key: string }
  | { readonly type: "binary-search"; readonly key: string; readonly direction: OrderDirection | undefined };

export interface EqualStrategy {
  readonly type: "equal";
  readonly array: ArrayEqualStrategy;
  readonly hash:
    | { readonly type: "none" }
    | { readonly type: "hash-short-circuit"; readonly strategy: HashStrategy | undefined };
}

export function resolveEqualStrategy(schema: ATS.AnyTypeSchema): EqualStrategy {
  const { base, hints } = resolveCompilerHints(schema);
  const identifyKey = resolveHintKey(hints.index?.key ?? hints.collection?.identify);
  const entityKey = resolveHintKey(hints.entity?.key);
  const key = identifyKey ?? entityKey;
  const ordered = hints.order ?? hints.collection?.ordered;

  if (ordered && !key) {
    throw new Error("[JIT] ordered() requires a string key for compiler strategies");
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
