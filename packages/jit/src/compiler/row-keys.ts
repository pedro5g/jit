import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";

/**
 * Shared resolution of "a key on the rows of a collection", used by every plan
 * that addresses rows by field: ordering, indexing and the physical access
 * paths built on top of them. Keeping one resolver here is what makes a key
 * mean the same thing to a comparator and to an index.
 */

export type ScalarKeyKind = "direct" | "numeric" | "date";
export type ScalarKeyDomain = "string" | "number" | "bigint" | "boolean" | "date";

export type RowObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };

/** Unwraps a row schema, an array/set of rows, or a Runtime Type over either. */
export function resolveRowObjectSchema(schema: ATS.AnyTypeSchema, operation: string): RowObjectSchema {
  let base = resolveWrappers(schema).base;

  if (base.type === TypeName.array || base.type === TypeName.set) {
    base = resolveWrappers((base.def as ATS.ElementDef).element).base;
  }
  if (base.type === TypeName.runtimeType) {
    base = resolveWrappers((base.def as ATS.RuntimeTypeDef).innerType).base;
  }
  if (base.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", `${operation} expects an object or collection-of-objects schema`);
  }
  return base as RowObjectSchema;
}

/** Reads a declared field, rejecting keys the schema does not describe. */
export function resolveRowField(object: RowObjectSchema, key: string, operation: string): ATS.AnyTypeSchema {
  if (typeof key !== "string" || key.length === 0) {
    throw new JITError("INVALID_OPERATION", `${operation} keys must be non-empty strings`);
  }
  const field = object.def.props[key];

  if (!field) {
    throw new JITError("INVALID_OPERATION", `${operation} received unknown key ${JSON.stringify(key)}`, {
      path: [key],
    });
  }
  return field;
}

/**
 * Classifies how a key is physically handled. `numeric` keys can be subtracted,
 * `date` keys must be read through `getTime()` — as a comparison operand and as
 * a map key alike, since Date objects hash by reference.
 */
export function resolveScalarKeyKind(schema: ATS.AnyTypeSchema, key: string, operation: string): ScalarKeyKind {
  let base = resolveWrappers(schema).base;

  if (base.type === TypeName.runtimeType) {
    base = resolveWrappers((base.def as ATS.RuntimeTypeDef).innerType).base;
  }
  if (base.type === TypeName.date) return "date";
  // Float64 keys subtract without branching; bigint cannot (it yields a BigInt).
  if (base.type === TypeName.number || base.type === TypeName.int) return "numeric";
  // A union of scalars — the usual shape of a hand-written enum — is comparable
  // when every branch agrees. Branches of different kinds are rejected: `<`
  // across mixed types is not a total order, which is exactly what a
  // comparator must be.
  if (base.type === TypeName.union) {
    const options = (base.def as ATS.OptionsDef).options;

    if (options.length > 0) {
      const kinds = options.map((option) => resolveScalarKeyKind(option, key, operation));

      if (kinds.every((kind) => kind === kinds[0])) return kinds[0];
    }
  }
  if (
    base.type === TypeName.string ||
    base.type === TypeName.bigint ||
    base.type === TypeName.boolean ||
    base.type === TypeName.literal ||
    base.type === TypeName.enum
  ) {
    return "direct";
  }
  throw new JITError(
    "INVALID_OPERATION",
    `${operation} key ${JSON.stringify(key)} must resolve to a statically comparable scalar`,
    { path: [key] }
  );
}

/** Exact equality domain used to reject joins whose physical Map keys can never match. */
export function resolveScalarKeyDomain(schema: ATS.AnyTypeSchema, key: string, operation: string): ScalarKeyDomain {
  let base = resolveWrappers(schema).base;
  if (base.type === TypeName.runtimeType) {
    base = resolveWrappers((base.def as ATS.RuntimeTypeDef).innerType).base;
  }
  if (base.type === TypeName.string) return "string";
  if (base.type === TypeName.number || base.type === TypeName.int || base.type === TypeName.nan) return "number";
  if (base.type === TypeName.bigint) return "bigint";
  if (base.type === TypeName.boolean) return "boolean";
  if (base.type === TypeName.date) return "date";
  if (base.type === TypeName.literal) {
    const value = (base.def as ATS.LiteralDef).value;
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    if (typeof value === "bigint") return "bigint";
    if (typeof value === "boolean") return "boolean";
  }
  if (base.type === TypeName.enum) {
    const domains = new Set(Object.values((base.def as ATS.EnumDef).values).map((value) => typeof value));
    if (domains.size === 1) {
      const domain = domains.values().next().value;
      if (domain === "string" || domain === "number") return domain;
    }
  }
  if (base.type === TypeName.union) {
    const domains = (base.def as ATS.OptionsDef).options.map((option) =>
      resolveScalarKeyDomain(option, key, operation)
    );
    if (domains.length > 0 && domains.every((domain) => domain === domains[0])) return domains[0] as ScalarKeyDomain;
  }
  throw new JITError("INVALID_OPERATION", `${operation} key ${JSON.stringify(key)} has no scalar equality domain`, {
    path: [key],
  });
}

/** True when the schema admits `undefined` or `null` for this field. */
export function isNullishField(schema: ATS.AnyTypeSchema): boolean {
  const resolved = resolveWrappers(schema);
  return resolved.optional || resolved.nullable;
}
