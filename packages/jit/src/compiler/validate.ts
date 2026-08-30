import type * as ATS from "../core/ats/index.js";
import { JITValidationError, type ValidationIssue } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { canUseFastParse, emitValidator } from "./validate/emit-validate.js";

export const VALIDATOR_OPS = ["is", "parse", "safeParse", "parseAsync", "safeParseAsync"] as const;

export type ValidatorOp = (typeof VALIDATOR_OPS)[number];

export interface ValidationCompileOptions extends CompileCacheOptions {
  /** Stops diagnostic validation after exactly this many issues. */
  readonly maxIssues?: number;
}

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
  options?: { readonly ops?: readonly ValidatorOp[]; readonly maxIssues?: number }
): string {
  const ops = options?.ops ?? VALIDATOR_OPS;
  validateMaxIssues(options?.maxIssues);

  return emitValidator(schema, {
    ...emitOptionsForValidatorOps(ops, ops.includes("parse") && canUseFastParse(schema)),
    ...(options?.maxIssues === undefined ? {} : { maxIssues: options.maxIssues }),
  }).source;
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
  options?: ValidationCompileOptions
): CompiledValidator<ATS.TypeofSchema<TSchema>> {
  return compileValidatorSelection(schema, VALIDATOR_OPS, options) as CompiledValidator<ATS.TypeofSchema<TSchema>>;
}

/**
 * Compiles the persisted-state boundary used by runtime-class `hydrate()`.
 * Defaults remain required: persistence must not silently turn a truncated
 * record into a newly-created entity.
 */
export function compileHydrator<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options?: CompileCacheOptions
): (state: unknown) => ATS.TypeofSchema<TSchema> {
  return getCompileCached(
    schema,
    "hydrator",
    () => {
      const safeParse = compileSafeHydrator(schema, options);

      return (state: unknown) => {
        const result = safeParse(state);
        if (result.success) return result.data;
        throw new JITValidationError(result.issues);
      };
    },
    options
  );
}

/**
 * The same persisted-state boundary, reporting issues instead of throwing.
 *
 * A configured factory result policy needs the issues, not an exception, so
 * both boundaries share one compiled pass rather than validating twice.
 */
export function compileSafeHydrator<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options?: ValidationCompileOptions
): (state: unknown) => SafeParseResult<ATS.TypeofSchema<TSchema>> {
  validateMaxIssues(options?.maxIssues);
  return getCompileCached(
    schema,
    `hydrator:safe:max=${options?.maxIssues ?? "all"}`,
    () => {
      const emitted = emitValidator(schema, {
        is: false,
        safeParse: true,
        safeParseAsync: false,
        resolveDefaults: false,
        ...(options?.maxIssues === undefined ? {} : { maxIssues: options.maxIssues }),
      });
      return globalThis.Function(...emitted.bindings.names, emitted.source)(...emitted.bindings.values).safeParse as (
        value: unknown
      ) => SafeParseResult<ATS.TypeofSchema<TSchema>>;
    },
    options
  );
}

export function compileValidatorSelection<TSchema extends ATS.AnyTypeSchema, const TOps extends readonly ValidatorOp[]>(
  schema: TSchema,
  ops: TOps,
  options?: ValidationCompileOptions
): CompiledValidatorSelection<ATS.TypeofSchema<TSchema>, TOps> {
  type TValue = ATS.TypeofSchema<TSchema>;
  const normalizedOps = normalizeValidatorOps(ops);
  validateMaxIssues(options?.maxIssues);
  // `is` is the allocation-free proof that a value is already valid. When the
  // schema cannot rebuild, both parse and safeParse can lead with it and skip
  // the issue-collecting traversal entirely on the common path.
  const fastParse = canUseFastParse(schema) && (normalizedOps.includes("parse") || normalizedOps.includes("safeParse"));
  const cacheKey = `validator:${normalizedOps.join(",")}:max=${options?.maxIssues ?? "all"}`;

  return getCompileCached(
    schema,
    cacheKey,
    () => {
      const emitted = emitValidator(schema, {
        ...emitOptionsForValidatorOps(normalizedOps, fastParse),
        ...(options?.maxIssues === undefined ? {} : { maxIssues: options.maxIssues }),
      });
      const compiled = globalThis.Function(...emitted.bindings.names, emitted.source)(...emitted.bindings.values) as {
        readonly is?: (value: unknown) => value is TValue;
        readonly safeParse?: (value: unknown) => SafeParseResult<TValue>;
        readonly safeParseAsync?: (value: unknown) => Promise<SafeParseResult<TValue>>;
      };
      const selection: MutableCompiledValidatorSelection<TValue> = {};
      const is = compiled.is;
      const safeParse = compiled.safeParse;
      const fastSafeParse =
        fastParse && is && safeParse
          ? (value: unknown): SafeParseResult<TValue> => (is(value) ? { success: true, data: value } : safeParse(value))
          : safeParse;
      const parse = (value: unknown): TValue => {
        if (fastParse && is?.(value)) return value;
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
        registerValidatorArtifact(compiled.is, schema, "is", options?.maxIssues);
      }
      if (normalizedOps.includes("safeParse") && fastSafeParse) {
        selection.safeParse = fastSafeParse;
        registerValidatorArtifact(fastSafeParse, schema, "safeParse", options?.maxIssues);
      }
      if (normalizedOps.includes("parse")) {
        selection.parse = parse;
        registerValidatorArtifact(parse, schema, "parse", options?.maxIssues);
      }
      if (normalizedOps.includes("safeParseAsync") && safeParseAsync) {
        selection.safeParseAsync = safeParseAsync;
        registerValidatorArtifact(safeParseAsync, schema, "safeParseAsync", options?.maxIssues);
      }
      if (normalizedOps.includes("parseAsync")) {
        selection.parseAsync = parseAsync;
        registerValidatorArtifact(parseAsync, schema, "parseAsync", options?.maxIssues);
      }

      return selection as CompiledValidatorSelection<TValue, TOps>;
    },
    options
  );
}

function registerValidatorArtifact<TSchema extends ATS.AnyTypeSchema>(
  fn: object,
  schema: TSchema,
  op: ValidatorOp,
  maxIssues?: number
): void {
  registerArtifact(fn, { kind: "validator", schema, op, ...(maxIssues === undefined ? {} : { maxIssues }) });
}

function validateMaxIssues(value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("maxIssues must be a positive safe integer");
}

function normalizeValidatorOps(ops: readonly ValidatorOp[]): readonly ValidatorOp[] {
  const normalized: ValidatorOp[] = [];

  for (const op of VALIDATOR_OPS) {
    if (ops.includes(op)) normalized.push(op);
  }
  return normalized;
}

function emitOptionsForValidatorOps(ops: readonly ValidatorOp[], fastParse = false) {
  return {
    is: ops.includes("is") || fastParse,
    safeParse:
      ops.includes("safeParse") ||
      ops.includes("parse") ||
      ops.includes("safeParseAsync") ||
      ops.includes("parseAsync"),
    safeParseAsync: ops.includes("safeParseAsync") || ops.includes("parseAsync"),
  };
}
