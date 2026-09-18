import type { DiffChange } from "../compiler/diff.js";
import type * as ATS from "../core/ats/index.js";

/**
 * An immutable, tree-shakeable operation that installs one prototype capability.
 *
 * @example
 * ```ts
 * const User = JIT.class(UserSchema).extends(JIT.class.equals);
 * const capability: JIT.ClassCapability = JIT.class.equals;
 * ```
 */
export interface ClassCapability<TMethods extends object = object> {
  readonly kind: string;
  /** Installs the capability once on a generated class prototype. */
  install(classTarget: Function, schema: ATS.AnyTypeSchema): void;
  readonly __methods?: TMethods;
  /** Declaration-time names used by the member resolver; never emitted. */
  readonly __memberNames?: readonly string[];
  /** Declaration-time options used by structural DDD capabilities. */
  readonly __options?: unknown;
}

/**
 * A stable built-in capability can be selected either bare or as a callable.
 *
 * @example
 * ```ts
 * const User = JIT.class(UserSchema).extends(JIT.class.equals());
 * ```
 */
export interface CallableClassCapability<TMethods extends object = object> extends ClassCapability<TMethods> {
  /** Returns the same capability descriptor for fluent composition. */
  (): this;
}

/**
 * Application-owned methods installed on the generated prototype.
 *
 * One function per name, shared by every instance. There is no dispatcher: a
 * call reaches the prototype the way it reaches a hand-written class method.
 */
/**
 * Application-owned prototype fields and methods accepted by `.extends()`.
 *
 * @example
 * ```ts
 * const methods: ClassMethodsInput = { label() { return "user"; } };
 * ```
 */
export type ClassMethodsInput = Readonly<Record<string, unknown>>;
/**
 * Reusable class mixin with shared prototype methods.
 *
 * @example
 * ```ts
 * const Audited = JIT.class.mixin({ methods: { label() { return "audited"; } } });
 * const User = JIT.class(UserSchema).extends(Audited);
 * ```
 */
export interface ClassMixin<
  TOutput extends ClassMethodsInput = ClassMethodsInput,
  TRequires extends ClassMethodsInput = ClassMethodsInput,
> {
  /** Materializes the mixin's declared fields and methods for `.extends()`. */
  (): TOutput;
  readonly __classMixin: true;
  readonly __requires?: TRequires;
}
/** @internal Type helper shared by the runtime-class type contracts. */
export type NormalizedClassExtension<TExtension> =
  TExtension extends ClassMixin<infer TOutput>
    ? TOutput
    : TExtension extends (...args: never[]) => infer TOutput
      ? TOutput
      : TExtension;

/**
 * Minimal application-owned event publisher contract.
 *
 * @example
 * ```ts
 * const publisher: EventPublisher<DomainEvent> = { publish: async (event) => bus.send(event) };
 * ```
 */
export interface EventPublisher<TEvent = unknown> {
  /** Publishes one domain event to the application boundary. */
  publish(event: TEvent): void | PromiseLike<void>;
}

/**
 * Versioned structural metadata exposed by a domain-event instance.
 *
 * @example
 * ```ts
 * const metadata: StandardEvent = { version: 1, type: "UserCreated", schemaVersion: 1 };
 * ```
 */
export interface StandardEvent {
  readonly version: 1;
  readonly type: string;
  readonly schemaVersion: number;
}

declare const DOMAIN_EVENT: unique symbol;

/** Type-only marker carried by every event produced by `ddd.domainEvent()`. */
export interface DomainEventBrand {
  readonly [DOMAIN_EVENT]: true;
}

/**
 * Type-only marker shared by domain events.
 *
 * @example
 * ```ts
 * function publish(event: AnyDomainEvent) { return event; }
 * ```
 */
export type AnyDomainEvent = DomainEventBrand;

/** @internal Constructor shape used by aggregate event registration. */
export type DomainEventConstructor = abstract new (...args: never[]) => DomainEventBrand;
type DomainEventInstance<TConstructor> = TConstructor extends abstract new (
  ...args: never[]
) => infer TEvent
  ? TEvent
  : never;
/** @internal Union helper used by aggregate event registration. */
export type DomainEventUnion<TConstructors extends readonly DomainEventConstructor[]> = DomainEventInstance<
  TConstructors[number]
>;

/** @internal Type helper used by the runtime-class implementation. */
/** @internal Type helper shared by the runtime-class type contracts. */
export type AnyClassCapability = ClassCapability<object>;
/** @internal Type helper used by the runtime-class implementation. */
/** @internal Type helper shared by the runtime-class type contracts. */
export type EqualsMethods = { equals(other: unknown): boolean };
/** @internal Type helper used by the runtime-class implementation. */
/** @internal Type helper shared by the runtime-class type contracts. */
export type HashCodeMethods = { hashCode(): number };
/** @internal Type helper shared by the runtime-class type contracts. */
export type StructuralValueMethods = EqualsMethods & HashCodeMethods;
/** @internal Type helper used by the runtime-class implementation. */
/** @internal Type helper shared by the runtime-class type contracts. */
export type DiffMethods = { diff(other: unknown): DiffChange[] };
/** @internal Type helper shared by the runtime-class type contracts. */
export interface CloneMethods {
  clone(): this;
}
/** @internal Type helper used by the runtime-class implementation. */
/** @internal Type helper shared by the runtime-class type contracts. */
export type ValueAccessor<TValue> = { readonly value: TValue };
/**
 * Runtime representation of a scalar Value Object.
 *
 * @example
 * ```ts
 * const UserId = JIT.ddd.uniqueIdentifier();
 * const id: ScalarValueObject<string> = UserId.create();
 * id.value;
 * ```
 */
export interface ScalarValueObject<TValue> extends EqualsMethods, HashCodeMethods {
  readonly value: TValue;
}
/**
 * Configuration for timestamp field names and lifecycle behavior.
 *
 * @example
 * ```ts
 * const options: TimestampOptions = { createdAt: "createdOn", updatedAt: "updatedOn" };
 * const timestamps = JIT.ddd.timestamps(options);
 * ```
 */
export interface TimestampOptions {
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly touch?: "mutation" | "manual";
  /** Runtime clock. Omit it to emit a direct `new Date()` in runtime and AOT. */
  readonly clock?: () => Date;
  readonly methods?: {
    /** Prototype method name; defaults to `touch`. */
    readonly touch?: string;
  };
}
/**
 * Configuration for soft-delete state and method names.
 *
 * @example
 * ```ts
 * const capability = JIT.ddd.softDelete({ field: "deletedOn" });
 * ```
 */
export interface SoftDeleteOptions {
  readonly field?: string;
  /** Uses the timestamp clock when omitted and timestamps are installed. */
  readonly clock?: () => Date;
  readonly methods?: {
    readonly delete?: string;
    readonly restore?: string;
    readonly isDeleted?: string;
  };
}
/**
 * Configuration for optimistic version state.
 *
 * @example
 * ```ts
 * const capability = JIT.ddd.versioned({ field: "revision" });
 * ```
 */
export interface VersionedOptions {
  readonly field?: string;
}
/** @internal Type helper shared by the runtime-class type contracts. */
export type NamedMethod<TName extends string, TMethod> = {
  readonly [TKey in TName]: TMethod;
};
type OptionMethodName<TOptions, TKey extends PropertyKey, TFallback extends string> = TOptions extends {
  readonly methods: Record<TKey, infer TName extends string>;
}
  ? TName
  : TFallback;
type TimestampMethodsFor<TOptions> = NamedMethod<OptionMethodName<TOptions, "touch", "touch">, () => void>;
type VersionedMethods = { touch(): void };
type SoftDeleteMethodsFor<TOptions> = NamedMethod<OptionMethodName<TOptions, "delete", "softDelete">, () => void> &
  NamedMethod<OptionMethodName<TOptions, "restore", "restore">, () => void> &
  Readonly<NamedMethod<OptionMethodName<TOptions, "isDeleted", "isDeleted">, boolean>>;

/**
 * Installed timestamp capability and its generated method surface.
 *
 * @example
 * ```ts
 * const Order = JIT.ddd.aggregateRoot(OrderSchema).extends(JIT.ddd.timestamps());
 * ```
 */
export interface TimestampCapability<TOptions extends TimestampOptions = TimestampOptions>
  extends ClassCapability<TimestampMethodsFor<TOptions>> {
  readonly kind: "ddd.timestamps";
  readonly __options?: TOptions;
}

/**
 * Installed soft-delete capability and its generated method surface.
 *
 * @example
 * ```ts
 * const Order = JIT.ddd.aggregateRoot(OrderSchema).extends(JIT.ddd.softDelete());
 * ```
 */
export interface SoftDeleteCapability<TOptions extends SoftDeleteOptions = SoftDeleteOptions>
  extends ClassCapability<SoftDeleteMethodsFor<TOptions>> {
  readonly kind: "ddd.softDelete";
  readonly __options?: TOptions;
}

/**
 * Installed version capability and its generated method surface.
 *
 * @example
 * ```ts
 * const Order = JIT.ddd.aggregateRoot(OrderSchema).extends(JIT.ddd.versioned());
 * ```
 */
export interface VersionedCapability<TOptions extends VersionedOptions = VersionedOptions>
  extends ClassCapability<VersionedMethods> {
  readonly kind: "ddd.versioned";
  readonly __options?: TOptions;
}

/** @internal Type helper used by the runtime-class implementation. */
export interface ClassWithCapability extends CallableClassCapability<object> {
  readonly __with: true;
}

/** @internal Type helper used by the runtime-class implementation. */
export interface ClassCloneCapability extends CallableClassCapability<CloneMethods> {
  readonly __clone: true;
}
