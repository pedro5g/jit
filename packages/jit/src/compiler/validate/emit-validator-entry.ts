import type * as ATS from "../../core/ats/index.js";
import type { CodeWriter } from "../emitter/code-writer.js";
import { findRecursiveSchemas } from "../schema-recursion.js";
import type { ValidatorBindings } from "./emit-validate.js";
import { ValidatorEmitter } from "./emit-validate.js";
import { rootPath } from "./emit-validate-helpers.js";
import { containsPromise, rootHasReadonly } from "./emit-validate-support.js";

export interface EmittedValidator {
  readonly source: string;
  readonly bindings: ValidatorBindings;
}

export interface EmitValidatorOptions {
  readonly is?: boolean;
  readonly safeParse?: boolean;
  readonly safeParseAsync?: boolean;
  /** Emit a fail-fast parse function without a success result object. */
  readonly fastParse?: boolean;
  /** Keep defaults as required fields, for trusted persisted-state hydration. */
  readonly resolveDefaults?: boolean;
  /** Leave Runtime Type construction to an explicit execution `construct` stage. */
  readonly materializeRuntimeTypes?: boolean;
  /** Keep only materialization/transforms while skipping schema checks. */
  readonly validateChecks?: boolean;
  /** Stop the diagnostic traversal as soon as this many issues exist. */
  readonly maxIssues?: number;
}

function emitFreezeOutput(writer: CodeWriter, output: string): void {
  writer.line(
    `if (${output} !== null && (typeof ${output} === "object" || typeof ${output} === "function")) { ${output} = Object.freeze(${output}); }`
  );
}

/**
 * Emits `{ is, safeParse }` source for a schema. `is` is a pure boolean
 * type check with early returns; `safeParse` collects every issue with its
 * static path and returns `{ success, data | issues }`, rebuilding the output
 * only when defaults/coercions/transforms require it.
 */
export function emitValidator(schema: ATS.AnyTypeSchema, options: EmitValidatorOptions = {}): EmittedValidator {
  const settings = resolveValidatorSettings(options);
  const recursive = findRecursiveSchemas(schema);
  const parseEmitter = createParseEmitter(schema, recursive, settings);
  const asyncEmitter = createAsyncEmitter(schema, recursive, settings, parseEmitter);
  const isEmitter = createIsEmitter(schema, recursive, settings, asyncEmitter ?? parseEmitter);
  return assembleValidator(isEmitter, parseEmitter, asyncEmitter, settings.emitFastParse, settings.maxIssues);
}

interface ValidatorSettings {
  readonly emitIs: boolean;
  readonly emitSafeParse: boolean;
  readonly emitSafeParseAsync: boolean;
  readonly emitFastParse: boolean;
  readonly resolveDefaults: boolean;
  readonly materializeRuntimeTypes: boolean;
  readonly validateChecks: boolean;
  readonly maxIssues: number | undefined;
}

function resolveValidatorSettings(options: EmitValidatorOptions): ValidatorSettings {
  return {
    emitIs: options.is ?? true,
    emitSafeParse: options.safeParse ?? true,
    emitSafeParseAsync: options.safeParseAsync ?? true,
    emitFastParse: options.fastParse ?? false,
    resolveDefaults: options.resolveDefaults ?? true,
    materializeRuntimeTypes: options.materializeRuntimeTypes ?? true,
    validateChecks: options.validateChecks ?? true,
    maxIssues: options.maxIssues,
  };
}

function createParseEmitter(
  schema: ATS.AnyTypeSchema,
  recursive: ReadonlySet<ATS.AnyTypeSchema>,
  settings: ValidatorSettings
): ValidatorEmitter | undefined {
  if (settings.emitFastParse)
    return emitParseEmitter(
      schema,
      recursive,
      settings.resolveDefaults,
      settings.materializeRuntimeTypes,
      settings.validateChecks
    );
  if (!settings.emitSafeParse) return undefined;
  return emitDiagnosticEmitter(
    schema,
    recursive,
    settings.resolveDefaults,
    settings.materializeRuntimeTypes,
    settings.validateChecks,
    settings.maxIssues,
    rootHasReadonly(schema)
  );
}

function createAsyncEmitter(
  schema: ATS.AnyTypeSchema,
  recursive: ReadonlySet<ATS.AnyTypeSchema>,
  settings: ValidatorSettings,
  parseEmitter: ValidatorEmitter | undefined
): ValidatorEmitter | undefined {
  if (!settings.emitSafeParseAsync || settings.emitFastParse || !containsPromise(schema)) return undefined;
  return emitDiagnosticEmitter(
    schema,
    recursive,
    settings.resolveDefaults,
    settings.materializeRuntimeTypes,
    settings.validateChecks,
    settings.maxIssues,
    rootHasReadonly(schema),
    parseEmitter,
    true
  );
}

function createIsEmitter(
  schema: ATS.AnyTypeSchema,
  recursive: ReadonlySet<ATS.AnyTypeSchema>,
  settings: ValidatorSettings,
  sourceEmitter: ValidatorEmitter | undefined
): ValidatorEmitter | undefined {
  if (!settings.emitIs || settings.emitFastParse) return undefined;
  const emitter = new ValidatorEmitter(
    "is",
    false,
    settings.resolveDefaults,
    settings.materializeRuntimeTypes,
    undefined,
    settings.validateChecks
  );
  emitter.markRecursive(recursive);
  for (const value of sourceEmitter?.bindings().values ?? []) emitter.bind(value);
  emitter.writer.line("function is(value) {");
  emitter.writer.indent(() => {
    emitter.emitNode(schema, "value", rootPath());
    emitter.writer.line("return true;");
  });
  emitter.writer.line("}");
  return emitter;
}

function assembleValidator(
  isEmitter: ValidatorEmitter | undefined,
  parseEmitter: ValidatorEmitter | undefined,
  asyncEmitter: ValidatorEmitter | undefined,
  emitFastParse: boolean,
  maxIssues: number | undefined
): EmittedValidator {
  const emitters = [isEmitter, parseEmitter, asyncEmitter].filter((emitter): emitter is ValidatorEmitter =>
    Boolean(emitter)
  );
  const bindings = (isEmitter ?? asyncEmitter ?? parseEmitter)?.bindings() ?? { names: [], values: [] };
  const helperBlocks = emitters.flatMap((emitter) => emitter.helpers());
  const helperSource = helperBlocks.length > 0 ? `${helperBlocks.join("\n")}\n` : "";
  const functionSource = emitters.map((emitter) => emitter.writer.toString()).join("\n");
  const returnedEntries = [
    ...(isEmitter ? ["is: is"] : []),
    ...(emitFastParse ? ["parse: parse"] : parseEmitter ? ["safeParse: safeParse"] : []),
    ...(asyncEmitter ? ["safeParseAsync: safeParseAsync"] : []),
  ];
  const returned = `return { ${returnedEntries.join(", ")} };`;
  const limitSource = maxIssues === undefined ? "" : "const __issueLimit = {};\n";
  return {
    source: `${limitSource}${helperSource}${functionSource}${functionSource.length > 0 ? "\n" : ""}${returned}`,
    bindings,
  };
}

function emitParseEmitter(
  schema: ATS.AnyTypeSchema,
  recursive: ReadonlySet<ATS.AnyTypeSchema>,
  resolveDefaults: boolean,
  materializeRuntimeTypes: boolean,
  validateChecks: boolean
): ValidatorEmitter {
  const emitter = new ValidatorEmitter(
    "fast",
    false,
    resolveDefaults,
    materializeRuntimeTypes,
    undefined,
    validateChecks
  );
  emitter.markRecursive(recursive);
  emitter.writer.line("function parse(value) {");
  emitter.writer.indent(() => {
    const output = emitter.emitNode(schema, "value", rootPath());
    emitter.writer.line(`return ${output};`);
  });
  emitter.writer.line("}");
  return emitter;
}

function emitDiagnosticEmitter(
  schema: ATS.AnyTypeSchema,
  recursive: ReadonlySet<ATS.AnyTypeSchema>,
  resolveDefaults: boolean,
  materializeRuntimeTypes: boolean,
  validateChecks: boolean,
  maxIssues: number | undefined,
  freezesOutput: boolean,
  sourceEmitter?: ValidatorEmitter,
  awaited = false
): ValidatorEmitter {
  const emitter = new ValidatorEmitter(
    "parse",
    awaited,
    resolveDefaults,
    materializeRuntimeTypes,
    maxIssues,
    validateChecks
  );
  emitter.markRecursive(recursive);
  if (sourceEmitter) for (const value of sourceEmitter.bindings().values) emitter.bind(value);

  emitter.writer.line(`${awaited ? "async " : ""}function ${awaited ? "safeParseAsync" : "safeParse"}(value) {`);
  emitter.writer.indent(() => {
    emitter.writer.line(recursive.size === 0 ? "let issues;" : "let issues = [];");
    if (maxIssues !== undefined) emitter.writer.line("try {");
    const emitBody = () => {
      const output = emitter.emitNode(schema, "value", rootPath());
      emitter.writer.line("if (issues !== undefined) {");
      emitter.writer.indent(() => {
        emitter.writer.line("return { success: false, issues: issues };");
      });
      emitter.writer.line("}");
      if (freezesOutput) emitFreezeOutput(emitter.writer, output);
      emitter.writer.line(`return { success: true, data: ${output} };`);
    };
    if (maxIssues === undefined) emitBody();
    else {
      emitter.writer.indent(emitBody);
      emitter.writer.line("} catch (error) {");
      emitter.writer.indent(() => {
        emitter.writer.line("if (error === __issueLimit) return { success: false, issues: issues };");
        emitter.writer.line("throw error;");
      });
      emitter.writer.line("}");
    }
  });
  emitter.writer.line("}");
  return emitter;
}
