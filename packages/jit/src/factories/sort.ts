import { type OrderDirection, resolveOrderingDescriptor } from "../compiler/ordering.js";
import { type CompiledSort, compileSort } from "../compiler/sort.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import type { RowKey, RowOf } from "./row-types.js";

/**
 * A compiled stable sort plan.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Users = JIT.array(JIT.object({ name: JIT.string(), age: JIT.int() }));
 * const sortUsers = JIT.sort(Users).by("age").thenBy("name");
 * sortUsers([{ name: "Ada", age: 37 }]);
 * ```
 */
export interface SortPlan<TSchema extends ATS.AnyTypeSchema> extends CompiledSort<RowOf<TSchema>> {
  /** Replaces the ordering criteria with one key. */
  by<TKey extends RowKey<TSchema>>(key: TKey, direction?: OrderDirection): SortPlan<TSchema>;
  /** Appends a stable tie-breaker after the existing criteria. */
  thenBy<TKey extends RowKey<TSchema>>(key: TKey, direction?: OrderDirection): SortPlan<TSchema>;
}

/**
 * Starts a schema-specialized stable sort plan.
 *
 * @example
 * ```ts
 * const sortUsers = JIT.sort(Users).by("age").thenBy("name");
 * sortUsers(rows);
 * ```
 */
export interface SortBuilder<TSchema extends ATS.AnyTypeSchema> {
  /** Starts ordering by one row field. */
  by<TKey extends RowKey<TSchema>>(key: TKey, direction?: OrderDirection): SortPlan<TSchema>;
}

/**
 * Starts a schema-specialized stable sort plan.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Rows = JIT.array(JIT.object({ score: JIT.number() }));
 * const sortRows = JIT.sort(Rows).by("score", "desc");
 * sortRows([{ score: 2 }, { score: 1 }]);
 * ```
 */
export function sort<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): SortBuilder<TSchema> {
  const unwrapped = unwrapSchema(schema);

  return Object.freeze({
    by(key: string, direction: OrderDirection = "asc") {
      return createSortPlan(unwrapped, [{ key, direction }]);
    },
  }) as SortBuilder<TSchema>;
}

function createSortPlan<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  criteria: readonly { readonly key: string; readonly direction: OrderDirection }[]
): SortPlan<TSchema> {
  const descriptor = resolveOrderingDescriptor(schema, criteria);
  const compiled = compileSort<RowOf<TSchema>>(schema, descriptor) as SortPlan<TSchema>;

  Object.defineProperties(compiled, {
    by: {
      value: (key: string, direction: OrderDirection = "asc") => createSortPlan(schema, [{ key, direction }]),
    },
    thenBy: {
      value: (key: string, direction: OrderDirection = "asc") =>
        createSortPlan(schema, [...criteria, { key, direction }]),
    },
  });
  return compiled;
}
