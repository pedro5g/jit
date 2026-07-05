import type * as ATS from "../core/ats/index.js";
import { JITValidationError, type ValidationIssue } from "../errors/index.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { emitValidator } from "./validate/emit-validate.js";

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
}

/**
 * Emits the JavaScript source of a compiled validator (`is` + `safeParse`).
 *
 * @param schema - The schema to validate against.
 * @returns The generated validator source.
 */
export function emitValidatorSource(schema: ATS.AnyTypeSchema): string {
  return emitValidator(schema).source;
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
): CompiledValidator<ATS.InferSchema<TSchema>> {
  type TValue = ATS.InferSchema<TSchema>;

  return getCompileCached(
    schema,
    "validator",
    () => {
      const emitted = emitValidator(schema);
      const compiled = globalThis.Function(...emitted.bindings.names, emitted.source)(...emitted.bindings.values) as {
        readonly is: (value: unknown) => value is TValue;
        readonly safeParse: (value: unknown) => SafeParseResult<TValue>;
      };
      const parse = (value: unknown): TValue => {
        const result = compiled.safeParse(value);

        if (result.success) return result.data;

        throw new JITValidationError(result.issues);
      };

      return { is: compiled.is, safeParse: compiled.safeParse, parse };
    },
    options
  );
}
