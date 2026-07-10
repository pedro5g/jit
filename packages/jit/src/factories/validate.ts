import {
  type CompiledValidator,
  compileValidatorSelection,
  VALIDATOR_OPS,
  type ValidatorOp,
} from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import type { CompileCacheOptions } from "../runtime/cache/compile-cache.js";

export interface ValidatorGet<T> {
  get<TOp extends ValidatorOp>(...ops: TOp[]): Pick<CompiledValidator<T>, TOp>;
}

export type ValidatorFacade<T> = CompiledValidator<T> & ValidatorGet<T>;

export interface ValidatorFactoryOptions extends CompileCacheOptions {
  readonly is?: boolean;
  readonly parse?: boolean;
  readonly safeParse?: boolean;
  readonly parseAsync?: boolean;
  readonly safeParseAsync?: boolean;
  readonly asyncParse?: boolean;
  readonly asyncSafeParse?: boolean;
}

type EnabledValidatorOps<TOptions> =
  | (TOptions extends { readonly is: true } ? "is" : never)
  | (TOptions extends { readonly parse: true } ? "parse" : never)
  | (TOptions extends { readonly safeParse: true } ? "safeParse" : never)
  | (TOptions extends { readonly parseAsync: true } ? "parseAsync" : never)
  | (TOptions extends { readonly asyncParse: true } ? "parseAsync" : never)
  | (TOptions extends { readonly safeParseAsync: true } ? "safeParseAsync" : never)
  | (TOptions extends { readonly asyncSafeParse: true } ? "safeParseAsync" : never);

type ValidatorReturn<T, TOptions> = [EnabledValidatorOps<NonNullable<TOptions>>] extends [never]
  ? ValidatorFacade<T>
  : Pick<CompiledValidator<T>, EnabledValidatorOps<NonNullable<TOptions>>> & ValidatorGet<T>;

const facadeCache = new WeakMap<ATS.AnyTypeSchema, ValidatorFacade<unknown>>();

/**
 * Compiles the validator triple (`is`, `parse`, `safeParse`) for a schema.
 *
 * @example
 * ```ts
 * const User = JIT.object({
 *   name: JIT.string().min(2),
 *   email: JIT.string().email(),
 *   age: JIT.number().int().min(0),
 * });
 *
 * const Users = JIT.validator(User);
 *
 * Users.is(input);                 // boolean type guard, zero allocation
 * Users.parse(input);              // typed data or JITValidationError
 * const result = Users.safeParse(input);
 * if (!result.success) result.issues; // [{ path: "email", code: "invalid_format", ... }]
 * ```
 */
export function validator<
  TSchema extends ATS.AnyTypeSchema,
  const TOptions extends ValidatorFactoryOptions | undefined = undefined,
>(schema: SchemaInput<TSchema>, options?: TOptions): ValidatorReturn<ATS.InferSchema<TSchema>, TOptions> {
  const unwrapped = unwrapSchema(schema);
  const ops = selectedOpsFromOptions(options);

  if (ops.length > 0) {
    return attachGet(unwrapped, compileValidatorSelection(unwrapped, ops, options), options) as ValidatorReturn<
      ATS.InferSchema<TSchema>,
      TOptions
    >;
  }

  if (options?.cache === false)
    return createValidatorFacade(unwrapped, options) as ValidatorReturn<ATS.InferSchema<TSchema>, TOptions>;

  const cached = facadeCache.get(unwrapped);
  if (cached) return cached as ValidatorReturn<ATS.InferSchema<TSchema>, TOptions>;

  const facade = createValidatorFacade(unwrapped, options);
  facadeCache.set(unwrapped, facade as ValidatorFacade<unknown>);
  return facade as ValidatorReturn<ATS.InferSchema<TSchema>, TOptions>;
}

function createValidatorFacade<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options: CompileCacheOptions | undefined
): ValidatorFacade<ATS.InferSchema<TSchema>> {
  const target = {
    get<TOp extends ValidatorOp>(...ops: TOp[]): Pick<CompiledValidator<ATS.InferSchema<TSchema>>, TOp> {
      return compileValidatorSelection(schema, ops, options);
    },
  };

  for (const op of VALIDATOR_OPS) {
    Object.defineProperty(target, op, {
      configurable: false,
      enumerable: true,
      get() {
        return compileValidatorSelection(schema, [op], options)[op];
      },
    });
  }
  return Object.freeze(target) as ValidatorFacade<ATS.InferSchema<TSchema>>;
}

function attachGet<TSchema extends ATS.AnyTypeSchema, TSelection extends object>(
  schema: TSchema,
  selection: TSelection,
  options: CompileCacheOptions | undefined
): TSelection & ValidatorGet<ATS.InferSchema<TSchema>> {
  return Object.freeze({
    ...selection,
    get<TOp extends ValidatorOp>(...ops: TOp[]): Pick<CompiledValidator<ATS.InferSchema<TSchema>>, TOp> {
      return compileValidatorSelection(schema, ops, options);
    },
  });
}

function selectedOpsFromOptions(options: ValidatorFactoryOptions | undefined): ValidatorOp[] {
  if (!options) return [];

  const ops: ValidatorOp[] = [];

  if (options.is) ops.push("is");
  if (options.parse) ops.push("parse");
  if (options.safeParse) ops.push("safeParse");
  if (options.parseAsync || options.asyncParse) ops.push("parseAsync");
  if (options.safeParseAsync || options.asyncSafeParse) ops.push("safeParseAsync");
  return ops;
}
