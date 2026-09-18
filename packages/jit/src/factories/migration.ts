import {
  appendMigrationEdge,
  compileMigration,
  createMigrationDescriptor,
  type MigrationDescriptor,
} from "../compiler/migration.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import type { MapperOverrides } from "./mapper.js";

type MigrationOverrides<TSource, TTarget> = Omit<MapperOverrides<TSource, TTarget>, "version">;
type MigrationArgs<TSource, TTarget> =
  {} extends MigrationOverrides<TSource, TTarget>
    ? [overrides?: MigrationOverrides<TSource, TTarget>]
    : [overrides: MigrationOverrides<TSource, TTarget>];

/**
 * A versioned schema migration plan.
 *
 * @example
 * ```ts
 * const UserV1 = JIT.object({ version: JIT.literal(1), name: JIT.string() });
 * const UserV2 = JIT.object({ version: JIT.literal(2), displayName: JIT.string() });
 * const migrateUser = JIT.migrate(UserV1).to(UserV2, {
 *   displayName: (input) => input.name,
 * });
 * migrateUser({ version: 1, name: "Ada" });
 * ```
 */
export interface MigrationPlan<TInput, TCurrentSchema extends ATS.AnyTypeSchema> {
  /** Migrates one value through the declared version chain. */
  (value: TInput | ATS.TypeofSchema<TCurrentSchema>): ATS.TypeofSchema<TCurrentSchema>;
  /** Appends a migration edge to a new current schema. */
  to<TNextSchema extends ATS.AnyTypeSchema>(
    target: SchemaInput<TNextSchema>,
    ...args: MigrationArgs<ATS.TypeofSchema<TCurrentSchema>, ATS.TypeofSchema<TNextSchema>>
  ): MigrationPlan<TInput | ATS.TypeofSchema<TCurrentSchema>, TNextSchema>;
  readonly versions: readonly (string | number)[];
  readonly current: SchemaInput<TCurrentSchema>;
  /** Explains the version-switch strategy and number of edges. */
  explain(): {
    readonly strategy: "VersionSwitch";
    readonly versions: readonly (string | number)[];
    readonly passes: number;
    readonly complexity: "O(remaining edges)";
  };
}

/**
 * Compiles a schema-version chain into one switch plus one MapperPlan per edge.
 *
 * @example
 * ```ts
 * const current = JIT.migrate(UserV1).to(UserV2, { displayName: (input) => input.name });
 * current.explain().strategy; // "VersionSwitch"
 * ```
 */
export function migrate<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): MigrationPlan<ATS.TypeofSchema<TSchema>, TSchema> {
  return createMigrationPlan(createMigrationDescriptor(unwrapSchema(schema)), schema) as never;
}

function createMigrationPlan<TCurrentSchema extends ATS.AnyTypeSchema>(
  descriptor: MigrationDescriptor,
  current: SchemaInput<TCurrentSchema>
): MigrationPlan<unknown, TCurrentSchema> {
  const compiled = compileMigration<unknown, ATS.TypeofSchema<TCurrentSchema>>(descriptor) as MigrationPlan<
    unknown,
    TCurrentSchema
  >;

  Object.defineProperties(compiled, {
    to: {
      value: (target: SchemaInput<ATS.AnyTypeSchema>, overrides?: Readonly<Record<string, unknown>>) =>
        createMigrationPlan(appendMigrationEdge(descriptor, unwrapSchema(target), overrides), target),
    },
    versions: { value: descriptor.versions },
    current: { value: current },
    explain: {
      value: () =>
        Object.freeze({
          strategy: "VersionSwitch" as const,
          versions: descriptor.versions,
          passes: descriptor.edges.length,
          complexity: "O(remaining edges)" as const,
        }),
    },
  });
  return compiled;
}
