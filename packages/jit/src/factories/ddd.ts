import type { ClassMixin } from "./class.js";
import {
  abstractAggregateRoot,
  abstractEntity,
  abstractValueObject,
  aggregateRoot,
  domainEvent,
  entity,
  softDelete,
  timestamps,
  uniqueIdentifier,
  valueObject,
  versioned,
} from "./class-ddd.js";
import { watchedList } from "./watch.js";

/**
 * Domain-driven design presets.
 *
 * Each one is a configuration of the Runtime Class machinery rather than a
 * separate engine: `JIT.class` builds the class, and these decide which
 * capabilities it is born with. They are grouped here because they are a
 * vocabulary — a reader who wants an entity is not shopping among the
 * schema factories — while `JIT.class` stays top level, being the primitive
 * that DTOs, JSON pipelines and AOT class artifacts build on too.
 *
 * Runtime Type presets keep canonical `create()` and `hydrate()` names.
 */
const dddBase = {
  /** Structural equality, hashing and immutability. */
  valueObject,
  /** Concrete factory-first Runtime Type with identity semantics. */
  entity,
  /** Concrete Entity with controlled mutation and an ordered event buffer. */
  aggregateRoot,
  /** Immutable, versioned event; `create()` takes the payload. */
  domainEvent,
  /** Scalar identifier Value Object; defaults to a generated UUID. */
  uniqueIdentifier,
  /** Aggregate timestamp capability, installed through `.extends(...)`. */
  timestamps,
  /** Aggregate soft-delete capability, installed through `.extends(...)`. */
  softDelete,
  /** Aggregate optimistic-version capability, installed through `.extends(...)`. */
  versioned,
  /** A collection that tracks additions and removals by semantic identity. */
  watchedList,
  /** Explicit base types that cannot be created until subclassed. */
  abstract: Object.freeze({
    valueObject: abstractValueObject,
    entity: abstractEntity,
    aggregateRoot: abstractAggregateRoot,
  }),
};

/**
 * Declaration-merging surface for application-defined DDD extensions.
 *
 * @example
 * ```ts
 * const custom = JIT.ddd.$extends({ aggregate: () => JIT.class.mixin({}) });
 * ```
 */
export interface DddExtensions {}
type DddExtensionFactory = (...args: never[]) => ClassMixin;
const DDD_BUILTINS = new Set(Object.keys(dddBase).concat("$extends"));
const registered = new Map<string, DddExtensionFactory>();

/**
 * DDD presets and application extension factories.
 *
 * @example
 * ```ts
 * const User = JIT.ddd.entity(JIT.object({ id: JIT.string() }));
 * const user = User.create({ id: "u1" });
 * ```
 */
export type DddNamespace = typeof dddBase &
  DddExtensions & {
    readonly $extends: <T extends Record<string, DddExtensionFactory>>(extensions: T) => typeof ddd & T;
  };

function extendDdd<T extends Record<string, DddExtensionFactory>>(extensions: T): typeof ddd & T {
  for (const [name, factory] of Object.entries(extensions)) {
    if (DDD_BUILTINS.has(name)) {
      throw new JITError("DDD_EXTENSION_ALREADY_EXISTS", `DDD built-in ${JSON.stringify(name)} cannot be replaced`);
    }
    const previous = registered.get(name);
    if (previous !== undefined && previous !== factory) {
      throw new JITError("DDD_EXTENSION_ALREADY_EXISTS", `DDD extension ${JSON.stringify(name)} is already registered`);
    }
    if (previous === undefined) {
      registered.set(name, factory);
      Object.defineProperty(ddd, name, {
        configurable: false,
        enumerable: true,
        value: factory,
        writable: false,
      });
    }
  }
  return Object.freeze({ ...ddd, $extends: extendDdd }) as typeof ddd & T;
}

import { JITError } from "../errors/index.js";

/**
 * Runtime namespace for value objects, entities, aggregates and domain events.
 *
 * @example
 * ```ts
 * const User = JIT.ddd.entity(JIT.object({ id: JIT.string() }));
 * User.create({ id: "u1" });
 * ```
 */
export const ddd = {
  ...dddBase,
  $extends: extendDdd,
} as DddNamespace;

for (const name of Object.keys(dddBase)) {
  Object.defineProperty(ddd, name, {
    configurable: false,
    enumerable: true,
    value: ddd[name as keyof typeof dddBase],
    writable: false,
  });
}
