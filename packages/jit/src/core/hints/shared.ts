import type { TypeSchema } from "../ats/index.js";

export type Value<T> = T;
export type Lazy<T> = () => T;
export type Resolver<TSchema extends TypeSchema, TResult> = (schema: TSchema) => TResult;
export type Configurable<TResult, TSchema extends TypeSchema = TypeSchema> =
  | Value<TResult>
  | Lazy<TResult>
  | Resolver<TSchema, TResult>;
export type KeyOf<T> = Extract<keyof T, string>;
export type PropertySelector<T> = KeyOf<T> | readonly KeyOf<T>[] | ((Value: T) => PropertyKey);
export type Compare<T> = (left: T, right: T) => number;
export type Equality<T> = (left: T, right: T) => boolean;
export type Predicate<T> = (value: T) => boolean;
export type Mapper<TInput, TOutput> = (value: TInput) => TOutput;
