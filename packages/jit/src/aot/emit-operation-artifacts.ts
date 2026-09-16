import { emitCloneSource } from "../compiler/clone.js";
import { emitCodec } from "../compiler/codec/emit-codec.js";
import { emitDiffSource } from "../compiler/diff.js";
import { emitEqualSource } from "../compiler/equal.js";
import { emitFormatSource } from "../compiler/format.js";
import { compileJsonSchema } from "../compiler/json-schema/index.js";
import { emitMaskSource } from "../compiler/mask.js";
import { emitMockSource } from "../compiler/mock.js";
import { emitSanitizeSource, sanitizeChainBindings } from "../compiler/sanitize.js";
import { emitSerialize } from "../compiler/serialize/emit-serialize.js";
import { emitUpdateSource } from "../compiler/update.js";
import { canUseFastParse } from "../compiler/validate/emit-validate.js";
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
  readonly parse?: boolean;
  readonly resolveDefaults?: boolean;
  readonly materializeRuntimeTypes?: boolean;
  readonly validateChecks?: boolean;
  readonly maxIssues?: number;
}

interface OperationPlanEmitters {
  readonly emitHashBinding: (
    binding: string,
    schema: ATS.AnyTypeSchema,
    reportName: string,
    cache?: boolean
  ) => string | undefined;
}

export interface OperationArtifactEmitterContext {
  readonly js: string[];
  readonly skipped: SkippedOperation[];
  readonly mark: (flag: "validationError" | "mockHelpers" | "runtimeGetIndex") => void;
  readonly internalIdentifier: (preferred: string) => string;
  readonly asExpression: (source: string, entry: string) => string;
  readonly indentBlock: (source: string) => string[];
  readonly tryEmit: <TValue>(
    schema: string,
    operation: string,
    skipped: SkippedOperation[],
    emit: () => TValue
  ) => TValue | undefined;
  readonly inlineCodecBindings: (names: readonly string[], values: readonly unknown[]) => string[] | undefined;
  readonly emitValidatorBinding: (
    binding: string,
    schema: ATS.AnyTypeSchema,
    reportName: string,
    operation: string,
    selection: ValidatorSelection
  ) => string | undefined;
  readonly planEmitters: OperationPlanEmitters;
}

const OPERATION_ENTRY: Record<"clone" | "diff" | "stringify" | "format" | "mask", string> = {
  clone: "clone",
  diff: "diff",
  stringify: "stringify",
  format: "format",
  mask: "scrub",
};

/** Creates the operation and codec emitters used by the artifact dispatcher. */
export function createOperationArtifactEmitter(context: OperationArtifactEmitterContext) {
  const {
    js,
    skipped,
    mark,
    internalIdentifier,
    asExpression,
    indentBlock,
    tryEmit,
    inlineCodecBindings,
    emitValidatorBinding,
    planEmitters,
  } = context;

  function emitOperationArtifact(
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "operation" }>,
    reportName: string,
    type: string
  ): EmittedBinding | undefined {
    const schema = artifact.schema;
    const emitted = { binding, type };

    switch (artifact.op) {
      case "hash": {
        const hashBinding = internalIdentifier(`${binding}_hash`);

        if (!planEmitters.emitHashBinding(hashBinding, schema, reportName)) return undefined;
        js.push(`${declaration} ${hashBinding};`);
        return emitted;
      }
      case "equal": {
        const source = tryEmit(reportName, "equal", skipped, () => emitEqualSource(schema));

        if (!source) return undefined;
        if (source.includes("__getIndex")) mark("runtimeGetIndex");

        if (source.includes("__hash")) {
          const hashBinding = internalIdentifier(`${binding}_hash`);

          if (!planEmitters.emitHashBinding(hashBinding, schema, reportName)) return undefined;
          js.push(`${declaration} /*#__PURE__*/ ((__hash) => ${asExpression(source, "equal")})(${hashBinding});`);
        } else {
          js.push(`${declaration} ${asExpression(source, "equal")};`);
        }
        return emitted;
      }
      case "clone":
      case "diff":
      case "stringify":
      case "format":
      case "mask": {
        const source = emitOperationSource(artifact.op, schema, reportName);

        if (!source) return undefined;
        js.push(`${declaration} ${asExpression(source, OPERATION_ENTRY[artifact.op])};`);
        return emitted;
      }
      case "sanitize": {
        const source = tryEmit(reportName, "sanitize", skipped, () => emitSanitizeSource(schema));

        if (!source) return undefined;
        js.push(`${declaration} /*#__PURE__*/ (() => {`);
        js.push(
          ...sanitizeChainBindings.names.map(
            (name, position) => `  const ${name} = ${String(sanitizeChainBindings.values[position])};`
          )
        );
        js.push(...indentBlock(`return ${asExpression(source, "scrub")};`));
        js.push("})();");
        return emitted;
      }
      case "fromJSON": {
        const fastParse = canUseFastParse(schema);
        const validatorName = emitValidatorBinding(binding, schema, reportName, "fromJSON", {
          is: fastParse,
          safeParse: true,
        });

        if (!validatorName) return undefined;
        mark("validationError");
        js.push(
          fastParse
            ? `${declaration} (json) => { const value = JSON.parse(json); if (${validatorName}.is(value)) return value; const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
            : `${declaration} (json) => { const r = ${validatorName}.safeParse(JSON.parse(json)); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
        );
        return emitted;
      }
      case "codec": {
        if (!emitCodecBinding(binding, declaration, schema, reportName, "codec")) return undefined;
        return emitted;
      }
      case "jsonSchema": {
        const document = tryEmit(reportName, "jsonSchema", skipped, () => compileJsonSchema(schema));

        if (!document) return undefined;
        // Static data: the document is inlined, the translator never ships.
        js.push(`${declaration} /*#__PURE__*/ Object.freeze(${JSON.stringify(document)});`);
        return emitted;
      }
      case "mock": {
        const source = tryEmit(reportName, "mock", skipped, () => emitMockSource(schema));

        if (!source) return undefined;
        mark("mockHelpers");
        js.push(`${declaration} (${source});`);
        return emitted;
      }
      case "update": {
        const source = tryEmit(reportName, "update", skipped, () => emitUpdateSource(schema));

        if (!source) return undefined;
        js.push(`${declaration} ${asExpression(source, "update")};`);
        return emitted;
      }
    }
  }

  function emitOperationSource(
    operation: "clone" | "diff" | "stringify" | "format" | "mask",
    schema: ATS.AnyTypeSchema,
    reportName: string
  ): string | undefined {
    if (operation === "clone") return tryEmit(reportName, operation, skipped, () => emitCloneSource(schema));
    if (operation === "diff") return tryEmit(reportName, operation, skipped, () => emitDiffSource(schema));
    if (operation === "stringify") return tryEmit(reportName, operation, skipped, () => emitSerialize(schema));
    if (operation === "format") return tryEmit(reportName, operation, skipped, () => emitFormatSource(schema));
    return tryEmit(reportName, operation, skipped, () => emitMaskSource(schema));
  }

  function emitCodecBinding(
    binding: string,
    declaration: string,
    schema: ATS.AnyTypeSchema,
    reportName: string,
    operation: string
  ): boolean {
    const codec = tryEmit(reportName, operation, skipped, () => emitCodec(schema));

    if (!codec) return false;

    const inlined = inlineCodecBindings(codec.bindingNames, codec.bindingValues);

    if (inlined === undefined) {
      skipped.push({
        schema: reportName,
        operation,
        reason: "codec bindings cannot be serialized",
      });
      return false;
    }

    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...inlined.map((line) => `  ${line}`));
    js.push(...indentBlock(codec.source));
    js.push("})();");
    void binding;
    return true;
  }

  /** Queries carry their program, so AOT emits the loop for the wanted shape. */ return { emitOperationArtifact };
}
