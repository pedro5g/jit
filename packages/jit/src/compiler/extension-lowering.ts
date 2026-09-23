import type { ExtensionIntrinsic, ExtensionIR, ExtensionTransform } from "../extensions/extension-ir.js";
import { validateExtensionIR } from "../extensions/extension-ir.js";
import type { ExtensionSet } from "../extensions/extension-set.js";
import type { SemanticOperator } from "../extensions/plugin.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { emitNode } from "./emitter/emit-node.js";
import { deriveSchemaFacts, type SemanticFact } from "./facts/schema-facts.js";
import type { IRExpr, IRProgram } from "./ir/ir.js";
import { arrayIsArray, irVar, literal, loadProp, strictEqual } from "./ir/ir.js";

/** Lowers validated expression-only extension IR to the ordinary compiler program IR. */
export function lowerExtensionIR(input: ExtensionIR): IRProgram {
  const validated = validateExtensionIR(input).ir;
  if (validated.effects?.includes("issues"))
    throw new TypeError("issue-producing extension IR must be consumed by an operation-specific compiler stage");
  const values = new Map<number, IRExpr>();
  for (let index = 0; index < validated.nodes.length; index++) {
    const node = validated.nodes[index];
    if (node === undefined) throw new TypeError(`extension IR node ${index} is missing`);
    lowerNode(node, index, values);
  }
  const result = validated.nodes[validated.result];
  if (result?.kind !== "return" || result.value === undefined)
    throw new TypeError("expression extension IR must return a value");
  return Object.freeze({
    kind: "program" as const,
    params: Object.freeze([irVar("value")]),
    body: Object.freeze([{ kind: "return" as const, value: expression(result.value, values) }]),
  });
}

type ExtensionNode = ExtensionIR["nodes"][number];
type NodeLowerer<K extends ExtensionNode["kind"]> = (
  node: Extract<ExtensionNode, { readonly kind: K }>,
  index: number,
  values: Map<number, IRExpr>
) => void;

const nodeLowerers: { readonly [K in ExtensionNode["kind"]]: NodeLowerer<K> } = Object.freeze({
  load: (node, index, values) => values.set(index, lowerLoad(node.path)),
  literal: (node, index, values) => values.set(index, literal(node.value)),
  compare: (node, index, values) =>
    values.set(index, lowerComparison(node.operator, expression(node.left, values), expression(node.right, values))),
  logical: (node, index, values) =>
    values.set(index, {
      kind: "nary",
      op: node.operator,
      operands: node.operands.map((operand) => expression(operand, values)),
    }),
  not: (node, index, values) => values.set(index, { kind: "not", expr: expression(node.input, values) }),
  callIntrinsic: (node, index, values) =>
    values.set(
      index,
      lowerIntrinsic(
        node.name,
        node.args.map((argument) => expression(argument, values))
      )
    ),
  transform: (node, index, values) => values.set(index, lowerTransformNode(node.input, node.intrinsic, values)),
  return: () => {},
  branch: (node) => unsupportedNode(node.kind),
  loop: (node) => unsupportedNode(node.kind),
  emitIssue: (node) => unsupportedNode(node.kind),
});

function lowerNode(node: ExtensionNode, index: number, values: Map<number, IRExpr>): void {
  const lower = nodeLowerers[node.kind] as (
    candidate: ExtensionNode,
    position: number,
    output: Map<number, IRExpr>
  ) => void;
  lower(node, index, values);
}

function unsupportedNode(kind: "branch" | "loop" | "emitIssue"): never {
  throw new TypeError(`extension IR ${kind} requires an operation-specific compiler stage`);
}

function lowerLoad(path: readonly (string | number)[]): IRExpr {
  let value: IRExpr = irVar("value");
  for (const key of path)
    value = typeof key === "string" ? loadProp(value, key) : { kind: "load_index", base: value, index: literal(key) };
  return value;
}

function lowerTransformNode(
  input: number,
  intrinsic: ExtensionTransform | undefined,
  values: ReadonlyMap<number, IRExpr>
): IRExpr {
  const value = expression(input, values);
  return intrinsic === undefined ? value : lowerTransform(intrinsic, value);
}

/** Emits an expression-only extension program with the core IR emitter. */
export function emitExtensionIR(input: ExtensionIR): string {
  const program = lowerExtensionIR(input);
  const writer = new CodeWriter();
  writer.line("return function extension(value) {");
  writer.indent(() => {
    for (const node of program.body) emitNode(writer, node);
  });
  writer.line("};");
  return writer.toString();
}

/** Compiles extension IR through the same restricted core emitter as built-in IR. */
export function compileExtensionIR(input: ExtensionIR): (value: unknown) => unknown {
  const source = emitExtensionIR(input);
  return globalThis.Function(source)() as (value: unknown) => unknown;
}

/** Compiles semantic predicates installed in the schema's immutable extension environment. */
export function resolveSemanticExtensionPlans(
  schema: import("../core/ats/index.js").AnyTypeSchema,
  extensions: ExtensionSet,
  facts: readonly SemanticFact[] = deriveSchemaFacts(schema)
): readonly SemanticExtensionPlan[] {
  const semantic = extensions.plugins.filter(
    (extension): extension is SemanticOperator => extension.kind === "semantic"
  );
  if (semantic.length === 0) return Object.freeze([]);
  const normalizedFacts = Object.freeze(
    [...facts].sort(
      (left, right) =>
        compareText(left.path.join("\u0000"), right.path.join("\u0000")) ||
        compareText(left.kind, right.kind) ||
        compareText(stableValue(left), stableValue(right))
    )
  );
  const plans = semantic.map((extension) => {
    const dependencies = new Set(extension.metadataDependencies ?? []);
    const safeSchema = stripUndeclaredMetadata(schema, dependencies, new Map<object, unknown>());
    const metadata = metadataRecord(schema, dependencies);
    const validated = validateExtensionIR(
      extension.lower(
        Object.freeze({
          schema: safeSchema,
          facts: normalizedFacts,
          metadata,
        })
      )
    );
    if (validated.resultType !== "boolean")
      throw new TypeError(`semantic extension ${extension.id} must return a boolean predicate`);
    const program = lowerExtensionIR(validated.ir);
    const terminal = program.body[0];
    if (terminal?.kind !== "return")
      throw new TypeError(`semantic extension ${extension.id} did not lower to a predicate`);
    return Object.freeze({
      id: extension.id,
      version: extension.version,
      irDigest: validated.digest,
      expression: terminal.value,
    });
  });
  return Object.freeze(plans);
}

/** Semantic extension predicate after validation and core IR lowering. */
export interface SemanticExtensionPlan {
  readonly id: string;
  readonly version: string;
  readonly irDigest: string;
  readonly expression: IRExpr;
}

function expression(index: number, values: ReadonlyMap<number, IRExpr>): IRExpr {
  const value = values.get(index);
  if (value === undefined) throw new TypeError(`extension IR expression ${index} is unavailable to lowering`);
  return value;
}

function lowerIntrinsic(name: ExtensionIntrinsic, args: readonly IRExpr[]): IRExpr {
  const value = args[0];
  if (value === undefined) throw new TypeError(`intrinsic ${name} has no argument`);
  if (name === "isArray") return arrayIsArray(value);
  if (name === "isNull") return strictEqual(value, literal(null));
  if (name === "isDefined") return { kind: "binary", op: "notStrictEqual", left: value, right: literal(undefined) };
  if (name === "stringLength" || name === "arrayLength") return loadProp(value, "length");
  return {
    kind: "typeof",
    value,
    type: name.slice(2).toLowerCase() as "string" | "number" | "boolean" | "bigint" | "symbol" | "function",
  };
}

function lowerComparison(operator: "eq" | "neq" | "lt" | "lte" | "gt" | "gte", left: IRExpr, right: IRExpr): IRExpr {
  switch (operator) {
    case "eq":
      return strictEqual(left, right);
    case "neq":
      return { kind: "binary", op: "notStrictEqual", left, right };
    case "lt":
      return { kind: "binary", op: "lessThan", left, right };
    case "lte":
      return { kind: "binary", op: "lessThanOrEqual", left, right };
    case "gt":
      return { kind: "binary", op: "greaterThan", left, right };
    case "gte":
      return { kind: "binary", op: "greaterThanOrEqual", left, right };
  }
}

function lowerTransform(intrinsic: ExtensionTransform, value: IRExpr): IRExpr {
  const method =
    intrinsic === "string.trim" ? "trim" : intrinsic === "string.toLowerCase" ? "toLowerCase" : "toUpperCase";
  return { kind: "call", callee: loadProp(value, method), args: [] };
}

function metadataRecord(schema: unknown, dependencies: ReadonlySet<string>): Readonly<Record<string, unknown>> {
  if (typeof schema !== "object" || schema === null || !("annotations" in schema)) return Object.freeze({});
  const annotations = (schema as { readonly annotations?: unknown }).annotations;
  if (typeof annotations !== "object" || annotations === null || !("metadata" in annotations)) return Object.freeze({});
  const metadata = (annotations as { readonly metadata?: unknown }).metadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return Object.freeze({});
  return Object.freeze(
    Object.fromEntries(
      [...dependencies]
        .sort(compareText)
        .flatMap((key) =>
          Object.keys(metadata).includes(key)
            ? [[key, sanitizeMetadata((metadata as Record<string, unknown>)[key])]]
            : []
        )
    )
  );
}

function sanitizeMetadata(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("declared semantic metadata dependencies must be finite numbers");
    return value;
  }
  return sanitizeMetadataObject(value, new Set<object>());
}

function sanitizeMetadataObject(value: unknown, seen: Set<object>): unknown {
  if (typeof value !== "object" || value === null || seen.has(value))
    throw new TypeError("declared semantic metadata dependencies must be acyclic portable values");
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new TypeError("declared semantic metadata dependencies must be plain objects or arrays");
  seen.add(value);
  if (Array.isArray(value)) {
    const copy = Object.freeze(value.map((entry) => sanitizeMetadataNested(entry, seen)));
    seen.delete(value);
    return copy;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  const copy = Object.freeze(
    Object.fromEntries(entries.map(([key, entry]) => [key, sanitizeMetadataNested(entry, seen)]))
  );
  seen.delete(value);
  return copy;
}

function sanitizeMetadataNested(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("declared semantic metadata dependencies must be finite numbers");
    return value;
  }
  return sanitizeMetadataObject(value, seen);
}

function stripUndeclaredMetadata(
  value: unknown,
  dependencies: ReadonlySet<string>,
  seen: Map<object, unknown>
): unknown {
  if (typeof value !== "object" || value === null) return value;
  const previous = seen.get(value);
  if (previous !== undefined) return previous;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const entry of value) copy.push(stripUndeclaredMetadata(entry, dependencies, seen));
    return Object.freeze(copy);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "annotations" && typeof entry === "object" && entry !== null) {
      copy[key] = stripAnnotations(entry, dependencies, seen);
    } else {
      copy[key] = stripUndeclaredMetadata(entry, dependencies, seen);
    }
  }
  return Object.freeze(copy);
}

function stripAnnotations(
  value: object,
  dependencies: ReadonlySet<string>,
  seen: Map<object, unknown>
): Readonly<Record<string, unknown>> {
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    if (key === "metadata") {
      const safe = sanitizeMetadataRecord(entry, dependencies);
      return Object.keys(safe).length > 0 ? [[key, safe]] : [];
    }
    return key === "extensions" ? [[key, stripUndeclaredMetadata(entry, dependencies, seen)]] : [];
  });
  return Object.freeze(Object.fromEntries(entries));
}

function sanitizeMetadataRecord(value: unknown, dependencies: ReadonlySet<string>): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return Object.freeze({});
  return Object.freeze(
    Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .filter((key) => dependencies.has(key))
        .sort()
        .map((key) => [key, sanitizeMetadata((value as Record<string, unknown>)[key])])
    )
  );
}

function stableValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
    .join(",")}}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
