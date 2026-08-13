import { compileCodec } from "../compiler/codec.js";
import { type ExecutionPlan, type ExecutionStage, NO_EFFECTS, THROWING_EFFECTS } from "../compiler/execution-plan.js";
import type { MapperOverridesInput } from "../compiler/mapper/build-mapper-plan.js";
import { createMapperFacade } from "../compiler/mapper.js";
import { compileQuery } from "../compiler/query.js";
import { compileSerialize } from "../compiler/serialize.js";
import { compileValidator } from "../compiler/validate.js";
import type { QueryConditionNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { getQueryProgram, type QueryConditionBuilder, query } from "./query.js";

type FunctionLike = (...args: never[]) => unknown;

const OPERATION_ARTIFACTS = new WeakMap<ATS.AnyTypeSchema, Map<string, CallableArtifact<FunctionLike>>>();

/** A callable, lazily-lowered execution plan. */
export type CallableArtifact<TFunction extends FunctionLike> = TFunction & {
  readonly plan: ExecutionPlan;
  compile(): CallableArtifact<TFunction>;
  explain(): ExecutionPlan;
};

export type ExecutionArtifact<TInput, TOutput> = CallableArtifact<(input: TInput) => TOutput>;

export type ValueArtifact<TInput, TOutput, TSchema extends ATS.AnyTypeSchema> = ExecutionArtifact<TInput, TOutput> & {
  readonly schema: TSchema;
  validate(): SchemaArtifact<TInput, TSchema>;
  map<TTarget extends ATS.AnyTypeSchema>(
    target: SchemaInput<TTarget>,
    mapping?: MapperOverridesInput
  ): SchemaArtifact<TInput, TTarget>;
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
  lower: () => TFunction
): CallableArtifact<TFunction> {
  let compiled: TFunction | undefined;
  const artifact = function executionArtifact(...args: Parameters<TFunction>): ReturnType<TFunction> {
    compiled ??= lower();
    return compiled(...args) as ReturnType<TFunction>;
  } as CallableArtifact<TFunction>;

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

/** Source stage for schema-directed JSON decoding. Constraints are deliberately not validated here. */
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
    () => (value) => JSON.parse(value)
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

  return createExecutionArtifact(plan, () => {
    const validator = compileValidator(unwrapped);

    switch (operation) {
      case "is":
        return validator.is as FunctionLike;
      case "parse":
        return validator.parse as FunctionLike;
      case "safeParse":
        return validator.safeParse as FunctionLike;
      case "parseAsync":
        return validator.parseAsync as FunctionLike;
      case "safeParseAsync":
        return validator.safeParseAsync as FunctionLike;
      case "issues":
        return function* issues(value: unknown) {
          const result = validator.safeParse(value);
          if (!result.success) yield* result.issues;
        } as FunctionLike;
    }
  });
}

/** Appends validation as a plan stage; construction never executes the preceding artifact. */
export function appendValidation<TInput, TOutput, TSchema extends ATS.AnyTypeSchema>(
  artifact: ExecutionArtifact<TInput, TOutput>,
  schema: TSchema
): SchemaArtifact<TInput, TSchema> {
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
  ]);
  const next = createExecutionArtifact<(value: TInput) => ATS.TypeofSchema<TSchema>>(
    plan,
    () => lowerExecutionPlan(plan) as (value: TInput) => ATS.TypeofSchema<TSchema>
  );

  return artifactForSchema(next, schema) as SchemaArtifact<TInput, TSchema>;
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
  const artifact = createExecutionArtifact(plan, () => lower(unwrapped));
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
    to: { enumerable: true, value: collectionSinks(compiled, state.schema) },
  });
  return Object.freeze(artifact);
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

/**
 * Chooses one runtime lowering for the complete descriptor. This is
 * intentionally called only by the final artifact, so composing stages never
 * compiles executable functions for intermediate artifacts.
 */
function lowerExecutionPlan(plan: ExecutionPlan): FunctionLike {
  let run: (value: unknown) => unknown = (value) => value;
  const stages = plan.stages;

  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index];

    switch (stage.kind) {
      case "value":
      case "to.array":
        break;
      case "json.decode": {
        const previous = run;
        run = (value) => JSON.parse(previous(value) as string);
        break;
      }
      case "binary.decode": {
        const previous = run;
        const decode = compileCodec(stage.schema).decode;
        run = (value) => decode(previous(value) as Uint8Array | ArrayBuffer);
        break;
      }
      case "validate": {
        const previous = run;
        const validator = compileValidator(stage.schema);

        switch (stage.operation) {
          case "is":
            run = (value) => validator.is(previous(value));
            break;
          case "parse":
            run = (value) => validator.parse(previous(value));
            break;
          case "safeParse":
            run = (value) => validator.safeParse(previous(value));
            break;
          case "parseAsync":
            run = (value) => validator.parseAsync(previous(value));
            break;
          case "safeParseAsync":
            run = (value) => validator.safeParseAsync(previous(value));
            break;
          case "issues":
            run = (value) => {
              const result = validator.safeParse(previous(value));

              return (function* issueIterator() {
                if (!result.success) yield* result.issues;
              })();
            };
            break;
        }
        break;
      }
      case "query": {
        let finalStage = stage;

        while (index + 1 < stages.length && stages[index + 1]?.kind === "query") {
          index++;
          finalStage = stages[index] as typeof finalStage;
        }
        const previous = run;
        const query = compileQuery(finalStage.source, finalStage.program);
        run = (value) => query(previous(value) as never);
        break;
      }
      case "map": {
        const previous = run;
        const mapper = createMapperFacade(stage.source, stage.target, stage.bindings[0] as MapperOverridesInput);
        run = stage.many
          ? (value) => mapper.many(previous(value) as readonly never[])
          : (value) => mapper.map(previous(value) as never);
        break;
      }
      case "json.encode": {
        const previous = run;
        const stringify = compileSerialize(stage.schema ?? plan.schema);
        run = (value) => stringify(previous(value) as never);
        break;
      }
      case "binary.encode": {
        const previous = run;
        const encode = compileCodec(stage.schema).encode;
        run = (value) => encode(previous(value) as never);
        break;
      }
      case "operation":
        throw new JITError("INVALID_OPERATION", `operation ${stage.operation} requires its dedicated runtime lowering`);
    }
  }

  return run as FunctionLike;
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
