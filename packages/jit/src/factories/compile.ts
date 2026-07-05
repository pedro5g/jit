import { compileClone } from "../compiler/clone.js";
import { compileCodec } from "../compiler/codec.js";
import { compileDiff } from "../compiler/diff.js";
import { compileEqual } from "../compiler/equal.js";
import { compileHash } from "../compiler/hash.js";
import { compileMask } from "../compiler/mask.js";
import { compileSanitize } from "../compiler/sanitize.js";
import { compileSerialize } from "../compiler/serialize.js";
import { compileUpdate } from "../compiler/update.js";
import { compileValidator } from "../compiler/validate.js";
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
export type CompiledSelection<T, TOps extends readonly CompileOp[]> = {
  readonly schema: ATS.AnyTypeSchema;
  readonly ops: TOps;
} & Pick<CompiledModel<T>, TOps[number]>;

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
 * export const Users = JIT.compile(User, ["is", "equal", "stringify"]);
 *
 * Users.is(input);
 * Users.equal(a, b);        // Users.clone does not exist — not compiled
 * ```
 */
export function compile<TSchema extends ATS.AnyTypeSchema, const TOps extends readonly CompileOp[]>(
  schema: SchemaInput<TSchema>,
  ops: TOps
): CompiledSelection<ATS.InferSchema<TSchema>, TOps> {
  type TValue = ATS.InferSchema<TSchema>;
  const unwrapped = unwrapSchema(schema);
  const selection: Record<string, unknown> = { schema: unwrapped, ops: Object.freeze([...ops]) };
  let validator: ReturnType<typeof compileValidator<TSchema>> | undefined;
  const getValidator = () => {
    validator = validator ?? compileValidator<TSchema>(unwrapped as TSchema);
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

  return Object.freeze(selection) as CompiledSelection<TValue, TOps>;
}
