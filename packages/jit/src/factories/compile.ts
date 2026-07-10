import { compileClone } from "../compiler/clone.js";
import { compileCodec } from "../compiler/codec.js";
import { compileDiff } from "../compiler/diff.js";
import { compileEqual } from "../compiler/equal.js";
import { compileHash } from "../compiler/hash.js";
import { compileMask } from "../compiler/mask.js";
import { compileSanitize } from "../compiler/sanitize.js";
import { compileSerialize } from "../compiler/serialize.js";
import { compileUpdate } from "../compiler/update.js";
import { compileValidatorSelection, type ValidatorOp } from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import type { CompiledModel } from "./model.js";

/** Operations `JIT.compile` can aggregate. */
export const COMPILE_OPS = [
  "is",
  "parse",
  "safeParse",
  "parseAsync",
  "safeParseAsync",
  "equal",
  "clone",
  "diff",
  "hash",
  "update",
  "stringify",
  "fromJSON",
  "mask",
  "sanitize",
  "codec",
] as const;

export type CompileOp = (typeof COMPILE_OPS)[number];

/**
 * The explicit aggregation: only the requested operations exist on the
 * object — nothing else is compiled, typed, or shipped.
 */
export type CompiledSelection<
  T,
  TOps extends readonly CompileOp[],
  TExtras extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
> = {
  readonly schema: ATS.AnyTypeSchema;
  readonly ops: TOps;
  readonly extras: readonly Extract<keyof TExtras, string>[];
} & Pick<CompiledModel<T>, TOps[number]> &
  Readonly<TExtras>;

export type CompiledObjectSelection<
  T,
  TCompiled extends Readonly<Record<string, unknown>>,
  TOps extends CompileOp = Extract<keyof TCompiled, CompileOp>,
> = {
  readonly schema: ATS.AnyTypeSchema;
  readonly ops: readonly TOps[];
  readonly extras: readonly Exclude<Extract<keyof TCompiled, string>, CompileOp>[];
} & Pick<CompiledModel<T>, TOps> &
  Readonly<Omit<TCompiled, CompileOp>>;

/**
 * Explicitly compiles a chosen set of operations for a schema and
 * aggregates them into one hot object — the opt-in counterpart of the lazy
 * `JIT.model`. Nothing outside `ops` is compiled.
 *
 * The same object is the AOT marker: exporting it from a `*.jit.ts` file
 * makes `jit generate` emit exactly these operations for the schema —
 * maximum tree-shaking by construction, dead code never generated.
 *
 * @example
 * ```ts
 * export const Users = JIT.compile(User, ["is", "equal", "stringify"], {
 *   findAdmins: JIT.query(UserList).filter((q) => q.eq("role", "admin")).compile(),
 *   toDTO: JIT.mapper(User, UserDTO),
 * });
 *
 * Users.is(input);
 * Users.equal(a, b);            // Users.clone does not exist — not compiled
 * Users.findAdmins(list);       // dev-defined extras live on the same object
 * Users.toDTO.many(list);
 * ```
 */
export function compile<
  TSchema extends ATS.AnyTypeSchema,
  const TOps extends readonly CompileOp[],
  const TExtras extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
>(
  schema: SchemaInput<TSchema>,
  ops: TOps,
  extras?: TExtras
): CompiledSelection<ATS.InferSchema<TSchema>, TOps, TExtras>;

export function compile<TSchema extends ATS.AnyTypeSchema, const TCompiled extends Readonly<Record<string, unknown>>>(
  schema: SchemaInput<TSchema>,
  compiled: TCompiled
): CompiledObjectSelection<ATS.InferSchema<TSchema>, TCompiled>;

export function compile<
  TSchema extends ATS.AnyTypeSchema,
  const TOps extends readonly CompileOp[],
  const TExtras extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
>(
  schema: SchemaInput<TSchema>,
  opsOrCompiled: TOps | TExtras,
  extras?: TExtras
):
  | CompiledSelection<ATS.InferSchema<TSchema>, TOps, TExtras>
  | CompiledObjectSelection<ATS.InferSchema<TSchema>, TExtras> {
  type TValue = ATS.InferSchema<TSchema>;
  const unwrapped = unwrapSchema(schema);
  if (!Array.isArray(opsOrCompiled)) {
    return compileObjectSelection<TSchema, TExtras>(unwrapped as TSchema, opsOrCompiled as TExtras);
  }

  const ops = opsOrCompiled;
  const selection: Record<string, unknown> = { schema: unwrapped, ops: Object.freeze([...ops]) };
  const validatorOps = collectValidatorOps(ops);
  let validator: ReturnType<typeof compileValidatorSelection<TSchema, readonly ValidatorOp[]>> | undefined;
  const getValidator = () => {
    validator = validator ?? compileValidatorSelection(unwrapped as TSchema, validatorOps);
    return validator;
  };

  for (const op of ops) {
    switch (op) {
      case "is":
        selection.is = getValidator().is;
        break;
      case "parse":
        selection.parse = getValidator().parse;
        break;
      case "safeParse":
        selection.safeParse = getValidator().safeParse;
        break;
      case "parseAsync":
        selection.parseAsync = getValidator().parseAsync;
        break;
      case "safeParseAsync":
        selection.safeParseAsync = getValidator().safeParseAsync;
        break;
      case "fromJSON": {
        const parse = getValidator().parse;

        selection.fromJSON = (json: string) => parse(JSON.parse(json)) as TValue;
        break;
      }
      case "equal":
        selection.equal = compileEqual(unwrapped);
        break;
      case "clone":
        selection.clone = compileClone(unwrapped);
        break;
      case "diff":
        selection.diff = compileDiff(unwrapped);
        break;
      case "hash":
        selection.hash = compileHash(unwrapped);
        break;
      case "update":
        selection.update = compileUpdate(unwrapped);
        break;
      case "stringify":
        selection.stringify = compileSerialize(unwrapped);
        break;
      case "mask":
        selection.mask = compileMask(unwrapped);
        break;
      case "sanitize":
        selection.sanitize = compileSanitize(unwrapped);
        break;
      case "codec":
        selection.codec = compileCodec(unwrapped);
        break;
      default:
        throw new JITError("INVALID_OPERATION", `unknown compile op "${String(op)}"`);
    }
  }

  const extraNames: string[] = [];

  if (extras) {
    for (const key of Object.keys(extras)) {
      if (key === "schema" || key === "ops" || key === "extras" || key in selection) {
        throw new JITError("INVALID_OPERATION", `extra "${key}" collides with a compiled operation or reserved key`);
      }
      selection[key] = extras[key];
      extraNames.push(key);
    }
  }
  selection.extras = Object.freeze(extraNames);

  return Object.freeze(selection) as CompiledSelection<TValue, TOps, TExtras>;
}

function compileObjectSelection<
  TSchema extends ATS.AnyTypeSchema,
  const TCompiled extends Readonly<Record<string, unknown>>,
>(schema: TSchema, compiled: TCompiled): CompiledObjectSelection<ATS.InferSchema<TSchema>, TCompiled> {
  const selection: Record<string, unknown> = { schema, ops: Object.freeze([]), extras: Object.freeze([]) };
  const ops: string[] = [];
  const extras: string[] = [];

  for (const key of Object.keys(compiled)) {
    if (key === "schema" || key === "ops" || key === "extras") {
      throw new JITError("INVALID_OPERATION", `compiled key "${key}" is reserved`);
    }
    selection[key] = compiled[key];
    if (isCompileOp(key)) ops.push(key);
    else extras.push(key);
  }

  selection.ops = Object.freeze(ops);
  selection.extras = Object.freeze(extras);
  Object.defineProperty(selection, "__jitAot", {
    enumerable: false,
    value: "grouped",
  });
  return Object.freeze(selection) as CompiledObjectSelection<ATS.InferSchema<TSchema>, TCompiled>;
}

function isCompileOp(value: string): value is CompileOp {
  return (COMPILE_OPS as readonly string[]).includes(value);
}

function collectValidatorOps(ops: readonly CompileOp[]): readonly ValidatorOp[] {
  const validatorOps = new Set<ValidatorOp>();

  for (const op of ops) {
    if (op === "is" || op === "parse" || op === "safeParse" || op === "parseAsync" || op === "safeParseAsync") {
      validatorOps.add(op);
    }
    if (op === "fromJSON") validatorOps.add("parse");
  }
  return [...validatorOps];
}
