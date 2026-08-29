import type { QueryConditionNode } from "../core/ast/index.js";
import { DomainAssertionError } from "../errors/index.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { emitQueryConditionSource } from "./source/query-condition.js";

/** One domain invariant, expressed in the shared condition AST. */
export interface AssertionDescriptor {
  readonly condition: QueryConditionNode;
  readonly bindings: readonly unknown[];
  /** Identifier reported by the failure; defaults to the field it names. */
  readonly rule: string | undefined;
  readonly message: string;
  /** The single field the condition speaks about, when it names exactly one. */
  readonly field: string | undefined;
}

export interface AssertionInput {
  readonly condition: QueryConditionNode;
  readonly bindings: readonly unknown[];
  readonly rule?: string;
  readonly message?: string;
}

export function resolveAssertionDescriptor(input: AssertionInput): AssertionDescriptor {
  const fields = conditionFields(input.condition, new Set());
  const field = fields.size === 1 ? [...fields][0] : undefined;
  const rule = input.rule ?? field;

  return Object.freeze({
    condition: input.condition,
    bindings: Object.freeze([...input.bindings]),
    rule,
    message:
      input.message ??
      (rule === undefined
        ? "a domain assertion does not hold"
        : `the assertion on ${JSON.stringify(rule)} does not hold`),
    field,
  });
}

/**
 * Emits the assertions as one guard over the validated state.
 *
 * The conditions are the same query conditions a filter or an access rule is
 * written in, so an invariant is not a callback the compiler has to call: it
 * becomes a comparison in the generated source, and an artifact with no
 * assertions emits nothing at all.
 */
export function emitAssertionSource(descriptors: readonly AssertionDescriptor[]): string {
  const writer = new CodeWriter();

  writer.line("function __assert(value) {");
  writer.indent(() => {
    descriptors.forEach((descriptor, index) => {
      const test = emitQueryConditionSource(descriptor.condition, { fieldBase: "value", paramBase: "value" });
      writer.line(`if (!(${test})) return __fail${index}(value);`);
    });
    writer.line("return undefined;");
  });
  writer.line("}");
  return writer.toString();
}

/** The failure each assertion produces, in declaration order. */
export function assertionFailures(
  descriptors: readonly AssertionDescriptor[],
  errors: readonly (AssertionErrorFactory | undefined)[]
): readonly ((value: unknown) => unknown)[] {
  return descriptors.map((descriptor, index) => {
    const custom = errors[index];
    if (custom === undefined) {
      const failure = Object.freeze({
        ...(descriptor.rule === undefined ? {} : { rule: descriptor.rule }),
        ...(descriptor.field === undefined ? {} : { field: descriptor.field }),
      });
      return () => new DomainAssertionError(descriptor.message, failure);
    }
    return (value: unknown) => custom(value, descriptor);
  });
}

export type AssertionErrorFactory = (value: unknown, descriptor: AssertionDescriptor) => unknown;

function conditionFields(condition: QueryConditionNode, into: Set<string>): Set<string> {
  if (condition.kind === "logical") {
    conditionFields(condition.left, into);
    conditionFields(condition.right, into);
    return into;
  }
  if (condition.kind === "not") return conditionFields(condition.inner, into);
  if (condition.left.kind === "field") into.add(condition.left.key);
  if (condition.right.kind === "field") into.add(condition.right.key);
  return into;
}
