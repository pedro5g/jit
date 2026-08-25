import { compileDiff } from "../compiler/diff.js";
import { compileEqualMethod } from "../compiler/equal.js";
import { compileHash } from "../compiler/hash.js";
import { compileUpdate, type DiffChange, type UpdatePatch } from "../compiler/index.js";
import { buildMutationPlan, emitMutationPlanBody } from "../compiler/mutation-plan.js";
import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import { isPrimitiveLikeSchema } from "../compiler/schema-nodes.js";
import { emitPropertyAccess } from "../compiler/source/access.js";
import { compileHydrator, compileValidator } from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import type { Input, Update as SchemaUpdate } from "../core/ats/input.js";
import type { Hydrate } from "../core/ats/representations.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact, setClassMutationArtifact } from "../runtime/artifact-registry.js";
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
  new (input: Input<TSchema>): TInstance;
  readonly schema: ATS.RuntimeTypeSchema<TSchema, ATS.TypeofSchema<TSchema>>;
  create<TThis extends RuntimeClass<TSchema>>(this: TThis, input: Input<TSchema>): InstanceType<TThis>;
  hydrate<TThis extends RuntimeClass<TSchema>>(this: TThis, state: Hydrate<TSchema>): InstanceType<TThis>;
  use<const TCapabilities extends readonly AnyClassCapability[]>(
    ...capabilities: TCapabilities
  ): RuntimeClass<TSchema, TInstance & CapabilityMethods<TSchema, TInstance, TCapabilities>>;
  factories<const TOptions extends FactoryOptions>(
    options: TOptions
  ): ConfiguredRuntimeClass<TSchema, TInstance, TOptions>;
  accessors<TThis extends RuntimeClass<TSchema, TInstance>>(this: TThis, options: AccessorOptions<TSchema>): TThis;
  identity<TKey extends Extract<keyof ATS.TypeofSchema<TSchema>, string>>(
    key: TKey
  ): RuntimeClass<TSchema, TInstance & IdentityMethods>;
}

export interface FactoryOptions {
  readonly create?: string | false;
  readonly hydrate?: string | false;
}

export type AccessorVisibility = "public" | "protected" | "private" | false;

export interface AccessorMember {
  readonly name?: string;
  readonly visibility?: AccessorVisibility;
}

export interface FieldAccessorOptions {
  readonly field?: AccessorVisibility;
  readonly get?: AccessorVisibility | AccessorMember;
  readonly set?: AccessorVisibility | AccessorMember;
}

export interface AccessorOptions<TSchema extends ATS.AnyTypeSchema> {
  readonly default?: FieldAccessorOptions;
  readonly fields?: Partial<Record<Extract<keyof ATS.TypeofSchema<TSchema>, string>, FieldAccessorOptions>>;
}

type FactoryMethods<TSchema extends ATS.AnyTypeSchema, TInstance, TOptions extends FactoryOptions> = (TOptions extends {
  readonly create: infer TName extends string;
}
  ? { [TKey in TName]: (input: Input<TSchema>) => TInstance }
  : TOptions extends { readonly create: false }
    ? {}
    : { create(input: Input<TSchema>): TInstance }) &
  (TOptions extends { readonly hydrate: infer TName extends string }
    ? { [TKey in TName]: (state: Hydrate<TSchema>) => TInstance }
    : TOptions extends { readonly hydrate: false }
      ? {}
      : { hydrate(state: Hydrate<TSchema>): TInstance });

export type ConfiguredRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TOptions extends FactoryOptions,
> = (new (
  input: Input<TSchema>
) => TInstance) &
  Omit<RuntimeClass<TSchema, TInstance>, "create" | "hydrate" | "factories"> &
  FactoryMethods<TSchema, TInstance, TOptions>;

type RuntimeClassTarget = RuntimeClass<ATS.AnyTypeSchema> & {
  readonly [CLASS_TARGET]: true;
};

interface ResolvedAccessor {
  readonly key: string;
  readonly field: AccessorVisibility;
  readonly get: string | false;
  readonly set: string | false;
}

type ResolvedAccessors = readonly ResolvedAccessor[];

/** Resolves the class target without making the marker part of the public surface. */
export function getRuntimeClassTarget(value: unknown): RuntimeClassTarget | undefined {
  if (typeof value !== "function" || !(CLASS_TARGET in value)) return undefined;
  return value as RuntimeClassTarget;
}

/** A generated base constructor that cannot itself be instantiated through `create` or `hydrate`. */
export type AbstractRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance = ATS.TypeofSchema<TSchema>,
> = RuntimeClass<TSchema, TInstance>;

/** An immutable, tree-shakeable operation that installs one prototype capability. */
export interface ClassCapability<TMethods extends object = object> {
  readonly kind: string;
  install(classTarget: Function, schema: ATS.AnyTypeSchema): void;
  readonly __methods?: TMethods;
}

/** Minimal application-owned event publisher contract. */
export interface EventPublisher<TEvent = unknown> {
  publish(event: TEvent): void | Promise<void>;
}

/** Versioned structural metadata exposed by a domain-event instance. */
export interface StandardEvent {
  readonly version: 1;
  readonly type: string;
  readonly schemaVersion: number;
}

type AnyClassCapability = ClassCapability<object>;
type EqualsMethods = { equals(other: unknown): boolean };
type HashCodeMethods = { hashCode(): number };
type DiffMethods = { diff(other: unknown): DiffChange[] };
type IdentityMethods = { sameIdentity(other: unknown): boolean; identity(): unknown };
type DateKeys<TSchema extends ATS.AnyTypeSchema> = {
  [TKey in keyof ATS.TypeofSchema<TSchema>]: ATS.TypeofSchema<TSchema>[TKey] extends Date ? TKey : never;
}[keyof ATS.TypeofSchema<TSchema>] &
  string;
type NullableDateKeys<TSchema extends ATS.AnyTypeSchema> = {
  [TKey in keyof ATS.TypeofSchema<TSchema>]: ATS.TypeofSchema<TSchema>[TKey] extends Date | null ? TKey : never;
}[keyof ATS.TypeofSchema<TSchema>] &
  string;
type NumberKeys<TSchema extends ATS.AnyTypeSchema> = {
  [TKey in keyof ATS.TypeofSchema<TSchema>]: ATS.TypeofSchema<TSchema>[TKey] extends number ? TKey : never;
}[keyof ATS.TypeofSchema<TSchema>] &
  string;
export interface TimestampOptions<TSchema extends ATS.AnyTypeSchema> {
  readonly updatedAt: DateKeys<TSchema>;
  readonly createdAt?: DateKeys<TSchema>;
  readonly touch?: "mutation" | "manual";
}
export interface SoftDeleteOptions<TSchema extends ATS.AnyTypeSchema> {
  readonly field: NullableDateKeys<TSchema>;
}
export interface VersionedOptions<TSchema extends ATS.AnyTypeSchema> {
  readonly field: NumberKeys<TSchema>;
}
declare class AggregateProtectedMethods<TSchema extends ATS.AnyTypeSchema> {
  protected update(patch: SchemaUpdate<TSchema>): void;
  protected raise(event: unknown): void;
}

type AggregateMethods<TSchema extends ATS.AnyTypeSchema> = AggregateProtectedMethods<TSchema> & {
  peekEvents(): readonly unknown[];
  pullEvents(): unknown[];
  commit(publisher: EventPublisher): Promise<void>;
  softDelete(): void;
  restore(): void;
  readonly isDeleted: boolean;
};
type AggregateRuntimeClass<TSchema extends ATS.AnyTypeSchema, TInstance> = RuntimeClass<TSchema, TInstance> & {
  timestamps(options: TimestampOptions<TSchema>): AggregateRuntimeClass<TSchema, TInstance>;
  softDelete(options: SoftDeleteOptions<TSchema>): AggregateRuntimeClass<TSchema, TInstance>;
  versioned(options: VersionedOptions<TSchema>): AggregateRuntimeClass<TSchema, TInstance>;
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
  aggregate: boolean,
  accessors?: ResolvedAccessors
): RuntimeClass<TSchema> {
  const resolved = resolveWrappers(schema).base;

  if (resolved.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", "JIT.class() requires an object schema");
  }

  const objectSchema = resolved as ObjectSchema<TSchema>;
  const properties = Object.keys(objectSchema.def.props);
  const parse = compileValidator(schema).parse;
  const hydrateState = compileHydrator(schema);
  const classTarget = emitConstructor(
    properties,
    freezeInstances,
    aggregate,
    parse,
    accessors
  ) as RuntimeClass<TSchema>;
  const installedCapabilities: string[] = [];
  const installedCapabilityValues: AnyClassCapability[] = [];
  let factoryNames: { create: string | false; hydrate: string | false } = { create: "create", hydrate: "hydrate" };

  function create<TThis extends RuntimeClass<TSchema>>(this: TThis, input: Input<TSchema>): InstanceType<TThis> {
    if (isAbstract && this === classTarget) {
      throw new JITError("INVALID_OPERATION", "Cannot create an instance of an abstract JIT class");
    }
    return new this(input) as InstanceType<TThis>;
  }

  function hydrate<TThis extends RuntimeClass<TSchema>>(this: TThis, state: Hydrate<TSchema>): InstanceType<TThis> {
    if (isAbstract && this === classTarget) {
      throw new JITError("INVALID_OPERATION", "Cannot hydrate an instance of an abstract JIT class");
    }
    return new (this as unknown as new (input: unknown, validated?: boolean) => InstanceType<TThis>)(
      hydrateState(state),
      true
    );
  }

  Object.defineProperties(classTarget, {
    [CLASS_TARGET]: { enumerable: false, value: true },
    schema: {
      enumerable: true,
      value: createSchema(TypeName.runtimeType, {
        innerType: schema,
        materialize: classTarget,
      }) as ATS.RuntimeTypeSchema<TSchema, ATS.TypeofSchema<TSchema>>,
    },
    create: { configurable: true, enumerable: false, value: create },
    hydrate: { configurable: true, enumerable: false, value: hydrate },
    use: {
      enumerable: false,
      value: (...capabilities: readonly AnyClassCapability[]) => {
        for (const capability of capabilities) {
          capability.install(classTarget, schema);
          installedCapabilities.push(capability.kind);
          installedCapabilityValues.push(capability);
        }
        return classTarget;
      },
    },
    factories: {
      configurable: true,
      enumerable: false,
      value: (options: FactoryOptions) => {
        const next = {
          create: options.create === undefined ? factoryNames.create : options.create,
          hydrate: options.hydrate === undefined ? factoryNames.hydrate : options.hydrate,
        };
        installFactory(classTarget, factoryNames.create, next.create, create);
        installFactory(classTarget, factoryNames.hydrate, next.hydrate, hydrate);
        factoryNames = next;
        registerArtifact(classTarget, {
          kind: "class",
          schema,
          abstract: isAbstract,
          frozen: freezeInstances,
          aggregate,
          capabilities: installedCapabilities,
          factories: factoryNames,
          accessors,
        });
        return classTarget;
      },
    },
    accessors: {
      enumerable: false,
      value: (options: AccessorOptions<TSchema>) => {
        const next = createRuntimeClass(
          schema,
          isAbstract,
          freezeInstances,
          aggregate,
          resolveAccessors(properties, options)
        );

        next.use(...installedCapabilityValues);
        return next.factories(factoryNames) as RuntimeClass<TSchema>;
      },
    },
    identity: {
      enumerable: false,
      value: (key: Extract<keyof ATS.TypeofSchema<TSchema>, string>) => {
        const identity = classType.identity(key);
        identity.install(classTarget, schema);
        installedCapabilities.push(identity.kind);
        installedCapabilityValues.push(identity);
        registerArtifact(classTarget, {
          kind: "class",
          schema,
          abstract: isAbstract,
          frozen: freezeInstances,
          aggregate,
          capabilities: installedCapabilities,
          factories: factoryNames,
          accessors,
        });
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
    factories: factoryNames,
    accessors,
  });

  return classTarget;
}

function installFactory<TSchema extends ATS.AnyTypeSchema>(
  classTarget: RuntimeClass<TSchema>,
  previous: string | false,
  next: string | false,
  factory: Function
): void {
  if (previous !== false && previous !== next) Reflect.deleteProperty(classTarget, previous);
  if (next === false) return;
  if (next === "schema" || next === "use" || next === "factories" || next === "accessors" || next === "identity") {
    throw new JITError("INVALID_OPERATION", `Factory name ${JSON.stringify(next)} is reserved`);
  }
  Object.defineProperty(classTarget, next, { configurable: true, enumerable: false, value: factory });
}

function emitConstructor(
  properties: readonly string[],
  freezeInstances: boolean,
  aggregate: boolean,
  parse: (input: unknown) => unknown,
  accessors?: ResolvedAccessors
): unknown {
  const accessorByKey = new Map(accessors?.map((accessor) => [accessor.key, accessor]));
  const slots: string[] = [];
  const definitions: string[] = [];
  let slotIndex = 0;
  const assignments = properties.map((property) => {
    const accessor = accessorByKey.get(property);

    if (accessor?.field !== "private") {
      return `this${emitPropertyAccess("", property)} = state${emitPropertyAccess("", property)};`;
    }

    const slot = `#p${slotIndex++}`;
    slots.push(slot);
    if (accessor.get !== false) definitions.push(`get [${JSON.stringify(accessor.get)}]() { return this.${slot}; }`);
    if (accessor.set !== false)
      definitions.push(`set [${JSON.stringify(accessor.set)}](value) { this.${slot} = value; }`);
    return `this.${slot} = state${emitPropertyAccess("", property)};`;
  });
  const events = aggregate ? ' Object.defineProperty(this, "__jitEvents", { value: [], writable: true });' : "";
  const source = `return class JITRuntimeClass { ${slots.map((slot) => `${slot};`).join(" ")} constructor(input, validated) { const state = validated === true ? input : __parse(input); ${assignments.join(" ")}${events}${freezeInstances ? " Object.freeze(this);" : ""} } ${definitions.join(" ")} };`;

  return globalThis.Function("__parse", source)(parse);
}

function resolveAccessors<TSchema extends ATS.AnyTypeSchema>(
  properties: readonly string[],
  options: AccessorOptions<TSchema>
): ResolvedAccessors {
  return properties.map((key) => {
    const configured = {
      ...options.default,
      ...options.fields?.[key as Extract<keyof ATS.TypeofSchema<TSchema>, string>],
    };
    const get = resolveAccessorMember(key, configured.get);
    const set = resolveAccessorMember(key, configured.set);

    if (configured.field === "private" && get === false && set === false) {
      throw new JITError("INVALID_OPERATION", `Private field ${JSON.stringify(key)} must expose a getter or setter`);
    }
    return { key, field: configured.field ?? "public", get, set };
  });
}

function resolveAccessorMember(key: string, member: AccessorVisibility | AccessorMember | undefined): string | false {
  if (member === undefined) return key;
  if (member === false) return false;
  return typeof member === "string" ? key : (member.name ?? key);
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
    definePrototype(prototype, "equals", compileEqualMethod(schema));
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
): AbstractRuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & EqualsMethods & HashCodeMethods> {
  return createRuntimeClass(unwrapSchema(schema), true, true, false).use(classType.equals, classType.hashCode);
};

/** Entity preset: an abstract class with explicit identity semantics. */
export function entity<
  TSchema extends ATS.AnyTypeSchema,
  TKey extends Extract<keyof ATS.TypeofSchema<TSchema>, string>,
>(
  schema: SchemaInput<TSchema>,
  options: { readonly id: TKey }
): RuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods> {
  return createRuntimeClass(unwrapSchema(schema), true, false, false).use(classType.identity(options.id));
}

/** Abstract entity preset with ordered domain events and compiled in-place updates. */
export function aggregateRoot<
  TSchema extends ATS.AnyTypeSchema,
  TKey extends Extract<keyof ATS.TypeofSchema<TSchema>, string>,
>(
  schema: SchemaInput<TSchema>,
  options: { readonly id: TKey }
): AggregateRuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods & AggregateMethods<TSchema>> {
  const unwrapped = unwrapSchema(schema);
  const aggregate = createRuntimeClass(unwrapped, true, false, true).use(
    classType.identity(options.id)
  ) as AggregateRuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods & AggregateMethods<TSchema>>;
  const base = resolveWrappers(unwrapped).base as ATS.ObjectSchema;
  const fields = Object.keys(base.def.props);
  const readonlyFields = fields.filter((field) => resolveWrappers(base.def.props[field]).readonly);
  const updateBindings = new Map<string, string | null>();
  const updateNames: string[] = [];
  const updateValues: ((value: unknown, patch: unknown) => unknown)[] = [];

  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (readonlyFields.includes(field)) continue;
    if (isPrimitiveLikeSchema(resolveWrappers(base.def.props[field]).base)) {
      updateBindings.set(field, null);
      continue;
    }
    const name = `__update${index}`;
    updateBindings.set(field, name);
    updateNames.push(name);
    updateValues.push(compileUpdate(base.def.props[field]) as (value: unknown, patch: unknown) => unknown);
  }
  let updatedAt: string | undefined;
  let deletedAt: string | undefined;
  let version: string | undefined;
  const installMutation = () => {
    const mutation = buildMutationPlan({
      fields,
      readonlyFields,
      ...(updatedAt === undefined ? {} : { updatedAt }),
      ...(version === undefined ? {} : { version }),
    });
    const assign = globalThis.Function(
      ...updateNames,
      `return function update(patch) { ${emitMutationPlanBody(mutation, updateBindings)} };`
    )(...updateValues) as (this: object, patch: SchemaUpdate<TSchema>) => void;

    Object.defineProperty(aggregate.prototype, "update", {
      configurable: true,
      enumerable: false,
      value: assign,
    });
  };

  installMutation();
  Object.defineProperty(aggregate, "timestamps", {
    configurable: false,
    enumerable: false,
    value: (timestamp: TimestampOptions<TSchema>) => {
      const field = timestamp.updatedAt;
      const schemaForField = base.def.props[field];
      if (!schemaForField || resolveWrappers(schemaForField).base.type !== TypeName.date) {
        throw new JITError("INVALID_OPERATION", `Timestamp field ${JSON.stringify(field)} must be a Date schema`);
      }
      if (timestamp.touch !== undefined && timestamp.touch !== "mutation" && timestamp.touch !== "manual") {
        throw new JITError("INVALID_OPERATION", "Timestamp touch must be mutation or manual");
      }
      updatedAt = timestamp.touch === "manual" ? undefined : field;
      installMutation();
      setClassMutationArtifact(aggregate, {
        ...(updatedAt === undefined ? {} : { updatedAt }),
        ...(deletedAt === undefined ? {} : { deletedAt }),
        ...(version === undefined ? {} : { version }),
      });
      return aggregate;
    },
  });
  Object.defineProperty(aggregate, "softDelete", {
    configurable: false,
    enumerable: false,
    value: (options: SoftDeleteOptions<TSchema>) => {
      const field = options.field;
      const schemaForField = base.def.props[field];
      const resolved = schemaForField && resolveWrappers(schemaForField);
      if (!resolved || resolved.base.type !== TypeName.date || !resolved.nullable) {
        throw new JITError(
          "INVALID_OPERATION",
          `Soft-delete field ${JSON.stringify(field)} must be a nullable Date schema`
        );
      }
      deletedAt = field;
      definePrototype(aggregate.prototype, "softDelete", function softDelete(this: Record<string, unknown>) {
        const now = new Date();
        this[field] = now;
        if (updatedAt !== undefined) this[updatedAt] = now;
      });
      definePrototype(aggregate.prototype, "restore", function restore(this: Record<string, unknown>) {
        this[field] = null;
        if (updatedAt !== undefined) this[updatedAt] = new Date();
      });
      Object.defineProperty(aggregate.prototype, "isDeleted", {
        configurable: false,
        enumerable: false,
        get(this: Record<string, unknown>) {
          return this[field] !== null;
        },
      });
      setClassMutationArtifact(aggregate, {
        ...(updatedAt === undefined ? {} : { updatedAt }),
        deletedAt,
        ...(version === undefined ? {} : { version }),
      });
      return aggregate;
    },
  });
  Object.defineProperty(aggregate, "versioned", {
    configurable: false,
    enumerable: false,
    value: (options: VersionedOptions<TSchema>) => {
      const field = options.field;
      const schemaForField = base.def.props[field];
      const type = schemaForField && resolveWrappers(schemaForField).base.type;
      if (type !== TypeName.int && type !== TypeName.number) {
        throw new JITError(
          "INVALID_OPERATION",
          `Version field ${JSON.stringify(field)} must be a number or int schema`
        );
      }
      version = field;
      installMutation();
      setClassMutationArtifact(aggregate, {
        ...(updatedAt === undefined ? {} : { updatedAt }),
        ...(deletedAt === undefined ? {} : { deletedAt }),
        version,
      });
      return aggregate;
    },
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
  definePrototype(
    aggregate.prototype,
    "commit",
    async function commit(this: { __jitEvents: unknown[] }, publisher: EventPublisher): Promise<void> {
      const pending = this.__jitEvents;
      for (let index = 0; index < pending.length; index++) await publisher.publish(pending[index]);
      this.__jitEvents.splice(0, pending.length);
    }
  );
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
  "create" | "hydrate"
> &
  (new (
    input: Input<EventSchema<TPayload, TType, TVersion>>
  ) => DomainEventState<TPayload, TType, TVersion> & { readonly "~event": StandardEvent }) & {
    create(input: Input<TPayload>): DomainEventState<TPayload, TType, TVersion> & { readonly "~event": StandardEvent };
    hydrate(
      state: Hydrate<EventSchema<TPayload, TType, TVersion>>
    ): DomainEventState<TPayload, TType, TVersion> & { readonly "~event": StandardEvent };
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
    value: Object.freeze({ version: 1, type, schemaVersion: options.version } satisfies StandardEvent),
    writable: false,
  });
  registerArtifact(event, {
    kind: "class",
    schema,
    abstract: false,
    frozen: true,
    aggregate: false,
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
