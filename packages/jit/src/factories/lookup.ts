import { type CompiledLookup, compileLookup, resolveLookupDescriptor } from "../compiler/lookup.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { getCachedIndex } from "../runtime/index/index-cache.js";

type RowOf<TSchema extends ATS.AnyTypeSchema> =
  ATS.TypeofSchema<TSchema> extends readonly (infer TRow)[] ? TRow : ATS.TypeofSchema<TSchema>;
type RowKey<TSchema extends ATS.AnyTypeSchema> = Extract<keyof RowOf<TSchema>, string>;

/** A `Date` key is looked up by the `Date` itself; the timestamp is read for you. */
type LookupKeyValue<TRow, TKey extends keyof TRow> = TRow[TKey];

export interface LookupPlan<TRow, TKey> extends CompiledLookup<TRow, TKey> {}

export interface LookupBuilder<TSchema extends ATS.AnyTypeSchema>
  extends LookupPlan<RowOf<TSchema>, RowOf<TSchema>[RowKey<TSchema>]> {
  by<const TKey extends RowKey<TSchema>>(key: TKey): LookupPlan<RowOf<TSchema>, LookupKeyValue<RowOf<TSchema>, TKey>>;
}

/**
 * Reaches one row by key. The key comes from the collection's own facts unless
 * `.by()` names one, and the access path — cached index, binary search or an
 * early-exit scan — is chosen from those same facts. The caller never names an
 * algorithm; `explain()` reports which one was chosen.
 */
export function lookup<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): LookupBuilder<TSchema> {
  const unwrapped = unwrapSchema(schema);
  const plan = createLookupPlan(unwrapped, undefined) as LookupBuilder<TSchema>;

  Object.defineProperty(plan, "by", { value: (key: string) => createLookupPlan(unwrapped, key) });
  return plan;
}

function createLookupPlan<TRow, TKey>(schema: ATS.AnyTypeSchema, key: string | undefined): LookupPlan<TRow, TKey> {
  // A collection with no key fact must still accept `.by()`, so an unresolvable
  // lookup defers its diagnostic to the moment it is actually used.
  if (key === undefined && !canResolve(schema)) return unresolvedLookupPlan<TRow, TKey>(schema);
  return compileLookup<TRow, TKey>(schema, resolveLookupDescriptor(schema, key), getCachedIndex as never);
}

function canResolve(schema: ATS.AnyTypeSchema): boolean {
  try {
    resolveLookupDescriptor(schema, undefined);
    return true;
  } catch {
    return false;
  }
}

function unresolvedLookupPlan<TRow, TKey>(schema: ATS.AnyTypeSchema): LookupPlan<TRow, TKey> {
  const fail = () => resolveLookupDescriptor(schema, undefined) as never;
  const plan = (() => fail()) as unknown as LookupPlan<TRow, TKey>;

  Object.defineProperty(plan, "explain", { value: fail });
  return plan;
}
