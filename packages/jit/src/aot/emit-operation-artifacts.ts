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
import { canUseFastParse } from "../compiler/validate/emit-validate-support.js";
import type * as ATS from "../core/ats/index.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import type { ArtifactEmissionContext, EmittedBinding } from "./emit-context-types.js";

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

export interface OperationArtifactEmitterContext
  extends ArtifactEmissionContext<"validationError" | "mockHelpers" | "runtimeGetIndex"> {
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

type OperationArtifact = Extract<CompiledArtifact, { readonly kind: "operation" }>;
type OperationName = OperationArtifact["op"];
type OperationOf<TName extends OperationName> = OperationArtifact & { readonly op: TName };

interface OperationEmissionArgs {
  readonly binding: string;
  readonly declaration: string;
  readonly artifact: OperationArtifact;
  readonly reportName: string;
  readonly type: string;
}

type OperationHandler = (
  context: OperationArtifactEmitterContext,
  args: OperationEmissionArgs
) => EmittedBinding | undefined;

const OPERATION_ENTRY: Record<"clone" | "diff" | "stringify" | "format" | "mask", string> = {
  clone: "clone",
  diff: "diff",
  stringify: "stringify",
  format: "format",
  mask: "scrub",
};

const OPERATION_HANDLERS: Readonly<Record<OperationName, OperationHandler>> = {
  hash: emitHashOperation,
  equal: emitEqualOperation,
  clone: emitSourceOperation,
  diff: emitSourceOperation,
  stringify: emitSourceOperation,
  format: emitSourceOperation,
  mask: emitSourceOperation,
  sanitize: emitSanitizeOperation,
  fromJSON: emitFromJsonOperation,
  codec: emitCodecOperation,
  jsonSchema: emitJsonSchemaOperation,
  mock: emitMockOperation,
  update: emitUpdateOperation,
};

/** Creates the operation and codec emitters used by the artifact dispatcher. */
export function createOperationArtifactEmitter(context: OperationArtifactEmitterContext) {
  return {
    emitOperationArtifact: (
      binding: string,
      declaration: string,
      artifact: OperationArtifact,
      reportName: string,
      type: string
    ) => emitOperationArtifact(context, { binding, declaration, artifact, reportName, type }),
  };
}

function emitOperationArtifact(
  context: OperationArtifactEmitterContext,
  args: OperationEmissionArgs
): EmittedBinding | undefined {
  return OPERATION_HANDLERS[args.artifact.op](context, args);
}

function operationOf<TName extends OperationName>(args: OperationEmissionArgs, _name: TName): OperationOf<TName> {
  return args.artifact as OperationOf<TName>;
}

function emitHashOperation(
  context: OperationArtifactEmitterContext,
  args: OperationEmissionArgs
): EmittedBinding | undefined {
  const artifact = operationOf(args, "hash");
  const hashBinding = context.internalIdentifier(`${args.binding}_hash`);
  if (!context.planEmitters.emitHashBinding(hashBinding, artifact.schema, args.reportName)) return undefined;
  context.js.push(`${args.declaration} ${hashBinding};`);
  return { binding: args.binding, type: args.type };
}

function emitEqualOperation(
  context: OperationArtifactEmitterContext,
  args: OperationEmissionArgs
): EmittedBinding | undefined {
  const artifact = operationOf(args, "equal");
  const source = context.tryEmit(args.reportName, "equal", context.skipped, () => emitEqualSource(artifact.schema));
  if (!source) return undefined;
  if (source.includes("__getIndex")) context.mark("runtimeGetIndex");
  if (source.includes("__hash")) {
    const hashBinding = context.internalIdentifier(`${args.binding}_hash`);
    if (!context.planEmitters.emitHashBinding(hashBinding, artifact.schema, args.reportName)) return undefined;
    context.js.push(
      `${args.declaration} /*#__PURE__*/ ((__hash) => ${context.asExpression(source, "equal")})(${hashBinding});`
    );
  } else {
    context.js.push(`${args.declaration} ${context.asExpression(source, "equal")};`);
  }
  return { binding: args.binding, type: args.type };
}

function emitSourceOperation(
  context: OperationArtifactEmitterContext,
  args: OperationEmissionArgs
): EmittedBinding | undefined {
  const artifact = args.artifact as OperationOf<"clone" | "diff" | "stringify" | "format" | "mask">;
  const source = emitOperationSource(context, artifact.op, artifact.schema, args.reportName);
  if (!source) return undefined;
  context.js.push(`${args.declaration} ${context.asExpression(source, OPERATION_ENTRY[artifact.op])};`);
  return { binding: args.binding, type: args.type };
}

function emitOperationSource(
  context: OperationArtifactEmitterContext,
  operation: "clone" | "diff" | "stringify" | "format" | "mask",
  schema: ATS.AnyTypeSchema,
  reportName: string
): string | undefined {
  switch (operation) {
    case "clone":
      return context.tryEmit(reportName, operation, context.skipped, () => emitCloneSource(schema));
    case "diff":
      return context.tryEmit(reportName, operation, context.skipped, () => emitDiffSource(schema));
    case "stringify":
      return context.tryEmit(reportName, operation, context.skipped, () => emitSerialize(schema));
    case "format":
      return context.tryEmit(reportName, operation, context.skipped, () => emitFormatSource(schema));
    case "mask":
      return context.tryEmit(reportName, operation, context.skipped, () => emitMaskSource(schema));
  }
}

function emitSanitizeOperation(
  context: OperationArtifactEmitterContext,
  args: OperationEmissionArgs
): EmittedBinding | undefined {
  const artifact = operationOf(args, "sanitize");
  const source = context.tryEmit(args.reportName, "sanitize", context.skipped, () =>
    emitSanitizeSource(artifact.schema)
  );
  if (!source) return undefined;
  context.js.push(`${args.declaration} /*#__PURE__*/ (() => {`);
  context.js.push(
    ...sanitizeChainBindings.names.map(
      (name, position) => `  const ${name} = ${String(sanitizeChainBindings.values[position])};`
    ),
    ...context.indentBlock(`return ${context.asExpression(source, "scrub")};`),
    "})();"
  );
  return { binding: args.binding, type: args.type };
}

function emitFromJsonOperation(
  context: OperationArtifactEmitterContext,
  args: OperationEmissionArgs
): EmittedBinding | undefined {
  const artifact = operationOf(args, "fromJSON");
  const fastParse = canUseFastParse(artifact.schema);
  const validatorName = context.emitValidatorBinding(args.binding, artifact.schema, args.reportName, "fromJSON", {
    is: fastParse,
    safeParse: true,
  });
  if (!validatorName) return undefined;
  context.mark("validationError");
  context.js.push(
    fastParse
      ? `${args.declaration} (json) => { const value = JSON.parse(json); if (${validatorName}.is(value)) return value; const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
      : `${args.declaration} (json) => { const r = ${validatorName}.safeParse(JSON.parse(json)); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
  );
  return { binding: args.binding, type: args.type };
}

function emitCodecOperation(
  context: OperationArtifactEmitterContext,
  args: OperationEmissionArgs
): EmittedBinding | undefined {
  const artifact = operationOf(args, "codec");
  if (!emitCodecBinding(context, args.binding, args.declaration, artifact.schema, args.reportName, "codec")) {
    return undefined;
  }
  return { binding: args.binding, type: args.type };
}

function emitJsonSchemaOperation(
  context: OperationArtifactEmitterContext,
  args: OperationEmissionArgs
): EmittedBinding | undefined {
  const artifact = operationOf(args, "jsonSchema");
  const document = context.tryEmit(args.reportName, "jsonSchema", context.skipped, () =>
    compileJsonSchema(artifact.schema)
  );
  if (!document) return undefined;
  context.js.push(`${args.declaration} /*#__PURE__*/ Object.freeze(${JSON.stringify(document)});`);
  return { binding: args.binding, type: args.type };
}

function emitMockOperation(
  context: OperationArtifactEmitterContext,
  args: OperationEmissionArgs
): EmittedBinding | undefined {
  const artifact = operationOf(args, "mock");
  const source = context.tryEmit(args.reportName, "mock", context.skipped, () => emitMockSource(artifact.schema));
  if (!source) return undefined;
  context.mark("mockHelpers");
  context.js.push(`${args.declaration} (${source});`);
  return { binding: args.binding, type: args.type };
}

function emitUpdateOperation(
  context: OperationArtifactEmitterContext,
  args: OperationEmissionArgs
): EmittedBinding | undefined {
  const artifact = operationOf(args, "update");
  const source = context.tryEmit(args.reportName, "update", context.skipped, () => emitUpdateSource(artifact.schema));
  if (!source) return undefined;
  context.js.push(`${args.declaration} ${context.asExpression(source, "update")};`);
  return { binding: args.binding, type: args.type };
}

function emitCodecBinding(
  context: OperationArtifactEmitterContext,
  binding: string,
  declaration: string,
  schema: ATS.AnyTypeSchema,
  reportName: string,
  operation: string
): boolean {
  const codec = context.tryEmit(reportName, operation, context.skipped, () => emitCodec(schema));
  if (!codec) return false;
  const inlined = context.inlineCodecBindings(codec.bindingNames, codec.bindingValues);
  if (inlined === undefined) {
    context.skipped.push({ schema: reportName, operation, reason: "codec bindings cannot be serialized" });
    return false;
  }
  context.js.push(
    `${declaration} /*#__PURE__*/ (() => {`,
    ...inlined.map((line) => `  ${line}`),
    ...context.indentBlock(codec.source),
    "})();"
  );
  void binding;
  return true;
}
