import { compileUpdate, type UpdatePatch } from "../compiler/update.js";
import type { AnyTypeSchema, InferSchema, InnerTypeDef, LazyDef } from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import type { QueryParamRef } from "./query.js";

/**
 * Mutable draft shape accepted by update recipes.
 *
 * @template T - The value type being updated.
 */
export type Draft<T> = T extends readonly (infer TItem)[]
  ? Draft<TItem>[]
  : T extends Date
    ? T
    : T extends Set<unknown>
      ? T
      : T extends Map<unknown, unknown>
        ? T
        : T extends object
          ? { -readonly [TKey in keyof T]: Draft<T[TKey]> }
          : T;

/**
 * Recipe callback that records writes against a draft proxy.
 *
 * @template T - The value type being updated.
 * @param draft - The mutable draft proxy.
 * @returns Nothing; writes are captured as an update patch.
 */
export type UpdateRecipe<T> = (draft: Draft<T>) => void;
/**
 * Runtime update input: either a structural patch or a draft recipe.
 *
 * @template T - The value type being updated.
 */
export type UpdateInput<T> = UpdatePatch<T> | UpdateRecipe<T>;
/**
 * Runtime update function returned by `JIT.update(schema)`.
 *
 * @template T - The value type being updated.
 * @param value - The value to update.
 * @param input - A structural patch or draft recipe.
 * @returns The updated value.
 */
export type RuntimeUpdate<T> = ((value: T, input: UpdateInput<T>) => T) & {
  compile(): RuntimeUpdate<T>;
  patch<const TPatch extends UpdatePatchTemplate<T>>(
    patch: TPatch
  ): {
    compile(): (value: T, params: UpdatePatchParams<TPatch>) => T;
  };
};

export type UpdatePatchTemplate<T> = T extends object
  ? { readonly [TKey in keyof T]?: UpdatePatchTemplate<T[TKey]> | QueryParamRef<T[TKey]> | T[TKey] }
  : T | QueryParamRef<T>;

type UpdatePatchParamNames<TPatch> =
  TPatch extends QueryParamRef<unknown>
    ? TPatch["name"]
    : TPatch extends readonly unknown[]
      ? UpdatePatchParamNames<TPatch[number]>
      : TPatch extends object
        ? { [TKey in keyof TPatch]: UpdatePatchParamNames<TPatch[TKey]> }[keyof TPatch]
        : never;

export type UpdatePatchParams<TPatch> = [UpdatePatchParamNames<TPatch>] extends [never]
  ? Readonly<Record<never, never>>
  : Readonly<Record<Extract<UpdatePatchParamNames<TPatch>, string>, unknown>>;

/**
 * Compiles a runtime update function for a schema.
 *
 * @template TSchema - The schema type used for inference.
 * @param schema - The schema or builder used to compile updates.
 * @returns A reusable runtime update function.
 */
export function update<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeUpdate<InferSchema<TSchema>>;
/**
 * Applies an update immediately using a schema.
 *
 * @template TSchema - The schema type used for inference.
 * @param schema - The schema or builder used to compile updates.
 * @param value - The value to update.
 * @param input - A structural patch or draft recipe.
 * @returns The updated value.
 */
export function update<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  value: InferSchema<TSchema>,
  input: UpdateInput<InferSchema<TSchema>>
): InferSchema<TSchema>;
export function update<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: [] | [value: InferSchema<TSchema>, input: UpdateInput<InferSchema<TSchema>>]
): RuntimeUpdate<InferSchema<TSchema>> | InferSchema<TSchema> {
  const unwrapped = unwrapSchema(schema);

  assertUpdateable(unwrapped);

  const compiled = compileUpdate(unwrapped);
  const run = ((current: InferSchema<TSchema>, updateInput: UpdateInput<InferSchema<TSchema>>) => {
    const patch =
      typeof updateInput === "function"
        ? captureDraftPatch(updateInput as UpdateRecipe<InferSchema<TSchema>>)
        : updateInput;

    return compiled(current, patch);
  }) as RuntimeUpdate<InferSchema<TSchema>>;

  Object.defineProperties(run, {
    compile: {
      enumerable: false,
      value: () => run,
    },
    patch: {
      enumerable: false,
      value: (template: UpdatePatchTemplate<InferSchema<TSchema>>) => ({
        compile: () => (current: InferSchema<TSchema>, params: Readonly<Record<string, unknown>>) =>
          run(current, materializeParamPatch(template, params) as UpdatePatch<InferSchema<TSchema>>),
      }),
    },
  });

  if (args.length === 0) return run;

  return run(args[0], args[1]);
}

function materializeParamPatch(template: unknown, params: Readonly<Record<string, unknown>>): unknown {
  if (isParamRef(template)) return params[template.name];
  if (Array.isArray(template)) return template.map((value) => materializeParamPatch(value, params));

  if (template !== null && typeof template === "object") {
    const out: Record<string, unknown> = {};

    for (const key of Object.keys(template)) {
      out[key] = materializeParamPatch((template as Readonly<Record<string, unknown>>)[key], params);
    }
    return out;
  }

  return template;
}

function isParamRef(value: unknown): value is QueryParamRef {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { readonly __jitQueryValue?: unknown }).__jitQueryValue === "param"
  );
}

function captureDraftPatch<T>(recipe: UpdateRecipe<T>): UpdatePatch<T> {
  const writes: Array<{ readonly path: readonly PropertyKey[]; readonly value: unknown }> = [];
  const proxies = new Map<string, unknown>();

  const createDraft = (path: readonly PropertyKey[]): unknown => {
    const cacheKey = path.map(String).join("\u0000");
    const cached = proxies.get(cacheKey);

    if (cached) return cached;

    const draft = new Proxy(
      {},
      {
        get(_target, key) {
          if (typeof key === "symbol") return undefined;
          return createDraft([...path, key]);
        },
        set(_target, key, value) {
          if (typeof key === "symbol") {
            throw new JITError("INVALID_UPDATE", "Draft updates do not support symbol keys");
          }

          writes[writes.length] = { path: [...path, key], value };
          return true;
        },
      }
    );

    proxies.set(cacheKey, draft);
    return draft;
  };

  recipe(createDraft([]) as Draft<T>);

  return materializePatch(writes) as UpdatePatch<T>;
}

function materializePatch(writes: Array<{ readonly path: readonly PropertyKey[]; readonly value: unknown }>): unknown {
  const root: Record<string, unknown> = {};

  for (const write of writes) {
    let current: Record<string, unknown> | unknown[] = root;

    for (let index = 0; index < write.path.length; index++) {
      const segment = write.path[index];
      const key = normalizeKey(segment);
      const isLast = index === write.path.length - 1;

      if (isLast) {
        current[key as never] = write.value as never;
        continue;
      }

      const nextSegment = write.path[index + 1];
      const existing = current[key as never] as Record<string, unknown> | unknown[] | undefined;

      if (existing === undefined) {
        const next = isArrayKey(nextSegment) ? [] : {};
        current[key as never] = next as never;
        current = next;
      } else {
        current = existing;
      }
    }
  }

  return root;
}

function normalizeKey(key: PropertyKey): string | number {
  if (typeof key === "number") return key;
  if (typeof key === "string" && key !== "" && String(Number(key)) === key) return Number(key);
  return String(key);
}

function isArrayKey(key: PropertyKey | undefined): boolean {
  return typeof key === "number" || (typeof key === "string" && key !== "" && String(Number(key)) === key);
}

function assertUpdateable(schema: AnyTypeSchema): void {
  if (schema.type === TypeName.readonly) {
    throw new JITError("READONLY_FIELD", "Cannot compile updates for readonly schemas");
  }

  if (schema.type === TypeName.lazy) {
    assertUpdateable((schema.def as LazyDef<AnyTypeSchema>).getter());
    return;
  }

  if (hasInnerType(schema)) {
    assertUpdateable((schema.def as InnerTypeDef<AnyTypeSchema>).innerType);
    return;
  }

  if (schema.type === TypeName.object) {
    const objectSchema = schema as import("../core/ats/index.js").ObjectSchema<
      import("../core/ats/index.js").SchemaShape
    >;

    for (const child of Object.values(objectSchema.def.props)) {
      assertUpdateable(child);
    }
  }
}

function hasInnerType(schema: AnyTypeSchema): boolean {
  return (
    schema.type === TypeName.optional ||
    schema.type === TypeName.nullable ||
    schema.type === TypeName.nullish ||
    schema.type === TypeName.default ||
    schema.type === TypeName.brand ||
    schema.type === TypeName.transform ||
    schema.type === TypeName.pipe ||
    schema.type === TypeName.refine ||
    schema.type === TypeName.coerce ||
    schema.type === TypeName.promise
  );
}
