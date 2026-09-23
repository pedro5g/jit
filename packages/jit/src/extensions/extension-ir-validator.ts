import type {
  ExtensionIntrinsic,
  ExtensionIR,
  ExtensionIRNode,
  ExtensionTransform,
  ExtensionValueType,
  ValidatedExtensionIR,
} from "./extension-ir.js";
import { digestExtensionIR, normalizeExtensionIR, stableExtensionIRJson } from "./extension-ir-normalizer.js";

type ValueType = ExtensionValueType;
type NodeKind = ExtensionIRNode["kind"];

const allowedNodeKeys: Readonly<Record<NodeKind, readonly string[]>> = Object.freeze({
  load: ["kind", "path"],
  literal: ["kind", "value"],
  compare: ["kind", "operator", "left", "right"],
  logical: ["kind", "operator", "operands"],
  not: ["kind", "input"],
  branch: ["kind", "when", "then", "otherwise"],
  loop: ["kind", "body", "count"],
  callIntrinsic: ["kind", "name", "args"],
  emitIssue: ["kind", "code", "params"],
  transform: ["kind", "input", "intrinsic"],
  return: ["kind", "value"],
});

const referenceFields: Readonly<Record<NodeKind, readonly string[]>> = Object.freeze({
  load: [],
  literal: [],
  compare: ["left", "right"],
  logical: ["operands"],
  not: ["input"],
  branch: ["when", "then", "otherwise"],
  loop: ["body"],
  callIntrinsic: ["args"],
  emitIssue: [],
  transform: ["input"],
  return: ["value"],
});

interface SemanticState {
  readonly types: Map<number, ValueType>;
  readonly effects: Set<"issues" | "transform">;
}

type SemanticAction = (node: ExtensionIRNode, index: number, state: SemanticState) => void;

const semanticActions: Readonly<Record<NodeKind, SemanticAction>> = Object.freeze({
  load: (_node, index, state) => state.types.set(index, "unknown"),
  literal: (node, index, state) => {
    if (node.kind !== "literal") return;
    if (typeof node.value === "number" && !Number.isFinite(node.value))
      throw new TypeError(`extension IR literal at ${index} must be finite`);
    state.types.set(index, literalType(node.value));
  },
  compare: (node, index, state) => {
    if (node.kind !== "compare") return;
    requireExpression(node.left, state.types, index, "left");
    requireExpression(node.right, state.types, index, "right");
    state.types.set(index, "boolean");
  },
  logical: (node, index, state) => {
    if (node.kind !== "logical") return;
    for (const operand of node.operands) requireBoolean(operand, state.types, index);
    state.types.set(index, "boolean");
  },
  not: (node, index, state) => {
    if (node.kind !== "not") return;
    requireBoolean(node.input, state.types, index);
    state.types.set(index, "boolean");
  },
  branch: (node, index, state) => {
    if (node.kind !== "branch") return;
    requireBoolean(node.when, state.types, index);
    requireExpression(node.then, state.types, index, "branch then");
    if (node.otherwise !== undefined) requireExpression(node.otherwise, state.types, index, "branch else");
  },
  loop: () => {},
  callIntrinsic: (node, index, state) => {
    if (node.kind !== "callIntrinsic") return;
    validateIntrinsic(node, state.types, index);
    state.types.set(index, intrinsicType(node.name));
  },
  emitIssue: (node, index, state) => {
    if (node.kind !== "emitIssue") return;
    state.effects.add("issues");
    validatePortableValue(node.params ?? {}, `issue params at ${index}`);
  },
  transform: (node, index, state) => {
    if (node.kind !== "transform") return;
    validateTransform(node, index, state.types);
    state.effects.add("transform");
  },
  return: (node, index, state) => {
    if (node.kind === "return" && node.value !== undefined)
      requireExpression(node.value, state.types, index, "return value");
  },
});

/** Validates structure, references, types, effects, and portable constants before lowering. */
export function validateExtensionIR(input: ExtensionIR): ValidatedExtensionIR {
  validateProgramHeader(input);
  const state = validateProgram(input.nodes);
  validateProgramResult(input, state.types);
  validateDeclaredEffects(input.effects, state.effects);

  const normalized = normalizeExtensionIR({
    version: 1,
    nodes: input.nodes,
    result: input.result,
    ...(state.effects.size === 0 ? {} : { effects: [...state.effects].sort(compareText) }),
  });
  return Object.freeze({
    ir: normalized,
    digest: digestExtensionIR(stableExtensionIRJson(normalized)),
    resultType: returnType(input.nodes[input.result], state.types),
    effects: Object.freeze([...state.effects].sort(compareText)),
    portable: true,
  });
}

function validateProgramHeader(input: ExtensionIR): void {
  const keys = new Set(["version", "nodes", "result", "effects"]);
  if (
    typeof input !== "object" ||
    input === null ||
    Reflect.ownKeys(input).some((key) => typeof key !== "string" || !keys.has(key))
  )
    throw new TypeError("extension IR contains an unsupported top-level field");
  if (input.version !== 1) throw new TypeError(`unsupported extension IR version ${String(input.version)}`);
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) throw new TypeError("extension IR requires nodes");
  if (!isNodeIndex(input.result, input.nodes.length))
    throw new TypeError("extension IR result is outside its node list");
  if (input.effects !== undefined && !validEffects(input.effects))
    throw new TypeError("extension IR effects must be issues or transform");
}

function validEffects(effects: readonly string[]): boolean {
  return (
    Array.isArray(effects) &&
    effects.every((effect) => effect === "issues" || effect === "transform") &&
    new Set(effects).size === effects.length
  );
}

function validateProgram(nodes: readonly ExtensionIRNode[]): SemanticState {
  const state: SemanticState = { types: new Map(), effects: new Set() };
  let returnCount = 0;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node === undefined) throw new TypeError(`extension IR node ${index} is missing`);
    validateNodeShape(node, index, nodes.length);
    validateNodeSemantics(node, index, state);
    if (node.kind === "return") returnCount++;
  }
  if (returnCount !== 1 || nodes[nodes.length - 1]?.kind !== "return")
    throw new TypeError("extension IR must end with exactly one terminal return node");
  return state;
}

function validateNodeSemantics(node: ExtensionIRNode, index: number, state: SemanticState): void {
  semanticActions[node.kind](node, index, state);
}

function validateNodeShape(node: ExtensionIRNode, index: number, length: number): void {
  assertSupportedNode(node, index);
  assertAllowedFields(node, index);
  validateNodePayload(node, index);
  validateNodeReferences(node, index, length);
}

function assertSupportedNode(node: ExtensionIRNode, index: number): void {
  if (typeof node !== "object" || node === null || !("kind" in node))
    throw new TypeError(`invalid extension IR node at ${index}`);
  if (typeof node.kind !== "string" || !Object.keys(allowedNodeKeys).includes(node.kind))
    throw new TypeError(`unsupported extension IR node kind at ${index}`);
}

function assertAllowedFields(node: ExtensionIRNode, index: number): void {
  const allowed = allowedNodeKeys[node.kind];
  const keys = Reflect.ownKeys(node);
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key)))
    throw new TypeError(`extension IR node ${index} contains an unsupported field`);
}

function validateNodePayload(node: ExtensionIRNode, index: number): void {
  const validate = payloadValidators[node.kind] as (candidate: ExtensionIRNode, position: number) => void;
  validate(node, index);
}

type PayloadValidator<K extends NodeKind> = (
  node: Extract<ExtensionIRNode, { readonly kind: K }>,
  index: number
) => void;

const payloadValidators: { readonly [K in NodeKind]: PayloadValidator<K> } = Object.freeze({
  load: (node, index) => validateLoadPath(node.path, index),
  literal: (node, index) => {
    if (node.value !== null && !["string", "number", "boolean"].includes(typeof node.value))
      throw new TypeError(`invalid extension IR literal at ${index}`);
  },
  compare: (node, index) => {
    if (!isComparison(node.operator)) throw new TypeError(`invalid comparison at ${index}`);
  },
  logical: (node, index) => validateLogicalPayload(node, index),
  not: () => {},
  branch: () => {},
  loop: (node, index) => {
    if (node.count !== undefined && (!Number.isSafeInteger(node.count) || node.count < 0))
      throw new TypeError(`invalid loop count at ${index}`);
  },
  callIntrinsic: (node, index) => {
    if (!Array.isArray(node.args) || !isIntrinsic(node.name)) throw new TypeError(`invalid intrinsic call at ${index}`);
  },
  emitIssue: (node, index) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(node.code)) throw new TypeError(`invalid issue code at ${index}`);
  },
  transform: (node, index) => {
    if (node.intrinsic !== undefined && !isTransform(node.intrinsic))
      throw new TypeError(`invalid transform at ${index}`);
  },
  return: () => {},
});

function validateLogicalPayload(node: Extract<ExtensionIRNode, { readonly kind: "logical" }>, index: number): void {
  const validOperator = node.operator === "and" || node.operator === "or";
  if (!Array.isArray(node.operands) || !validOperator || node.operands.length < 2)
    throw new TypeError(`invalid logical node at ${index}`);
}

function validateLoadPath(path: readonly (string | number)[], index: number): void {
  if (!Array.isArray(path) || path.some((key) => typeof key !== "string" && (!Number.isSafeInteger(key) || key < 0)))
    throw new TypeError(`extension IR load path at ${index} must contain strings or non-negative integer indexes`);
}

function validateNodeReferences(node: ExtensionIRNode, index: number, length: number): void {
  for (const field of referenceFields[node.kind]) {
    const value = (node as unknown as Readonly<Record<string, unknown>>)[field];
    if (value === undefined) continue;
    const references = Array.isArray(value) ? value : [value];
    for (const reference of references) {
      if (!isNodeIndex(reference, length))
        throw new TypeError(`extension IR ${field} at ${index} is outside its node list`);
    }
  }
}

function validateTransform(
  node: Extract<ExtensionIRNode, { readonly kind: "transform" }>,
  index: number,
  types: Map<number, ValueType>
): void {
  requireExpression(node.input, types, index, "input");
  if (node.intrinsic !== undefined && types.get(node.input) !== "string")
    throw new TypeError(`extension IR string transform at ${index} requires a statically known string`);
  types.set(index, node.intrinsic === undefined ? (types.get(node.input) ?? "unknown") : "string");
}

function validateIntrinsic(
  node: Extract<ExtensionIRNode, { readonly kind: "callIntrinsic" }>,
  types: ReadonlyMap<number, ValueType>,
  index: number
): void {
  if (node.args.length !== 1) throw new TypeError(`intrinsic ${node.name} at ${index} requires one argument`);
  const argument = node.args[0];
  if (argument === undefined || !types.has(argument))
    throw new TypeError(`intrinsic ${node.name} at ${index} must reference an earlier expression`);
  const type = types.get(argument);
  if ((node.name === "stringLength" && type !== "string") || (node.name === "arrayLength" && type !== "unknown"))
    throw new TypeError(`intrinsic ${node.name} at ${index} has an incompatible argument`);
}

function validateProgramResult(input: ExtensionIR, types: ReadonlyMap<number, ValueType>): void {
  const result = input.nodes[input.result];
  if (result?.kind !== "return" || input.result !== input.nodes.length - 1)
    throw new TypeError("extension IR result must reference the terminal return node");
  if (result.value !== undefined) requireExpression(result.value, types, input.result, "return value");
}

function validateDeclaredEffects(
  declared: readonly ("issues" | "transform")[] | undefined,
  used: ReadonlySet<"issues" | "transform">
): void {
  const effects = new Set(declared ?? []);
  if ([...used].some((effect) => !effects.has(effect)))
    throw new TypeError("extension IR uses an effect that was not declared");
  if ([...effects].some((effect) => !used.has(effect))) throw new TypeError("extension IR declares an unused effect");
}

function returnType(node: ExtensionIRNode | undefined, types: ReadonlyMap<number, ValueType>): ValueType {
  if (node?.kind !== "return" || node.value === undefined) return "unknown";
  return types.get(node.value) ?? "unknown";
}

function validatePortableValue(value: unknown, label: string, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`);
    return;
  }
  if (typeof value !== "object" || seen.has(value))
    throw new TypeError(`${label} must contain only acyclic portable JSON values`);
  if (!Array.isArray(value) && !isPlainRecord(value))
    throw new TypeError(`${label} must contain only plain objects and arrays`);
  seen.add(value);
  validatePortableChildren(value, label, seen);
  seen.delete(value);
}

function validatePortableChildren(value: object, label: string, seen: Set<object>): void {
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const entry of children) validatePortableValue(entry, label, seen);
}

function isPlainRecord(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireExpression(index: number, types: ReadonlyMap<number, ValueType>, at: number, name: string): void {
  if (!types.has(index)) throw new TypeError(`extension IR ${name} at ${at} must reference an earlier expression`);
}

function requireBoolean(index: number, types: ReadonlyMap<number, ValueType>, at: number): void {
  if (types.get(index) !== "boolean") throw new TypeError(`extension IR logical operand at ${at} must be boolean`);
}

function literalType(value: string | number | boolean | null): ValueType {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "null";
}

function intrinsicType(name: ExtensionIntrinsic): ValueType {
  return name === "stringLength" || name === "arrayLength" ? "number" : "boolean";
}

function isNodeIndex(value: unknown, length: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < length;
}

function isComparison(value: string): value is Extract<ExtensionIRNode, { readonly kind: "compare" }>["operator"] {
  return ["eq", "neq", "lt", "lte", "gt", "gte"].includes(value);
}

function isIntrinsic(value: string): value is ExtensionIntrinsic {
  return [
    "isString",
    "isNumber",
    "isBoolean",
    "isBigint",
    "isSymbol",
    "isFunction",
    "isArray",
    "isNull",
    "isDefined",
    "stringLength",
    "arrayLength",
  ].includes(value);
}

function isTransform(value: string): value is ExtensionTransform {
  return ["string.toLowerCase", "string.toUpperCase", "string.trim"].includes(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
