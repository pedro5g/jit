import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { resolveHints } from "../core/hints/index.js";
import { JITError } from "../errors/index.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { createEmitState, type EmitState } from "./emitter/emit-state.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitLiteral } from "./source/literal.js";

type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };
type ArraySchema = ATS.AnyTypeSchema & { readonly def: ATS.ElementDef };

/**
 * The deep-partial patch accepted by a compiled merge. Dates, arrays, Sets,
 * and Maps are replaced wholesale; plain objects merge key by key.
 *
 * @template T - The value type being merged into.
 */
export type MergeInput<T> = T extends Date
  ? T | undefined
  : T extends readonly unknown[]
    ? T | undefined
    : T extends Set<unknown>
      ? T | undefined
      : T extends Map<unknown, unknown>
        ? T | undefined
        : T extends object
          ? { readonly [TKey in keyof T]?: MergeInput<T[TKey]> }
          : T | undefined;

/**
 * A compiled structural merge. Returns `left` itself when nothing changed
 * (identity-preserving), a new object otherwise.
 *
 * @template T - The value type described by the schema.
 * @param left - The existing value.
 * @param right - The merge patch.
 * @returns `left` when no field changes, otherwise a merged value.
 */
export type Merge<T = unknown> = (left: T, right: MergeInput<T>) => T;
/**
 * A compiled pick: copies only the configured keys.
 *
 * @template T - The source object type.
 * @template TKeys - The keys kept by the compiled function.
 * @param value - The source object.
 * @returns An object containing only `TKeys`.
 */
export type PickCompiled<T, TKeys extends keyof T> = (value: T) => Pick<T, TKeys>;
/**
 * A compiled omit: copies everything except the configured keys.
 *
 * @template T - The source object type.
 * @template TKeys - The keys dropped by the compiled function.
 * @param value - The source object.
 * @returns An object without `TKeys`.
 */
export type OmitCompiled<T, TKeys extends keyof T> = (value: T) => Omit<T, TKeys>;
/**
 * Per-field transform callbacks. Each callback receives the field value and
 * the whole source object.
 *
 * @template T - The source object type.
 */
export type TransformSpec<T> = {
  readonly [TKey in keyof T]?: (value: T[TKey], source: T) => unknown;
};
export type TransformOutput<T, TSpec extends TransformSpec<T>> = {
  -readonly [TKey in keyof T]: TKey extends keyof TSpec
    ? TSpec[TKey] extends (...args: never[]) => infer TOutput
      ? TOutput
      : T[TKey]
    : T[TKey];
};
/**
 * A compiled per-field object transform.
 *
 * @template T - The source object type.
 * @template TSpec - The transform spec, whose return types drive the output type.
 * @param value - The source object.
 * @returns The transformed object.
 */
export type Transform<T, TSpec extends TransformSpec<T>> = (value: T) => TransformOutput<T, TSpec>;
/**
 * The `{ byId, ids }` shape produced by a compiled normalize.
 *
 * @template TEntity - The collection element type.
 * @template TKey - The key property used as the id.
 */
export interface Normalized<TEntity, TKey extends keyof TEntity> {
  readonly byId: Record<Extract<TEntity[TKey], PropertyKey>, TEntity>;
  readonly ids: Extract<TEntity[TKey], PropertyKey>[];
}
export type Normalize<TValue, TKey extends keyof ElementOf<TValue>> = (
  value: TValue
) => Normalized<ElementOf<TValue>, TKey>;
export type GroupBy<TValue, TKey extends keyof ElementOf<TValue>> = (
  value: TValue
) => Record<Extract<ElementOf<TValue>[TKey], PropertyKey>, ElementOf<TValue>[]>;
export type SortBy<TValue> = (value: TValue) => TValue;
export type UniqueBy<TValue> = (value: TValue) => ElementOf<TValue>[];

type ElementOf<TValue> = TValue extends readonly (infer TElement)[] ? TElement : never;

/**
 * Emits the JavaScript source of a compiled merge.
 *
 * @param schema - The object schema used to emit merge source.
 * @returns The generated merge source.
 */
export function emitMergeSource(schema: ATS.AnyTypeSchema): string {
  const writer = new CodeWriter();
  const objectSchema = expectObjectSchema(schema, "compileMerge");

  writer.line("function merge(left, right) {");
  writer.indent(() => {
    emitMergeTo(writer, createEmitState(), objectSchema, "left", "right", "out");
    writer.line("return out;");
  });
  writer.line("}");

  return writer.toString();
}

/**
 * Compiles an identity-preserving deep merge for the schema's object shape.
 *
 * @template TSchema - The object schema driving codegen and inference.
 * @param schema - The object schema used to compile the merge function.
 * @returns A specialized merge function.
 *
 * @example
 * ```ts
 * const merge = compileMerge(User.schema);
 * merge(user, {});                          // === user (nothing changed)
 * merge(user, { profile: { score: 1 } });   // new object, other keys shared
 * ```
 */
export function compileMerge<TSchema extends ATS.AnyTypeSchema>(schema: TSchema): Merge<ATS.Typeof<TSchema>> {
  return globalThis.Function(`return ${emitMergeSource(schema)};`)() as Merge<ATS.Typeof<TSchema>>;
}

/**
 * Emits the JavaScript source of a compiled pick projection.
 *
 * @template TSchema - The object schema driving source generation.
 * @param schema - The object schema used to validate selected keys.
 * @param keys - The keys to keep.
 * @returns The generated pick source.
 */
export function emitPickSource<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  keys: readonly (keyof ATS.Typeof<TSchema> & string)[]
): string {
  const objectSchema = expectObjectSchema(schema, "compilePick");
  const selectedKeys = validateObjectKeys(objectSchema, keys, "compilePick");

  return emitProjectSource("pick", selectedKeys);
}

/**
 * Compiles a pick projection: the generated code builds the result with a
 * single object literal over the selected keys (no key loops, no Set checks).
 *
 * @template TSchema - The object schema driving codegen and inference.
 * @template TKeys - The keys to keep, validated against the schema at compile time.
 * @param schema - The object schema used to compile the pick function.
 * @param keys - The keys to keep.
 * @returns A specialized pick projection.
 */
export function compilePick<
  TSchema extends ATS.AnyTypeSchema,
  const TKeys extends readonly (keyof ATS.Typeof<TSchema> & string)[],
>(schema: TSchema, keys: TKeys): PickCompiled<ATS.Typeof<TSchema>, TKeys[number]> {
  return globalThis.Function(`return ${emitPickSource(schema, keys)};`)() as PickCompiled<
    ATS.Typeof<TSchema>,
    TKeys[number]
  >;
}

/**
 * Emits the JavaScript source of a compiled omit projection.
 *
 * @template TSchema - The object schema driving source generation.
 * @param schema - The object schema used to validate omitted keys.
 * @param keys - The keys to drop.
 * @returns The generated omit source.
 */
export function emitOmitSource<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  keys: readonly (keyof ATS.Typeof<TSchema> & string)[]
): string {
  const objectSchema = expectObjectSchema(schema, "compileOmit");
  const omitted = new Set(validateObjectKeys(objectSchema, keys, "compileOmit"));
  const selectedKeys = Object.keys(objectSchema.def.props).filter((key) => !omitted.has(key));

  return emitProjectSource("omit", selectedKeys);
}

/**
 * Compiles an omit projection. The kept-key set is resolved at compile time,
 * so the generated code is a plain object literal. Omit costs the same as pick.
 *
 * @template TSchema - The object schema driving codegen and inference.
 * @template TKeys - The keys to drop, validated against the schema at compile time.
 * @param schema - The object schema used to compile the omit function.
 * @param keys - The keys to drop.
 * @returns A specialized omit projection.
 */
export function compileOmit<
  TSchema extends ATS.AnyTypeSchema,
  const TKeys extends readonly (keyof ATS.Typeof<TSchema> & string)[],
>(schema: TSchema, keys: TKeys): OmitCompiled<ATS.Typeof<TSchema>, TKeys[number]> {
  return globalThis.Function(`return ${emitOmitSource(schema, keys)};`)() as OmitCompiled<
    ATS.Typeof<TSchema>,
    TKeys[number]
  >;
}

/**
 * Emits the JavaScript source of a compiled per-field transform.
 *
 * @template TSchema - The object schema driving source generation.
 * @template TSpec - The transform spec whose callbacks become external bindings.
 * @param schema - The object schema used to compile the transform.
 * @param transforms - Per-field callbacks.
 * @returns The generated transform source.
 */
export function emitTransformSource<
  TSchema extends ATS.AnyTypeSchema,
  TSpec extends TransformSpec<ATS.Typeof<TSchema>>,
>(schema: TSchema, transforms: TSpec): string {
  const objectSchema = expectObjectSchema(schema, "compileTransform");
  const transformKeys = validateObjectKeys(objectSchema, Object.keys(transforms), "compileTransform");
  const transformNames = new Map(transformKeys.map((key, index) => [key, `__t${index}`]));
  const entries = Object.keys(objectSchema.def.props).map((key) => {
    const source = emitPropertyAccess("value", key);
    const transformName = transformNames.get(key);
    const value = transformName ? `${transformName}(${source}, value)` : source;

    return `${emitLiteral(key)}: ${value}`;
  });
  const writer = new CodeWriter();

  writer.line("function transform(value) {");
  writer.indent(() => writer.line(`return { ${entries.join(", ")} };`));
  writer.line("}");

  return writer.toString();
}

/**
 * Compiles a per-field transform. Fields without a callback are copied
 * directly; callbacks are external bindings called inline in the object
 * literal, so there is no per-field dispatch at runtime.
 *
 * @template TSchema - The object schema driving codegen and inference.
 * @template TSpec - The transform spec; its return types shape the output type.
 * @param schema - The object schema used to compile the transform.
 * @param transforms - Per-field callbacks.
 * @returns A specialized transform function.
 */
export function compileTransform<
  TSchema extends ATS.AnyTypeSchema,
  const TSpec extends TransformSpec<ATS.Typeof<TSchema>>,
>(schema: TSchema, transforms: TSpec): Transform<ATS.Typeof<TSchema>, TSpec> {
  const objectSchema = expectObjectSchema(schema, "compileTransform");
  const transformKeys = validateObjectKeys(objectSchema, Object.keys(transforms), "compileTransform");
  const bindings = transformKeys.map((key) => transforms[key as keyof TSpec]);

  return globalThis.Function(
    ...transformKeys.map((_, index) => `__t${index}`),
    `return ${emitTransformSource(schema, transforms)};`
  )(...bindings) as Transform<ATS.Typeof<TSchema>, TSpec>;
}

/**
 * Emits the JavaScript source of a compiled entity normalizer.
 *
 * @template TSchema - The array-of-objects schema driving source generation.
 * @param schema - The collection schema used to resolve the id key.
 * @param key - Optional explicit id key; defaults to the schema's keyed hint.
 * @returns The generated normalize source.
 */
export function emitNormalizeSource<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  key?: keyof ElementOf<ATS.Typeof<TSchema>> & string
): string {
  const resolved = resolveWrappers(schema).base;

  if (resolved.type !== TypeName.array) {
    throw new JITError("INVALID_OPERATION", "compileNormalize expects an array schema");
  }

  const element = resolveWrappers((resolved as ArraySchema).def.element).base;

  if (element.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", "compileNormalize expects an array of object schema");
  }

  const objectSchema = element as ObjectSchema;
  const normalizeKey = key ?? resolveNormalizeKey(schema);

  if (!normalizeKey) {
    throw new JITError("INVALID_OPERATION", "compileNormalize requires a key or a .keyed()/index/entity hint");
  }

  validateObjectKeys(objectSchema, [normalizeKey], "compileNormalize");

  const idAccess = emitPropertyAccess("item", normalizeKey);
  const writer = new CodeWriter();

  writer.line("function normalize(value) {");
  writer.indent(() => {
    writer.line("const len = value.length;");
    writer.line("const byId = {};");
    writer.line("const ids = new Array(len);");
    writer.line("for (let i = 0; i < len; i++) {");
    writer.indent(() => {
      writer.line("const item = value[i];");
      writer.line(`const id = ${idAccess};`);
      writer.line("ids[i] = id;");
      writer.line("byId[id] = item;");
    });
    writer.line("}");
    writer.line("return { byId, ids };");
  });
  writer.line("}");

  return writer.toString();
}

/**
 * Compiles an entity normalizer producing `{ byId, ids }` in one pass.
 * The key comes from the schema's `keyed()` hint unless passed explicitly.
 *
 * @template TSchema - The array-of-objects schema driving codegen.
 * @template TKey - The element property used as the id.
 * @param schema - The collection schema used to compile the normalizer.
 * @param key - Optional explicit id key; defaults to the schema's keyed hint.
 * @returns A specialized normalizer.
 */
export function compileNormalize<
  TSchema extends ATS.AnyTypeSchema,
  TKey extends keyof ElementOf<ATS.Typeof<TSchema>> & string,
>(schema: TSchema, key?: TKey): Normalize<ATS.Typeof<TSchema>, TKey> {
  return globalThis.Function(`return ${emitNormalizeSource(schema, key)};`)() as Normalize<ATS.Typeof<TSchema>, TKey>;
}

/**
 * Emits the JavaScript source of a compiled groupBy operation.
 *
 * @template TSchema - The array-of-objects schema driving source generation.
 * @param schema - The collection schema used to resolve the group key.
 * @param key - Optional explicit group key; defaults to the schema's groupBy hint.
 * @returns The generated groupBy source.
 */
export function emitGroupBySource<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  key?: keyof ElementOf<ATS.Typeof<TSchema>> & string
): string {
  const { objectSchema, key: groupKey } = expectArrayObjectKey(schema, key, "compileGroupBy", resolveGroupByKey);
  validateObjectKeys(objectSchema, [groupKey], "compileGroupBy");

  const keyAccess = emitPropertyAccess("item", groupKey);
  const writer = new CodeWriter();

  writer.line("function groupBy(value) {");
  writer.indent(() => {
    writer.line("const out = {};");
    writer.line("for (let i = 0, len = value.length; i < len; i++) {");
    writer.indent(() => {
      writer.line("const item = value[i];");
      writer.line(`const key = ${keyAccess};`);
      writer.line("let group = out[key];");
      writer.line("if (group === undefined) {");
      writer.indent(() => {
        writer.line("group = [];");
        writer.line("out[key] = group;");
      });
      writer.line("}");
      writer.line("group[group.length] = item;");
    });
    writer.line("}");
    writer.line("return out;");
  });
  writer.line("}");

  return writer.toString();
}

/**
 * Compiles a single-pass groupBy keyed by the schema's `groupBy()` hint
 * (or an explicit key).
 *
 * @template TSchema - The array-of-objects schema driving codegen.
 * @template TKey - The element property used as the group key.
 * @param schema - The collection schema used to compile groupBy.
 * @param key - Optional explicit group key; defaults to the schema's groupBy hint.
 * @returns A specialized groupBy function.
 */
export function compileGroupBy<
  TSchema extends ATS.AnyTypeSchema,
  TKey extends keyof ElementOf<ATS.Typeof<TSchema>> & string,
>(schema: TSchema, key?: TKey): GroupBy<ATS.Typeof<TSchema>, TKey> {
  return globalThis.Function(`return ${emitGroupBySource(schema, key)};`)() as GroupBy<ATS.Typeof<TSchema>, TKey>;
}

/**
 * Emits the JavaScript source of a compiled non-mutating sort.
 *
 * @template TSchema - The array-of-objects schema driving source generation.
 * @param schema - The collection schema used to resolve the sort key.
 * @param key - Optional explicit sort key; defaults to the schema's sortBy hint.
 * @param direction - Sort direction, defaulting to ascending.
 * @returns The generated sort source.
 */
export function emitSortBySource<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  key?: keyof ElementOf<ATS.Typeof<TSchema>> & string,
  direction?: "asc" | "desc"
): string {
  const hints = resolveHints(schema);
  const hintKey = typeof hints.order?.key === "string" ? hints.order.key : resolveNormalizeKey(schema);
  const sortKey = key ?? hintKey;

  if (!sortKey) {
    throw new JITError("INVALID_OPERATION", "compileSortBy requires a key or a .ordered()/.keyed()/index/entity hint");
  }

  const { objectSchema } = expectArrayObjectKey(schema, sortKey, "compileSortBy", () => sortKey);
  const sortDirection = direction ?? (typeof hints.order?.direction === "string" ? hints.order.direction : "asc");
  const leftAccess = emitPropertyAccess("left", sortKey);
  const rightAccess = emitPropertyAccess("right", sortKey);
  const writer = new CodeWriter();

  validateObjectKeys(objectSchema, [sortKey], "compileSortBy");

  writer.line("function sortBy(value) {");
  writer.indent(() => {
    writer.line("const out = value.slice();");
    writer.line("out.sort((left, right) => {");
    writer.indent(() => {
      writer.line(`const leftValue = ${leftAccess};`);
      writer.line(`const rightValue = ${rightAccess};`);
      writer.line("if (leftValue === rightValue) return 0;");
      if (sortDirection === "desc") {
        writer.line("return leftValue < rightValue ? 1 : -1;");
      } else {
        writer.line("return leftValue < rightValue ? -1 : 1;");
      }
    });
    writer.line("});");
    writer.line("return out;");
  });
  writer.line("}");

  return writer.toString();
}

/**
 * Compiles a non-mutating sort specialized for the schema's `sortBy()` hint:
 * the comparator is inlined for the known key and direction.
 *
 * @template TSchema - The array-of-objects schema carrying the order hint.
 * @param schema - The collection schema used to compile sortBy.
 * @param key - Optional explicit sort key; defaults to the schema's sortBy hint.
 * @param direction - Sort direction, defaulting to ascending.
 * @returns A specialized non-mutating sort function.
 */
export function compileSortBy<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  key?: keyof ElementOf<ATS.Typeof<TSchema>> & string,
  direction?: "asc" | "desc"
): SortBy<ATS.Typeof<TSchema>> {
  return globalThis.Function(`return ${emitSortBySource(schema, key, direction)};`)() as SortBy<ATS.Typeof<TSchema>>;
}

/**
 * Emits the JavaScript source of a compiled uniqueBy operation.
 *
 * @template TSchema - The array-of-objects schema driving source generation.
 * @param schema - The collection schema used to resolve the unique key.
 * @param key - Optional explicit unique key; defaults to the schema's uniqueBy hint.
 * @returns The generated uniqueBy source.
 */
export function emitUniqueBySource<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  key?: keyof ElementOf<ATS.Typeof<TSchema>> & string
): string {
  const { objectSchema, key: uniqueKey } = expectArrayObjectKey(schema, key, "compileUniqueBy", resolveNormalizeKey);

  validateObjectKeys(objectSchema, [uniqueKey], "compileUniqueBy");

  const keyAccess = emitPropertyAccess("item", uniqueKey);
  const writer = new CodeWriter();

  writer.line("function uniqueBy(value) {");
  writer.indent(() => {
    writer.line("const seen = new Set();");
    writer.line("const out = [];");
    writer.line("for (let i = 0, len = value.length; i < len; i++) {");
    writer.indent(() => {
      writer.line("const item = value[i];");
      writer.line(`const key = ${keyAccess};`);
      writer.line("if (!seen.has(key)) {");
      writer.indent(() => {
        writer.line("seen.add(key);");
        writer.line("out[out.length] = item;");
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line("return out;");
  });
  writer.line("}");

  return writer.toString();
}

/**
 * Compiles a single-pass uniqueBy: first occurrence of each key wins.
 *
 * @template TSchema - The array-of-objects schema carrying the uniqueBy hint.
 * @template TKey - The element property used for deduplication.
 * @param schema - The collection schema used to compile uniqueBy.
 * @param key - Optional explicit unique key; defaults to the schema's uniqueBy hint.
 * @returns A specialized uniqueBy function.
 */
export function compileUniqueBy<
  TSchema extends ATS.AnyTypeSchema,
  TKey extends keyof ElementOf<ATS.Typeof<TSchema>> & string,
>(schema: TSchema, key?: TKey): UniqueBy<ATS.Typeof<TSchema>> {
  return globalThis.Function(`return ${emitUniqueBySource(schema, key)};`)() as UniqueBy<ATS.Typeof<TSchema>>;
}

function emitMergeTo(
  writer: CodeWriter,
  state: EmitState,
  schema: ObjectSchema,
  left: string,
  right: string,
  target: string
): void {
  const entries: string[] = [];
  const changed: string[] = [];

  writer.line(`let ${target} = ${left};`);
  writer.line(`if (${right} !== undefined && !Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    for (const key of Object.keys(schema.def.props)) {
      const propSchema = schema.def.props[key];
      const next = state.nextVar(`next_${key}`);

      emitMergeProp(writer, state, propSchema, emitPropertyAccess(left, key), emitPropertyAccess(right, key), next);
      entries.push(`${emitLiteral(key)}: ${next}`);
      changed.push(`!Object.is(${next}, ${emitPropertyAccess(left, key)})`);
    }

    writer.line(`if (${changed.join(" || ")}) {`);
    writer.indent(() => writer.line(`${target} = { ${entries.join(", ")} };`));
    writer.line("}");
  });
  writer.line("}");
}

function emitMergeProp(
  writer: CodeWriter,
  state: EmitState,
  schema: ATS.AnyTypeSchema,
  left: string,
  right: string,
  target: string
): void {
  const resolved = resolveWrappers(schema).base;

  if (resolved.type !== TypeName.object) {
    writer.line(`const ${target} = ${right} !== undefined ? ${right} : ${left};`);
    return;
  }

  writer.line(`let ${target} = ${left};`);
  writer.line(`if (${right} !== undefined && !Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    writer.line(`if (${left} == null || ${right} == null) {`);
    writer.indent(() => writer.line(`${target} = ${right};`));
    writer.line("} else {");
    writer.indent(() => {
      const merged = state.nextVar(`${target}_merged`);

      emitMergeTo(writer, state, resolved as ObjectSchema, left, right, merged);
      writer.line(`${target} = ${merged};`);
    });
    writer.line("}");
  });
  writer.line("}");
}

function emitProjectSource(name: "pick" | "omit", selectedKeys: readonly string[]): string {
  const entries = selectedKeys.map((key) => `${emitLiteral(key)}: ${emitPropertyAccess("value", key)}`);
  const writer = new CodeWriter();

  writer.line(`function ${name}(value) {`);
  writer.indent(() => writer.line(`return { ${entries.join(", ")} };`));
  writer.line("}");

  return writer.toString();
}

function expectObjectSchema(schema: ATS.AnyTypeSchema, compilerName: string): ObjectSchema {
  const resolved = resolveWrappers(schema).base;

  if (resolved.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", `${compilerName} expects an object schema`);
  }

  return resolved as ObjectSchema;
}

function validateObjectKeys(schema: ObjectSchema, keys: readonly string[], compilerName: string): string[] {
  const props = schema.def.props;

  for (const key of keys) {
    if (!(key in props)) {
      throw new JITError("INVALID_OPERATION", `${compilerName} received unknown key ${JSON.stringify(key)}`, {
        path: [key],
      });
    }
  }

  return [...keys];
}

function resolveNormalizeKey(schema: ATS.AnyTypeSchema): string | undefined {
  const hints = resolveHints(schema);
  const key = hints.collection?.uniqueBy ?? hints.index?.key ?? hints.collection?.identify ?? hints.entity?.key;

  return typeof key === "string" ? key : undefined;
}

function resolveGroupByKey(schema: ATS.AnyTypeSchema): string | undefined {
  const hints = resolveHints(schema);
  const key = hints.collection?.groupBy ?? hints.index?.key ?? hints.collection?.identify ?? hints.entity?.key;

  return typeof key === "string" ? key : undefined;
}

function expectArrayObjectKey(
  schema: ATS.AnyTypeSchema,
  key: string | undefined,
  compilerName: string,
  resolveKey: (schema: ATS.AnyTypeSchema) => string | undefined
): { readonly objectSchema: ObjectSchema; readonly key: string } {
  const resolved = resolveWrappers(schema).base;

  if (resolved.type !== TypeName.array) {
    throw new JITError("INVALID_OPERATION", `${compilerName} expects an array schema`);
  }

  const element = resolveWrappers((resolved as ArraySchema).def.element).base;

  if (element.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", `${compilerName} expects an array of object schema`);
  }

  const resolvedKey = key ?? resolveKey(schema);

  if (!resolvedKey) {
    throw new JITError("INVALID_OPERATION", `${compilerName} requires a key or a compatible array hint`);
  }

  return { objectSchema: element as ObjectSchema, key: resolvedKey };
}
