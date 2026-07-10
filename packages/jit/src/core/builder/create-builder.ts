import { Regexes } from "../../shared/index.js";
import * as Transform from "../../transforms/index.js";
import { type AnyTypeSchema, type ObjectSchema, type SchemaShape, TypeName } from "../ats/index.js";
import { attachHint, type EntityHint, type HashStrategy, type OrderDirection } from "../hints/index.js";
import type { AnyBuilder, Builder, ObjectBuilder } from "./types.js";
import { type SchemaInput, unwrapSchema } from "./unwrap-schema.js";

type RuntimeBuilder = {
  schema: AnyTypeSchema;
};

const baseBuilderPrototype = {
  optional(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.optional(this.schema));
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

  refine(this: RuntimeBuilder, predicate: (value: unknown) => boolean, message?: string): AnyBuilder {
    return createBuilder(Transform.refine(this.schema, predicate, message));
  },

  coerce(this: RuntimeBuilder, coercer: (value: unknown) => unknown): AnyBuilder {
    return createBuilder(Transform.coerce(this.schema, coercer));
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

  length(this: RuntimeBuilder, value: number, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "length", value, message }));
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

  trim(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "trim" }));
  },

  lowercase(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "lowercase" }));
  },

  uppercase(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "uppercase" }));
  },

  positive(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "positive", message }));
  },

  negative(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "negative", message }));
  },

  multipleOf(this: RuntimeBuilder, value: number, message?: string): AnyBuilder {
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

  nonEmpty(this: RuntimeBuilder, message?: string): AnyBuilder {
    return createBuilder(appendCheck(this.schema, { kind: "nonEmpty", message }));
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

  pii(this: RuntimeBuilder, strategy: "redact" | "mask" | "hash" = "redact"): AnyBuilder {
    return createBuilder({
      ...this.schema,
      def: { ...(this.schema.def as object), pii: strategy },
    } as AnyTypeSchema);
  },
};

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

const objectBuilderPrototype = {
  ...baseBuilderPrototype,

  partial(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.partial(this.schema as ObjectSchema<SchemaShape>));
  },

  required(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.required(this.schema as ObjectSchema<SchemaShape>));
  },

  strict(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.strict(this.schema as ObjectSchema<SchemaShape>));
  },

  loose(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.loose(this.schema as ObjectSchema<SchemaShape>));
  },

  catchall(this: RuntimeBuilder, schema: SchemaInput): AnyBuilder {
    return createBuilder(Transform.catchall(this.schema as ObjectSchema<SchemaShape>, unwrapSchema(schema)));
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
    return createBuilder(Transform.pick(this.schema as ObjectSchema<SchemaShape>, normalizeKeys(first, rest)));
  },

  omit(this: RuntimeBuilder, first: readonly string[] | string, ...rest: readonly string[]): AnyBuilder {
    return createBuilder(Transform.omit(this.schema as ObjectSchema<SchemaShape>, normalizeKeys(first, rest)));
  },

  extend(this: RuntimeBuilder, extension: Record<string, SchemaInput>): AnyBuilder {
    const props: Record<string, AnyTypeSchema> = {};

    for (const key in extension) {
      props[key] = unwrapSchema(extension[key]);
    }

    return createBuilder(Transform.extend(this.schema as ObjectSchema<SchemaShape>, props));
  },

  merge(this: RuntimeBuilder, right: ObjectBuilder<SchemaShape> | ObjectSchema<SchemaShape>): AnyBuilder {
    return createBuilder(Transform.merge(this.schema as ObjectSchema<SchemaShape>, unwrapSchema(right)));
  },
};

function normalizeKeys(first: readonly string[] | string, rest: readonly string[]): readonly string[] {
  return typeof first === "string" ? [first, ...rest] : first;
}

export function createBuilder<TSchema extends AnyTypeSchema>(schema: TSchema): Builder<TSchema> {
  const prototype = schema.type === TypeName.object ? objectBuilderPrototype : baseBuilderPrototype;
  const builder = Object.create(prototype) as RuntimeBuilder;
  builder.schema = schema;
  return builder as Builder<TSchema>;
}
