import type * as ATS from "../core/ats/index.js";

/** Element type operated on by row-oriented plans. */
export type RowOf<TSchema extends ATS.AnyTypeSchema> =
  ATS.TypeofSchema<TSchema> extends readonly (infer TRow)[] ? TRow : ATS.TypeofSchema<TSchema>;

/** String keys available on one row. */
export type RowKey<TSchema extends ATS.AnyTypeSchema> = Extract<keyof RowOf<TSchema>, string>;
