import type {
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
import { CodeWriter } from "./emitter/code-writer.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitLiteral } from "./source/literal.js";

type ArraySchema = ATS.AnyTypeSchema & { readonly def: ATS.ElementDef };
type SetSchema = ATS.AnyTypeSchema & { readonly def: ATS.ElementDef };
type MapSchema = ATS.AnyTypeSchema & { readonly def: ATS.KeyValueDef };
type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };
type SafeQueryLiteral = string | number | bigint | boolean | null | undefined;
type QueryCollectionKind = "array" | "set" | "map";

type ElementOf<T> = T extends readonly (infer TElement)[]
  ? TElement
  : T extends Set<infer TElement>
    ? TElement
    : T extends Map<unknown, infer TElement>
      ? TElement
      : never;

interface QueryTarget {
  readonly kind: QueryCollectionKind;
  readonly objectSchema: ObjectSchema;
}

export type QueryCompiled<TValue, TOutput> = (value: TValue) => TOutput;

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
  readonly mutations: readonly QueryMutationNode[];
}

interface OptimizedQueryPlan {
  readonly filters: readonly QueryFilterNode[];
  readonly select: QuerySelectFieldsNode | undefined;
  readonly unique: QueryUniqueNode | undefined;
  readonly collector: QueryCollectorNode | undefined;
  readonly orderBy: QueryOrderByNode | undefined;
  readonly mutation: QueryMutationNode | undefined;
}

export function emitQuerySource(schema: ATS.AnyTypeSchema, program: QueryProgram): string {
  const target = expectCollectionObjectSchema(schema, "emitQuerySource");
  const plan = optimizeQueryPlan(createQueryPlan(program.nodes));

  validateQueryPlan(target.objectSchema, plan);

  return emitQueryPlan(target, plan);
}

export function compileQuery<TSchema extends ATS.AnyTypeSchema, TOutput = ElementOf<ATS.InferSchema<TSchema>>[]>(
  schema: TSchema,
  program: QueryProgram
): QueryCompiled<ATS.InferSchema<TSchema>, TOutput> {
  const bindingNames = program.bindings.map((_, index) => `__q${index}`);

  return globalThis.Function(
    ...bindingNames,
    `return ${emitQuerySource(schema, program)};`
  )(...program.bindings) as QueryCompiled<ATS.InferSchema<TSchema>, TOutput>;
}

function createQueryPlan(nodes: readonly QueryNode[]): QueryPlan {
  const filters: QueryFilterNode[] = [];
  const selects: QuerySelectFieldsNode[] = [];
  const uniques: QueryUniqueNode[] = [];
  const collectors: QueryCollectorNode[] = [];
  const orderBys: QueryOrderByNode[] = [];
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
      case "delete":
      case "update":
        mutations[mutations.length] = node;
        break;
    }
  }

  return { filters, selects, uniques, collectors, orderBys, mutations };
}

function optimizeQueryPlan(plan: QueryPlan): OptimizedQueryPlan {
  return {
    filters: plan.filters,
    select: last(plan.selects),
    unique: last(plan.uniques),
    collector: last(plan.collectors),
    orderBy: last(plan.orderBys),
    mutation: last(plan.mutations),
  };
}

function emitQueryPlan(target: QueryTarget, plan: OptimizedQueryPlan): string {
  const writer = new CodeWriter();

  writer.line("function query(value) {");
  writer.indent(() => {
    if (plan.mutation) {
      emitMutationQuery(writer, target, plan);
    } else if (plan.collector) {
      emitCollectedQuery(writer, target, plan);
    } else {
      emitArrayQuery(writer, target, plan);
    }
  });
  writer.line("}");

  return writer.toString();
}

function emitArrayQuery(writer: CodeWriter, target: QueryTarget, plan: OptimizedQueryPlan): void {
  if (shouldProjectAfterOrder(plan)) {
    emitArrayQueryWithPostOrderProjection(writer, target, plan);
    return;
  }

  const selected = emitProjection("item", plan.select);

  emitLoopHeader(writer, target, plan, "new Array(len)");
  writer.line("let j = 0;");
  emitInputLoop(writer, target, () => {
    emitGuardedBody(writer, plan, () => {
      writer.line(`out[j++] = ${selected};`);
    });
  });
  writer.line("out.length = j;");
  emitOrderBy(writer, plan.orderBy);
  writer.line("return out;");
}

function emitArrayQueryWithPostOrderProjection(
  writer: CodeWriter,
  target: QueryTarget,
  plan: OptimizedQueryPlan
): void {
  const selected = emitProjection("item", plan.select);

  emitLoopHeader(writer, target, plan, "new Array(len)");
  writer.line("let j = 0;");
  emitInputLoop(writer, target, () => {
    emitGuardedBody(writer, plan, () => {
      writer.line("out[j++] = item;");
    });
  });
  writer.line("out.length = j;");
  emitOrderBy(writer, plan.orderBy);
  writer.line("const projected = new Array(j);");
  writer.line("for (let i = 0; i < j; i++) {");
  writer.indent(() => {
    writer.line("const item = out[i];");
    writer.line(`projected[i] = ${selected};`);
  });
  writer.line("}");
  writer.line("return projected;");
}

function emitCollectedQuery(writer: CodeWriter, target: QueryTarget, plan: OptimizedQueryPlan): void {
  const collector = plan.collector;

  if (!collector) return;

  if (plan.orderBy) {
    throw new JITError("INVALID_QUERY", "query orderBy cannot be combined with keyed/groupBy in v1");
  }

  const selected = emitProjection("item", plan.select);
  const keyAccess = emitPropertyAccess("item", collector.key);

  emitLoopHeader(writer, target, plan, collector.kind === "keyed" ? "new Map()" : "Object.create(null)");
  emitInputLoop(writer, target, () => {
    emitGuardedBody(writer, plan, () => {
      writer.line(`const collectKey = ${keyAccess};`);
      if (collector.kind === "keyed") {
        writer.line(`out.set(collectKey, ${selected});`);
      } else {
        writer.line("let group = out[collectKey];");
        writer.line("if (group === undefined) {");
        writer.indent(() => {
          writer.line("group = [];");
          writer.line("out[collectKey] = group;");
        });
        writer.line("}");
        writer.line(`group[group.length] = ${selected};`);
      }
    });
  });
  writer.line("return out;");
}

function emitMutationQuery(writer: CodeWriter, target: QueryTarget, plan: OptimizedQueryPlan): void {
  const mutation = plan.mutation;

  if (!mutation) return;

  emitLoopHeader(
    writer,
    target,
    plan,
    target.kind === "array" ? "new Array(len)" : target.kind === "set" ? "new Set()" : "new Map()"
  );
  if (target.kind === "array") writer.line("let j = 0;");
  emitInputLoop(writer, target, () => {
    const condition = emitFilters(plan.filters);
    const test = condition ? `(${condition})` : "false";

    if (mutation.kind === "delete") {
      writer.line(`if (!${test}) {`);
      writer.indent(() => emitMutationKeep(writer, target, "item"));
      writer.line("}");
      return;
    }

    writer.line(`if (${test}) {`);
    writer.indent(() => emitMutationKeep(writer, target, emitPatchObject("item", target.objectSchema, mutation)));
    writer.line("} else {");
    writer.indent(() => emitMutationKeep(writer, target, "item"));
    writer.line("}");
  });
  if (target.kind === "array") writer.line("out.length = j;");
  writer.line("return out;");
}

function emitMutationKeep(writer: CodeWriter, target: QueryTarget, value: string): void {
  switch (target.kind) {
    case "array":
      writer.line(`out[j++] = ${value};`);
      return;
    case "set":
      writer.line(`out.add(${value});`);
      return;
    case "map":
      writer.line(`out.set(entry[0], ${value});`);
      return;
  }
}

function emitPatchObject(base: string, schema: ObjectSchema, mutation: QueryMutationNode): string {
  if (mutation.kind !== "update") return base;

  const entries = Object.keys(schema.def.props).map((key) => {
    const value = mutation.patch[key]?.name ?? emitPropertyAccess(base, key);

    return `${emitLiteral(key)}: ${value}`;
  });

  return `{ ${entries.join(", ")} }`;
}

function emitLoopHeader(
  writer: CodeWriter,
  target: QueryTarget,
  plan: OptimizedQueryPlan,
  outInitializer: string
): void {
  writer.line(`const len = ${target.kind === "array" ? "value.length" : "value.size"};`);
  if (plan.unique) writer.line("const seen = new Set();");
  writer.line(`const out = ${outInitializer};`);
}

function emitInputLoop(writer: CodeWriter, target: QueryTarget, body: () => void): void {
  switch (target.kind) {
    case "array":
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        writer.line("const item = value[i];");
        body();
      });
      writer.line("}");
      return;
    case "set":
      writer.line("for (const item of value) {");
      writer.indent(body);
      writer.line("}");
      return;
    case "map":
      writer.line("for (const entry of value) {");
      writer.indent(() => {
        writer.line("const item = entry[1];");
        body();
      });
      writer.line("}");
      return;
  }
}

function emitGuardedBody(writer: CodeWriter, plan: OptimizedQueryPlan, emitAccepted: () => void): void {
  const condition = emitFilters(plan.filters);

  if (condition) {
    writer.line(`if (${condition}) {`);
    writer.indent(() => emitUniqueOrAccepted(writer, plan, emitAccepted));
    writer.line("}");
    return;
  }

  emitUniqueOrAccepted(writer, plan, emitAccepted);
}

function emitUniqueOrAccepted(writer: CodeWriter, plan: OptimizedQueryPlan, emitAccepted: () => void): void {
  if (!plan.unique) {
    emitAccepted();
    return;
  }

  const keyAccess = emitPropertyAccess("item", plan.unique.key);

  writer.line(`const uniqueKey = ${keyAccess};`);
  writer.line("if (!seen.has(uniqueKey)) {");
  writer.indent(() => {
    writer.line("seen.add(uniqueKey);");
    emitAccepted();
  });
  writer.line("}");
}

function emitOrderBy(writer: CodeWriter, orderBy: QueryOrderByNode | undefined): void {
  if (!orderBy) return;

  const leftAccess = emitPropertyAccess("left", orderBy.key);
  const rightAccess = emitPropertyAccess("right", orderBy.key);

  writer.line("out.sort((left, right) => {");
  writer.indent(() => {
    writer.line(`const leftValue = ${leftAccess};`);
    writer.line(`const rightValue = ${rightAccess};`);
    writer.line("if (leftValue === rightValue) return 0;");
    if (orderBy.direction === "desc") {
      writer.line("return leftValue < rightValue ? 1 : -1;");
    } else {
      writer.line("return leftValue < rightValue ? -1 : 1;");
    }
  });
  writer.line("});");
}

function shouldProjectAfterOrder(plan: OptimizedQueryPlan): boolean {
  return Boolean(plan.select && plan.orderBy && !plan.select.fields.includes(plan.orderBy.key));
}

function emitFilters(filters: readonly QueryFilterNode[]): string | undefined {
  if (filters.length === 0) return undefined;

  return filters.map((filter) => `(${emitCondition(filter.condition, "item")})`).join(" && ");
}

function validateQueryPlan(schema: ObjectSchema, plan: OptimizedQueryPlan): void {
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

  return { kind: resolved.type as QueryCollectionKind, objectSchema: element as ObjectSchema };
}

function validateObjectKeys(schema: ObjectSchema, keys: readonly string[], compilerName: string): void {
  const props = schema.def.props;

  for (const key of keys) {
    if (!(key in props)) {
      throw new JITError("INVALID_QUERY", `${compilerName} received unknown key ${JSON.stringify(key)}`, {
        path: [key],
      });
    }
  }
}

function validateCondition(schema: ObjectSchema, condition: QueryConditionNode): void {
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

function validateValue(schema: ObjectSchema, value: QueryValueNode): void {
  if (value.kind === "field") {
    validateObjectKeys(schema, [value.key], "query");
  }
}

function emitCondition(condition: QueryConditionNode, base: string): string {
  switch (condition.kind) {
    case "compare": {
      const left = emitValue(condition.left, base);
      const right = emitValue(condition.right, base);

      switch (condition.op) {
        case "eq":
          return `${left} === ${right}`;
        case "neq":
          return `${left} !== ${right}`;
        case "gt":
          return `${left} > ${right}`;
        case "gte":
          return `${left} >= ${right}`;
        case "lt":
          return `${left} < ${right}`;
        case "lte":
          return `${left} <= ${right}`;
      }

      throw new JITError("INVALID_QUERY", "Unsupported comparison operator");
    }
    case "logical": {
      const left = emitCondition(condition.left, base);
      const right = emitCondition(condition.right, base);
      const op = condition.op === "and" ? "&&" : "||";

      return `(${left} ${op} ${right})`;
    }
    case "not":
      return `!(${emitCondition(condition.inner, base)})`;
  }
}

function emitValue(value: QueryValueNode, base: string): string {
  switch (value.kind) {
    case "field":
      return emitPropertyAccess(base, value.key);
    case "binding":
      return value.name;
    case "literal":
      return emitSafeLiteral(value.value);
  }
}

function emitSafeLiteral(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return emitLiteral(value as SafeQueryLiteral);
  }

  throw new JITError("INVALID_QUERY", "query literal values must be primitive compiler literals");
}

function emitProjection(base: string, select: QuerySelectFieldsNode | undefined): string {
  if (!select) return base;

  const entries = select.fields.map((field) => `${emitLiteral(field)}: ${emitPropertyAccess(base, field)}`);

  return `{ ${entries.join(", ")} }`;
}

function last<TValue>(values: readonly TValue[]): TValue | undefined {
  return values[values.length - 1];
}
