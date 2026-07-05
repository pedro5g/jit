import type * as ATS from "../core/ats/index.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import {
  combineHash,
  getHash,
  hashBigInt,
  hashBoolean,
  hashNumber,
  hashString,
  hashUnknown,
  isHashCacheable,
} from "../runtime/hash/index.js";
import { emitPropertyAccess } from "./source/access.js";

/**
 * A compiled structural hash function. Values that compare equal under the
 * schema's compiled equality always produce the same hash.
 *
 * @template T - The value type described by the schema the hash was compiled from.
 * @param value - The value to hash.
 * @returns A deterministic numeric hash.
 */
export type Hash<T = unknown> = (value: T) => number;

interface HashSchema {
  readonly type: ATS.AnyTypeName;
  readonly def: Readonly<Record<string, unknown>>;
}

/**
 * Emits the JavaScript source of a schema-aware hash function.
 *
 * @param schema - The schema used to emit hash source.
 * @returns The complete JavaScript source for the generated hash function.
 */
export function emitHashSource(schema: ATS.AnyTypeSchema): string {
  return `function hash(value) {\n${emitHashBody(schema)}\n}`;
}

/**
 * Compiles a schema-aware structural hash function.
 *
 * Hashes for cacheable (object) values are memoized in a WeakMap-backed cache,
 * so hashing the same object twice is O(1). This is what makes hash-based
 * equality short-circuiting profitable.
 *
 * @template TSchema - The schema driving both codegen and the inferred value type.
 * @param schema - The schema used to compile the hash function.
 * @returns A specialized hash function for values inferred from `schema`.
 */
export function compileHash<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options?: CompileCacheOptions
): Hash<ATS.Infer<TSchema>> {
  return getCompileCached(
    schema,
    "hash",
    () => {
      const compute = globalThis.Function(
        "__combineHash",
        "__hashNumber",
        "__hashString",
        "__hashBoolean",
        "__hashBigInt",
        "__hashUnknown",
        `return function computeHash(value) {\n${emitHashBody(schema)}\n};`
      )(combineHash, hashNumber, hashString, hashBoolean, hashBigInt, hashUnknown) as Hash<ATS.Infer<TSchema>>;

      return ((value: ATS.Infer<TSchema>) => {
        if (isHashCacheable(value)) {
          return getHash(value, compute as (value: object) => number);
        }

        return compute(value);
      }) as Hash<ATS.Infer<TSchema>>;
    },
    options
  );
}

function emitHashBody(schema: ATS.AnyTypeSchema): string {
  const lines: string[] = [];

  emitHashInto(lines, schema as HashSchema, "value", "h", 1);
  lines.push("  return h;");

  return lines.join("\n");
}

function emitHashInto(lines: string[], schema: HashSchema, value: string, target: string, depth: number): void {
  const pad = "  ".repeat(depth);
  const next = `${target}_${depth}`;

  switch (schema.type) {
    case "number":
    case "int":
    case "nan":
      lines.push(`${pad}let ${target} = __hashNumber(${value});`);
      return;
    case "string":
      lines.push(`${pad}let ${target} = __hashString(${value});`);
      return;
    case "boolean":
      lines.push(`${pad}let ${target} = __hashBoolean(${value});`);
      return;
    case "bigint":
      lines.push(`${pad}let ${target} = __hashBigInt(${value});`);
      return;
    case "date":
      lines.push(`${pad}let ${target} = __hashNumber(${value}.getTime());`);
      return;
    case "null":
      lines.push(`${pad}let ${target} = 1;`);
      return;
    case "undefined":
    case "void":
      lines.push(`${pad}let ${target} = 0;`);
      return;
    case "literal":
    case "enum":
    case "any":
    case "unknown":
    case "never":
    case "symbol":
    case "file":
    case "regex":
      lines.push(`${pad}let ${target} = __hashUnknown(${value});`);
      return;
    case "optional":
      lines.push(`${pad}let ${target};`);
      lines.push(`${pad}if (${value} === undefined) {`);
      lines.push(`${pad}  ${target} = 0;`);
      lines.push(`${pad}} else {`);
      emitHashInto(lines, schema.def.innerType as HashSchema, value, next, depth + 1);
      lines.push(`${pad}  ${target} = ${next};`);
      lines.push(`${pad}}`);
      return;
    case "nullable":
      lines.push(`${pad}let ${target};`);
      lines.push(`${pad}if (${value} === null) {`);
      lines.push(`${pad}  ${target} = 1;`);
      lines.push(`${pad}} else {`);
      emitHashInto(lines, schema.def.innerType as HashSchema, value, next, depth + 1);
      lines.push(`${pad}  ${target} = ${next};`);
      lines.push(`${pad}}`);
      return;
    case "nullish":
      lines.push(`${pad}let ${target};`);
      lines.push(`${pad}if (${value} == null) {`);
      lines.push(`${pad}  ${target} = ${value} === null ? 1 : 0;`);
      lines.push(`${pad}} else {`);
      emitHashInto(lines, schema.def.innerType as HashSchema, value, next, depth + 1);
      lines.push(`${pad}  ${target} = ${next};`);
      lines.push(`${pad}}`);
      return;
    case "readonly":
    case "default":
    case "brand":
    case "transform":
    case "pipe":
    case "coerce":
    case "refine":
      emitHashInto(lines, schema.def.innerType as HashSchema, value, target, depth);
      return;
    case "array": {
      lines.push(`${pad}let ${target} = ${schema.type === "array" ? "17" : "0"};`);
      lines.push(`${pad}for (let i = 0, len = ${value}.length; i < len; i++) {`);
      emitHashInto(lines, schema.def.element as HashSchema, `${value}[i]`, next, depth + 1);
      lines.push(`${pad}  ${target} = __combineHash(${target}, ${next});`);
      lines.push(`${pad}}`);
      return;
    }
    case "object": {
      lines.push(`${pad}let ${target} = 23;`);
      const props = schema.def.props as Record<string, HashSchema>;

      for (const key of Object.keys(props)) {
        lines.push(`${pad}{`);
        emitHashInto(lines, props[key], emitPropertyAccess(value, key), next, depth);
        lines.push(`${pad}  ${target} = __combineHash(${target}, ${next});`);
        lines.push(`${pad}}`);
      }

      return;
    }
    default:
      lines.push(`${pad}let ${target} = __hashUnknown(${value});`);
      return;
  }
}
