import type { TypeSchema } from "../ats/index.js";

type Value<T> = T;
type Lazy<T> = () => T;
type Resolver<TSchema extends TypeSchema, TResult> = (schema: TSchema) => TResult;
export type Configurable<TResult, TSchema extends TypeSchema = TypeSchema> =
  | Value<TResult>
  | Lazy<TResult>
  | Resolver<TSchema, TResult>;
type KeyOf<T> = Extract<keyof T, string>;
export type PropertySelector<T> = KeyOf<T> | readonly KeyOf<T>[] | ((Value: T) => PropertyKey);
export type Compare<T> = (left: T, right: T) => number;
