import {
  addMember,
  applyDddCapability,
  type DddCapabilityKind,
  reapplyManagedFields,
} from "./classes/effective-schema.js";
import { type ClassMemberDefinition, isClassMemberDescriptor } from "./classes/member-descriptors.js";
import type { ResolvedClassMember, ResolvedMemberTable } from "./classes/members.js";
import { isOverrideDescriptor, type OverrideDescriptor } from "./classes/override.js";
import { resolveWrappers } from "./compiler/resolvers/resolve-wrappers.js";
import { hasSchemaDefault } from "./compiler/schema-default.js";
import type * as ATS from "./core/ats/index.js";
import { createSchema, TypeName } from "./core/ats/index.js";
import type { SchemaInput } from "./core/builder/index.js";
import { unwrapSchema } from "./core/builder/index.js";
import type {
  DefinedCapability,
  DefinedClassFieldPolicy,
  DefinedClassMethod,
  DefinedClassState,
} from "./define-class-state.js";
import {
  DEFINED_RESERVED_MEMBER_NAMES,
  definedCapabilityMembers,
  definedCapabilityOptions,
  isDefinedClassMixin,
  isDefinedSchemaInput,
} from "./define-class-state.js";
import { JITError } from "./errors/index.js";
import type { ClassMethodsInput, ClassMixin } from "./factories/class.js";

interface MutableDefinedExtensionState {
  readonly base: DefinedClassState;
  schema: ATS.AnyTypeSchema;
  readonly methods: DefinedClassMethod[];
  readonly members: ResolvedMemberTable;
  readonly fieldPolicies: DefinedClassFieldPolicy[];
}

type DefinedExtension = DefinedCapability | ClassMethodsInput | ClassMixin;

export function defineClassExtensions(
  state: DefinedClassState,
  extensions: readonly DefinedExtension[]
): DefinedClassState {
  let next = state;
  for (const rawExtension of extensions) {
    const extension = isDefinedClassMixin(rawExtension) ? rawExtension() : rawExtension;
    next = isDefinedCapability(extension)
      ? applyDefinedCapability(next, extension)
      : applyDefinedObject(next, extension as ClassMethodsInput);
  }
  return next;
}

function isDefinedCapability(value: unknown): value is DefinedCapability {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { readonly install?: unknown }).install === "function"
  );
}

function applyDefinedCapability(state: DefinedClassState, capability: DefinedCapability): DefinedClassState {
  if (state.capabilities.includes(capability.kind)) {
    throw new JITError("INVALID_OPERATION", `Class capability ${JSON.stringify(capability.kind)} is already installed`);
  }
  for (const name of definedCapabilityMembers(capability)) {
    if (state.members.has(name)) {
      throw new JITError(
        "CLASS_MEMBER_ALREADY_EXISTS",
        `Member ${JSON.stringify(name)} already exists; use JIT.class.override(...) explicitly`
      );
    }
  }
  if (isDefinedDddCapability(capability)) return applyDefinedDddCapability(state, capability);
  const members = state.members.clone();
  for (const name of definedCapabilityMembers(capability))
    addMember(members, name, "capability", capability.kind, "method");
  return { ...state, capabilities: [...state.capabilities, capability.kind], members };
}

function isDefinedDddCapability(
  capability: DefinedCapability
): capability is DefinedCapability & { readonly kind: DddCapabilityKind } {
  return (
    capability.kind === "ddd.timestamps" || capability.kind === "ddd.softDelete" || capability.kind === "ddd.versioned"
  );
}

function applyDefinedDddCapability(
  state: DefinedClassState,
  capability: DefinedCapability & { readonly kind: DddCapabilityKind }
): DefinedClassState {
  try {
    const resolved = applyDddCapability(
      {
        schema: state.schema,
        lifecycle: state.lifecycle,
        managedFields: state.managedFields,
        members: state.members,
      },
      capability.kind,
      definedCapabilityOptions(capability)
    );
    return {
      ...state,
      schema: resolved.schema,
      lifecycle: resolved.lifecycle,
      managedFields: resolved.managedFields,
      members: resolved.members,
      capabilities: [...state.capabilities, capability.kind],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new JITError("DDD_CAPABILITY_SCHEMA_CONFLICT", `${capability.kind} declaration conflict: ${message}`);
  }
}

function applyDefinedObject(state: DefinedClassState, extension: ClassMethodsInput): DefinedClassState {
  const mutable: MutableDefinedExtensionState = {
    base: state,
    schema: state.schema,
    methods: [...state.methods],
    members: state.members.clone(),
    fieldPolicies: [...state.fieldPolicies],
  };
  for (const name of Object.getOwnPropertyNames(extension)) {
    const descriptor = Object.getOwnPropertyDescriptor(extension, name);
    if (descriptor === undefined) continue;
    applyDefinedMember(mutable, name, descriptor, descriptor.value);
  }
  return {
    ...state,
    schema: mutable.schema,
    methods: mutable.methods,
    members: mutable.members,
    fieldPolicies: mutable.fieldPolicies,
  };
}

function applyDefinedMember(
  state: MutableDefinedExtensionState,
  name: string,
  descriptor: PropertyDescriptor,
  value: unknown
): void {
  if (isOverrideDescriptor(value)) {
    applyDefinedOverride(state, name, value);
    return;
  }
  if (state.members.has(name) || DEFINED_RESERVED_MEMBER_NAMES.has(name)) {
    throw new JITError(
      "CLASS_MEMBER_ALREADY_EXISTS",
      `Member ${JSON.stringify(name)} already exists. Use ${JSON.stringify(`${name}: JIT.class.override(...)`)} to replace it.`
    );
  }
  if (isClassMemberDescriptor(value)) {
    applyDefinedContract(state, name, value.definition);
    return;
  }
  if (isDefinedSchemaInput(value)) {
    addDefinedSchemaField(state, name, unwrapSchema(value));
    return;
  }
  addDefinedMethod(state, name, descriptor);
}

function applyDefinedOverride(state: MutableDefinedExtensionState, name: string, value: OverrideDescriptor): void {
  const existing = state.members.get(name);
  if (existing === undefined) {
    throw new JITError(
      "CLASS_OVERRIDE_TARGET_NOT_FOUND",
      `Class member ${JSON.stringify(name)} does not exist. JIT.class.override() can only replace an existing member.`
    );
  }
  if (isClassMemberDescriptor(value.value)) {
    applyDefinedContractOverride(state, name, existing, value.value.definition);
    return;
  }
  if (isDefinedSchemaInput(value.value)) {
    if (existing.kind !== "field") throwDefinedFieldConflict(name);
    replaceDefinedSchemaField(state, name, unwrapSchema(value.value as SchemaInput<ATS.AnyTypeSchema>), existing);
    return;
  }
  replaceDefinedMethod(state, name, value.value, existing);
}

function applyDefinedContractOverride(
  state: MutableDefinedExtensionState,
  name: string,
  existing: ResolvedClassMember,
  definition: ClassMemberDefinition
): void {
  if (definition.kind === "factory") {
    throw new JITError("CLASS_FACTORY_CONFLICT", "Factory descriptors cannot override instance members");
  }
  if (definition.kind === "method") {
    if (existing.kind === "field") throwDefinedFieldConflict(name);
    if (definition.implementation === undefined)
      throw new JITError("INVALID_OPERATION", `Class method ${JSON.stringify(name)} must be implemented`);
    replaceMethod(state.methods, name, { name, kind: "method", source: definition.implementation });
    state.members.replace(name, { ...existing, source: "override", descriptor: { value: definition.implementation } });
    return;
  }
  if (definition.kind === "field" && definition.schema !== undefined) {
    if (existing.kind !== "field") throwDefinedFieldConflict(name);
    replaceDefinedSchemaField(state, name, unwrapSchema(definition.schema), existing);
    applyDefinedFieldPolicy(state.fieldPolicies, name, definition);
    return;
  }
  if (definition.kind === "accessor") {
    replaceDefinedAccessorMethods(state.methods, name, definition);
    applyDefinedFieldPolicy(state.fieldPolicies, name, definition);
    state.members.replace(name, { ...existing, source: "override" });
    return;
  }
  throw new JITError("INVALID_OPERATION", `Override ${JSON.stringify(name)} must provide a method`);
}

function replaceDefinedMethod(
  state: MutableDefinedExtensionState,
  name: string,
  value: unknown,
  existing: ResolvedClassMember
): void {
  if (existing.kind === "field") throwDefinedFieldConflict(name);
  if (typeof value !== "function") {
    throw new JITError("INVALID_OPERATION", `Override ${JSON.stringify(name)} must provide a method`);
  }
  const replacement = { name, kind: "method" as const, source: value };
  replaceMethod(state.methods, name, replacement);
  state.members.replace(name, { ...existing, source: "override", descriptor: { value } });
}

function applyDefinedContract(
  state: MutableDefinedExtensionState,
  name: string,
  definition: ClassMemberDefinition
): void {
  if (definition.kind === "factory") {
    throw new JITError(
      "CLASS_FACTORY_CONFLICT",
      "Factory descriptors belong in .factories(), not an instance extension"
    );
  }
  if (definition.kind === "method") {
    if (definition.implementation === undefined)
      throw new JITError("INVALID_OPERATION", `Class method ${JSON.stringify(name)} must be implemented`);
    state.methods.push({ name, kind: "method", source: definition.implementation });
    addMember(state.members, name, "extension", "custom extension", "method");
    return;
  }
  if (definition.kind === "field" && definition.schema !== undefined) {
    const field = unwrapSchema(definition.schema);
    if (definition.noConstructor === true && !hasSchemaDefault(field)) {
      throw new JITError(
        "CLASS_FIELD_DESCRIPTOR_CONFLICT",
        `No-constructor field ${JSON.stringify(name)} requires a default initializer`
      );
    }
    addDefinedSchemaField(state, name, field);
    applyDefinedFieldPolicy(state.fieldPolicies, name, definition);
    return;
  }
  if (definition.kind === "accessor") {
    addDefinedAccessorMethods(state, name, definition);
    applyDefinedFieldPolicy(state.fieldPolicies, name, definition);
    return;
  }
  throw new JITError("CLASS_FIELD_DESCRIPTOR_CONFLICT", `Class member ${JSON.stringify(name)} is invalid`);
}

function addDefinedMethod(state: MutableDefinedExtensionState, name: string, descriptor: PropertyDescriptor): void {
  if (descriptor.get === undefined && descriptor.set === undefined && typeof descriptor.value !== "function") {
    throw new JITError("INVALID_OPERATION", `Class extension ${JSON.stringify(name)} must be a method or getter`);
  }
  const kind = descriptor.get === undefined ? (descriptor.set === undefined ? "method" : "set") : "get";
  state.methods.push({ name, kind, source: (descriptor.get ?? descriptor.set ?? descriptor.value) as Function });
  addMember(
    state.members,
    name,
    "extension",
    "custom extension",
    kind === "get" ? "getter" : kind === "set" ? "setter" : "method"
  );
}

function addDefinedAccessorMethods(
  state: MutableDefinedExtensionState,
  name: string,
  definition: Extract<ClassMemberDefinition, { readonly kind: "accessor" }>
): void {
  const implementation = definition.getter ?? definition.setter;
  if (typeof implementation === "function") {
    state.methods.push({ name, kind: definition.getter !== undefined ? "get" : "set", source: implementation });
  }
  addMember(
    state.members,
    name,
    "extension",
    "custom extension",
    definition.getter !== undefined ? "getter" : "setter"
  );
}

function replaceDefinedAccessorMethods(
  methods: DefinedClassMethod[],
  name: string,
  definition: Extract<ClassMemberDefinition, { readonly kind: "accessor" }>
): void {
  const implementation = definition.getter ?? definition.setter;
  if (typeof implementation !== "function") return;
  const kind = definition.getter !== undefined ? "get" : "set";
  const replacement = { name, kind, source: implementation } as const;
  const index = methods.findIndex((method) => method.name === name && method.kind === kind);
  if (index === -1) methods.push(replacement);
  else methods[index] = replacement;
}

function addDefinedSchemaField(state: MutableDefinedExtensionState, name: string, field: ATS.AnyTypeSchema): void {
  state.schema = updateDefinedSchema(state.schema, name, field);
  state.members.add({ name, kind: "field", source: "extension", owner: "custom extension", schema: field });
}

function replaceDefinedSchemaField(
  state: MutableDefinedExtensionState,
  name: string,
  field: ATS.AnyTypeSchema,
  existing: ResolvedClassMember
): void {
  if (existing.kind !== "field") throwDefinedFieldConflict(name);
  state.schema = updateDefinedSchema(state.schema, name, field);
  state.schema = applyManagedFieldsForDefine(state.schema, state.base.managedFields);
  const object = resolveWrappers(state.schema).base;
  const effectiveField = object.type === TypeName.object ? (object as ATS.ObjectSchema).def.props[name] : field;
  state.members.replace(name, { ...existing, source: "override", schema: effectiveField });
}

function updateDefinedSchema(schema: ATS.AnyTypeSchema, name: string, field: ATS.AnyTypeSchema): ATS.AnyTypeSchema {
  const object = resolveWrappers(schema).base;
  if (object.type !== TypeName.object) throw new JITError("INVALID_OPERATION", "Class schema must be an object");
  return createSchema(
    TypeName.object,
    {
      props: { ...(object as ATS.ObjectSchema).def.props, [name]: field },
      unknownKeys: (object as ATS.ObjectSchema).def.unknownKeys,
      catchall: (object as ATS.ObjectSchema).def.catchall,
      checks: (object as ATS.ObjectSchema).def.checks,
    },
    object.annotations
  );
}

function applyManagedFieldsForDefine(
  schema: ATS.AnyTypeSchema,
  managedFields: readonly import("./classes/effective-schema.js").ManagedFieldDescriptor[]
): ATS.AnyTypeSchema {
  if (managedFields.length === 0) return schema;
  try {
    return reapplyManagedFields(schema, managedFields);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new JITError("DDD_CAPABILITY_SCHEMA_CONFLICT", message);
  }
}

function applyDefinedFieldPolicy(
  policies: DefinedClassFieldPolicy[],
  name: string,
  definition: {
    readonly kind: "field" | "accessor";
    readonly visibility?: "public" | "protected" | "private";
    readonly getter?: true | Function;
    readonly setter?: true | Function;
    readonly noConstructor?: true;
  }
): void {
  const previous = policies.find((policy) => policy.name === name);
  const visibility = definition.visibility ?? previous?.visibility ?? "public";
  const defaults = definedFieldAccessorDefaults(definition, previous);
  const next: DefinedClassFieldPolicy = {
    name,
    visibility,
    getter: defaults.getter,
    setter: defaults.setter,
    noConstructor: definition.noConstructor === true || previous?.noConstructor === true,
  };
  const index = policies.findIndex((policy) => policy.name === name);
  if (index === -1) policies.push(next);
  else policies[index] = next;
}

function definedFieldAccessorDefaults(
  definition: {
    readonly kind: "field" | "accessor";
    readonly visibility?: "public" | "protected" | "private";
    readonly getter?: true | Function;
    readonly setter?: true | Function;
    readonly noConstructor?: true;
  },
  previous: DefinedClassFieldPolicy | undefined
): Pick<DefinedClassFieldPolicy, "getter" | "setter"> {
  const hasAccessorIntent = definition.getter !== undefined || definition.setter !== undefined;
  const defaultField =
    definition.kind === "field" &&
    (definition.visibility === "public" || definition.noConstructor === true) &&
    !hasAccessorIntent;
  const getter = definition.getter !== undefined ? true : (previous?.getter ?? defaultField);
  const setter = definition.setter !== undefined ? true : (previous?.setter ?? defaultField);
  return {
    getter: getter === true || typeof getter === "function",
    setter: setter === true || typeof setter === "function",
  };
}

function throwDefinedFieldConflict(name: string): never {
  throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is a schema field`);
}

function replaceMethod(methods: DefinedClassMethod[], name: string, replacement: DefinedClassMethod): void {
  const index = methods.findIndex((method) => method.name === name);
  if (index === -1) methods.push(replacement);
  else methods[index] = replacement;
}
