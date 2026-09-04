import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import * as Transform from "../transforms/index.js";
import { ResolvedMemberTable } from "./members.js";

export type DddCapabilityKind = "ddd.timestamps" | "ddd.softDelete" | "ddd.versioned";
export type ManagedFieldResolutionState = "MISSING" | "COMPATIBLE" | "AUGMENTABLE" | "CONFLICT";

export interface TimestampCapabilityDefinition {
  readonly kind: "ddd.timestamps";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly touch?: "mutation" | "manual";
  readonly clock?: () => Date;
  readonly touchMethod: string;
}

export interface SoftDeleteCapabilityDefinition {
  readonly kind: "ddd.softDelete";
  readonly field: string;
  readonly clock?: () => Date;
  readonly deleteMethod: string;
  readonly restoreMethod: string;
  readonly isDeletedMember: string;
}

export interface VersionedCapabilityDefinition {
  readonly kind: "ddd.versioned";
  readonly field: string;
}

export interface LifecycleDefinition {
  readonly timestamps?: TimestampCapabilityDefinition;
  readonly softDelete?: SoftDeleteCapabilityDefinition;
  readonly versioned?: VersionedCapabilityDefinition;
}

export interface ManagedFieldDescriptor {
  readonly field: string;
  readonly owner: DddCapabilityKind;
  readonly role: "createdAt" | "updatedAt" | "deletedAt" | "version";
  readonly userMutable: false;
  readonly creation: "clock" | "null" | "zero";
  readonly clock?: () => Date;
  readonly hydration: "required";
  readonly mutation: "immutable" | "timestamp" | "delete" | "version";
}

export interface EffectiveSchemaState {
  readonly schema: ATS.AnyTypeSchema;
  readonly lifecycle: LifecycleDefinition;
  readonly managedFields: readonly ManagedFieldDescriptor[];
  readonly members: ResolvedMemberTable;
}

export interface CapabilityOptions {
  readonly updatedAt?: string;
  readonly createdAt?: string;
  readonly touch?: "mutation" | "manual";
  readonly clock?: () => Date;
  readonly field?: string;
  readonly methods?: {
    readonly touch?: string;
    readonly delete?: string;
    readonly restore?: string;
    readonly isDeleted?: string;
  };
}

const EMPTY_LIFECYCLE: LifecycleDefinition = Object.freeze({});
const MANAGED_CREATED_AT_DEFAULT = (): Date => new Date();

/** Resolves a class schema to the object node that owns its fields. */
export function resolveEffectiveObjectSchema(schema: ATS.AnyTypeSchema): ATS.ObjectSchema {
  const base = resolveWrappers(schema).base;
  if (base.type !== TypeName.object) throw new Error("JIT Runtime Class requires an object schema");
  return base as ATS.ObjectSchema;
}

/**
 * Applies one structural DDD capability to a declaration.
 *
 * Field discovery and augmentation happen here, before any class compiler is
 * invoked. Managed fields are always readonly in the effective schema, which
 * makes the normal Update type and the generated mutation agree.
 */
export function applyDddCapability(
  state: EffectiveSchemaState,
  kind: DddCapabilityKind,
  rawOptions: CapabilityOptions | undefined
): EffectiveSchemaState {
  const options = rawOptions ?? {};
  const object = resolveEffectiveObjectSchema(state.schema);
  const props: Record<string, ATS.AnyTypeSchema> = { ...object.def.props };
  const lifecycle: {
    timestamps?: TimestampCapabilityDefinition;
    softDelete?: SoftDeleteCapabilityDefinition;
    versioned?: VersionedCapabilityDefinition;
  } = { ...state.lifecycle };
  const managed = [...state.managedFields];
  const members = state.members.clone();

  if (kind === "ddd.timestamps") {
    if (lifecycle.timestamps !== undefined) throw new Error("Timestamps are already configured for this Runtime Class");
    const createdAt = options.createdAt ?? "createdAt";
    const updatedAt = options.updatedAt ?? "updatedAt";
    ensureDistinctFields(createdAt, updatedAt, "timestamps");
    ensureFieldMemberAvailable(members, createdAt, kind);
    ensureFieldMemberAvailable(members, updatedAt, kind);
    props[createdAt] = resolveManagedField(props[createdAt], "createdAt", "ddd.timestamps", options.clock);
    props[updatedAt] = resolveManagedField(props[updatedAt], "updatedAt", "ddd.timestamps");
    members.add({ name: createdAt, kind: "field", source: "capability", owner: kind, schema: props[createdAt] });
    members.add({ name: updatedAt, kind: "field", source: "capability", owner: kind, schema: props[updatedAt] });
    lifecycle.timestamps = Object.freeze({
      kind,
      createdAt,
      updatedAt,
      ...(options.touch === undefined ? {} : { touch: options.touch }),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      touchMethod: options.methods?.touch ?? "touch",
    });
    addManaged(managed, {
      field: createdAt,
      owner: kind,
      role: "createdAt",
      userMutable: false,
      creation: "clock",
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      hydration: "required",
      mutation: "immutable",
    });
    addManaged(managed, {
      field: updatedAt,
      owner: kind,
      role: "updatedAt",
      userMutable: false,
      creation: "null",
      hydration: "required",
      mutation: "timestamp",
    });
    ensureMethodMemberAvailable(members, options.methods?.touch ?? "touch", kind);
    addMember(members, lifecycle.timestamps.touchMethod, "capability", kind, "method");
  } else if (kind === "ddd.softDelete") {
    if (lifecycle.softDelete !== undefined) {
      throw new Error("Soft delete is already configured for this Runtime Class");
    }
    const field = options.field ?? "deletedAt";
    ensureFieldMemberAvailable(members, field, kind);
    props[field] = resolveManagedField(props[field], "deletedAt", kind);
    members.add({ name: field, kind: "field", source: "capability", owner: kind, schema: props[field] });
    lifecycle.softDelete = Object.freeze({
      kind,
      field,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      deleteMethod: options.methods?.delete ?? "softDelete",
      restoreMethod: options.methods?.restore ?? "restore",
      isDeletedMember: options.methods?.isDeleted ?? "isDeleted",
    });
    ensureDistinctMembers(
      [lifecycle.softDelete.deleteMethod, lifecycle.softDelete.restoreMethod, lifecycle.softDelete.isDeletedMember],
      kind
    );
    ensureMethodMemberAvailable(members, lifecycle.softDelete.deleteMethod, kind);
    ensureMethodMemberAvailable(members, lifecycle.softDelete.restoreMethod, kind);
    ensureMethodMemberAvailable(members, lifecycle.softDelete.isDeletedMember, kind);
    addManaged(managed, {
      field,
      owner: kind,
      role: "deletedAt",
      userMutable: false,
      creation: "null",
      hydration: "required",
      mutation: "delete",
    });
    addMember(members, lifecycle.softDelete.deleteMethod, "capability", kind, "method");
    addMember(members, lifecycle.softDelete.restoreMethod, "capability", kind, "method");
    addMember(members, lifecycle.softDelete.isDeletedMember, "capability", kind, "getter");
  } else {
    if (lifecycle.versioned !== undefined) throw new Error("Versioning is already configured for this Runtime Class");
    const field = options.field ?? "version";
    ensureFieldMemberAvailable(members, field, kind);
    props[field] = resolveManagedField(props[field], "version", kind);
    members.add({ name: field, kind: "field", source: "capability", owner: kind, schema: props[field] });
    lifecycle.versioned = Object.freeze({ kind, field });
    addManaged(managed, {
      field,
      owner: kind,
      role: "version",
      userMutable: false,
      creation: "zero",
      hydration: "required",
      mutation: "version",
    });
  }

  const nextSchema = createSchema(
    TypeName.object,
    {
      props,
      unknownKeys: object.def.unknownKeys,
      catchall: object.def.catchall,
      checks: object.def.checks,
    },
    object.annotations
  );

  validateManagedFields(nextSchema, managed);
  return Object.freeze({
    schema: nextSchema,
    lifecycle: Object.freeze(lifecycle),
    managedFields: Object.freeze(managed),
    members,
  });
}

/** Rechecks all ownership contracts after an explicit field overwrite. */
export function validateManagedFields(schema: ATS.AnyTypeSchema, managed: readonly ManagedFieldDescriptor[]): void {
  const object = resolveEffectiveObjectSchema(schema);
  for (const descriptor of managed) {
    const field = object.def.props[descriptor.field];
    if (field === undefined) {
      throw new Error(`Managed field ${JSON.stringify(descriptor.field)} was removed from the class schema`);
    }
    const resolved = resolveWrappers(field);
    const expected =
      descriptor.role === "version" ? "int or number" : descriptor.role === "createdAt" ? "Date" : "nullable Date";
    const validType =
      descriptor.role === "version"
        ? resolved.base.type === TypeName.int || resolved.base.type === TypeName.number
        : resolved.base.type === TypeName.date;
    const validNullability =
      descriptor.role === "updatedAt" || descriptor.role === "deletedAt" ? resolved.nullable : !resolved.nullable;
    if (!validType || !validNullability) {
      throw new Error(
        `DDD capability ${descriptor.owner} cannot manage ${descriptor.role} ${JSON.stringify(descriptor.field)}: expected ${expected}`
      );
    }
    if (!resolved.readonly) {
      throw new Error(`Managed field ${JSON.stringify(descriptor.field)} must remain readonly`);
    }
  }
}

/**
 * Restores only the managed semantics after an explicit field overwrite.
 * User-compatible defaults are retained; missing lifecycle wrappers are
 * re-added before the final compatibility check.
 */
export function reapplyManagedFields(
  schema: ATS.AnyTypeSchema,
  managed: readonly ManagedFieldDescriptor[]
): ATS.AnyTypeSchema {
  const object = resolveEffectiveObjectSchema(schema);
  if (managed.length === 0) return schema;
  const props: Record<string, ATS.AnyTypeSchema> = { ...object.def.props };
  for (const descriptor of managed) {
    props[descriptor.field] = resolveManagedField(
      props[descriptor.field],
      descriptor.role,
      descriptor.owner,
      descriptor.clock
    );
  }
  const next = createSchema(
    TypeName.object,
    {
      props,
      unknownKeys: object.def.unknownKeys,
      catchall: object.def.catchall,
      checks: object.def.checks,
    },
    object.annotations
  );
  validateManagedFields(next, managed);
  return next;
}

export function initialEffectiveSchema(schema: ATS.AnyTypeSchema): EffectiveSchemaState {
  const object = resolveEffectiveObjectSchema(schema);
  const members = new ResolvedMemberTable();
  for (const [name, field] of Object.entries(object.def.props)) {
    members.add({ name, kind: "field", source: "schema", schema: field });
  }
  return {
    schema,
    lifecycle: EMPTY_LIFECYCLE,
    managedFields: [],
    members,
  };
}

export function addMember(
  members: ResolvedMemberTable,
  name: string,
  source: "preset" | "capability" | "extension" | "overwrite",
  owner: string,
  kind: "method" | "getter" | "setter" | "factory"
): void {
  members.add({ name, kind, source, owner });
}

function addManaged(target: ManagedFieldDescriptor[], descriptor: ManagedFieldDescriptor): void {
  const index = target.findIndex((item) => item.field === descriptor.field);
  if (index === -1) target.push(Object.freeze(descriptor));
  else {
    const previous = target[index];
    if (previous?.owner !== descriptor.owner || previous.role !== descriptor.role) {
      throw new Error(
        `Managed field ${JSON.stringify(descriptor.field)} is already owned by ${previous?.owner ?? "another capability"}`
      );
    }
    target[index] = Object.freeze(descriptor);
  }
}

function ensureDistinctFields(left: string, right: string, owner: string): void {
  if (left === right) throw new Error(`${owner} fields must be distinct`);
}

function ensureDistinctMembers(names: readonly string[], owner: string): void {
  if (new Set(names).size !== names.length) throw new Error(`${owner} member names must be distinct`);
}

function ensureFieldMemberAvailable(members: ResolvedMemberTable, name: string, owner: string): void {
  const existing = members.get(name);
  if (existing !== undefined && existing.kind !== "field") {
    throw new Error(`${owner} field ${JSON.stringify(name)} collides with existing ${existing.kind} member`);
  }
}

function ensureMethodMemberAvailable(members: ResolvedMemberTable, name: string, owner: string): void {
  if (members.has(name))
    throw new Error(`${owner} member ${JSON.stringify(name)} collides with an existing class member`);
}

function resolveManagedField(
  existing: ATS.AnyTypeSchema | undefined,
  role: ManagedFieldDescriptor["role"],
  owner: DddCapabilityKind,
  creationClock?: () => Date
): ATS.AnyTypeSchema {
  if (existing === undefined) {
    if (role === "createdAt")
      return managedDate(false, creationClock === undefined ? MANAGED_CREATED_AT_DEFAULT : managedClock(creationClock));
    if (role === "updatedAt" || role === "deletedAt") return managedDate(true, null);
    return managedVersion(0);
  }

  const resolution = resolveManagedFieldState(existing, role);
  if (resolution === "CONFLICT") {
    throw new Error(
      `DDD capability ${owner} cannot manage ${JSON.stringify(role)}: field is not compatible with its canonical type`
    );
  }
  const resolved = resolveWrappers(existing);
  const expectedNullable = role === "updatedAt" || role === "deletedAt";
  const defaultValue = findDefault(existing);

  let result = existing;
  if (expectedNullable && !resolved.nullable) result = Transform.nullable(result);
  if (!defaultValue.present) {
    result = Transform.default(
      result,
      role === "createdAt"
        ? creationClock === undefined
          ? MANAGED_CREATED_AT_DEFAULT
          : managedClock(creationClock)
        : role === "version"
          ? 0
          : null
    );
  }
  if (!resolveWrappers(result).readonly) result = Transform.readonly(result);
  return result;
}

/**
 * Classifies a declared lifecycle field before applying capability semantics.
 * The classification is declaration-only; no generated runtime path consults
 * it after the effective schema has been materialized.
 */
export function resolveManagedFieldState(
  existing: ATS.AnyTypeSchema | undefined,
  role: ManagedFieldDescriptor["role"]
): ManagedFieldResolutionState {
  if (existing === undefined) return "MISSING";
  const resolved = resolveWrappers(existing);
  const expectedNullable = role === "updatedAt" || role === "deletedAt";
  const validBase =
    role === "version"
      ? resolved.base.type === TypeName.int || resolved.base.type === TypeName.number
      : resolved.base.type === TypeName.date;
  if (!validBase || (!expectedNullable && resolved.nullable)) return "CONFLICT";

  const defaultValue = findDefault(existing);
  const expectedDefault = role === "createdAt" ? MANAGED_CREATED_AT_DEFAULT : role === "version" ? 0 : null;
  if (
    defaultValue.present &&
    (role === "createdAt" ? defaultValue.value !== expectedDefault : defaultValue.value !== expectedDefault)
  ) {
    return "CONFLICT";
  }
  return resolved.nullable === expectedNullable && resolved.readonly && defaultValue.present
    ? "COMPATIBLE"
    : "AUGMENTABLE";
}

function managedDate(nullable: boolean, defaultValue: Date | null | (() => Date)): ATS.AnyTypeSchema {
  const date = createSchema(TypeName.date, { checks: [] });
  const value = nullable ? Transform.nullable(date) : date;
  return Transform.readonly(Transform.default(value, defaultValue));
}

function managedClock(clock: () => Date): () => Date {
  return () => {
    const value = clock();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new Error("A DDD clock must return a valid Date");
    }
    return value;
  };
}

function managedVersion(defaultValue: number): ATS.AnyTypeSchema {
  const version = createSchema(TypeName.int, { checks: [] });
  return Transform.readonly(Transform.default(version, defaultValue));
}

function findDefault(schema: ATS.AnyTypeSchema): { readonly present: boolean; readonly value?: unknown } {
  let current = schema;
  while (true) {
    if (current.type === TypeName.default) {
      return { present: true, value: (current.def as ATS.DefaultDef).defaultValue };
    }
    if (current.type === TypeName.lazy) {
      current = (current.def as ATS.LazyDef).getter();
      continue;
    }
    if (
      current.type === TypeName.optional ||
      current.type === TypeName.nullable ||
      current.type === TypeName.nullish ||
      current.type === TypeName.readonly ||
      current.type === TypeName.brand ||
      current.type === TypeName.refine ||
      current.type === TypeName.coerce ||
      current.type === TypeName.pipe ||
      current.type === TypeName.transform
    ) {
      current = (current.def as ATS.InnerTypeDef).innerType;
      continue;
    }
    return { present: false };
  }
}
