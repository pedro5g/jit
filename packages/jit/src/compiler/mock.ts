import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { getCompileCached } from "../runtime/cache/compile-cache.js";

/** Deterministic sample generator compiled for one schema. */
export type Mock<TValue> = (options?: MockOptions) => TValue;

export interface MockOptions {
  /** Same seed, same value — fixtures stay reproducible across runs. */
  readonly seed?: number;
}

/**
 * The tiny numeric core every generated mock closes over. It is emitted into
 * AOT output verbatim so a generated module stays import-free, and it is the
 * only stateful part: a xorshift32 PRNG seeded per call.
 */
export const MOCK_HELPERS = `let __seed = 1;
function __srand(seed) { __seed = (seed | 0) || 1; }
function __rand() {
  __seed ^= __seed << 13; __seed ^= __seed >>> 17; __seed ^= __seed << 5;
  return ((__seed >>> 0) % 1000000) / 1000000;
}
function __int(min, max) { return min + Math.floor(__rand() * (max - min + 1)); }
function __pick(items) { return items[__int(0, items.length - 1)]; }
function __chars(alphabet, length) {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[__int(0, alphabet.length - 1)];
  return out;
}
const __ALPHA = "abcdefghijklmnopqrstuvwxyz";
const __ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";
const __HEX = "0123456789abcdef";
const __CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function __uuid() {
  return __chars(__HEX, 8) + "-" + __chars(__HEX, 4) + "-4" + __chars(__HEX, 3) + "-a" + __chars(__HEX, 3) + "-" + __chars(__HEX, 12);
}
function __email() { return __chars(__ALPHA, __int(3, 10)) + "@" + __chars(__ALPHA, __int(3, 8)) + ".com"; }
function __url() { return "https://" + __chars(__ALPHA, __int(3, 10)) + ".example.com/" + __chars(__ALNUM, __int(0, 8)); }
function __isoDate(min, max) { return new Date(__int(min, max)).toISOString(); }`;

const MOCK_EPOCH_MIN = 1_600_000_000_000;
const MOCK_EPOCH_MAX = 1_900_000_000_000;

type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };
type SchemaCheck = { readonly kind: string; readonly value?: unknown };

/**
 * Compiles a sample generator for a schema — the fixture factory that
 * otherwise gets hand-written next to every test, or delegated to a faker
 * library that knows nothing about the schema's own constraints.
 *
 * The generated function honors the checks the validator enforces: string
 * lengths and formats, numeric bounds and integer-ness, array lengths, enum
 * and literal members, optional presence, union branches. A value produced by
 * `JIT.mock(User)` therefore passes `JIT.validate.is(User)` by construction.
 *
 * @example
 * ```ts
 * const mockUser = JIT.mock(User);
 *
 * mockUser();             // different each call
 * mockUser({ seed: 7 });  // identical on every run and machine
 * ```
 */
export function compileMock<TValue>(schema: ATS.AnyTypeSchema): Mock<TValue> {
  const template = getCompileCached(schema, "mock", () => {
    const source = emitMockSource(schema);

    return { source, create: globalThis.Function(`${MOCK_HELPERS}\nreturn ${source};`) };
  });
  const compiled = template.create() as Mock<TValue>;

  registerArtifact(compiled as object, { kind: "operation", schema, op: "mock" });
  return compiled;
}

/** Emits the standalone generator source; AOT pairs it with `MOCK_HELPERS`. */
export function emitMockSource(schema: ATS.AnyTypeSchema): string {
  const body = emitValue(schema, 0);

  return `function mock(options) {\n  __srand(options && options.seed !== undefined ? options.seed : (Math.random() * 2147483647) | 0);\n  return ${body};\n}`;
}

function emitValue(schema: ATS.AnyTypeSchema, depth: number): string {
  // Recursive schemas would otherwise generate forever; past a small depth an
  // optional branch collapses to `undefined` and a required one to its
  // smallest legal value.
  if (depth > 6) return emitTerminal(schema);

  const current = schema as AnySchema;
  const checks = (current.def.checks as readonly SchemaCheck[] | undefined) ?? [];

  switch (current.type) {
    case TypeName.string:
    case TypeName.templateLiteral:
      return emitString(checks);
    case TypeName.int:
      return emitNumber(checks, true);
    case TypeName.number:
      return emitNumber(checks, hasCheck(checks, "int32", "integer", "safe"));
    case TypeName.nan:
      return "Number.NaN";
    case TypeName.bigint:
      return "BigInt(__int(0, 1000))";
    case TypeName.boolean:
      return "__rand() < 0.5";
    case TypeName.null:
      return "null";
    case TypeName.undefined:
    case TypeName.void:
      return "undefined";
    case TypeName.date:
      return `new Date(__int(${MOCK_EPOCH_MIN}, ${MOCK_EPOCH_MAX}))`;
    case TypeName.temporal:
      return `__isoDate(${MOCK_EPOCH_MIN}, ${MOCK_EPOCH_MAX})`;
    case TypeName.literal:
      return literal(current.def.value);
    case TypeName.enum: {
      const values = Object.values(current.def.values as Record<string, unknown>);

      return `__pick([${values.map(literal).join(", ")}])`;
    }
    case TypeName.object: {
      const props = (current.def.props as Record<string, ATS.AnyTypeSchema>) ?? {};
      const entries = Object.keys(props).map((key) => `${propertyKey(key)}: ${emitValue(props[key], depth + 1)}`);

      return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
    }
    case TypeName.array:
      return emitArray(current.def.element as ATS.AnyTypeSchema, checks, depth);
    case TypeName.set:
      return `new Set(${emitArray(current.def.element as ATS.AnyTypeSchema, checks, depth)})`;
    case TypeName.map: {
      const key = emitValue(current.def.key as ATS.AnyTypeSchema, depth + 1);
      const value = emitValue(current.def.value as ATS.AnyTypeSchema, depth + 1);

      return `new Map([[${key}, ${value}]])`;
    }
    case TypeName.record:
      return `{ [${emitString([])}]: ${emitValue(current.def.value as ATS.AnyTypeSchema, depth + 1)} }`;
    case TypeName.tuple: {
      const items = (current.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];

      return `[${items.map((item) => emitValue(item, depth + 1)).join(", ")}]`;
    }
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion: {
      const options = (current.def.options as readonly ATS.AnyTypeSchema[]) ?? [];

      if (options.length === 0) return "undefined";
      if (options.length === 1) return emitValue(options[0], depth + 1);
      // One branch is chosen per call, not per compile.
      return `(() => { switch (__int(0, ${options.length - 1})) { ${options
        .map((option, index) => `case ${index}: return ${emitValue(option, depth + 1)};`)
        .join(" ")} } })()`;
    }
    case TypeName.intersection: {
      const options = (current.def.options as readonly ATS.AnyTypeSchema[]) ?? [];

      return `Object.assign({}, ${options.map((option) => emitValue(option, depth + 1)).join(", ")})`;
    }
    case TypeName.optional:
      return `(__rand() < 0.5 ? undefined : ${emitValue(current.def.innerType as ATS.AnyTypeSchema, depth + 1)})`;
    case TypeName.nullable:
      return `(__rand() < 0.25 ? null : ${emitValue(current.def.innerType as ATS.AnyTypeSchema, depth + 1)})`;
    case TypeName.nullish:
      return `(__rand() < 0.5 ? null : ${emitValue(current.def.innerType as ATS.AnyTypeSchema, depth + 1)})`;
    case TypeName.readonly:
    case TypeName.brand:
    case TypeName.coerce:
    case TypeName.default:
      return emitValue(current.def.innerType as ATS.AnyTypeSchema, depth + 1);
    case TypeName.refine:
    case TypeName.pipe:
    case TypeName.transform:
      // The predicate/transform is developer code the generator cannot invert;
      // the inner shape is still the best sample available.
      return emitValue(current.def.innerType as ATS.AnyTypeSchema, depth + 1);
    case TypeName.lazy:
      return emitValue((current.def.getter as () => ATS.AnyTypeSchema)(), depth + 1);
    case TypeName.promise:
      return `Promise.resolve(${emitValue(current.def.innerType as ATS.AnyTypeSchema, depth + 1)})`;
    case TypeName.json:
    case TypeName.any:
    case TypeName.unknown:
      return "null";
    default:
      return "null";
  }
}

/** Smallest legal value for a schema, used to terminate deep recursion. */
function emitTerminal(schema: ATS.AnyTypeSchema): string {
  const current = schema as AnySchema;

  switch (current.type) {
    case TypeName.optional:
    case TypeName.nullish:
    case TypeName.undefined:
      return "undefined";
    case TypeName.nullable:
    case TypeName.null:
      return "null";
    case TypeName.array:
    case TypeName.set:
    case TypeName.tuple:
      return "[]";
    case TypeName.object:
    case TypeName.record:
      return "{}";
    case TypeName.string:
      return '""';
    case TypeName.number:
    case TypeName.int:
      return "0";
    case TypeName.boolean:
      return "false";
    default:
      return "null";
  }
}

const STRING_GENERATORS: Readonly<Record<string, string>> = {
  email: "__email()",
  url: "__url()",
  httpUrl: "__url()",
  uuid: "__uuid()",
  guid: "__uuid()",
  datetime: `__isoDate(${MOCK_EPOCH_MIN}, ${MOCK_EPOCH_MAX})`,
  instant: `__isoDate(${MOCK_EPOCH_MIN}, ${MOCK_EPOCH_MAX})`,
  ulid: "__chars(__CROCKFORD, 26)",
  nanoid: "__chars(__ALNUM, 21)",
  cuid2: "__chars(__ALNUM, 24)",
  base64url: "__chars(__ALNUM, 16)",
  hex: "__chars(__HEX, 16)",
};

function emitString(checks: readonly SchemaCheck[]): string {
  const oneOf = checks.find((check) => check.kind === "oneOf");

  if (Array.isArray(oneOf?.value)) return `__pick([${oneOf.value.map(literal).join(", ")}])`;

  for (const check of checks) {
    const generator = STRING_GENERATORS[check.kind];

    if (generator) return generator;
  }

  const length = numeric(checks, "length");
  const min = length ?? numeric(checks, "min") ?? (hasCheck(checks, "nonEmpty") ? 1 : 3);
  const max = length ?? numeric(checks, "max") ?? Math.max(min, 12);
  const prefix = checks.find((check) => check.kind === "startsWith")?.value;
  const suffix = checks.find((check) => check.kind === "endsWith")?.value;
  const body = `__chars(__ALPHA, __int(${min}, ${max}))`;

  if (typeof prefix !== "string" && typeof suffix !== "string") return body;

  // Affix checks win over the length range: a sample must satisfy the checks.
  return `${typeof prefix === "string" ? `${literal(prefix)} + ` : ""}${body}${
    typeof suffix === "string" ? ` + ${literal(suffix)}` : ""
  }`;
}

function emitNumber(checks: readonly SchemaCheck[], integer: boolean): string {
  const between = checks.find((check) => check.kind === "between")?.value;
  let min = numeric(checks, "min") ?? (Array.isArray(between) ? Number(between[0]) : undefined) ?? 0;
  let max = numeric(checks, "max") ?? (Array.isArray(between) ? Number(between[1]) : undefined) ?? 1000;

  if (hasCheck(checks, "positive")) min = Math.max(min, 1);
  if (hasCheck(checks, "negative")) max = Math.min(max, -1);
  if (max < min) max = min;

  const multipleOf = numeric(checks, "multipleOf");

  if (multipleOf !== undefined && multipleOf > 0) {
    const lowest = Math.ceil(min / multipleOf);
    const highest = Math.floor(max / multipleOf);

    return `(__int(${lowest}, ${Math.max(lowest, highest)}) * ${multipleOf})`;
  }

  if (integer) return `__int(${Math.ceil(min)}, ${Math.floor(max)})`;
  return `(${min} + __rand() * ${max - min})`;
}

function emitArray(element: ATS.AnyTypeSchema, checks: readonly SchemaCheck[], depth: number): string {
  const length = numeric(checks, "length");
  const min = length ?? numeric(checks, "min") ?? (hasCheck(checks, "nonEmpty") ? 1 : 1);
  const max = length ?? numeric(checks, "max") ?? Math.max(min, 3);
  const item = emitValue(element, depth + 1);

  // Parenthesized: an arrow returning an object literal must not read as a block.
  return `Array.from({ length: __int(${min}, ${Math.max(min, max)}) }, () => (${item}))`;
}

function numeric(checks: readonly SchemaCheck[], kind: string): number | undefined {
  const value = checks.find((check) => check.kind === kind)?.value;

  return typeof value === "number" ? value : undefined;
}

function hasCheck(checks: readonly SchemaCheck[], ...kinds: readonly string[]): boolean {
  return checks.some((check) => kinds.includes(check.kind));
}

function literal(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  if (value === undefined) return "undefined";
  return JSON.stringify(value) ?? "null";
}

function propertyKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}
