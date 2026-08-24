import { compileDiff } from "../compiler/diff.js";
import { compileEqual } from "../compiler/equal.js";
import { compileHash } from "../compiler/hash.js";
import { compileUpdate, type DiffChange, type UpdatePatch } from "../compiler/index.js";
import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "../compiler/source/access.js";
import { compileValidator } from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import type { Input, Update as SchemaUpdate } from "../core/ats/input.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import * as Transform from "../transforms/index.js";

type ObjectSchema<TSchema extends ATS.AnyTypeSchema> = TSchema & {
  readonly def: ATS.ObjectDef<ATS.SchemaShape>;
};

const CLASS_TARGET = Symbol("jit.class.target");

/** A generated runtime constructor backed by one object schema. */
type CapabilityMethods<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TCapabilities extends readonly AnyClassCapability[],
> = UnionToIntersection<MethodsForCapability<TCapabilities[number], TSchema, TInstance>>;
type MethodsForCapability<
  TCapability,
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
> = TCapability extends ClassWithCapability
  ? { with(patch: SchemaUpdate<TSchema>): TInstance }
  : TCapability extends ClassCapability<infer TMethods>
    ? TMethods
    : never;
type UnionToIntersection<TValue> = (TValue extends unknown ? (value: TValue) => void : never) extends (
  value: infer TIntersection
) => void
  ? TIntersection
  : never;

export interface RuntimeClass<TSchema extends ATS.AnyTypeSchema, TInstance = ATS.TypeofSchema<TSchema>> {
  new (state: ATS.TypeofSchema<TSchema>): TInstance;
  readonly schema: TSchema;
  create<TThis extends RuntimeClass<TSchema>>(this: TThis, input: Input<TSchema>): InstanceType<TThis>;
  hydrate<TThis extends RuntimeClass<TSchema>>(this: TThis, state: ATS.TypeofSchema<TSchema>): InstanceType<TThis>;
  use<const TCapabilities extends readonly AnyClassCapability[]>(
    ...capabilities: TCapabilities
  ): RuntimeClass<TSchema, TInstance & CapabilityMethods<TSchema, TInstance, TCapabilities>>;
}

type RuntimeClassTarget = RuntimeClass<ATS.AnyTypeSchema> & {
  readonly [CLASS_TARGET]: true;
};

/** Resolves the class target without making the marker part of the public surface. */
export function getRuntimeClassTarget(value: unknown): RuntimeClassTarget | undefined {
  if (typeof value !== "function" || !(CLASS_TARGET in value)) return undefined;
  return value as RuntimeClassTarget;
}

/** A generated base constructor that cannot itself be instantiated through `create` or `hydrate`. */
export type AbstractRuntimeClass<TSchema extends ATS.AnyTypeSchema> = RuntimeClass<TSchema>;

/** An immutable, tree-shakeable operation that installs one prototype capability. */
export interface ClassCapability<TMethods extends object = object> {
  readonly kind: string;
  install(classTarget: Function, schema: ATS.AnyTypeSchema): void;
  readonly __methods?: TMethods;
}

type AnyClassCapability = ClassCapability<object>;
type EqualsMethods = { equals(other: unknown): boolean };
type HashCodeMethods = { hashCode(): number };
type DiffMethods = { diff(other: unknown): DiffChange[] };
type IdentityMethods = { sameIdentity(other: unknown): boolean; identity(): unknown };
type AggregateMethods<TSchema extends ATS.AnyTypeSchema> = {
  update(patch: SchemaUpdate<TSchema>): void;
  raise(event: unknown): void;
  peekEvents(): readonly unknown[];
  pullEvents(): unknown[];
};
interface ClassWithCapability extends ClassCapability<object> {
  readonly __with: true;
}

/**
 * Materializes an object schema as a runtime class with a generated,
 * shape-stable constructor. Validation/default resolution is compiled once per
 * class and shared by `create()` and `hydrate()`; no schema is traversed when
 * an instance is constructed.
 */
function classFactory<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): RuntimeClass<TSchema> {
  return createRuntimeClass(unwrapSchema(schema), false, false, false);
}

function abstractClass<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): AbstractRuntimeClass<TSchema> {
  return createRuntimeClass(unwrapSchema(schema), true, false, false);
}

function createRuntimeClass<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  isAbstract: boolean,
  freezeInstances: boolean,
  aggregate: boolean
): RuntimeClass<TSchema> {
  const resolved = resolveWrappers(schema).base;

  if (resolved.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", "JIT.class() requires an object schema");
  }

  const objectSchema = resolved as ObjectSchema<TSchema>;
  const properties = Object.keys(objectSchema.def.props);
  const classTarget = emitConstructor(properties, freezeInstances, aggregate) as RuntimeClass<TSchema>;
  const parse = compileValidator(schema).parse;
  const installedCapabilities: string[] = [];

  function create<TThis extends RuntimeClass<TSchema>>(this: TThis, input: Input<TSchema>): InstanceType<TThis> {
    if (isAbstract && this === classTarget) {
      throw new JITError("INVALID_OPERATION", "Cannot create an instance of an abstract JIT class");
    }
    return new this(parse(input)) as InstanceType<TThis>;
  }

  function hydrate<TThis extends RuntimeClass<TSchema>>(
    this: TThis,
    state: ATS.TypeofSchema<TSchema>
  ): InstanceType<TThis> {
    if (isAbstract && this === classTarget) {
      throw new JITError("INVALID_OPERATION", "Cannot hydrate an instance of an abstract JIT class");
    }
    return new this(parse(state)) as InstanceType<TThis>;
  }

  Object.defineProperties(classTarget, {
    [CLASS_TARGET]: { enumerable: false, value: true },
    schema: { enumerable: true, value: schema },
    create: { configurable: true, enumerable: false, value: create },
    hydrate: { enumerable: false, value: hydrate },
    use: {
      enumerable: false,
      value: (...capabilities: readonly AnyClassCapability[]) => {
        for (const capability of capabilities) {
          capability.install(classTarget, schema);
          installedCapabilities.push(capability.kind);
        }
        return classTarget;
      },
    },
  });
  registerArtifact(classTarget, {
    kind: "class",
    schema,
    abstract: isAbstract,
    frozen: freezeInstances,
    aggregate,
    capabilities: installedCapabilities,
  });

  return classTarget;
}

function emitConstructor(properties: readonly string[], freezeInstances: boolean, aggregate: boolean): unknown {
  const assignments = properties.map(
    (property) => `this${emitPropertyAccess("", property)} = state${emitPropertyAccess("", property)};`
  );
  const events = aggregate ? ' Object.defineProperty(this, "__jitEvents", { value: [], writable: true });' : "";
  const source = `return class JITRuntimeClass { constructor(state) { ${assignments.join(" ")}${events}${freezeInstances ? " Object.freeze(this);" : ""} } };`;

  return globalThis.Function(source)();
}

export interface ClassFactory {
  <TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): RuntimeClass<TSchema>;
  abstract<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): AbstractRuntimeClass<TSchema>;
  readonly equals: ClassCapability<EqualsMethods>;
  readonly hashCode: ClassCapability<HashCodeMethods>;
  readonly with: ClassWithCapability;
  readonly diff: ClassCapability<DiffMethods>;
  identity<TKey extends string>(key: TKey): ClassCapability<IdentityMethods>;
}

/** Runtime type factory. Capabilities are installed separately on the prototype. */
export const classType: ClassFactory = Object.assign(classFactory, {
  abstract: abstractClass,
  equals: capability<EqualsMethods>("equals", (prototype, schema) => {
    const equal = compileEqual(schema);
    definePrototype(prototype, "equals", function equals(this: unknown, other: unknown) {
      return equal(this, other);
    });
  }),
  hashCode: capability<HashCodeMethods>("hashCode", (prototype, schema) => {
    const hash = compileHash(schema);
    definePrototype(prototype, "hashCode", function hashCode(this: unknown) {
      return hash(this);
    });
  }),
  with: (() => {
    const base = capability<object>("with", (prototype, schema) => {
      const update = compileUpdate(schema);
      definePrototype(prototype, "with", function withPatch(this: object, patch: UpdatePatch<unknown>) {
        const next = update(this, patch);
        return new (this.constructor as new (state: object) => object)(next as object);
      });
    });
    return Object.freeze({ ...base, __with: true as const });
  })(),
  diff: capability<DiffMethods>("diff", (prototype, schema) => {
    const diff = compileDiff(schema);
    definePrototype(prototype, "diff", function diffInstance(this: unknown, other: unknown) {
      return diff(this, other);
    });
  }),
  identity(key: string): ClassCapability<IdentityMethods> {
    return capability<IdentityMethods>(`identity:${key}`, (prototype, schema) => {
      const base = resolveWrappers(schema).base;
      const props = base.type === TypeName.object ? (base as ATS.ObjectSchema).def.props : undefined;

      if (!props || !(key in props)) {
        throw new JITError("INVALID_OPERATION", `Identity key ${JSON.stringify(key)} is not a schema field`);
      }
      definePrototype(prototype, "identity", function identity(this: Record<string, unknown>) {
        return this[key];
      });
      definePrototype(prototype, "sameIdentity", function sameIdentity(this: Record<string, unknown>, other: unknown) {
        return (
          typeof other === "object" && other !== null && Object.is(this[key], (other as Record<string, unknown>)[key])
        );
      });
    });
  },
});
export { classType as class };

/** Immutable class preset with compiled structural equality and hash code. */
export function valueObject<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & EqualsMethods & HashCodeMethods> {
  return createRuntimeClass(unwrapSchema(schema), false, true, false).use(classType.equals, classType.hashCode);
}

valueObject.abstract = function abstractValueObject<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): AbstractRuntimeClass<TSchema> {
  return createRuntimeClass(unwrapSchema(schema), true, true, false).use(classType.equals, classType.hashCode);
};

/** Entity preset: an abstract class with explicit identity semantics. */
export function entity<TSchema extends ATS.AnyTypeSchema, TKey extends string>(
  schema: SchemaInput<TSchema>,
  options: { readonly id: TKey }
): RuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods> {
  return createRuntimeClass(unwrapSchema(schema), true, false, false).use(classType.identity(options.id));
}

/** Abstract entity preset with ordered domain events and compiled in-place updates. */
export function aggregateRoot<TSchema extends ATS.AnyTypeSchema, TKey extends string>(
  schema: SchemaInput<TSchema>,
  options: { readonly id: TKey }
): RuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods & AggregateMethods<TSchema>> {
  const unwrapped = unwrapSchema(schema);
  const aggregate = createRuntimeClass(unwrapped, true, false, true).use(
    classType.identity(options.id)
  ) as RuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods & AggregateMethods<TSchema>>;
  const base = resolveWrappers(unwrapped).base as ATS.ObjectSchema;
  const update = compileUpdate(unwrapped);
  const fields = Object.keys(base.def.props);
  const assign = globalThis.Function(
    "__update",
    `return function update(patch) { const next = __update(this, patch); ${fields
      .map((field) => `this${emitPropertyAccess("", field)} = next${emitPropertyAccess("", field)};`)
      .join(" ")} };`
  )(update) as (this: object, patch: SchemaUpdate<TSchema>) => void;

  definePrototype(aggregate.prototype, "update", function updateAggregate(this: object, patch: SchemaUpdate<TSchema>) {
    assign.call(this, patch);
  });
  definePrototype(aggregate.prototype, "raise", function raise(this: { __jitEvents: unknown[] }, event: unknown) {
    this.__jitEvents[this.__jitEvents.length] = event;
  });
  definePrototype(aggregate.prototype, "peekEvents", function peekEvents(this: { __jitEvents: unknown[] }) {
    return this.__jitEvents.slice();
  });
  definePrototype(aggregate.prototype, "pullEvents", function pullEvents(this: { __jitEvents: unknown[] }) {
    const events = this.__jitEvents;
    this.__jitEvents = [];
    return events;
  });
  return aggregate;
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
  readonly payload: ATS.TypeofSchema<TPayload>;
};
export type DomainEvent<TPayload extends ATS.AnyTypeSchema, TType extends string, TVersion extends number> = Omit<
  RuntimeClass<EventSchema<TPayload, TType, TVersion>, DomainEventState<TPayload, TType, TVersion>>,
  "create"
> & {
  create(input: Input<TPayload>): DomainEventState<TPayload, TType, TVersion>;
  readonly type: TType;
  readonly version: TVersion;
};

/** Creates an immutable, versioned domain-event class from a payload schema. */
export function domainEvent<TPayload extends ATS.AnyTypeSchema, TType extends string, TVersion extends number>(
  type: TType,
  options: { readonly version: TVersion; readonly payload: SchemaInput<TPayload> }
): DomainEvent<TPayload, TType, TVersion> {
  const payload = unwrapSchema(options.payload);
  const schema = createDomainEventSchema(payload, type, options.version);
  const event = createRuntimeClass(schema, false, true, false) as unknown as DomainEvent<TPayload, TType, TVersion>;
  const createState = event.create.bind(event) as (
    input: Input<typeof schema>
  ) => DomainEventState<TPayload, TType, TVersion>;

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
  registerArtifact(event, {
    kind: "class",
    schema,
    abstract: false,
    frozen: true,
    aggregate: false,
    capabilities: [],
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
  const occurredAt = Transform.default(createSchema(TypeName.date, {}), () => new Date());
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

function capability<TMethods extends object>(
  kind: string,
  install: (prototype: object, schema: ATS.AnyTypeSchema) => void
): ClassCapability<TMethods> {
  return Object.freeze({
    kind,
    install(classTarget: Function, schema: ATS.AnyTypeSchema) {
      install(classTarget.prototype, schema);
    },
  });
}

function definePrototype(prototype: object, key: string, value: Function): void {
  Object.defineProperty(prototype, key, { configurable: false, enumerable: false, value, writable: false });
}
