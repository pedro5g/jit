/**
 * AOT definition entrypoint. It exposes the same namespace surface as the
 * runtime package, but artifacts are descriptors that deliberately cannot
 * execute before `jit generate` has lowered them.
 */

import {
  addMember,
  applyDddCapability,
  type CapabilityOptions,
  initialEffectiveSchema,
  type LifecycleDefinition,
  type ManagedFieldDescriptor,
  reapplyManagedFields,
} from "./classes/effective-schema.js";
import type { ResolvedMemberTable } from "./classes/members.js";
import { isOverwriteDescriptor, overwrite } from "./classes/overwrite.js";
import {
  type AccessRule,
  resolveAccessContext,
  resolveAccessDescriptor,
  unconditionalFields,
} from "./compiler/access.js";
import { type AssertionDescriptor, emitAssertionSource, resolveAssertionDescriptor } from "./compiler/assertion.js";
import type { BinaryArray, BinaryRowSet } from "./compiler/binary-rowset.js";
import { resolveCacheKeyDescriptor } from "./compiler/cache-key.js";
import { allFieldPaths, resolveChangedDescriptor } from "./compiler/changed.js";
import type { Clone } from "./compiler/clone.js";
import type { CompiledCodec } from "./compiler/codec.js";
import { type CsvDescriptor, type CsvOptions, resolveCsvDescriptor } from "./compiler/csv.js";
import type { Diff } from "./compiler/diff.js";
import { type Equal, emitEqualSource } from "./compiler/equal.js";
import type { ExecutionPlan, ExecutionStage } from "./compiler/execution-plan.js";
import type { Format } from "./compiler/format.js";
import type { Hash } from "./compiler/hash.js";
import { type IndexShape, resolveIndexDescriptor, resolveIndexKeysFromFacts } from "./compiler/indexing.js";
import type { JsonChunksOptions } from "./compiler/json-chunks.js";
import type { ToJsonSchemaOptions } from "./compiler/json-schema/index.js";
import { resolveLookupDescriptor } from "./compiler/lookup.js";
import type { Mask } from "./compiler/mask.js";
import { resolveMatchDescriptor } from "./compiler/match.js";
import { appendMigrationEdge, createMigrationDescriptor, type MigrationDescriptor } from "./compiler/migration.js";
import type { Mock } from "./compiler/mock.js";
import {
  type CollectionMutationDescriptor,
  collectionMutationCacheKey,
  emitCollectionMutationSource,
  explainCollectionMutation,
} from "./compiler/mutation/index.js";
import {
  appendNdjsonFilter,
  createNdjsonDescriptor,
  type NdjsonDescriptor,
  selectNdjson,
  withNdjsonSink,
} from "./compiler/ndjson.js";
import { type OrderDirection, resolveOrderingDescriptor } from "./compiler/ordering.js";
import { buildProjectionTree } from "./compiler/projection.js";
import {
  ALL_CHANNELS,
  type ReconcileChanges,
  type ReconcileChannels,
  type ReconcileSink,
  resolveReconcileDescriptor,
} from "./compiler/reconcile.js";
import { resolveWrappers } from "./compiler/resolvers/resolve-wrappers.js";
import { inspectRules, type RulesSink } from "./compiler/rules.js";
import type { Sanitize } from "./compiler/sanitize.js";
import type { Serialize } from "./compiler/serialize.js";
import type { UpdatePatch } from "./compiler/update.js";
import type { SafeParseResult } from "./compiler/validate.js";
import type { QueryConditionNode } from "./core/ast/index.js";
import type * as ATS from "./core/ats/index.js";
import { createSchema, TypeName } from "./core/ats/index.js";
import type { SchemaInput } from "./core/builder/index.js";
import { unwrapSchema } from "./core/builder/index.js";
import { AOT_ARTIFACT, type AOTArtifact, type ArtifactDescriptor } from "./core/host.js";
import { JITError } from "./errors/index.js";
import type { Ability, AccessBuilder, AccessPlan } from "./factories/access.js";
import type {
  AssertionOptions,
  ClassCapability,
  ClassFactory,
  ClassMethodsInput,
  FactoryOptions,
  FactoryResultMode,
  FactoryValidationOptions,
  SoftDeleteOptions,
  TimestampOptions,
  VersionedOptions,
} from "./factories/class.js";
import {
  type CollectionMutation,
  type CollectionMutationHost,
  createCollectionState,
} from "./factories/collection-state.js";
import {
  type AuthorizedApiRequest,
  type CqrsInput,
  type CqrsQuery,
  type CqrsQueryFor,
  type ParsedCqrsInput,
  resolveCqrsAuthorization,
} from "./factories/cqrs.js";
import type { CsvNamespace, CsvParsePlan, CsvSchemaOptions, CsvStringifyPlan } from "./factories/csv.js";
import type { CallableArtifact, ExecutionArtifact, SchemaArtifact } from "./factories/execution.js";
import * as RuntimeJIT from "./factories/index.js";
import type { IndexBuilder, KeyedIndexPlan } from "./factories/indexing.js";
import type { LookupBuilder, LookupPlan } from "./factories/lookup.js";
import type { MatchBuilder } from "./factories/match.js";
import type { MigrationPlan } from "./factories/migration.js";
import type { NdjsonNamespace, NdjsonParsePlan, NdjsonStringifyPlan } from "./factories/ndjson.js";
import type { ProjectBuilder } from "./factories/project.js";
import {
  type BinaryQueryBuilder,
  createConditionBuilder,
  type QueryBuilder,
  type QueryConditionBuilder,
} from "./factories/query.js";
import type { ReconcileChange, ReconcilePlan, ResolvedChannels } from "./factories/reconcile.js";
import type { RuleOptions, RulesBuilder, RulesPlan } from "./factories/rules.js";
import type { ValidationDiagnosticOptions } from "./factories/runtime-ops.js";
import type { SortBuilder, SortPlan } from "./factories/sort.js";
import { getArtifact, registerArtifact } from "./runtime/artifact-registry.js";

type DefineFunction<TFunction extends (...args: never[]) => unknown> = AOTArtifact<TFunction> &
  Pick<CallableArtifact<TFunction>, "compile" | "explain" | "plan">;

type RuntimeCollectionDescriptor = {
  readonly schema: ATS.ArraySchema<ATS.AnyTypeSchema>;
  readonly plan: ExecutionPlan;
  filter(predicate: unknown): RuntimeCollectionDescriptor;
  select(...fields: string[]): RuntimeCollectionDescriptor;
};

export type Typeof<TSchemaLike> = import("./core/ats/typeof.js").Typeof<TSchemaLike>;
export type { Strict } from "./core/builder/types.js";

const NO_EFFECTS = Object.freeze({
  mayThrow: false,
  mayAllocate: false,
  usesExternalBindings: false,
});
const THROWING_EFFECTS = Object.freeze({
  mayThrow: true,
  mayAllocate: false,
  usesExternalBindings: false,
});

function parseAsync<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: ValidationDiagnosticOptions
) {
  return validationStub(schema, "parseAsync", options) as unknown as ExecutionArtifact<
    unknown,
    Promise<ATS.TypeofSchema<TSchema>>
  >;
}

function safeParseAsync<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: ValidationDiagnosticOptions
) {
  return validationStub(schema, "safeParseAsync", options) as unknown as ExecutionArtifact<
    unknown,
    Promise<SafeParseResult<ATS.TypeofSchema<TSchema>>>
  >;
}

const validate = Object.freeze({
  is<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationStub(schema, "is") as DefineFunction<(value: unknown) => value is ATS.TypeofSchema<TSchema>>;
  },
  parse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>, options?: ValidationDiagnosticOptions) {
    return validationStub(schema, "parse", options) as unknown as SchemaArtifact<unknown, TSchema>;
  },
  safeParse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>, options?: ValidationDiagnosticOptions) {
    return validationStub(schema, "safeParse", options) as unknown as ExecutionArtifact<
      unknown,
      SafeParseResult<ATS.TypeofSchema<TSchema>>
    >;
  },
  issues<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationStub(schema, "issues") as unknown as ExecutionArtifact<unknown, IterableIterator<unknown>>;
  },
  async: Object.freeze({
    parse: parseAsync,
    safeParse: safeParseAsync,
  }),
});

const json = Object.freeze({
  value: RuntimeJIT.json.value,
  parse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return executionStub<TSchema, (json: string) => ATS.TypeofSchema<TSchema>>(schema, [
      {
        ...stage("json.decode", "json-text", "value"),
        schema: unwrapSchema(schema),
        provides: ["json-syntax-valid"],
      } as ExecutionStage,
    ]) as unknown as SchemaArtifact<string, TSchema>;
  },
  stringify<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return executionStub<TSchema, Serialize<ATS.TypeofSchema<TSchema>>>(schema, [
      stage("value", "value", "value"),
      stage("json.encode", "value", "json-text"),
    ]);
  },
  stringifyChunks<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>, options?: JsonChunksOptions) {
    const unwrapped = unwrapSchema(schema);

    return executionStub<TSchema, (value: ATS.TypeofSchema<TSchema>) => IterableIterator<string>>(unwrapped, [
      {
        ...stage("value", "value", "value"),
        schema: unwrapped,
      } as ExecutionStage,
      {
        ...stage("json.encode", "value", "json-text"),
        schema: unwrapped,
        mode: "chunks",
        ...(options?.chunkBytes === undefined ? {} : { chunkBytes: options.chunkBytes }),
      } as ExecutionStage,
    ]);
  },
});

const binary = Object.freeze({
  encode<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return executionStub<TSchema, (value: ATS.TypeofSchema<TSchema>) => Uint8Array>(schema, [
      stage("value", "value", "value"),
      stage("binary.encode", "value", "binary"),
    ]);
  },
  codec<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return operationStub<TSchema, (value: ATS.TypeofSchema<TSchema>) => Uint8Array>(
      schema,
      "codec",
      "value"
    ) as unknown as CompiledCodec<ATS.TypeofSchema<TSchema>>;
  },
  decode<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return executionStub<TSchema, (bytes: Uint8Array | ArrayBuffer) => ATS.TypeofSchema<TSchema>>(schema, [
      {
        ...stage("binary.decode", "binary", "value"),
        schema: unwrapSchema(schema),
        provides: ["binary-layout-valid"],
      } as ExecutionStage,
    ]) as unknown as SchemaArtifact<Uint8Array | ArrayBuffer, TSchema>;
  },
});

function from<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): SchemaArtifact<ATS.TypeofSchema<TSchema>, TSchema> {
  return executionStub<TSchema, (value: ATS.TypeofSchema<TSchema>) => ATS.TypeofSchema<TSchema>>(schema, [
    {
      ...stage("value", "value", "value"),
      schema: unwrapSchema(schema),
    } as ExecutionStage,
  ]) as unknown as SchemaArtifact<ATS.TypeofSchema<TSchema>, TSchema>;
}

function map<TSource extends ATS.AnyTypeSchema, TTarget extends ATS.AnyTypeSchema>(
  source: SchemaInput<TSource>,
  target: SchemaInput<TTarget>,
  mapping: Readonly<Record<string, unknown>> = {}
): SchemaArtifact<ATS.TypeofSchema<TSource>, TTarget> {
  const sourceSchema = unwrapSchema(source);
  const targetSchema = unwrapSchema(target);

  return executionStub<TTarget, (value: ATS.TypeofSchema<TSource>) => ATS.TypeofSchema<TTarget>>(targetSchema, [
    {
      ...stage("value", "value", "value"),
      schema: sourceSchema,
    } as ExecutionStage,
    mapStage(sourceSchema, targetSchema, false, mapping),
  ]) as unknown as SchemaArtifact<ATS.TypeofSchema<TSource>, TTarget>;
}

function mapMany<TSource extends ATS.AnyTypeSchema, TTarget extends ATS.AnyTypeSchema>(
  source: SchemaInput<TSource>,
  target: SchemaInput<TTarget>,
  mapping: Readonly<Record<string, unknown>> = {}
): SchemaArtifact<ATS.TypeofSchema<TSource>[], ATS.ArraySchema<TTarget>> {
  const sourceSchema = unwrapSchema(source);
  const targetSchema = unwrapSchema(target);
  const collection = unwrapSchema(RuntimeJIT.array(sourceSchema)) as ATS.ArraySchema<TSource>;
  const result = unwrapSchema(RuntimeJIT.array(targetSchema)) as ATS.ArraySchema<TTarget>;

  return executionStub<ATS.ArraySchema<TTarget>, (value: ATS.TypeofSchema<TSource>[]) => ATS.TypeofSchema<TTarget>[]>(
    result,
    [
      {
        ...stage("value", "value", "value"),
        schema: collection,
      } as ExecutionStage,
      mapStage(sourceSchema, targetSchema, true, mapping),
    ]
  ) as unknown as SchemaArtifact<ATS.TypeofSchema<TSource>[], ATS.ArraySchema<TTarget>>;
}

function equal<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineSelectableEqual<ATS.TypeofSchema<TSchema>> {
  // The runtime lowers a selection to an ordinary `equal` over the projection's
  // schema; the definition host declares the very same artifact, so the two
  // stay one-to-one without a parallel API.
  const select = (...paths: string[]) =>
    operationStub(
      buildProjectionTree(unwrapSchema(schema), paths, "JIT.compare.equal().select()").schema,
      "equal",
      "boolean"
    );

  return operationStub<TSchema, Equal<ATS.TypeofSchema<TSchema>>>(schema, "equal", "boolean", {
    select,
  }) as DefineSelectableEqual<ATS.TypeofSchema<TSchema>>;
}

interface DefineSelectableEqual<TValue> extends DefineFunction<Equal<TValue>> {
  select(...paths: readonly string[]): DefineFunction<Equal<TValue>>;
}

/**
 * A change mask resolves its watched fields at declaration time, so a bad path
 * fails here rather than at generation.
 */
function changed<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): DefineChanged {
  const unwrapped = unwrapSchema(schema);
  const stub = defineChangedMask(unwrapped, allFieldPaths(unwrapped, "JIT.compare.changed()"));

  Object.defineProperty(stub, "select", { value: (...paths: string[]) => defineChangedMask(unwrapped, paths) });
  return stub as DefineChanged;
}

interface DefineChanged extends DefineFunction<(left: unknown, right: unknown) => number> {
  select(...paths: readonly string[]): DefineFunction<(left: unknown, right: unknown) => number>;
  has(mask: number, path: string): boolean;
  readonly fields: readonly string[];
}

function defineChangedMask(schema: ATS.AnyTypeSchema, paths: readonly string[]) {
  const descriptor = resolveChangedDescriptor(schema, paths);
  const fields = descriptor.fields.map((field) => field.path);
  const bits = new Map(fields.map((path, index) => [path, index]));
  const stub = function aotChangedArtifact(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  } as unknown as DefineChanged;

  Object.defineProperties(stub, {
    [AOT_ARTIFACT]: {
      value: {
        artifactId: "operation:changed",
        schemaId: schema.type,
        operation: { kind: "operation", op: "changed" },
      } satisfies ArtifactDescriptor,
    },
    fields: { value: Object.freeze(fields) },
    has: {
      value: (mask: number | bigint, path: string) => {
        const bit = bits.get(path);

        if (bit === undefined) return false;
        return typeof mask === "bigint" ? (mask & (1n << BigInt(bit))) !== 0n : (mask & (1 << bit)) !== 0;
      },
    },
  });
  registerArtifact(stub, { kind: "changed-plan", schema, descriptor });
  return stub;
}

function clone<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Clone<ATS.TypeofSchema<TSchema>>> {
  return operationStub<TSchema, Clone<ATS.TypeofSchema<TSchema>>>(schema, "clone", "value");
}

function diff<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Diff<ATS.TypeofSchema<TSchema>>> {
  return operationStub<TSchema, Diff<ATS.TypeofSchema<TSchema>>>(schema, "diff", "value");
}

function hash<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Hash<ATS.TypeofSchema<TSchema>>> {
  return operationStub<TSchema, Hash<ATS.TypeofSchema<TSchema>>>(schema, "hash", "value");
}

function format<TSchema extends ATS.StringSchema>(schema: SchemaInput<TSchema>): DefineFunction<Format> {
  return operationStub<TSchema, Format>(schema, "format", "value");
}

function validationStub<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  operation: "is" | "parse" | "safeParse" | "parseAsync" | "safeParseAsync" | "issues",
  options?: ValidationDiagnosticOptions
): DefineFunction<(...args: never[]) => unknown> {
  return executionStub(schema, [
    stage("value", "value", "value"),
    {
      ...stage("validate", "value", operation === "is" ? "boolean" : operation === "issues" ? "issues" : "value"),
      operation,
      ...(options?.maxIssues === undefined ? {} : { maxIssues: options.maxIssues }),
      provides: operation === "is" ? [] : ["schema-validated"],
    } as ExecutionStage,
  ]);
}

/**
 * AOT mirror of the runtime namespace. `to` still produces the real document
 * (it is static data the generator inlines), while `from` builds a schema the
 * generator lowers exactly like a hand-written one.
 */
const jsonSchema = Object.freeze({
  to<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>, options?: ToJsonSchemaOptions) {
    const document = RuntimeJIT.jsonSchema.to(schema, options);

    registerArtifact(document, {
      kind: "operation",
      schema: unwrapSchema(schema),
      op: "jsonSchema",
    });
    return document;
  },
  from: RuntimeJIT.jsonSchema.from,
});

function mock<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Mock<ATS.TypeofSchema<TSchema>>> {
  return operationStub<TSchema, Mock<ATS.TypeofSchema<TSchema>>>(schema, "mock", "value");
}

function mask<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Mask<ATS.TypeofSchema<TSchema>>> {
  return operationStub<TSchema, Mask<ATS.TypeofSchema<TSchema>>>(schema, "mask", "value");
}

function sanitize<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Sanitize<ATS.TypeofSchema<TSchema>>> {
  return operationStub<TSchema, Sanitize<ATS.TypeofSchema<TSchema>>>(schema, "sanitize", "value");
}

function defineSort<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): SortBuilder<TSchema> {
  const unwrapped = unwrapSchema(schema);

  return Object.freeze({
    by(key: string, direction: OrderDirection = "asc") {
      return createDefineSortPlan(unwrapped, [{ key, direction }]);
    },
  }) as SortBuilder<TSchema>;
}

function createDefineSortPlan<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  criteria: readonly {
    readonly key: string;
    readonly direction: OrderDirection;
  }[]
): SortPlan<TSchema> {
  const descriptor = resolveOrderingDescriptor(schema, criteria);
  const stub = function aotSortArtifact(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  } as unknown as SortPlan<TSchema>;
  const fail = (): never => {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };

  Object.defineProperties(stub, {
    [AOT_ARTIFACT]: {
      value: {
        artifactId: "operation:sort",
        schemaId: schema.type,
        operation: { kind: "operation", op: "sort" },
      } satisfies ArtifactDescriptor,
    },
    compare: { value: fail },
    inPlace: { value: fail },
    by: {
      value: (key: string, direction: OrderDirection = "asc") => createDefineSortPlan(schema, [{ key, direction }]),
    },
    thenBy: {
      value: (key: string, direction: OrderDirection = "asc") =>
        createDefineSortPlan(schema, [...criteria, { key, direction }]),
    },
  });
  registerArtifact(stub, { kind: "sort-plan", schema, descriptor });
  return stub;
}

function defineIndex<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): IndexBuilder<TSchema> {
  const unwrapped = unwrapSchema(schema);
  const plan = createDefineIndexPlan(
    unwrapped,
    resolveIndexKeysFromFacts(unwrapped),
    "unique"
  ) as IndexBuilder<TSchema>;

  Object.defineProperty(plan, "by", {
    value: (...keys: string[]) => createDefineIndexPlan(unwrapped, keys, "unique"),
  });
  return plan;
}

function createDefineIndexPlan<TRow, TIndex>(
  schema: ATS.AnyTypeSchema,
  keys: readonly string[] | undefined,
  shape: IndexShape
): KeyedIndexPlan<TRow, TIndex> {
  const stub = function aotIndexArtifact(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  } as unknown as KeyedIndexPlan<TRow, TIndex>;

  Object.defineProperties(stub, {
    [AOT_ARTIFACT]: {
      value: {
        artifactId: "operation:index",
        schemaId: schema.type,
        operation: { kind: "operation", op: "index" },
      } satisfies ArtifactDescriptor,
    },
    cached: { value: stub },
    grouped: { value: () => createDefineIndexPlan(schema, keys, "grouped") },
  });
  // Resolving here keeps a definition file honest: an index with no key fact
  // and no `.by()` fails at declaration rather than at generation.
  if (keys || resolveIndexKeysFromFacts(schema)) {
    registerArtifact(stub, {
      kind: "index-plan",
      schema,
      descriptor: resolveIndexDescriptor(schema, keys, shape),
    });
  }
  return stub;
}

/**
 * A lookup resolves its key and access path at declaration time, so a
 * definition file that names no key over a collection with no key fact fails
 * here rather than at generation.
 */
function defineLookup<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): LookupBuilder<TSchema> {
  const unwrapped = unwrapSchema(schema);
  const plan = createDefineLookupPlan(unwrapped, undefined) as LookupBuilder<TSchema>;

  Object.defineProperty(plan, "by", { value: (key: string) => createDefineLookupPlan(unwrapped, key) });
  return plan;
}

function createDefineLookupPlan(schema: ATS.AnyTypeSchema, key: string | undefined): LookupPlan<unknown, unknown> {
  const stub = function aotLookupArtifact(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  } as unknown as LookupPlan<unknown, unknown>;
  const lookup = resolveLookupDescriptor(schema, key);

  Object.defineProperties(stub, {
    [AOT_ARTIFACT]: {
      value: {
        artifactId: "operation:lookup",
        schemaId: schema.type,
        operation: { kind: "operation", op: "lookup" },
      } satisfies ArtifactDescriptor,
    },
    explain: {
      value: () =>
        Object.freeze({
          strategy: lookup.choice.strategy,
          reason: lookup.choice.reason,
          complexity: lookup.choice.complexity,
          facts: lookup.choice.facts,
        }),
    },
  });
  registerArtifact(stub, { kind: "lookup-plan", schema, lookup });
  return stub;
}

function defineMatch<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): MatchBuilder<ATS.TypeofSchema<TSchema>, never, never> {
  return createDefineMatch(unwrapSchema(schema), [], []) as never;
}

function createDefineMatch(
  schema: ATS.AnyTypeSchema,
  tags: readonly (string | number | boolean)[],
  handlers: readonly ((value: never) => unknown)[]
): MatchBuilder<unknown, unknown, never> {
  const finish = (fallback: ((value: never) => unknown) | undefined, exhaustive: boolean) => {
    const descriptor = resolveMatchDescriptor(schema, tags, fallback !== undefined, exhaustive);
    const stub = function aotMatchArtifact(): never {
      throw new JITError(
        "JIT_AOT_001_ARTIFACT_EXECUTED",
        "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
      );
    };
    const names = tags.map((_, index) => `__case${index}`);

    Object.defineProperty(stub, AOT_ARTIFACT, {
      value: {
        artifactId: "operation:match",
        schemaId: schema.type,
        operation: { kind: "operation", op: "match" },
      } satisfies ArtifactDescriptor,
    });
    registerArtifact(stub, {
      kind: "match-plan",
      schema,
      descriptor,
      bindingNames: names.concat(fallback === undefined ? [] : ["__fallback"]),
      bindingValues: handlers.concat(fallback === undefined ? [] : [fallback]),
    });
    return stub;
  };

  return Object.freeze({
    case: (tag: string | number | boolean, handler: (value: never) => unknown) =>
      createDefineMatch(schema, [...tags, tag], [...handlers, handler]),
    otherwise: (handler: (value: never) => unknown) => finish(handler, false),
    exhaustive: () => finish(undefined, true),
  }) as unknown as MatchBuilder<unknown, unknown, never>;
}

function defineMigrate<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): MigrationPlan<ATS.TypeofSchema<TSchema>, TSchema> {
  return createDefineMigration(createMigrationDescriptor(unwrapSchema(schema)), schema) as never;
}

function createDefineMigration<TSchema extends ATS.AnyTypeSchema>(
  descriptor: MigrationDescriptor,
  current: SchemaInput<TSchema>
): MigrationPlan<unknown, TSchema> {
  const stub = function aotMigrationArtifact(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  } as unknown as MigrationPlan<unknown, TSchema>;

  Object.defineProperties(stub, {
    [AOT_ARTIFACT]: {
      value: {
        artifactId: "operation:migrate",
        schemaId: descriptor.schemas[0]?.type ?? "unknown",
        operation: { kind: "operation", op: "migrate" },
      } satisfies ArtifactDescriptor,
    },
    to: {
      value: (target: SchemaInput<ATS.AnyTypeSchema>, overrides?: Readonly<Record<string, unknown>>) =>
        createDefineMigration(appendMigrationEdge(descriptor, unwrapSchema(target), overrides), target),
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
  registerArtifact(stub, { kind: "migration-plan", descriptor });
  return stub;
}

function defineCsvStub(descriptor: CsvDescriptor): (...args: never[]) => never {
  const stub = function aotCsvArtifact(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };

  Object.defineProperty(stub, AOT_ARTIFACT, {
    value: {
      artifactId: `operation:csv.${descriptor.operation}.${descriptor.sink}`,
      schemaId: descriptor.schema.type,
      operation: { kind: "operation", op: "csv" },
    } satisfies ArtifactDescriptor,
  });
  registerArtifact(stub, { kind: "csv-plan", descriptor });
  return stub;
}

function defineCsvParse<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: CsvSchemaOptions<ATS.TypeofSchema<TSchema>>
): CsvParsePlan<ATS.TypeofSchema<TSchema>> {
  const unwrapped = unwrapSchema(schema);
  const result = defineCsvStub(
    resolveCsvDescriptor(unwrapped, "parse", "result", options as CsvOptions)
  ) as unknown as CsvParsePlan<ATS.TypeofSchema<TSchema>>;

  Object.defineProperty(result, "to", {
    value: Object.freeze({
      iterator: () => defineCsvStub(resolveCsvDescriptor(unwrapped, "parse", "iterator", options as CsvOptions)),
      visitor: () => defineCsvStub(resolveCsvDescriptor(unwrapped, "parse", "visitor", options as CsvOptions)),
    }),
  });
  return result;
}

function defineCsvStringify<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: CsvSchemaOptions<ATS.TypeofSchema<TSchema>>
): CsvStringifyPlan<ATS.TypeofSchema<TSchema>> {
  const unwrapped = unwrapSchema(schema);
  const result = defineCsvStub(
    resolveCsvDescriptor(unwrapped, "stringify", "string", options as CsvOptions)
  ) as unknown as CsvStringifyPlan<ATS.TypeofSchema<TSchema>>;

  Object.defineProperty(result, "to", {
    value: Object.freeze({
      iterator: () => defineCsvStub(resolveCsvDescriptor(unwrapped, "stringify", "iterator", options as CsvOptions)),
    }),
  });
  return result;
}

const csv: CsvNamespace = Object.freeze({ parse: defineCsvParse, stringify: defineCsvStringify });

function defineNdjsonStub(descriptor: NdjsonDescriptor): (...args: never[]) => never {
  const stub = function aotNdjsonArtifact(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };
  Object.defineProperty(stub, AOT_ARTIFACT, {
    value: {
      artifactId: `operation:ndjson.${descriptor.operation}.${descriptor.sink}`,
      schemaId: descriptor.schema.type,
      operation: { kind: "operation", op: "ndjson" },
    } satisfies ArtifactDescriptor,
  });
  registerArtifact(stub, { kind: "ndjson-plan", descriptor });
  return stub;
}

function createDefineNdjsonParse(descriptor: NdjsonDescriptor): NdjsonParsePlan<unknown> {
  const result = defineNdjsonStub(descriptor) as unknown as NdjsonParsePlan<unknown>;

  Object.defineProperties(result, {
    validate: { value: () => result },
    where: {
      value: (predicate: (query: QueryConditionBuilder<unknown>) => QueryConditionNode) => {
        const state = createConditionBuilder(descriptor.bindingValues.length);
        return createDefineNdjsonParse(appendNdjsonFilter(descriptor, predicate(state.builder), state.bindings));
      },
    },
    select: { value: (...fields: string[]) => createDefineNdjsonParse(selectNdjson(descriptor, fields)) },
    to: {
      value: Object.freeze({
        iterator: () => defineNdjsonStub(withNdjsonSink(descriptor, "iterator")),
        visitor: () => defineNdjsonStub(withNdjsonSink(descriptor, "visitor")),
        ndjson: () => defineNdjsonStub(withNdjsonSink(descriptor, "ndjson")),
      }),
    },
  });
  return result;
}

function defineNdjsonParse<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): NdjsonParsePlan<ATS.TypeofSchema<TSchema>> {
  return createDefineNdjsonParse(createNdjsonDescriptor(unwrapSchema(schema), "parse")) as never;
}

function defineNdjsonStringify<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): NdjsonStringifyPlan<ATS.TypeofSchema<TSchema>> {
  const descriptor = createNdjsonDescriptor(unwrapSchema(schema), "stringify");
  const result = defineNdjsonStub(descriptor) as unknown as NdjsonStringifyPlan<ATS.TypeofSchema<TSchema>>;

  Object.defineProperty(result, "to", {
    value: Object.freeze({ iterator: () => defineNdjsonStub(withNdjsonSink(descriptor, "iterator")) }),
  });
  return result;
}

const ndjson: NdjsonNamespace = Object.freeze({ parse: defineNdjsonParse, stringify: defineNdjsonStringify });

/**
 * A reconciliation resolves its identity, channels and sink at declaration
 * time, so a definition file that names no identity over a collection with no
 * identity fact fails here rather than at generation.
 */
function defineReconcile<TSchema extends ATS.AnyTypeSchema, const TChannels extends Partial<ReconcileChannels> = {}>(
  schema: SchemaInput<TSchema>,
  channels?: TChannels
): ReconcilePlan<TSchema, ResolvedChannels<TChannels>, ReconcileChange<unknown>> {
  return createDefineReconcilePlan(unwrapSchema(schema), undefined, { ...ALL_CHANNELS, ...channels }, "value") as never;
}

function createDefineReconcilePlan(
  schema: ATS.AnyTypeSchema,
  key: string | undefined,
  channels: ReconcileChannels,
  changes: ReconcileChanges
): ReconcilePlan<ATS.AnyTypeSchema, unknown, unknown> {
  const stub = (sink: ReconcileSink) => {
    const artifact = function aotReconcileArtifact(): never {
      throw new JITError(
        "JIT_AOT_001_ARTIFACT_EXECUTED",
        "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
      );
    } as unknown as ReconcilePlan<ATS.AnyTypeSchema, unknown, unknown>;

    Object.defineProperty(artifact, AOT_ARTIFACT, {
      value: {
        artifactId: "operation:reconcile",
        schemaId: schema.type,
        operation: { kind: "operation", op: "reconcile" },
      } satisfies ArtifactDescriptor,
    });
    registerArtifact(artifact, {
      kind: "reconcile-plan",
      schema,
      descriptor: resolveReconcileDescriptor(schema, key, channels, changes, sink),
    });
    return artifact;
  };
  const plan = stub("result");

  Object.defineProperties(plan, {
    by: { value: (next: string) => createDefineReconcilePlan(schema, next, channels, changes) },
    changes: { value: (mode: ReconcileChanges) => createDefineReconcilePlan(schema, key, channels, mode) },
    to: { value: Object.freeze({ iterator: () => stub("iterator"), visitor: () => stub("visitor") }) },
  });
  return plan;
}

/** A projection resolves its selection at declaration time, so a bad path fails here. */
function defineProject<TSchema extends ATS.AnyTypeSchema>(
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
      const stub = function aotAuthorizedProjectArtifact(): never {
        throw new JITError(
          "JIT_AOT_001_ARTIFACT_EXECUTED",
          "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
        );
      } as unknown as (value: ATS.TypeofSchema<TSchema>) => Partial<ATS.TypeofSchema<TSchema>>;
      registerArtifact(stub, {
        kind: "authorized-project-plan",
        schema: unwrapped,
        descriptor: context.descriptor,
        actor: context.actor,
        action,
      });
      return stub;
    },
    select: (...paths: string[]) => {
      const stub = function aotProjectArtifact(): never {
        throw new JITError(
          "JIT_AOT_001_ARTIFACT_EXECUTED",
          "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
        );
      } as unknown as (value: unknown) => unknown;

      Object.defineProperty(stub, AOT_ARTIFACT, {
        value: {
          artifactId: "operation:project",
          schemaId: unwrapped.type,
          operation: { kind: "operation", op: "project" },
        } satisfies ArtifactDescriptor,
      });
      registerArtifact(stub, {
        kind: "project-plan",
        schema: unwrapped,
        tree: buildProjectionTree(unwrapped, paths, "JIT.project()"),
      });
      return stub;
    },
  }) as ProjectBuilder<ATS.TypeofSchema<TSchema>>;
}

/**
 * The patch namespace, declared. `apply` is the update stub, because in the
 * runtime it is literally `JIT.state.update`; the two RFC contracts declare their own
 * reconstructive artifacts.
 */
const patch = Object.freeze({
  // `update` is not stubbed on this host, so `apply` is the same function the
  // runtime namespace exposes — which is exactly the one-to-one the contract asks for.
  apply: RuntimeJIT.state.update,
  merge: <TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) => definePatchStub(schema, "merge"),
  json: <TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) => definePatchStub(schema, "json"),
});

function definePatchStub<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  mode: "merge" | "json"
): DefineFunction<(value: unknown, patch: unknown) => unknown> {
  const unwrapped = unwrapSchema(schema);
  const stub = function aotPatchArtifact(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  } as unknown as DefineFunction<(value: unknown, patch: unknown) => unknown>;

  Object.defineProperty(stub, AOT_ARTIFACT, {
    value: {
      artifactId: `operation:patch.${mode}`,
      schemaId: unwrapped.type,
      operation: { kind: "operation", op: "patch" },
    } satisfies ArtifactDescriptor,
  });
  registerArtifact(stub, { kind: "patch-plan", schema: unwrapped, mode });
  return stub;
}

/** A cache key resolves its selection at declaration time, so a bad path fails here. */
function defineCacheKeyBuilder(schema: SchemaInput<ATS.AnyTypeSchema>, form: "string" | "hash") {
  const unwrapped = unwrapSchema(schema);

  return Object.freeze({
    select: (...paths: string[]) => {
      const stub = function aotCacheKeyArtifact(): never {
        throw new JITError(
          "JIT_AOT_001_ARTIFACT_EXECUTED",
          "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
        );
      } as unknown as (value: unknown) => unknown;

      Object.defineProperty(stub, AOT_ARTIFACT, {
        value: {
          artifactId: `operation:cacheKey.${form}`,
          schemaId: unwrapped.type,
          operation: { kind: "operation", op: "cacheKey" },
        } satisfies ArtifactDescriptor,
      });
      registerArtifact(stub, {
        kind: "cache-key-plan",
        schema: unwrapped,
        descriptor: resolveCacheKeyDescriptor(unwrapped, paths, form),
      });
      return stub;
    },
  });
}

const cacheKey = Object.assign((schema: SchemaInput<ATS.AnyTypeSchema>) => defineCacheKeyBuilder(schema, "string"), {
  string: (schema: SchemaInput<ATS.AnyTypeSchema>) => defineCacheKeyBuilder(schema, "string"),
  hash: (schema: SchemaInput<ATS.AnyTypeSchema>) => defineCacheKeyBuilder(schema, "hash"),
});

/** Canonicalization is fully described by the schema, so the stub carries only that. */
function defineCanonical<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): (value: ATS.TypeofSchema<TSchema>) => ATS.TypeofSchema<TSchema> {
  const unwrapped = unwrapSchema(schema);
  const stub = function aotCanonicalArtifact(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  } as unknown as (value: ATS.TypeofSchema<TSchema>) => ATS.TypeofSchema<TSchema>;

  Object.defineProperty(stub, AOT_ARTIFACT, {
    value: {
      artifactId: "operation:canonical",
      schemaId: unwrapped.type,
      operation: { kind: "operation", op: "canonical" },
    } satisfies ArtifactDescriptor,
  });
  registerArtifact(stub, { kind: "canonical-plan", schema: unwrapped });
  return stub;
}

/**
 * An ability resolves its rules at declaration time, so a field a rule names
 * but the subject does not declare fails here rather than at generation.
 */
function defineAccess<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): AccessBuilder<ATS.TypeofSchema<TSchema>> {
  return defineAccessPlan(unwrapSchema(schema), undefined, []) as AccessBuilder<ATS.TypeofSchema<TSchema>>;
}

function defineAccessPlan(
  subject: ATS.AnyTypeSchema,
  actor: ATS.AnyTypeSchema | undefined,
  rules: readonly AccessRule[]
) {
  const descriptor = resolveAccessDescriptor(subject, actor, rules);
  const stub = function aotAccessArtifact(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  } as unknown as AccessBuilder<unknown>;
  // The runtime builder holds the rule shapes; reusing it keeps the two hosts
  // from drifting on how a predicate becomes a condition.
  const runtimePlan = RuntimeJIT.access(subject as never);
  const add = (effect: "can" | "cannot") => (action: string, rule?: unknown) => {
    const next = (effect === "can" ? runtimePlan.can : runtimePlan.cannot) as (
      action: string,
      rule?: unknown
    ) => unknown;
    const built = getArtifact(next.call(runtimePlan, action, rule) as object);

    if (built?.kind !== "access-plan") throw new JITError("INVALID_OPERATION", "access rule could not be resolved");
    return defineAccessPlan(subject, actor, [...rules, ...built.descriptor.rules.slice(-1)]);
  };

  Object.defineProperties(stub, {
    [AOT_ARTIFACT]: {
      value: {
        artifactId: "operation:access",
        schemaId: subject.type,
        operation: { kind: "operation", op: "access" },
      } satisfies ArtifactDescriptor,
    },
    actor: { value: (next: SchemaInput<ATS.AnyTypeSchema>) => defineAccessPlan(subject, unwrapSchema(next), rules) },
    can: { value: add("can") },
    cannot: { value: add("cannot") },
    actions: { value: descriptor.actions },
    fields: { value: (action: string) => unconditionalFields(descriptor, action) },
  });
  registerArtifact(stub, { kind: "access-plan", schema: subject, descriptor });
  return stub;
}

function defineRules<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RulesBuilder<ATS.TypeofSchema<TSchema>> {
  return defineRulesPlan(RuntimeJIT.rules(schema) as unknown as AnyDefineRulesPlan) as unknown as RulesBuilder<
    ATS.TypeofSchema<TSchema>
  >;
}

type AnyDefineRulesPlan = RulesPlan<unknown, Readonly<Record<string, unknown>>, string, unknown>;
type AnyDefineRuleOptions = RuleOptions<unknown, Readonly<Record<string, unknown>>, unknown>;

/**
 * The define host mirrors every rules sink one-to-one. Nothing is executed
 * here: each sink is a reconstructive artifact the generator lowers, so a
 * definition file can compose rules without compiling them.
 */
function defineRulesPlan(runtime: AnyDefineRulesPlan): AnyDefineRulesPlan {
  const artifact = getArtifact(runtime);

  if (artifact?.kind !== "rules-plan") {
    throw new JITError("INVALID_OPERATION", "rules descriptor could not be resolved");
  }

  const register = (name: RulesSink, ruleId?: string): (() => never) => {
    const fail = function aotRulesArtifact(): never {
      throw new JITError(
        "JIT_AOT_001_ARTIFACT_EXECUTED",
        "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
      );
    };

    Object.defineProperty(fail, AOT_ARTIFACT, {
      value: {
        artifactId: `operation:rules:${ruleId === undefined ? name : `${name}:${ruleId}`}`,
        schemaId: artifact.schema.type,
        operation: { kind: "operation", op: "rules" },
      } satisfies ArtifactDescriptor,
    });
    registerArtifact(fail, { ...artifact, sink: name, ...(ruleId === undefined ? {} : { ruleId }) });
    return fail;
  };
  const test = register("test");
  const some = register("some");
  const first = register("first");
  const match = register("match");
  const run = register("run");
  const explain = register("explain");
  const predicates = new Map<string, () => never>();
  const visitor = register("visitor");
  const iterator = register("iterator");
  const many = register("many") as (() => never) & { to?: unknown };
  const manyVisitor = register("many-visitor");
  const manyIterator = register("many-iterator");
  const plan = {} as AnyDefineRulesPlan;

  Object.defineProperty(many, "to", {
    value: Object.freeze({ visitor: () => manyVisitor, iterator: () => manyIterator }),
  });
  Object.defineProperties(plan, {
    inputs: {
      value: (shape: Readonly<Record<string, SchemaInput>>) =>
        defineRulesPlan((runtime.inputs as (value: typeof shape) => AnyDefineRulesPlan)(shape)),
    },
    rule: {
      value: (id: string, options: AnyDefineRuleOptions) =>
        defineRulesPlan(
          (runtime.rule as (value: string, rule: AnyDefineRuleOptions) => AnyDefineRulesPlan)(id, options)
        ),
    },
    test: { value: test },
    some: { value: some },
    first: { value: first },
    match: { value: match },
    run: { value: run },
    explain: { value: explain },
    predicate: {
      value: (rule: string) => {
        let value = predicates.get(rule);

        if (value === undefined) {
          value = register("predicate", rule);
          predicates.set(rule, value);
        }
        return value;
      },
    },
    many: { value: () => many },
    to: { value: Object.freeze({ visitor: () => visitor, iterator: () => iterator }) },
    ids: { value: artifact.descriptor.ids, enumerable: true },
    inspect: { value: () => inspectRules(artifact.descriptor) },
  });
  Object.freeze(plan);

  registerArtifact(plan, { ...artifact, sink: "plan" });
  return plan;
}

function defineCqrsQuery<TElement>(
  target: BinaryArray<TElement> | BinaryRowSet<TElement>
): BinaryQueryBuilder<TElement, TElement, TElement[]>;
function defineCqrsQuery<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): CqrsQueryFor<TSchema>;
function defineCqrsQuery(
  schema: SchemaInput | BinaryArray<unknown> | BinaryRowSet<unknown>
):
  | CqrsQuery<ATS.AnyTypeSchema>
  | QueryBuilder<ATS.AnyTypeSchema, unknown, unknown[]>
  | BinaryQueryBuilder<unknown, unknown, unknown[]> {
  const builder = RuntimeJIT.cqrs.query(schema as never) as unknown as
    | CqrsQuery<ATS.AnyTypeSchema>
    | QueryBuilder<ATS.AnyTypeSchema, unknown, unknown[]>
    | BinaryQueryBuilder<unknown, unknown, unknown[]>;
  if (getArtifact(builder)?.kind === "query" || !("~query" in builder)) {
    return builder as QueryBuilder<ATS.AnyTypeSchema, unknown, unknown[]>;
  }
  return wrapDefineCqrsQuery(builder as CqrsQuery<ATS.AnyTypeSchema>);
}

function wrapDefineCqrsQuery<TQuery extends (...args: never[]) => unknown>(builder: TQuery): TQuery {
  const artifact = getArtifact(builder);
  if (artifact?.kind !== "query-plan") {
    throw new JITError("INVALID_QUERY", "CQRS definition query is missing its reconstructive QueryProgram");
  }
  const terminal = (mode: "array" | "iterator" | "async-iterator" | "visitor") => {
    const stub = function aotQueryArtifact(): never {
      throw new JITError(
        "JIT_AOT_001_ARTIFACT_EXECUTED",
        "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
      );
    } as (...args: unknown[]) => unknown;

    Object.defineProperty(stub, AOT_ARTIFACT, {
      value: {
        artifactId: `query:${mode}`,
        schemaId: artifact.schema.type,
        operation: {
          kind: "query",
          ...(artifact.program.params === undefined ? {} : { params: artifact.program.params }),
        },
      } satisfies ArtifactDescriptor,
    });
    registerArtifact(stub, { ...artifact, mode });
    return stub;
  };
  const stub = terminal("array") as unknown as Record<string, unknown>;
  const source = builder as unknown as Record<string, unknown>;
  const chainMethods = [
    "params",
    "authorize",
    "filter",
    "where",
    "select",
    "unique",
    "distinct",
    "keyed",
    "groupBy",
    "orderBy",
    "flatMap",
    "take",
    "limit",
    "drop",
    "takeWhile",
    "dropWhile",
    "chunk",
    "window",
    "pairwise",
    "scan",
    "groupAdjacentBy",
    "delete",
    "update",
    "sum",
    "count",
    "avg",
    "min",
    "max",
    "aggregate",
    "first",
    "findIndex",
    "some",
    "every",
  ] as const;

  for (const key of chainMethods) {
    const method = source[key] as (...args: unknown[]) => (...args: never[]) => unknown;
    Object.defineProperty(stub, key, {
      value: (...args: unknown[]) => wrapDefineCqrsQuery(method(...args)),
    });
  }
  const joinMethod = source.join as (...args: unknown[]) => {
    on(...keys: unknown[]): (...args: never[]) => unknown;
  };
  Object.defineProperties(stub, {
    join: {
      value: (...args: unknown[]) => {
        const pending = joinMethod(...args);
        return Object.freeze({
          on: (...keys: unknown[]) => wrapDefineJoin(pending.on(...keys)),
        });
      },
    },
    "~query": { get: () => source["~query"] },
    explain: {
      value: (...args: unknown[]) => (source.explain as (...values: unknown[]) => unknown)(...args),
    },
    to: {
      value: Object.freeze({
        iterator: () => terminal("iterator"),
        asyncIterator: () => terminal("async-iterator"),
        visitor: () => terminal("visitor"),
      }),
    },
    lazy: {
      value: () => {
        const lazy = terminal("iterator") as unknown as Record<string, unknown>;
        Object.defineProperties(lazy, {
          explain: {
            value: (...args: unknown[]) => (source.explain as (...values: unknown[]) => unknown)(...args),
          },
          to: {
            value: Object.freeze({
              asyncIterator: () => terminal("async-iterator"),
              visitor: () => terminal("visitor"),
            }),
          },
        });
        return lazy;
      },
    },
  });
  registerArtifact(stub as object, artifact);
  return stub as unknown as TQuery;
}

function wrapDefineJoin<TJoin extends (...args: never[]) => unknown>(join: TJoin): TJoin {
  const artifact = getArtifact(join);
  if (artifact?.kind !== "join-plan") {
    throw new JITError("INVALID_QUERY", "CQRS definition join is missing its reconstructive JoinPlan");
  }
  const stub = function aotJoinArtifact(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  } as unknown as TJoin;
  Object.defineProperties(stub, {
    [AOT_ARTIFACT]: {
      value: {
        artifactId: `query:join:${artifact.plan.kind}`,
        schemaId: artifact.plan.leftSchema.type,
        operation: {
          kind: "query",
          ...(artifact.plan.leftProgram.params === undefined ? {} : { params: artifact.plan.leftProgram.params }),
        },
      } satisfies ArtifactDescriptor,
    },
    explain: {
      value: () => (join as unknown as { explain(): unknown }).explain(),
    },
    "~query": {
      value: (join as unknown as { readonly "~query": unknown })["~query"],
    },
  });
  registerArtifact(stub, artifact);
  return stub;
}

const cqrs = Object.freeze({
  ...RuntimeJIT.cqrs,
  query: defineCqrsQuery,
});

function defineApiParse<TSchema extends ATS.AnyTypeSchema>(definition: CqrsInput<TSchema>) {
  const artifact = getArtifact(definition);
  if (artifact?.kind !== "cqrs-input") {
    throw new JITError("INVALID_QUERY", "API query boundary is missing reconstructive parser metadata");
  }
  const stub = function aotCqrsParser(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  } as (input: unknown) => ParsedCqrsInput;
  Object.defineProperty(stub, AOT_ARTIFACT, {
    value: {
      artifactId: "cqrs:parse",
      schemaId: definition.schema.type,
      operation: { kind: "query" },
    } satisfies ArtifactDescriptor,
  });
  registerArtifact(stub, {
    kind: "cqrs-parser",
    definition: artifact.definition,
    source: artifact.source,
  });
  return stub;
}

function defineApiAuthorize<TSchema extends ATS.AnyTypeSchema, TAction extends string, TActor>(
  definition: CqrsInput<TSchema>,
  ability: Parameters<typeof RuntimeJIT.api.authorize<TSchema, TAction, TActor>>[1],
  action: TAction
) {
  const resolved = resolveCqrsAuthorization(definition, ability as object, action);
  const stub = function aotCqrsAuthorizedParser(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  } as (input: unknown, actor?: TActor) => AuthorizedApiRequest;
  Object.defineProperty(stub, AOT_ARTIFACT, {
    value: {
      artifactId: "cqrs:authorize",
      schemaId: definition.schema.type,
      operation: { kind: "query" },
    } satisfies ArtifactDescriptor,
  });
  registerArtifact(stub, resolved.artifact);
  return stub;
}

const api = Object.freeze({
  query: RuntimeJIT.api.query,
  parse: defineApiParse,
  authorize: defineApiAuthorize,
});

function defineCollectionMutation<TRow, TParams>(
  schema: ATS.AnyTypeSchema,
  descriptor: CollectionMutationDescriptor,
  bindings: readonly unknown[]
): CollectionMutation<TRow, TParams> {
  const source = emitCollectionMutationSource(descriptor);
  const names = bindings.map((_, index) => `__q${index}`);
  const needsEqual =
    descriptor.kind === "upsert" ||
    descriptor.kind === "replaceAt" ||
    descriptor.kind === "replaceByKey" ||
    descriptor.kind === "replaceWhere";
  const explanation = explainCollectionMutation(descriptor);
  const stub = function aotCollectionMutation(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  } as unknown as CollectionMutation<TRow, TParams>;

  Object.defineProperties(stub, {
    explain: { enumerable: false, value: () => explanation },
    [AOT_ARTIFACT]: {
      value: {
        artifactId: collectionMutationCacheKey(descriptor),
        schemaId: schema.type,
        operation: { kind: "operation", op: "state.collection" },
      } satisfies ArtifactDescriptor,
    },
  });
  registerArtifact(stub, {
    kind: "collection-mutation-plan",
    schema,
    source,
    bindingNames: names,
    bindingValues: bindings,
    equalSource: needsEqual ? emitEqualSource((schema.def as ATS.ElementDef).element) : undefined,
    cacheKey: collectionMutationCacheKey(descriptor),
    explanation,
  });
  return stub;
}

const buildCollectionState = createCollectionState as (
  schema: SchemaInput<ATS.ArraySchema<ATS.AnyTypeSchema>>,
  compile: CollectionMutationHost
) => unknown;
const defineCollection = ((schema: SchemaInput<ATS.ArraySchema>) =>
  buildCollectionState(
    schema as SchemaInput<ATS.ArraySchema<ATS.AnyTypeSchema>>,
    defineCollectionMutation
  )) as typeof RuntimeJIT.state.collection;

const state = Object.freeze({
  ...RuntimeJIT.state,
  collection: defineCollection,
  patch,
  reconcile: defineReconcile,
});

function operationStub<TSchema extends ATS.AnyTypeSchema, TFunction extends (...args: never[]) => unknown>(
  schema: SchemaInput<TSchema>,
  operation: "equal" | "clone" | "diff" | "hash" | "format" | "mask" | "sanitize" | "codec" | "jsonSchema" | "mock",
  output: "value" | "boolean",
  extras?: Readonly<Record<string, unknown>>
): DefineFunction<TFunction> {
  return executionStub<TSchema, TFunction>(
    schema,
    [stage("value", "value", "value"), { ...stage("operation", "value", output), operation } as ExecutionStage],
    undefined,
    extras
  );
}

function executionStub<TSchema extends ATS.AnyTypeSchema, TFunction extends (...args: never[]) => unknown>(
  schema: SchemaInput<TSchema>,
  stages: readonly ExecutionStage[],
  queryBuilder?: RuntimeCollectionDescriptor,
  /** Members a specific operation adds, installed before the stub is frozen. */
  extras?: Readonly<Record<string, unknown>>
): DefineFunction<TFunction> {
  const unwrapped = unwrapSchema(schema);
  const plan: ExecutionPlan = Object.freeze({
    version: 1,
    schema: unwrapped,
    stages: Object.freeze(stages),
  });
  const operation: ArtifactDescriptor["operation"] = {
    kind: "operation",
    op: "fromJSON",
  };
  const stub = function aotExecutionArtifact(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  } as unknown as DefineFunction<TFunction>;

  Object.defineProperties(stub, {
    plan: { enumerable: true, value: plan },
    compile: { enumerable: false, value: () => stub },
    explain: { enumerable: false, value: () => plan },
    [AOT_ARTIFACT]: {
      enumerable: false,
      value: {
        artifactId: `execution:${stages.map((item) => item.kind).join(">")}`,
        schemaId: unwrapped.type,
        operation,
      },
    },
  });
  const artifact = stub as unknown as Record<string, unknown>;
  const append = (nextSchema: ATS.AnyTypeSchema, nextStage: ExecutionStage, nextQuery?: RuntimeCollectionDescriptor) =>
    executionStub(nextSchema, [...plan.stages, nextStage], nextQuery);

  Object.defineProperties(artifact, {
    schema: { enumerable: true, value: unwrapped },
    validate: {
      enumerable: false,
      value: () =>
        append(unwrapped, {
          ...stage("validate", "value", "value"),
          schema: unwrapped,
          operation: "parse",
          provides: ["schema-validated"],
        } as ExecutionStage),
    },
    map: {
      enumerable: false,
      value: (target: SchemaInput<ATS.AnyTypeSchema>, mapping: Readonly<Record<string, unknown>> = {}) => {
        const targetSchema = unwrapSchema(target);
        const many = unwrapped.type === "array";
        const source = many ? (unwrapped as ATS.ArraySchema<ATS.AnyTypeSchema>).def.element : unwrapped;
        const output = many
          ? (unwrapSchema(RuntimeJIT.array(targetSchema)) as ATS.ArraySchema<ATS.AnyTypeSchema>)
          : targetSchema;

        return append(output, mapStage(source, targetSchema, many, mapping));
      },
    },
    transform: {
      enumerable: false,
      value: (target: SchemaInput<ATS.AnyTypeSchema>, transforms: ATS.TransformSpec<unknown>) => {
        const targetSchema = unwrapSchema(target);
        const many = unwrapped.type === "array";
        const source = many ? (unwrapped as ATS.ArraySchema<ATS.AnyTypeSchema>).def.element : unwrapped;
        const output = many
          ? (unwrapSchema(RuntimeJIT.array(targetSchema)) as ATS.ArraySchema<ATS.AnyTypeSchema>)
          : targetSchema;

        return append(output, transformStage(source, targetSchema, many, transforms));
      },
    },
    update: {
      enumerable: false,
      value: (patch: UpdatePatch<unknown>) => {
        const many = unwrapped.type === "array";
        const schema = many ? (unwrapped as ATS.ArraySchema<ATS.AnyTypeSchema>).def.element : unwrapped;

        return append(unwrapped, updateStage(schema, many, patch));
      },
    },
    mask: {
      enumerable: false,
      value: () => {
        const many = unwrapped.type === "array";
        const schema = many ? (unwrapped as ATS.ArraySchema<ATS.AnyTypeSchema>).def.element : unwrapped;

        return append(unwrapped, securityStage(schema, "mask", many));
      },
    },
    sanitize: {
      enumerable: false,
      value: () => {
        const many = unwrapped.type === "array";
        const schema = many ? (unwrapped as ATS.ArraySchema<ATS.AnyTypeSchema>).def.element : unwrapped;

        return append(unwrapped, securityStage(schema, "sanitize", many));
      },
    },
    to: {
      enumerable: true,
      value: Object.freeze({
        array: () => append(unwrapped, stage("to.array", "value", "value")),
        json: () =>
          append(unwrapped, {
            ...stage("json.encode", "value", "json-text"),
            schema: unwrapped,
          } as ExecutionStage),
        binary: () =>
          append(unwrapped, {
            ...stage("binary.encode", "value", "binary"),
            schema: unwrapped,
          } as ExecutionStage),
      }),
    },
  });

  if (unwrapped.type === "array") {
    const source = queryBuilder ?? (RuntimeJIT.from(unwrapped) as unknown as RuntimeCollectionDescriptor);

    Object.defineProperties(artifact, {
      filter: {
        enumerable: false,
        value: (predicate: unknown) => {
          const next = source.filter(predicate);
          const query = next.plan.stages[next.plan.stages.length - 1];

          return append(next.schema, query, next);
        },
      },
      select: {
        enumerable: false,
        value: (...fields: string[]) => {
          const next = source.select(...fields);
          const query = next.plan.stages[next.plan.stages.length - 1];

          return append(next.schema, query, next);
        },
      },
    });
  }
  if (extras !== undefined) {
    for (const [name, value] of Object.entries(extras)) {
      Object.defineProperty(artifact, name, { enumerable: false, value });
    }
  }
  registerArtifact(stub as object, { kind: "execution", plan });
  return Object.freeze(stub);
}

function mapStage(
  source: ATS.AnyTypeSchema,
  target: ATS.AnyTypeSchema,
  many: boolean,
  mapping: Readonly<Record<string, unknown>>
): ExecutionStage {
  return {
    ...stage("map", "value", "value"),
    schema: target,
    source,
    target,
    many,
    bindings: [mapping],
    provides: ["mapped"],
    effects: {
      ...NO_EFFECTS,
      mayAllocate: true,
      usesExternalBindings: Object.keys(mapping).length > 0,
    },
  } as ExecutionStage;
}

function transformStage(
  source: ATS.AnyTypeSchema,
  target: ATS.AnyTypeSchema,
  many: boolean,
  transforms: ATS.TransformSpec<unknown>
): ExecutionStage {
  assertTransformTarget(source, target, transforms);

  return {
    ...stage("transform", "value", "value"),
    schema: target,
    source,
    target,
    many,
    transforms: transforms as Readonly<Record<string, unknown>>,
    provides: ["transformed"],
    effects: {
      ...NO_EFFECTS,
      mayAllocate: true,
      usesExternalBindings: Object.keys(transforms).length > 0,
    },
  } as ExecutionStage;
}

function assertTransformTarget(
  source: ATS.AnyTypeSchema,
  target: ATS.AnyTypeSchema,
  transforms: ATS.TransformSpec<unknown>
): void {
  if (transforms === null || typeof transforms !== "object" || Array.isArray(transforms)) {
    throw new JITError("INVALID_OPERATION", "execution transforms must be a field-to-callback object");
  }

  const sourceObject = resolveWrappers(source).base;
  const targetObject = resolveWrappers(target).base;

  if (sourceObject.type !== "object" || targetObject.type !== "object") {
    throw new JITError("INVALID_OPERATION", "execution transforms require object source and target schemas");
  }

  const sourceKeys = Object.keys((sourceObject as ATS.ObjectSchema).def.props);
  const targetKeys = Object.keys((targetObject as ATS.ObjectSchema).def.props);

  if (sourceKeys.length !== targetKeys.length || sourceKeys.some((key) => !targetKeys.includes(key))) {
    throw new JITError(
      "INVALID_OPERATION",
      "execution transform targets must preserve the source object's field set; use .map() for projections or renames"
    );
  }

  for (const key of Object.keys(transforms)) {
    if (!sourceKeys.includes(key)) {
      throw new JITError("INVALID_OPERATION", `execution transform selected unknown field ${JSON.stringify(key)}`);
    }
    if (typeof transforms[key as keyof typeof transforms] !== "function") {
      throw new JITError("INVALID_OPERATION", `execution transform for ${JSON.stringify(key)} must be a function`);
    }
  }
}

function updateStage(schema: ATS.AnyTypeSchema, many: boolean, patch: unknown): ExecutionStage {
  return {
    ...stage("update", "value", "value"),
    schema,
    many,
    patch,
    provides: ["updated"],
    effects: { ...NO_EFFECTS, mayAllocate: true, usesExternalBindings: true },
  } as ExecutionStage;
}

function securityStage(schema: ATS.AnyTypeSchema, operation: "mask" | "sanitize", many: boolean): ExecutionStage {
  return {
    ...stage("security", "value", "value"),
    schema,
    operation,
    many,
    provides: [operation === "mask" ? "masked" : "sanitized"],
    effects: { ...NO_EFFECTS, mayAllocate: true },
  } as ExecutionStage;
}

interface DefinedClassMethod {
  readonly name: string;
  readonly kind: "method" | "get" | "set";
  readonly source: Function;
}

interface DefinedClassAssertionFailure {
  readonly rule: string | undefined;
  readonly field: string | undefined;
  readonly code: string;
  readonly message: string;
  readonly priority: number;
  readonly error?: unknown;
}

interface DefinedClassAssertions {
  readonly descriptors: readonly AssertionDescriptor[];
  readonly source: string;
  readonly bindingNames: readonly string[];
  readonly bindingValues: readonly unknown[];
  readonly failures: readonly DefinedClassAssertionFailure[];
}

interface DefinedClassPolicy {
  readonly result: FactoryResultMode;
  readonly create: boolean;
  readonly hydrate: boolean;
  readonly maxIssues?: number;
  readonly errorPriority?: number;
  readonly errorPriorityExplicit?: boolean;
  readonly error?: unknown;
  readonly assertions?: DefinedClassAssertions;
}

interface DefinedClassState {
  readonly declaredSchema: ATS.AnyTypeSchema;
  readonly schema: ATS.AnyTypeSchema;
  readonly abstract: boolean;
  readonly aggregate: boolean;
  readonly construction: "constructor" | "factory";
  readonly factories: { readonly create: string | false; readonly hydrate: string | false };
  readonly capabilities: readonly string[];
  readonly methods: readonly DefinedClassMethod[];
  readonly lifecycle: LifecycleDefinition;
  readonly managedFields: readonly ManagedFieldDescriptor[];
  readonly members: ResolvedMemberTable;
  readonly accessors: readonly unknown[];
  readonly validationConfigured: boolean;
  readonly policy: DefinedClassPolicy | undefined;
}

const DEFINED_RESERVED_MEMBER_NAMES: ReadonlySet<string> = new Set([
  "constructor",
  "schema",
  "create",
  "hydrate",
  "extends",
  "factories",
  "construction",
  "accessors",
  "identity",
  "validate",
  "assert",
]);

type DefinedCapability = ClassCapability<object> & {
  readonly __memberNames?: readonly string[];
  readonly __options?: unknown;
};

const DEFINE_EXECUTION_ERROR =
  "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead.";

function defineArtifactFailure(): never {
  throw new JITError("JIT_AOT_001_ARTIFACT_EXECUTED", DEFINE_EXECUTION_ERROR);
}

function defineCapability(
  kind: string,
  memberNames: readonly string[] = [],
  options?: CapabilityOptions
): DefinedCapability {
  return Object.freeze({
    kind,
    __memberNames: Object.freeze([...memberNames]),
    ...(options === undefined ? {} : { __options: options }),
    install() {},
  }) as DefinedCapability;
}

function defineClassState(schema: ATS.AnyTypeSchema, abstract: boolean, aggregate: boolean): DefinedClassState {
  const initial = initialEffectiveSchema(schema);
  const members = initial.members.clone();
  const capabilities: string[] = [];
  if (aggregate) {
    for (const name of ["update", "raise", "peekEvents", "pullEvents", "commit"])
      addMember(members, name, "preset", "ddd.aggregateRoot", "method");
  }
  return {
    declaredSchema: schema,
    schema,
    abstract,
    aggregate,
    construction: aggregate ? "factory" : "constructor",
    factories: aggregate ? { create: "create", hydrate: "hydrate" } : { create: false, hydrate: false },
    capabilities,
    methods: [],
    lifecycle: {},
    managedFields: [],
    members,
    accessors: [],
    validationConfigured: false,
    policy: undefined,
  };
}

function definedCapabilityOptions(value: DefinedCapability): CapabilityOptions | undefined {
  return value.__options as CapabilityOptions | undefined;
}

function definedCapabilityMembers(value: DefinedCapability): readonly string[] {
  return value.__memberNames ?? [];
}

function isDefinedSchema(value: unknown): value is ATS.AnyTypeSchema {
  return typeof value === "object" && value !== null && "type" in value && "def" in value;
}

function isDefinedSchemaInput(value: unknown): value is SchemaInput<ATS.AnyTypeSchema> {
  return (
    isDefinedSchema(value) ||
    (typeof value === "object" && value !== null && "schema" in value && typeof value.schema === "object")
  );
}

function defineClassExtensions(
  state: DefinedClassState,
  extensions: readonly (DefinedCapability | ClassMethodsInput)[]
): DefinedClassState {
  let next = state;
  for (const extension of extensions) {
    if (
      typeof extension === "object" &&
      extension !== null &&
      typeof (extension as { install?: unknown }).install === "function"
    ) {
      const capability = extension as DefinedCapability;
      if (next.capabilities.includes(capability.kind)) {
        throw new JITError(
          "INVALID_OPERATION",
          `Class capability ${JSON.stringify(capability.kind)} is already installed`
        );
      }
      for (const name of definedCapabilityMembers(capability)) {
        if (next.members.has(name)) {
          throw new JITError(
            "CLASS_MEMBER_ALREADY_EXISTS",
            `Member ${JSON.stringify(name)} already exists; use JIT.overwrite(...) explicitly`
          );
        }
      }
      if (
        capability.kind === "ddd.timestamps" ||
        capability.kind === "ddd.softDelete" ||
        capability.kind === "ddd.versioned"
      ) {
        let resolved: ReturnType<typeof applyDddCapability>;
        try {
          resolved = applyDddCapability(
            {
              schema: next.schema,
              lifecycle: next.lifecycle,
              managedFields: next.managedFields,
              members: next.members,
            },
            capability.kind,
            definedCapabilityOptions(capability)
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new JITError("DDD_CAPABILITY_SCHEMA_CONFLICT", `${capability.kind} declaration conflict: ${message}`);
        }
        next = {
          ...next,
          schema: resolved.schema,
          lifecycle: resolved.lifecycle,
          managedFields: resolved.managedFields,
          members: resolved.members,
          capabilities: [...next.capabilities, capability.kind],
        };
      } else {
        const members = next.members.clone();
        for (const name of definedCapabilityMembers(capability))
          addMember(members, name, "capability", capability.kind, "method");
        next = { ...next, capabilities: [...next.capabilities, capability.kind], members };
      }
      continue;
    }

    const members = next.members.clone();
    const methods = [...next.methods];
    let schema = next.schema;
    for (const name of Object.getOwnPropertyNames(extension)) {
      const descriptor = Object.getOwnPropertyDescriptor(extension, name);
      if (descriptor === undefined) continue;
      const value = descriptor.value;
      if (isOverwriteDescriptor(value)) {
        const existing = members.get(name);
        if (existing === undefined) {
          throw new JITError(
            "CLASS_OVERWRITE_TARGET_NOT_FOUND",
            `Class member ${JSON.stringify(name)} does not exist. JIT.overwrite() can only replace an existing member.`
          );
        }
        if (isDefinedSchemaInput(value.value)) {
          if (existing.kind !== "field")
            throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is not a schema field`);
          const replacement = unwrapSchema(value.value as SchemaInput<ATS.AnyTypeSchema>);
          const object = resolveWrappers(schema).base;
          if (object.type !== TypeName.object)
            throw new JITError("INVALID_OPERATION", "Class schema must be an object");
          const props = { ...(object as ATS.ObjectSchema).def.props, [name]: replacement };
          schema = createSchema(
            TypeName.object,
            {
              props,
              unknownKeys: (object as ATS.ObjectSchema).def.unknownKeys,
              catchall: (object as ATS.ObjectSchema).def.catchall,
              checks: (object as ATS.ObjectSchema).def.checks,
            },
            object.annotations
          );
          const rechecked = applyManagedFieldsForDefine(schema, next.managedFields);
          schema = rechecked;
          const effectiveObject = resolveWrappers(schema).base;
          const effectiveField =
            effectiveObject.type === TypeName.object
              ? (effectiveObject as ATS.ObjectSchema).def.props[name]
              : replacement;
          members.replace(name, { ...existing, source: "overwrite", schema: effectiveField });
        } else {
          if (existing.kind === "field")
            throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is a schema field`);
          if (typeof value.value !== "function")
            throw new JITError("INVALID_OPERATION", `Overwrite ${JSON.stringify(name)} must provide a method`);
          const replacement = { name, kind: "method" as const, source: value.value };
          const index = methods.findIndex((method) => method.name === name);
          if (index === -1) methods.push(replacement);
          else methods[index] = replacement;
          members.replace(name, { ...existing, source: "overwrite", descriptor: { value: value.value } });
        }
        continue;
      }
      if (members.has(name) || DEFINED_RESERVED_MEMBER_NAMES.has(name)) {
        throw new JITError(
          "CLASS_MEMBER_ALREADY_EXISTS",
          `Member ${JSON.stringify(name)} already exists. Use ${JSON.stringify(`${name}: JIT.overwrite(...)`)} to replace it.`
        );
      }
      if (descriptor.get === undefined && descriptor.set === undefined && typeof value !== "function") {
        throw new JITError("INVALID_OPERATION", `Class extension ${JSON.stringify(name)} must be a method or getter`);
      }
      const kind = descriptor.get === undefined ? (descriptor.set === undefined ? "method" : "set") : "get";
      methods.push({ name, kind, source: (descriptor.get ?? descriptor.set ?? value) as Function });
      addMember(
        members,
        name,
        "extension",
        "custom extension",
        kind === "get" ? "getter" : kind === "set" ? "setter" : "method"
      );
    }
    next = { ...next, schema, methods, members };
  }
  return next;
}

function applyManagedFieldsForDefine(
  schema: ATS.AnyTypeSchema,
  managedFields: readonly ManagedFieldDescriptor[]
): ATS.AnyTypeSchema {
  if (managedFields.length === 0) return schema;
  try {
    return reapplyManagedFields(schema, managedFields);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new JITError("DDD_CAPABILITY_SCHEMA_CONFLICT", message);
  }
}

function definedPolicyBase(state: DefinedClassState): DefinedClassPolicy {
  return (
    state.policy ?? {
      result: "throw",
      create: true,
      hydrate: true,
    }
  );
}

function definedAssertions(
  descriptors: readonly AssertionDescriptor[],
  maxIssues: number | undefined,
  errors: readonly (unknown | undefined)[]
): DefinedClassAssertions {
  const bindingValues = descriptors.flatMap((descriptor) => descriptor.bindings);
  return {
    descriptors: Object.freeze([...descriptors]),
    source: emitAssertionSource(descriptors, maxIssues),
    bindingNames: Object.freeze(bindingValues.map((_, index) => `__q${index}`)),
    bindingValues: Object.freeze(bindingValues),
    failures: Object.freeze(
      descriptors.map((descriptor, index) => ({
        rule: descriptor.rule,
        field: descriptor.field,
        code: descriptor.code,
        message: descriptor.message,
        priority: descriptor.priority,
        ...(errors[index] === undefined ? {} : { error: errors[index] }),
      }))
    ),
  };
}

function defineClassAssertion(
  state: DefinedClassState,
  predicate: (query: QueryConditionBuilder<unknown>) => QueryConditionNode,
  options: AssertionOptions | undefined
): DefinedClassState {
  const policy = definedPolicyBase(state);
  const previous = policy.assertions;
  const startIndex = previous?.bindingValues.length ?? 0;
  const builder = createConditionBuilder(startIndex);
  const condition = predicate(builder.builder);
  if (options?.priority !== undefined && !Number.isFinite(options.priority)) {
    throw new RangeError("priority must be a finite number");
  }
  const descriptor = resolveAssertionDescriptor({
    condition,
    bindings: builder.bindings,
    ...(options?.rule === undefined ? {} : { rule: options.rule }),
    ...(options?.code === undefined ? {} : { code: options.code }),
    ...(options?.message === undefined ? {} : { message: options.message }),
    ...(options?.priority === undefined ? {} : { priority: options.priority }),
  });
  const descriptors = [...(previous?.descriptors ?? []), descriptor];
  const errors = [...(previous?.failures.map((failure) => failure.error) ?? []), options?.error];
  return {
    ...state,
    policy: {
      ...policy,
      assertions: definedAssertions(descriptors, policy.maxIssues, errors),
    },
  };
}

function definedLifecycleMutation(lifecycle: LifecycleDefinition):
  | {
      readonly updatedAt?: string;
      readonly touchAt?: string;
      readonly version?: string;
      readonly deletedAt?: string;
      readonly touchMethod?: string;
      readonly deleteMethod?: string;
      readonly restoreMethod?: string;
      readonly isDeletedMember?: string;
      readonly timestampClock?: unknown;
      readonly deletionClock?: unknown;
    }
  | undefined {
  const timestamps = lifecycle.timestamps;
  const deletion = lifecycle.softDelete;
  const versioned = lifecycle.versioned;
  if (timestamps === undefined && deletion === undefined && versioned === undefined) return undefined;
  return {
    ...(timestamps?.touch === "manual" || timestamps === undefined ? {} : { updatedAt: timestamps.updatedAt }),
    ...(timestamps === undefined ? {} : { touchAt: timestamps.updatedAt, touchMethod: timestamps.touchMethod }),
    ...(versioned === undefined ? {} : { version: versioned.field }),
    ...(deletion === undefined
      ? {}
      : {
          deletedAt: deletion.field,
          deleteMethod: deletion.deleteMethod,
          restoreMethod: deletion.restoreMethod,
          isDeletedMember: deletion.isDeletedMember,
        }),
    ...(timestamps?.clock === undefined ? {} : { timestampClock: timestamps.clock }),
    ...(deletion?.clock === undefined ? {} : { deletionClock: deletion.clock }),
  };
}

function defineRuntimeClass(state: DefinedClassState): unknown {
  const target = function definedRuntimeClass(): never {
    return defineArtifactFailure();
  };
  const materialize = function materializeDefinedClass(): never {
    return defineArtifactFailure();
  } as unknown as new (
    input: unknown,
    validated?: boolean
  ) => unknown;
  const mutation = definedLifecycleMutation(state.lifecycle);
  registerArtifact(target, {
    kind: "class",
    declaredSchema: state.declaredSchema,
    schema: state.schema,
    abstract: state.abstract,
    frozen: false,
    aggregate: state.aggregate,
    construction: state.construction,
    representation: "object",
    capabilities: state.capabilities,
    managedFields: state.managedFields,
    lifecycle: state.lifecycle,
    resolvedMembers: state.members.entries(),
    ...(mutation === undefined ? {} : { mutation }),
    ...(state.methods.length === 0 ? {} : { methods: state.methods }),
    ...(state.policy === undefined ? {} : { policy: state.policy }),
    factories: state.factories,
    accessors: state.accessors as never,
  });
  Object.defineProperties(target, {
    schema: {
      enumerable: true,
      value: createSchema(TypeName.runtimeType, {
        innerType: state.schema,
        materialize,
        representation: "object",
        identifier: false,
      }),
    },
    create: { enumerable: false, value: defineArtifactFailure },
    hydrate: { enumerable: false, value: defineArtifactFailure },
    extends: {
      enumerable: false,
      value: (...extensions: readonly (DefinedCapability | ClassMethodsInput)[]) =>
        defineRuntimeClass(defineClassExtensions(state, extensions)),
    },
    construction: {
      enumerable: false,
      value: (mode: "constructor" | "factory") => {
        if (state.policy !== undefined) {
          throw new JITError("INVALID_OPERATION", "Construction must be configured before validation or assertions");
        }
        return defineRuntimeClass({
          ...state,
          construction: mode,
          factories: mode === "factory" ? { create: "create", hydrate: "hydrate" } : { create: false, hydrate: false },
        });
      },
    },
    factories: {
      enumerable: false,
      value: (options: FactoryOptions) =>
        defineRuntimeClass({
          ...state,
          construction: "factory",
          factories: {
            create: options.create === undefined ? "create" : options.create,
            hydrate: options.hydrate === undefined ? "hydrate" : options.hydrate,
          },
        }),
    },
    accessors: { enumerable: false, value: () => defineRuntimeClass(state) },
    identity: {
      enumerable: false,
      value: (key: string) =>
        defineRuntimeClass(
          defineClassExtensions(state, [defineCapability(`identity:${key}`, ["identity", "sameIdentity"])])
        ),
    },
    validate: {
      enumerable: false,
      value: (options?: FactoryValidationOptions) => {
        if (state.validationConfigured) {
          throw new JITError("INVALID_OPERATION", "Factory validation is already configured for this Runtime Class");
        }
        if (options?.maxIssues !== undefined && (!Number.isSafeInteger(options.maxIssues) || options.maxIssues < 1)) {
          throw new RangeError("maxIssues must be a positive safe integer");
        }
        if (options?.priority !== undefined && !Number.isFinite(options.priority)) {
          throw new RangeError("priority must be a finite number");
        }
        const previous = definedPolicyBase(state);
        return defineRuntimeClass({
          ...state,
          validationConfigured: true,
          policy: {
            ...previous,
            result: options?.result ?? previous.result,
            create: options?.create ?? previous.create,
            hydrate: options?.hydrate ?? previous.hydrate,
            ...(options?.maxIssues === undefined ? {} : { maxIssues: options.maxIssues }),
            ...(options?.error === undefined
              ? {}
              : { errorPriority: options.priority ?? 1000, errorPriorityExplicit: options.priority !== undefined }),
            ...(options?.error === undefined ? {} : { error: options.error }),
          },
        });
      },
    },
    assert: {
      enumerable: false,
      value: (predicate: (query: QueryConditionBuilder<unknown>) => QueryConditionNode, options?: AssertionOptions) =>
        defineRuntimeClass(defineClassAssertion(state, predicate, options)),
    },
  });
  return target;
}

const defineClass = Object.assign(
  ((schema: SchemaInput<ATS.AnyTypeSchema>) =>
    defineRuntimeClass(defineClassState(unwrapSchema(schema), false, false))) as ClassFactory,
  {
    abstract: (schema: SchemaInput<ATS.AnyTypeSchema>) =>
      defineRuntimeClass(defineClassState(unwrapSchema(schema), true, false)),
    equals: defineCapability("equals", ["equals"]),
    hashCode: defineCapability("hashCode", ["hashCode"]),
    with: defineCapability("with", ["with"]),
    diff: defineCapability("diff", ["diff"]),
    clone: defineCapability("clone", ["clone"]),
    identity: (key: string) => defineCapability(`identity:${key}`, ["identity", "sameIdentity"]),
  }
) as ClassFactory;

function defineIdentityKey(
  schema: ATS.AnyTypeSchema,
  explicit: string | undefined,
  label: "Entity" | "Aggregate"
): string {
  const object = resolveWrappers(schema).base;
  if (object.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", `${label} identity requires an object schema`);
  }
  if (explicit !== undefined) return explicit;
  const candidates = Object.keys((object as ATS.ObjectSchema).def.props).filter((key) =>
    defineIsIdentifierSchema((object as ATS.ObjectSchema).def.props[key])
  );
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new JITError(
      "INVALID_OPERATION",
      `${label} identity must be explicit when the schema has no unique identifier`
    );
  }
  throw new JITError(
    "INVALID_OPERATION",
    `${label} identity must be explicit when the schema has multiple unique identifiers`
  );
}

function defineIsIdentifierSchema(schema: ATS.AnyTypeSchema): boolean {
  return defineFindRuntimeTypeSchema(schema)?.def.identifier === true;
}

function defineFindRuntimeTypeSchema(schema: ATS.AnyTypeSchema): ATS.RuntimeTypeSchema | undefined {
  let current = schema;
  while (true) {
    if (current.type === TypeName.runtimeType) return current as ATS.RuntimeTypeSchema;
    if (current.type === TypeName.lazy) {
      current = (current.def as ATS.LazyDef).getter();
      continue;
    }
    if (
      current.type === TypeName.optional ||
      current.type === TypeName.nullable ||
      current.type === TypeName.nullish ||
      current.type === TypeName.default ||
      current.type === TypeName.brand ||
      current.type === TypeName.readonly ||
      current.type === TypeName.refine ||
      current.type === TypeName.coerce ||
      current.type === TypeName.pipe ||
      current.type === TypeName.transform
    ) {
      current = (current.def as ATS.InnerTypeDef).innerType;
      continue;
    }
    return undefined;
  }
}

const defineEntity = ((schema: SchemaInput<ATS.AnyTypeSchema>, options?: { readonly id?: string }) => {
  const unwrapped = unwrapSchema(schema);
  const object = resolveWrappers(unwrapped).base;
  const id = defineIdentityKey(
    unwrapped,
    options?.id ??
      (object.type === TypeName.object && "id" in (object as ATS.ObjectSchema).def.props ? "id" : undefined),
    "Entity"
  );
  const state = defineClassState(unwrapped, false, false);
  return defineRuntimeClass(
    defineClassExtensions({ ...state, construction: "factory", factories: { create: "create", hydrate: "hydrate" } }, [
      defineClass.identity(id),
    ])
  );
}) as typeof RuntimeJIT.ddd.entity;

const defineAggregateRoot = ((schema: SchemaInput<ATS.AnyTypeSchema>, options?: { readonly id?: string }) => {
  const unwrapped = unwrapSchema(schema);
  const object = resolveWrappers(unwrapped).base;
  const id = defineIdentityKey(
    unwrapped,
    options?.id ??
      (object.type === TypeName.object && "id" in (object as ATS.ObjectSchema).def.props ? "id" : undefined),
    "Aggregate"
  );
  return defineRuntimeClass(
    defineClassExtensions(defineClassState(unwrapped, false, true), [defineClass.identity(id)])
  );
}) as typeof RuntimeJIT.ddd.aggregateRoot;

const defineTimestamps = ((options?: TimestampOptions) =>
  defineCapability(
    "ddd.timestamps",
    [options?.methods?.touch ?? "touch"],
    options
  )) as typeof RuntimeJIT.ddd.timestamps;
const defineSoftDelete = ((options?: SoftDeleteOptions) =>
  defineCapability(
    "ddd.softDelete",
    [
      options?.methods?.delete ?? "softDelete",
      options?.methods?.restore ?? "restore",
      options?.methods?.isDeleted ?? "isDeleted",
    ],
    options
  )) as typeof RuntimeJIT.ddd.softDelete;
const defineVersioned = ((options?: VersionedOptions) =>
  defineCapability("ddd.versioned", [], options)) as typeof RuntimeJIT.ddd.versioned;
const defineDdd = Object.freeze({
  ...RuntimeJIT.ddd,
  entity: defineEntity,
  aggregateRoot: defineAggregateRoot,
  timestamps: defineTimestamps,
  softDelete: defineSoftDelete,
  versioned: defineVersioned,
  abstract: Object.freeze({
    ...RuntimeJIT.ddd.abstract,
    entity: ((schema: SchemaInput<ATS.AnyTypeSchema>, options?: { readonly id?: string }) => {
      const value = (
        defineEntity as (value: SchemaInput<ATS.AnyTypeSchema>, options?: { readonly id?: string }) => unknown
      )(schema, options);
      return value;
    }) as typeof RuntimeJIT.ddd.abstract.entity,
    aggregateRoot: ((schema: SchemaInput<ATS.AnyTypeSchema>, options?: { readonly id?: string }) => {
      const value = (
        defineAggregateRoot as (value: SchemaInput<ATS.AnyTypeSchema>, options?: { readonly id?: string }) => unknown
      )(schema, options);
      return value;
    }) as typeof RuntimeJIT.ddd.abstract.aggregateRoot,
  }),
});

function stage(kind: string, input: ExecutionStage["input"], output: ExecutionStage["output"]): ExecutionStage {
  return {
    kind,
    input,
    output,
    requires: [],
    provides: [],
    effects: kind === "value" ? NO_EFFECTS : THROWING_EFFECTS,
  } as ExecutionStage;
}

export const JIT = {
  ...RuntimeJIT,
  class: defineClass,
  ddd: defineDdd,
  overwrite,
  validate,
  json,
  binary,
  from,
  map: Object.assign(
    ((
      source: SchemaInput<ATS.AnyTypeSchema>,
      target: SchemaInput<ATS.AnyTypeSchema>,
      mapping?: Readonly<Record<string, unknown>>
    ) => map(source, target, mapping ?? {})) as unknown as typeof RuntimeJIT.map,
    { many: mapMany }
  ),
  clone,
  format,
  jsonSchema,
  mock,
  sort: defineSort,
  index: defineIndex,
  lookup: defineLookup,
  project: defineProject,
  cacheKey,
  canonical: defineCanonical,
  access: defineAccess,
  rules: defineRules,
  match: defineMatch,
  migrate: defineMigrate,
  csv,
  ndjson,
  api,
  cqrs,
  state,
  compare: Object.freeze({ equal, diff, hash, changed }),
  security: Object.freeze({ mask, sanitize }),
} as Omit<
  typeof RuntimeJIT,
  | "validate"
  | "json"
  | "binary"
  | "from"
  | "class"
  | "ddd"
  | "overwrite"
  | "map"
  | "clone"
  | "format"
  | "jsonSchema"
  | "mock"
  | "sort"
  | "index"
  | "lookup"
  | "project"
  | "changed"
  | "cacheKey"
  | "canonical"
  | "access"
  | "rules"
  | "match"
  | "migrate"
  | "csv"
  | "ndjson"
  | "api"
  | "cqrs"
  | "state"
  | "compare"
  | "security"
> & {
  readonly validate: typeof validate;
  readonly json: typeof json;
  readonly binary: typeof binary;
  readonly from: typeof from;
  readonly class: typeof defineClass;
  readonly ddd: typeof defineDdd;
  readonly overwrite: typeof overwrite;
  readonly map: typeof RuntimeJIT.map;
  readonly clone: typeof clone;
  readonly format: typeof format;
  readonly jsonSchema: typeof jsonSchema;
  readonly mock: typeof mock;
  readonly sort: typeof defineSort;
  readonly index: typeof defineIndex;
  readonly lookup: typeof defineLookup;
  readonly project: typeof defineProject;
  readonly cacheKey: typeof cacheKey;
  readonly canonical: typeof defineCanonical;
  readonly access: typeof defineAccess;
  readonly rules: typeof defineRules;
  readonly match: typeof defineMatch;
  readonly migrate: typeof defineMigrate;
  readonly csv: CsvNamespace;
  readonly ndjson: NdjsonNamespace;
  readonly api: typeof api;
  readonly cqrs: typeof cqrs;
  readonly state: typeof state;
  readonly compare: {
    readonly equal: typeof equal;
    readonly diff: typeof diff;
    readonly hash: typeof hash;
    readonly changed: typeof changed;
  };
  readonly security: {
    readonly mask: typeof mask;
    readonly sanitize: typeof sanitize;
  };
};

export namespace JIT {
  export type Typeof<TSchemaLike> = import("./core/ats/typeof.js").Typeof<TSchemaLike>;
  export type Input<TSchemaLike> = import("./core/ats/input.js").Input<TSchemaLike>;
  export type Hydrate<TSchemaLike> = import("./core/ats/representations.js").Hydrate<TSchemaLike>;
  export type Wire<TSchemaLike> = import("./core/ats/representations.js").Wire<TSchemaLike>;
  export type Update<TSchemaLike> = import("./core/ats/input.js").Update<TSchemaLike>;
  export type Strict<TSchemaLike, TValue> = import("./core/builder/types.js").Strict<TSchemaLike, TValue>;
}
