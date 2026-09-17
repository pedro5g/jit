import { emitValidator } from "../compiler/validate/emit-validate.js";
import type * as ATS from "../core/ats/index.js";
import type { SkippedOperation } from "./generate.js";

export interface ValidatorBindingSelection {
  readonly is: boolean;
  readonly safeParse: boolean;
  readonly parse?: boolean;
  readonly resolveDefaults?: boolean;
  readonly materializeRuntimeTypes?: boolean;
  readonly validateChecks?: boolean;
  readonly maxIssues?: number;
}

export interface ValidatorBindingEmitterContext {
  readonly js: string[];
  readonly skipped: SkippedOperation[];
  readonly classBindings: ReadonlyMap<unknown, string>;
  readonly assertionBindings: ReadonlyMap<unknown, string>;
  readonly internalIdentifier: (preferred: string) => string;
  readonly serializeBindingValue: (value: unknown) => string | undefined;
  readonly indentBlock: (source: string) => string[];
  readonly tryEmit: <TValue>(
    schema: string,
    operation: string,
    skipped: SkippedOperation[],
    emit: () => TValue
  ) => TValue | undefined;
}

/** Creates the shared validator prelude used by all AOT artifact families. */
export function createValidatorBindingEmitter(context: ValidatorBindingEmitterContext) {
  return (
    binding: string,
    schema: ATS.AnyTypeSchema,
    reportName: string,
    operation: string,
    selection: ValidatorBindingSelection
  ) => emitValidatorBinding(context, binding, schema, reportName, operation, selection);
}

function emitValidatorBinding(
  context: ValidatorBindingEmitterContext,
  binding: string,
  schema: ATS.AnyTypeSchema,
  reportName: string,
  operation: string,
  selection: ValidatorBindingSelection
): string | undefined {
  const validator = context.tryEmit(reportName, operation, context.skipped, () =>
    emitValidator(schema, {
      is: selection.is,
      safeParse: selection.safeParse,
      safeParseAsync: false,
      fastParse: selection.parse === true,
      ...(selection.resolveDefaults === undefined ? {} : { resolveDefaults: selection.resolveDefaults }),
      ...(selection.materializeRuntimeTypes === undefined
        ? {}
        : { materializeRuntimeTypes: selection.materializeRuntimeTypes }),
      ...(selection.maxIssues === undefined ? {} : { maxIssues: selection.maxIssues }),
      ...(selection.validateChecks === undefined ? {} : { validateChecks: selection.validateChecks }),
    })
  );
  if (!validator) return undefined;

  const inlined = validatorBindings(
    context,
    validator.bindings.names,
    validator.bindings.values,
    reportName,
    operation
  );
  if (inlined === undefined) return undefined;
  const validatorName = context.internalIdentifier(`${binding}_validator`);
  context.js.push(`const ${validatorName} = /*#__PURE__*/ (() => {`);
  context.js.push(...inlined.map((line) => `  ${line}`), ...context.indentBlock(validator.source), "})();");
  return validatorName;
}

function validatorBindings(
  context: ValidatorBindingEmitterContext,
  names: readonly string[],
  values: readonly unknown[],
  reportName: string,
  operation: string
): string[] | undefined {
  const inlined: string[] = [];
  for (let index = 0; index < names.length; index++) {
    const name = names[index] as string;
    const value = values[index];
    const classBinding = context.classBindings.get(value);
    if (classBinding !== undefined) {
      inlined.push(`const ${name} = ${classBinding};`);
      continue;
    }
    const assertionBinding = context.assertionBindings.get(value);
    if (assertionBinding !== undefined) {
      inlined.push(`const ${name} = ${assertionBinding};`);
      continue;
    }
    const literal = context.serializeBindingValue(value);
    if (literal === undefined) {
      context.skipped.push({
        schema: reportName,
        operation,
        reason: "refine/transform/default callbacks cannot be serialized ahead of time",
      });
      return undefined;
    }
    inlined.push(`const ${name} = ${literal};`);
  }
  return inlined;
}
