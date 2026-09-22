import { canUseFastParse } from "../compiler/validate/emit-validate-support.js";
import type * as ATS from "../core/ats/index.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import type { SkippedOperation } from "./generate.js";

interface EmittedBinding {
  readonly binding: string;
  readonly type: string;
}

interface ValidatorSelection {
  readonly is: boolean;
  readonly safeParse: boolean;
  readonly maxIssues?: number;
}

export interface ValidatorArtifactEmitterContext {
  readonly js: string[];
  readonly typescript: boolean;
  readonly skipped: SkippedOperation[];
  readonly mark: (flag: "validationError") => void;
  readonly emitValidatorBinding: (
    binding: string,
    schema: ATS.AnyTypeSchema,
    reportName: string,
    operation: string,
    selection: ValidatorSelection
  ) => string | undefined;
}

function emitIsArtifact(declaration: string, validatorName: string, type: string, typescript: boolean): string {
  return typescript
    ? `${declaration} (${validatorName}.is as ${type});`
    : `${declaration} /*#__PURE__*/ ((v) => v.is)(${validatorName});`;
}

function emitSafeParseArtifact(
  declaration: string,
  validatorName: string,
  type: string,
  fastParse: boolean,
  typescript: boolean
): string {
  if (fastParse) {
    return `${declaration} (value${typescript ? ": unknown" : ""}) => ${validatorName}.is(value) ? { success: true, data: value } : ${validatorName}.safeParse(value);`;
  }
  return typescript
    ? `${declaration} (${validatorName}.safeParse as ${type});`
    : `${declaration} /*#__PURE__*/ ((v) => v.safeParse)(${validatorName});`;
}

function emitParseArtifact(
  declaration: string,
  validatorName: string,
  fastParse: boolean,
  typescript: boolean
): string {
  const parameter = `value${typescript ? ": unknown" : ""}`;
  const body = fastParse
    ? `{ if (${validatorName}.is(value)) return value; const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); }`
    : `{ const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); }`;
  return `${declaration} (${parameter}) => ${body};`;
}

/** Creates the AOT wrapper for standalone validation artifacts. */
export function createValidatorArtifactEmitter(context: ValidatorArtifactEmitterContext) {
  const { js, skipped, mark, emitValidatorBinding, typescript } = context;

  function emitValidatorArtifact(
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "validator" }>,
    reportName: string,
    type: string
  ): EmittedBinding | undefined {
    if (artifact.op === "parseAsync" || artifact.op === "safeParseAsync") {
      skipped.push({
        schema: reportName,
        operation: artifact.op,
        reason: "async validators are runtime-only in AOT output",
      });
      return undefined;
    }

    // Leading with `is` skips the issue-collecting traversal for a value that
    // is already valid, so parse and safeParse share the same fast path the
    // runtime compiler uses.
    const fastParse = (artifact.op === "parse" || artifact.op === "safeParse") && canUseFastParse(artifact.schema);
    const validatorName = emitValidatorBinding(binding, artifact.schema, reportName, artifact.op, {
      is: artifact.op === "is" || fastParse,
      safeParse: artifact.op === "safeParse" || artifact.op === "parse",
      ...(artifact.maxIssues === undefined ? {} : { maxIssues: artifact.maxIssues }),
    });

    if (!validatorName) return undefined;

    if (artifact.op === "is") {
      js.push(emitIsArtifact(declaration, validatorName, type, typescript));
    } else if (artifact.op === "safeParse") {
      js.push(emitSafeParseArtifact(declaration, validatorName, type, fastParse, typescript));
    } else {
      mark("validationError");
      js.push(emitParseArtifact(declaration, validatorName, fastParse, typescript));
    }

    return { binding, type };
  }
  return { emitValidatorArtifact };
}
