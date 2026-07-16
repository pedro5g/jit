import {
  type BinaryArray,
  type BinaryRowSet,
  type BinaryRowSetOptions,
  compileBinaryArray,
  compileBinaryQuery,
} from "../compiler/binary-rowset.js";
import type { QueryCompareOperator, QueryConditionNode, QueryNode, QueryValueNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import type { QueryConditionBuilder, QueryConstRef, QueryParamRef, QueryRuntimeParams } from "./query.js";
import { constant, param } from "./query.js";

type ParamSchemaShape = Readonly<Record<string, SchemaInput>>;
type TypeofParamShape<TShape extends ParamSchemaShape> = {
  readonly [TKey in keyof TShape]: TShape[TKey] extends SchemaInput<infer TSchema> ? ATS.TypeofSchema<TSchema> : never;
};
type ProcessPick<TValue, TKey extends keyof TValue> = {
  readonly [TField in TKey]: TValue[TField];
};
type ProcessExecute<TElement, TResult, TParams extends Readonly<Record<string, unknown>>> = keyof TParams extends never
  ? (values: readonly TElement[], length?: number) => TResult
  : (values: readonly TElement[], params: TParams, length?: number) => TResult;

export interface ProcessBuilder<TElement> {
  binary(options?: BinaryRowSetOptions): BinaryProcessBuilder<TElement, TElement, TElement[]>;
}

export interface BinaryProcessCompiled<
  TElement,
  TResult,
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
> {
  readonly binary: BinaryArray<TElement>;
  readonly query: keyof TParams extends never
    ? (rowset: BinaryRowSet<TElement>) => TResult
    : (rowset: BinaryRowSet<TElement>, params: TParams) => TResult;
  readonly execute: ProcessExecute<TElement, TResult, TParams>;
}

export interface BinaryProcessBuilder<
  TElement,
  TOutput,
  TResult = TOutput[],
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
> {
  params<const TShape extends ParamSchemaShape>(
    shape: TShape
  ): BinaryProcessBuilder<TElement, TOutput, TResult, TypeofParamShape<TShape>>;
  filter(
    predicate: (query: QueryConditionBuilder<TElement>, params: QueryRuntimeParams<TParams>) => QueryConditionNode
  ): BinaryProcessBuilder<TElement, TOutput, TResult, TParams>;
  select<const TKeys extends readonly Extract<keyof TOutput, string>[]>(
    ...fields: TKeys
  ): BinaryProcessBuilder<
    TElement,
    ProcessPick<TOutput, TKeys[number]>,
    ProcessPick<TOutput, TKeys[number]>[],
    TParams
  >;
  sum<TKey extends Extract<keyof TElement, string>>(
    key: TKey
  ): BinaryProcessBuilder<TElement, TOutput, number, TParams>;
  count(): BinaryProcessBuilder<TElement, TOutput, number, TParams>;
  avg<TKey extends Extract<keyof TElement, string>>(
    key: TKey
  ): BinaryProcessBuilder<TElement, TOutput, number | undefined, TParams>;
  min<TKey extends Extract<keyof TElement, string>>(
    key: TKey
  ): BinaryProcessBuilder<TElement, TOutput, number | undefined, TParams>;
  max<TKey extends Extract<keyof TElement, string>>(
    key: TKey
  ): BinaryProcessBuilder<TElement, TOutput, number | undefined, TParams>;
  compile(): BinaryProcessCompiled<TElement, TResult, TParams>;
}

export function process<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): ProcessBuilder<ATS.TypeofSchema<TSchema>> {
  const objectSchema = unwrapSchema(schema);

  if (objectSchema.type !== TypeName.object) {
    throw new JITError("UNSUPPORTED_SCHEMA", "JIT.process expects an object schema");
  }

  return {
    binary(options) {
      return createBinaryProcessBuilder<
        ATS.TypeofSchema<TSchema>,
        ATS.TypeofSchema<TSchema>,
        ATS.TypeofSchema<TSchema>[]
      >(objectSchema, options ?? {}, [], [], []);
    },
  };
}

function createBinaryProcessBuilder<
  TElement,
  TOutput,
  TResult,
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
>(
  objectSchema: ATS.AnyTypeSchema,
  options: BinaryRowSetOptions,
  nodes: readonly QueryNode[],
  bindings: readonly unknown[],
  paramNames: readonly string[]
): BinaryProcessBuilder<TElement, TOutput, TResult, TParams> {
  return {
    params(shape) {
      return createBinaryProcessBuilder<TElement, TOutput, TResult, TypeofParamShape<typeof shape>>(
        objectSchema,
        options,
        nodes,
        bindings,
        Object.keys(shape)
      );
    },

    filter(predicate) {
      const state = createConditionBuilder(bindings.length);
      const condition = predicate(state.builder as QueryConditionBuilder<TElement>, createParamRefs(paramNames));

      return createBinaryProcessBuilder(
        objectSchema,
        options,
        [...nodes, { kind: "filter", condition }],
        [...bindings, ...state.bindings],
        paramNames
      );
    },

    select(...fields) {
      return createBinaryProcessBuilder(
        objectSchema,
        options,
        [...nodes, { kind: "select:fields", fields }],
        bindings,
        paramNames
      );
    },

    sum(key) {
      return createBinaryProcessBuilder(
        objectSchema,
        options,
        [...nodes, { kind: "aggregate", op: "sum", key }],
        bindings,
        paramNames
      );
    },

    count() {
      return createBinaryProcessBuilder(
        objectSchema,
        options,
        [...nodes, { kind: "aggregate", op: "count" }],
        bindings,
        paramNames
      );
    },

    avg(key) {
      return createBinaryProcessBuilder(
        objectSchema,
        options,
        [...nodes, { kind: "aggregate", op: "avg", key }],
        bindings,
        paramNames
      );
    },

    min(key) {
      return createBinaryProcessBuilder(
        objectSchema,
        options,
        [...nodes, { kind: "aggregate", op: "min", key }],
        bindings,
        paramNames
      );
    },

    max(key) {
      return createBinaryProcessBuilder(
        objectSchema,
        options,
        [...nodes, { kind: "aggregate", op: "max", key }],
        bindings,
        paramNames
      );
    },

    compile() {
      const processSchema = createProcessObjectSchema(objectSchema, nodes);
      const arraySchema = createSchema(TypeName.array, {
        element: processSchema,
      }) as ATS.ArraySchema;
      const binary = compileBinaryArray(arraySchema, options, {
        adaptiveStringFields: collectProjectionOnlyFields(processSchema, nodes),
      }) as BinaryArray<TElement>;
      const query = compileBinaryQuery<TElement, TResult, TParams>(binary, {
        nodes,
        bindings,
        params: paramNames,
      });
      const execute = ((values: readonly TElement[], second?: TParams | number, third?: number): TResult => {
        const hasParams = paramNames.length > 0;
        const params = hasParams ? (second as TParams) : undefined;
        const length = hasParams ? third : (second as number | undefined);
        const rowset = binary.load(values, length);

        if (hasParams)
          return (query as (rowset: BinaryRowSet<TElement>, params: TParams) => TResult)(rowset, params as TParams);
        return (query as (rowset: BinaryRowSet<TElement>) => TResult)(rowset);
      }) as ProcessExecute<TElement, TResult, TParams>;

      return Object.freeze({ binary, query, execute }) as BinaryProcessCompiled<TElement, TResult, TParams>;
    },
  };
}

function collectProjectionOnlyFields(schema: ATS.AnyTypeSchema, nodes: readonly QueryNode[]): ReadonlySet<string> {
  const filtered = new Set<string>();
  let selected: readonly string[] | undefined;
  let aggregate = false;

  for (const node of nodes) {
    if (node.kind === "filter") collectConditionKeys(node.condition, filtered);
    else if (node.kind === "select:fields") selected = node.fields;
    else if (node.kind === "aggregate") aggregate = true;
  }

  if (aggregate) return new Set();
  const projected = new Set(
    selected ?? (schema.type === TypeName.object ? Object.keys((schema as ATS.ObjectSchema).def.props) : [])
  );

  for (const key of filtered) projected.delete(key);
  return projected;
}

function createProcessObjectSchema(schema: ATS.AnyTypeSchema, nodes: readonly QueryNode[]): ATS.AnyTypeSchema {
  if (schema.type !== TypeName.object) return schema;

  const props = (schema as ATS.ObjectSchema).def.props;
  const keys = collectProcessKeys(nodes, Object.keys(props));

  if (keys === undefined) return schema;

  const picked: Record<string, ATS.AnyTypeSchema> = {};

  for (const key of keys) picked[key] = props[key];
  return createSchema(TypeName.object, {
    ...(schema.def as ATS.ObjectDef),
    props: picked,
  });
}

function collectProcessKeys(nodes: readonly QueryNode[], allKeys: readonly string[]): readonly string[] | undefined {
  const keys = new Set<string>();
  let hasProjection = false;
  let hasAggregate = false;

  for (const node of nodes) {
    switch (node.kind) {
      case "filter":
        collectConditionKeys(node.condition, keys);
        break;
      case "select:fields":
        hasProjection = true;
        for (const key of node.fields) keys.add(key);
        break;
      case "aggregate":
        hasAggregate = true;
        if (node.key) keys.add(node.key);
        break;
      default:
        return undefined;
    }
  }

  if (!hasProjection && !hasAggregate) return undefined;
  return allKeys.filter((key) => keys.has(key));
}

function collectConditionKeys(condition: QueryConditionNode, keys: Set<string>): void {
  switch (condition.kind) {
    case "compare":
      collectValueKey(condition.left, keys);
      collectValueKey(condition.right, keys);
      return;
    case "logical":
      collectConditionKeys(condition.left, keys);
      collectConditionKeys(condition.right, keys);
      return;
    case "not":
      collectConditionKeys(condition.inner, keys);
      return;
  }
}

function collectValueKey(value: QueryValueNode, keys: Set<string>): void {
  if (value.kind === "field") keys.add(value.key);
}

function createConditionBuilder(startIndex: number): {
  readonly builder: QueryConditionBuilder<unknown>;
  readonly bindings: readonly unknown[];
} {
  const bindings: unknown[] = [];
  const toValueNode = (value: unknown): QueryValueNode => {
    if (isQueryParamRef(value)) return { kind: "param", name: value.name };
    if (isQueryConstRef(value)) return { kind: "literal", value: value.value };

    const index = startIndex + bindings.length;

    bindings[bindings.length] = value;
    return { kind: "binding", name: `__q${index}` };
  };
  const compare = (op: QueryCompareOperator, key: string, value: unknown) => ({
    kind: "compare" as const,
    op,
    left: { kind: "field" as const, key },
    right: toValueNode(value),
  });

  return {
    bindings,
    builder: {
      constant,
      eq: (key, value) => compare("eq", key, value),
      neq: (key, value) => compare("neq", key, value),
      gt: (key, value) => compare("gt", key, value),
      gte: (key, value) => compare("gte", key, value),
      lt: (key, value) => compare("lt", key, value),
      lte: (key, value) => compare("lte", key, value),
      and: (left, right) => ({ kind: "logical", op: "and", left, right }),
      or: (left, right) => ({ kind: "logical", op: "or", left, right }),
      not: (inner) => ({ kind: "not", inner }),
    },
  };
}

function createParamRefs<TParams extends Readonly<Record<string, unknown>>>(
  names: readonly string[]
): QueryRuntimeParams<TParams> {
  const refs: Record<string, QueryParamRef> = {};

  for (const name of names) refs[name] = param(name);
  return refs as QueryRuntimeParams<TParams>;
}

function isQueryParamRef(value: unknown): value is QueryParamRef {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { readonly __jitQueryValue?: unknown }).__jitQueryValue === "param"
  );
}

function isQueryConstRef(value: unknown): value is QueryConstRef {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { readonly __jitQueryValue?: unknown }).__jitQueryValue === "const"
  );
}
