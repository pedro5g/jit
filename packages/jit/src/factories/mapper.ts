import type { MapperOverridesInput } from "../compiler/mapper/build-mapper-plan.js";
import { createMapperFacade, type MapperFacade } from "../compiler/mapper.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import type { CompileCacheOptions } from "../runtime/cache/compile-cache.js";

type RequiredKeys<TValue> = {
  [TKey in keyof TValue]-?: undefined extends TValue[TKey] ? never : TKey;
}[keyof TValue];

type AutoMatchedKeys<TSource, TTarget> = {
  [TKey in keyof TTarget]-?: TKey extends keyof TSource ? (TSource[TKey] extends TTarget[TKey] ? TKey : never) : never;
}[keyof TTarget];

type RequiredOverrideKeys<TSource, TTarget> = Exclude<RequiredKeys<TTarget>, AutoMatchedKeys<TSource, TTarget>>;

type RenameSources<TSource, TValue> = {
  [TFrom in keyof TSource]-?: TSource[TFrom] extends TValue ? TFrom : never;
}[keyof TSource];

/**
 * One target-field mapping rule: a computed callback, a rename, a
 * rename-and-convert, or a default for missing values.
 */
export type MapperOverride<TSource, TValue> =
  | ((source: TSource) => TValue)
  | {
      readonly from: RenameSources<TSource, TValue>;
      readonly via?: never;
      readonly default?: never;
    }
  | {
      [TFrom in keyof TSource]-?: {
        readonly from: TFrom;
        readonly via: (value: TSource[TFrom], source: TSource) => TValue;
        readonly default?: never;
      };
    }[keyof TSource]
  | { readonly default: TValue; readonly from?: never; readonly via?: never };

/**
 * Override map for `mapper()`: target fields with no compatible same-name
 * source field are required; auto-matched fields may still be overridden.
 */
export type MapperOverrides<TSource, TTarget> = {
  readonly [TKey in RequiredOverrideKeys<TSource, TTarget>]: MapperOverride<TSource, TTarget[TKey]>;
} & {
  readonly [TKey in Exclude<keyof TTarget, RequiredOverrideKeys<TSource, TTarget>>]?: MapperOverride<
    TSource,
    TTarget[TKey]
  >;
};

type MapperOverridesArg<TSource, TTarget> = [RequiredOverrideKeys<TSource, TTarget>] extends [never]
  ? [overrides?: MapperOverrides<TSource, TTarget>, options?: CompileCacheOptions]
  : [overrides: MapperOverrides<TSource, TTarget>, options?: CompileCacheOptions];

/**
 * Compiles a declarative source→target shape mapper.
 *
 * Fields sharing name and compatible type are auto-matched (nested objects
 * and arrays of objects recurse); everything else is declared per target
 * field. Unmapped required target fields are a compile-time type error and a
 * runtime `INVALID_MAPPER`. The output is a whitelist: source fields absent
 * from the target schema can never leak through.
 *
 * @example
 * ```ts
 * const toDTO = JIT.mapper(User, UserDTO, {
 *   fullName: (user) => `${user.first} ${user.last}`,
 *   email: { from: "emailAddress" },
 *   createdAt: { from: "created_at", via: (date) => date.toISOString() },
 *   active: { default: true },
 * }).get("map", "many");
 *
 * toDTO.map(user);   // UserDTO
 * toDTO.many(users); // UserDTO[] — one fused loop, no per-item call
 * ```
 */
export function mapper<TSourceSchema extends ATS.AnyTypeSchema, TTargetSchema extends ATS.AnyTypeSchema>(
  source: SchemaInput<TSourceSchema>,
  target: SchemaInput<TTargetSchema>,
  ...rest: MapperOverridesArg<ATS.TypeofSchema<TSourceSchema>, ATS.TypeofSchema<TTargetSchema>>
): MapperFacade<ATS.TypeofSchema<TSourceSchema>, ATS.TypeofSchema<TTargetSchema>> {
  const [overrides, options] = rest;

  return createMapperFacade(
    unwrapSchema(source),
    unwrapSchema(target),
    (overrides ?? {}) as MapperOverridesInput,
    options
  );
}
