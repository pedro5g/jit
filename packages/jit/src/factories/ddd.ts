import {
  abstractAggregateRoot,
  abstractEntity,
  abstractValueObject,
  aggregateRoot,
  domainEvent,
  entity,
  uniqueIdentifier,
  valueObject,
} from "./class.js";
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
export const ddd = Object.freeze({
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
  /** A collection that tracks additions and removals by semantic identity. */
  watchedList,
  /** Explicit base types that cannot be created until subclassed. */
  abstract: Object.freeze({
    valueObject: abstractValueObject,
    entity: abstractEntity,
    aggregateRoot: abstractAggregateRoot,
  }),
});
