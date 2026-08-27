import { compileProject } from "../compiler/project.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";

/** Paths a projection may name: a declared field, or a dotted path into one. */
export type ProjectablePath<TValue, TDepth extends readonly unknown[] = []> = TDepth["length"] extends 4
  ? never
  : TValue extends readonly unknown[]
    ? never
    : TValue extends Date
      ? never
      : TValue extends object
        ? {
            [K in Extract<keyof TValue, string>]:
              | K
              | (ProjectablePath<NonNullable<TValue[K]>, [...TDepth, unknown]> extends infer TNested extends string
                  ? `${K}.${TNested}`
                  : never);
          }[Extract<keyof TValue, string>]
        : never;

/** The shape a set of dotted paths selects out of `TValue`. */
export type Projected<TValue, TPaths extends string> = {
  [K in Extract<keyof TValue, string> as K extends TPaths
    ? K
    : TPaths extends `${K}.${string}`
      ? K
      : never]: K extends TPaths
    ? TValue[K]
    : TPaths extends `${K}.${infer TRest}`
      ? null extends TValue[K]
        ? Projected<NonNullable<TValue[K]>, TRest> | null
        : undefined extends TValue[K]
          ? Projected<NonNullable<TValue[K]>, TRest> | undefined
          : Projected<NonNullable<TValue[K]>, TRest>
      : never;
};

export interface ProjectBuilder<TValue> {
  /**
   * Keeps only the named fields. A dotted path narrows the nested object
   * rather than pulling it whole.
   */
  select<const TPaths extends readonly ProjectablePath<TValue>[]>(
    ...paths: TPaths
  ): (value: TValue) => Projected<TValue, TPaths[number]>;
}

/**
 * Narrows a value to the fields a caller actually needs.
 *
 * A projection is a subset of the same shape, built as one object literal over
 * static keys. It is the same selection `JIT.cqrs.query().select()` applies to
 * rows and `JIT.compare.equal().select()` compares by, so a shape declared once
 * is used the same way everywhere.
 */
export function project<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): ProjectBuilder<ATS.TypeofSchema<TSchema>> {
  const unwrapped = unwrapSchema(schema);

  return Object.freeze({
    select: (...paths: string[]) => compileProject(unwrapped, paths),
  }) as ProjectBuilder<ATS.TypeofSchema<TSchema>>;
}
