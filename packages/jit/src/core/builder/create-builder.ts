import { type BinaryRowSetOptions, compileBinaryArray } from "../../compiler/binary-rowset.js";
import { compileValidator, compileValidatorSelection } from "../../compiler/validate.js";
import { JITError } from "../../errors/index.js";
import { Regexes } from "../../shared/index.js";
import * as Transform from "../../transforms/index.js";
import {
  type AnyTypeSchema,
  type CodecSchema,
  createSchema,
  type FunctionSchema,
  type ObjectSchema,
  type SchemaShape,
  type StringMaskMode,
  type StringNormalizationForm,
  TypeName,
} from "../ats/index.js";
import { attachHint, type EntityHint, type HashStrategy, type OrderDirection } from "../hints/index.js";
import type { AnyBuilder, Builder, ObjectBuilder, StandardSchemaIssue, StandardSchemaProps } from "./types.js";
import { type SchemaInput, unwrapSchema } from "./unwrap-schema.js";

type RuntimeBuilder = {
  schema: AnyTypeSchema;
};

const standardSchemaCache = new WeakMap<AnyTypeSchema, StandardSchemaProps<unknown>>();

const baseBuilderPrototype = {
  is(this: RuntimeBuilder, value: unknown): boolean {
    return compileValidator(this.schema).is(value);
  },

  safeParse(this: RuntimeBuilder, value: unknown): unknown {
    return compileValidator(this.schema).safeParse(value);
  },

  parse(this: RuntimeBuilder, value: unknown): unknown {
    return compileValidator(this.schema).parse(value);
  },

  safeParseAsync(this: RuntimeBuilder, value: unknown): Promise<unknown> {
    return compileValidator(this.schema).safeParseAsync(value);
  },

  parseAsync(this: RuntimeBuilder, value: unknown): Promise<unknown> {
    return compileValidator(this.schema).parseAsync(value);
  },

  optional(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.optional(this.schema));
  },

  required(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(requiredFieldSchema(this.schema, message));
  },

  nullable(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.nullable(this.schema));
  },

  nullish(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.nullish(this.schema));
  },

  readonly(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.readonly(this.schema));
  },

  promise(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.promise(this.schema));
  },

  default(this: RuntimeBuilder, defaultValue: unknown): AnyBuilder {
    return createBuilder(Transform.default(this.schema, defaultValue));
  },

  brand(this: RuntimeBuilder, brandName: string): AnyBuilder {
    return createBuilder(Transform.brand(this.schema, brandName));
  },

  pipe(this: RuntimeBuilder, transform: (value: unknown) => unknown): AnyBuilder {
    return createBuilder(Transform.pipe(this.schema, transform));
  },

  or(this: RuntimeBuilder, right: SchemaInput): AnyBuilder {
    return createBuilder(
      createSchema(TypeName.union, {
        options: [this.schema, unwrapSchema(right)],
      })
    );
  },

  and(this: RuntimeBuilder, right: SchemaInput): AnyBuilder {
    return createBuilder(
      createSchema(TypeName.intersection, {
        options: [this.schema, unwrapSchema(right)],
      })
    );
  },

  xor(this: RuntimeBuilder, right: SchemaInput): AnyBuilder {
    return createBuilder(
      createSchema(TypeName.xor, {
        options: [this.schema, unwrapSchema(right)],
      })
    );
  },

  not(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(
      createSchema(TypeName.not, {
        innerType: this.schema,
      })
    );
  },

  when(
    this: RuntimeBuilder,
    key: string,
    options: {
      readonly is: unknown;
      readonly then: (schema: AnyBuilder) => SchemaInput;
      readonly otherwise?: (schema: AnyBuilder) => SchemaInput;
    }
  ): AnyBuilder {
    return createConditionalBuilder(this.schema, key, options);
  },

  where(
    this: RuntimeBuilder,
    key: string,
    options: {
      readonly is: unknown;
      readonly then: (schema: AnyBuilder) => SchemaInput;
      readonly otherwise?: (schema: AnyBuilder) => SchemaInput;
    }
  ): AnyBuilder {
    return createConditionalBuilder(this.schema, key, options);
  },

  refine(
    this: RuntimeBuilder,
    predicate: (value: unknown) => boolean,
    options?:
      | string
      | {
          readonly message?: string;
          readonly path?: readonly (string | number)[];
          readonly when?: (payload: { readonly value: unknown }) => boolean;
        }
  ): AnyBuilder {
    return createBuilder(Transform.refine(this.schema, predicate, options));
  },

  coerce(this: RuntimeBuilder, coercer: (value: unknown) => unknown): AnyBuilder {
    return createBuilder(Transform.coerce(this.schema, coercer));
  },

  apply(this: RuntimeBuilder, fn: (builder: AnyBuilder) => unknown): unknown {
    return fn(this as unknown as AnyBuilder);
  },

  entity(this: RuntimeBuilder, options: EntityHint<unknown>): AnyBuilder {
    return createBuilder(
      attachHint(this.schema, {
        entity: {
          ...options,
          type: "entity",
        },
      })
    );
  },

  keyed(this: RuntimeBuilder, key: string): AnyBuilder {
    return createBuilder(
      attachHint(this.schema, {
        entity: {
          type: "entity",
          key: key as unknown as EntityHint<unknown>["key"],
          cacheIndex: true,
        },
        index: {
          type: "index",
          key,
        },
        collection: {
          identify: key,
          indexed: true,
          unique: true,
        },
      })
    );
  },

  groupBy(this: RuntimeBuilder, key: string): AnyBuilder {
    return createBuilder(
      attachHint(this.schema, {
        collection: {
          groupBy: key,
        },
      })
    );
  },

  sortBy(this: RuntimeBuilder, key: string, direction?: OrderDirection): AnyBuilder {
    return createBuilder(
      attachHint(this.schema, {
        order: {
          type: "order",
          key,
          ...(direction ? { direction } : {}),
        },
        collection: {
          ordered: {
            type: "order",
            key,
            ...(direction ? { direction } : {}),
          },
        },
      })
    );
  },

  uniqueBy(this: RuntimeBuilder, key: string): AnyBuilder {
    return createBuilder(
      attachHint(this.schema, {
        collection: {
          identify: key,
          uniqueBy: key,
          unique: true,
        },
      })
    );
  },

  indexBy(this: RuntimeBuilder, key: string): AnyBuilder {
    return createBuilder(
      attachHint(this.schema, {
        index: {
          type: "index",
          key,
        },
        collection: {
          identify: key,
          indexed: true,
        },
      })
    );
  },

  ordered(this: RuntimeBuilder, key: string, direction?: OrderDirection): AnyBuilder {
    return createBuilder(
      attachHint(this.schema, {
        order: {
          type: "order",
          key,
          ...(direction ? { direction } : {}),
        },
        collection: {
          identify: key,
          ordered: {
            type: "order",
            key,
            ...(direction ? { direction } : {}),
          },
        },
      })
    );
  },

  hash(this: RuntimeBuilder, strategy?: HashStrategy): AnyBuilder {
    return createBuilder(
      attachHint(this.schema, {
        hash: {
          type: "hash",
          ...(strategy ? { strategy } : {}),
        },
      })
    );
  },

  min(this: RuntimeBuilder, value: number, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "min", value, message }));
  },

  max(this: RuntimeBuilder, value: number, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "max", value, message }));
  },

  gte(this: RuntimeBuilder, value: number, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "min", value, message }));
  },

  lte(this: RuntimeBuilder, value: number, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "max", value, message }));
  },

  between(this: RuntimeBuilder, min: unknown, max: unknown, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "between", value: { min, max }, message }));
  },

  daysOfWeek(this: RuntimeBuilder, value: readonly number[], message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "daysOfWeek", value, message }));
  },

  monthsOfYear(this: RuntimeBuilder, value: readonly number[], message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "monthsOfYear", value, message }));
  },

  truncateTo(this: RuntimeBuilder, value: "minute" | "second" | "millisecond", message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "truncateTo", value, message }));
  },

  length(this: RuntimeBuilder, value: number, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "length", value, message }));
  },

  oneOf(this: RuntimeBuilder, value: readonly (string | number)[], message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "oneOf", value, message }));
  },

  startsWith(this: RuntimeBuilder, value: string, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "startsWith", value, message }));
  },

  endsWith(this: RuntimeBuilder, value: string, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "endsWith", value, message }));
  },

  includes(this: RuntimeBuilder, value: string, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "includes", value, message }));
  },

  regex(this: RuntimeBuilder, value: RegExp, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "regex", value, message }));
  },

  email(this: RuntimeBuilder, regexOrMessage?: RegExp | string, message?: string): AnyBuilder {
    const override = regexOrMessage instanceof RegExp ? regexOrMessage : undefined;
    const text = typeof regexOrMessage === "string" ? regexOrMessage : message;

    return createBuilder(appendCheck(this.schema, { kind: "email", value: override, message: text }));
  },

  uuid(this: RuntimeBuilder, versionOrMessage?: number | string, message?: string): AnyBuilder {
    const version = typeof versionOrMessage === "number" ? versionOrMessage : undefined;
    const text = typeof versionOrMessage === "string" ? versionOrMessage : message;

    return createBuilder(
      appendCheck(this.schema, { kind: "uuid", value: version ? Regexes.uuid(version) : undefined, message: text })
    );
  },

  url(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "url", message }));
  },

  httpUrl(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "httpUrl", message }));
  },

  jwt(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "jwt", value: Regexes.jwt, message }));
  },

  stringFormat(this: RuntimeBuilder, name: string, pattern: RegExp, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "stringFormat", value: { name, pattern }, message }));
  },

  noEmpty(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "noEmpty" }));
  },

  trim(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "trim" }));
  },

  normalize(this: RuntimeBuilder, value?: StringNormalizationForm): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "normalize", value }));
  },

  lowercase(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "lowercase" }));
  },

  toLowerCase(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "lowercase" }));
  },

  uppercase(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "uppercase" }));
  },

  toUpperCase(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "uppercase" }));
  },

  positive(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "positive", message }));
  },

  negative(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "negative", message }));
  },

  nonnegative(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "min", value: 0, message }));
  },

  nonpositive(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "max", value: 0, message }));
  },

  moreThan(this: RuntimeBuilder, value: number, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "moreThan", value, message }));
  },

  gt(this: RuntimeBuilder, value: number, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "moreThan", value, message }));
  },

  lessThan(this: RuntimeBuilder, value: number, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "lessThan", value, message }));
  },

  lt(this: RuntimeBuilder, value: number, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "lessThan", value, message }));
  },

  multipleOf(this: RuntimeBuilder, value: number, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "multipleOf", value, message }));
  },

  step(this: RuntimeBuilder, value: number, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "multipleOf", value, message }));
  },

  finite(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "finite", message }));
  },

  safe(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "safe", message }));
  },

  int(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "integer", message }));
  },

  int32(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "int32", message }));
  },

  float32(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "float32", message }));
  },

  float64(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "float64", message }));
  },

  nonEmpty(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "nonEmpty", message }));
  },

  binary(this: RuntimeBuilder, options?: BinaryRowSetOptions): unknown {
    if (this.schema.type !== TypeName.array) {
      throw new JITError("INVALID_OPERATION", "binary rowsets can only be compiled from array schemas");
    }

    return compileBinaryArray(this.schema as never, options);
  },

  sanitize(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "sanitize" }));
  },

  guid(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "guid", value: Regexes.guid, message }));
  },

  cuid(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "cuid", value: Regexes.cuid, message }));
  },

  cuid2(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "cuid2", value: Regexes.cuid2, message }));
  },

  ulid(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "ulid", value: Regexes.ulid, message }));
  },

  xid(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "xid", value: Regexes.xid, message }));
  },

  ksuid(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "ksuid", value: Regexes.ksuid, message }));
  },

  nanoid(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "nanoid", value: Regexes.nanoid, message }));
  },

  duration(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "duration", value: Regexes.duration, message }));
  },

  ipv4(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "ipv4", value: Regexes.ipv4, message }));
  },

  ipv6(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "ipv6", value: Regexes.ipv6, message }));
  },

  cidrv4(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "cidrv4", value: Regexes.cidrv4, message }));
  },

  cidrv6(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "cidrv6", value: Regexes.cidrv6, message }));
  },

  base64(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "base64", value: Regexes.base64, message }));
  },

  base64url(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "base64url", value: Regexes.base64url, message }));
  },

  hostname(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "hostname", value: Regexes.hostname, message }));
  },

  domain(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "domain", value: Regexes.domain, message }));
  },

  e164(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "e164", value: Regexes.e164, message }));
  },

  hex(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "hex", value: Regexes.hex, message }));
  },

  date(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "date", value: Regexes.date, message }));
  },

  emoji(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "emoji", value: Regexes.emoji(), message }));
  },

  mac(this: RuntimeBuilder, delimiter?: string, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "mac", value: Regexes.mac(delimiter), message }));
  },

  time(this: RuntimeBuilder, options?: Regexes.TimeOptions, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "time", value: Regexes.time(options ?? {}), message }));
  },

  datetime(this: RuntimeBuilder, options?: Regexes.DatetimeOptions, message?: string): AnyBuilder {
    return createBuilder(
      appendCheck(this.schema, { kind: "datetime", value: Regexes.datetime(options ?? {}), message })
    );
  },

  digest(
    this: RuntimeBuilder,
    algorithm: Regexes.HashAlgorithm,
    encoding?: Regexes.HashEncoding,
    message?: string
  ): AnyBuilder {
    return createBuilder(
      appendCheck(this.schema, { kind: "digest", value: Regexes.hash(algorithm, encoding), message })
    );
  },

  format(
    this: RuntimeBuilder,
    pattern: string,
    options?: { readonly mode?: StringMaskMode; readonly stripNonDigits?: boolean },
    message?: string
  ): AnyBuilder {
    const mode = options?.mode ?? "transform";

    return createBuilder(
      appendCheck(this.schema, {
        kind: "format",
        value: {
          pattern,
          mode,
          stripNonDigits: options?.stripNonDigits ?? mode === "transform",
        },
        message,
      })
    );
  },

  cpf(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(
      appendCheck(this.schema, {
        kind: "format",
        value: { pattern: "###.###.###-##", mode: "transform", stripNonDigits: true },
        message,
      })
    );
  },

  cnpj(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(
      appendCheck(this.schema, {
        kind: "format",
        value: { pattern: "##.###.###/####-##", mode: "transform", stripNonDigits: true },
        message,
      })
    );
  },

  phoneBR(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "phoneBR", message }));
  },

  pii(this: RuntimeBuilder, strategy: "redact" | "mask" | "hash" = "redact"): AnyBuilder {
    return createBuilder({
      ...this.schema,
      def: { ...(this.schema.def as object), pii: strategy },
    } as AnyTypeSchema);
  },
};

Object.defineProperty(baseBuilderPrototype, "~standard", {
  enumerable: false,
  configurable: false,
  get(this: RuntimeBuilder): StandardSchemaProps<unknown> {
    return getStandardSchema(this.schema);
  },
});

function appendCheck(
  schema: AnyTypeSchema,
  check: { readonly kind: string; readonly value?: unknown; readonly message?: string | undefined }
): AnyTypeSchema {
  const def = schema.def as { readonly checks?: readonly unknown[] };
  const entry = {
    kind: check.kind,
    ...(check.value !== undefined ? { value: check.value } : {}),
    ...(check.message !== undefined ? { message: check.message } : {}),
  };
  const checks = def.checks ? [...def.checks, entry] : [entry];

  return {
    ...schema,
    def: { ...(schema.def as object), checks },
  } as AnyTypeSchema;
}

function requiredFieldSchema(schema: AnyTypeSchema, message?: string): AnyTypeSchema {
  let required = schema;

  if (schema.type === TypeName.optional || schema.type === TypeName.default) {
    required = (schema.def as { readonly innerType: AnyTypeSchema }).innerType;
  } else if (schema.type === TypeName.nullish) {
    required = Transform.nullable((schema.def as { readonly innerType: AnyTypeSchema }).innerType);
  }

  if (message === undefined) return required;

  return {
    ...required,
    def: { ...(required.def as object), requiredMessage: message },
  } as AnyTypeSchema;
}

function createConditionalBuilder(
  schema: AnyTypeSchema,
  key: string,
  options: {
    readonly is: unknown;
    readonly then: (schema: AnyBuilder) => SchemaInput;
    readonly otherwise?: (schema: AnyBuilder) => SchemaInput;
  }
): AnyBuilder {
  const requiredBuilder = createBuilder(requiredFieldSchema(schema));
  const baseBuilder = createBuilder(schema);

  return createBuilder(
    createSchema(TypeName.when, {
      key,
      is: options.is,
      thenType: unwrapSchema(options.then(requiredBuilder)),
      otherwiseType: unwrapSchema(options.otherwise ? options.otherwise(baseBuilder) : baseBuilder),
    })
  );
}

const objectBuilderPrototype = {
  ...baseBuilderPrototype,

  partial(this: RuntimeBuilder, first?: readonly string[] | string, ...rest: readonly string[]): AnyBuilder {
    const keys = first === undefined ? undefined : normalizeKeys(first, rest);

    return createBuilder(
      Transform.partial(this.schema as ObjectSchema<SchemaShape>, keys as readonly never[])
    ) as AnyBuilder;
  },

  required(this: RuntimeBuilder, first?: readonly string[] | string, ...rest: readonly string[]): AnyBuilder {
    const keys = first === undefined ? undefined : normalizeKeys(first, rest);

    return createBuilder(
      Transform.required(this.schema as ObjectSchema<SchemaShape>, keys as readonly never[])
    ) as AnyBuilder;
  },

  strict(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.strict(this.schema as ObjectSchema<SchemaShape>)) as AnyBuilder;
  },

  loose(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.loose(this.schema as ObjectSchema<SchemaShape>)) as AnyBuilder;
  },

  catchall(this: RuntimeBuilder, schema: SchemaInput): AnyBuilder {
    return createBuilder(
      Transform.catchall(this.schema as ObjectSchema<SchemaShape>, unwrapSchema(schema))
    ) as AnyBuilder;
  },

  keyof(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.keyof(this.schema as ObjectSchema<SchemaShape>));
  },

  transform(
    this: RuntimeBuilder,
    transforms: Record<string, (value: unknown, source: unknown) => unknown>
  ): AnyBuilder {
    return createBuilder(Transform.transform(this.schema as ObjectSchema<SchemaShape>, transforms));
  },

  pick(this: RuntimeBuilder, first: readonly string[] | string, ...rest: readonly string[]): AnyBuilder {
    return createBuilder(
      Transform.pick(this.schema as ObjectSchema<SchemaShape>, normalizeKeys(first, rest))
    ) as AnyBuilder;
  },

  omit(this: RuntimeBuilder, first: readonly string[] | string, ...rest: readonly string[]): AnyBuilder {
    return createBuilder(
      Transform.omit(this.schema as ObjectSchema<SchemaShape>, normalizeKeys(first, rest))
    ) as AnyBuilder;
  },

  extend(this: RuntimeBuilder, extension: Record<string, SchemaInput>): AnyBuilder {
    const props: Record<string, AnyTypeSchema> = {};

    for (const key in extension) {
      props[key] = unwrapSchema(extension[key]);
    }

    return createBuilder(Transform.extend(this.schema as ObjectSchema<SchemaShape>, props)) as AnyBuilder;
  },

  merge(this: RuntimeBuilder, right: ObjectBuilder<SchemaShape> | ObjectSchema<SchemaShape>): AnyBuilder {
    return createBuilder(Transform.merge(this.schema as ObjectSchema<SchemaShape>, unwrapSchema(right))) as AnyBuilder;
  },
};

const functionBuilderPrototype = {
  ...baseBuilderPrototype,

  implement(this: RuntimeBuilder, implementation: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown {
    const { args, output } = compileFunctionValidators(this.schema as RuntimeFunctionSchema);

    return (...rawArgs: unknown[]) => {
      const parsedArgs = args.parse(rawArgs) as unknown[];
      const result = implementation(...parsedArgs);

      return output ? output.parse(result) : result;
    };
  },

  implementAsync(
    this: RuntimeBuilder,
    implementation: (...args: unknown[]) => PromiseLike<unknown>
  ): (...args: unknown[]) => Promise<unknown> {
    const { args, output } = compileFunctionValidators(this.schema as RuntimeFunctionSchema);

    return async (...rawArgs: unknown[]) => {
      const parsedArgs = args.parse(rawArgs) as unknown[];
      const result = await implementation(...parsedArgs);

      return output ? output.parseAsync(result) : result;
    };
  },
};

const codecBuilderPrototype = {
  ...baseBuilderPrototype,

  decode(this: RuntimeBuilder, value: unknown): unknown {
    return compileValidator(this.schema as RuntimeCodecSchema).parse(value);
  },

  encode(this: RuntimeBuilder, value: unknown): unknown {
    const schema = this.schema as RuntimeCodecSchema;
    const output = compileValidator(schema.def.output).parse(value);
    const encoded = schema.def.encode(output);

    return compileValidator(schema.def.input).parse(encoded);
  },
};

attachStandardSchemaGetter(objectBuilderPrototype);
attachStandardSchemaGetter(functionBuilderPrototype);
attachStandardSchemaGetter(codecBuilderPrototype);

type RuntimeFunctionSchema = FunctionSchema<readonly AnyTypeSchema[], AnyTypeSchema | undefined>;
type RuntimeCodecSchema = CodecSchema<AnyTypeSchema, AnyTypeSchema>;

function compileFunctionValidators(schema: RuntimeFunctionSchema) {
  return {
    args: compileValidator(schema.def.args),
    output: schema.def.output ? compileValidator(schema.def.output) : undefined,
  };
}

function normalizeKeys(first: readonly string[] | string, rest: readonly string[]): readonly string[] {
  return typeof first === "string" ? [first, ...rest] : first;
}

function getStandardSchema(schema: AnyTypeSchema): StandardSchemaProps<unknown> {
  const cached = standardSchemaCache.get(schema);

  if (cached) return cached;

  const standard = createStandardSchema(schema);

  standardSchemaCache.set(schema, standard);
  return standard;
}

function createStandardSchema(schema: AnyTypeSchema): StandardSchemaProps<unknown> {
  const safeParse = compileValidatorSelection(schema, ["safeParse"]).safeParse;

  return {
    version: 1,
    vendor: "jit",
    validate(value: unknown) {
      const result = safeParse(value);

      if (result.success) return { value: result.data };

      return { issues: result.issues.map(toStandardIssue) };
    },
  };
}

function toStandardIssue(issue: { readonly message: string; readonly path: string }): StandardSchemaIssue {
  const path = parseIssuePath(issue.path);

  return path.length === 0 ? { message: issue.message } : { message: issue.message, path };
}

function parseIssuePath(path: string): readonly (string | number)[] {
  if (path === "") return [];

  const segments: (string | number)[] = [];
  const regex = /([^.[\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(path)) !== null) {
    if (match[1] !== undefined) {
      segments.push(match[1]);
    } else if (match[2] !== undefined) {
      segments.push(Number(match[2]));
    }
  }
  return segments;
}

function attachStandardSchemaGetter(prototype: object): void {
  Object.defineProperty(prototype, "~standard", {
    enumerable: false,
    configurable: false,
    get(this: RuntimeBuilder): StandardSchemaProps<unknown> {
      return getStandardSchema(this.schema);
    },
  });
}

export function createBuilder<TSchema extends AnyTypeSchema>(schema: TSchema): Builder<TSchema> {
  const prototype =
    schema.type === TypeName.object
      ? objectBuilderPrototype
      : schema.type === TypeName.function
        ? functionBuilderPrototype
        : schema.type === TypeName.codec
          ? codecBuilderPrototype
          : baseBuilderPrototype;
  const builder = Object.create(prototype) as RuntimeBuilder;
  builder.schema = schema;
  return builder as Builder<TSchema>;
}
