import { Utils } from "../shared/index.js";

export type AnyTypeName = TypeName[keyof TypeName];
export type TypeName = typeof TypeName;
export const TypeName = {
  string: "string",
  number: "number",
  int: "int",
  nan: "nan",
  null: "null",
  nullable: "nullable",
  boolean: "boolean",
  object: "object",
  optional: "optional",
  array: "array",
  set: "set",
  tuple: "tuple",
  union: "union",
  record: "record",
  map: "map",
  unknown: "unknown",
  file: "file",
  any: "any",
  void: "void",
  never: "never",
  enum: "enum",
  literal: "literal",
  bigint: "bigint",
  date: "date",
  symbol: "symbol",
  regex: "regex",
  undefined: "undefined",
  intersection: "intersection",
  default: "default",
  brand: "brand",
  lazy: "lazy",
  pipe: "pipe",
} as const;

export const TypeNames = Utils.Object_keys(TypeName) as AnyTypeName[];

type PrimitiveTypeSchema = {
  type:
    | "any"
    | "unknown"
    | "never"
    | "void"
    | "string"
    | "number"
    | "bigint"
    | "int"
    | "null"
    | "boolean"
    | "undefined"
    | "symbol"
    | "date"
    | "regex"
    | "file";
};

type ObjectTypeSchema = {
  type: "object";
  props: Record<string, TypeSchema<any>>;
};

type ArraySetOrOptionalSchema = {
  type: "array" | "set" | "optional" | "nullable";
  item: TypeSchema<any>;
};

type MapOrRecordSchema = {
  type: "record" | "map";
  key: TypeSchema<any>;
  value: TypeSchema<any>;
};

type UnionSchema = {
  type: "union";
  schemas: TypeSchema<any>[];
};
type IntersectionSchema = {
  type: "intersection";
  schemas: TypeSchema<any>[];
};

type TupleSchema = {
  type: "tuple";
  items: TypeSchema<any>[];
};

type EnumSchema = {
  type: "enum";
  enumObject: Record<string, string | number>;
};

type LiteralSchema = {
  type: "literal";
  literalValue: any;
};

type LazySchema = {
  type: "lazy";
  getter: () => TypeSchema<any>;
};

type BrandSchema = {
  type: "brand";
  item: TypeSchema;
  brandName: string;
};

type DefaultSchema = {
  type: "default";
  item: TypeSchema<any>;
  defaultValue: any | (() => any);
};

type PipeSchema = {
  type: "pipe";
  item: TypeSchema<any>;
  transform: (val: any) => any;
};

export type TypeSchema<T = any> = {
  _type: T; //phantom type to TS
  type: AnyTypeName;
} & (
  | PrimitiveTypeSchema
  | ObjectTypeSchema
  | ArraySetOrOptionalSchema
  | MapOrRecordSchema
  | UnionSchema
  | IntersectionSchema
  | TupleSchema
  | LiteralSchema
  | EnumSchema
  | LazySchema
  | DefaultSchema
  | BrandSchema
  | PipeSchema
);
export type Brand<K, T> = K & { readonly __brand: T };

export type Infer<T extends TypeSchema> = T["_type"];

export type InferTuple<T extends TypeSchema<any>[]> = {
  [K in keyof T]: T[K] extends TypeSchema<any> ? Infer<T[K]> : never;
};
