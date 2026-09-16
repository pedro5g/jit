import { resolveWrappers } from "./compiler/resolvers/resolve-wrappers.js";
import type * as ATS from "./core/ats/index.js";
import { createSchema, TypeName } from "./core/ats/index.js";
import type { SchemaInput } from "./core/builder/index.js";
import { unwrapSchema } from "./core/builder/index.js";
import {
  defineCapability,
  defineClass,
  defineClassExtensions,
  defineClassState,
  defineRuntimeClass,
} from "./define-class-runtime.js";
import { JITError } from "./errors/index.js";
import type { SoftDeleteOptions, TimestampOptions, VersionedOptions } from "./factories/class.js";
import * as RuntimeJIT from "./factories/index.js";

function defineIdentityKey(
  schema: ATS.AnyTypeSchema,
  explicit: string | undefined,
  label: "Entity" | "Aggregate"
): string {
  const object = resolveWrappers(schema).base;
  if (object.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", `${label} identity requires an object schema`);
  }
  if (explicit !== undefined) return explicit;
  const candidates = Object.keys((object as ATS.ObjectSchema).def.props).filter((key) =>
    defineIsIdentifierSchema((object as ATS.ObjectSchema).def.props[key])
  );
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new JITError(
      "DDD_IDENTITY_MISSING",
      `${label} identity must be explicit when the schema has no unique identifier`
    );
  }
  throw new JITError(
    "DDD_IDENTITY_AMBIGUOUS",
    `${label} identity must be explicit when the schema has multiple unique identifiers`
  );
}

function defineIsIdentifierSchema(schema: ATS.AnyTypeSchema): boolean {
  return defineFindRuntimeTypeSchema(schema)?.def.identifier === true;
}

function defineFindRuntimeTypeSchema(schema: ATS.AnyTypeSchema): ATS.RuntimeTypeSchema | undefined {
  let current = schema;
  while (true) {
    if (current.type === TypeName.runtimeType) return current as ATS.RuntimeTypeSchema;
    if (current.type === TypeName.lazy) {
      current = (current.def as ATS.LazyDef).getter();
      continue;
    }
    if (
      current.type === TypeName.optional ||
      current.type === TypeName.nullable ||
      current.type === TypeName.nullish ||
      current.type === TypeName.default ||
      current.type === TypeName.brand ||
      current.type === TypeName.readonly ||
      current.type === TypeName.refine ||
      current.type === TypeName.coerce ||
      current.type === TypeName.pipe ||
      current.type === TypeName.transform
    ) {
      current = (current.def as ATS.InnerTypeDef).innerType;
      continue;
    }
    return undefined;
  }
}

function defineScalarValueObject(
  schema: SchemaInput<ATS.AnyTypeSchema>,
  identifier: boolean,
  abstract: boolean
): unknown {
  const state = defineClassState(unwrapSchema(schema), abstract, false);
  return defineRuntimeClass(
    defineClassExtensions(
      {
        ...state,
        representation: "value",
        identifier,
        construction: "factory",
        factoryValidationOptIn: true,
        factories: { create: "create", hydrate: "hydrate" },
      },
      [defineClass.equals(), defineClass.hashCode()]
    )
  );
}

const defineValueObject = ((schema: SchemaInput<ATS.AnyTypeSchema>) =>
  defineScalarValueObject(schema, false, false)) as typeof RuntimeJIT.ddd.valueObject;

const defineAbstractValueObject = ((schema: SchemaInput<ATS.AnyTypeSchema>) =>
  defineScalarValueObject(schema, false, true)) as typeof RuntimeJIT.ddd.abstract.valueObject;

const defineUniqueIdentifier = ((schema?: SchemaInput<ATS.AnyTypeSchema>) => {
  const identifierSchema =
    schema === undefined
      ? createSchema(TypeName.default, {
          innerType: createSchema(TypeName.string, { checks: [{ kind: "uuid" }] }),
          defaultValue: () => crypto.randomUUID(),
        })
      : schema;
  return defineScalarValueObject(identifierSchema, true, false);
}) as typeof RuntimeJIT.ddd.uniqueIdentifier;

type DefinedEventSchema<
  TPayload extends ATS.AnyTypeSchema,
  TType extends string,
  TVersion extends number,
> = ATS.ObjectSchema<{
  readonly id: ATS.DefaultSchema<ATS.StringSchema>;
  readonly type: ATS.LiteralSchema<TType>;
  readonly version: ATS.LiteralSchema<TVersion>;
  readonly occurredAt: ATS.DefaultSchema<ATS.DateSchema>;
  readonly payload: TPayload;
}>;

function createDefinedDomainEventSchema<
  TPayload extends ATS.AnyTypeSchema,
  TType extends string,
  TVersion extends number,
>(payload: TPayload, type: TType, version: TVersion): DefinedEventSchema<TPayload, TType, TVersion> {
  return createSchema(TypeName.object, {
    props: {
      id: createSchema(TypeName.default, {
        innerType: createSchema(TypeName.string, {}),
        defaultValue: () => crypto.randomUUID(),
      }),
      type: createSchema(TypeName.literal, { value: type }),
      version: createSchema(TypeName.literal, { value: version }),
      occurredAt: createSchema(TypeName.default, {
        innerType: createSchema(TypeName.date, { coerce: true }),
        defaultValue: () => new Date(),
      }),
      payload,
    },
    unknownKeys: undefined,
    catchall: undefined,
    checks: [],
  }) as unknown as DefinedEventSchema<TPayload, TType, TVersion>;
}

const defineDomainEvent = ((
  type: string,
  options: { readonly version: number; readonly payload: SchemaInput<ATS.AnyTypeSchema> }
) => {
  const schema = createDefinedDomainEventSchema(unwrapSchema(options.payload), type, options.version);
  return defineRuntimeClass({
    ...defineClassState(schema, false, false),
    frozen: true,
    construction: "factory",
    factoryValidationOptIn: true,
    factories: { create: "create", hydrate: "hydrate" },
    domainEvent: { type, version: options.version },
  });
}) as typeof RuntimeJIT.ddd.domainEvent;

const defineEntity = ((schema: SchemaInput<ATS.AnyTypeSchema>, options?: { readonly id?: string }) => {
  const unwrapped = unwrapSchema(schema);
  const object = resolveWrappers(unwrapped).base;
  defineIdentityKey(
    unwrapped,
    options?.id ??
      (object.type === TypeName.object && "id" in (object as ATS.ObjectSchema).def.props ? "id" : undefined),
    "Entity"
  );
  const state = defineClassState(unwrapped, false, false, true);
  return defineRuntimeClass(
    defineClassExtensions(
      {
        ...state,
        construction: "factory",
        factoryValidationOptIn: true,
        factories: { create: "create", hydrate: "hydrate" },
      },
      [defineClass.equals(), defineClass.hashCode()]
    )
  );
}) as typeof RuntimeJIT.ddd.entity;

const defineAggregateRoot = ((schema: SchemaInput<ATS.AnyTypeSchema>, options?: { readonly id?: string }) => {
  const unwrapped = unwrapSchema(schema);
  const object = resolveWrappers(unwrapped).base;
  defineIdentityKey(
    unwrapped,
    options?.id ??
      (object.type === TypeName.object && "id" in (object as ATS.ObjectSchema).def.props ? "id" : undefined),
    "Aggregate"
  );
  const state = defineClassState(unwrapped, false, true, true);
  return defineRuntimeClass(
    defineClassExtensions({ ...state, factoryValidationOptIn: true }, [defineClass.equals(), defineClass.hashCode()])
  );
}) as typeof RuntimeJIT.ddd.aggregateRoot;

const defineTimestamps = ((options?: TimestampOptions) =>
  defineCapability(
    "ddd.timestamps",
    [options?.methods?.touch ?? "touch"],
    options
  )) as typeof RuntimeJIT.ddd.timestamps;
const defineSoftDelete = ((options?: SoftDeleteOptions) =>
  defineCapability(
    "ddd.softDelete",
    [
      options?.methods?.delete ?? "softDelete",
      options?.methods?.restore ?? "restore",
      options?.methods?.isDeleted ?? "isDeleted",
    ],
    options
  )) as typeof RuntimeJIT.ddd.softDelete;
const defineVersioned = ((options?: VersionedOptions) =>
  defineCapability("ddd.versioned", [], options)) as typeof RuntimeJIT.ddd.versioned;
function extendDefineDdd<T extends Record<string, (...args: never[]) => unknown>>(
  extensions: T
): typeof RuntimeJIT.ddd & T {
  return Object.freeze({ ...defineDdd, ...extensions }) as typeof RuntimeJIT.ddd & T;
}
const defineDdd = Object.freeze({
  ...RuntimeJIT.ddd,
  valueObject: defineValueObject,
  uniqueIdentifier: defineUniqueIdentifier,
  domainEvent: defineDomainEvent,
  entity: defineEntity,
  aggregateRoot: defineAggregateRoot,
  timestamps: defineTimestamps,
  softDelete: defineSoftDelete,
  versioned: defineVersioned,
  $extends: extendDefineDdd,
  abstract: Object.freeze({
    ...RuntimeJIT.ddd.abstract,
    valueObject: defineAbstractValueObject,
    entity: ((schema: SchemaInput<ATS.AnyTypeSchema>, options?: { readonly id?: string }) => {
      const value = (
        defineEntity as (value: SchemaInput<ATS.AnyTypeSchema>, options?: { readonly id?: string }) => unknown
      )(schema, options);
      return value;
    }) as typeof RuntimeJIT.ddd.abstract.entity,
    aggregateRoot: ((schema: SchemaInput<ATS.AnyTypeSchema>, options?: { readonly id?: string }) => {
      const value = (
        defineAggregateRoot as (value: SchemaInput<ATS.AnyTypeSchema>, options?: { readonly id?: string }) => unknown
      )(schema, options);
      return value;
    }) as typeof RuntimeJIT.ddd.abstract.aggregateRoot,
  }),
});

export { defineDdd };
