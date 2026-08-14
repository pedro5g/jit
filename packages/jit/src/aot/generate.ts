import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { emitCloneSource } from "../compiler/clone.js";
import { emitCodec } from "../compiler/codec/emit-codec.js";
import { emitDiffSource } from "../compiler/diff.js";
import { emitEqualSource } from "../compiler/equal.js";
import type { ExecutionPlan, ExecutionStage } from "../compiler/execution-plan.js";
import { emitFormatSource } from "../compiler/format.js";
import { emitHashSource } from "../compiler/hash.js";
import { buildMapperPlan, type MapperOverridesInput } from "../compiler/mapper/build-mapper-plan.js";
import { emitMapperSource } from "../compiler/mapper.js";
import { emitMaskSource } from "../compiler/mask.js";
import { emitTransformSource } from "../compiler/object-ops.js";
import { emitQuerySource } from "../compiler/query.js";
import { emitSanitizeSource, sanitizeChainBindings } from "../compiler/sanitize.js";
import { emitSerialize } from "../compiler/serialize/emit-serialize.js";
import { emitUpdateSource } from "../compiler/update.js";
import { canUseFastParse, emitValidator } from "../compiler/validate/emit-validate.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { type CompiledArtifact, getArtifact } from "../runtime/artifact-registry.js";
import { isValidIdentifier } from "../shared/parse.js";
import { emitTypeScriptType } from "./emit-type.js";

/** One schema operation skipped by the generator and why. */
export interface SkippedOperation {
  readonly schema: string;
  readonly operation: string;
  readonly reason: string;
}

export const AOT_OPERATIONS = [
  "is",
  "parse",
  "safeParse",
  "hash",
  "equal",
  "clone",
  "diff",
  "stringify",
  "fromJSON",
  "format",
  "mask",
  "sanitize",
  "codec",
] as const;

export type AotOperation = (typeof AOT_OPERATIONS)[number];
export type AotOutputFormat = "typescript" | "javascript";

export interface GenerateOptions {
  /** Exported name -> object-style `JIT.compile(schema, { ... })` markers. */
  readonly schemas: Readonly<Record<string, SchemaInput>>;
  /** Exported raw schemas emitted only as structural type aliases. */
  readonly typeSchemas?: Readonly<Record<string, SchemaInput>>;
  /** Exported name -> standalone compiled functions/objects. */
  readonly functions?: Readonly<Record<string, unknown>>;
  /** Output directory. Generated code is always one self-contained ESM module. */
  readonly outDir: string;
  /** Package namespace used when `outDir` is inside `node_modules`. */
  readonly packageName?: string;
  /** Remove known generated files before writing; defaults to true. */
  readonly clean?: boolean;
  /**
   * Source format. TypeScript keeps public signatures in the executable
   * source itself; JavaScript emits ready-to-run ESM without declarations.
   * The low-level API defaults to JavaScript while CLI/config defaults to
   * TypeScript.
   */
  readonly format?: AotOutputFormat;
  /**
   * Schema/export name → declaration file it was loaded from. Used for
   * deterministic subpath grouping and precise callback-artifact types that
   * cannot be reconstructed from runtime metadata.
   */
  readonly sources?: ReadonlyMap<string, string>;
  /** Optional supplementary artifacts. The root module is always emitted. */
  readonly emit?: GenerateEmitOptions;
}

export interface GenerateEmitOptions {
  /** Emit per-declaration subpath modules as `.js` or `.ts`. */
  readonly subpathModules?: boolean;
  /** Emit deterministic `manifest.json`; defaults to false. */
  readonly manifest?: boolean;
  /** Emit deterministic `plans/*.json`; defaults to false. */
  readonly plans?: boolean;
}

export interface GenerateResult {
  readonly files: readonly string[];
  readonly skipped: readonly SkippedOperation[];
}

interface GenerateContext {
  readonly entryName: string;
  readonly root: boolean;
}

/**
 * Prisma-style AOT generation: turns schemas into one optimized `.js` or
 * directly typed `.ts` module written to a directory the app imports. The
 * generated module is fully self-contained — the few tiny runtime helpers
 * a strategy may need (validation error class, keyed-index cache) are
 * inlined into the file, so it has zero imports: no engine weight, no
 * module graph to load on cold start, CSP-safe.
 *
 * Standalone compiled functions are emitted with the exact export name the
 * developer declared (`export const User_is = ...` -> `User_is`). Object-style
 * `JIT.compile(schema, { ... })` markers emit only the grouped object
 * (`User.is`, `User.parse`, ...). Raw schemas do not generate anything by
 * themselves.
 */
export function generate(options: GenerateOptions): GenerateResult {
  return generateModule(options, { entryName: "index", root: true });
}

function generateModule(options: GenerateOptions, context: GenerateContext): GenerateResult {
  const layout = resolveOutputLayout(
    options.outDir,
    options.packageName,
    assertOutputFormat(options.format ?? "javascript")
  );
  const skipped: SkippedOperation[] = [];
  const js: string[] = [];
  const tsTypes: string[] = [];
  const exportNames: string[] = [];
  const typeNames = new Map<ATS.AnyTypeSchema, string>();
  const publicNames = new Set([...Object.keys(options.schemas), ...Object.keys(options.functions ?? {})]);
  const internalNames = new Set<string>();
  let needsRuntimeGetIndex = false;
  let needsValidationError = false;
  let needsHashHelpers = false;

  js.push("// Generated by jit — do not edit.");
  if (layout.format === "typescript") {
    js.push("// @ts-nocheck -- generated internals are typed at the public export boundary.");
  }
  for (const [name, input] of Object.entries(options.typeSchemas ?? {})) {
    if (!isValidIdentifier(name) || name in options.schemas || name in (options.functions ?? {})) continue;
    const schema = unwrapSchema(input as SchemaInput<ATS.AnyTypeSchema>);
    const valueType = `export type ${name} = ${emitTypeScriptType(schema)};`;
    const strictType = `export type ${name}Strict<TValue> = TValue;`;

    typeNames.set(schema, name);
    tsTypes.push(valueType, strictType);
  }

  for (const name of Object.keys(options.schemas)) {
    if (readAotExportMode(options.schemas[name]) !== "grouped") {
      skipped.push({
        schema: name,
        operation: "schema",
        reason:
          "raw schemas and array-style compile markers do not emit AOT output; export compiled functions or use JIT.compile(schema, { ... })",
      });
      continue;
    }

    const schema = unwrapSchema(options.schemas[name] as SchemaInput<ATS.AnyTypeSchema>);
    const operations: {
      readonly prop: string;
      readonly type: string;
      readonly binding: string;
    }[] = [];
    const sourceFile = options.sources?.get(name);
    // Object-style `JIT.compile(schema, { ... })` markers restrict generation
    // to the compiled functions the developer explicitly put on that object.
    const requested = readRequestedOps(options.schemas[name]);
    const wants = (op: string): boolean => requested === undefined || requested.includes(op);

    if (requested) {
      for (const op of requested) {
        if (!AOT_OPS.has(op)) {
          skipped.push({
            schema: name,
            operation: op,
            reason: "runtime-only operation (not generated ahead of time)",
          });
        }
      }
    }

    const valueType = `export type ${name} = ${emitTypeScriptType(schema)};`;
    const strictType = `export type ${name}Strict<TValue> = TValue;`;

    tsTypes.push(valueType, strictType);

    // is / parse / safeParse
    const wantsValidator = wants("is") || wants("parse") || wants("safeParse") || wants("fromJSON");
    const fastParse = canUseFastParse(schema);
    const wantsFastParse = fastParse && (wants("parse") || wants("fromJSON"));
    const validator = wantsValidator
      ? tryEmit(name, "validator", skipped, () =>
          emitValidator(schema, {
            is: wants("is") || wantsFastParse,
            safeParse: wants("safeParse") || wants("parse") || wants("fromJSON"),
            safeParseAsync: false,
          })
        )
      : undefined;

    if (validator) {
      const inlined = inlineBindings(validator.bindings.names, validator.bindings.values);

      if (inlined === undefined) {
        skipped.push({
          schema: name,
          operation: "validator",
          reason: "refine/transform/default callbacks cannot be serialized ahead of time",
        });
      } else {
        const validatorName = internalIdentifier(`${name}_validator`);

        js.push(`const ${validatorName} = /*#__PURE__*/ (() => {`);
        js.push(...inlined.map((line) => `  ${line}`));
        js.push(...indentBlock(validator.source));
        js.push("})();");
        if (wants("is")) {
          const binding = internalIdentifier(`${name}_is`);
          // Pure-call accessors (not property reads) so bundlers can drop
          // each function — and the validator itself — when unused.
          js.push(`const ${binding} = /*#__PURE__*/ ((v) => v.is)(${validatorName});`);
          operations.push({
            prop: "is",
            type: `(value: unknown) => value is ${name}`,
            binding,
          });
        }
        if (wants("safeParse")) {
          const binding = internalIdentifier(`${name}_safeParse`);

          js.push(`const ${binding} = /*#__PURE__*/ ((v) => v.safeParse)(${validatorName});`);
          operations.push({
            prop: "safeParse",
            type: `(value: unknown) => { readonly success: true; readonly data: ${name} } | { readonly success: false; readonly issues: readonly { readonly path: string; readonly code: string; readonly expected: string; readonly message: string; readonly received?: string }[] }`,
            binding,
          });
        }
        if (wants("parse") || wants("fromJSON")) {
          needsValidationError = true;
          if (wants("parse")) {
            const parseBinding = internalIdentifier(`${name}_parse`);

            js.push(
              fastParse
                ? `const ${parseBinding} = (value) => { if (${validatorName}.is(value)) return value; const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
                : `const ${parseBinding} = (value) => { const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
            );
            operations.push({
              prop: "parse",
              type: `(value: unknown) => ${name}`,
              binding: parseBinding,
            });
          }
          if (wants("fromJSON")) {
            const binding = internalIdentifier(`${name}_fromJSON`);
            js.push(
              fastParse
                ? `const ${binding} = (json) => { const value = JSON.parse(json); if (${validatorName}.is(value)) return value; const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
                : `const ${binding} = (json) => { const r = ${validatorName}.safeParse(JSON.parse(json)); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
            );
            operations.push({
              prop: "fromJSON",
              type: `(json: string) => ${name}`,
              binding,
            });
          }
        }
      }
    }

    // equal source first: it decides whether hash helpers are required.
    const equalSource = wants("equal") ? tryEmit(name, "equal", skipped, () => emitEqualSource(schema)) : undefined;
    const equalNeedsHash = equalSource?.includes("__hash");

    // hash (also powers hash-short-circuit equal)
    const hashSource =
      wants("hash") || equalNeedsHash ? tryEmit(name, "hash", skipped, () => emitHashSource(schema)) : undefined;
    let hashBinding: string | undefined;

    if (hashSource) {
      needsHashHelpers = true;
      hashBinding = internalIdentifier(`${name}_hash`);
      js.push(`const ${hashBinding} = /*#__PURE__*/ (() => {`);
      js.push(...indentBlock(`const compute = (${hashSource});`));
      js.push("  return (value) => {");
      js.push('    if ((typeof value === "object" && value !== null) || typeof value === "function") {');
      js.push("      const cached = __hashCache.get(value);");
      js.push("      if (cached !== undefined) return cached;");
      js.push("      const hash = compute(value);");
      js.push("      __hashCache.set(value, hash);");
      js.push("      return hash;");
      js.push("    }");
      js.push("    return compute(value);");
      js.push("  };");
      js.push("})();");
      if (wants("hash"))
        operations.push({
          prop: "hash",
          type: `(value: ${name}) => number`,
          binding: hashBinding,
        });
    }

    // equal
    if (equalSource) {
      const needsHash = equalSource.includes("__hash");
      const needsIndex = equalSource.includes("__getIndex");

      if (needsHash && !hashSource) {
        skipped.push({
          schema: name,
          operation: "equal",
          reason: "hash short-circuit hints need an emittable hash",
        });
      } else {
        if (needsIndex) needsRuntimeGetIndex = true;
        const binding = internalIdentifier(`${name}_equal`);

        if (needsHash) {
          js.push(`const ${binding} = /*#__PURE__*/ ((__hash) => (${equalSource}))(${hashBinding});`);
        } else {
          js.push(`const ${binding} = (${equalSource});`);
        }
        operations.push({
          prop: "equal",
          type: `(left: ${name}, right: ${name}) => boolean`,
          binding,
        });
      }
    }

    // clone
    const cloneSource = wants("clone") ? tryEmit(name, "clone", skipped, () => emitCloneSource(schema)) : undefined;

    if (cloneSource) {
      const binding = internalIdentifier(`${name}_clone`);

      js.push(`const ${binding} = (${cloneSource});`);
      operations.push({
        prop: "clone",
        type: `(value: ${name}) => ${name}`,
        binding,
      });
    }

    // diff
    const diffSource = wants("diff") ? tryEmit(name, "diff", skipped, () => emitDiffSource(schema)) : undefined;

    if (diffSource) {
      const binding = internalIdentifier(`${name}_diff`);

      js.push(`const ${binding} = (${diffSource});`);
      operations.push({
        prop: "diff",
        type: `(left: ${name}, right: ${name}) => readonly { readonly type: "add" | "remove" | "update"; readonly path: readonly PropertyKey[]; readonly value?: unknown }[]`,
        binding,
      });
    }

    // stringify
    const serializeSource = wants("stringify")
      ? tryEmit(name, "stringify", skipped, () => emitSerialize(schema))
      : undefined;

    if (serializeSource) {
      const binding = internalIdentifier(`${name}_stringify`);

      js.push(`const ${binding} = (${serializeSource});`);
      operations.push({
        prop: "stringify",
        type: `(value: ${name}) => string`,
        binding,
      });
    }

    // format
    const formatSource = wants("format") ? tryEmit(name, "format", skipped, () => emitFormatSource(schema)) : undefined;

    if (formatSource) {
      const binding = internalIdentifier(`${name}_format`);

      js.push(`const ${binding} = (${formatSource});`);
      operations.push({
        prop: "format",
        type: `(value: string) => string`,
        binding,
      });
    }

    // mask
    const maskSource = wants("mask") ? tryEmit(name, "mask", skipped, () => emitMaskSource(schema)) : undefined;

    if (maskSource) {
      const binding = internalIdentifier(`${name}_mask`);

      js.push(`const ${binding} = (${maskSource});`);
      operations.push({
        prop: "mask",
        type: `(value: ${name}) => ${name}`,
        binding,
      });
    }

    // sanitize
    const sanitizeSource = wants("sanitize")
      ? tryEmit(name, "sanitize", skipped, () => emitSanitizeSource(schema))
      : undefined;

    if (sanitizeSource) {
      const regexConsts = sanitizeChainBindings.names.map(
        (bindingName, position) => `const ${bindingName} = ${String(sanitizeChainBindings.values[position])};`
      );
      const binding = internalIdentifier(`${name}_sanitize`);

      js.push(`const ${binding} = /*#__PURE__*/ (() => {`);
      js.push(...regexConsts.map((line) => `  ${line}`));
      js.push(...indentBlock(`return (${sanitizeSource});`));
      js.push("})();");
      operations.push({
        prop: "sanitize",
        type: `(value: ${name}) => ${name}`,
        binding,
      });
    }

    // codec
    const codec = wants("codec") ? tryEmit(name, "codec", skipped, () => emitCodec(schema)) : undefined;

    if (codec) {
      const inlined = inlineCodecBindings(codec.bindingNames, codec.bindingValues);

      if (inlined === undefined) {
        skipped.push({
          schema: name,
          operation: "codec",
          reason: "codec bindings cannot be serialized",
        });
      } else {
        const binding = internalIdentifier(`${name}_codec`);

        js.push(`const ${binding} = /*#__PURE__*/ (() => {`);
        js.push(...inlined.map((line) => `  ${line}`));
        js.push(...indentBlock(codec.source));
        js.push("})();");
        operations.push({
          prop: "codec",
          type: `{ readonly encode: (value: ${name}) => Uint8Array; readonly encodeInto: (value: ${name}, target: Uint8Array) => number; readonly decode: (bytes: Uint8Array | ArrayBuffer) => ${name} }`,
          binding,
        });
      }
    }

    // Dev-defined source artifacts (queries, mappers, watchers) aggregated
    // through JIT.compile are re-emitted from registered source + bindings.
    for (const extraName of readExtraNames(options.schemas[name])) {
      const artifact = getArtifact((options.schemas[name] as Record<string, unknown>)[extraName]);

      if (!artifact) {
        skipped.push({
          schema: name,
          operation: extraName,
          reason: "extra is not a registered compiled source artifact",
        });
        continue;
      }

      if (artifact.kind === "validator") {
        skipped.push({
          schema: name,
          operation: extraName,
          reason: "validator functions must be compiled on the object or exported as standalone AOT functions",
        });
        continue;
      }

      if (artifact.kind === "operation") {
        skipped.push({
          schema: name,
          operation: extraName,
          reason: "operation functions must be compiled on the object or exported as standalone AOT functions",
        });
        continue;
      }

      if (artifact.kind === "execution") {
        const binding = internalIdentifier(`${name}_${extraName}`);
        const before = js.length;

        emitExecutionArtifact(binding, artifact.plan, undefined, false);
        const declaration = js
          .slice(before)
          .some((line) =>
            layout.format === "typescript"
              ? line.startsWith(`const ${binding}:`)
              : line.startsWith(`const ${binding} =`)
          );
        if (!declaration) continue;

        const extraType = sourceFile
          ? `typeof import(${JSON.stringify(typeImportSpecifier(options.outDir, sourceFile))}).${name}[${JSON.stringify(extraName)}]`
          : executionPlanType(artifact.plan, typeNames.get(artifact.plan.schema));

        operations.push({ prop: extraName, type: extraType, binding });
        continue;
      }

      const inlined = inlineBindings(artifact.bindingNames, artifact.bindingValues);

      if (inlined === undefined) {
        skipped.push({
          schema: name,
          operation: extraName,
          reason: `${artifact.kind} bindings hold callbacks that cannot be serialized ahead of time`,
        });
        continue;
      }

      const binding = internalIdentifier(`${name}_${extraName}`);

      js.push(`const ${binding} = /*#__PURE__*/ (() => {`);
      js.push(...inlined.map((line) => `  ${line}`));
      js.push(`  return (${artifact.source});`);
      js.push("})();");

      const extraType = sourceFile
        ? `typeof import(${JSON.stringify(typeImportSpecifier(options.outDir, sourceFile))}).${name}[${JSON.stringify(extraName)}]`
        : "unknown";

      operations.push({ prop: extraName, type: extraType, binding });
    }

    if (operations.length === 0) {
      skipped.push({
        schema: name,
        operation: "schema",
        reason: "no buildable AOT functions were selected for this grouped export",
      });
      continue;
    }

    if (layout.format === "typescript") {
      js.push(`const ${name}: {`);
      js.push(...operations.map((operation) => `  readonly ${operation.prop}: ${operation.type};`));
      js.push("} = /*#__PURE__*/ Object.freeze({");
    } else {
      js.push(`const ${name} = /*#__PURE__*/ Object.freeze({`);
    }
    js.push(...operations.map((operation) => `  ${operation.prop}: ${operation.binding},`));
    js.push("});");
    js.push("");
    exportNames.push(name);
  }

  for (const name of Object.keys(options.functions ?? {})) {
    emitStandaloneArtifact(name, options.functions?.[name], options.sources?.get(name));
  }

  function emitStandaloneArtifact(name: string, value: unknown, sourceFile: string | undefined): void {
    if (!isValidIdentifier(name)) {
      skipped.push({
        schema: name,
        operation: "export",
        reason: "standalone AOT export names must be valid JavaScript identifiers",
      });
      return;
    }

    if (name in options.schemas) {
      skipped.push({
        schema: name,
        operation: "export",
        reason: "standalone AOT export name collides with a grouped export",
      });
      return;
    }

    const artifact = getArtifact(value);

    if (!artifact) {
      skipped.push({
        schema: name,
        operation: "export",
        reason: "export is not a registered compiled JIT function",
      });
      return;
    }

    const declaredType =
      artifact.kind === "validator"
        ? standaloneType(artifact, typeNames.get(artifact.schema))
        : artifact.kind === "operation"
          ? operationType(artifact, typeNames.get(artifact.schema))
          : sourceFile
            ? `typeof import(${JSON.stringify(typeImportSpecifier(options.outDir, sourceFile))}).${name}`
            : "unknown";
    const declaration = `const ${name}${layout.format === "typescript" ? `: ${declaredType}` : ""} =`;

    if (artifact.kind === "validator") {
      if (artifact.op === "parseAsync" || artifact.op === "safeParseAsync") {
        skipped.push({
          schema: name,
          operation: artifact.op,
          reason: "async validator functions are runtime-only in AOT output",
        });
        return;
      }

      const fastParse = artifact.op === "parse" && canUseFastParse(artifact.schema);
      const validator = tryEmit(name, artifact.op, skipped, () =>
        emitValidator(artifact.schema, {
          is: artifact.op === "is" || fastParse,
          safeParse: artifact.op === "safeParse" || artifact.op === "parse",
          safeParseAsync: false,
        })
      );

      if (!validator) return;

      const inlined = inlineBindings(validator.bindings.names, validator.bindings.values);

      if (inlined === undefined) {
        skipped.push({
          schema: name,
          operation: artifact.op,
          reason: "refine/transform/default callbacks cannot be serialized ahead of time",
        });
        return;
      }

      const validatorName = internalIdentifier(`${name}_validator`);

      js.push(`const ${validatorName} = /*#__PURE__*/ (() => {`);
      js.push(...inlined.map((line) => `  ${line}`));
      js.push(...indentBlock(validator.source));
      js.push("})();");

      if (artifact.op === "is") {
        js.push(`${declaration} /*#__PURE__*/ ((v) => v.is)(${validatorName});`);
      } else if (artifact.op === "safeParse") {
        js.push(`${declaration} /*#__PURE__*/ ((v) => v.safeParse)(${validatorName});`);
      } else {
        needsValidationError = true;
        js.push(
          fastParse
            ? `${declaration} (value) => { if (${validatorName}.is(value)) return value; const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
            : `${declaration} (value) => { const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
        );
      }

      exportNames.push(name);
      return;
    }

    if (artifact.kind === "operation") {
      const schema = artifact.schema;
      const op = artifact.op;

      if (op === "hash") {
        const hashSource = tryEmit(name, "hash", skipped, () => emitHashSource(schema));

        if (!hashSource) return;

        needsHashHelpers = true;
        js.push(`${declaration} /*#__PURE__*/ (() => {`);
        js.push(...indentBlock(`const compute = (${hashSource});`));
        js.push("  return (value) => {");
        js.push('    if ((typeof value === "object" && value !== null) || typeof value === "function") {');
        js.push("      const cached = __hashCache.get(value);");
        js.push("      if (cached !== undefined) return cached;");
        js.push("      const hash = compute(value);");
        js.push("      __hashCache.set(value, hash);");
        js.push("      return hash;");
        js.push("    }");
        js.push("    return compute(value);");
        js.push("  };");
        js.push("})();");
      } else if (op === "equal") {
        const equalSource = tryEmit(name, "equal", skipped, () => emitEqualSource(schema));

        if (!equalSource) return;

        const needsHash = equalSource.includes("__hash");
        const needsIndex = equalSource.includes("__getIndex");

        if (needsIndex) needsRuntimeGetIndex = true;
        if (needsHash) {
          const hashSource = tryEmit(name, "hash", skipped, () => emitHashSource(schema));

          if (!hashSource) return;

          needsHashHelpers = true;
          const hashBinding = internalIdentifier(`${name}_hash`);

          js.push(`const ${hashBinding} = /*#__PURE__*/ (() => {`);
          js.push(...indentBlock(`const compute = (${hashSource});`));
          js.push("  return (value) => {");
          js.push('    if ((typeof value === "object" && value !== null) || typeof value === "function") {');
          js.push("      const cached = __hashCache.get(value);");
          js.push("      if (cached !== undefined) return cached;");
          js.push("      const hash = compute(value);");
          js.push("      __hashCache.set(value, hash);");
          js.push("      return hash;");
          js.push("    }");
          js.push("    return compute(value);");
          js.push("  };");
          js.push("})();");
          js.push(`${declaration} /*#__PURE__*/ ((__hash) => (${equalSource}))(${hashBinding});`);
        } else {
          js.push(`${declaration} (${equalSource});`);
        }
      } else if (op === "clone") {
        const cloneSource = tryEmit(name, "clone", skipped, () => emitCloneSource(schema));

        if (!cloneSource) return;
        js.push(`${declaration} (${cloneSource});`);
      } else if (op === "diff") {
        const diffSource = tryEmit(name, "diff", skipped, () => emitDiffSource(schema));

        if (!diffSource) return;
        js.push(`${declaration} (${diffSource});`);
      } else if (op === "stringify") {
        const serializeSource = tryEmit(name, "stringify", skipped, () => emitSerialize(schema));

        if (!serializeSource) return;
        js.push(`${declaration} (${serializeSource});`);
      } else if (op === "fromJSON") {
        const fastParse = canUseFastParse(schema);
        const validator = tryEmit(name, "fromJSON", skipped, () =>
          emitValidator(schema, { is: fastParse, safeParse: true, safeParseAsync: false })
        );

        if (!validator) return;

        const inlined = inlineBindings(validator.bindings.names, validator.bindings.values);

        if (inlined === undefined) {
          skipped.push({
            schema: name,
            operation: "fromJSON",
            reason: "refine/transform/default callbacks cannot be serialized ahead of time",
          });
          return;
        }

        needsValidationError = true;
        const validatorName = internalIdentifier(`${name}_validator`);

        js.push(`const ${validatorName} = /*#__PURE__*/ (() => {`);
        js.push(...inlined.map((line) => `  ${line}`));
        js.push(...indentBlock(validator.source));
        js.push("})();");
        js.push(
          fastParse
            ? `${declaration} (json) => { const value = JSON.parse(json); if (${validatorName}.is(value)) return value; const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
            : `${declaration} (json) => { const r = ${validatorName}.safeParse(JSON.parse(json)); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
        );
      } else if (op === "format") {
        const formatSource = tryEmit(name, "format", skipped, () => emitFormatSource(schema));

        if (!formatSource) return;
        js.push(`${declaration} (${formatSource});`);
      } else if (op === "mask") {
        const maskSource = tryEmit(name, "mask", skipped, () => emitMaskSource(schema));

        if (!maskSource) return;
        js.push(`${declaration} (${maskSource});`);
      } else if (op === "sanitize") {
        const sanitizeSource = tryEmit(name, "sanitize", skipped, () => emitSanitizeSource(schema));

        if (!sanitizeSource) return;

        const regexConsts = sanitizeChainBindings.names.map(
          (bindingName, position) => `const ${bindingName} = ${String(sanitizeChainBindings.values[position])};`
        );

        js.push(`${declaration} /*#__PURE__*/ (() => {`);
        js.push(...regexConsts.map((line) => `  ${line}`));
        js.push(...indentBlock(`return (${sanitizeSource});`));
        js.push("})();");
      } else {
        const codec = tryEmit(name, "codec", skipped, () => emitCodec(schema));

        if (!codec) return;

        const inlined = inlineCodecBindings(codec.bindingNames, codec.bindingValues);

        if (inlined === undefined) {
          skipped.push({
            schema: name,
            operation: "codec",
            reason: "codec bindings cannot be serialized",
          });
          return;
        }

        js.push(`${declaration} /*#__PURE__*/ (() => {`);
        js.push(...inlined.map((line) => `  ${line}`));
        js.push(...indentBlock(codec.source));
        js.push("})();");
      }

      exportNames.push(name);
      return;
    }

    if (artifact.kind === "execution") {
      emitExecutionArtifact(name, artifact.plan, sourceFile);
      return;
    }

    const inlined = inlineBindings(artifact.bindingNames, artifact.bindingValues);

    if (inlined === undefined) {
      skipped.push({
        schema: name,
        operation: artifact.kind,
        reason: `${artifact.kind} bindings hold callbacks that cannot be serialized ahead of time`,
      });
      return;
    }

    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...inlined.map((line) => `  ${line}`));
    js.push(`  return (${artifact.source});`);
    js.push("})();");

    exportNames.push(name);
  }

  function emitExecutionArtifact(
    name: string,
    plan: ExecutionPlan,
    sourceFile: string | undefined,
    exportArtifact = true
  ): void {
    void sourceFile;
    const declaredType = executionPlanType(plan, typeNames.get(plan.schema));
    const declaration = `const ${name}${layout.format === "typescript" ? `: ${declaredType}` : ""} =`;
    const stages = plan.stages;
    const validateStage = stages.find((stage) => stage.kind === "validate");
    const hasJsonDecode = stages.some((stage) => stage.kind === "json.decode");
    const hasBinaryDecode = stages.some((stage) => stage.kind === "binary.decode");
    const hasJsonEncode = stages.some((stage) => stage.kind === "json.encode");
    const hasBinaryEncode = stages.some((stage) => stage.kind === "binary.encode");
    const operationStage = stages.find((stage) => stage.kind === "operation");
    const mapStage = stages.find((stage) => stage.kind === "map");

    if (stages.some((stage) => isComposedExecutionStage(stage))) {
      emitComposedExecutionArtifact(name, plan, declaration, exportArtifact);
      return;
    }

    if (mapStage?.kind === "map") {
      const mapping = mapStage.bindings[0];
      if (mapping === null || typeof mapping !== "object" || Array.isArray(mapping)) {
        skipped.push({
          schema: name,
          operation: "map",
          reason: "mapping descriptor is malformed",
        });
        return;
      }
      const mapperPlan = tryEmit(name, "map", skipped, () =>
        buildMapperPlan(mapStage.source, mapStage.target, mapping as MapperOverridesInput)
      );
      if (!mapperPlan) return;
      const inlined = inlineBindings(mapperPlan.bindingNames, mapperPlan.bindings);
      if (inlined === undefined) {
        skipped.push({
          schema: name,
          operation: "map",
          reason: "mapping callbacks cannot be serialized ahead of time",
        });
        return;
      }
      const mapperSource = tryEmit(name, "map", skipped, () =>
        emitMapperSource(mapStage.source, mapStage.target, mapping as MapperOverridesInput, [
          mapStage.many ? "many" : "map",
        ])
      );
      if (!mapperSource) return;
      const method = mapStage.many ? "many" : "map";

      if (hasJsonEncode) {
        const serializeSource = tryEmit(name, "json.encode", skipped, () => emitSerialize(plan.schema));
        if (!serializeSource) return;
        js.push(
          `${declaration} /*#__PURE__*/ ((mapper, stringify) => (value) => stringify(mapper.${method}(value)))((() => {`
        );
        js.push(...inlined.map((line) => `  ${line}`));
        js.push(...indentBlock(`return (${mapperSource});`));
        js.push(`})()), (${serializeSource}));`);
      } else {
        js.push(`${declaration} /*#__PURE__*/ ((mapper) => mapper.${method})((() => {`);
        js.push(...inlined.map((line) => `  ${line}`));
        js.push(...indentBlock(`return (${mapperSource});`));
        js.push("})());");
      }

      if (exportArtifact) {
        exportNames.push(name);
      }
      return;
    }

    if (validateStage?.kind === "validate") {
      if (
        validateStage.operation === "issues" ||
        validateStage.operation === "parseAsync" ||
        validateStage.operation === "safeParseAsync"
      ) {
        skipped.push({
          schema: name,
          operation: validateStage.operation,
          reason: "this validation sink is runtime-only in AOT output",
        });
        return;
      }

      const fastParse = validateStage.operation === "parse" && canUseFastParse(plan.schema);
      const validator = tryEmit(name, validateStage.operation, skipped, () =>
        emitValidator(plan.schema, {
          is: validateStage.operation === "is" || fastParse,
          safeParse: validateStage.operation !== "is",
          safeParseAsync: false,
        })
      );
      if (!validator) return;

      const inlined = inlineBindings(validator.bindings.names, validator.bindings.values);
      if (inlined === undefined) {
        skipped.push({
          schema: name,
          operation: validateStage.operation,
          reason: "refine/transform/default callbacks cannot be serialized ahead of time",
        });
        return;
      }

      const validatorName = internalIdentifier(`${name}_validator`);
      js.push(`const ${validatorName} = /*#__PURE__*/ (() => {`);
      js.push(...inlined.map((line) => `  ${line}`));
      js.push(...indentBlock(validator.source));
      js.push("})();");

      if (validateStage.operation === "is") {
        if (hasJsonDecode || hasBinaryDecode) {
          skipped.push({
            schema: name,
            operation: "is",
            reason: "is must receive a value source in AOT output",
          });
          return;
        }
        js.push(`${declaration} /*#__PURE__*/ ((v) => v.is)(${validatorName});`);
      } else if (validateStage.operation === "safeParse") {
        if (hasJsonDecode || hasBinaryDecode) {
          skipped.push({
            schema: name,
            operation: "safeParse",
            reason: "safeParse source composition is not an AOT sink",
          });
          return;
        }
        js.push(`${declaration} /*#__PURE__*/ ((v) => v.safeParse)(${validatorName});`);
      } else if (hasJsonDecode) {
        needsValidationError = true;
        js.push(
          fastParse
            ? `${declaration} (json) => { const value = JSON.parse(json); if (${validatorName}.is(value)) return value; const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
            : `${declaration} (json) => { const r = ${validatorName}.safeParse(JSON.parse(json)); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
        );
      } else if (hasBinaryDecode) {
        const codec = tryEmit(name, "binary.decode", skipped, () => emitCodec(plan.schema));
        if (!codec) return;
        const codecBindings = inlineCodecBindings(codec.bindingNames, codec.bindingValues);
        if (codecBindings === undefined) {
          skipped.push({
            schema: name,
            operation: "binary.decode",
            reason: "codec bindings cannot be serialized",
          });
          return;
        }
        needsValidationError = true;
        js.push(
          fastParse
            ? `${declaration} /*#__PURE__*/ ((codec, is, safeParse) => (bytes) => { const value = codec.decode(bytes); if (is(value)) return value; const r = safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); })((() => {`
            : `${declaration} /*#__PURE__*/ ((codec, safeParse) => (bytes) => { const r = safeParse(codec.decode(bytes)); if (r.success) return r.data; throw new JITValidationError(r.issues); })((() => {`
        );
        js.push(...codecBindings.map((line) => `  ${line}`));
        js.push(...indentBlock(codec.source));
        js.push(
          fastParse ? `})()), ${validatorName}.is, ${validatorName}.safeParse);` : `})()), ${validatorName}.safeParse);`
        );
      } else {
        needsValidationError = true;
        js.push(
          fastParse
            ? `${declaration} (value) => { if (${validatorName}.is(value)) return value; const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
            : `${declaration} (value) => { const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
        );
      }

      if (exportArtifact) {
        exportNames.push(name);
      }
      return;
    }

    if (hasJsonDecode) {
      js.push(`${declaration} JSON.parse;`);
    } else if (hasJsonEncode) {
      const source = tryEmit(name, "json.encode", skipped, () => emitSerialize(plan.schema));
      if (!source) return;
      js.push(`${declaration} (${source});`);
    } else if (hasBinaryDecode || hasBinaryEncode) {
      const codec = tryEmit(name, hasBinaryDecode ? "binary.decode" : "binary.encode", skipped, () =>
        emitCodec(plan.schema)
      );
      if (!codec) return;
      const inlined = inlineCodecBindings(codec.bindingNames, codec.bindingValues);
      if (inlined === undefined) {
        skipped.push({
          schema: name,
          operation: "binary",
          reason: "codec bindings cannot be serialized",
        });
        return;
      }
      const method = hasBinaryDecode ? "decode" : "encode";
      js.push(`${declaration} /*#__PURE__*/ ((codec) => codec.${method})((() => {`);
      js.push(...inlined.map((line) => `  ${line}`));
      js.push(...indentBlock(codec.source));
      js.push("})());");
    } else if (operationStage?.kind === "operation") {
      const source = emitAotOperationSource(operationStage.operation, plan.schema, skipped, name);
      if (source === undefined) return;
      if (operationStage.operation === "sanitize") {
        const regexConsts = sanitizeChainBindings.names.map(
          (bindingName, position) => `const ${bindingName} = ${String(sanitizeChainBindings.values[position])};`
        );
        js.push(`${declaration} /*#__PURE__*/ (() => {`);
        js.push(...regexConsts.map((line) => `  ${line}`));
        js.push(...indentBlock(`return (${source});`));
        js.push("})();");
      } else {
        js.push(`${declaration} (${source});`);
      }
    } else {
      skipped.push({
        schema: name,
        operation: "execution",
        reason: "no AOT backend matches this execution plan",
      });
      return;
    }

    if (exportArtifact) {
      exportNames.push(name);
    }
  }

  /**
   * Lowers a composable execution plan as one generated closure. Consecutive
   * query descriptors share their final declarative program, so a
   * filter/select sequence remains one fused query loop rather than a chain
   * of intermediate arrays. Transform, update and security stages then stay
   * in this same compiled closure in their declared order.
   */
  function emitComposedExecutionArtifact(
    name: string,
    plan: ExecutionPlan,
    declaration: string,
    exportArtifact: boolean
  ): void {
    const setup: string[] = [];
    const body: string[] = ["let value = input;"];
    const stages = plan.stages;

    const emitValidatorBinding = (schema: ATS.AnyTypeSchema): string | undefined => {
      const fastParse = canUseFastParse(schema);
      const validator = tryEmit(name, "validate", skipped, () =>
        emitValidator(schema, {
          is: fastParse,
          safeParse: true,
          safeParseAsync: false,
        })
      );
      if (!validator) return undefined;
      const inlined = inlineBindings(validator.bindings.names, validator.bindings.values);
      if (inlined === undefined) {
        skipped.push({
          schema: name,
          operation: "validate",
          reason: "refine/transform/default callbacks cannot be serialized ahead of time",
        });
        return undefined;
      }
      const binding = internalIdentifier(`${name}_validator`);

      setup.push(`const ${binding} = /*#__PURE__*/ (() => {`);
      setup.push(...inlined.map((line) => `  ${line}`));
      setup.push(...indentBlock(validator.source));
      setup.push("})();");
      return binding;
    };

    const emitCodecBinding = (
      schema: ATS.AnyTypeSchema,
      operation: "binary.decode" | "binary.encode"
    ): string | undefined => {
      const codec = tryEmit(name, operation, skipped, () => emitCodec(schema));
      if (!codec) return undefined;
      const inlined = inlineCodecBindings(codec.bindingNames, codec.bindingValues);
      if (inlined === undefined) {
        skipped.push({
          schema: name,
          operation,
          reason: "codec bindings cannot be serialized",
        });
        return undefined;
      }
      const binding = internalIdentifier(`${name}_codec`);

      setup.push(`const ${binding} = /*#__PURE__*/ (() => {`);
      setup.push(...inlined.map((line) => `  ${line}`));
      setup.push(...indentBlock(codec.source));
      setup.push("})();");
      return binding;
    };

    const emitQueryBinding = (
      stage: Extract<(typeof stages)[number], { readonly kind: "query" }>
    ): string | undefined => {
      const source = tryEmit(name, "query", skipped, () => emitQuerySource(stage.source, stage.program));
      if (!source) return undefined;
      const bindings = inlineBindings(
        stage.program.bindings.map((_, index) => `__q${index}`),
        stage.program.bindings
      );
      if (bindings === undefined) {
        skipped.push({
          schema: name,
          operation: "query",
          reason: "query bindings cannot be serialized ahead of time",
        });
        return undefined;
      }
      const binding = internalIdentifier(`${name}_query`);

      setup.push(`const ${binding} = /*#__PURE__*/ (() => {`);
      setup.push(...bindings.map((line) => `  ${line}`));
      setup.push(...indentBlock(`return (${source});`));
      setup.push("})();");
      return binding;
    };

    const emitMapperBinding = (
      stage: Extract<(typeof stages)[number], { readonly kind: "map" }>,
      operation: "map" | "many" = stage.many ? "many" : "map"
    ): string | undefined => {
      const mapping = stage.bindings[0];
      if (mapping === null || typeof mapping !== "object" || Array.isArray(mapping)) {
        skipped.push({
          schema: name,
          operation: "map",
          reason: "mapping descriptor is malformed",
        });
        return undefined;
      }
      const mapperPlan = tryEmit(name, "map", skipped, () =>
        buildMapperPlan(stage.source, stage.target, mapping as MapperOverridesInput)
      );
      if (!mapperPlan) return undefined;
      const inlined = inlineBindings(mapperPlan.bindingNames, mapperPlan.bindings);
      if (inlined === undefined) {
        skipped.push({
          schema: name,
          operation: "map",
          reason: "mapping callbacks cannot be serialized ahead of time",
        });
        return undefined;
      }
      const source = tryEmit(name, "map", skipped, () =>
        emitMapperSource(stage.source, stage.target, mapping as MapperOverridesInput, [operation])
      );
      if (!source) return undefined;
      const binding = internalIdentifier(`${name}_mapper`);

      setup.push(`const ${binding} = /*#__PURE__*/ (() => {`);
      setup.push(...inlined.map((line) => `  ${line}`));
      setup.push(...indentBlock(`return (${source});`));
      setup.push("})();");
      return binding;
    };

    const emitTransformBinding = (
      stage: Extract<(typeof stages)[number], { readonly kind: "transform" }>
    ): string | undefined => {
      const keys = Object.keys(stage.transforms);
      const callbacks = keys.map((key) => stage.transforms[key]);
      const bindings = inlineBindings(
        keys.map((_, index) => `__t${index}`),
        callbacks
      );
      if (bindings === undefined) {
        skipped.push({
          schema: name,
          operation: "transform",
          reason: "transform callbacks cannot be serialized ahead of time",
        });
        return undefined;
      }
      const source = tryEmit(name, "transform", skipped, () =>
        emitTransformSource(stage.source, stage.transforms as never)
      );
      if (!source) return undefined;
      const binding = internalIdentifier(`${name}_transform`);

      setup.push(`const ${binding} = /*#__PURE__*/ (() => {`);
      setup.push(...bindings.map((line) => `  ${line}`));
      setup.push(...indentBlock(`return (${source});`));
      setup.push("})();");
      return binding;
    };

    const emitUpdateBinding = (
      stage: Extract<(typeof stages)[number], { readonly kind: "update" }>
    ): { readonly update: string; readonly patch: string } | undefined => {
      const patch = serializeStaticData(stage.patch);
      if (patch === undefined) {
        skipped.push({
          schema: name,
          operation: "update",
          reason: "update patches must be serializable static data for AOT output",
        });
        return undefined;
      }
      const source = tryEmit(name, "update", skipped, () => emitUpdateSource(stage.schema));
      if (!source) return undefined;
      const update = internalIdentifier(`${name}_update`);
      const patchName = internalIdentifier(`${name}_patch`);

      setup.push(`const ${update} = (${source});`);
      setup.push(`const ${patchName} = ${patch};`);
      return { update, patch: patchName };
    };

    const emitSecurityBinding = (
      stage: Extract<(typeof stages)[number], { readonly kind: "security" }>
    ): string | undefined => {
      const source = tryEmit(name, stage.operation, skipped, () =>
        stage.operation === "mask" ? emitMaskSource(stage.schema) : emitSanitizeSource(stage.schema)
      );
      if (!source) return undefined;
      const binding = internalIdentifier(`${name}_${stage.operation}`);

      if (stage.operation === "sanitize") {
        setup.push(`const ${binding} = /*#__PURE__*/ (() => {`);
        setup.push(
          ...sanitizeChainBindings.names.map(
            (bindingName, position) => `  const ${bindingName} = ${String(sanitizeChainBindings.values[position])};`
          )
        );
        setup.push(...indentBlock(`return (${source.replace("function scrub", "function sanitize")});`));
        setup.push("})();");
      } else {
        setup.push(`const ${binding} = (${source.replace("function scrub", "function mask")});`);
      }
      return binding;
    };

    let manyIndex = 0;
    const emitManyApplication = (binding: string, patch?: string): void => {
      const list = `list${manyIndex}`;
      const length = `len${manyIndex}`;
      const out = `out${manyIndex}`;
      const index = `i${manyIndex++}`;

      body.push(`const ${list} = value;`);
      body.push(`const ${length} = ${list}.length;`);
      body.push(`const ${out} = new Array(${length});`);
      body.push(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
      body.push(`  ${out}[${index}] = ${binding}(${list}[${index}]${patch ? `, ${patch}` : ""});`);
      body.push("}");
      body.push(`value = ${out};`);
    };

    const emitMappedJsonArray = (mapper: string, stringify: string): void => {
      const list = `mappedList${manyIndex}`;
      const length = `mappedLen${manyIndex}`;
      const item = `mappedItem${manyIndex}`;
      const index = `mappedIndex${manyIndex++}`;
      const json = `mappedJson${manyIndex}`;

      body.push(`const ${list} = value;`);
      body.push(`const ${length} = ${list}.length;`);
      body.push(`let ${json} = "[";`);
      body.push(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
      body.push(`  if (${index} !== 0) ${json} += ",";`);
      body.push(`  const ${item} = ${mapper}.map(${list}[${index}]);`);
      body.push(`  ${json} += ${stringify}(${item});`);
      body.push("}");
      body.push(`${json} += "]";`);
      body.push(`value = ${json};`);
    };

    for (let index = 0; index < stages.length; index++) {
      const stage = stages[index];

      switch (stage.kind) {
        case "value":
        case "to.array":
          break;
        case "json.decode":
          body.push("value = JSON.parse(value);");
          break;
        case "binary.decode": {
          const codec = emitCodecBinding(stage.schema, "binary.decode");
          if (!codec) return;
          body.push(`value = ${codec}.decode(value);`);
          break;
        }
        case "validate": {
          if (stage.operation !== "parse") {
            skipped.push({
              schema: name,
              operation: stage.operation,
              reason: "only parse validation can continue into a collection execution pipeline",
            });
            return;
          }
          const validator = emitValidatorBinding(stage.schema);
          if (!validator) return;
          needsValidationError = true;
          if (canUseFastParse(stage.schema)) {
            body.push(`if (!${validator}.is(value)) {`);
            body.push(`  const result = ${validator}.safeParse(value);`);
            body.push("  if (!result.success) throw new JITValidationError(result.issues);");
            body.push("  value = result.data;");
            body.push("}");
          } else {
            body.push(`const result = ${validator}.safeParse(value);`);
            body.push("if (!result.success) throw new JITValidationError(result.issues);");
            body.push("value = result.data;");
          }
          break;
        }
        case "query": {
          let finalStage = stage;

          while (index + 1 < stages.length && stages[index + 1]?.kind === "query") {
            index++;
            finalStage = stages[index] as typeof finalStage;
          }
          const query = emitQueryBinding(finalStage);
          if (!query) return;
          body.push(`value = ${query}(value);`);
          break;
        }
        case "map": {
          const nextStage = stages[index + 1];
          const fuseJsonEncode = nextStage?.kind === "json.encode";
          const mapper = emitMapperBinding(stage, fuseJsonEncode || !stage.many ? "map" : "many");
          if (!mapper) return;
          if (fuseJsonEncode) {
            const stringify = tryEmit(name, "json.encode", skipped, () => emitSerialize(stage.target));
            if (!stringify) return;
            const binding = internalIdentifier(`${name}_stringify`);

            setup.push(`const ${binding} = (${stringify});`);
            if (stage.many) emitMappedJsonArray(mapper, binding);
            else body.push(`value = ${binding}(${mapper}.map(value));`);
            index++;
          } else {
            body.push(`value = ${mapper}.${stage.many ? "many" : "map"}(value);`);
          }
          break;
        }
        case "transform": {
          const transform = emitTransformBinding(stage);
          if (!transform) return;
          if (stage.many) emitManyApplication(transform);
          else body.push(`value = ${transform}(value);`);
          break;
        }
        case "update": {
          const update = emitUpdateBinding(stage);
          if (!update) return;
          if (stage.many) emitManyApplication(update.update, update.patch);
          else body.push(`value = ${update.update}(value, ${update.patch});`);
          break;
        }
        case "security": {
          const security = emitSecurityBinding(stage);
          if (!security) return;
          if (stage.many) emitManyApplication(security);
          else body.push(`value = ${security}(value);`);
          break;
        }
        case "json.encode": {
          const stringify = tryEmit(name, "json.encode", skipped, () => emitSerialize(stage.schema ?? plan.schema));
          if (!stringify) return;
          const binding = internalIdentifier(`${name}_stringify`);
          setup.push(`const ${binding} = (${stringify});`);
          body.push(`value = ${binding}(value);`);
          break;
        }
        case "binary.encode": {
          const codec = emitCodecBinding(stage.schema, "binary.encode");
          if (!codec) return;
          body.push(`value = ${codec}.encode(value);`);
          break;
        }
        case "operation":
          skipped.push({
            schema: name,
            operation: stage.operation,
            reason: "operation stages cannot follow a collection query",
          });
          return;
      }
    }

    body.push("return value;");
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...setup.map((line) => `  ${line}`));
    js.push("  return (input) => {");
    js.push(...body.map((line) => `    ${line}`));
    js.push("  };");
    js.push("})();");
    if (exportArtifact) {
      exportNames.push(name);
    }
  }

  function emitAotOperationSource(
    operation: "equal" | "clone" | "diff" | "hash" | "format" | "mask" | "sanitize",
    schema: ATS.AnyTypeSchema,
    operationSkipped: SkippedOperation[],
    name: string
  ): string | undefined {
    if (operation === "clone") return tryEmit(name, operation, operationSkipped, () => emitCloneSource(schema));
    if (operation === "diff") return tryEmit(name, operation, operationSkipped, () => emitDiffSource(schema));
    if (operation === "format") return tryEmit(name, operation, operationSkipped, () => emitFormatSource(schema));
    if (operation === "mask") return tryEmit(name, operation, operationSkipped, () => emitMaskSource(schema));
    if (operation === "sanitize") return tryEmit(name, operation, operationSkipped, () => emitSanitizeSource(schema));

    const source = operation === "equal" ? emitEqualSource(schema) : emitHashSource(schema);
    if (source.includes("__hash") || source.includes("__getIndex")) {
      operationSkipped.push({
        schema: name,
        operation,
        reason:
          "this operation requires runtime cache helpers; export it through JIT.compile until its execution backend is available",
      });
      return undefined;
    }
    return source;
  }

  function internalIdentifier(preferred: string): string {
    let candidate = preferred;
    let suffix = 1;

    while (publicNames.has(candidate) || internalNames.has(candidate)) {
      candidate = `${preferred}_${suffix++}`;
    }

    internalNames.add(candidate);
    return candidate;
  }

  // Inlined runtime helpers keep the module import-free: nothing from the
  // engine is loaded in production, and cold start pays only this file.
  const helpers: string[] = [];

  if (needsValidationError) {
    helpers.push(
      "class JITValidationError extends Error {",
      "  constructor(issues) {",
      "    const first = issues[0];",
      '    super(first ? (first.path ? first.path + ": " : "") + first.message : "validation failed");',
      '    this.name = "JITValidationError";',
      '    this.code = "VALIDATION_FAILED";',
      "    this.issues = issues;",
      "  }",
      "}"
    );
  }
  if (needsHashHelpers) {
    helpers.push(
      "const __hashCache = new WeakMap();",
      "function __hashNumber(value) { return value | 0; }",
      "function __hashBoolean(value) { return value ? 1 : 0; }",
      "function __hashBigInt(value) { return Number(value & 0xffffffffn) | 0; }",
      "function __hashString(value) {",
      "  let hash = 0;",
      "  for (let i = 0, len = value.length; i < len; i++) {",
      "    hash = (hash * 31 + value.charCodeAt(i)) | 0;",
      "  }",
      "  return hash;",
      "}",
      "function __hashUnknown(value) {",
      "  switch (typeof value) {",
      '    case "string": return __hashString(value);',
      '    case "number": return __hashNumber(value);',
      '    case "boolean": return __hashBoolean(value);',
      '    case "bigint": return __hashBigInt(value);',
      '    case "undefined": return 0;',
      '    case "symbol": return __hashString(String(value));',
      '    case "object": return value === null ? 1 : __hashString(Object.prototype.toString.call(value));',
      '    case "function": return __hashString("function");',
      "  }",
      "}",
      "function __combineHash(left, right) { return ((left << 5) - left + right) | 0; }"
    );
  }
  if (needsRuntimeGetIndex) {
    helpers.push(
      "const __indexCache = new WeakMap();",
      "function __getIndex(items, key) {",
      "  const cached = __indexCache.get(items);",
      "  if (cached !== undefined && cached.key === key) return cached.map;",
      "  const map = new Map();",
      "  for (let i = 0, len = items.length; i < len; i++) map.set(items[i][key], items[i]);",
      "  __indexCache.set(items, { key: key, map: map });",
      "  return map;",
      "}"
    );
  }
  const preludeIndex = layout.format === "typescript" ? 2 : 1;

  if (helpers.length > 0) js.splice(preludeIndex, 0, ...helpers);
  if (layout.format === "typescript" && tsTypes.length > 0) js.splice(preludeIndex, 0, ...tsTypes, "");

  if (exportNames.length === 0) return { files: [], skipped };

  if (context.root && options.clean !== false) cleanGeneratedFiles(options.outDir);
  mkdirSync(options.outDir, { recursive: true });

  const emit = {
    subpathModules: options.emit?.subpathModules === true,
    manifest: options.emit?.manifest === true,
    plans: options.emit?.plans === true,
  };
  const body = js.join("\n");
  const exportList = exportNames.join(", ");
  const esm = exportNames.length > 0 ? `${body}\nexport { ${exportList} };\n` : `${body}\nexport {};\n`;
  const files: string[] = [];

  files.push(writeFile(options.outDir, `${context.entryName}${layout.extension}`, esm));

  if (!context.root) return { files, skipped };

  const subpathModules = emit.subpathModules ? buildSubpathModules(options, exportNames, layout) : [];

  files.push(...subpathModules.flatMap((module) => module.files));

  if (layout.kind === "package") {
    files.push(writePackageJson(options.outDir, layout, subpathModules));
  }

  if (emit.manifest) {
    files.push(writeManifest(options.outDir, layout, exportNames, subpathModules, options));
  }

  if (emit.plans) {
    files.push(...writePlans(options.outDir, exportNames, subpathModules, options));
  }

  return { files, skipped };
}

interface SubpathModule {
  readonly name: string;
  readonly sourceFile: string;
  readonly exports: readonly string[];
  readonly files: readonly string[];
}

interface OutputLayout {
  readonly kind: "local" | "package";
  readonly format: AotOutputFormat;
  readonly packageName: string;
  readonly extension: ".js" | ".ts";
}

function buildSubpathModules(
  options: GenerateOptions,
  exportNames: readonly string[],
  layout: OutputLayout
): readonly SubpathModule[] {
  const sources = options.sources;
  if (!sources) return [];

  const bySource = new Map<string, string[]>();

  for (const name of exportNames) {
    const source = sources.get(name);

    if (!source) continue;
    const exports = bySource.get(source);

    if (exports) exports.push(name);
    else bySource.set(source, [name]);
  }

  const usedNames = new Set<string>();
  const modules: SubpathModule[] = [];

  for (const [sourceFile, names] of bySource) {
    const moduleName = uniqueModuleName(moduleNameFromSource(sourceFile), usedNames);
    const selectedNames = new Set(names);
    const selectedSources = new Map([...sources].filter(([name]) => selectedNames.has(name)));
    const selectedTypeSchemas = Object.fromEntries(
      Object.entries(options.typeSchemas ?? {}).filter(([name]) => sources.get(name) === sourceFile)
    );
    const result = generateModule(
      {
        schemas: selectRecord(options.schemas, selectedNames),
        ...(Object.keys(selectedTypeSchemas).length > 0 ? { typeSchemas: selectedTypeSchemas } : {}),
        ...(options.functions ? { functions: selectRecord(options.functions, selectedNames) } : {}),
        sources: selectedSources,
        outDir: options.outDir,
        packageName: layout.packageName,
        clean: false,
        format: layout.format,
      },
      { entryName: moduleName, root: false }
    );

    modules.push({ name: moduleName, sourceFile, exports: names, files: result.files });
  }

  return modules;
}

function selectRecord<TValue>(
  record: Readonly<Record<string, TValue>>,
  selected: ReadonlySet<string>
): Record<string, TValue> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => selected.has(name)));
}

function writePackageJson(outDir: string, layout: OutputLayout, modules: readonly SubpathModule[]): string {
  const exportsMap: Record<string, unknown> = {
    "./package.json": "./package.json",
    ".": `./index${layout.extension}`,
  };

  for (const module of modules) {
    exportsMap[`./${module.name}`] = `./${module.name}${layout.extension}`;
  }

  return writeFile(
    outDir,
    "package.json",
    `${JSON.stringify(
      {
        name: layout.packageName,
        version: "0.0.0",
        type: "module",
        ...(layout.format === "typescript" ? { types: "./index.ts" } : {}),
        exports: exportsMap,
        sideEffects: false,
      },
      null,
      2
    )}\n`
  );
}

function writeManifest(
  outDir: string,
  layout: OutputLayout,
  exportNames: readonly string[],
  modules: readonly SubpathModule[],
  options: GenerateOptions
): string {
  const moduleByExport = new Map<string, string>();

  for (const module of modules) {
    for (const name of module.exports) moduleByExport.set(name, module.name);
  }

  const manifestFiles = [
    `index${layout.extension}`,
    ...(layout.kind === "package" ? ["package.json"] : []),
    ...modules.map((module) => `${module.name}${layout.extension}`),
  ];

  if (options.emit?.manifest === true) manifestFiles.push("manifest.json");
  if (options.emit?.plans === true) {
    const planNames = modules.length > 0 ? modules.map((module) => module.name) : ["index"];

    manifestFiles.push(...planNames.map((module) => `plans/${module}.json`));
  }

  return writeFile(
    outDir,
    "manifest.json",
    `${JSON.stringify(
      {
        version: 2,
        layout: layout.kind,
        format: layout.format,
        ...(layout.kind === "package" ? { packageName: layout.packageName } : {}),
        files: manifestFiles,
        modules:
          modules.length > 0
            ? modules.map((module) => ({
                name: module.name,
                source: manifestSourceSpecifier(outDir, module.sourceFile),
                import: layout.kind === "package" ? `${layout.packageName}/${module.name}` : `./${module.name}.js`,
                exports: module.exports,
              }))
            : [
                {
                  name: "index",
                  import: layout.kind === "package" ? layout.packageName : "./index.js",
                  exports: exportNames,
                },
              ],
        artifacts: exportNames.map((name) => ({
          ...describeExport(name, options),
          module: moduleByExport.get(name) ?? "index",
        })),
      },
      null,
      2
    )}\n`
  );
}

function writePlans(
  outDir: string,
  exportNames: readonly string[],
  modules: readonly SubpathModule[],
  options: GenerateOptions
): readonly string[] {
  const plansDir = join(/* turbopackIgnore: true */ outDir, "plans");

  mkdirSync(plansDir, { recursive: true });

  if (modules.length === 0) {
    return [writePlan(plansDir, "index", exportNames, options)];
  }

  return modules.map((module) => writePlan(plansDir, module.name, module.exports, options));
}

function writePlan(
  plansDir: string,
  moduleName: string,
  exportNames: readonly string[],
  options: GenerateOptions
): string {
  return writeFile(
    plansDir,
    `${moduleName}.json`,
    `${JSON.stringify(
      {
        version: 1,
        module: moduleName,
        artifacts: exportNames.map((name) => describeExport(name, options)),
      },
      null,
      2
    )}\n`
  );
}

function describeExport(
  name: string,
  options: GenerateOptions
): {
  readonly name: string;
  readonly kind: string;
  readonly operations: readonly string[];
} {
  const schema = options.schemas[name];

  if (schema !== undefined) {
    return {
      name,
      kind: "grouped",
      operations: readRequestedOps(schema) ?? [],
    };
  }

  const artifact = getArtifact(options.functions?.[name]);

  if (!artifact) return { name, kind: "unknown", operations: [] };
  if (artifact.kind === "validator") return { name, kind: "validator", operations: [artifact.op] };
  if (artifact.kind === "operation") return { name, kind: "operation", operations: [artifact.op] };
  if (artifact.kind === "execution") {
    return {
      name,
      kind: "execution",
      operations: artifact.plan.stages.map((stage) =>
        stage.kind === "validate" || stage.kind === "operation" ? stage.operation : stage.kind
      ),
    };
  }
  return { name, kind: artifact.kind, operations: [artifact.kind] };
}

function tryEmit<TValue>(
  schema: string,
  operation: string,
  skipped: SkippedOperation[],
  emit: () => TValue
): TValue | undefined {
  try {
    return emit();
  } catch (error) {
    skipped.push({
      schema,
      operation,
      reason: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function standaloneType(
  artifact: Extract<CompiledArtifact, { readonly kind: "validator" }>,
  namedType?: string
): string {
  if (namedType) {
    return validatorType(artifact.op, namedType);
  }

  const valueType = emitTypeScriptType(artifact.schema);
  return validatorType(artifact.op, valueType);
}

function validatorType(op: Extract<CompiledArtifact, { readonly kind: "validator" }>["op"], valueType: string): string {
  switch (op) {
    case "is":
      return `(value: unknown) => value is ${valueType}`;
    case "parse":
      return `(value: unknown) => ${valueType}`;
    case "safeParse":
      return `(value: unknown) => { readonly success: true; readonly data: ${valueType} } | { readonly success: false; readonly issues: readonly { readonly path: string; readonly code: string; readonly expected: string; readonly message: string; readonly received?: string }[] }`;
    case "parseAsync":
      return `(value: unknown) => Promise<${valueType}>`;
    case "safeParseAsync":
      return `(value: unknown) => Promise<{ readonly success: true; readonly data: ${valueType} } | { readonly success: false; readonly issues: readonly { readonly path: string; readonly code: string; readonly expected: string; readonly message: string; readonly received?: string }[] }>`;
  }
}

function operationType(
  artifact: Extract<CompiledArtifact, { readonly kind: "operation" }>,
  namedType?: string
): string {
  if (namedType) {
    return operationSignature(artifact.op, namedType);
  }

  const valueType = emitTypeScriptType(artifact.schema);
  return operationSignature(artifact.op, valueType);
}

function operationSignature(
  op: Extract<CompiledArtifact, { readonly kind: "operation" }>["op"],
  valueType: string
): string {
  switch (op) {
    case "hash":
      return `(value: ${valueType}) => number`;
    case "equal":
      return `(left: ${valueType}, right: ${valueType}) => boolean`;
    case "clone":
      return `(value: ${valueType}) => ${valueType}`;
    case "diff":
      return `(left: ${valueType}, right: ${valueType}) => readonly { readonly type: "add" | "remove" | "update"; readonly path: readonly PropertyKey[]; readonly value?: unknown }[]`;
    case "mask":
    case "sanitize":
      return `(value: ${valueType}) => ${valueType}`;
    case "stringify":
      return `(value: ${valueType}) => string`;
    case "fromJSON":
      return `(json: string) => ${valueType}`;
    case "format":
      return `(value: string) => string`;
    case "codec":
      return `{ readonly encode: (value: ${valueType}) => Uint8Array; readonly encodeInto: (value: ${valueType}, target: Uint8Array) => number; readonly decode: (bytes: Uint8Array | ArrayBuffer) => ${valueType} }`;
  }
}

function executionPlanType(plan: ExecutionPlan, namedType?: string): string {
  const valueType = namedType ?? emitTypeScriptType(plan.schema);
  const last = plan.stages[plan.stages.length - 1];
  const operation = plan.stages.find((stage) => stage.kind === "operation");
  const map = plan.stages.find((stage) => stage.kind === "map");
  const query = plan.stages.find((stage) => stage.kind === "query");
  const hasJsonDecode = plan.stages.some((stage) => stage.kind === "json.decode");
  const hasBinaryDecode = plan.stages.some((stage) => stage.kind === "binary.decode");
  const valueSource = plan.stages.find((stage) => stage.kind === "value");

  if (operation?.kind === "operation") return operationSignature(operation.operation, valueType);

  if (last?.kind === "validate") {
    if (last.operation === "parse" && hasJsonDecode) return `(json: string) => ${valueType}`;
    if (last.operation === "parse" && hasBinaryDecode) return `(bytes: Uint8Array | ArrayBuffer) => ${valueType}`;
    return validatorType(last.operation === "issues" ? "safeParse" : last.operation, valueType);
  }

  const inputType = hasJsonDecode
    ? "string"
    : hasBinaryDecode
      ? "Uint8Array | ArrayBuffer"
      : valueSource?.kind === "value"
        ? emitTypeScriptType(valueSource.schema)
        : map?.kind === "map"
          ? map.many
            ? `readonly ${emitTypeScriptType(map.source)}[]`
            : emitTypeScriptType(map.source)
          : query?.kind === "query"
            ? emitTypeScriptType(query.source)
            : valueType;

  if (last?.kind === "json.encode") return `(value: ${inputType}) => string`;
  if (last?.kind === "binary.encode") return `(value: ${inputType}) => Uint8Array`;
  if (hasJsonDecode) return `(json: string) => ${valueType}`;
  if (hasBinaryDecode) return `(bytes: Uint8Array | ArrayBuffer) => ${valueType}`;
  if (map?.kind === "map") return `(value: ${inputType}) => ${valueType}`;
  if (query?.kind === "query") return `(value: ${inputType}) => ${valueType}`;
  if (plan.stages.some((stage) => stage.kind === "transform" || stage.kind === "update" || stage.kind === "security")) {
    return `(value: ${inputType}) => ${valueType}`;
  }
  return "unknown";
}

/**
 * Serializes compiler bindings into const declarations. Developer callbacks
 * are emitted as source so generated modules stay self-contained and do not
 * pay a runtime compiler cost.
 */
function inlineBindings(names: readonly string[], values: readonly unknown[]): string[] | undefined {
  const lines: string[] = [];

  for (let index = 0; index < names.length; index++) {
    const value = values[index];
    const literal = serializeBindingValue(value);

    if (literal === undefined) return undefined;

    lines.push(`const ${names[index]} = ${literal};`);
  }

  return lines;
}

function inlineCodecBindings(names: readonly string[], values: readonly unknown[]): string[] | undefined {
  const lines: string[] = [];

  for (let index = 0; index < names.length; index++) {
    const name = names[index];
    const value = values[index];

    if (name === "__enc") {
      lines.push("const __enc = new TextEncoder();");
      continue;
    }

    if (name === "__dec") {
      lines.push("const __dec = new TextDecoder();");
      continue;
    }

    const literal = serializeBindingValue(value);

    if (literal === undefined) return undefined;

    lines.push(`const ${name} = ${literal};`);
  }

  return lines;
}

function serializeBindingValue(value: unknown): string | undefined {
  if (value instanceof RegExp) return String(value);
  if (typeof value === "function") return serializeBindingFunction(value);
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) {
    const parts = value.map(serializeBindingValue);

    if (parts.some((part) => part === undefined)) return undefined;
    return `[${parts.join(", ")}]`;
  }

  return undefined;
}

/** Serializes data-only update patches without evaluating getters or prototypes. */
function serializeStaticData(value: unknown, seen = new Set<object>()): string | undefined {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "undefined":
      return "undefined";
    case "bigint":
      return `${value}n`;
    case "number":
      if (Number.isNaN(value)) return "NaN";
      if (value === Infinity) return "Infinity";
      if (value === -Infinity) return "-Infinity";
      if (Object.is(value, -0)) return "-0";
      return String(value);
    case "object":
      break;
    default:
      return undefined;
  }

  if (seen.has(value)) return undefined;
  seen.add(value);

  try {
    if (value instanceof Date) {
      const time = value.getTime();
      return Number.isNaN(time) ? "new Date(NaN)" : `new Date(${time})`;
    }

    if (Array.isArray(value)) {
      const items = value.map((item) => serializeStaticData(item, seen));

      if (items.some((item) => item === undefined)) return undefined;
      return `[${items.join(", ")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const entries: string[] = [];

    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor)) return undefined;
      const entry = serializeStaticData(descriptor.value, seen);
      if (entry === undefined) return undefined;
      entries.push(`${JSON.stringify(key)}: ${entry}`);
    }
    return `{ ${entries.join(", ")} }`;
  } finally {
    seen.delete(value);
  }
}

function isComposedExecutionStage(stage: ExecutionStage): boolean {
  return (
    stage.kind === "query" ||
    stage.kind === "map" ||
    stage.kind === "transform" ||
    stage.kind === "update" ||
    stage.kind === "security"
  );
}

function serializeBindingFunction(value: Function): string | undefined {
  let source = Function.prototype.toString.call(value).trim();

  // Native and bound functions do not expose reconstructible source.
  if (source.includes("[native code]") || source.startsWith("function bound ")) return undefined;

  // Function#toString represents object methods without the `function`
  // keyword. Normalize those forms into standalone function expressions.
  if (!isFunctionExpressionSource(source) && !isArrowFunctionSource(source)) {
    source = normalizeMethodSource(source);
  }

  if (source === "") return undefined;

  try {
    // Syntax validation happens only in the build-time compilation path.
    Function(`return (${source});`);
  } catch {
    return undefined;
  }

  if (hasUnsupportedClosureReferences(source)) return undefined;

  return `(${source})`;
}

const CALLBACK_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "of",
  "return",
  "set",
  "static",
  "switch",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const CALLBACK_GLOBALS = new Set([
  "AggregateError",
  "Array",
  "ArrayBuffer",
  "atob",
  "Atomics",
  "BigInt",
  "BigInt64Array",
  "BigUint64Array",
  "Boolean",
  "btoa",
  "clearInterval",
  "clearTimeout",
  "console",
  "crypto",
  "DataView",
  "Date",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "Error",
  "EvalError",
  "FinalizationRegistry",
  "Float32Array",
  "Float64Array",
  "Infinity",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Intl",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "Number",
  "Object",
  "parseFloat",
  "parseInt",
  "performance",
  "Promise",
  "queueMicrotask",
  "RangeError",
  "ReferenceError",
  "Reflect",
  "RegExp",
  "Set",
  "setInterval",
  "setTimeout",
  "SharedArrayBuffer",
  "String",
  "structuredClone",
  "Symbol",
  "SyntaxError",
  "TextDecoder",
  "TextEncoder",
  "TypeError",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  "URIError",
  "URL",
  "URLSearchParams",
  "WeakMap",
  "WeakRef",
  "WeakSet",
]);

/**
 * Conservative free-identifier check for serialized callbacks. AOT cannot
 * reconstruct a JavaScript closure, so any non-local identifier must be a
 * stable ECMAScript/Web global. Rejecting an unusual callback is preferable
 * to emitting a module that fails later with a hidden ReferenceError.
 */
function hasUnsupportedClosureReferences(source: string): boolean {
  if (/\b(?:this|super)\b/.test(source)) return true;

  const code = maskCallbackLiterals(source);
  const locals = new Set<string>(["arguments"]);

  for (const match of code.matchAll(/\bfunction(?:\s*\*)?\s*([A-Za-z_$][A-Za-z0-9_$]*)?\s*\(([^()]*)\)/g)) {
    if ((match[2] ?? "").includes("=")) return true;
    if (match[1]) locals.add(match[1]);
    collectBindingIdentifiers(match[2] ?? "", locals);
  }
  for (const match of code.matchAll(/(?:\(([^()]*)\)|([A-Za-z_$][A-Za-z0-9_$]*))\s*=>/g)) {
    if ((match[1] ?? "").includes("=")) return true;
    collectBindingIdentifiers(match[1] ?? match[2] ?? "", locals);
  }
  for (const match of code.matchAll(/\b(?:const|let|var|class|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    locals.add(match[1]);
  }
  for (const match of code.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    locals.add(match[1]);
  }

  for (const match of code.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    const identifier = match[0];
    const start = match.index;
    const previous = previousNonWhitespace(code, start - 1);
    const next = nextNonWhitespace(code, start + identifier.length);

    if (previous === "." || next === ":") continue;
    if (CALLBACK_KEYWORDS.has(identifier) || CALLBACK_GLOBALS.has(identifier) || locals.has(identifier)) continue;
    return true;
  }

  return false;
}

function collectBindingIdentifiers(source: string, target: Set<string>): void {
  for (const match of source.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) target.add(match[0]);
}

function previousNonWhitespace(source: string, index: number): string | undefined {
  while (index >= 0 && /\s/.test(source[index] ?? "")) index--;
  return source[index];
}

function nextNonWhitespace(source: string, index: number): string | undefined {
  while (index < source.length && /\s/.test(source[index] ?? "")) index++;
  return source[index];
}

/** Masks comments and literal bodies while retaining `${...}` expressions. */
function maskCallbackLiterals(source: string): string {
  const output = source.split("");
  const templateOuterDepths: (number | undefined)[] = [];
  let state: "code" | "single" | "double" | "template" | "line" | "block" | "regex" = "code";
  let expressionDepth: number | undefined;
  let escaped = false;
  let regexClass = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (state === "line") {
      if (char === "\n") state = "code";
      else output[index] = " ";
      continue;
    }
    if (state === "block") {
      output[index] = " ";
      if (char === "*" && next === "/") {
        output[++index] = " ";
        state = "code";
      }
      continue;
    }
    if (state === "single" || state === "double") {
      output[index] = " ";
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if ((state === "single" && char === "'") || (state === "double" && char === '"')) state = "code";
      continue;
    }
    if (state === "regex") {
      output[index] = " ";
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "[") regexClass = true;
      else if (char === "]") regexClass = false;
      else if (char === "/" && !regexClass) {
        while (/[A-Za-z]/.test(source[index + 1] ?? "")) output[++index] = " ";
        state = "code";
      }
      continue;
    }
    if (state === "template") {
      output[index] = " ";
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "`") {
        expressionDepth = templateOuterDepths.pop();
        state = "code";
      } else if (char === "$" && next === "{") {
        output[++index] = "{";
        expressionDepth = 1;
        state = "code";
      }
      continue;
    }

    if (expressionDepth !== undefined) {
      if (char === "{") expressionDepth++;
      else if (char === "}" && --expressionDepth === 0) {
        output[index] = " ";
        expressionDepth = undefined;
        state = "template";
        continue;
      }
    }
    if (char === "/" && next === "/") {
      output[index] = output[++index] = " ";
      state = "line";
    } else if (char === "/" && next === "*") {
      output[index] = output[++index] = " ";
      state = "block";
    } else if (char === "'") {
      output[index] = " ";
      state = "single";
    } else if (char === '"') {
      output[index] = " ";
      state = "double";
    } else if (char === "`") {
      output[index] = " ";
      templateOuterDepths.push(expressionDepth);
      expressionDepth = undefined;
      state = "template";
    } else if (char === "/" && startsRegexLiteral(output, index)) {
      output[index] = " ";
      regexClass = false;
      state = "regex";
    }
  }

  return output.join("");
}

function startsRegexLiteral(masked: readonly string[], index: number): boolean {
  let cursor = index - 1;

  while (cursor >= 0 && /\s/.test(masked[cursor] ?? "")) cursor--;
  if (cursor < 0) return true;
  const previous = masked[cursor] ?? "";

  if ("([{:;,=!?&|+-*%^~<>".includes(previous)) return true;
  const prefix = masked.slice(0, cursor + 1).join("");
  return /\b(?:case|delete|in|instanceof|new|return|throw|typeof|void|yield)\s*$/.test(prefix);
}

function isFunctionExpressionSource(source: string): boolean {
  return /^(?:async\s+)?function(?:\s*\*)?\b/.test(source);
}

function isArrowFunctionSource(source: string): boolean {
  return /^(?:async\s+)?(?:[A-Za-z_$][A-Za-z0-9_$]*|\([^)]*\))\s*=>/.test(source);
}

function normalizeMethodSource(source: string): string {
  const match = /^(async\s+)?(\*)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(\([\s\S]*)$/.exec(source);

  if (!match) return "";

  const asyncPrefix = match[1] ?? "";
  const generator = match[2] ? "*" : "";
  return `${asyncPrefix}function${generator} ${match[3]}${match[4]}`;
}

/**
 * Relative type-import path from generated TypeScript to a declaration file.
 * TypeScript resolves emitted `.js` specifiers back to source `.ts` files.
 */
function typeImportSpecifier(outDir: string, sourceFile: string): string {
  const relativePath = relative(
    resolve(/* turbopackIgnore: true */ outDir),
    resolve(/* turbopackIgnore: true */ sourceFile)
  )
    .split("\\")
    .join("/");
  const mapped = relativePath
    .replace(/\.mts$/, ".mjs")
    .replace(/\.cts$/, ".cjs")
    .replace(/\.ts$/, ".js");

  return mapped.startsWith(".") ? mapped : `./${mapped}`;
}

function manifestSourceSpecifier(outDir: string, sourceFile: string): string {
  const relativePath = relative(
    resolve(/* turbopackIgnore: true */ outDir),
    resolve(/* turbopackIgnore: true */ sourceFile)
  )
    .split("\\")
    .join("/");

  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

function moduleNameFromSource(sourceFile: string): string {
  const rawName = basename(sourceFile)
    .replace(/\.jit\.(ts|mts|cts|js|mjs|cjs)$/, "")
    .replace(/\.(ts|mts|cts|js|mjs|cjs)$/, "");
  const normalized = rawName.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "schema";
}

function uniqueModuleName(preferred: string, used: Set<string>): string {
  let candidate = preferred;
  let suffix = 1;

  while (used.has(candidate)) candidate = `${preferred}-${++suffix}`;
  used.add(candidate);
  return candidate;
}

function resolveOutputLayout(
  outDir: string,
  configuredPackageName: string | undefined,
  format: AotOutputFormat
): OutputLayout {
  const segments = resolve(/* turbopackIgnore: true */ outDir).split(/[\\/]+/);
  const nodeModulesIndex = segments.lastIndexOf("node_modules");

  if (nodeModulesIndex < 0) {
    return {
      kind: "local",
      format,
      packageName: configuredPackageName ?? "@jit/generated",
      extension: format === "typescript" ? ".ts" : ".js",
    };
  }

  const first = segments[nodeModulesIndex + 1];
  const second = segments[nodeModulesIndex + 2];
  const inferred = first?.startsWith("@") && second ? `${first}/${second}` : first;

  return {
    kind: "package",
    format,
    packageName: configuredPackageName ?? inferred ?? "@jit/generated",
    extension: format === "typescript" ? ".ts" : ".js",
  };
}

function assertOutputFormat(value: unknown): AotOutputFormat {
  if (value === "typescript" || value === "javascript") return value;
  throw new Error(`unknown AOT output format ${JSON.stringify(value)}; expected "typescript" or "javascript"`);
}

const AOT_OPS = new Set<string>(AOT_OPERATIONS);
const GENERATED_FILES = [
  "index.js",
  "index.mjs",
  "index.cjs",
  "index.ts",
  "index.d.ts",
  "index.d.cts",
  "manifest.json",
] as const;

/** Reads the extras key list from a `JIT.compile(schema, { ... })` marker. */
function readExtraNames(input: SchemaInput): readonly string[] {
  const candidate = (input as { readonly extras?: unknown }).extras;

  if (Array.isArray(candidate) && candidate.every((key) => typeof key === "string")) {
    return candidate as readonly string[];
  }

  return [];
}

/** Reads the ops allowlist from a `JIT.compile(schema, { ... })` marker input. */
function readRequestedOps(input: SchemaInput): readonly string[] | undefined {
  const candidate = (input as { readonly ops?: unknown }).ops;

  if (Array.isArray(candidate) && candidate.every((op) => typeof op === "string")) {
    return candidate as readonly string[];
  }

  return undefined;
}

function readAotExportMode(input: SchemaInput): "grouped" | undefined {
  const candidate = (input as { readonly __jitAot?: unknown }).__jitAot;

  return candidate === "grouped" ? candidate : undefined;
}

function indentBlock(source: string): string[] {
  return source.split("\n").map((line) => (line.length > 0 ? `  ${line}` : line));
}

function writeFile(dir: string, name: string, content: string): string {
  const path = join(/* turbopackIgnore: true */ dir, name);

  writeFileSync(path, content);
  return path;
}

function cleanGeneratedFiles(dir: string): void {
  const manifest = readGeneratedManifest(dir);

  for (const file of manifest.files) {
    rmSync(join(/* turbopackIgnore: true */ dir, file), { force: true });
  }

  for (const file of GENERATED_FILES) {
    rmSync(join(/* turbopackIgnore: true */ dir, file), { force: true });
  }
  if (isGeneratedPackageJson(dir)) {
    rmSync(join(/* turbopackIgnore: true */ dir, "package.json"), {
      force: true,
    });
  }
  rmSync(join(/* turbopackIgnore: true */ dir, "plans"), {
    recursive: true,
    force: true,
  });
}

function isGeneratedPackageJson(dir: string): boolean {
  // Build tools must not trace a caller-selected output directory as an input.
  const path = join(/* turbopackIgnore: true */ dir, "package.json");

  if (!existsSync(path)) return false;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      readonly version?: unknown;
      readonly sideEffects?: unknown;
      readonly exports?: unknown;
    };

    return parsed.version === "0.0.0" && parsed.sideEffects === false && parsed.exports !== undefined;
  } catch {
    return false;
  }
}

function readGeneratedManifest(dir: string): {
  readonly files: readonly string[];
} {
  // The manifest is runtime output, never part of the importing app bundle.
  const path = join(/* turbopackIgnore: true */ dir, "manifest.json");

  if (!existsSync(path)) return { files: [] };

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      files?: unknown;
    };

    if (!Array.isArray(parsed.files)) return { files: [] };
    return {
      files: parsed.files.filter((file): file is string => typeof file === "string" && !file.includes("..")),
    };
  } catch {
    return { files: [] };
  }
}
