import type { ExtensionIR, ExtensionIRNode } from "./extension-ir.js";

/** Freezes node payloads and orders record keys without changing node indexes. */
export function normalizeExtensionIR(input: ExtensionIR): ExtensionIR {
  const nodes = input.nodes.map(normalizeNode);
  return Object.freeze({
    version: 1 as const,
    nodes: Object.freeze(nodes),
    result: input.result,
    ...(input.effects === undefined ? {} : { effects: Object.freeze([...input.effects].sort(compareText)) }),
  });
}

/** Stable JSON representation used only for the extension IR digest. */
export function stableExtensionIRJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableExtensionIRJson).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableExtensionIRJson(entry)}`)
      .join(",")}}`;
  if (typeof value === "number" && Object.is(value, -0)) return `"$number:-0"`;
  return JSON.stringify(value);
}

/** Computes a stable fixed-width digest for normalized extension IR. */
export function digestExtensionIR(value: string): string {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ (code + index), 3266489917);
  }
  return `extension-ir-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeNode(node: ExtensionIRNode): ExtensionIRNode {
  const fields = Object.fromEntries(Object.entries(node).filter(([, value]) => value !== undefined));
  if ("path" in node) fields.path = Object.freeze([...node.path]);
  if ("operands" in node) fields.operands = Object.freeze([...node.operands]);
  if ("args" in node) fields.args = Object.freeze([...node.args]);
  if ("params" in node && node.params !== undefined) fields.params = normalizeRecord(node.params);
  return Object.freeze(fields) as ExtensionIRNode;
}

function normalizeRecord(record: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.freeze(
    Object.fromEntries(
      Object.keys(record)
        .sort(compareText)
        .map((key) => [key, normalizePortableValue(record[key])])
    )
  );
}

function normalizePortableValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number")
    return value;
  if (Array.isArray(value)) return Object.freeze(value.map(normalizePortableValue));
  if (typeof value === "object")
    return Object.freeze(
      Object.fromEntries(
        Object.keys(value)
          .sort(compareText)
          .map((key) => [key, normalizePortableValue((value as Record<string, unknown>)[key])])
      )
    );
  throw new TypeError("extension IR constants must be portable JSON values");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
