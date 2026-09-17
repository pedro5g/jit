import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import type { ClassArtifact, ClassArtifactEmitContext } from "./emit-class-types.js";

type ClassPolicy = NonNullable<ClassArtifact["policy"]>;

export function emitClassPolicy(
  context: ClassArtifactEmitContext,
  policy: ClassPolicy,
  reportName: string
): string[] | undefined {
  const errorBinding = policy.error === undefined ? undefined : context.serializeBindingValue(policy.error);
  if (policy.error !== undefined && errorBinding === undefined) {
    skipPolicy(
      context,
      reportName,
      "class.validate",
      "the configured error factory cannot be serialized ahead of time"
    );
    return undefined;
  }
  const lines = createPolicyPrelude(policy, errorBinding);
  const nestedAssertions = (policy.nestedErrors ?? []).filter(
    (candidate) => candidate.runtimeBinding !== true && candidate.assertion !== undefined
  );
  if (nestedAssertions.length === 0) {
    lines.push("  const __error = __baseError;");
  } else {
    context.mark("assertionError");
    appendNestedError(lines, policy, nestedAssertions);
  }
  if (policy.result === "throw") context.mark("validationError");
  const assertions = policy.assertions;
  if (assertions !== undefined) {
    const assertionLines = emitPolicyAssertions(context, policy, assertions, reportName);
    if (assertionLines === undefined) return undefined;
    lines.push(...assertionLines);
  }
  return lines;
}

function createPolicyPrelude(policy: ClassPolicy, errorBinding: string | undefined): string[] {
  return [
    `  const __baseError = ${errorBinding ?? "(issues) => new JITValidationError(issues)"};`,
    policy.result === "either"
      ? "  const __success = (value) => value;"
      : policy.result === "tuple"
        ? "  const __success = (value) => [null, value];"
        : "  const __success = (value) => value;",
    policy.result === "either"
      ? '  const __factoryFailure = Symbol.for("jit.factory.failure"); const __failure = (error) => Object.defineProperties({ ok: false, error }, { [__factoryFailure]: { enumerable: false, value: true } });'
      : policy.result === "tuple"
        ? "  const __failure = (error) => [error, null];"
        : "  const __failure = (error) => { throw error; };",
  ];
}

function appendNestedError(
  lines: string[],
  policy: ClassPolicy,
  nestedAssertions: readonly NonNullable<ClassPolicy["nestedErrors"]>[number][]
): void {
  lines.push(
    "  const __error = (issues) => {",
    `    let __selectedPriority = ${policy.error === undefined ? "-Infinity" : String(policy.errorPriority ?? 1000)};`,
    `    let __selectedDepth = ${policy.error === undefined ? "Infinity" : "0"};`,
    `    let __selectedOrder = ${policy.error === undefined ? "Infinity" : "-1"};`,
    "    let __selectedNested = -1;"
  );
  for (const [index, candidate] of nestedAssertions.entries()) {
    lines.push(
      `    if (issues.some((issue) => ${JSON.stringify(candidate.path)}.every((part, index) => issue.path[index] === part)) && (${candidate.priority} > __selectedPriority || (${candidate.priority} === __selectedPriority && (${candidate.depth} < __selectedDepth || (${candidate.depth} === __selectedDepth && ${candidate.order} < __selectedOrder))))) {`,
      `      __selectedPriority = ${candidate.priority}; __selectedDepth = ${candidate.depth}; __selectedOrder = ${candidate.order}; __selectedNested = ${index};`,
      "    }"
    );
  }
  for (const [index, candidate] of nestedAssertions.entries()) {
    const assertion = candidate.assertion as {
      readonly rule: string | undefined;
      readonly field: string | undefined;
      readonly message: string;
    };
    const details = JSON.stringify({
      ...(assertion.rule === undefined ? {} : { rule: assertion.rule }),
      ...(assertion.field === undefined ? {} : { field: assertion.field }),
    });
    lines.push(
      `    if (__selectedNested === ${index}) return new DomainAssertionError(${JSON.stringify(assertion.message)}, { ...${details}, issues });`
    );
  }
  lines.push("    return __baseError(issues);", "  };");
}

function emitPolicyAssertions(
  context: ClassArtifactEmitContext,
  policy: ClassPolicy,
  assertions: NonNullable<ClassPolicy["assertions"]>,
  reportName: string
): string[] | undefined {
  const inlined = context.inlineBindings(assertions.bindingNames, assertions.bindingValues);
  if (inlined === undefined) {
    skipPolicy(context, reportName, "class.assert", "an assertion value cannot be serialized ahead of time");
    return undefined;
  }
  const lines = inlined.map((line) => `  ${line}`);
  context.mark("assertionError");
  for (const [index, failure] of assertions.failures.entries()) {
    const failureLines = emitAssertionFailure(context, failure, index, reportName);
    if (failureLines === undefined) return undefined;
    lines.push(...failureLines);
  }
  lines.push(...context.indentBlock(assertions.source));
  lines.push(emitAssertionFailureDispatch(policy, assertions));
  return lines;
}

function emitAssertionFailure(
  context: ClassArtifactEmitContext,
  failure: NonNullable<ClassPolicy["assertions"]>["failures"][number],
  index: number,
  reportName: string
): string[] | undefined {
  const custom = failure.error === undefined ? undefined : context.serializeBindingValue(failure.error);
  if (failure.error !== undefined && custom === undefined) {
    skipPolicy(context, reportName, "class.assert", "an assertion error factory cannot be serialized ahead of time");
    return undefined;
  }
  return [
    `  const __issue${index} = Object.freeze(${JSON.stringify({
      path: failure.field === undefined ? [] : [failure.field],
      code: failure.code,
      expected: failure.rule ?? "a domain invariant",
      message: failure.message,
    })});`,
    custom === undefined
      ? `  const __fail${index} = () => undefined;`
      : `  const __errorCandidate${index} = ${custom}; const __fail${index} = () => true;`,
  ];
}

function emitAssertionFailureDispatch(policy: ClassPolicy, assertions: NonNullable<ClassPolicy["assertions"]>): string {
  const policyPriority =
    policy.error === undefined
      ? ""
      : `if (outcome.errorIndex < 0 || ${policy.errorPriority ?? 1000} >= (outcome.errorIndex < 0 ? -1 : [${assertions.failures.map((failure) => failure.priority).join(", ")}][outcome.errorIndex])) return __error(outcome.issues);`;
  const customFailures = assertions.failures
    .map((failure, index) =>
      failure.error === undefined
        ? ""
        : `if (outcome.errorIndex === ${index}) return __errorCandidate${index}(value, ${JSON.stringify({
            rule: failure.rule,
            field: failure.field,
            code: failure.code,
            message: failure.message,
            priority: failure.priority,
          })});`
    )
    .join(" ");
  return `  const __assertFailure = (outcome, value) => { ${policyPriority} ${customFailures} const first = outcome.issues[0]; const rule = first?.expected === "a domain invariant" ? undefined : first?.expected; return new DomainAssertionError(first?.message ?? "a domain assertion does not hold", { rule, field: first?.path?.[0] === undefined ? undefined : String(first.path[0]), issues: outcome.issues }); };`;
}

function skipPolicy(context: ClassArtifactEmitContext, schema: string, operation: string, reason: string): void {
  context.skipped.push({ schema, operation, reason });
}

export type { CompiledArtifact };
