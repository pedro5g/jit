import type { QueryConditionNode, QueryPipelineNode, QueryValueNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitLiteral } from "./source/literal.js";

export type QueryExecutionMode = "eager-array" | "generator" | "async-generator" | "visitor";

export interface LazyQueryProgram {
  readonly nodes: readonly QueryPipelineNode[];
  readonly bindings: readonly unknown[];
  readonly params?: readonly string[];
}

export interface QueryExecutionPlan {
  readonly outputMode: QueryExecutionMode;
  readonly materializes: boolean;
  readonly materializationReason: string | undefined;
  readonly earlyTermination: boolean;
  readonly retainedState: readonly string[];
  readonly estimatedAllocationsPerResult: number;
  readonly barriers: readonly string[];
}

export type QueryIteratorCompiled<
  TElement,
  TOutput,
  TParams extends Readonly<Record<string, unknown>>,
> = keyof TParams extends never
  ? (input: Iterable<TElement>) => IterableIterator<TOutput>
  : (input: Iterable<TElement>, params: TParams) => IterableIterator<TOutput>;

export type QueryAsyncIteratorCompiled<
  TElement,
  TOutput,
  TParams extends Readonly<Record<string, unknown>>,
> = keyof TParams extends never
  ? (input: AsyncIterable<TElement> | Iterable<TElement>) => AsyncGenerator<TOutput>
  : (input: AsyncIterable<TElement> | Iterable<TElement>, params: TParams) => AsyncGenerator<TOutput>;

export type QueryVisitorCompiled<
  TElement,
  TOutput,
  TParams extends Readonly<Record<string, unknown>>,
> = keyof TParams extends never
  ? (input: Iterable<TElement>, consume: (value: TOutput) => void) => number
  : (input: Iterable<TElement>, params: TParams, consume: (value: TOutput) => void) => number;

export function explainQueryExecution(program: LazyQueryProgram, outputMode: QueryExecutionMode): QueryExecutionPlan {
  const barriers = program.nodes.filter((node) => node.kind === "orderBy").map(() => "orderBy");
  const retainedState: string[] = [];

  for (const node of program.nodes) {
    if (node.kind === "unique") retainedState[retainedState.length] = `Set(${node.key})`;
    else if (node.kind === "chunk") retainedState[retainedState.length] = `chunk(${node.size})`;
    else if (node.kind === "window") retainedState[retainedState.length] = `window(${node.size})`;
    else if (node.kind === "pairwise") retainedState[retainedState.length] = "previous-item";
    else if (node.kind === "scan") retainedState[retainedState.length] = "accumulator";
    else if (node.kind === "groupAdjacentBy") retainedState[retainedState.length] = `adjacent-group(${node.key})`;
  }
  return {
    outputMode,
    materializes: barriers.length > 0,
    materializationReason: barriers.length > 0 ? "global ordering requires complete input" : undefined,
    earlyTermination: program.nodes.some((node) => node.kind === "take" || node.kind === "takeWhile"),
    retainedState,
    estimatedAllocationsPerResult: program.nodes.some(
      (node) =>
        node.kind === "select:fields" || node.kind === "chunk" || node.kind === "window" || node.kind === "pairwise"
    )
      ? 1
      : 0,
    barriers,
  };
}

export function emitQueryIteratorSource(schema: ATS.AnyTypeSchema, program: LazyQueryProgram): string {
  return emitPipelineSource(schema, program, false);
}

export function emitQueryAsyncIteratorSource(schema: ATS.AnyTypeSchema, program: LazyQueryProgram): string {
  return emitPipelineSource(schema, program, true);
}

export function compileQueryIterator<
  TElement,
  TOutput,
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
>(
  schema: ATS.AnyTypeSchema,
  program: LazyQueryProgram,
  options?: CompileCacheOptions
): QueryIteratorCompiled<TElement, TOutput, TParams> {
  return compileLazy<TElement, TOutput, TParams>(schema, program, "generator", options) as QueryIteratorCompiled<
    TElement,
    TOutput,
    TParams
  >;
}

export function compileQueryAsyncIterator<
  TElement,
  TOutput,
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
>(
  schema: ATS.AnyTypeSchema,
  program: LazyQueryProgram,
  options?: CompileCacheOptions
): QueryAsyncIteratorCompiled<TElement, TOutput, TParams> {
  return compileLazy<TElement, TOutput, TParams>(
    schema,
    program,
    "async-generator",
    options
  ) as QueryAsyncIteratorCompiled<TElement, TOutput, TParams>;
}

export function compileQueryVisitor<
  TElement,
  TOutput,
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
>(
  schema: ATS.AnyTypeSchema,
  program: LazyQueryProgram,
  options?: CompileCacheOptions
): QueryVisitorCompiled<TElement, TOutput, TParams> {
  if (!program.nodes.every(isFusibleNode)) {
    const iterator = compileQueryIterator<TElement, TOutput, TParams>(schema, program, options);
    const visitor = program.params?.length
      ? (input: Iterable<TElement>, params: TParams, consume: (value: TOutput) => void): number => {
          let count = 0;
          for (const value of (iterator as (input: Iterable<TElement>, params: TParams) => Iterable<TOutput>)(
            input,
            params
          )) {
            consume(value);
            count++;
          }
          return count;
        }
      : (input: Iterable<TElement>, consume: (value: TOutput) => void): number => {
          let count = 0;
          for (const value of (iterator as (input: Iterable<TElement>) => Iterable<TOutput>)(input)) {
            consume(value);
            count++;
          }
          return count;
        };
    return visitor as QueryVisitorCompiled<TElement, TOutput, TParams>;
  }

  const bindingNames = program.bindings.map((_, index) => `__q${index}`);
  const template = getCompileCached(
    schema,
    `query:visitor:${serializePipeline(program.nodes)}`,
    () => {
      const source = emitQueryVisitorSource(schema, program);
      return { source, create: globalThis.Function(...bindingNames, `return ${source};`) };
    },
    options
  );
  const visitor = template.create(...program.bindings) as QueryVisitorCompiled<TElement, TOutput, TParams>;

  registerArtifact(visitor as object, {
    kind: "query",
    source: template.source,
    bindingNames,
    bindingValues: program.bindings,
  });
  return visitor;
}

export function emitQueryVisitorSource(schema: ATS.AnyTypeSchema, program: LazyQueryProgram): string {
  const collection = resolveCollection(schema);
  validatePipeline(program.nodes, collection.props);
  if (!program.nodes.every(isFusibleNode)) {
    throw new JITError("INVALID_QUERY", "direct visitor supports filter/select/take/drop/*While/unique pipelines");
  }
  const hasParams = Boolean(program.params?.length);
  const lines = ["(function () {", `function visit(input${hasParams ? ", params" : ""}, consume) {`];

  program.nodes.forEach((node, index) => {
    if (node.kind === "take" || node.kind === "drop") lines.push(`  let count${index} = 0;`);
    else if (node.kind === "dropWhile") lines.push(`  let dropping${index} = true;`);
    else if (node.kind === "unique") lines.push(`  const seen${index} = new Set();`);
  });
  lines.push("  let emitted = 0;");
  const body = emitVisitorBody(program.nodes);

  if (collection.kind === "array") {
    lines.push("  if (Array.isArray(input)) {");
    lines.push("    for (let i = 0, len = input.length; i < len; i++) {");
    lines.push("      const item = input[i];");
    for (const line of body) lines.push(`      ${line}`);
    lines.push("    }");
    lines.push("    return emitted;");
    lines.push("  }");
  }
  lines.push(`  for (const ${collection.kind === "map" ? "entry" : "item"} of input) {`);
  if (collection.kind === "map") lines.push("    const item = entry[1];");
  for (const line of body) lines.push(`    ${line}`);
  lines.push("  }");
  lines.push("  return emitted;");
  lines.push("}", "return visit;", "})()");
  return lines.join("\n");
}

function emitVisitorBody(nodes: readonly QueryPipelineNode[]): readonly string[] {
  const body = ["let output = item;"];

  nodes.forEach((node, index) => {
    switch (node.kind) {
      case "filter":
        body.push(`if (!(${emitCondition(node.condition)})) continue;`);
        break;
      case "select:fields":
        body.push(`output = ${emitProjection(node.fields)};`);
        break;
      case "take":
        body.push(`if (count${index}++ === ${node.count}) return emitted;`);
        break;
      case "drop":
        body.push(`if (count${index}++ < ${node.count}) continue;`);
        break;
      case "takeWhile":
        body.push(`if (!(${emitCondition(node.condition)})) return emitted;`);
        break;
      case "dropWhile":
        body.push(`if (dropping${index} && (${emitCondition(node.condition)})) continue;`);
        body.push(`dropping${index} = false;`);
        break;
      case "unique":
        body.push(`const key${index} = item${emitPropertyAccess("", node.key)};`);
        body.push(`if (seen${index}.has(key${index})) continue;`);
        body.push(`seen${index}.add(key${index});`);
        break;
      default:
        break;
    }
  });
  body.push("consume(output);", "emitted++;");
  return body;
}

function compileLazy<TElement, TOutput, TParams extends Readonly<Record<string, unknown>>>(
  schema: ATS.AnyTypeSchema,
  program: LazyQueryProgram,
  mode: "generator" | "async-generator",
  options?: CompileCacheOptions
): QueryIteratorCompiled<TElement, TOutput, TParams> | QueryAsyncIteratorCompiled<TElement, TOutput, TParams> {
  const bindingNames = program.bindings.map((_, index) => `__q${index}`);
  const key = `query:${mode}:${serializePipeline(program.nodes)}`;
  const template = getCompileCached(
    schema,
    key,
    () => {
      const source =
        mode === "generator" ? emitQueryIteratorSource(schema, program) : emitQueryAsyncIteratorSource(schema, program);
      return { source, create: globalThis.Function(...bindingNames, `return ${source};`) };
    },
    options
  );
  const compiled = template.create(...program.bindings) as QueryIteratorCompiled<TElement, TOutput, TParams>;

  registerArtifact(compiled as object, {
    kind: "query",
    source: template.source,
    bindingNames,
    bindingValues: program.bindings,
  });
  return compiled;
}

function emitPipelineSource(schema: ATS.AnyTypeSchema, program: LazyQueryProgram, async: boolean): string {
  const collection = resolveCollection(schema);
  validatePipeline(program.nodes, collection.props);
  const hasParams = Boolean(program.params?.length);
  const lines: string[] = [];
  const star = async ? "async function*" : "function*";
  const awaitPrefix = async ? "await " : "";
  const forAwait = async ? "for await" : "for";

  if (collection.kind === "map") {
    lines.push(`${star} source(input) {`);
    lines.push(`  ${forAwait} (const entry of input) yield entry[1];`);
    lines.push("}");
  }

  let stage = collection.kind === "map" ? "source(input)" : "input";
  let stageIndex = 0;

  for (let nodeIndex = 0; nodeIndex < program.nodes.length; ) {
    const name = `stage${stageIndex++}`;
    const node = program.nodes[nodeIndex];
    const fused: QueryPipelineNode[] = [];

    while (nodeIndex < program.nodes.length && isFusibleNode(program.nodes[nodeIndex])) {
      fused[fused.length] = program.nodes[nodeIndex++];
    }
    lines.push(`${star} ${name}(input, params) {`);
    if (fused.length > 0) {
      emitFusedStage(lines, fused, forAwait, !async && collection.kind === "array" && stageIndex === 1);
    } else {
      emitStage(lines, node, "input", async, awaitPrefix, forAwait);
      nodeIndex++;
    }
    lines.push("}");
    stage = `${name}(${stage}, ${hasParams ? "params" : "undefined"})`;
  }
  lines.push(`function query(input${hasParams ? ", params" : ""}) {`);
  lines.push(`  return ${stage};`);
  lines.push("}");
  lines.push("return query;");
  return `(function() {\n${lines.join("\n")}\n})()`;
}

function isFusibleNode(node: QueryPipelineNode): boolean {
  return (
    node.kind === "filter" ||
    node.kind === "select:fields" ||
    node.kind === "take" ||
    node.kind === "drop" ||
    node.kind === "takeWhile" ||
    node.kind === "dropWhile" ||
    node.kind === "unique"
  );
}

function emitFusedStage(
  lines: string[],
  nodes: readonly QueryPipelineNode[],
  forAwait: string,
  directArray: boolean
): void {
  nodes.forEach((node, index) => {
    if (node.kind === "take" || node.kind === "drop") lines.push(`  let count${index} = 0;`);
    else if (node.kind === "dropWhile") lines.push(`  let dropping${index} = true;`);
    else if (node.kind === "unique") lines.push(`  const seen${index} = new Set();`);
  });
  const body = ["let output = item;"];

  nodes.forEach((node, index) => {
    switch (node.kind) {
      case "filter":
        body.push(`if (!(${emitCondition(node.condition)})) continue;`);
        break;
      case "select:fields":
        body.push(`output = ${emitProjection(node.fields)};`);
        break;
      case "take":
        body.push(`if (count${index}++ === ${node.count}) return;`);
        break;
      case "drop":
        body.push(`if (count${index}++ < ${node.count}) continue;`);
        break;
      case "takeWhile":
        body.push(`if (!(${emitCondition(node.condition)})) return;`);
        break;
      case "dropWhile":
        body.push(`if (dropping${index} && (${emitCondition(node.condition)})) continue;`);
        body.push(`dropping${index} = false;`);
        break;
      case "unique":
        body.push(`const key${index} = item${emitPropertyAccess("", node.key)};`);
        body.push(`if (seen${index}.has(key${index})) continue;`);
        body.push(`seen${index}.add(key${index});`);
        break;
      default:
        break;
    }
  });
  body.push("yield output;");

  if (directArray) {
    lines.push("  if (Array.isArray(input)) {");
    lines.push("    for (let i = 0, len = input.length; i < len; i++) {");
    lines.push("      const item = input[i];");
    for (const line of body) lines.push(`      ${line}`);
    lines.push("    }");
    lines.push("    return;");
    lines.push("  }");
  }
  lines.push(`  ${forAwait} (const item of input) {`);
  for (const line of body) lines.push(`    ${line}`);
  lines.push("  }");
}

function emitStage(
  lines: string[],
  node: QueryPipelineNode,
  previous: string,
  async: boolean,
  awaitPrefix: string,
  forAwait: string
): void {
  const loop = (body: readonly string[]) => {
    lines.push(`  ${forAwait} (const item of ${previous}) {`);
    for (const line of body) lines.push(`    ${line}`);
    lines.push("  }");
  };

  switch (node.kind) {
    case "filter":
      loop([`if (${emitCondition(node.condition)}) yield item;`]);
      return;
    case "select:fields":
      loop([`yield ${emitProjection(node.fields)};`]);
      return;
    case "flatMap":
      loop([
        `const nested = item${emitPropertyAccess("", node.key)};`,
        `${forAwait} (const value of nested) yield value;`,
      ]);
      return;
    case "take":
      lines.push("  let count = 0;");
      lines.push(`  ${forAwait} (const item of ${previous}) {`);
      lines.push(`    if (count++ === ${node.count}) return;`);
      lines.push("    yield item;");
      lines.push("  }");
      return;
    case "drop":
      lines.push("  let count = 0;");
      loop([`if (count++ >= ${node.count}) yield item;`]);
      return;
    case "takeWhile":
      loop([`if (!(${emitCondition(node.condition)})) return;`, "yield item;"]);
      return;
    case "dropWhile":
      lines.push("  let dropping = true;");
      loop([`if (dropping && (${emitCondition(node.condition)})) continue;`, "dropping = false;", "yield item;"]);
      return;
    case "unique":
      lines.push("  const seen = new Set();");
      loop([
        `const key = item${emitPropertyAccess("", node.key)};`,
        "if (seen.has(key)) continue;",
        "seen.add(key);",
        "yield item;",
      ]);
      return;
    case "chunk":
      lines.push(`  let chunk = new Array(${node.size});`);
      lines.push("  let count = 0;");
      loop([
        "chunk[count++] = item;",
        `if (count === ${node.size}) { yield chunk; chunk = new Array(${node.size}); count = 0; }`,
      ]);
      lines.push("  if (count !== 0) { chunk.length = count; yield chunk; }");
      return;
    case "window":
      lines.push(`  const window = new Array(${node.size});`);
      lines.push("  let count = 0;");
      loop([
        `window[count % ${node.size}] = item;`,
        "count++;",
        `if (count >= ${node.size}) {`,
        `  const out = new Array(${node.size});`,
        `  for (let i = 0; i < ${node.size}; i++) out[i] = window[(count + i) % ${node.size}];`,
        "  yield out;",
        "}",
      ]);
      return;
    case "pairwise":
      lines.push("  let previousItem;");
      lines.push("  let hasPrevious = false;");
      loop(["if (hasPrevious) yield [previousItem, item];", "previousItem = item;", "hasPrevious = true;"]);
      return;
    case "scan":
      lines.push(`  let accumulator = ${node.initialBinding};`);
      loop([`accumulator = ${awaitPrefix}${node.updateBinding}(accumulator, item);`, "yield accumulator;"]);
      return;
    case "groupAdjacentBy":
      lines.push("  let group = [];");
      lines.push("  let groupKey;");
      lines.push("  let started = false;");
      loop([
        `const key = item${emitPropertyAccess("", node.key)};`,
        "if (started && key !== groupKey) { yield group; group = []; }",
        "groupKey = key;",
        "started = true;",
        "group[group.length] = item;",
      ]);
      lines.push("  if (started) yield group;");
      return;
    case "orderBy":
      lines.push(`  const values = ${async ? "[]" : `Array.from(${previous})`};`);
      if (async) lines.push(`  ${forAwait} (const item of ${previous}) values[values.length] = item;`);
      lines.push(
        `  values.sort((left, right) => left${emitPropertyAccess("", node.key)} < right${emitPropertyAccess("", node.key)} ? ${
          node.direction === "asc" ? -1 : 1
        } : left${emitPropertyAccess("", node.key)} > right${emitPropertyAccess("", node.key)} ? ${
          node.direction === "asc" ? 1 : -1
        } : 0);`
      );
      lines.push("  yield* values;");
      return;
    case "keyed":
    case "groupBy":
    case "aggregate":
    case "delete":
    case "update":
      throw new JITError("INVALID_QUERY", `${node.kind} is not an incremental output operation`);
  }
}

function emitCondition(condition: QueryConditionNode): string {
  switch (condition.kind) {
    case "compare": {
      const operators = { eq: "===", neq: "!==", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;
      return `${emitValue(condition.left)} ${operators[condition.op]} ${emitValue(condition.right)}`;
    }
    case "logical":
      return `(${emitCondition(condition.left)} ${condition.op === "and" ? "&&" : "||"} ${emitCondition(condition.right)})`;
    case "not":
      return `!(${emitCondition(condition.inner)})`;
  }
}

function emitValue(value: QueryValueNode): string {
  switch (value.kind) {
    case "field":
      return `item${emitPropertyAccess("", value.key)}`;
    case "binding":
      return value.name;
    case "param":
      return `params${emitPropertyAccess("", value.name)}`;
    case "literal":
      return emitLiteral(value.value as never);
  }
}

function emitProjection(fields: readonly string[]): string {
  return `{ ${fields.map((field) => `${emitLiteral(field)}: item${emitPropertyAccess("", field)}`).join(", ")} }`;
}

function resolveCollection(schema: ATS.AnyTypeSchema): {
  readonly kind: "array" | "set" | "map";
  readonly props: ATS.SchemaShape;
} {
  const collection = resolveWrappers(schema).base;
  if (collection.type !== TypeName.array && collection.type !== TypeName.set && collection.type !== TypeName.map) {
    throw new JITError("INVALID_QUERY", "lazy query expects an array, set, or map schema");
  }
  const element =
    collection.type === TypeName.map
      ? resolveWrappers((collection as ATS.MapSchema).def.value).base
      : resolveWrappers((collection as ATS.ArraySchema | ATS.SetSchema).def.element).base;
  if (element.type !== TypeName.object) throw new JITError("INVALID_QUERY", "lazy query expects object elements");
  return { kind: collection.type, props: (element as ATS.ObjectSchema).def.props };
}

function validatePipeline(nodes: readonly QueryPipelineNode[], props: ATS.SchemaShape): void {
  for (const node of nodes) {
    if (
      node.kind === "select:fields" ||
      node.kind === "flatMap" ||
      node.kind === "unique" ||
      node.kind === "orderBy" ||
      node.kind === "groupAdjacentBy"
    ) {
      const keys = node.kind === "select:fields" ? node.fields : [node.key];
      for (const key of keys)
        if (!(key in props)) throw new JITError("INVALID_QUERY", `lazy query received unknown key ${key}`);
    }
  }
}

function serializePipeline(nodes: readonly QueryPipelineNode[]): string {
  return JSON.stringify(nodes, (_key, value) => (typeof value === "bigint" ? `${value}n` : value));
}
