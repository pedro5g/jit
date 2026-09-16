import { addMember, initialEffectiveSchema } from "../classes/effective-schema.js";
import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import { isPrimitiveLikeSchema } from "../compiler/schema-nodes.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import type { Input } from "../core/ats/input.js";
import type { Hydrate } from "../core/ats/representations.js";
import type { ResolveTypeofSchema } from "../core/ats/typeof.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import * as Transform from "../transforms/index.js";
import type { IdentityState } from "./class-core.js";
import {
  capability,
  classType,
  createRuntimeClass,
  createScalarValueObject,
  isIdentifierSchema,
  removeFactorySurface,
} from "./class-core.js";
import type {
  AggregateRuntimeClass,
  AnyClassCapability,
  AnyClassExtension,
  DddInstance,
  DomainEventBrand,
  EntityRuntimeClassFor,
  EqualsMethods,
  FactoryRuntimeClass,
  HashCodeMethods,
  IdentifierRuntimeClass,
  InitialRuntimeTypeTraits,
  RuntimeClass,
  ScalarFactoryRuntimeClass,
  ScalarValueObject,
  SoftDeleteCapability,
  SoftDeleteOptions,
  StandardEvent,
  TimestampCapability,
  TimestampOptions,
  ValueAccessor,
  VersionedCapability,
  VersionedOptions,
} from "./class-types.js";

const valueAccessorCapability = capability<ValueAccessor<unknown>>("value", (prototype) => {
  Object.defineProperty(prototype, "value", {
    configurable: false,
    enumerable: false,
    get(this: unknown) {
      return this;
    },
  });
});

/** Immutable class preset with compiled structural equality and hash code. */
export function valueObject<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): ValueObjectRuntimeClass<TSchema> {
  const unwrapped = unwrapSchema(schema);
  const base = resolveWrappers(unwrapped).base;
  if (base.type !== TypeName.object) {
    if (!isPrimitiveLikeSchema(base)) {
      throw new JITError("INVALID_OPERATION", "Scalar Value Objects require a primitive-like schema");
    }
    return createScalarValueObject(unwrapped, false, false) as unknown as ValueObjectRuntimeClass<TSchema>;
  }
  const runtime = createRuntimeClass(unwrapped, false, true, false, "factory", false, undefined, {
    factoryValidationOptIn: true,
  });
  return ("value" in (base as ATS.ObjectSchema).def.props
    ? (runtime.extends as (...extensions: AnyClassExtension[]) => RuntimeClass<TSchema>)(
        classType.equals,
        classType.hashCode
      )
    : (runtime.extends as (...extensions: AnyClassExtension[]) => RuntimeClass<TSchema>)(
        valueAccessorCapability,
        classType.equals,
        classType.hashCode
      )) as unknown as ValueObjectRuntimeClass<TSchema>;
}

type ObjectValueAccessor<TValue extends object> = "value" extends keyof TValue
  ? object
  : ValueAccessor<Readonly<TValue>>;
type PublicSchemaOutput<TSchema extends ATS.AnyTypeSchema> = ResolveTypeofSchema<TSchema>;
type ValueObjectInstance<TSchema extends ATS.AnyTypeSchema> =
  PublicSchemaOutput<TSchema> extends object
    ? PublicSchemaOutput<TSchema> & EqualsMethods & HashCodeMethods & ObjectValueAccessor<PublicSchemaOutput<TSchema>>
    : ScalarValueObject<PublicSchemaOutput<TSchema>>;
type ValueObjectRuntimeClass<TSchema extends ATS.AnyTypeSchema> =
  ATS.TypeofSchema<TSchema> extends object
    ? FactoryRuntimeClass<TSchema, ValueObjectInstance<TSchema>>
    : ScalarFactoryRuntimeClass<TSchema, ValueObjectInstance<TSchema>>;

/** Provides the JIT abstract value object operation for the supplied input. */
export function abstractValueObject<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): ValueObjectRuntimeClass<TSchema> {
  const unwrapped = unwrapSchema(schema);
  const base = resolveWrappers(unwrapped).base;
  if (base.type !== TypeName.object) {
    if (!isPrimitiveLikeSchema(base)) {
      throw new JITError("INVALID_OPERATION", "Scalar Value Objects require a primitive-like schema");
    }
    return createScalarValueObject(unwrapped, false, true) as unknown as ValueObjectRuntimeClass<TSchema>;
  }
  const runtime = createRuntimeClass(unwrapped, true, true, false, "factory", false, undefined, {
    factoryValidationOptIn: true,
  });
  return ("value" in (base as ATS.ObjectSchema).def.props
    ? (runtime.extends as (...extensions: AnyClassExtension[]) => RuntimeClass<TSchema>)(
        classType.equals,
        classType.hashCode
      )
    : (runtime.extends as (...extensions: AnyClassExtension[]) => RuntimeClass<TSchema>)(
        valueAccessorCapability,
        classType.equals,
        classType.hashCode
      )) as unknown as ValueObjectRuntimeClass<TSchema>;
}

type DefaultIdentifierSchema = ATS.DefaultSchema<ATS.StringSchema>;

/** Creates a scalar identifier Value Object with identifier metadata. */
export function uniqueIdentifier(): IdentifierRuntimeClass<DefaultIdentifierSchema, ScalarValueObject<string>>;
export function uniqueIdentifier<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): IdentifierRuntimeClass<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>>;
/** Provides the JIT unique identifier operation for the supplied input. */
export function uniqueIdentifier<TSchema extends ATS.AnyTypeSchema>(schema?: SchemaInput<TSchema>): unknown {
  const identifierSchema =
    schema === undefined
      ? Transform.default(
          createSchema<string, "string", ATS.ChecksDef<ATS.StringCheck, readonly [ATS.StringCheck]>>(TypeName.string, {
            checks: [{ kind: "uuid" }],
          }),
          createIdentifierValue
        )
      : unwrapSchema(schema);
  const base = resolveWrappers(identifierSchema).base;
  if (!isPrimitiveLikeSchema(base) || base.type === TypeName.object) {
    throw new JITError("INVALID_OPERATION", "JIT.ddd.uniqueIdentifier() requires a primitive-like schema");
  }
  return createScalarValueObject(identifierSchema, true, false);
}

type HasIdentifierMetadata<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.RuntimeTypeSchema<ATS.AnyTypeSchema, unknown, "value", true, infer TTraits>
    ? TTraits extends ATS.RuntimeTypeTraits<"value", true>
      ? true
      : false
    : TSchema extends ATS.LazySchema<infer TInner>
      ? HasIdentifierMetadata<TInner>
      : TSchema extends
            | ATS.OptionalSchema<infer TInner>
            | ATS.NullableSchema<infer TInner>
            | ATS.NullishSchema<infer TInner>
            | ATS.DefaultSchema<infer TInner>
            | ATS.BrandSchema<infer TInner>
            | ATS.ReadonlySchema<infer TInner>
            | ATS.RefineSchema<infer TInner>
            | ATS.CoerceSchema<infer TInner>
            | ATS.PipeSchema<infer TInner>
            | ATS.TransformSchema<infer TInner>
        ? HasIdentifierMetadata<TInner>
        : false;

type IdentityKeys<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.ObjectSchema<infer TShape>
    ? {
        [TKey in keyof TShape]: HasIdentifierMetadata<TShape[TKey]> extends true ? TKey : never;
      }[keyof TShape] &
        string
    : never;
type IsUnion<TValue, TWhole = TValue> = [TValue] extends [never]
  ? false
  : TValue extends unknown
    ? [TWhole] extends [TValue]
      ? false
      : true
    : never;
type IdentityArguments<TSchema extends ATS.AnyTypeSchema> = [IdentityKeys<TSchema>] extends [never]
  ? []
  : IsUnion<IdentityKeys<TSchema>> extends true
    ? [
        options: {
          readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string>;
        },
      ]
    : [
        options?: {
          readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string>;
        },
      ];
type AggregateIdentityArguments<TSchema extends ATS.AnyTypeSchema> = [IdentityKeys<TSchema>] extends [never]
  ? [options: { readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string> }]
  : IdentityArguments<TSchema>;

function resolveIdentityState(
  schema: ATS.AnyTypeSchema,
  explicit: string | undefined,
  label: "Entity" | "Aggregate"
): IdentityState {
  const base = resolveWrappers(schema).base;
  if (base.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", `${label} identity requires an object schema`);
  }
  if (explicit !== undefined) return { state: "resolved", key: explicit, explicit: true };
  const candidates = Object.keys((base as ATS.ObjectSchema).def.props).filter((key) =>
    isIdentifierSchema((base as ATS.ObjectSchema).def.props[key])
  );
  if (candidates.length === 1) return { state: "resolved", key: candidates[0], explicit: false };
  if (candidates.length === 0) return { state: "pending" };
  throw new JITError(
    "DDD_IDENTITY_AMBIGUOUS",
    `${label} identity must be explicit when the schema has multiple unique identifiers`
  );
}

/** Adds structural timestamp fields and lifecycle mutation semantics. */
export function timestamps(): TimestampCapability<{}>;
export function timestamps<const TOptions extends TimestampOptions>(options?: TOptions): TimestampCapability<TOptions>;
/** Provides the JIT timestamps operation for the supplied input. */
export function timestamps<const TOptions extends TimestampOptions>(options?: TOptions): TimestampCapability<TOptions> {
  const resolved = options ?? ({} as TOptions);
  const touch = resolved.methods?.touch ?? "touch";
  return Object.freeze({
    kind: "ddd.timestamps" as const,
    __options: resolved,
    __memberNames: Object.freeze([touch]),
    install() {},
  }) as TimestampCapability<TOptions>;
}

/** Adds structural soft-delete state and reversible lifecycle methods. */
export function softDelete(): SoftDeleteCapability<{}>;
export function softDelete<const TOptions extends SoftDeleteOptions>(options: TOptions): SoftDeleteCapability<TOptions>;
/** Provides the JIT soft delete operation for the supplied input. */
export function softDelete<const TOptions extends SoftDeleteOptions>(
  options?: TOptions
): SoftDeleteCapability<TOptions> {
  const resolved = options ?? ({} as TOptions);
  const names = [
    resolved.methods?.delete ?? "softDelete",
    resolved.methods?.restore ?? "restore",
    resolved.methods?.isDeleted ?? "isDeleted",
  ];
  return Object.freeze({
    kind: "ddd.softDelete" as const,
    __options: resolved,
    __memberNames: Object.freeze(names),
    install() {},
  }) as SoftDeleteCapability<TOptions>;
}

/** Adds structural version state and lifecycle versioning. */
export function versioned(): VersionedCapability<{}>;
export function versioned<const TOptions extends VersionedOptions>(options?: TOptions): VersionedCapability<TOptions>;
/** Provides the JIT versioned operation for the supplied input. */
export function versioned<const TOptions extends VersionedOptions>(options?: TOptions): VersionedCapability<TOptions> {
  const resolved = options ?? ({} as TOptions);
  return Object.freeze({
    kind: "ddd.versioned" as const,
    __options: resolved,
    __memberNames: Object.freeze([]),
    install() {},
  }) as VersionedCapability<TOptions>;
}

function createEntity<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  isAbstract: boolean,
  ...args: IdentityArguments<TSchema> | [{ readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string> }]
): FactoryRuntimeClass<TSchema, DddInstance<TSchema>, InitialRuntimeTypeTraits<TSchema>, true> {
  const unwrapped = unwrapSchema(schema);
  const identity = resolveIdentityState(unwrapped, args[0]?.id, "Entity");
  const members = initialEffectiveSchema(unwrapped).members;
  addMember(members, "equals", "preset", "ddd.entity", "method");
  addMember(members, "hashCode", "preset", "ddd.entity", "method");
  const capabilities: AnyClassCapability[] = [classType.equals, classType.hashCode];
  const runtime = createRuntimeClass(unwrapped, isAbstract, false, false, "factory", true, undefined, {
    identity,
    members,
    capabilities,
    factoryValidationOptIn: true,
  });
  if (identity.state !== "resolved") {
    removeFactorySurface(runtime, ["create", "hydrate"]);
    return runtime as unknown as FactoryRuntimeClass<
      TSchema,
      DddInstance<TSchema>,
      InitialRuntimeTypeTraits<TSchema>,
      true
    >;
  }
  return runtime as unknown as FactoryRuntimeClass<
    TSchema,
    DddInstance<TSchema>,
    InitialRuntimeTypeTraits<TSchema>,
    true
  >;
}

/**
 * Concrete factory-first Entity with explicit or inferred identity semantics.
 *
 * @example
 * ```ts
 * const User = JIT.ddd.entity(JIT.object({ id: JIT.string(), name: JIT.string() }));
 * const user = User.create({ id: "u1", name: "Ada" });
 * ```
 */
export function entity<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema> & (IsUnion<IdentityKeys<TSchema>> extends true ? never : unknown)
): EntityRuntimeClassFor<TSchema, DddInstance<TSchema>, InitialRuntimeTypeTraits<TSchema>>;
export function entity<
  TSchema extends ATS.AnyTypeSchema,
  const TId extends Extract<keyof ATS.TypeofSchema<TSchema>, string>,
>(
  schema: SchemaInput<TSchema>,
  options: { readonly id: TId }
): FactoryRuntimeClass<TSchema, DddInstance<TSchema, TId>, InitialRuntimeTypeTraits<TSchema>, true>;
export function entity<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: IdentityArguments<TSchema> | [{ readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string> }]
): unknown {
  return createEntity(schema, false, ...args);
}

/** Abstract factory-first Entity base, intended exclusively for subclassing. */
export function abstractEntity<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema> & (IsUnion<IdentityKeys<TSchema>> extends true ? never : unknown)
): EntityRuntimeClassFor<TSchema, DddInstance<TSchema>, InitialRuntimeTypeTraits<TSchema>>;
export function abstractEntity<
  TSchema extends ATS.AnyTypeSchema,
  const TId extends Extract<keyof ATS.TypeofSchema<TSchema>, string>,
>(
  schema: SchemaInput<TSchema>,
  options: { readonly id: TId }
): FactoryRuntimeClass<TSchema, DddInstance<TSchema, TId>, InitialRuntimeTypeTraits<TSchema>, true>;
export function abstractEntity<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: IdentityArguments<TSchema> | [{ readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string> }]
): unknown {
  return createEntity(schema, true, ...args);
}

/** Aggregate Root preset using the same structural definition pipeline as entities. */
function createAggregateRoot<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  isAbstract: boolean,
  ...args: AggregateIdentityArguments<TSchema>
): AggregateRuntimeClass<TSchema, DddInstance<TSchema>> {
  const unwrapped = unwrapSchema(schema);
  const identity = resolveIdentityState(unwrapped, args[0]?.id, "Aggregate");
  if (identity.state !== "resolved") {
    throw new JITError("DDD_IDENTITY_MISSING", "Aggregate identity must be resolved before materialization");
  }
  const members = initialEffectiveSchema(unwrapped).members;
  addMember(members, "equals", "preset", "ddd.aggregateRoot", "method");
  addMember(members, "hashCode", "preset", "ddd.aggregateRoot", "method");
  const runtime = createRuntimeClass(unwrapped, isAbstract, false, true, "factory", true, undefined, {
    identity,
    members,
    capabilities: [classType.equals, classType.hashCode],
    factoryValidationOptIn: true,
  });
  return runtime as unknown as AggregateRuntimeClass<TSchema, DddInstance<TSchema>>;
}

/**
 * Concrete Aggregate Root with controlled mutation and an ordered event buffer.
 *
 * @example
 * ```ts
 * const Order = JIT.ddd.aggregateRoot(JIT.object({ id: JIT.string() }));
 * const order = Order.create({ id: "o1" });
 * order.pullEvents();
 * ```
 */
export function aggregateRoot<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema> & (IdentityKeys<TSchema> extends never ? never : unknown)
): AggregateRuntimeClass<TSchema, DddInstance<TSchema>>;
export function aggregateRoot<
  TSchema extends ATS.AnyTypeSchema,
  const TId extends Extract<keyof ATS.TypeofSchema<TSchema>, string>,
>(
  schema: SchemaInput<TSchema>,
  options: { readonly id: TId }
): AggregateRuntimeClass<TSchema, DddInstance<TSchema, TId>>;
export function aggregateRoot<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: [] | [{ readonly id: string }]
): unknown {
  return createAggregateRoot(schema, false, ...(args as AggregateIdentityArguments<TSchema>));
}

/** Abstract Aggregate Root base, intended exclusively for subclassing. */
export function abstractAggregateRoot<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema> & (IdentityKeys<TSchema> extends never ? never : unknown)
): AggregateRuntimeClass<TSchema, DddInstance<TSchema>>;
export function abstractAggregateRoot<
  TSchema extends ATS.AnyTypeSchema,
  const TId extends Extract<keyof ATS.TypeofSchema<TSchema>, string>,
>(
  schema: SchemaInput<TSchema>,
  options: { readonly id: TId }
): AggregateRuntimeClass<TSchema, DddInstance<TSchema, TId>>;
export function abstractAggregateRoot<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: [] | [{ readonly id: string }]
): unknown {
  return createAggregateRoot(schema, true, ...(args as AggregateIdentityArguments<TSchema>));
}

type EventSchema<TPayload extends ATS.AnyTypeSchema, TType extends string, TVersion extends number> = ATS.ObjectSchema<{
  readonly id: ATS.DefaultSchema<ATS.StringSchema>;
  readonly type: ATS.LiteralSchema<TType>;
  readonly version: ATS.LiteralSchema<TVersion>;
  readonly occurredAt: ATS.DefaultSchema<ATS.DateSchema>;
  readonly payload: TPayload;
}>;
type DomainEventState<TPayload extends ATS.AnyTypeSchema, TType extends string, TVersion extends number> = {
  readonly id: string;
  readonly type: TType;
  readonly version: TVersion;
  readonly occurredAt: Date;
  readonly payload: ResolveTypeofSchema<TPayload>;
} & DomainEventBrand;
type DomainEventOutput<
  TPayload extends ATS.AnyTypeSchema,
  TType extends string,
  TVersion extends number,
> = DomainEventState<TPayload, TType, TVersion> & {
  readonly "~event": StandardEvent;
};
/** Provides the JIT domain event operation for the supplied input. */
export type DomainEvent<TPayload extends ATS.AnyTypeSchema, TType extends string, TVersion extends number> = Omit<
  RuntimeClass<EventSchema<TPayload, TType, TVersion>, DomainEventOutput<TPayload, TType, TVersion>>,
  "create" | "hydrate"
> &
  (abstract new (
    input: Input<EventSchema<TPayload, TType, TVersion>>
  ) => DomainEventOutput<TPayload, TType, TVersion>) & {
    create(input: Input<TPayload>): DomainEventOutput<TPayload, TType, TVersion>;
    hydrate(state: Hydrate<EventSchema<TPayload, TType, TVersion>>): DomainEventOutput<TPayload, TType, TVersion>;
    readonly type: TType;
    readonly version: TVersion;
  };

/** Creates an immutable, versioned domain-event class from a payload schema. */
export function domainEvent<TPayload extends ATS.AnyTypeSchema, TType extends string, TVersion extends number>(
  type: TType,
  options: {
    readonly version: TVersion;
    readonly payload: SchemaInput<TPayload>;
  }
): DomainEvent<TPayload, TType, TVersion> {
  const payload = unwrapSchema(options.payload);
  const schema = createDomainEventSchema(payload, type, options.version);
  const event = createRuntimeClass(schema, false, true, false, "factory", false, undefined, {
    factoryValidationOptIn: true,
  }) as unknown as DomainEvent<TPayload, TType, TVersion>;
  const createState = (
    event as unknown as {
      create(input: Input<typeof schema>): DomainEventState<TPayload, TType, TVersion>;
    }
  ).create.bind(event);

  Object.defineProperties(event, {
    create: {
      configurable: false,
      enumerable: false,
      value: (input: Input<TPayload>) =>
        createState({ type, version: options.version, payload: input } as Input<typeof schema>),
    },
    type: { enumerable: true, value: type },
    version: { enumerable: true, value: options.version },
  });
  Object.defineProperty(event.prototype, "~event", {
    configurable: false,
    enumerable: false,
    value: Object.freeze({
      version: 1,
      type,
      schemaVersion: options.version,
    } satisfies StandardEvent),
    writable: false,
  });
  registerArtifact(event, {
    kind: "class",
    schema,
    abstract: false,
    frozen: true,
    aggregate: false,
    construction: "factory",
    representation: "object",
    capabilities: [],
    factories: { create: "create", hydrate: "hydrate" },
    domainEvent: { type, version: options.version },
  });
  return event;
}

function createDomainEventSchema<TPayload extends ATS.AnyTypeSchema, TType extends string, TVersion extends number>(
  payload: TPayload,
  type: TType,
  version: TVersion
): EventSchema<TPayload, TType, TVersion> {
  const id = Transform.default(createSchema(TypeName.string, {}), createEventId);
  // Event transport serializes dates as ISO strings. Coercion keeps the
  // persisted/JSON boundary symmetric while creation still receives a Date.
  const occurredAt = Transform.default(createSchema(TypeName.date, { coerce: true }), () => new Date());
  return createSchema(TypeName.object, {
    props: {
      id,
      type: createSchema(TypeName.literal, { value: type }),
      version: createSchema(TypeName.literal, { value: version }),
      occurredAt,
      payload,
    },
    unknownKeys: undefined,
    catchall: undefined,
    checks: [],
  }) as unknown as EventSchema<TPayload, TType, TVersion>;
}

function createEventId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function createIdentifierValue(): string {
  return crypto.randomUUID();
}
