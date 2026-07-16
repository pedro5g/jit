import { type Clone, compileClone } from "../compiler/clone.js";
import { type CompiledCodec, compileCodec } from "../compiler/codec.js";
import { compileDiff, type Diff } from "../compiler/diff.js";
import { compileEqual, type Equal } from "../compiler/equal.js";
import { compileFormat, type Format } from "../compiler/format.js";
import { compileHash, type Hash } from "../compiler/hash.js";
import { compileMask, type Mask } from "../compiler/mask.js";
import { compileSanitize, type Sanitize } from "../compiler/sanitize.js";
import { compileSerialize, type Serialize } from "../compiler/serialize.js";
import type { Update, UpdatePatch } from "../compiler/update.js";
import { compileUpdate } from "../compiler/update.js";
import { compileValidator, type SafeParseResult } from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";

/**
 * Every compiled operation for one schema, gathered under a single object —
 * the runtime version of the generated `User.equal / User.is / User.parse`
 * namespaces. Each operation compiles lazily on first access and lands in
 * the shared per-schema compile cache.
 *
 * @template T - The value type described by the schema.
 */
export interface CompiledModel<T> {
  readonly schema: ATS.AnyTypeSchema;
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
 * Bundles every compiled operation for a schema into one namespace object.
 *
 * Operations compile on first access (and are cached per schema), so
 * creating a model is free and unsupported operations (e.g. `codec` on a
 * schema with Maps) only throw if actually used.
 *
 * @example
 * ```ts
 * const User = JIT.model(JIT.object({ id: JIT.number(), name: JIT.string() }));
 *
 * User.is(input);
 * User.parse(input);
 * User.equal(a, b);
 * const copy = User.clone(a);
 * res.end(User.stringify(copy));
 * ```
 */
export function model<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): CompiledModel<ATS.TypeofSchema<TSchema>> {
  type TValue = ATS.TypeofSchema<TSchema>;
  const unwrapped = unwrapSchema(schema);

  return {
    schema: unwrapped,
    get is() {
      return compileValidator<TSchema>(unwrapped as TSchema).is;
    },
    get parse() {
      return compileValidator<TSchema>(unwrapped as TSchema).parse;
    },
    get safeParse() {
      return compileValidator<TSchema>(unwrapped as TSchema).safeParse;
    },
    get safeParseAsync() {
      return compileValidator<TSchema>(unwrapped as TSchema).safeParseAsync;
    },
    get parseAsync() {
      return compileValidator<TSchema>(unwrapped as TSchema).parseAsync;
    },
    get equal() {
      return compileEqual(unwrapped) as Equal<TValue>;
    },
    get clone() {
      return compileClone(unwrapped) as Clone<TValue>;
    },
    get diff() {
      return compileDiff(unwrapped) as Diff<TValue>;
    },
    get hash() {
      return compileHash(unwrapped) as Hash<TValue>;
    },
    get update() {
      return compileUpdate(unwrapped) as Update<TValue>;
    },
    get stringify() {
      return compileSerialize(unwrapped) as Serialize<TValue>;
    },
    get fromJSON() {
      const validate = compileValidator<TSchema>(unwrapped as TSchema);

      return (json: string) => validate.parse(JSON.parse(json));
    },
    get format() {
      return compileFormat(unwrapped as ATS.StringSchema) as CompiledModel<TValue>["format"];
    },
    get mask() {
      return compileMask(unwrapped) as Mask<TValue>;
    },
    get sanitize() {
      return compileSanitize(unwrapped) as Sanitize<TValue>;
    },
    get codec() {
      return compileCodec(unwrapped) as CompiledCodec<TValue>;
    },
  };
}

export type { UpdatePatch };
