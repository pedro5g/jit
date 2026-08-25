import { compileCodec } from "../compiler/codec.js";
import { lowerExecutionPlan } from "../compiler/execution-lower.js";
import { type ExecutionPlan, type ExecutionStage, NO_EFFECTS, THROWING_EFFECTS } from "../compiler/execution-plan.js";
import { compileJsonParse } from "../compiler/json-parse.js";
import type { MapperOverridesInput } from "../compiler/mapper/build-mapper-plan.js";
import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import { compileSerialize } from "../compiler/serialize.js";
import type { UpdatePatch } from "../compiler/update.js";
import { compileValidatorSelection } from "../compiler/validate.js";
import type { QueryConditionNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import type { SchemaInput, StandardSchemaProps } from "../core/builder/index.js";
import { getStandardSchema, unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { getQueryProgram, type QueryConditionBuilder, query } from "./query.js";

type FunctionLike = (...args: never[]) => unknown;

type NumericElementKey<TElement> = {
  [TKey in Extract<keyof TElement, string>]: TElement[TKey] extends number ? TKey : never;
}[Extract<keyof TElement, string>];

const OPERATION_ARTIFACTS = new WeakMap<ATS.AnyTypeSchema, Map<string, CallableArtifact<FunctionLike>>>();

/** A callable, lazily-lowered execution plan. */
export type CallableArtifact<TFunction extends FunctionLike> = TFunction & {
  readonly plan: ExecutionPlan;
  compile(): CallableArtifact<TFunction>;
  explain(): ExecutionPlan;
};

export type ExecutionArtifact<TInput, TOutput> = CallableArtifact<(input: TInput) => TOutput>;

/**
 * A compiled artifact that also satisfies the Standard Schema contract, so
 * it can be handed to any consumer in the ecosystem with no wrapper.
 */
export type StandardArtifact<TFunction extends FunctionLike, TOutput> = CallableArtifact<TFunction> & {
  readonly "~standard": StandardSchemaProps<unknown, TOutput>;
};

export type ValueArtifact<TInput, TOutput, TSchema extends ATS.AnyTypeSchema> = ExecutionArtifact<TInput, TOutput> & {
  readonly schema: TSchema;
  /** Standard Schema interop; `validate` runs the compiled validator. */
  readonly "~standard": StandardSchemaProps<unknown, ATS.TypeofSchema<TSchema>>;
  validate(): SchemaArtifact<TInput, TSchema>;
  map<TTarget extends ATS.AnyTypeSchema>(
    target: SchemaInput<TTarget>,
    mapping?: MapperOverridesInput
  ): SchemaArtifact<TInput, TTarget>;
  transform<TTarget extends ATS.AnyTypeSchema>(
    target: SchemaInput<TTarget>,
    transforms: ATS.TransformSpec<TOutput>
  ): SchemaArtifact<TInput, TTarget>;
  update(patch: UpdatePatch<TOutput>): SchemaArtifact<TInput, TSchema>;
  mask(): SchemaArtifact<TInput, TSchema>;
  sanitize(): SchemaArtifact<TInput, TSchema>;
  readonly to: ValueSinks<TInput, TOutput>;
};

export type CollectionArtifact<
  TInput,
  TElement,
  TSchema extends ATS.ArraySchema<ATS.AnyTypeSchema>,
> = ExecutionArtifact<TInput, TElement[]> & {
  readonly schema: TSchema;
  validate(): CollectionArtifact<TInput, TElement, TSchema>;
  filter(
    predicate: (query: QueryConditionBuilder<TElement>) => QueryConditionNode
  ): CollectionArtifact<TInput, TElement, TSchema>;
  select<const TKeys extends readonly Extract<keyof TElement, string>[]>(
    ...fields: TKeys
  ): CollectionArtifact<TInput, Pick<TElement, TKeys[number]>, ATS.ArraySchema<ATS.AnyTypeSchema>>;
  map<TTarget extends ATS.AnyTypeSchema>(
    target: SchemaInput<TTarget>,
    mapping?: MapperOverridesInput
  ): CollectionArtifact<TInput, ATS.TypeofSchema<TTarget>, ATS.ArraySchema<TTarget>>;
  transform<TTarget extends ATS.AnyTypeSchema>(
    target: SchemaInput<TTarget>,
    transforms: ATS.TransformSpec<TElement>
  ): CollectionArtifact<TInput, ATS.TypeofSchema<TTarget>, ATS.ArraySchema<TTarget>>;
  update(patch: UpdatePatch<TElement>): CollectionArtifact<TInput, TElement, TSchema>;
  mask(): CollectionArtifact<TInput, TElement, TSchema>;
  sanitize(): CollectionArtifact<TInput, TElement, TSchema>;
  count(): ExecutionArtifact<TInput, number>;
  sum<TKey extends NumericElementKey<TElement>>(field: TKey): ExecutionArtifact<TInput, number>;
  avg<TKey extends NumericElementKey<TElement>>(field: TKey): ExecutionArtifact<TInput, number | undefined>;
  min<TKey extends NumericElementKey<TElement>>(field: TKey): ExecutionArtifact<TInput, number | undefined>;
  max<TKey extends NumericElementKey<TElement>>(field: TKey): ExecutionArtifact<TInput, number | undefined>;
  readonly to: CollectionSinks<TInput, TElement>;
};

export type SchemaArtifact<TInput, TSchema extends ATS.AnyTypeSchema> = [TSchema] extends [
  ATS.ArraySchema<infer TElement>,
]
  ? CollectionArtifact<TInput, ATS.TypeofSchema<TElement>, TSchema>
  : ValueArtifact<TInput, ATS.TypeofSchema<TSchema>, TSchema>;

export interface ValueSinks<TInput, TOutput> {
  array(): ExecutionArtifact<TInput, TOutput>;
  json(): ExecutionArtifact<TInput, string>;
  binary(): ExecutionArtifact<TInput, Uint8Array>;
}

export interface CollectionSinks<TInput, TElement> {
  array(): ExecutionArtifact<TInput, TElement[]>;
  json(): ExecutionArtifact<TInput, string>;
  binary(): ExecutionArtifact<TInput, Uint8Array>;
}

interface CollectionState<TInput, TElement, TSchema extends ATS.ArraySchema<ATS.AnyTypeSchema>> {
  readonly source: ExecutionArtifact<TInput, TElement[]>;
  readonly schema: TSchema;
  /** Schema accepted by the current contiguous query segment. */
  readonly querySource: ATS.AnyTypeSchema;
  readonly builder: RuntimeQueryBuilder;
  readonly plan: ExecutionPlan;
}

interface RuntimeQueryBuilder {
  filter(predicate: unknown): RuntimeQueryBuilder;
  select(...fields: string[]): RuntimeQueryBuilder;
  count(): RuntimeQueryBuilder;
  sum(field: string): RuntimeQueryBuilder;
  avg(field: string): RuntimeQueryBuilder;
  min(field: string): RuntimeQueryBuilder;
  max(field: string): RuntimeQueryBuilder;
  compile(): (values: readonly unknown[]) => unknown;
}

function freezePlan(schema: ATS.AnyTypeSchema, stages: readonly ExecutionStage[]): ExecutionPlan {
  return Object.freeze({
    version: 1 as const,
    schema,
    stages: Object.freeze(stages.map((stage) => Object.freeze(stage))),
  });
}

/** Creates the only runtime object that can execute a plan. Lowering is delayed until use. */
export function createExecutionArtifact<TFunction extends FunctionLike>(
  plan: ExecutionPlan,
  lower: () => TFunction,
  arity: 1 | 2 = 1
): CallableArtifact<TFunction> {
  let compiled: TFunction | undefined;
  const artifact = (arity === 1
    ? function executionArtifact(input: unknown): unknown {
        compiled ??= lower();
        return (compiled as unknown as (value: unknown) => unknown)(input);
      }
    : function executionArtifact(left: unknown, right: unknown): unknown {
        compiled ??= lower();
        return (compiled as unknown as (left: unknown, right: unknown) => unknown)(left, right);
      }) as unknown as CallableArtifact<TFunction>;

  Object.defineProperties(artifact, {
    plan: { enumerable: true, value: plan },
    compile: {
      enumerable: false,
      value: () => {
        compiled ??= lower();
        return artifact;
      },
    },
    explain: { enumerable: false, value: () => plan },
  });
  registerArtifact(artifact as object, { kind: "execution", plan });
  return artifact;
}

/** Starts a value pipeline without compiling an identity function. */
export function from<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): SchemaArtifact<ATS.TypeofSchema<TSchema>, TSchema> {
  const unwrapped = unwrapSchema(schema);
  const plan = freezePlan(unwrapped, [
    {
      kind: "value",
      input: "value",
      output: "value",
      schema: unwrapped,
      requires: [],
      provides: [],
      effects: NO_EFFECTS,
    },
  ]);
  const source = createExecutionArtifact<(value: ATS.TypeofSchema<TSchema>) => ATS.TypeofSchema<TSchema>>(
    plan,
    () => (value) => value
  );

  return artifactForSchema(source, unwrapped) as SchemaArtifact<ATS.TypeofSchema<TSchema>, TSchema>;
}

/** Native JSON source stage. Schema constraints remain an explicit validation stage. */
export function jsonParse<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): SchemaArtifact<string, TSchema> {
  const unwrapped = unwrapSchema(schema);
  const plan = freezePlan(unwrapped, [
    {
      kind: "json.decode",
      input: "json-text",
      output: "value",
      schema: unwrapped,
      requires: [],
      provides: ["json-syntax-valid"],
      effects: THROWING_EFFECTS,
    },
  ]);
  const source = createExecutionArtifact<(value: string) => ATS.TypeofSchema<TSchema>>(
    plan,
    () => compileJsonParse(unwrapped) as (value: string) => ATS.TypeofSchema<TSchema>
  );

  return artifactForSchema(source, unwrapped) as SchemaArtifact<string, TSchema>;
}

/** Source stage for the persisted binary codec. */
export function binaryDecode<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): SchemaArtifact<Uint8Array | ArrayBuffer, TSchema> {
  const unwrapped = unwrapSchema(schema);
  const plan = freezePlan(unwrapped, [
    {
      kind: "binary.decode",
      input: "binary",
      output: "value",
      schema: unwrapped,
      requires: [],
      provides: ["binary-layout-valid"],
      effects: THROWING_EFFECTS,
    },
  ]);
  const source = createExecutionArtifact<(value: Uint8Array | ArrayBuffer) => ATS.TypeofSchema<TSchema>>(
    plan,
    () => compileCodec(unwrapped).decode
  );

  return artifactForSchema(source, unwrapped) as SchemaArtifact<Uint8Array | ArrayBuffer, TSchema>;
}

/** A standalone schema operation, represented in the shared plan vocabulary. */
export function validationArtifact<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  operation: "is" | "parse" | "safeParse" | "parseAsync" | "safeParseAsync" | "issues"
): CallableArtifact<FunctionLike> {
  const unwrapped = unwrapSchema(schema);
  const output = operation === "is" ? "boolean" : operation === "issues" ? "issues" : "value";
  const plan = freezePlan(unwrapped, [
    {
      kind: "value",
      input: "value",
      output: "value",
      schema: unwrapped,
      requires: [],
      provides: [],
      effects: NO_EFFECTS,
    },
    {
      kind: "validate",
      input: "value",
      output,
      schema: unwrapped,
      operation,
      requires: [],
      provides: operation === "is" ? [] : ["schema-validated"],
      effects: THROWING_EFFECTS,
    },
  ]);

  const artifact = createExecutionArtifact(plan, () => {
    switch (operation) {
      case "is":
        return compileValidatorSelection(unwrapped, ["is"] as const).is as FunctionLike;
      case "parse":
        return compileValidatorSelection(unwrapped, ["parse"] as const).parse as FunctionLike;
      case "safeParse":
        return compileValidatorSelection(unwrapped, ["safeParse"] as const).safeParse as FunctionLike;
      case "parseAsync":
        return compileValidatorSelection(unwrapped, ["parseAsync"] as const).parseAsync as FunctionLike;
      case "safeParseAsync":
        return compileValidatorSelection(unwrapped, ["safeParseAsync"] as const).safeParseAsync as FunctionLike;
      case "issues": {
        const safeParse = compileValidatorSelection(unwrapped, ["safeParse"] as const).safeParse;

        return function* issues(value: unknown) {
          const result = safeParse(value);
          if (!result.success) yield* result.issues;
        } as FunctionLike;
      }
    }
  });

  // Every validation artifact is a Standard Schema, so it can be handed
  // straight to any consumer in the ecosystem without a wrapper.
  attachStandardSchema(artifact, unwrapped, plan);

  if (operation === "parse") {
    return artifactForSchema(
      artifact as unknown as ExecutionArtifact<unknown, ATS.TypeofSchema<TSchema>>,
      unwrapped
    ) as unknown as CallableArtifact<FunctionLike>;
  }

  return artifact;
}

/**
 * Any artifact whose plan ends in validation is a Standard Schema.
 *
 * A plain `validate.*` artifact shares the schema's own cached adapter, so a
 * builder and the artifacts built from it are identical by reference and a
 * consumer may cache on that. A composed pipeline (`json.parse(X).validate()`)
 * validates a different input than the schema does, so it gets an adapter
 * that runs the pipeline itself and reports its issues.
 */
export function attachStandardSchema(target: object, schema: ATS.AnyTypeSchema, plan?: ExecutionPlan): void {
  const composed = plan !== undefined && !isPlainValidation(plan);

  Object.defineProperty(target, "~standard", {
    enumerable: false,
    configurable: false,
    get: () => (composed ? pipelineStandardSchema(target as FunctionLike) : getStandardSchema(schema)),
  });
}

/** True for the `[value, validate]` plan every `validate.*` factory produces. */
function isPlainValidation(plan: ExecutionPlan): boolean {
  return plan.stages.length === 2 && plan.stages[0]?.kind === "value" && plan.stages[1]?.kind === "validate";
}

const PIPELINE_ADAPTERS = new WeakMap<object, StandardSchemaProps<unknown>>();

function pipelineStandardSchema(artifact: FunctionLike): StandardSchemaProps<unknown> {
  const cached = PIPELINE_ADAPTERS.get(artifact);

  if (cached) return cached;

  const adapter: StandardSchemaProps<unknown> = {
    version: 1,
    vendor: "jit",
    validate(value: unknown) {
      try {
        return { value: (artifact as (input: unknown) => unknown)(value) };
      } catch (error) {
        const issues = (error as { readonly issues?: readonly { readonly message: string; readonly path?: string }[] })
          .issues;

        // Only a validation failure is a Standard Schema result; anything
        // else (malformed JSON, a decoder error) is a real exception.
        if (!issues) throw error;
        return {
          issues: issues.map((issue) => ({
            message: issue.message,
            ...(issue.path ? { path: issue.path.split(".").filter(Boolean) } : {}),
          })),
        };
      }
    },
  };

  PIPELINE_ADAPTERS.set(artifact, adapter);
  return adapter;
}

/** Appends validation as a plan stage; construction never executes the preceding artifact. */
export function appendValidation<TInput, TOutput, TSchema extends ATS.AnyTypeSchema>(
  artifact: ExecutionArtifact<TInput, TOutput>,
  schema: TSchema
): SchemaArtifact<TInput, TSchema> {
  const construct = runtimeConstructStage(schema);
  const plan = freezePlan(schema, [
    ...artifact.plan.stages,
    {
      kind: "validate",
      input: "value",
      output: "value",
      schema,
      operation: "parse",
      requires: [],
      provides: ["schema-validated"],
      effects: THROWING_EFFECTS,
    },
    ...construct,
  ]);
  const next = createExecutionArtifact<(value: TInput) => ATS.TypeofSchema<TSchema>>(
    plan,
    () => lowerExecutionPlan(plan) as (value: TInput) => ATS.TypeofSchema<TSchema>
  );

  // A pipeline that ends in validation is a Standard Schema too, over the
  // input the pipeline accepts rather than over the schema's own value.
  attachStandardSchema(next, schema, plan);
  return artifactForSchema(next, schema) as SchemaArtifact<TInput, TSchema>;
}

function runtimeConstructStage(schema: ATS.AnyTypeSchema): readonly ExecutionStage[] {
  if (schema.type !== TypeName.runtimeType) return [];

  const runtimeType = schema as ATS.RuntimeTypeSchema;

  return [
    {
      kind: "construct",
      input: "value",
      output: "value",
      schema: runtimeType,
      target: runtimeType.def.materialize,
      requires: ["schema-validated"],
      provides: ["materialized"],
      effects: { ...NO_EFFECTS, mayAllocate: true, usesExternalBindings: true },
    },
  ];
}

export function jsonStringify<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): ExecutionArtifact<ATS.TypeofSchema<TSchema>, string> {
  const unwrapped = unwrapSchema(schema);
  const plan = freezePlan(unwrapped, [
    {
      kind: "value",
      input: "value",
      output: "value",
      schema: unwrapped,
      requires: [],
      provides: [],
      effects: NO_EFFECTS,
    },
    {
      kind: "json.encode",
      input: "value",
      output: "json-text",
      schema: unwrapped,
      requires: [],
      provides: ["materialized"],
      effects: { ...THROWING_EFFECTS, mayAllocate: true },
    },
  ]);

  return createExecutionArtifact(plan, () => compileSerialize(unwrapped));
}

export function binaryEncode<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): ExecutionArtifact<ATS.TypeofSchema<TSchema>, Uint8Array> {
  const unwrapped = unwrapSchema(schema);
  const plan = freezePlan(unwrapped, [
    {
      kind: "value",
      input: "value",
      output: "value",
      schema: unwrapped,
      requires: [],
      provides: [],
      effects: NO_EFFECTS,
    },
    {
      kind: "binary.encode",
      input: "value",
      output: "binary",
      schema: unwrapped,
      requires: [],
      provides: ["materialized"],
      effects: { ...THROWING_EFFECTS, mayAllocate: true },
    },
  ]);

  return createExecutionArtifact(plan, () => compileCodec(unwrapped).encode);
}

/** Low-level operations participate in the same descriptor protocol as dataflow pipelines. */
export function operationArtifact<TSchema extends ATS.AnyTypeSchema, TFunction extends FunctionLike>(
  schema: SchemaInput<TSchema>,
  operation: "equal" | "clone" | "diff" | "hash" | "format" | "mask" | "sanitize",
  input: "value",
  output: "value" | "boolean",
  lower: (schema: TSchema) => TFunction
): CallableArtifact<TFunction> {
  const unwrapped = unwrapSchema(schema);
  const cached = OPERATION_ARTIFACTS.get(unwrapped)?.get(operation);

  if (cached) return cached as CallableArtifact<TFunction>;
  const plan = freezePlan(unwrapped, [
    {
      kind: "value",
      input: "value",
      output: "value",
      schema: unwrapped,
      requires: [],
      provides: [],
      effects: NO_EFFECTS,
    },
    {
      kind: "operation",
      input,
      output,
      schema: unwrapped,
      operation,
      requires: [],
      provides: [],
      effects: THROWING_EFFECTS,
    },
  ]);
  const artifact = createExecutionArtifact(
    plan,
    () => lower(unwrapped),
    operation === "equal" || operation === "diff" ? 2 : 1
  );
  const operations = OPERATION_ARTIFACTS.get(unwrapped);

  if (operations) operations.set(operation, artifact as CallableArtifact<FunctionLike>);
  else OPERATION_ARTIFACTS.set(unwrapped, new Map([[operation, artifact as CallableArtifact<FunctionLike>]]));
  return artifact;
}

export function mappedValue<TInput, TSource extends ATS.AnyTypeSchema, TTarget extends ATS.AnyTypeSchema>(
  source: ExecutionArtifact<TInput, ATS.TypeofSchema<TSource>>,
  sourceSchema: TSource,
  target: SchemaInput<TTarget>,
  mapping: MapperOverridesInput = {}
): SchemaArtifact<TInput, TTarget> {
  const targetSchema = unwrapSchema(target);
  const plan = freezePlan(targetSchema, [...source.plan.stages, mapStage(sourceSchema, targetSchema, false, mapping)]);
  const artifact = createExecutionArtifact<(value: TInput) => ATS.TypeofSchema<TTarget>>(
    plan,
    () => lowerExecutionPlan(plan) as (value: TInput) => ATS.TypeofSchema<TTarget>
  );

  return artifactForSchema(artifact, targetSchema) as SchemaArtifact<TInput, TTarget>;
}

export function mappedCollection<TInput, TSource extends ATS.AnyTypeSchema, TTarget extends ATS.AnyTypeSchema>(
  state: CollectionState<TInput, ATS.TypeofSchema<TSource>, ATS.ArraySchema<TSource>>,
  target: SchemaInput<TTarget>,
  mapping: MapperOverridesInput = {}
): CollectionArtifact<TInput, ATS.TypeofSchema<TTarget>, ATS.ArraySchema<TTarget>> {
  const targetSchema = unwrapSchema(target);
  const resultSchema = arraySchema(targetSchema);
  const plan = freezePlan(resultSchema, [
    ...state.plan.stages,
    mapStage(state.schema.def.element, targetSchema, true, mapping),
  ]);
  const source = createExecutionArtifact<(value: TInput) => ATS.TypeofSchema<TTarget>[]>(
    plan,
    () => lowerExecutionPlan(plan) as (value: TInput) => ATS.TypeofSchema<TTarget>[]
  );

  return createCollectionArtifact({
    source,
    schema: resultSchema,
    querySource: resultSchema,
    builder: query(resultSchema) as unknown as RuntimeQueryBuilder,
    plan,
  });
}

function transformedValue<TInput, TSource extends ATS.AnyTypeSchema, TTarget extends ATS.AnyTypeSchema>(
  source: ExecutionArtifact<TInput, ATS.TypeofSchema<TSource>>,
  sourceSchema: TSource,
  target: SchemaInput<TTarget>,
  transforms: ATS.TransformSpec<ATS.TypeofSchema<TSource>>
): SchemaArtifact<TInput, TTarget> {
  const targetSchema = unwrapSchema(target);
  const plan = freezePlan(targetSchema, [
    ...source.plan.stages,
    transformStage(sourceSchema, targetSchema, false, transforms),
  ]);
  const artifact = createExecutionArtifact<(value: TInput) => ATS.TypeofSchema<TTarget>>(
    plan,
    () => lowerExecutionPlan(plan) as (value: TInput) => ATS.TypeofSchema<TTarget>
  );

  return artifactForSchema(artifact, targetSchema) as SchemaArtifact<TInput, TTarget>;
}

function transformedCollection<TInput, TSource extends ATS.AnyTypeSchema, TTarget extends ATS.AnyTypeSchema>(
  state: CollectionState<TInput, ATS.TypeofSchema<TSource>, ATS.ArraySchema<TSource>>,
  target: SchemaInput<TTarget>,
  transforms: ATS.TransformSpec<ATS.TypeofSchema<TSource>>
): CollectionArtifact<TInput, ATS.TypeofSchema<TTarget>, ATS.ArraySchema<TTarget>> {
  const targetSchema = unwrapSchema(target);
  const resultSchema = arraySchema(targetSchema);
  const plan = freezePlan(resultSchema, [
    ...state.plan.stages,
    transformStage(state.schema.def.element, targetSchema, true, transforms),
  ]);
  const source = createExecutionArtifact<(value: TInput) => ATS.TypeofSchema<TTarget>[]>(
    plan,
    () => lowerExecutionPlan(plan) as (value: TInput) => ATS.TypeofSchema<TTarget>[]
  );

  return createCollectionArtifact({
    source,
    schema: resultSchema,
    querySource: resultSchema,
    builder: query(resultSchema) as unknown as RuntimeQueryBuilder,
    plan,
  });
}

function updatedValue<TInput, TSchema extends ATS.AnyTypeSchema>(
  source: ExecutionArtifact<TInput, ATS.TypeofSchema<TSchema>>,
  schema: TSchema,
  patch: UpdatePatch<ATS.TypeofSchema<TSchema>>
): SchemaArtifact<TInput, TSchema> {
  const plan = freezePlan(schema, [...source.plan.stages, updateStage(schema, false, patch)]);
  const artifact = createExecutionArtifact<(value: TInput) => ATS.TypeofSchema<TSchema>>(
    plan,
    () => lowerExecutionPlan(plan) as (value: TInput) => ATS.TypeofSchema<TSchema>
  );

  return artifactForSchema(artifact, schema) as SchemaArtifact<TInput, TSchema>;
}

function updatedCollection<TInput, TElement, TSchema extends ATS.ArraySchema<ATS.AnyTypeSchema>>(
  state: CollectionState<TInput, TElement, TSchema>,
  patch: UpdatePatch<TElement>
): CollectionArtifact<TInput, TElement, TSchema> {
  const plan = freezePlan(state.schema, [...state.plan.stages, updateStage(state.schema.def.element, true, patch)]);
  const source = createExecutionArtifact<(value: TInput) => TElement[]>(
    plan,
    () => lowerExecutionPlan(plan) as (value: TInput) => TElement[]
  );

  return createCollectionArtifact({ ...state, source, plan });
}

function securedValue<TInput, TSchema extends ATS.AnyTypeSchema>(
  source: ExecutionArtifact<TInput, ATS.TypeofSchema<TSchema>>,
  schema: TSchema,
  operation: "mask" | "sanitize"
): SchemaArtifact<TInput, TSchema> {
  const plan = freezePlan(schema, [...source.plan.stages, securityStage(schema, operation, false)]);
  const artifact = createExecutionArtifact<(value: TInput) => ATS.TypeofSchema<TSchema>>(
    plan,
    () => lowerExecutionPlan(plan) as (value: TInput) => ATS.TypeofSchema<TSchema>
  );

  return artifactForSchema(artifact, schema) as SchemaArtifact<TInput, TSchema>;
}

function securedCollection<TInput, TElement, TSchema extends ATS.ArraySchema<ATS.AnyTypeSchema>>(
  state: CollectionState<TInput, TElement, TSchema>,
  operation: "mask" | "sanitize"
): CollectionArtifact<TInput, TElement, TSchema> {
  const plan = freezePlan(state.schema, [
    ...state.plan.stages,
    securityStage(state.schema.def.element, operation, true),
  ]);
  const source = createExecutionArtifact<(value: TInput) => TElement[]>(
    plan,
    () => lowerExecutionPlan(plan) as (value: TInput) => TElement[]
  );

  return createCollectionArtifact({ ...state, source, plan });
}

function artifactForSchema<TInput, TSchema extends ATS.AnyTypeSchema>(
  artifact: ExecutionArtifact<TInput, ATS.TypeofSchema<TSchema>>,
  schema: TSchema
): SchemaArtifact<TInput, TSchema> {
  if (schema.type === TypeName.array) {
    return createCollectionArtifact({
      source: artifact as unknown as ExecutionArtifact<TInput, unknown[]>,
      schema: schema as ATS.ArraySchema<ATS.AnyTypeSchema>,
      querySource: schema as ATS.ArraySchema<ATS.AnyTypeSchema>,
      builder: query(schema) as unknown as RuntimeQueryBuilder,
      plan: artifact.plan,
    }) as SchemaArtifact<TInput, TSchema>;
  }

  return createValueArtifact(artifact, schema) as SchemaArtifact<TInput, TSchema>;
}

function createValueArtifact<TInput, TOutput, TSchema extends ATS.AnyTypeSchema>(
  artifact: ExecutionArtifact<TInput, TOutput>,
  schema: TSchema
): ValueArtifact<TInput, TOutput, TSchema> {
  const target = artifact as ValueArtifact<TInput, TOutput, TSchema>;
  const to = valueSinks(artifact, schema);

  Object.defineProperties(target, {
    schema: { enumerable: true, value: schema },
    validate: { enumerable: false, value: () => appendValidation(artifact, schema) },
    map: {
      enumerable: false,
      value: <TTarget extends ATS.AnyTypeSchema>(targetSchema: SchemaInput<TTarget>, mapping?: MapperOverridesInput) =>
        mappedValue(artifact as ExecutionArtifact<TInput, ATS.TypeofSchema<TSchema>>, schema, targetSchema, mapping),
    },
    transform: {
      enumerable: false,
      value: <TTarget extends ATS.AnyTypeSchema>(
        targetSchema: SchemaInput<TTarget>,
        transforms: ATS.TransformSpec<TOutput>
      ) =>
        transformedValue(
          artifact as ExecutionArtifact<TInput, ATS.TypeofSchema<TSchema>>,
          schema,
          targetSchema,
          transforms as ATS.TransformSpec<ATS.TypeofSchema<TSchema>>
        ),
    },
    update: {
      enumerable: false,
      value: (patch: UpdatePatch<TOutput>) =>
        updatedValue(
          artifact as ExecutionArtifact<TInput, ATS.TypeofSchema<TSchema>>,
          schema,
          patch as UpdatePatch<ATS.TypeofSchema<TSchema>>
        ),
    },
    mask: {
      enumerable: false,
      value: () => securedValue(artifact as ExecutionArtifact<TInput, ATS.TypeofSchema<TSchema>>, schema, "mask"),
    },
    sanitize: {
      enumerable: false,
      value: () => securedValue(artifact as ExecutionArtifact<TInput, ATS.TypeofSchema<TSchema>>, schema, "sanitize"),
    },
    to: { enumerable: true, value: to },
  });
  return Object.freeze(target);
}

function createCollectionArtifact<TInput, TElement, TSchema extends ATS.ArraySchema<ATS.AnyTypeSchema>>(
  state: CollectionState<TInput, TElement, TSchema>
): CollectionArtifact<TInput, TElement, TSchema> {
  const compiled = createExecutionArtifact<(value: TInput) => TElement[]>(
    state.plan,
    () => lowerExecutionPlan(state.plan) as (value: TInput) => TElement[]
  );
  const artifact = compiled as CollectionArtifact<TInput, TElement, TSchema>;

  Object.defineProperties(artifact, {
    schema: { enumerable: true, value: state.schema },
    validate: { enumerable: false, value: () => appendValidation(artifact, state.schema) },
    filter: {
      enumerable: false,
      value: (predicate: (builder: QueryConditionBuilder<TElement>) => QueryConditionNode) => {
        const builder = state.builder.filter(predicate) as RuntimeQueryBuilder;

        return createCollectionArtifact({
          source: state.source,
          schema: state.schema,
          querySource: state.querySource,
          builder,
          plan: appendQueryStage(state.plan, state.querySource, state.schema, "filter", builder),
        });
      },
    },
    select: {
      enumerable: false,
      value: (...fields: string[]) => {
        const selectedSchema = selectArraySchema(state.schema, fields);

        const builder = state.builder.select(...fields) as RuntimeQueryBuilder;

        return createCollectionArtifact({
          source: state.source,
          schema: selectedSchema,
          querySource: state.querySource,
          builder,
          plan: appendQueryStage(state.plan, state.querySource, selectedSchema, "select", builder),
        });
      },
    },
    map: {
      enumerable: false,
      value: <TTarget extends ATS.AnyTypeSchema>(target: SchemaInput<TTarget>, mapping?: MapperOverridesInput) =>
        mappedCollection(
          state as unknown as CollectionState<
            TInput,
            ATS.TypeofSchema<ATS.AnyTypeSchema>,
            ATS.ArraySchema<ATS.AnyTypeSchema>
          >,
          target,
          mapping
        ),
    },
    transform: {
      enumerable: false,
      value: <TTarget extends ATS.AnyTypeSchema>(
        target: SchemaInput<TTarget>,
        transforms: ATS.TransformSpec<TElement>
      ) =>
        transformedCollection(
          state as unknown as CollectionState<
            TInput,
            ATS.TypeofSchema<ATS.AnyTypeSchema>,
            ATS.ArraySchema<ATS.AnyTypeSchema>
          >,
          target,
          transforms as ATS.TransformSpec<ATS.TypeofSchema<ATS.AnyTypeSchema>>
        ),
    },
    update: {
      enumerable: false,
      value: (patch: UpdatePatch<TElement>) => updatedCollection(state, patch),
    },
    mask: {
      enumerable: false,
      value: () => securedCollection(state, "mask"),
    },
    sanitize: {
      enumerable: false,
      value: () => securedCollection(state, "sanitize"),
    },
    count: { enumerable: false, value: () => aggregateCollection(state, "count") },
    sum: { enumerable: false, value: (field: string) => aggregateCollection(state, "sum", field) },
    avg: { enumerable: false, value: (field: string) => aggregateCollection(state, "avg", field) },
    min: { enumerable: false, value: (field: string) => aggregateCollection(state, "min", field) },
    max: { enumerable: false, value: (field: string) => aggregateCollection(state, "max", field) },
    to: { enumerable: true, value: collectionSinks(compiled, state.schema) },
  });
  return Object.freeze(artifact);
}

function aggregateCollection<TInput, TElement, TSchema extends ATS.ArraySchema<ATS.AnyTypeSchema>>(
  state: CollectionState<TInput, TElement, TSchema>,
  operation: "count" | "sum" | "avg" | "min" | "max",
  key?: string
): ExecutionArtifact<TInput, number | undefined> {
  const builder = operation === "count" ? state.builder.count() : state.builder[operation](key as string);
  const program = getQueryProgram(builder as object);

  if (!program) throw new JITError("INVALID_OPERATION", "aggregate pipeline lost its declarative program");
  const schema = aggregateResultSchema(operation);
  const plan = freezePlan(schema, [
    ...state.plan.stages,
    {
      kind: "aggregate",
      input: "value",
      output: "value",
      source: state.querySource,
      schema,
      operation,
      ...(key === undefined ? {} : { key }),
      program,
      requires: [],
      provides: ["aggregated"],
      effects: NO_EFFECTS,
    },
  ]);
  return createExecutionArtifact(plan, () => lowerExecutionPlan(plan) as (value: TInput) => number | undefined);
}

function aggregateResultSchema(operation: "count" | "sum" | "avg" | "min" | "max"): ATS.AnyTypeSchema {
  const number = createSchema(TypeName.number, {});

  if (operation === "count" || operation === "sum") return number;
  return createSchema(TypeName.union, {
    schemas: [number, createSchema(TypeName.undefined, {})],
  });
}

function valueSinks<TInput, TOutput, TSchema extends ATS.AnyTypeSchema>(
  source: ExecutionArtifact<TInput, TOutput>,
  schema: TSchema
): ValueSinks<TInput, TOutput> {
  return Object.freeze({
    array: () => appendArraySink(source, schema),
    json: () => appendJsonSink(source, schema),
    binary: () => appendBinarySink(source, schema),
  });
}

function collectionSinks<TInput, TElement, TSchema extends ATS.ArraySchema<ATS.AnyTypeSchema>>(
  source: ExecutionArtifact<TInput, TElement[]>,
  schema: TSchema
): CollectionSinks<TInput, TElement> {
  return Object.freeze({
    array: () => appendArraySink(source, schema),
    json: () => appendJsonSink(source, schema),
    binary: () => appendBinarySink(source, schema),
  });
}

function appendArraySink<TInput, TOutput>(
  source: ExecutionArtifact<TInput, TOutput>,
  schema: ATS.AnyTypeSchema
): ExecutionArtifact<TInput, TOutput> {
  const plan = freezePlan(schema, [
    ...source.plan.stages,
    {
      kind: "to.array",
      input: "value",
      output: "value",
      requires: [],
      provides: ["materialized"],
      effects: NO_EFFECTS,
    },
  ]);
  return createExecutionArtifact(plan, () => lowerExecutionPlan(plan) as (value: TInput) => TOutput);
}

function appendJsonSink<TInput, TOutput>(
  source: ExecutionArtifact<TInput, TOutput>,
  schema: ATS.AnyTypeSchema
): ExecutionArtifact<TInput, string> {
  const plan = freezePlan(schema, [
    ...source.plan.stages,
    {
      kind: "json.encode",
      input: "value",
      output: "json-text",
      schema,
      requires: [],
      provides: ["materialized"],
      effects: { ...THROWING_EFFECTS, mayAllocate: true },
    },
  ]);
  return createExecutionArtifact(plan, () => lowerExecutionPlan(plan) as (value: TInput) => string);
}

function appendBinarySink<TInput, TOutput>(
  source: ExecutionArtifact<TInput, TOutput>,
  schema: ATS.AnyTypeSchema
): ExecutionArtifact<TInput, Uint8Array> {
  const plan = freezePlan(schema, [
    ...source.plan.stages,
    {
      kind: "binary.encode",
      input: "value",
      output: "binary",
      schema,
      requires: [],
      provides: ["materialized"],
      effects: { ...THROWING_EFFECTS, mayAllocate: true },
    },
  ]);
  return createExecutionArtifact(plan, () => lowerExecutionPlan(plan) as (value: TInput) => Uint8Array);
}

function appendQueryStage(
  plan: ExecutionPlan,
  source: ATS.AnyTypeSchema,
  schema: ATS.AnyTypeSchema,
  operation: "filter" | "select",
  builder: RuntimeQueryBuilder
): ExecutionPlan {
  const program = getQueryProgram(builder as object);

  if (!program) throw new JITError("INVALID_OPERATION", "query pipeline lost its declarative program");

  return freezePlan(schema, [
    ...plan.stages,
    {
      kind: "query",
      input: "value",
      output: "value",
      source,
      schema,
      operation,
      program,
      requires: [],
      provides: operation === "filter" ? ["filtered"] : ["projected"],
      effects: { ...NO_EFFECTS, mayAllocate: operation === "select" },
    },
  ]);
}

function mapStage(
  source: ATS.AnyTypeSchema,
  target: ATS.AnyTypeSchema,
  many: boolean,
  mapping: MapperOverridesInput
): ExecutionStage {
  return {
    kind: "map",
    input: "value",
    output: "value",
    schema: target,
    source,
    target,
    many,
    bindings: [mapping],
    requires: [],
    provides: ["mapped"],
    effects: { ...NO_EFFECTS, mayAllocate: true, usesExternalBindings: Object.keys(mapping).length > 0 },
  };
}

function transformStage(
  source: ATS.AnyTypeSchema,
  target: ATS.AnyTypeSchema,
  many: boolean,
  transforms: ATS.TransformSpec<unknown>
): ExecutionStage {
  assertTransformTarget(source, target, transforms);

  return {
    kind: "transform",
    input: "value",
    output: "value",
    schema: target,
    source,
    target,
    many,
    transforms: transforms as Readonly<Record<string, unknown>>,
    requires: [],
    provides: ["transformed"],
    effects: {
      ...NO_EFFECTS,
      mayAllocate: true,
      usesExternalBindings: Object.keys(transforms).length > 0,
    },
  };
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

  if (sourceObject.type !== TypeName.object || targetObject.type !== TypeName.object) {
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
    kind: "update",
    input: "value",
    output: "value",
    schema,
    many,
    patch,
    requires: [],
    provides: ["updated"],
    effects: { ...NO_EFFECTS, mayAllocate: true, usesExternalBindings: true },
  };
}

function securityStage(schema: ATS.AnyTypeSchema, operation: "mask" | "sanitize", many: boolean): ExecutionStage {
  return {
    kind: "security",
    input: "value",
    output: "value",
    schema,
    operation,
    many,
    requires: [],
    provides: [operation === "mask" ? "masked" : "sanitized"],
    effects: { ...NO_EFFECTS, mayAllocate: true },
  };
}

function arraySchema<TElement extends ATS.AnyTypeSchema>(element: TElement): ATS.ArraySchema<TElement> {
  return createSchema(TypeName.array, { element }) as ATS.ArraySchema<TElement>;
}

function selectArraySchema(
  schema: ATS.ArraySchema<ATS.AnyTypeSchema>,
  fields: readonly string[]
): ATS.ArraySchema<ATS.AnyTypeSchema> {
  const element = schema.def.element;

  if (element.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", "select pipelines require an array of object schemas");
  }

  const object = element as ATS.ObjectSchema;
  const props: Record<string, ATS.AnyTypeSchema> = {};

  for (const field of fields) {
    const value = object.def.props[field];

    if (value === undefined) throw new JITError("INVALID_OPERATION", `unknown selected field ${JSON.stringify(field)}`);
    props[field] = value;
  }

  const selectedObject = createSchema(TypeName.object, {
    ...object.def,
    props,
  }) as ATS.ObjectSchema;

  return createSchema(TypeName.array, {
    ...schema.def,
    element: selectedObject,
  }) as ATS.ArraySchema<ATS.AnyTypeSchema>;
}

/** Called by the public factory when a non-collection source is queried. */
export function requireArraySchema(schema: ATS.AnyTypeSchema): asserts schema is ATS.ArraySchema<ATS.AnyTypeSchema> {
  if (schema.type !== TypeName.array) {
    throw new JITError(
      "INVALID_OPERATION",
      "filter/select pipelines require JIT.from, json.parse, or binary.decode of an array schema"
    );
  }
}
