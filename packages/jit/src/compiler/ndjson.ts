import type { QueryConditionNode, QueryValueNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { JITValidationError } from "../errors/validation-error.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { buildProjectionTree } from "./projection.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitSerializeSource } from "./serialize.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitLiteral } from "./source/literal.js";
import { compileValidator } from "./validate.js";

export type NdjsonChunk = string | Uint8Array;
export type NdjsonInput = NdjsonChunk | Iterable<NdjsonChunk>;
export type NdjsonSink = "result" | "iterator" | "visitor" | "ndjson";

export interface NdjsonDescriptor {
  readonly schema: ATS.AnyTypeSchema;
  readonly outputSchema: ATS.AnyTypeSchema;
  readonly filters: readonly QueryConditionNode[];
  readonly select: readonly string[] | undefined;
  readonly bindingNames: readonly string[];
  readonly bindingValues: readonly unknown[];
  readonly operation: "parse" | "stringify";
  readonly sink: NdjsonSink;
}

type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };

export function createNdjsonDescriptor(schema: ATS.AnyTypeSchema, operation: "parse" | "stringify"): NdjsonDescriptor {
  expectNdjsonObject(schema);
  return Object.freeze({
    schema,
    outputSchema: schema,
    filters: Object.freeze([]),
    select: undefined,
    bindingNames: Object.freeze([]),
    bindingValues: Object.freeze([]),
    operation,
    sink: operation === "parse" ? "result" : "ndjson",
  });
}

export function appendNdjsonFilter(
  descriptor: NdjsonDescriptor,
  condition: QueryConditionNode,
  bindings: readonly unknown[]
): NdjsonDescriptor {
  validateCondition(expectNdjsonObject(descriptor.schema), condition);
  const start = descriptor.bindingValues.length;
  const names = bindings.map((_, index) => `__q${start + index}`);

  return Object.freeze({
    ...descriptor,
    filters: Object.freeze([...descriptor.filters, condition]),
    bindingNames: Object.freeze([...descriptor.bindingNames, ...names]),
    bindingValues: Object.freeze([...descriptor.bindingValues, ...bindings]),
  });
}

export function selectNdjson(descriptor: NdjsonDescriptor, fields: readonly string[]): NdjsonDescriptor {
  const tree = buildProjectionTree(descriptor.schema, fields, "JIT.ndjson.parse().select()");
  return Object.freeze({
    ...descriptor,
    outputSchema: tree.schema,
    select: Object.freeze([...fields]),
  });
}

export function withNdjsonSink(descriptor: NdjsonDescriptor, sink: NdjsonSink): NdjsonDescriptor {
  return Object.freeze({ ...descriptor, sink });
}

function expectNdjsonObject(schema: ATS.AnyTypeSchema): ObjectSchema {
  const base = resolveWrappers(schema).base;
  if (base.type !== TypeName.object)
    throw new JITError("UNSUPPORTED_SCHEMA", "JIT.ndjson requires an object row schema");
  return base as ObjectSchema;
}

function validateCondition(schema: ObjectSchema, condition: QueryConditionNode): void {
  if (condition.kind === "logical") {
    validateCondition(schema, condition.left);
    validateCondition(schema, condition.right);
    return;
  }
  if (condition.kind === "not") {
    validateCondition(schema, condition.inner);
    return;
  }
  for (const value of [condition.left, condition.right]) {
    if (value.kind === "field" && !(value.key in schema.def.props)) {
      throw new JITError("INVALID_QUERY", `NDJSON filter references unknown field ${JSON.stringify(value.key)}`);
    }
  }
}

export function emitNdjsonSource(descriptor: NdjsonDescriptor, validator = "__ndjsonValidator"): string {
  const writer = new CodeWriter();

  writer.line("(() => {");
  writer.indent(() => {
    if (descriptor.operation === "parse") {
      emitRowParser(writer, validator);
    }
    if (descriptor.operation === "stringify" || descriptor.sink === "ndjson") {
      writer.line(`const ndjsonStringifyRow = ${emitSerializeSource(descriptor.outputSchema)};`);
    }
    if (descriptor.operation === "stringify") emitStringify(writer, descriptor);
    else emitParse(writer, descriptor);
    writer.line(`return ${descriptor.operation === "stringify" ? "ndjsonStringify" : "ndjsonParse"};`);
  });
  writer.line("})()");
  return writer.toString();
}

function emitRowParser(writer: CodeWriter, validator: string): void {
  writer.line("function ndjsonRow(line, row) {");
  writer.indent(() => {
    writer.line("let parsed;");
    writer.line(
      'try { parsed = JSON.parse(line); } catch { throw new SyntaxError("malformed NDJSON on line " + (row + 1)); }'
    );
    writer.line(`const result = ${validator}.safeParse(parsed);`);
    writer.line("if (result.success) return result.data;");
    writer.line(
      'throw new JITValidationError(result.issues.map((issue) => ({ ...issue, path: "line " + (row + 1) + (issue.path ? "." + issue.path : "") })));'
    );
  });
  writer.line("}");
}

function emitParse(writer: CodeWriter, descriptor: NdjsonDescriptor): void {
  const generator = descriptor.sink === "iterator" ? "function*" : "function";
  const params = descriptor.sink === "visitor" ? "input, consume" : "input";
  writer.line(`${generator} ndjsonParse(${params}) {`);
  writer.indent(() => {
    if (descriptor.sink === "result") writer.line("const out = [];");
    else if (descriptor.sink === "ndjson") writer.line('let out = "";');
    writer.line('const single = typeof input === "string" || input instanceof Uint8Array;');
    writer.line("const iterator = single ? undefined : input[Symbol.iterator]();");
    writer.line("const decoder = new TextDecoder();");
    writer.line('let buffer = "", singleDone = false, lineNumber = 0, emitted = 0;');
    writer.line("while (true) {");
    writer.indent(() => {
      writer.line("let chunk, done;");
      writer.line(
        "if (single) { done = singleDone; chunk = singleDone ? undefined : input; singleDone = true; } else { const next = iterator.next(); done = next.done; chunk = next.value; }"
      );
      writer.line(
        'buffer += done ? decoder.decode() : (typeof chunk === "string" ? decoder.decode() + chunk : decoder.decode(chunk, { stream: true }));'
      );
      writer.line('let start = 0, cut = buffer.indexOf("\\n");');
      writer.line("while (cut !== -1) {");
      writer.indent(() => {
        writer.line("let line = buffer.slice(start, cut);");
        writer.line('if (line.endsWith("\\r")) line = line.slice(0, -1);');
        emitNdjsonLine(writer, descriptor);
        writer.line("lineNumber += 1;");
        writer.line("start = cut + 1;");
        writer.line('cut = buffer.indexOf("\\n", start);');
      });
      writer.line("}");
      writer.line("if (start !== 0) buffer = buffer.slice(start);");
      writer.line("if (!done) continue;");
      writer.line('if (buffer.trim() !== "") {');
      writer.indent(() => {
        writer.line("const line = buffer;");
        emitNdjsonLine(writer, descriptor);
      });
      writer.line("}");
      if (descriptor.sink === "result" || descriptor.sink === "ndjson") writer.line("return out;");
      else if (descriptor.sink === "visitor") writer.line("return emitted;");
      else writer.line("return;");
    });
    writer.line("}");
  });
  writer.line("}");
}

function emitNdjsonLine(writer: CodeWriter, descriptor: NdjsonDescriptor): void {
  writer.line('if (line.trim() !== "") {');
  writer.indent(() => {
    writer.line("const item = ndjsonRow(line, lineNumber);");
    const filters = descriptor.filters.map((condition) => `(${emitCondition(condition)})`).join(" && ");

    if (filters.length > 0) {
      writer.line(`if (${filters}) {`);
      writer.indent(() => emitNdjsonSink(writer, descriptor));
      writer.line("}");
    } else {
      emitNdjsonSink(writer, descriptor);
    }
  });
  writer.line("}");
}

function emitNdjsonSink(writer: CodeWriter, descriptor: NdjsonDescriptor): void {
  const value = emitProjection(descriptor.select);

  if (descriptor.sink === "result") writer.line(`out[emitted++] = ${value};`);
  else if (descriptor.sink === "iterator") {
    writer.line(`yield ${value};`);
    writer.line("emitted += 1;");
  } else if (descriptor.sink === "visitor") writer.line(`consume(${value}, emitted++);`);
  else {
    writer.line('if (out.length !== 0) out += "\\n";');
    writer.line("out += ndjsonStringifyRow(item);");
    writer.line("emitted += 1;");
  }
}

function emitStringify(writer: CodeWriter, descriptor: NdjsonDescriptor): void {
  const iterator = descriptor.sink === "iterator";
  writer.line(`${iterator ? "function*" : "function"} ndjsonStringify(value) {`);
  writer.indent(() => {
    if (iterator) {
      writer.line('for (let i = 0; i < value.length; i++) yield ndjsonStringifyRow(value[i]) + "\\n";');
    } else {
      writer.line('let out = "";');
      writer.line("for (let i = 0; i < value.length; i++) {");
      writer.indent(() => {
        writer.line('if (i !== 0) out += "\\n";');
        writer.line("out += ndjsonStringifyRow(value[i]);");
      });
      writer.line("}");
      writer.line("return out;");
    }
  });
  writer.line("}");
}

function emitCondition(condition: QueryConditionNode): string {
  if (condition.kind === "logical") {
    return `(${emitCondition(condition.left)} ${condition.op === "and" ? "&&" : "||"} ${emitCondition(condition.right)})`;
  }
  if (condition.kind === "not") return `!(${emitCondition(condition.inner)})`;
  const operators = { eq: "===", neq: "!==", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;
  return `${emitQueryValue(condition.left)} ${operators[condition.op]} ${emitQueryValue(condition.right)}`;
}

function emitQueryValue(value: QueryValueNode): string {
  if (value.kind === "field") return emitPropertyAccess("item", value.key);
  if (value.kind === "literal") return emitLiteral(value.value as never);
  if (value.kind === "binding") return value.name;
  throw new JITError("INVALID_QUERY", "NDJSON fused filters do not accept query params");
}

function emitProjection(fields: readonly string[] | undefined): string {
  if (fields === undefined) return "item";
  return `{ ${fields.map((field) => `${JSON.stringify(field)}: ${emitPropertyAccess("item", field)}`).join(", ")} }`;
}

export function compileNdjsonParse(descriptor: NdjsonDescriptor): (...args: never[]) => unknown {
  const validator = compileValidator(descriptor.schema);
  const source = emitNdjsonSource(descriptor);
  const compiled = globalThis.Function(
    ...descriptor.bindingNames,
    "__ndjsonValidator",
    "JITValidationError",
    `return ${source};`
  )(...descriptor.bindingValues, validator, JITValidationError) as (...args: never[]) => unknown;
  registerArtifact(compiled, { kind: "ndjson-plan", descriptor });
  return compiled;
}

export function compileNdjsonStringify(descriptor: NdjsonDescriptor): (...args: never[]) => unknown {
  const compiled = globalThis.Function(`return ${emitNdjsonSource(descriptor)};`)() as (...args: never[]) => unknown;
  registerArtifact(compiled, { kind: "ndjson-plan", descriptor });
  return compiled;
}
