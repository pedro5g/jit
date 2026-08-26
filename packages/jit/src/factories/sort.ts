import { type OrderDirection, resolveOrderingDescriptor } from "../compiler/ordering.js";
import { type CompiledSort, compileSort } from "../compiler/sort.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";

type RowOf<TSchema extends ATS.AnyTypeSchema> =
  ATS.TypeofSchema<TSchema> extends readonly (infer TRow)[] ? TRow : ATS.TypeofSchema<TSchema>;
type RowKey<TSchema extends ATS.AnyTypeSchema> = Extract<keyof RowOf<TSchema>, string>;

export interface SortPlan<TSchema extends ATS.AnyTypeSchema> extends CompiledSort<RowOf<TSchema>> {
  by<TKey extends RowKey<TSchema>>(key: TKey, direction?: OrderDirection): SortPlan<TSchema>;
  thenBy<TKey extends RowKey<TSchema>>(key: TKey, direction?: OrderDirection): SortPlan<TSchema>;
}

export interface SortBuilder<TSchema extends ATS.AnyTypeSchema> {
  by<TKey extends RowKey<TSchema>>(key: TKey, direction?: OrderDirection): SortPlan<TSchema>;
}

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
