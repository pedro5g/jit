import { resolveAccessContext } from "../compiler/access.js";
import { compileAuthorizedProject, compileProject } from "../compiler/project.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import type { Ability, AccessPlan } from "./access.js";

/**
 * Paths a projection may name: a declared field, or a dotted path into one.
 *
 * @example
 * ```ts
 * type UserPath = ProjectablePath<{ id: number; profile: { name: string } }>;
 * const path: UserPath = "profile.name";
 * ```
 */
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

/**
 * The shape a set of dotted paths selects out of `TValue`.
 *
 * @example
 * ```ts
 * type Summary = Projected<{ id: number; name: string; active: boolean }, "id" | "name">;
 * const summary: Summary = { id: 1, name: "Ada" };
 * ```
 */
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

/**
 * Builds a schema-specialized projection.
 *
 * @example
 * ```ts
 * const User = JIT.object({ id: JIT.number(), name: JIT.string(), email: JIT.string() });
 * const summary = JIT.project(User).select("id", "name");
 * summary({ id: 1, name: "Ada", email: "ada@example.com" });
 * ```
 */
export interface ProjectBuilder<TValue> {
  /** Applies authorization and returns only fields allowed by the ability. */
  authorize<TAction extends string, TActor>(
    ability: Ability<TValue, TAction> | AccessPlan<TValue, TActor, TAction>,
    action: TAction,
    actor?: TActor
  ): (value: TValue) => Partial<TValue>;
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
 *
 * @example
 * ```ts
 * const User = JIT.object({ id: JIT.number(), profile: JIT.object({ name: JIT.string() }) });
 * const summary = JIT.project(User).select("id", "profile.name");
 * ```
 */
export function project<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): ProjectBuilder<ATS.TypeofSchema<TSchema>> {
  const unwrapped = unwrapSchema(schema);

  return Object.freeze({
    authorize: <TAction extends string, TActor>(
      ability: Ability<ATS.TypeofSchema<TSchema>, TAction> | AccessPlan<ATS.TypeofSchema<TSchema>, TActor, TAction>,
      action: TAction,
      actor?: TActor
    ) => {
      const context = resolveAccessContext(ability as object, actor);
      if (context === undefined) {
        throw new JITError("INVALID_OPERATION", "project.authorize() requires an ability created by JIT.access()");
      }
      return compileAuthorizedProject<ATS.TypeofSchema<TSchema>>(context, action);
    },
    select: (...paths: string[]) => compileProject(unwrapped, paths),
  }) as ProjectBuilder<ATS.TypeofSchema<TSchema>>;
}
