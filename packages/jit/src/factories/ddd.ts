import { aggregateRoot, domainEvent, entity, valueObject } from "./class.js";

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
 * `create()` and `hydrate()` keep their canonical names across all four.
 */
export const ddd = Object.freeze({
  /** Structural equality, hashing and immutability. `.abstract` for a base. */
  valueObject,
  /** Identity semantics; abstract, and meant to be subclassed. */
  entity,
  /** Abstract entity with controlled mutation and an ordered event buffer. */
  aggregateRoot,
  /** Immutable, versioned event; `create()` takes the payload. */
  domainEvent,
});
