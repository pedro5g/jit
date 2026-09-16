import type * as ATS from "../../core/ats/index.js";
import type { CodeWriter } from "../emitter/code-writer.js";
import { findRecursiveSchemas } from "../schema-recursion.js";
import { type ValidatorBindings, ValidatorEmitter } from "./emit-validate.js";
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
  const emitIs = options.is ?? true;
  const emitSafeParse = options.safeParse ?? true;
  const emitSafeParseAsync = options.safeParseAsync ?? true;
  const emitFastParse = options.fastParse ?? false;
  const resolveDefaults = options.resolveDefaults ?? true;
  const materializeRuntimeTypes = options.materializeRuntimeTypes ?? true;
  const validateChecks = options.validateChecks ?? true;
  const maxIssues = options.maxIssues;
  const freezesOutput = rootHasReadonly(schema);
  const recursive = findRecursiveSchemas(schema);
  let parseEmitter: ValidatorEmitter | undefined;

  if (emitFastParse)
    parseEmitter = emitParseEmitter(schema, recursive, resolveDefaults, materializeRuntimeTypes, validateChecks);
  if (emitSafeParse && !emitFastParse) {
    parseEmitter = emitDiagnosticEmitter(
      schema,
      recursive,
      resolveDefaults,
      materializeRuntimeTypes,
      validateChecks,
      maxIssues,
      freezesOutput
    );
  }

  let asyncEmitter: ValidatorEmitter | undefined;
  if (emitSafeParseAsync && !emitFastParse && containsPromise(schema)) {
    asyncEmitter = emitDiagnosticEmitter(
      schema,
      recursive,
      resolveDefaults,
      materializeRuntimeTypes,
      validateChecks,
      maxIssues,
      freezesOutput,
      parseEmitter,
      true
    );
  }

  let isEmitter: ValidatorEmitter | undefined;
  if (emitIs && !emitFastParse) {
    isEmitter = new ValidatorEmitter("is", false, resolveDefaults, materializeRuntimeTypes, undefined, validateChecks);
    isEmitter.markRecursive(recursive);
    for (const value of (asyncEmitter ?? parseEmitter)?.bindings().values ?? []) isEmitter.bind(value);
    isEmitter.writer.line("function is(value) {");
    isEmitter.writer.indent(() => {
      isEmitter?.emitNode(schema, "value", rootPath());
      isEmitter?.writer.line("return true;");
    });
    isEmitter.writer.line("}");
  }

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
  const source = `${limitSource}${helperSource}${functionSource}${functionSource.length > 0 ? "\n" : ""}${returned}`;

  return { source, bindings };
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
