import { compileMatch, resolveMatchDescriptor } from "../compiler/match.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";

/**
 * The keys a member declares as a literal.
 *
 * The schema knows which property discriminates, but its type does not carry
 * the name — so the tags are read from the shape instead: a discriminator is a
 * property whose type is a single literal rather than the whole primitive.
 */
type LiteralKeys<TMember> = {
  [K in keyof TMember]: TMember[K] extends string
    ? string extends TMember[K]
      ? never
      : K
    : TMember[K] extends number
      ? number extends TMember[K]
        ? never
        : K
      : TMember[K] extends boolean
        ? boolean extends TMember[K]
          ? never
          : K
        : never;
}[keyof TMember];

type Tag<TValue> = TValue extends object ? TValue[LiteralKeys<TValue>] : never;

/** Narrows the union to the member carrying `TTag` on its discriminator. */
type Member<TValue, TTag> = TValue extends object ? (TTag extends TValue[LiteralKeys<TValue>] ? TValue : never) : never;

export interface MatchBuilder<TValue, TResult, TCovered> {
  /** Handles one tag. The value is narrowed to that member. */
  case<const TTag extends Exclude<Tag<TValue> & (string | number | boolean), TCovered>, TNext>(
    tag: TTag,
    handler: (value: Member<TValue, TTag>) => TNext
  ): MatchBuilder<TValue, TResult | TNext, TCovered | TTag>;
  /** Handles everything left over, which makes the match total without listing it. */
  otherwise<TNext>(handler: (value: TValue) => TNext): (value: TValue) => TResult | TNext;
  /**
   * Closes the match, requiring every declared tag to have a case. A missing
   * one is a type error, and also throws at declaration.
   */
  exhaustive(): [Exclude<Tag<TValue> & (string | number | boolean), TCovered>] extends [never]
    ? (value: TValue) => TResult
    : { readonly missing: Exclude<Tag<TValue> & (string | number | boolean), TCovered> };
}

/**
 * Compiled dispatch over a discriminated union.
 *
 * The tags are literals the schema declares, so the match is a `switch` the
 * engine can turn into a jump — not a handler object looked up per call, and
 * not a chain of comparisons.
 */
export function match<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): MatchBuilder<ATS.TypeofSchema<TSchema>, never, never> {
  return createMatch(unwrapSchema(schema), [], []) as never;
}

function createMatch(
  schema: ATS.AnyTypeSchema,
  tags: readonly (string | number | boolean)[],
  handlers: readonly ((value: never) => unknown)[]
): MatchBuilder<unknown, unknown, never> {
  return Object.freeze({
    case: (tag: string | number | boolean, handler: (value: never) => unknown) =>
      createMatch(schema, [...tags, tag], [...handlers, handler]),
    otherwise: (handler: (value: never) => unknown) =>
      compileMatch(resolveMatchDescriptor(schema, tags, true, false), handlers as never, handler as never),
    exhaustive: () => compileMatch(resolveMatchDescriptor(schema, tags, false, true), handlers as never, undefined),
  }) as unknown as MatchBuilder<unknown, unknown, never>;
}
