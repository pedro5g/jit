import { type Clone, compileClone } from "../compiler/clone.js";
import { type CompiledCodec, compileCodec } from "../compiler/codec.js";
import { compileDiff, type Diff } from "../compiler/diff.js";
import { compileEqual, type Equal } from "../compiler/equal.js";
import { compileFormat, type Format } from "../compiler/format.js";
import { compileHash, type Hash } from "../compiler/hash.js";
import { compileJsonParse } from "../compiler/json-parse.js";
import { compileMask, type Mask } from "../compiler/mask.js";
import { compileSanitize, type Sanitize } from "../compiler/sanitize.js";
import { compileSerialize, type Serialize } from "../compiler/serialize.js";
import { compileUpdate, type Update } from "../compiler/update.js";
import { compileValidatorSelection, type SafeParseResult, type ValidatorOp } from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";

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
  "format",
  "mask",
  "sanitize",
  "codec",
] as const;

export type CompileOp = (typeof COMPILE_OPS)[number];

/** Complete operation vocabulary used only to type explicit `JIT.compile` selections. */
export interface CompiledOperations<T> {
  readonly is: (value: unknown) => value is T;
  readonly parse: (value: unknown) => T;
  readonly safeParse: (value: unknown) => SafeParseResult<T>;
  readonly safeParseAsync: (value: unknown) => Promise<SafeParseResult<T>>;
  readonly parseAsync: (value: unknown) => Promise<T>;
  readonly equal: Equal<T>;
  readonly clone: Clone<T>;
  readonly diff: Diff<T>;
  readonly hash: Hash<T>;
  readonly update: Update<T>;
  readonly stringify: Serialize<T>;
  readonly fromJSON: (json: string) => T;
  readonly format: T extends string ? Format : never;
  readonly mask: Mask<T>;
  readonly sanitize: Sanitize<T>;
  readonly codec: CompiledCodec<T>;
}

/**
 * The explicit aggregation: only the requested operations exist on the
 * object — nothing else is compiled, typed, or shipped.
 */
export type CompiledSelection<
  TSchema extends ATS.AnyTypeSchema,
  TOps extends readonly CompileOp[],
  TExtras extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
> = {
  readonly schema: TSchema;
  readonly ops: TOps;
  readonly extras: readonly Extract<keyof TExtras, string>[];
} & Pick<CompiledOperations<ATS.TypeofSchema<TSchema>>, TOps[number]> &
  Readonly<TExtras>;

export type CompiledObjectSelection<
  TSchema extends ATS.AnyTypeSchema,
  TCompiled extends Readonly<Record<string, unknown>>,
  TOps extends CompileOp = Extract<keyof TCompiled, CompileOp>,
> = {
  readonly schema: TSchema;
  readonly ops: readonly TOps[];
  readonly extras: readonly Exclude<Extract<keyof TCompiled, string>, CompileOp>[];
} & Pick<CompiledOperations<ATS.TypeofSchema<TSchema>>, TOps> &
  Readonly<Omit<TCompiled, CompileOp>>;

/**
 * Explicitly compiles a chosen set of operations for a schema and
 * aggregates them into one hot object. Nothing outside `ops` is compiled.
 *
 * The same object is the AOT marker: exporting it from a `*.jit.ts` file
 * makes `jit generate` emit exactly these operations for the schema —
 * maximum tree-shaking by construction, dead code never generated.
 *
 * @example
 * ```ts
 * const ops = JIT.compile(User, ["equal", "stringify"]);
 *
 * export const Users = JIT.compile(User, {
 *   is: JIT.is(User),
 *   equal: ops.equal,
 *   stringify: ops.stringify,
 *   findAdmins: JIT.query(UserList).filter((q) => q.eq("role", "admin")).compile(),
 *   toDTO: JIT.map.many(User, UserDTO, {}),
 * });
 *
 * Users.is(input);
 * Users.equal(a, b);            // Users.clone does not exist — not compiled
 * Users.findAdmins(list);       // dev-defined extras live on the same object
 * Users.toDTO(list);
 * ```
 */
export function compile<
  TSchema extends ATS.AnyTypeSchema,
  const TOps extends readonly CompileOp[],
  const TExtras extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
>(schema: SchemaInput<TSchema>, ops: TOps, extras?: TExtras): CompiledSelection<TSchema, TOps, TExtras>;

export function compile<TSchema extends ATS.AnyTypeSchema, const TCompiled extends Readonly<Record<string, unknown>>>(
  schema: SchemaInput<TSchema>,
  compiled: TCompiled
): CompiledObjectSelection<TSchema, TCompiled>;

export function compile<
  TSchema extends ATS.AnyTypeSchema,
  const TOps extends readonly CompileOp[],
  const TExtras extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
>(
  schema: SchemaInput<TSchema>,
  opsOrCompiled: TOps | TExtras,
  extras?: TExtras
): CompiledSelection<TSchema, TOps, TExtras> | CompiledObjectSelection<TSchema, TExtras> {
  type TValue = ATS.TypeofSchema<TSchema>;
  const unwrapped = unwrapSchema(schema);
  if (!Array.isArray(opsOrCompiled)) {
    return compileObjectSelection<TSchema, TExtras>(unwrapped as TSchema, opsOrCompiled as TExtras);
  }

  const ops = opsOrCompiled;
  const selection: Record<string, unknown> = {
    schema: unwrapped,
    ops: Object.freeze([...ops]),
  };
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
        const parseJson = compileJsonParse(unwrapped);
        const fromJSON = ((json: string) => getValidator().parse(parseJson(json)) as TValue) as (
          json: string
        ) => TValue;

        registerArtifact(fromJSON as object, {
          kind: "operation",
          schema: unwrapped,
          op: "fromJSON",
        });
        selection.fromJSON = fromJSON;
        break;
      }
      case "format":
        selection.format = compileFormat(unwrapped as ATS.StringSchema);
        break;
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

  return Object.freeze(selection) as CompiledSelection<TSchema, TOps, TExtras>;
}

function compileObjectSelection<
  TSchema extends ATS.AnyTypeSchema,
  const TCompiled extends Readonly<Record<string, unknown>>,
>(schema: TSchema, compiled: TCompiled): CompiledObjectSelection<TSchema, TCompiled> {
  const selection: Record<string, unknown> = {
    schema,
    ops: Object.freeze([]),
    extras: Object.freeze([]),
  };
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
  return Object.freeze(selection) as CompiledObjectSelection<TSchema, TCompiled>;
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
