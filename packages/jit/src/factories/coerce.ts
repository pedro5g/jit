import type * as ATS from "../core/ats/index.js";
import type { Builder } from "../core/builder/index.js";
import { createBuilder } from "../core/builder/index.js";
import { bigint as bigintFactory } from "./primitive/bigint.js";
import { boolean as booleanFactory } from "./primitive/boolean.js";
import { date as dateFactory } from "./primitive/date.js";
import { number as numberFactory } from "./primitive/number.js";
import { string as stringFactory } from "./primitive/string.js";

function flagged<TSchema extends ATS.AnyTypeSchema>(schema: TSchema): Builder<TSchema> {
  return createBuilder({ ...schema, def: { ...(schema.def as object), coerce: true } } as TSchema);
}

/**
 * zod-style built-in coercions: convert first, validate after. Exactly like
 * zod, the coercion is a flag on the base schema (not a wrapper), so every
 * check chains naturally: `JIT.coerce.number().int().max(100)`.
 *
 * Compiled validators emit the conversion inline (`Number(v)`, `String(v)`,
 * `new Date(v)`, ...) before the type gate — no callback binding, AOT-safe.
 * Merged onto `JIT.coerce` alongside the custom-callback form.
 *
 * @example
 * ```ts
 * const Query = JIT.object({
 *   page: JIT.coerce.number().int().positive(),   // "3" → 3
 *   since: JIT.coerce.date(),                     // "2026-07-05" → Date
 * });
 * ```
 */
export interface NativeCoercions {
  string(): Builder<ATS.StringSchema>;
  number(): Builder<ATS.NumberSchema>;
  boolean(): Builder<ATS.BooleanSchema>;
  bigint(): Builder<ATS.BigIntSchema>;
  date(): Builder<ATS.DateSchema>;
}

export const nativeCoercions: NativeCoercions = {
  string(): Builder<ATS.StringSchema> {
    return flagged(stringFactory().schema);
  },
  number(): Builder<ATS.NumberSchema> {
    return flagged(numberFactory().schema);
  },
  boolean(): Builder<ATS.BooleanSchema> {
    return flagged(booleanFactory().schema);
  },
  bigint(): Builder<ATS.BigIntSchema> {
    return flagged(bigintFactory().schema);
  },
  date(): Builder<ATS.DateSchema> {
    return flagged(dateFactory().schema);
  },
};
