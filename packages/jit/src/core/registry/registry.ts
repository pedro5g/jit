import { RegistryDuplicateIdError } from "../../errors/index.js";

/** One schema-to-metadata entry in a typed registry. */
export interface RegistryEntry<TMetadata> {
  /** Schema object that owns the descriptive metadata. */
  readonly schema: object;
  /** Typed descriptive metadata associated with the schema. */
  readonly metadata: TMetadata;
  /** Optional unique metadata identifier within the registry. */
  readonly id?: string;
}

/** Typed descriptive metadata registry. It never mutates a schema node. */
export interface Registry<TMetadata = unknown> {
  /** Stable identifier for this registry instance. */
  readonly id: string;
  /** Associates metadata with a schema, rejecting a duplicate metadata id. */
  register(schema: object, metadata: TMetadata): void;
  /** Returns metadata registered for a schema. */
  get(schema: object): TMetadata | undefined;
  /** Finds metadata by its optional unique `id`. */
  getById(id: string): TMetadata | undefined;
  /** Reports whether this registry contains metadata for a schema. */
  has(schema: object): boolean;
  /** Returns an immutable snapshot of the registry entries. */
  entries(): readonly RegistryEntry<TMetadata>[];
}

const schemaRegistries = new WeakMap<object, Set<Registry<unknown>>>();

/** Concrete registry implementation shared by runtime and define hosts. */
export class TypedRegistry<TMetadata = unknown> implements Registry<TMetadata> {
  readonly id: string;
  private readonly bySchema = new WeakMap<object, TMetadata>();
  private readonly byId = new Map<string, object>();
  private readonly records = new Map<object, RegistryEntry<TMetadata>>();

  constructor(id: string) {
    this.id = id;
  }

  register(schema: object, metadata: TMetadata): void {
    const id = metadataId(metadata);
    if (id !== undefined) {
      const existing = this.byId.get(id);
      if (existing !== undefined && existing !== schema) throw new RegistryDuplicateIdError(id);
      this.byId.set(id, schema);
    }

    const previous = this.records.get(schema);
    if (previous?.id !== undefined && previous.id !== id) this.byId.delete(previous.id);

    const entry = Object.freeze({ schema, metadata, ...(id === undefined ? {} : { id }) });
    this.bySchema.set(schema, metadata);
    this.records.set(schema, entry);

    let registries = schemaRegistries.get(schema);
    if (registries === undefined) {
      registries = new Set();
      schemaRegistries.set(schema, registries);
    }
    registries.add(this as unknown as Registry<unknown>);
  }

  get(schema: object): TMetadata | undefined {
    return this.bySchema.get(schema);
  }

  getById(id: string): TMetadata | undefined {
    const schema = this.byId.get(id);
    return schema === undefined ? undefined : this.bySchema.get(schema);
  }

  has(schema: object): boolean {
    return this.records.has(schema);
  }

  entries(): readonly RegistryEntry<TMetadata>[] {
    return Object.freeze([...this.records.values()]);
  }
}

let registryOrdinal = 0;

/** Creates a typed registry with a stable process-local identifier. */
export function createRegistry<TMetadata = unknown>(id = `registry-${++registryOrdinal}`): Registry<TMetadata> {
  return new TypedRegistry<TMetadata>(id);
}

/** Returns merged metadata registered for a schema across all known registries. */
export function metadataForSchema(schema: object): Readonly<Record<string, unknown>> | undefined {
  const registries = schemaRegistries.get(schema);
  if (registries === undefined) return undefined;

  let result: Record<string, unknown> | undefined;
  for (const registry of [...registries].sort((left, right) => left.id.localeCompare(right.id))) {
    const metadata = registry.get(schema);
    if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) continue;
    result ??= {};
    Object.assign(result, metadata);
  }
  return result === undefined ? undefined : Object.freeze(result);
}

function metadataId(metadata: unknown): string | undefined {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return undefined;
  const id = (metadata as { readonly id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}
