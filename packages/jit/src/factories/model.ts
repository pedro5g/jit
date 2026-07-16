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
import { compileValidatorSelection, type SafeParseResult, type ValidatorOp } from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";

export const MODEL_OPS = [
  "is",
  "parse",
  "safeParse",
  "safeParseAsync",
  "parseAsync",
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

export type ModelOp = (typeof MODEL_OPS)[number];
export type ModelOptions = Readonly<Partial<Record<ModelOp, boolean>>>;

/** Every operation that can be exposed by a schema model. */
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

export type ModelSelection<T, TOps extends readonly ModelOp[]> = {
  readonly schema: ATS.AnyTypeSchema;
  readonly ops: TOps;
} & Pick<CompiledModel<T>, TOps[number]>;

type EnabledModelOp<TOptions extends ModelOptions> = {
  [TOp in Extract<keyof TOptions, ModelOp>]-?: TOptions[TOp] extends true ? TOp : never;
}[Extract<keyof TOptions, ModelOp>];

export type ConfiguredModel<T, TOptions extends ModelOptions> = {
  readonly schema: ATS.AnyTypeSchema;
  readonly ops: readonly EnabledModelOp<TOptions>[];
} & Pick<CompiledModel<T>, EnabledModelOp<TOptions>>;

export interface ModelGet<T> {
  /** Compiles exactly the selected operations and omits every other property. */
  get<const TOps extends readonly ModelOp[]>(...ops: TOps): ModelSelection<T, TOps>;
}

export type ModelFacade<T> = CompiledModel<T> &
  ModelGet<T> & {
    readonly ops: typeof MODEL_OPS;
  };

/**
 * Creates a lazy full model. Direct property access compiles one operation;
 * `.get(...)` produces a narrow model containing only the requested methods.
 */
export function model<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): ModelFacade<ATS.TypeofSchema<TSchema>>;
/** Creates a narrow model from an explicit boolean operation configuration. */
export function model<TSchema extends ATS.AnyTypeSchema, const TOptions extends ModelOptions>(
  schema: SchemaInput<TSchema>,
  options: TOptions
): ConfiguredModel<ATS.TypeofSchema<TSchema>, TOptions>;
export function model<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: ModelOptions
): ModelFacade<ATS.TypeofSchema<TSchema>> | ConfiguredModel<ATS.TypeofSchema<TSchema>, ModelOptions> {
  type TValue = ATS.TypeofSchema<TSchema>;
  const unwrapped = unwrapSchema(schema);
  const selections = new Map<string, object>();

  const select = <const TOps extends readonly ModelOp[]>(ops: TOps): ModelSelection<TValue, TOps> => {
    const normalized = normalizeModelOps(ops);
    const key = normalized.join(",");
    const cached = selections.get(key);

    if (cached) return cached as ModelSelection<TValue, TOps>;

    const selection: Record<string, unknown> = {
      schema: unwrapped,
      ops: Object.freeze([...normalized]),
    };
    const validatorOps = collectValidatorOps(normalized);
    const validator =
      validatorOps.length > 0 ? compileValidatorSelection(unwrapped as TSchema, validatorOps) : undefined;

    for (const op of normalized) {
      selection[op] = compileModelOperation<TSchema, TValue>(op, unwrapped as TSchema, validator);
    }
    Object.defineProperty(selection, "__jitAot", {
      enumerable: false,
      value: "grouped",
    });

    const compiled = Object.freeze(selection) as ModelSelection<TValue, TOps>;

    selections.set(key, compiled);
    return compiled;
  };

  if (options) {
    const selected: ModelOp[] = [];

    for (const key of Object.keys(options)) {
      if (!isModelOp(key)) throw new JITError("INVALID_OPERATION", `unknown model operation ${JSON.stringify(key)}`);
      if (options[key]) selected.push(key);
    }
    return select(selected) as unknown as ConfiguredModel<TValue, ModelOptions>;
  }

  const target: Record<string, unknown> = {
    schema: unwrapped,
    ops: MODEL_OPS,
    get<const TOps extends readonly ModelOp[]>(...ops: TOps): ModelSelection<TValue, TOps> {
      return select(ops);
    },
  };

  for (const op of MODEL_OPS) {
    Object.defineProperty(target, op, {
      configurable: false,
      enumerable: true,
      get() {
        return select([op] as const)[op];
      },
    });
  }
  Object.defineProperty(target, "__jitAot", {
    enumerable: false,
    value: "grouped",
  });

  return Object.freeze(target) as unknown as ModelFacade<TValue>;
}

function compileModelOperation<TSchema extends ATS.AnyTypeSchema, TValue>(
  op: ModelOp,
  schema: TSchema,
  validator: Partial<Record<ValidatorOp, unknown>> | undefined
): unknown {
  switch (op) {
    case "is":
    case "parse":
    case "safeParse":
    case "parseAsync":
    case "safeParseAsync":
      return validator?.[op];
    case "equal":
      return compileEqual(schema) as Equal<TValue>;
    case "clone":
      return compileClone(schema) as Clone<TValue>;
    case "diff":
      return compileDiff(schema) as Diff<TValue>;
    case "hash":
      return compileHash(schema) as Hash<TValue>;
    case "update":
      return compileUpdate(schema) as Update<TValue>;
    case "stringify":
      return compileSerialize(schema) as Serialize<TValue>;
    case "fromJSON": {
      const parse = validator?.parse as ((value: unknown) => TValue) | undefined;

      if (!parse) throw new JITError("INVALID_OPERATION", "fromJSON requires the parse compiler");
      return (json: string) => parse(JSON.parse(json));
    }
    case "format":
      return compileFormat(schema as unknown as ATS.StringSchema);
    case "mask":
      return compileMask(schema) as Mask<TValue>;
    case "sanitize":
      return compileSanitize(schema) as Sanitize<TValue>;
    case "codec":
      return compileCodec(schema) as CompiledCodec<TValue>;
  }
}

function normalizeModelOps(ops: readonly ModelOp[]): readonly ModelOp[] {
  const normalized: ModelOp[] = [];

  for (const op of ops) {
    if (!isModelOp(op)) throw new JITError("INVALID_OPERATION", `unknown model operation ${JSON.stringify(op)}`);
  }

  for (const op of MODEL_OPS) {
    if (ops.includes(op)) normalized.push(op);
  }
  return normalized;
}

function isModelOp(value: string): value is ModelOp {
  return (MODEL_OPS as readonly string[]).includes(value);
}

function isValidatorOp(value: ModelOp): value is ValidatorOp {
  return (
    value === "is" || value === "parse" || value === "safeParse" || value === "parseAsync" || value === "safeParseAsync"
  );
}

function collectValidatorOps(ops: readonly ModelOp[]): readonly ValidatorOp[] {
  const selected = new Set<ValidatorOp>();

  for (const op of ops) {
    if (isValidatorOp(op)) selected.add(op);
    else if (op === "fromJSON") selected.add("parse");
  }
  return [...selected];
}

export type { UpdatePatch };
