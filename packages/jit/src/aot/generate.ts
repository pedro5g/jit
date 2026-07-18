import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { emitCloneSource } from "../compiler/clone.js";
import { emitCodec } from "../compiler/codec/emit-codec.js";
import { emitDiffSource } from "../compiler/diff.js";
import { emitEqualSource } from "../compiler/equal.js";
import { emitFormatSource } from "../compiler/format.js";
import { emitHashSource } from "../compiler/hash.js";
import { emitMaskSource } from "../compiler/mask.js";
import { emitSanitizeSource, sanitizeChainBindings } from "../compiler/sanitize.js";
import { emitSerialize } from "../compiler/serialize/emit-serialize.js";
import { emitValidator } from "../compiler/validate/emit-validate.js";
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
export type AotOutputFormat = "typescript" | "javascript" | "javascript-only";

export interface GenerateOptions {
  /** Exported name -> object-style `JIT.compile(schema, { ... })` markers. */
  readonly schemas: Readonly<Record<string, SchemaInput>>;
  /** Exported raw schemas emitted only as structural type aliases. */
  readonly typeSchemas?: Readonly<Record<string, SchemaInput>>;
  /** Exported name -> standalone compiled functions/objects. */
  readonly functions?: Readonly<Record<string, unknown>>;
  /** Output directory; local directories emit ESM, `node_modules` emits a dual package. */
  readonly outDir: string;
  /** Package namespace used when `outDir` is inside `node_modules`. */
  readonly packageName?: string;
  /** Remove known generated files before writing; defaults to true. */
  readonly clean?: boolean;
  /**
   * Runtime source format. TypeScript output keeps public signatures in the
   * generated source itself and is intended for source directories consumed
   * by the application's TypeScript build. The low-level programmatic API
   * preserves its JavaScript default; CLI/config generation defaults to
   * TypeScript.
   */
  readonly format?: AotOutputFormat;
  /**
   * Schema name → source file it was loaded from. When present, the
   * generated `.d.ts` derives the value type from the dev's own schema via
   * `import("@jit-compiler/jit").Typeof<typeof import("<file>").Name>` — the single source
   * of truth for typing — instead of re-emitting a structural type by hand.
   * Type-only imports erase at runtime, so tree-shaking is unaffected.
   */
  readonly sources?: ReadonlyMap<string, string>;
  /** Optional supplementary artifacts. The root module is always emitted. */
  readonly emit?: GenerateEmitOptions;
  /** Type-only package used to resolve `Typeof` and `Strict`. */
  readonly types?: {
    readonly package?: string;
  };
}

export interface GenerateEmitOptions {
  /** Emit per-declaration subpath modules such as local `user.js` or package `user.mjs`. */
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

/**
 * Prisma-style AOT generation: turns schemas into plain, optimized `.js`
 * plus `.d.ts`, written to a directory the app imports directly. The
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
  const layout = resolveOutputLayout(options.outDir, options.packageName, options.format ?? "javascript");
  const compilerPackageName = options.types?.package ?? "@jit-compiler/jit";
  const skipped: SkippedOperation[] = [];
  const js: string[] = [];
  const dts: string[] = [];
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
  dts.push("// Generated by jit — do not edit.");

  for (const [name, input] of Object.entries(options.typeSchemas ?? {})) {
    if (!isValidIdentifier(name) || name in options.schemas || name in (options.functions ?? {})) continue;
    const schema = unwrapSchema(input as SchemaInput<ATS.AnyTypeSchema>);
    const valueType = `export type ${name} = ${emitTypeScriptType(schema)};`;
    const strictType = `export type ${name}Strict<TValue> = TValue;`;

    typeNames.set(schema, name);
    dts.push(valueType, strictType);
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
    const operations: { readonly prop: string; readonly type: string; readonly binding: string }[] = [];
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

    if (sourceFile && layout.format !== "typescript") {
      const specifier = typeImportSpecifier(options.outDir, sourceFile);
      const valueType = `export type ${name} = import(${JSON.stringify(compilerPackageName)}).Typeof<typeof import(${JSON.stringify(specifier)}).${name}>;`;
      const strictType = `export type ${name}Strict<TValue> = import(${JSON.stringify(compilerPackageName)}).Strict<typeof import(${JSON.stringify(specifier)}).${name}, TValue>;`;

      dts.push(valueType, strictType);
      tsTypes.push(valueType, strictType);
    } else {
      // No source file to anchor to (programmatic generate): fall back to a
      // structural type emitted from the schema tree.
      const valueType = `export type ${name} = ${emitTypeScriptType(schema)};`;
      const strictType = `export type ${name}Strict<TValue> = TValue;`;

      dts.push(valueType, strictType);
      tsTypes.push(valueType, strictType);
    }

    // is / parse / safeParse
    const wantsValidator = wants("is") || wants("parse") || wants("safeParse") || wants("fromJSON");
    const validator = wantsValidator ? tryEmit(name, "validator", skipped, () => emitValidator(schema)) : undefined;

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
          const parseBinding = internalIdentifier(`${name}_parse`);

          needsValidationError = true;
          js.push(
            `const ${parseBinding} = /*#__PURE__*/ ((v) => (value) => { const r = v.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); })(${validatorName});`
          );
          if (wants("parse")) {
            operations.push({
              prop: "parse",
              type: `(value: unknown) => ${name}`,
              binding: parseBinding,
            });
          }
          if (wants("fromJSON")) {
            const binding = internalIdentifier(`${name}_fromJSON`);

            js.push(
              `const ${binding} = /*#__PURE__*/ ((parse) => (json) => parse(JSON.parse(json)))(${parseBinding});`
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
      if (wants("hash")) operations.push({ prop: "hash", type: `(value: ${name}) => number`, binding: hashBinding });
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
      operations.push({ prop: "clone", type: `(value: ${name}) => ${name}`, binding });
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
      operations.push({ prop: "format", type: `(value: string) => string`, binding });
    }

    // mask
    const maskSource = wants("mask") ? tryEmit(name, "mask", skipped, () => emitMaskSource(schema)) : undefined;

    if (maskSource) {
      const binding = internalIdentifier(`${name}_mask`);

      js.push(`const ${binding} = (${maskSource});`);
      operations.push({ prop: "mask", type: `(value: ${name}) => ${name}`, binding });
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

    dts.push(`export declare const ${name}: {`);
    dts.push(...operations.map((operation) => `  readonly ${operation.prop}: ${operation.type};`));
    dts.push("};");
    dts.push("");
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

      const validator = tryEmit(name, artifact.op, skipped, () =>
        emitValidator(artifact.schema, {
          is: artifact.op === "is",
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
          `${declaration} /*#__PURE__*/ ((v) => (value) => { const r = v.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); })(${validatorName});`
        );
      }

      exportNames.push(name);
      dts.push(`export declare const ${name}: ${standaloneType(artifact, typeNames.get(artifact.schema))};`);
      dts.push("");
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
        const validator = tryEmit(name, "fromJSON", skipped, () => emitValidator(schema));

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
          `${declaration} /*#__PURE__*/ ((v) => (json) => { const r = v.safeParse(JSON.parse(json)); if (r.success) return r.data; throw new JITValidationError(r.issues); })(${validatorName});`
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
      dts.push(`export declare const ${name}: ${operationType(artifact, typeNames.get(artifact.schema))};`);
      dts.push("");
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
    dts.push(
      `export declare const ${name}: ${sourceFile ? `typeof import(${JSON.stringify(typeImportSpecifier(options.outDir, sourceFile))}).${name}` : "unknown"};`
    );
    dts.push("");
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

  if (options.clean !== false) cleanGeneratedFiles(options.outDir);
  mkdirSync(options.outDir, { recursive: true });

  const emit = {
    subpathModules: options.emit?.subpathModules === true,
    manifest: options.emit?.manifest === true,
    plans: options.emit?.plans === true,
  };
  const body = js.join("\n");
  const exportList = exportNames.join(", ");
  const esm = exportNames.length > 0 ? `${body}\nexport { ${exportList} };\n` : `${body}\nexport {};\n`;
  const cjs =
    exportNames.length > 0 ? `${body}\nmodule.exports = { ${exportList} };\n` : `${body}\nmodule.exports = {};\n`;
  while (dts[dts.length - 1] === "") dts.pop();
  const types = `${dts.join("\n")}\n`;
  const subpathModules = emit.subpathModules
    ? buildSubpathModules(options.outDir, exportNames, options.sources, layout)
    : [];
  const files: string[] = [];

  if (layout.format === "typescript") {
    files.push(writeFile(options.outDir, "index.ts", esm));
  } else if (layout.kind === "package") {
    files.push(writeFile(options.outDir, "index.mjs", esm), writeFile(options.outDir, "index.cjs", cjs));
    if (layout.format === "javascript") {
      files.push(writeFile(options.outDir, "index.d.ts", types), writeFile(options.outDir, "index.d.cts", types));
    }
  } else {
    files.push(writeFile(options.outDir, "index.js", esm));
    if (layout.format === "javascript") files.push(writeFile(options.outDir, "index.d.ts", types));
  }

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
  readonly jsExtension: ".js" | ".mjs" | ".ts";
}

function buildSubpathModules(
  outDir: string,
  exportNames: readonly string[],
  sources: ReadonlyMap<string, string> | undefined,
  layout: OutputLayout
): readonly SubpathModule[] {
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
    const exportList = names.join(", ");
    const importExtension = layout.format === "typescript" ? ".js" : layout.jsExtension;
    const esm = `export { ${exportList} } from "./index${importExtension}";\n`;
    const dts = `export { ${exportList} } from "./index${importExtension}";\n`;
    const files = [writeFile(outDir, `${moduleName}${layout.jsExtension}`, esm)];

    if (layout.format === "javascript") {
      files.push(writeFile(outDir, `${moduleName}.d.ts`, dts));
    }

    if (layout.kind === "package" && layout.format !== "typescript") {
      const cjsBindings = names.map((name) => `${name}: root.${name}`).join(", ");
      const cjs = `const root = require("./index.cjs");\nmodule.exports = { ${cjsBindings} };\n`;

      files.push(writeFile(outDir, `${moduleName}.cjs`, cjs));
      if (layout.format === "javascript") {
        const dcts = `export { ${exportList} } from "./index.cjs";\n`;
        files.push(writeFile(outDir, `${moduleName}.d.cts`, dcts));
      }
    }

    modules.push({ name: moduleName, sourceFile, exports: names, files });
  }

  return modules;
}

function writePackageJson(outDir: string, layout: OutputLayout, modules: readonly SubpathModule[]): string {
  if (layout.format === "typescript") {
    const exportsMap: Record<string, unknown> = {
      "./package.json": "./package.json",
      ".": {
        types: "./index.ts",
        default: "./index.ts",
      },
    };

    for (const module of modules) {
      exportsMap[`./${module.name}`] = {
        types: `./${module.name}.ts`,
        default: `./${module.name}.ts`,
      };
    }

    return writeFile(
      outDir,
      "package.json",
      `${JSON.stringify(
        {
          name: layout.packageName,
          version: "0.0.0",
          type: "module",
          types: "./index.ts",
          exports: exportsMap,
          sideEffects: false,
        },
        null,
        2
      )}\n`
    );
  }

  const withTypes = layout.format === "javascript";
  const exportsMap: Record<string, unknown> = {
    "./package.json": "./package.json",
    ".": {
      ...(withTypes ? { types: "./index.d.ts" } : {}),
      import: "./index.mjs",
      require: "./index.cjs",
    },
  };

  for (const module of modules) {
    exportsMap[`./${module.name}`] = {
      ...(withTypes ? { types: `./${module.name}.d.ts` } : {}),
      import: `./${module.name}.mjs`,
      require: `./${module.name}.cjs`,
    };
  }

  return writeFile(
    outDir,
    "package.json",
    `${JSON.stringify(
      {
        name: layout.packageName,
        version: "0.0.0",
        type: "module",
        main: "./index.cjs",
        module: "./index.mjs",
        ...(withTypes ? { types: "./index.d.ts" } : {}),
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
    `index${layout.jsExtension}`,
    ...(layout.format === "javascript" ? ["index.d.ts"] : []),
    ...(layout.kind === "package"
      ? [
          ...(layout.format !== "typescript" ? ["index.cjs"] : []),
          ...(layout.format === "javascript" ? ["index.d.cts"] : []),
          "package.json",
        ]
      : []),
    ...modules.flatMap((module) => [
      `${module.name}${layout.jsExtension}`,
      ...(layout.format === "javascript" ? [`${module.name}.d.ts`] : []),
      ...(layout.kind === "package" && layout.format !== "typescript" ? [`${module.name}.cjs`] : []),
      ...(layout.kind === "package" && layout.format === "javascript" ? [`${module.name}.d.cts`] : []),
    ]),
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
        version: 1,
        layout: layout.kind,
        format: layout.format,
        ...(layout.kind === "package" ? { packageName: layout.packageName } : {}),
        files: manifestFiles,
        modules:
          modules.length > 0
            ? modules.map((module) => ({
                name: module.name,
                source: manifestSourceSpecifier(outDir, module.sourceFile),
                import:
                  layout.kind === "package"
                    ? `${layout.packageName}/${module.name}`
                    : `./${module.name}${layout.format === "typescript" ? ".js" : layout.jsExtension}`,
                exports: module.exports,
              }))
            : [
                {
                  name: "index",
                  import:
                    layout.kind === "package"
                      ? layout.packageName
                      : `./index${layout.format === "typescript" ? ".js" : layout.jsExtension}`,
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
    return { name, kind: "grouped", operations: readRequestedOps(schema) ?? [] };
  }

  const artifact = getArtifact(options.functions?.[name]);

  if (!artifact) return { name, kind: "unknown", operations: [] };
  if (artifact.kind === "validator") return { name, kind: "validator", operations: [artifact.op] };
  if (artifact.kind === "operation") return { name, kind: "operation", operations: [artifact.op] };
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

function serializeBindingFunction(value: Function): string | undefined {
  let source = Function.prototype.toString.call(value).trim();

  // Native and bound functions do not expose reconstructible source.
  if (source.includes("[native code]") || source.startsWith("function bound ")) return undefined;

  // Function#toString represents object methods without the `function`
  // keyword. Normalize those forms into standalone function expressions.
  if (!isFunctionExpressionSource(source) && !source.includes("=>")) {
    source = normalizeMethodSource(source);
  }

  if (source === "") return undefined;

  try {
    // Syntax validation happens only in the build-time compilation path.
    Function(`return (${source});`);
  } catch {
    return undefined;
  }

  return `(${source})`;
}

function isFunctionExpressionSource(source: string): boolean {
  return /^(?:async\s+)?function(?:\s*\*)?\b/.test(source);
}

function normalizeMethodSource(source: string): string {
  const match = /^(async\s+)?(\*)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(\([\s\S]*)$/.exec(source);

  if (!match) return "";

  const asyncPrefix = match[1] ?? "";
  const generator = match[2] ? "*" : "";
  return `${asyncPrefix}function${generator} ${match[3]}${match[4]}`;
}

/**
 * Relative type-import path from the generated package to the dev's schema
 * file: POSIX separators, TS extensions mapped to their emitted JS forms
 * (nodenext resolves them back to the source at typecheck time).
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
      jsExtension: format === "typescript" ? ".ts" : ".js",
    };
  }

  const first = segments[nodeModulesIndex + 1];
  const second = segments[nodeModulesIndex + 2];
  const inferred = first?.startsWith("@") && second ? `${first}/${second}` : first;

  return {
    kind: "package",
    format,
    packageName: configuredPackageName ?? inferred ?? "@jit/generated",
    jsExtension: format === "typescript" ? ".ts" : ".mjs",
  };
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
    rmSync(join(/* turbopackIgnore: true */ dir, "package.json"), { force: true });
  }
  rmSync(join(/* turbopackIgnore: true */ dir, "plans"), { recursive: true, force: true });
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

function readGeneratedManifest(dir: string): { readonly files: readonly string[] } {
  // The manifest is runtime output, never part of the importing app bundle.
  const path = join(/* turbopackIgnore: true */ dir, "manifest.json");

  if (!existsSync(path)) return { files: [] };

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { files?: unknown };

    if (!Array.isArray(parsed.files)) return { files: [] };
    return { files: parsed.files.filter((file): file is string => typeof file === "string" && !file.includes("..")) };
  } catch {
    return { files: [] };
  }
}
