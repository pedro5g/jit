import { ATS } from "../ATS/index.js";
import type { Literal } from "../shared/types.js";

const _type = (): any => null;

export const any = /*@__PURE__*/ (): ATS.TypeSchema<any> => ({
  _type: _type(),
  type: ATS.TypeName.any,
});

export const unknown = /*@__PURE__*/ (): ATS.TypeSchema<unknown> => ({
  _type: _type(),
  type: ATS.TypeName.unknown,
});
export const never = /*@__PURE__*/ (): ATS.TypeSchema<never> => ({
  _type: _type() as never,
  type: ATS.TypeName.never,
});

export { voidType as void };
export const voidType = /*@__PURE__*/ (): ATS.TypeSchema<void> => ({
  _type: _type(),
  type: ATS.TypeName.void,
});

export const file = /*@__PURE__*/ (): ATS.TypeSchema<File> => ({
  _type: _type(),
  type: ATS.TypeName.file,
});

export const string = /*@__PURE__*/ (): ATS.TypeSchema<string> => ({
  _type: _type(),
  type: ATS.TypeName.string,
});

export const nan = /*@__PURE__*/ (): ATS.TypeSchema<typeof NaN> => ({
  _type: _type(),
  type: ATS.TypeName.number,
});

export const number = /*@__PURE__*/ (): ATS.TypeSchema<number> => ({
  _type: _type(),
  type: ATS.TypeName.number,
});

export const int = /*@__PURE__*/ (): ATS.TypeSchema<number> => ({
  _type: _type(),
  type: ATS.TypeName.int,
});

export const bitInt = /*@__PURE__*/ (): ATS.TypeSchema<bigint> => ({
  _type: _type(),
  type: ATS.TypeName.bigint,
});

export const boolean = /*@__PURE__*/ (): ATS.TypeSchema<boolean> => ({
  _type: _type(),
  type: ATS.TypeName.boolean,
});

export { nil as null };

export const nil = /*@__PURE__*/ (): ATS.TypeSchema<null> => ({
  _type: _type(),
  type: ATS.TypeName.null,
});

export const nullable = <T>(item: ATS.TypeSchema<T>): ATS.TypeSchema<T | null> => ({
  _type: _type(),
  type: ATS.TypeName.nullable,
  item,
});

export { undefinedType as undefined };
export const undefinedType = /*@__PURE__*/ (): ATS.TypeSchema<undefined> => ({
  _type: _type(),
  type: ATS.TypeName.undefined,
});

export const symbol = /*@__PURE__*/ (): ATS.TypeSchema<symbol> => ({
  _type: _type(),
  type: ATS.TypeName.symbol,
});

export const regex = /*@__PURE__*/ (): ATS.TypeSchema<RegExp> => ({
  _type: _type(),
  type: ATS.TypeName.regex,
});

export const date = /*@__PURE__*/ (): ATS.TypeSchema<Date> => ({
  _type: _type(),
  type: ATS.TypeName.date,
});

export const literal = /*@__PURE__*/ <T>(val: Literal<T>): ATS.TypeSchema<T> => ({
  _type: _type(),
  type: ATS.TypeName.literal,
  literalValue: val,
});

export const optional = /*@__PURE__*/ <T>(item: ATS.TypeSchema<T>): ATS.TypeSchema<T | undefined> => ({
  _type: _type(),
  type: ATS.TypeName.optional,
  item,
});

export const array = /*@__PURE__*/ <T>(item: ATS.TypeSchema<T>): ATS.TypeSchema<T[]> => ({
  _type: _type(),
  type: ATS.TypeName.array,
  item,
});

export const set = /*@__PURE__*/ <T>(item: ATS.TypeSchema<T>): ATS.TypeSchema<Set<T>> => ({
  _type: _type(),
  type: ATS.TypeName.set,
  item,
});

export const map = /*@__PURE__*/ <K extends ATS.TypeSchema<any>, V extends ATS.TypeSchema<any>>(
  key: K,
  value: V
): ATS.TypeSchema<Map<K, V>> => ({
  _type: _type(),
  type: ATS.TypeName.map,
  key,
  value,
});

export { nativeEnum as enum };
export const nativeEnum = /*@__PURE__*/ <T extends Record<string, string | number>>(
  enumObj: T
): ATS.TypeSchema<T[keyof T]> => ({
  _type: _type(),
  type: ATS.TypeName.enum,
  enumObject: enumObj,
});

export const record = /*@__PURE__*/ <K extends ATS.TypeSchema<string | number | symbol>, V extends ATS.TypeSchema<any>>(
  key: K,
  value: V
): ATS.TypeSchema<Record<ATS.Infer<K>, ATS.Infer<V>>> => ({
  _type: _type(),
  type: ATS.TypeName.record,
  key,
  value,
});

export const object = /*@__PURE__*/ <T extends Record<string, ATS.TypeSchema<any>>>(
  props: T
): ATS.TypeSchema<{
  [K in keyof T]: ATS.Infer<T[K]>;
}> => ({
  _type: _type(),
  type: ATS.TypeName.object,
  props,
});

export const union = /*@__PURE__*/ <T extends ATS.TypeSchema<any>[]>(
  ...schemas: T
): ATS.TypeSchema<ATS.Infer<T[number]>> => ({
  _type: _type(),
  type: ATS.TypeName.union,
  schemas,
});

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
type InferIntersection<T extends ATS.TypeSchema<any>[]> = UnionToIntersection<ATS.Infer<T[number]>>;

export const intersection /*@__PURE__*/ = <T extends ATS.TypeSchema<any>[]>(
  ...schemas: T
): ATS.TypeSchema<InferIntersection<T>> => ({
  _type: _type(),
  type: ATS.TypeName.intersection,
  schemas,
});

export const tupla = /*@__PURE__*/ <T extends ATS.TypeSchema<any>[]>(...items: T): ATS.TypeSchema<T> => ({
  _type: _type(),
  type: ATS.TypeName.tuple,
  items,
});

export { defaultTo as default };
export const defaultTo = /*@__PURE__*/ <T>(
  schema: ATS.TypeSchema<T>,
  defaultValue: T | (() => T)
): ATS.TypeSchema<T> => ({
  _type: _type(),
  type: "default",
  item: schema,
  defaultValue,
});

export const brand = /*@__PURE__*/ <K, T extends string>(
  schema: ATS.TypeSchema<K>,
  name: T
): ATS.TypeSchema<ATS.Brand<K, T>> => ({
  _type: _type(),
  type: "brand",
  item: schema,
  brandName: name,
});

export const pipe = /*@__PURE__*/ <In, Out>(
  schema: ATS.TypeSchema<In>,
  transformFn: (val: In) => Out
): ATS.TypeSchema<Out> => ({
  _type: _type(),
  type: "pipe",
  item: schema,
  transform: transformFn,
});
