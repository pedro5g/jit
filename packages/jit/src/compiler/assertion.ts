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
  /** Machine-readable issue code; `custom` unless the caller names one. */
  readonly code: string;
  readonly message: string;
  /** The single field the condition speaks about, when it names exactly one. */
  readonly field: string | undefined;
}

export interface AssertionInput {
  readonly condition: QueryConditionNode;
  readonly bindings: readonly unknown[];
  readonly rule?: string;
  readonly code?: string;
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
    // A domain code is the caller's vocabulary; without one the issue says
    // only that this was an application rule rather than a schema shape.
    code: input.code ?? "custom",
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
export function emitAssertionSource(descriptors: readonly AssertionDescriptor[], maxIssues?: number): string {
  const writer = new CodeWriter();

  writer.line("function __assert(value) {");
  writer.indent(() => {
    // Independent invariants are independent answers: all of them are
    // collected, the way sibling schema failures are, rather than the caller
    // learning one per attempt. The list is allocated on the first failure.
    writer.line("let issues;");
    descriptors.forEach((descriptor, index) => {
      const test = emitQueryConditionSource(descriptor.condition, { fieldBase: "value", paramBase: "value" });
      writer.line(`if (!(${test})) {`);
      writer.indent(() => {
        writer.line(`const failure = __fail${index}(value);`);
        // A declared error type is not an issue; it is reported as it is.
        writer.line("if (failure !== undefined) return { error: failure };");
        writer.line(`(issues ??= [])[issues.length] = __issue${index};`);
        if (maxIssues !== undefined) writer.line(`if (issues.length === ${maxIssues}) return { issues };`);
      });
      writer.line("}");
    });
    writer.line("return issues === undefined ? undefined : { issues };");
  });
  writer.line("}");
  return writer.toString();
}

/** The issue each assertion contributes, in declaration order. */
export function assertionIssues(descriptors: readonly AssertionDescriptor[]): readonly AssertionIssue[] {
  return descriptors.map((descriptor) =>
    Object.freeze({
      path: descriptor.field === undefined ? [] : [descriptor.field],
      code: descriptor.code,
      expected: descriptor.rule ?? GENERIC_RULE,
      message: descriptor.message,
    })
  );
}

/** The custom error each assertion declares, or `undefined` to use its issue. */
export function assertionFailures(
  descriptors: readonly AssertionDescriptor[],
  errors: readonly (AssertionErrorFactory | undefined)[]
): readonly ((value: unknown) => unknown)[] {
  return descriptors.map((descriptor, index) => {
    const custom = errors[index];
    if (custom === undefined) return () => undefined;
    return (value: unknown) => custom(value, descriptor);
  });
}

/** Same shape as a validation issue, so one list carries both kinds. */
export interface AssertionIssue {
  readonly path: readonly PropertyKey[];
  readonly code: string;
  readonly expected: string;
  readonly message: string;
}

/** The error an assertion failure travels in when no custom one was declared. */
export function assertionError(issues: readonly AssertionIssue[]): DomainAssertionError {
  const first = issues[0];
  // `expected` carries the declared rule name; the generic text means the
  // caller never named one.
  const rule = first?.expected === GENERIC_RULE ? undefined : first?.expected;

  return new DomainAssertionError(first?.message ?? "a domain assertion does not hold", {
    ...(rule === undefined ? {} : { rule }),
    ...(first?.path[0] === undefined ? {} : { field: String(first.path[0]) }),
    issues,
  });
}

const GENERIC_RULE = "a domain invariant";

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
