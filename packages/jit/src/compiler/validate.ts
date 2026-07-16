import type * as ATS from "../core/ats/index.js";
import { JITValidationError, type ValidationIssue } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { emitValidator } from "./validate/emit-validate.js";

export const VALIDATOR_OPS = ["is", "parse", "safeParse", "parseAsync", "safeParseAsync"] as const;

export type ValidatorOp = (typeof VALIDATOR_OPS)[number];

/** Successful `safeParse` result carrying the (possibly transformed) data. */
export interface SafeParseSuccess<T> {
  readonly success: true;
  readonly data: T;
}

/** Failed `safeParse` result carrying every collected issue. */
export interface SafeParseFailure {
  readonly success: false;
  readonly issues: readonly ValidationIssue[];
}

export type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseFailure;

/**
 * A compiled validator triple for one schema.
 *
 * @template T - The value type described by the schema.
 */
export interface CompiledValidator<T> {
  /** Pure boolean type check: inline expansions with early returns, no allocation on the happy path. */
  readonly is: (value: unknown) => value is T;
  /** Collects every issue with its path; applies defaults, coercions, and transforms to `data`. */
  readonly safeParse: (value: unknown) => SafeParseResult<T>;
  /** Like `safeParse` but throws `JITValidationError` (with `.issues`) on failure. */
  readonly parse: (value: unknown) => T;
  /**
   * Awaited variant: promise wrappers are settled (`await`) and their
   * resolved values validated against the inner schema. Schemas without
   * promises resolve to the synchronous result.
   */
  readonly safeParseAsync: (value: unknown) => Promise<SafeParseResult<T>>;
  /** Like `safeParseAsync` but throws `JITValidationError` on failure. */
  readonly parseAsync: (value: unknown) => Promise<T>;
}

export type CompiledValidatorSelection<T, TOps extends readonly ValidatorOp[]> = Pick<
  CompiledValidator<T>,
  TOps[number]
>;

type MutableCompiledValidatorSelection<T> = {
  -readonly [TKey in keyof CompiledValidator<T>]?: CompiledValidator<T>[TKey];
};

/**
 * Emits the JavaScript source of a compiled validator (`is` + `safeParse`).
 *
 * @param schema - The schema to validate against.
 * @returns The generated validator source.
 */
export function emitValidatorSource(
  schema: ATS.AnyTypeSchema,
  options?: { readonly ops?: readonly ValidatorOp[] }
): string {
  return emitValidator(schema, emitOptionsForValidatorOps(options?.ops ?? VALIDATOR_OPS)).source;
}

/**
 * Compiles `is` / `parse` / `safeParse` for a schema.
 *
 * The generated code follows the codegen rules of every other JIT compiler:
 * static property access only (no `Object.keys` on known shapes), checks
 * ordered cheapest-first (`typeof` → comparisons → regex), classic indexed
 * loops, and no closures. Refinements, transforms, defaults, coercers, and
 * regexes travel as external bindings — never interpolated into the source.
 *
 * `safeParse` returns the input reference untouched when the schema has no
 * defaults/coercions/transforms; otherwise it builds the transformed output
 * inline while validating, in the same pass.
 *
 * @template TSchema - The schema driving codegen and type inference.
 * @param schema - The schema to validate against.
 * @param options - Pass `{ cache: false }` to bypass the compiled-function cache.
 * @returns The compiled validator triple.
 */
export function compileValidator<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options?: CompileCacheOptions
): CompiledValidator<ATS.TypeofSchema<TSchema>> {
  return compileValidatorSelection(schema, VALIDATOR_OPS, options) as CompiledValidator<ATS.TypeofSchema<TSchema>>;
}

export function compileValidatorSelection<TSchema extends ATS.AnyTypeSchema, const TOps extends readonly ValidatorOp[]>(
  schema: TSchema,
  ops: TOps,
  options?: CompileCacheOptions
): CompiledValidatorSelection<ATS.TypeofSchema<TSchema>, TOps> {
  type TValue = ATS.TypeofSchema<TSchema>;
  const normalizedOps = normalizeValidatorOps(ops);
  const cacheKey = `validator:${normalizedOps.join(",")}`;

  return getCompileCached(
    schema,
    cacheKey,
    () => {
      const emitted = emitValidator(schema, emitOptionsForValidatorOps(normalizedOps));
      const compiled = globalThis.Function(...emitted.bindings.names, emitted.source)(...emitted.bindings.values) as {
        readonly is?: (value: unknown) => value is TValue;
        readonly safeParse?: (value: unknown) => SafeParseResult<TValue>;
        readonly safeParseAsync?: (value: unknown) => Promise<SafeParseResult<TValue>>;
      };
      const selection: MutableCompiledValidatorSelection<TValue> = {};
      const safeParse = compiled.safeParse;
      const parse = (value: unknown): TValue => {
        if (!safeParse) throw new Error("parse requires safeParse generation");
        const result = safeParse(value);

        if (result.success) return result.data;

        throw new JITValidationError(result.issues);
      };
      // Promise-free schemas share the sync path behind an async signature.
      const safeParseAsync =
        compiled.safeParseAsync ??
        (safeParse ? async (value: unknown): Promise<SafeParseResult<TValue>> => safeParse(value) : undefined);
      const parseAsync = async (value: unknown): Promise<TValue> => {
        if (!safeParseAsync) throw new Error("parseAsync requires async validation generation");
        const result = await safeParseAsync(value);

        if (result.success) return result.data;

        throw new JITValidationError(result.issues);
      };

      if (normalizedOps.includes("is") && compiled.is) {
        selection.is = compiled.is;
        registerValidatorArtifact(compiled.is, schema, "is");
      }
      if (normalizedOps.includes("safeParse") && safeParse) {
        selection.safeParse = safeParse;
        registerValidatorArtifact(safeParse, schema, "safeParse");
      }
      if (normalizedOps.includes("parse")) {
        selection.parse = parse;
        registerValidatorArtifact(parse, schema, "parse");
      }
      if (normalizedOps.includes("safeParseAsync") && safeParseAsync) {
        selection.safeParseAsync = safeParseAsync;
        registerValidatorArtifact(safeParseAsync, schema, "safeParseAsync");
      }
      if (normalizedOps.includes("parseAsync")) {
        selection.parseAsync = parseAsync;
        registerValidatorArtifact(parseAsync, schema, "parseAsync");
      }

      return selection as CompiledValidatorSelection<TValue, TOps>;
    },
    options
  );
}

function registerValidatorArtifact<TSchema extends ATS.AnyTypeSchema>(
  fn: object,
  schema: TSchema,
  op: ValidatorOp
): void {
  registerArtifact(fn, { kind: "validator", schema, op });
}

function normalizeValidatorOps(ops: readonly ValidatorOp[]): readonly ValidatorOp[] {
  const normalized: ValidatorOp[] = [];

  for (const op of VALIDATOR_OPS) {
    if (ops.includes(op)) normalized.push(op);
  }
  return normalized;
}

function emitOptionsForValidatorOps(ops: readonly ValidatorOp[]) {
  return {
    is: ops.includes("is"),
    safeParse:
      ops.includes("safeParse") ||
      ops.includes("parse") ||
      ops.includes("safeParseAsync") ||
      ops.includes("parseAsync"),
    safeParseAsync: ops.includes("safeParseAsync") || ops.includes("parseAsync"),
  };
}
