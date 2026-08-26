import {
  type CompiledIndex,
  compileIndex,
  type IndexShape,
  resolveIndexDescriptor,
  resolveIndexKeysFromFacts,
} from "../compiler/indexing.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { getCachedIndex } from "../runtime/index/index-cache.js";

type RowOf<TSchema extends ATS.AnyTypeSchema> =
  ATS.TypeofSchema<TSchema> extends readonly (infer TRow)[] ? TRow : ATS.TypeofSchema<TSchema>;
type RowKey<TSchema extends ATS.AnyTypeSchema> = Extract<keyof RowOf<TSchema>, string>;

/** A `Date` key is indexed by its timestamp, because Map keys match by identity. */
type IndexKeyValue<TRow, TKey extends keyof TRow> = TRow[TKey] extends Date
  ? number
  : TRow[TKey] extends Date | undefined
    ? number | undefined
    : TRow[TKey] extends Date | null
      ? number | null
      : TRow[TKey];

/** Nested maps, one level per key, holding `TValue` at the last level. */
type NestedIndex<TRow, TKeys extends readonly (keyof TRow)[], TValue> = TKeys extends readonly [
  infer THead extends keyof TRow,
  ...infer TRest extends readonly (keyof TRow)[],
]
  ? TRest["length"] extends 0
    ? Map<IndexKeyValue<TRow, THead>, TValue>
    : Map<IndexKeyValue<TRow, THead>, NestedIndex<TRow, TRest, TValue>>
  : Map<unknown, TValue>;

type Grouped<TIndex> =
  TIndex extends Map<infer TKey, infer TValue>
    ? TValue extends Map<unknown, unknown>
      ? Map<TKey, Grouped<TValue>>
      : Map<TKey, TValue[]>
    : never;

/** A compiled index builder. Calling it builds; `cached` reuses per array. */
export interface IndexPlan<TRow, TIndex> extends CompiledIndex<TRow, TIndex> {}

/** An index whose keys are settled, so the grouped shape is derivable. */
export interface KeyedIndexPlan<TRow, TIndex> extends IndexPlan<TRow, TIndex> {
  grouped(): IndexPlan<TRow, Grouped<TIndex>>;
}

export interface IndexBuilder<TSchema extends ATS.AnyTypeSchema>
  extends KeyedIndexPlan<RowOf<TSchema>, Map<unknown, RowOf<TSchema>>> {
  by<const TKeys extends readonly [RowKey<TSchema>, ...RowKey<TSchema>[]]>(
    ...keys: TKeys
  ): KeyedIndexPlan<RowOf<TSchema>, NestedIndex<RowOf<TSchema>, TKeys, RowOf<TSchema>>>;
}

/**
 * Materializes an index over a collection. The key comes from the collection's
 * own facts — `.keyed`, `.indexBy`, `.uniqueBy` or an entity hint — unless
 * `.by()` names one. Naming the keys is what gives the index a precise type.
 */
export function index<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): IndexBuilder<TSchema> {
  const unwrapped = unwrapSchema(schema);
  const inferred = resolveIndexKeysFromFacts(unwrapped);
  const plan = createIndexPlan(unwrapped, inferred, "unique") as IndexBuilder<TSchema>;

  Object.defineProperty(plan, "by", {
    value: (...keys: string[]) => createIndexPlan(unwrapped, keys, "unique"),
  });
  return plan;
}

function createIndexPlan<TRow, TIndex>(
  schema: ATS.AnyTypeSchema,
  keys: readonly string[] | undefined,
  shape: IndexShape
): KeyedIndexPlan<TRow, TIndex> {
  // A collection with no key fact must still accept `.by()`, so an unresolvable
  // index defers its diagnostic to the moment it is actually built.
  const plan = (
    keys || resolveIndexKeysFromFacts(schema)
      ? compileIndex<TRow, TIndex>(schema, resolveIndexDescriptor(schema, keys, shape), getCachedIndex as never)
      : unresolvedIndexPlan<TRow, TIndex>(schema, shape)
  ) as KeyedIndexPlan<TRow, TIndex>;

  Object.defineProperty(plan, "grouped", {
    value: () => createIndexPlan(schema, keys, "grouped"),
  });
  return plan;
}

function unresolvedIndexPlan<TRow, TIndex>(schema: ATS.AnyTypeSchema, shape: IndexShape): IndexPlan<TRow, TIndex> {
  const fail = () => resolveIndexDescriptor(schema, undefined, shape) as never;
  const plan = ((_value: readonly TRow[]) => fail()) as unknown as IndexPlan<TRow, TIndex>;

  Object.defineProperty(plan, "cached", { value: fail });
  return plan;
}
