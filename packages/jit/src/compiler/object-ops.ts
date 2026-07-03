import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { resolveHints } from "../core/hints/index.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { createEmitState, type EmitState } from "./emitter/emit-state.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitLiteral } from "./source/literal.js";

type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };
type ArraySchema = ATS.AnyTypeSchema & { readonly def: ATS.ElementDef };

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

export type Merge<T = unknown> = (left: T, right: MergeInput<T>) => T;
export type PickCompiled<T, TKeys extends keyof T> = (value: T) => Pick<T, TKeys>;
export type OmitCompiled<T, TKeys extends keyof T> = (value: T) => Omit<T, TKeys>;
export type TransformSpec<T> = { readonly [TKey in keyof T]?: (value: T[TKey], source: T) => unknown };
export type TransformOutput<T, TSpec extends TransformSpec<T>> = {
  readonly [TKey in keyof T]: TKey extends keyof TSpec
    ? TSpec[TKey] extends (...args: never[]) => infer TOutput
      ? TOutput
      : T[TKey]
    : T[TKey];
};
export type Transform<T, TSpec extends TransformSpec<T>> = (value: T) => TransformOutput<T, TSpec>;
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

export function compileMerge<TSchema extends ATS.AnyTypeSchema>(schema: TSchema): Merge<ATS.Infer<TSchema>> {
  return globalThis.Function(`return ${emitMergeSource(schema)};`)() as Merge<ATS.Infer<TSchema>>;
}

export function emitPickSource<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  keys: readonly (keyof ATS.Infer<TSchema> & string)[]
): string {
  const objectSchema = expectObjectSchema(schema, "compilePick");
  const selectedKeys = validateObjectKeys(objectSchema, keys, "compilePick");

  return emitProjectSource("pick", selectedKeys);
}

export function compilePick<
  TSchema extends ATS.AnyTypeSchema,
  const TKeys extends readonly (keyof ATS.Infer<TSchema> & string)[],
>(schema: TSchema, keys: TKeys): PickCompiled<ATS.Infer<TSchema>, TKeys[number]> {
  return globalThis.Function(`return ${emitPickSource(schema, keys)};`)() as PickCompiled<
    ATS.Infer<TSchema>,
    TKeys[number]
  >;
}

export function emitOmitSource<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  keys: readonly (keyof ATS.Infer<TSchema> & string)[]
): string {
  const objectSchema = expectObjectSchema(schema, "compileOmit");
  const omitted = new Set(validateObjectKeys(objectSchema, keys, "compileOmit"));
  const selectedKeys = Object.keys(objectSchema.def.props).filter((key) => !omitted.has(key));

  return emitProjectSource("omit", selectedKeys);
}

export function compileOmit<
  TSchema extends ATS.AnyTypeSchema,
  const TKeys extends readonly (keyof ATS.Infer<TSchema> & string)[],
>(schema: TSchema, keys: TKeys): OmitCompiled<ATS.Infer<TSchema>, TKeys[number]> {
  return globalThis.Function(`return ${emitOmitSource(schema, keys)};`)() as OmitCompiled<
    ATS.Infer<TSchema>,
    TKeys[number]
  >;
}

export function emitTransformSource<TSchema extends ATS.AnyTypeSchema, TSpec extends TransformSpec<ATS.Infer<TSchema>>>(
  schema: TSchema,
  transforms: TSpec
): string {
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

export function compileTransform<
  TSchema extends ATS.AnyTypeSchema,
  const TSpec extends TransformSpec<ATS.Infer<TSchema>>,
>(schema: TSchema, transforms: TSpec): Transform<ATS.Infer<TSchema>, TSpec> {
  const objectSchema = expectObjectSchema(schema, "compileTransform");
  const transformKeys = validateObjectKeys(objectSchema, Object.keys(transforms), "compileTransform");
  const bindings = transformKeys.map((key) => transforms[key as keyof TSpec]);

  return globalThis.Function(
    ...transformKeys.map((_, index) => `__t${index}`),
    `return ${emitTransformSource(schema, transforms)};`
  )(...bindings) as Transform<ATS.Infer<TSchema>, TSpec>;
}

export function emitNormalizeSource<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  key?: keyof ElementOf<ATS.Infer<TSchema>> & string
): string {
  const resolved = resolveWrappers(schema).base;

  if (resolved.type !== TypeName.array) {
    throw new TypeError("compileNormalize expects an array schema");
  }

  const element = resolveWrappers((resolved as ArraySchema).def.element).base;

  if (element.type !== TypeName.object) {
    throw new TypeError("compileNormalize expects an array of object schema");
  }

  const objectSchema = element as ObjectSchema;
  const normalizeKey = key ?? resolveNormalizeKey(schema);

  if (!normalizeKey) {
    throw new TypeError("compileNormalize requires a key or a .keyed()/index/entity hint");
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

export function compileNormalize<
  TSchema extends ATS.AnyTypeSchema,
  TKey extends keyof ElementOf<ATS.Infer<TSchema>> & string,
>(schema: TSchema, key?: TKey): Normalize<ATS.Infer<TSchema>, TKey> {
  return globalThis.Function(`return ${emitNormalizeSource(schema, key)};`)() as Normalize<ATS.Infer<TSchema>, TKey>;
}

export function emitGroupBySource<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  key?: keyof ElementOf<ATS.Infer<TSchema>> & string
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

export function compileGroupBy<
  TSchema extends ATS.AnyTypeSchema,
  TKey extends keyof ElementOf<ATS.Infer<TSchema>> & string,
>(schema: TSchema, key?: TKey): GroupBy<ATS.Infer<TSchema>, TKey> {
  return globalThis.Function(`return ${emitGroupBySource(schema, key)};`)() as GroupBy<ATS.Infer<TSchema>, TKey>;
}

export function emitSortBySource<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  key?: keyof ElementOf<ATS.Infer<TSchema>> & string,
  direction?: "asc" | "desc"
): string {
  const hints = resolveHints(schema);
  const hintKey = typeof hints.order?.key === "string" ? hints.order.key : resolveNormalizeKey(schema);
  const sortKey = key ?? hintKey;

  if (!sortKey) {
    throw new TypeError("compileSortBy requires a key or a .ordered()/.keyed()/index/entity hint");
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

export function compileSortBy<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  key?: keyof ElementOf<ATS.Infer<TSchema>> & string,
  direction?: "asc" | "desc"
): SortBy<ATS.Infer<TSchema>> {
  return globalThis.Function(`return ${emitSortBySource(schema, key, direction)};`)() as SortBy<ATS.Infer<TSchema>>;
}

export function emitUniqueBySource<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  key?: keyof ElementOf<ATS.Infer<TSchema>> & string
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

export function compileUniqueBy<
  TSchema extends ATS.AnyTypeSchema,
  TKey extends keyof ElementOf<ATS.Infer<TSchema>> & string,
>(schema: TSchema, key?: TKey): UniqueBy<ATS.Infer<TSchema>> {
  return globalThis.Function(`return ${emitUniqueBySource(schema, key)};`)() as UniqueBy<ATS.Infer<TSchema>>;
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
    throw new TypeError(`${compilerName} expects an object schema`);
  }

  return resolved as ObjectSchema;
}

function validateObjectKeys(schema: ObjectSchema, keys: readonly string[], compilerName: string): string[] {
  const props = schema.def.props;

  for (const key of keys) {
    if (!(key in props)) {
      throw new TypeError(`${compilerName} received unknown key ${JSON.stringify(key)}`);
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
    throw new TypeError(`${compilerName} expects an array schema`);
  }

  const element = resolveWrappers((resolved as ArraySchema).def.element).base;

  if (element.type !== TypeName.object) {
    throw new TypeError(`${compilerName} expects an array of object schema`);
  }

  const resolvedKey = key ?? resolveKey(schema);

  if (!resolvedKey) {
    throw new TypeError(`${compilerName} requires a key or a compatible array hint`);
  }

  return { objectSchema: element as ObjectSchema, key: resolvedKey };
}
