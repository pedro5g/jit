import type {
  QueryAggregateNode,
  QueryConditionNode,
  QueryFilterNode,
  QueryNode,
  QuerySelectFieldsNode,
  QueryValueNode,
} from "../core/ast/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import {
  emitDictionaryBindings,
  emitFieldComparable,
  emitGuardState,
  emitHydratedObjectAssignment,
  emitObjectExpression,
  emitRowCursorAdvance,
  emitRowCursorDeclarations,
  emitRowViewBindings,
  hasDictionary,
} from "./binary-query-codegen.js";
import { serializeBinaryLayout, serializeQueryNodes } from "./binary-query-support.js";
import type {
  BinaryArray,
  BinaryFieldLayout,
  BinaryQueryCompiled,
  BinaryQueryProgram,
  BinaryRowLayout,
  BinaryRowSet,
} from "./binary-rowset.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitLiteral } from "./source/literal.js";

interface BinaryQueryPlan {
  readonly filters: readonly QueryFilterNode[];
  readonly select: QuerySelectFieldsNode | undefined;
  readonly aggregate: QueryAggregateNode | undefined;
}

interface FieldLookup {
  readonly fields: ReadonlyMap<string, BinaryFieldLayout>;
}

/** Emits deterministic source for the JIT emit binary query source operation. */
export function emitBinaryQuerySource(layout: BinaryRowLayout, program: BinaryQueryProgram): string {
  const plan = createBinaryQueryPlan(program.nodes);
  const lookup = createFieldLookup(layout);

  validateBinaryQueryPlan(lookup, plan);
  const accessedFields = collectQueryAccessFields(layout, lookup, plan);

  const writer = new CodeWriter();
  const hasParams = Boolean(program.params?.length);

  writer.line(`function query(rowset${hasParams ? ", params" : ""}) {`);
  writer.indent(() => {
    emitRowViewBindings(writer, accessedFields);
    if (hasDictionary(accessedFields)) writer.line("const dictionaries = rowset.dictionaries;");
    writer.line("const len = rowset.count;");
    emitDictionaryBindings(writer, accessedFields);

    const prepared = new PreparedValues(writer);
    const aggregateKey = plan.aggregate?.key;
    const cacheAggregateValue = aggregateKey !== undefined && filtersReadField(plan.filters, aggregateKey);
    const comparableOverrides = cacheAggregateValue ? new Map([[aggregateKey, "v"]]) : undefined;
    const condition = emitBinaryFilter(plan, lookup, prepared, comparableOverrides);

    if (plan.aggregate) {
      emitBinaryAggregateQuery(writer, layout, lookup, plan, condition, accessedFields, cacheAggregateValue);
    } else {
      emitBinaryArrayQuery(writer, layout, plan, condition, accessedFields);
    }
  });
  writer.line("}");

  return writer.toString();
}

/** Creates the JIT compile binary query artifact from the supplied input. */
export function compileBinaryQuery<
  TElement,
  TResult = TElement[],
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
>(
  target: BinaryArray<TElement> | BinaryRowSet<TElement>,
  program: BinaryQueryProgram,
  options?: CompileCacheOptions
): BinaryQueryCompiled<TElement, TResult, TParams> {
  const layout = target.layout;
  const schema = target.schema;
  const bindingNames = program.bindings.map((_, index) => `__q${index}`);
  const cacheKey = `binary-query:${serializeBinaryLayout(layout)}:${serializeQueryNodes(program.nodes)}`;
  const template = getCompileCached(
    schema,
    cacheKey,
    () => {
      const source = emitBinaryQuerySource(layout, program);

      return {
        source,
        create: globalThis.Function(...bindingNames, `return ${source};`),
      };
    },
    options
  );
  const compiled = template.create(...program.bindings) as BinaryQueryCompiled<TElement, TResult, TParams>;

  registerArtifact(compiled as object, {
    kind: "query",
    source: template.source,
    bindingNames,
    bindingValues: program.bindings,
  });
  return compiled;
}

function createBinaryQueryPlan(nodes: readonly QueryNode[]): BinaryQueryPlan {
  const filters: QueryFilterNode[] = [];
  let select: QuerySelectFieldsNode | undefined;
  let aggregate: QueryAggregateNode | undefined;

  for (const node of nodes) {
    switch (node.kind) {
      case "filter":
        filters[filters.length] = node;
        break;
      case "select:fields":
        select = node;
        break;
      case "aggregate":
        aggregate = node;
        break;
      default:
        throw new JITError(
          "INVALID_QUERY",
          `binary rowset query supports filter, select, and aggregate in v1; received ${node.kind}`
        );
    }
  }

  if (select && aggregate) {
    throw new JITError("INVALID_QUERY", "binary rowset aggregate cannot be combined with select in v1");
  }

  return { filters, select, aggregate };
}

function createFieldLookup(layout: BinaryRowLayout): FieldLookup {
  return { fields: new Map(layout.fields.map((field) => [field.key, field])) };
}

function validateBinaryQueryPlan(lookup: FieldLookup, plan: BinaryQueryPlan): void {
  for (const filter of plan.filters) validateCondition(lookup, filter.condition);

  if (plan.select) validateKeys(lookup, plan.select.fields, "binary query select");
  if (plan.aggregate?.key) validateKeys(lookup, [plan.aggregate.key], `binary query ${plan.aggregate.op}`);
}

function validateCondition(lookup: FieldLookup, condition: QueryConditionNode): void {
  switch (condition.kind) {
    case "compare":
      validateValue(lookup, condition.left);
      validateValue(lookup, condition.right);
      return;
    case "logical":
      validateCondition(lookup, condition.left);
      validateCondition(lookup, condition.right);
      return;
    case "not":
      validateCondition(lookup, condition.inner);
      return;
  }
}

function validateValue(lookup: FieldLookup, value: QueryValueNode): void {
  if (value.kind === "field") validateKeys(lookup, [value.key], "binary query filter");
}

function validateKeys(lookup: FieldLookup, keys: readonly string[], label: string): void {
  for (const key of keys) {
    if (!lookup.fields.has(key)) throw new JITError("INVALID_QUERY", `${label} received unknown key ${key}`);
  }
}

function collectQueryAccessFields(
  layout: BinaryRowLayout,
  lookup: FieldLookup,
  plan: BinaryQueryPlan
): readonly BinaryFieldLayout[] {
  const keys = new Set<string>();

  for (const filter of plan.filters) collectConditionFieldKeys(filter.condition, keys);

  if (plan.aggregate?.key) {
    keys.add(plan.aggregate.key);
  } else if (!plan.aggregate) {
    if (plan.select) {
      for (const key of plan.select.fields) keys.add(key);
    } else {
      for (const field of layout.fields) keys.add(field.key);
    }
  }

  return layout.fields.filter((field) => keys.has(field.key) && lookup.fields.has(field.key));
}

function collectConditionFieldKeys(condition: QueryConditionNode, keys: Set<string>): void {
  switch (condition.kind) {
    case "compare":
      if (condition.left.kind === "field") keys.add(condition.left.key);
      if (condition.right.kind === "field") keys.add(condition.right.key);
      return;
    case "logical":
      collectConditionFieldKeys(condition.left, keys);
      collectConditionFieldKeys(condition.right, keys);
      return;
    case "not":
      collectConditionFieldKeys(condition.inner, keys);
      return;
  }
}

function filtersReadField(filters: readonly QueryFilterNode[], key: string): boolean {
  const keys = new Set<string>();

  for (const filter of filters) collectConditionFieldKeys(filter.condition, keys);
  return keys.has(key);
}

function emitBinaryFilter(
  plan: BinaryQueryPlan,
  lookup: FieldLookup,
  prepared: PreparedValues,
  comparableOverrides?: ReadonlyMap<string, string>
): string | undefined {
  if (plan.filters.length === 0) return undefined;
  return plan.filters
    .map((filter) => emitCondition(filter.condition, lookup, prepared, comparableOverrides))
    .join(" && ");
}

function emitBinaryArrayQuery(
  writer: CodeWriter,
  layout: BinaryRowLayout,
  plan: BinaryQueryPlan,
  condition: string | undefined,
  accessedFields: readonly BinaryFieldLayout[]
): void {
  writer.line("const out = new Array(len);");
  writer.line("let j = 0;");
  emitRowCursorDeclarations(writer, layout, accessedFields);
  writer.line("for (let i = 0; i < len; i++) {");
  writer.indent(() => {
    const accepted = () => {
      if (layout.union && !plan.select) {
        emitHydratedObjectAssignment(writer, layout, "out[j++]");
      } else {
        writer.line(`out[j++] = ${emitObjectExpression(layout.fields, plan.select?.fields)};`);
      }
    };

    if (condition) {
      writer.line(`if (${condition}) {`);
      writer.indent(accepted);
      writer.line("}");
    } else {
      accepted();
    }
    emitRowCursorAdvance(writer, layout, accessedFields);
  });
  writer.line("}");
  writer.line("out.length = j;");
  writer.line("return out;");
}

function emitBinaryAggregateQuery(
  writer: CodeWriter,
  layout: BinaryRowLayout,
  lookup: FieldLookup,
  plan: BinaryQueryPlan,
  condition: string | undefined,
  accessedFields: readonly BinaryFieldLayout[],
  cacheAggregateValue: boolean
): void {
  const aggregate = plan.aggregate;
  if (!aggregate) return;
  const field = aggregate.key ? lookup.fields.get(aggregate.key) : undefined;
  const accepted = (body: () => void) => emitAcceptedRows(writer, condition, body);

  if (aggregate.op === "count") {
    writer.line("let acc = 0;");
    emitRowCursorDeclarations(writer, layout, accessedFields);
    writer.line("for (let i = 0; i < len; i++) {");
    writer.indent(() => {
      accepted(() => writer.line("acc++;"));
      emitRowCursorAdvance(writer, layout, accessedFields);
    });
    writer.line("}");
    writer.line("return acc;");
    return;
  }

  if (!field) throw new JITError("INVALID_QUERY", `binary query ${aggregate.op} requires a field key`);
  if (field.kind !== "float64" && field.kind !== "float32" && field.kind !== "int32") {
    throw new JITError("INVALID_QUERY", `binary query ${aggregate.op} expects a numeric field`);
  }
  emitNumericAggregateQuery(
    writer,
    layout,
    field,
    aggregate.op,
    condition,
    accessedFields,
    cacheAggregateValue,
    accepted
  );
}

function emitAcceptedRows(writer: CodeWriter, condition: string | undefined, body: () => void): void {
  if (condition) {
    writer.line(`if (${condition}) {`);
    writer.indent(body);
    writer.line("}");
  } else {
    body();
  }
}

function emitNumericAggregateQuery(
  writer: CodeWriter,
  layout: BinaryRowLayout,
  field: BinaryFieldLayout,
  operation: "sum" | "avg" | "min" | "max",
  condition: string | undefined,
  accessedFields: readonly BinaryFieldLayout[],
  cacheAggregateValue: boolean,
  accepted: (body: () => void) => void
): void {
  const rawValue = emitFieldComparable(field);
  const value = cacheAggregateValue ? "v" : rawValue;
  const present = field.guard ? `${emitGuardState(field)} === 2` : "true";

  switch (operation) {
    case "sum":
      writer.line("let acc = 0;");
      emitRowCursorDeclarations(writer, layout, accessedFields);
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        if (cacheAggregateValue) writer.line(`const v = ${rawValue};`);
        const shouldAdd = condition ? (field.guard ? `(${condition}) && ${present}` : condition) : present;
        writer.line(shouldAdd === "true" ? `acc += ${value};` : `acc += (${shouldAdd}) ? ${value} : 0;`);
        emitRowCursorAdvance(writer, layout, accessedFields);
      });
      writer.line("}");
      writer.line("return acc;");
      return;
    case "avg":
      writer.line("let acc = 0;");
      writer.line("let n = 0;");
      emitRowCursorDeclarations(writer, layout, accessedFields);
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        if (cacheAggregateValue) writer.line(`const v = ${rawValue};`);
        accepted(() => {
          writer.line(`if (${present}) {`);
          writer.indent(() => {
            writer.line(`acc += ${value};`);
            writer.line("n++;");
          });
          writer.line("}");
        });
        emitRowCursorAdvance(writer, layout, accessedFields);
      });
      writer.line("}");
      writer.line("return n === 0 ? undefined : acc / n;");
      return;
    case "min":
    case "max": {
      const comparison = operation === "min" ? "<" : ">";
      writer.line("let acc;");
      emitRowCursorDeclarations(writer, layout, accessedFields);
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        if (cacheAggregateValue) writer.line(`const v = ${rawValue};`);
        accepted(() => {
          writer.line(`if (${present}) {`);
          writer.indent(() => {
            writer.line(`const candidate = ${value};`);
            writer.line(`if (acc === undefined || candidate ${comparison} acc) acc = candidate;`);
          });
          writer.line("}");
        });
        emitRowCursorAdvance(writer, layout, accessedFields);
      });
      writer.line("}");
      writer.line("return acc;");
      return;
    }
  }
}

function emitCondition(
  condition: QueryConditionNode,
  lookup: FieldLookup,
  prepared: PreparedValues,
  comparableOverrides?: ReadonlyMap<string, string>
): string {
  switch (condition.kind) {
    case "compare":
      return emitCompare(condition.left, condition.op, condition.right, lookup, prepared, comparableOverrides);
    case "logical":
      return `(${emitCondition(condition.left, lookup, prepared, comparableOverrides)} ${condition.op === "and" ? "&&" : "||"} ${emitCondition(
        condition.right,
        lookup,
        prepared,
        comparableOverrides
      )})`;
    case "not":
      return `!(${emitCondition(condition.inner, lookup, prepared, comparableOverrides)})`;
  }
}

function emitCompare(
  left: QueryValueNode,
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
  right: QueryValueNode,
  lookup: FieldLookup,
  prepared: PreparedValues,
  comparableOverrides?: ReadonlyMap<string, string>
): string {
  if (left.kind === "field") {
    const field = expectField(lookup, left.key);

    return emitFieldCompare(field, op, right, prepared, comparableOverrides?.get(left.key));
  }

  if (right.kind === "field") {
    const field = expectField(lookup, right.key);

    return emitFieldCompare(field, reverseCompare(op), left, prepared, comparableOverrides?.get(right.key));
  }

  throw new JITError("INVALID_QUERY", "binary rowset comparisons require at least one field operand");
}

function emitFieldCompare(
  field: BinaryFieldLayout,
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
  value: QueryValueNode,
  prepared: PreparedValues,
  comparableOverride?: string
): string {
  if (field.dictionaryMode === "adaptive") {
    throw new JITError("INVALID_QUERY", `binary adaptive string field ${field.key} is projection-only`);
  }
  const comparable = comparableOverride ?? emitFieldComparable(field);
  const valueExpr = prepared.valueFor(field, value);
  const equality =
    field.guard === undefined
      ? `${comparable} === ${valueExpr}`
      : `((${prepared.rawFor(value)} === undefined && ${emitGuardState(field)} === 0) || (${prepared.rawFor(
          value
        )} === null && ${emitGuardState(field)} === 1) || (${emitGuardState(field)} === 2 && ${comparable} === ${valueExpr}))`;

  if (op === "eq") return equality;
  if (op === "neq") return `!(${equality})`;

  if (field.kind === "string" || field.kind === "enum" || field.kind === "literalUnion") {
    throw new JITError("INVALID_QUERY", `binary rowset ${op} does not support dictionary fields`);
  }

  const present = field.guard ? `${emitGuardState(field)} === 2 && ` : "";
  const operator = op === "gt" ? ">" : op === "gte" ? ">=" : op === "lt" ? "<" : "<=";

  return `(${present}${comparable} ${operator} ${valueExpr})`;
}

function expectField(lookup: FieldLookup, key: string): BinaryFieldLayout {
  const field = lookup.fields.get(key);

  if (!field) throw new JITError("INVALID_QUERY", `binary rowset query received unknown key ${key}`);
  return field;
}

function reverseCompare(op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"): "eq" | "neq" | "gt" | "gte" | "lt" | "lte" {
  switch (op) {
    case "gt":
      return "lt";
    case "gte":
      return "lte";
    case "lt":
      return "gt";
    case "lte":
      return "gte";
    default:
      return op;
  }
}

class PreparedValues {
  readonly #writer: CodeWriter;
  readonly #prepared = new Map<string, string>();

  constructor(writer: CodeWriter) {
    this.#writer = writer;
  }

  rawFor(value: QueryValueNode): string {
    switch (value.kind) {
      case "binding":
        return value.name;
      case "param":
        return `params${emitPropertyAccess("", value.name)}`;
      case "literal":
        return emitLiteral(value.value as never);
      case "field":
        throw new JITError("INVALID_QUERY", "field-to-field dictionary comparisons are not supported in binary v1");
    }
  }

  valueFor(field: BinaryFieldLayout, value: QueryValueNode): string {
    if (field.kind === "boolean") {
      const raw = this.rawFor(value);
      const key = `boolean:${raw}`;
      const existing = this.#prepared.get(key);

      if (existing) return existing;
      const name = `p${this.#prepared.size}`;

      this.#writer.line(`const ${name} = ${raw} === true ? 1 : ${raw} === false ? 0 : -1;`);
      this.#prepared.set(key, name);
      return name;
    }

    if (field.kind === "date") {
      const raw = this.rawFor(value);
      const key = `date:${raw}`;
      const existing = this.#prepared.get(key);

      if (existing) return existing;
      const name = `p${this.#prepared.size}`;

      this.#writer.line(`const ${name} = ${raw} instanceof Date ? ${raw}.getTime() : ${raw};`);
      this.#prepared.set(key, name);
      return name;
    }

    if (field.kind === "string" || field.kind === "enum" || field.kind === "literalUnion") {
      const raw = this.rawFor(value);
      const key = `dict:${field.dictionaryIndex}:${raw}`;
      const existing = this.#prepared.get(key);

      if (existing) return existing;
      const name = `p${this.#prepared.size}`;

      this.#writer.line(`const ${name} = d${field.dictionaryIndex}.ids.get(${raw});`);
      this.#prepared.set(key, name);
      return name;
    }

    return this.rawFor(value);
  }
}
