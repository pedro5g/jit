import type {
  QueryAggregateNode,
  QueryCollectorNode,
  QueryConditionNode,
  QueryFilterNode,
  QueryMutationNode,
  QueryNode,
  QueryOrderByNode,
  QuerySelectFieldsNode,
  QueryUniqueNode,
  QueryValueNode,
} from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { emitQuery } from "./emitter/emit-query.js";
import { buildQueryIR } from "./ir/builders/build-query-ir.js";
import { optimizeQueryIR } from "./ir/optimizer/optimize-ir.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";

type ArraySchema = ATS.AnyTypeSchema & { readonly def: ATS.ElementDef };
type SetSchema = ATS.AnyTypeSchema & { readonly def: ATS.ElementDef };
type MapSchema = ATS.AnyTypeSchema & { readonly def: ATS.KeyValueDef };
type QueryCollectionKind = "array" | "set" | "map";

/** Object schema of the collection element a query runs against. @internal */
export type QueryObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };

type ElementOf<T> = T extends readonly (infer TElement)[]
  ? TElement
  : T extends Set<infer TElement>
    ? TElement
    : T extends Map<unknown, infer TElement>
      ? TElement
      : never;

/** Resolved query input collection: kind plus element schema. @internal */
export interface QueryTarget {
  readonly kind: QueryCollectionKind;
  readonly objectSchema: QueryObjectSchema;
}

/**
 * A compiled query over a collection.
 *
 * @template TValue - The input collection type (array, Set, or Map of objects).
 * @template TOutput - The query result shape (list, Map, or grouped record).
 * @param value - The collection to query.
 * @returns The query result.
 */
export type QueryCompiled<TValue, TOutput> = (value: TValue) => TOutput;

/**
 * A data-first query description: AST nodes plus the runtime values they
 * reference. Values travel as external bindings, never as interpolated source.
 */
export interface QueryProgram {
  readonly nodes: readonly QueryNode[];
  readonly bindings: readonly unknown[];
}

interface QueryPlan {
  readonly filters: readonly QueryFilterNode[];
  readonly selects: readonly QuerySelectFieldsNode[];
  readonly uniques: readonly QueryUniqueNode[];
  readonly collectors: readonly QueryCollectorNode[];
  readonly orderBys: readonly QueryOrderByNode[];
  readonly aggregates: readonly QueryAggregateNode[];
  readonly mutations: readonly QueryMutationNode[];
}

/** Deduplicated query plan lowered to IR by `buildQueryIR`. @internal */
export interface OptimizedQueryPlan {
  readonly filters: readonly QueryFilterNode[];
  readonly select: QuerySelectFieldsNode | undefined;
  readonly unique: QueryUniqueNode | undefined;
  readonly collector: QueryCollectorNode | undefined;
  readonly orderBy: QueryOrderByNode | undefined;
  readonly aggregate: QueryAggregateNode | undefined;
  readonly mutation: QueryMutationNode | undefined;
}

/**
 * Emits the JavaScript source of a compiled query.
 *
 * @param schema - The collection schema the query runs against.
 * @param program - The query AST nodes and external bindings.
 * @returns The generated query source.
 *
 * @throws JITError with code `INVALID_QUERY` when a node references a field
 * the schema does not declare.
 */
export function emitQuerySource(schema: ATS.AnyTypeSchema, program: QueryProgram): string {
  const target = expectCollectionObjectSchema(schema, "emitQuerySource");
  const plan = optimizeQueryPlan(createQueryPlan(program.nodes));

  validateQueryPlan(target.objectSchema, plan);

  return emitQuery(optimizeQueryIR(buildQueryIR(target, plan)));
}

/**
 * Compiles a query plan (filters, select, unique, keyed/groupBy, orderBy,
 * delete/update) into a single specialized function with one fused pass over
 * the collection, with no intermediate arrays between steps.
 *
 * Prefer the typed `JIT.query(schema)` builder; this is the low-level entry
 * point it delegates to.
 *
 * @template TSchema - The collection schema the query runs against.
 * @template TOutput - The result shape produced by the plan's collector.
 * @param schema - The collection schema the query runs against.
 * @param program - The query AST nodes and external bindings.
 * @returns A compiled query function.
 *
 * @throws JITError with code `INVALID_QUERY` when a node references a field
 * the schema does not declare.
 */
export function compileQuery<TSchema extends ATS.AnyTypeSchema, TOutput = ElementOf<ATS.InferSchema<TSchema>>[]>(
  schema: TSchema,
  program: QueryProgram,
  options?: CompileCacheOptions
): QueryCompiled<ATS.InferSchema<TSchema>, TOutput> {
  const bindingNames = program.bindings.map((_, index) => `__q${index}`);
  // Bindings are user values, so only the pure source template is cached;
  // every compile re-applies its own bindings to a fresh closure.
  const template = getCompileCached(
    schema,
    `query:${serializeQueryNodes(program.nodes)}`,
    () => {
      const source = emitQuerySource(schema, program);

      return {
        source,
        create: globalThis.Function(...bindingNames, `return ${source};`),
      };
    },
    options
  );
  const compiled = template.create(...program.bindings) as QueryCompiled<ATS.InferSchema<TSchema>, TOutput>;

  // Lets AOT re-emit this exact query when aggregated via JIT.compile extras.
  registerArtifact(compiled as object, {
    kind: "query",
    source: template.source,
    bindingNames,
    bindingValues: program.bindings,
  });
  return compiled;
}

/**
 * Deterministic structural key for a query plan. Binding names participate
 * (they are part of the emitted source); binding values do not.
 */
function serializeQueryNodes(nodes: readonly QueryNode[]): string {
  return nodes.map(serializeQueryNode).join(";");
}

function serializeQueryNode(node: QueryNode): string {
  switch (node.kind) {
    case "filter":
      return `f(${serializeCondition(node.condition)})`;
    case "select:fields":
      return `s(${node.fields.join(",")})`;
    case "unique":
      return `u(${node.key})`;
    case "keyed":
      return `k(${node.key})`;
    case "groupBy":
      return `g(${node.key})`;
    case "orderBy":
      return `o(${node.key},${node.direction})`;
    case "aggregate":
      return `a(${node.op},${node.key ?? ""})`;
    case "delete":
      return "d()";
    case "update":
      return `m(${Object.keys(node.patch)
        .map((key) => `${key}=${node.patch[key]?.name}`)
        .join(",")})`;
  }
}

function serializeCondition(condition: QueryConditionNode): string {
  switch (condition.kind) {
    case "compare":
      return `${condition.op}(${serializeValue(condition.left)},${serializeValue(condition.right)})`;
    case "logical":
      return `${condition.op}(${serializeCondition(condition.left)},${serializeCondition(condition.right)})`;
    case "not":
      return `not(${serializeCondition(condition.inner)})`;
  }
}

function serializeValue(value: QueryValueNode): string {
  switch (value.kind) {
    case "field":
      return `.${value.key}`;
    case "binding":
      return `$${value.name}`;
    case "literal":
      return `#${typeof value.value}:${String(value.value)}`;
  }
}

function createQueryPlan(nodes: readonly QueryNode[]): QueryPlan {
  const filters: QueryFilterNode[] = [];
  const selects: QuerySelectFieldsNode[] = [];
  const uniques: QueryUniqueNode[] = [];
  const collectors: QueryCollectorNode[] = [];
  const orderBys: QueryOrderByNode[] = [];
  const aggregates: QueryAggregateNode[] = [];
  const mutations: QueryMutationNode[] = [];

  for (const node of nodes) {
    switch (node.kind) {
      case "filter":
        filters[filters.length] = node;
        break;
      case "select:fields":
        selects[selects.length] = node;
        break;
      case "unique":
        uniques[uniques.length] = node;
        break;
      case "keyed":
      case "groupBy":
        collectors[collectors.length] = node;
        break;
      case "orderBy":
        orderBys[orderBys.length] = node;
        break;
      case "aggregate":
        aggregates[aggregates.length] = node;
        break;
      case "delete":
      case "update":
        mutations[mutations.length] = node;
        break;
    }
  }

  return { filters, selects, uniques, collectors, orderBys, aggregates, mutations };
}

function optimizeQueryPlan(plan: QueryPlan): OptimizedQueryPlan {
  return {
    filters: plan.filters,
    select: last(plan.selects),
    unique: last(plan.uniques),
    collector: last(plan.collectors),
    orderBy: last(plan.orderBys),
    aggregate: last(plan.aggregates),
    mutation: last(plan.mutations),
  };
}

function validateQueryPlan(schema: QueryObjectSchema, plan: OptimizedQueryPlan): void {
  for (const filter of plan.filters) {
    validateCondition(schema, filter.condition);
  }

  if (plan.select) validateObjectKeys(schema, plan.select.fields, "query select");
  if (plan.unique) validateObjectKeys(schema, [plan.unique.key], "query unique");
  if (plan.collector) validateObjectKeys(schema, [plan.collector.key], `query ${plan.collector.kind}`);
  if (plan.orderBy) validateObjectKeys(schema, [plan.orderBy.key], "query orderBy");

  if (plan.collector && plan.orderBy) {
    throw new JITError("INVALID_QUERY", "query orderBy cannot be combined with keyed/groupBy in v1");
  }

  if (plan.aggregate) {
    if (plan.select || plan.collector || plan.orderBy || plan.mutation) {
      throw new JITError(
        "INVALID_QUERY",
        "query aggregate cannot be combined with select/keyed/groupBy/orderBy/delete/update in v1"
      );
    }

    if (plan.aggregate.op !== "count") {
      if (plan.aggregate.key === undefined) {
        throw new JITError("INVALID_QUERY", `query ${plan.aggregate.op} requires a field key`);
      }

      validateObjectKeys(schema, [plan.aggregate.key], `query ${plan.aggregate.op}`);
    }
  }

  if (plan.mutation) {
    if (plan.filters.length === 0) {
      throw new JITError("INVALID_QUERY", "query delete/update requires at least one filter in v1");
    }

    if (plan.select || plan.collector || plan.orderBy) {
      throw new JITError(
        "INVALID_QUERY",
        "query delete/update cannot be combined with select/keyed/groupBy/orderBy in v1"
      );
    }

    if (plan.mutation.kind === "update") {
      validateObjectKeys(schema, Object.keys(plan.mutation.patch), "query update");
    }
  }
}

function expectCollectionObjectSchema(schema: ATS.AnyTypeSchema, compilerName: string): QueryTarget {
  const resolved = resolveWrappers(schema).base;

  if (resolved.type !== TypeName.array && resolved.type !== TypeName.set && resolved.type !== TypeName.map) {
    throw new JITError("INVALID_QUERY", `${compilerName} expects an array, set, or map schema`);
  }

  const element =
    resolved.type === TypeName.map
      ? resolveWrappers((resolved as MapSchema).def.value).base
      : resolveWrappers((resolved as ArraySchema | SetSchema).def.element).base;

  if (element.type !== TypeName.object) {
    throw new JITError("INVALID_QUERY", `${compilerName} expects a collection of object schema`);
  }

  return { kind: resolved.type as QueryCollectionKind, objectSchema: element as QueryObjectSchema };
}

function validateObjectKeys(schema: QueryObjectSchema, keys: readonly string[], compilerName: string): void {
  const props = schema.def.props;

  for (const key of keys) {
    if (!(key in props)) {
      throw new JITError("INVALID_QUERY", `${compilerName} received unknown key ${JSON.stringify(key)}`, {
        path: [key],
      });
    }
  }
}

function validateCondition(schema: QueryObjectSchema, condition: QueryConditionNode): void {
  switch (condition.kind) {
    case "compare":
      validateValue(schema, condition.left);
      validateValue(schema, condition.right);
      return;
    case "logical":
      validateCondition(schema, condition.left);
      validateCondition(schema, condition.right);
      return;
    case "not":
      validateCondition(schema, condition.inner);
      return;
  }
}

function validateValue(schema: QueryObjectSchema, value: QueryValueNode): void {
  if (value.kind === "field") {
    validateObjectKeys(schema, [value.key], "query");
  }
}

function last<TValue>(values: readonly TValue[]): TValue | undefined {
  return values[values.length - 1];
}
