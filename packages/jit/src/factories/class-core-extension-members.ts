import {
  addMember,
  type ManagedFieldDescriptor,
  reapplyManagedFields,
  resolveEffectiveObjectSchema,
  validateManagedFields,
} from "../classes/effective-schema.js";
import { type ClassMemberDefinition, isClassMemberDescriptor } from "../classes/member-descriptors.js";
import type { ResolvedMemberTable } from "../classes/members.js";
import { isOverrideDescriptor, type OverrideDescriptor } from "../classes/override.js";
import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import { hasSchemaDefault } from "../compiler/schema-default.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { isIdentifierSchema } from "./class-core-schema.js";
import type { ClassDefinitionState, ClassMethodDefinition } from "./class-core-state.js";
import { isClassExtensionFieldBuilder, RESERVED_EXTENSION_NAMES } from "./class-extensions.js";
import type { ClassFieldPolicy } from "./class-layout.js";
import type { ClassMethodsInput } from "./class-types.js";

interface MutableExtensionState {
  readonly base: ClassDefinitionState;
  schema: ATS.AnyTypeSchema;
  readonly methods: ClassMethodDefinition[];
  readonly members: ResolvedMemberTable;
  readonly fieldPolicies: Map<string, ClassFieldPolicy>;
}

export function applyObjectExtension(
  current: ClassDefinitionState,
  extension: ClassMethodsInput
): ClassDefinitionState {
  const state: MutableExtensionState = {
    base: current,
    schema: current.schema,
    methods: [...current.methods],
    members: current.members.clone(),
    fieldPolicies: new Map(current.fieldPolicies),
  };
  for (const name of Object.getOwnPropertyNames(extension)) {
    const descriptor = Object.getOwnPropertyDescriptor(extension, name);
    if (descriptor === undefined) continue;
    const value = isClassExtensionFieldBuilder(descriptor.value)
      ? descriptor.value.toDescriptor(name)
      : descriptor.value;
    applyExtensionMember(state, name, descriptor, value);
  }
  validateManagedFields(state.schema, current.managedFields);
  return {
    ...current,
    schema: state.schema,
    methods: state.methods,
    members: state.members,
    fieldPolicies: state.fieldPolicies,
  };
}

function applyExtensionMember(
  state: MutableExtensionState,
  name: string,
  descriptor: PropertyDescriptor,
  value: unknown
): void {
  if (isOverrideDescriptor(value)) {
    applyOverrideMember(state, name, value);
    return;
  }
  if (state.members.has(name) || RESERVED_EXTENSION_NAMES.has(name)) {
    throw new JITError(
      "CLASS_MEMBER_ALREADY_EXISTS",
      `Class member ${JSON.stringify(name)} would shadow an existing member. Use ${JSON.stringify(`${name}: JIT.class.override(...)`)} to replace it explicitly.`
    );
  }
  if (isClassMemberDescriptor(value)) {
    applyNewContractMember(state, name, value.definition);
    return;
  }
  if (isSchemaInputValue(value)) {
    addExtensionSchemaField(state, name, unwrapSchema(value));
    return;
  }
  const method = methodDefinitionFromDescriptor(name, descriptor);
  state.methods.push(method);
  addMember(
    state.members,
    name,
    "extension",
    "custom extension",
    method.kind === "get" ? "getter" : method.kind === "set" ? "setter" : "method"
  );
}

function applyOverrideMember(state: MutableExtensionState, name: string, value: OverrideDescriptor): void {
  const existing = state.members.get(name);
  if (existing === undefined) {
    throw new JITError(
      "CLASS_OVERRIDE_TARGET_NOT_FOUND",
      `Class member ${JSON.stringify(name)} does not exist. JIT.class.override() can only replace an existing member.`
    );
  }
  if (isClassMemberDescriptor(value.value)) {
    applyContractOverride(state, name, existing, value.value.definition);
    return;
  }
  if (isSchemaInputValue(value.value)) {
    if (existing.kind !== "field") {
      throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is not a schema field`);
    }
    replaceExtensionSchemaField(state, name, unwrapSchema(value.value as SchemaInput<ATS.AnyTypeSchema>), existing);
    return;
  }
  if (existing.kind === "field") {
    throw new JITError(
      "CLASS_MEMBER_ALREADY_EXISTS",
      `Member ${JSON.stringify(name)} is a schema field; use a schema value with JIT.class.override(...)`
    );
  }
  const replacement = methodDefinitionFromValue(name, value.value);
  replaceMethod(state.methods, name, replacement);
  state.members.replace(name, { ...existing, source: "override", descriptor: { value: replacement.source } });
}

function applyContractOverride(
  state: MutableExtensionState,
  name: string,
  existing: NonNullable<ReturnType<ResolvedMemberTable["get"]>>,
  definition: ClassMemberDefinition
): void {
  if (definition.kind === "method") {
    if (existing.kind === "field") {
      throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is a schema field`);
    }
    replaceMethod(state.methods, name, methodDefinitionFromContract(name, definition));
    state.members.replace(name, { ...existing, source: "override", descriptor: { value: definition.implementation } });
    return;
  }
  if (definition.kind === "factory") {
    throw new JITError("CLASS_FACTORY_CONFLICT", "Factory descriptors cannot override instance members");
  }
  if (existing.kind !== "field") {
    throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is not a schema field`);
  }
  if (definition.kind === "field" && definition.schema !== undefined) {
    replaceExtensionSchemaField(state, name, unwrapSchema(definition.schema), existing);
  }
  applyFieldPolicy(state.fieldPolicies, name, definition);
}

function replaceExtensionSchemaField(
  state: MutableExtensionState,
  name: string,
  replacement: ATS.AnyTypeSchema,
  existing: NonNullable<ReturnType<ResolvedMemberTable["get"]>>
): void {
  state.schema = reapplyManagedAfterOverride(
    replaceSchemaField(state.schema, name, replacement),
    state.base.managedFields
  );
  state.members.replace(name, {
    ...existing,
    source: "override",
    schema: resolveEffectiveObjectSchema(state.schema).def.props[name],
  });
}

function addExtensionSchemaField(state: MutableExtensionState, name: string, field: ATS.AnyTypeSchema): void {
  state.schema = addSchemaField(state.schema, name, field);
  state.members.add({ name, kind: "field", source: "extension", owner: "custom extension", schema: field });
}

function applyNewContractMember(state: MutableExtensionState, name: string, definition: ClassMemberDefinition): void {
  if (definition.kind === "method") {
    if (definition.implementation === undefined) {
      throw new JITError("INVALID_OPERATION", `Class method ${JSON.stringify(name)} must be implemented`);
    }
    state.methods.push(methodDefinitionFromContract(name, definition));
    addMember(state.members, name, "extension", "custom extension", "method");
    return;
  }
  if (definition.kind === "factory") {
    throw new JITError("INVALID_OPERATION", "Factory descriptors belong in .factories(), not an instance extension");
  }
  const fieldSchema = definition.schema;
  if (fieldSchema !== undefined) {
    const field = unwrapSchema(fieldSchema);
    if (definition.kind === "field" && definition.noConstructor && !hasSchemaDefault(field)) {
      throw new JITError(
        "CLASS_FIELD_DESCRIPTOR_CONFLICT",
        `No-constructor field ${JSON.stringify(name)} requires a default initializer`
      );
    }
    addExtensionSchemaField(state, name, field);
  } else if (definition.kind === "accessor") {
    addCustomAccessor(state, name, definition);
  } else {
    throw new JITError(
      "CLASS_FIELD_DESCRIPTOR_CONFLICT",
      `Class member ${JSON.stringify(name)} needs a schema or a custom getter/setter`
    );
  }
  applyFieldPolicy(state.fieldPolicies, name, definition);
}

function addCustomAccessor(
  state: MutableExtensionState,
  name: string,
  definition: Extract<ClassMemberDefinition, { readonly kind: "accessor" }>
): void {
  const hasCustomAccessor = typeof definition.getter === "function" || typeof definition.setter === "function";
  if (!hasCustomAccessor) {
    throw new JITError(
      "CLASS_FIELD_DESCRIPTOR_CONFLICT",
      `Class member ${JSON.stringify(name)} needs a schema or a custom getter/setter`
    );
  }
  const methodDefinitions = descriptorMethods(name, definition);
  state.methods.push(...methodDefinitions);
  addMember(
    state.members,
    name,
    "extension",
    "custom extension",
    methodDefinitions[0]?.kind === "get" ? "getter" : "setter"
  );
}

export function resolvePendingIdentity(state: ClassDefinitionState): ClassDefinitionState {
  if (state.identity.state !== "pending") return state;
  const object = resolveEffectiveObjectSchema(state.schema);
  const candidates = Object.keys(object.def.props).filter((key) => isIdentifierSchema(object.def.props[key]));
  if (candidates.length === 1) {
    return { ...state, identity: { state: "resolved", key: candidates[0], explicit: false } };
  }
  if (candidates.length > 1)
    return { ...state, identity: { state: "ambiguous", candidates: Object.freeze(candidates) } };
  return state;
}

export function validateMixinRequirements(
  schema: ATS.AnyTypeSchema,
  requirements: ClassMethodsInput | undefined
): void {
  if (requirements === undefined) return;
  const object = resolveEffectiveObjectSchema(schema);
  for (const name of Object.getOwnPropertyNames(requirements)) {
    const required = requirements[name];
    const actual = object.def.props[name];
    if (actual === undefined) {
      throw new JITError(
        "CLASS_FIELD_DESCRIPTOR_CONFLICT",
        `Class mixin requires the host field ${JSON.stringify(name)}`
      );
    }
    if (!isSchemaInputValue(required)) {
      throw new JITError(
        "CLASS_FIELD_DESCRIPTOR_CONFLICT",
        `Mixin requirement ${JSON.stringify(name)} must be a schema`
      );
    }
    const expectedBase = resolveWrappers(unwrapSchema(required)).base;
    const actualBase = resolveWrappers(actual).base;
    if (expectedBase.type !== actualBase.type) {
      throw new JITError(
        "CLASS_FIELD_DESCRIPTOR_CONFLICT",
        `Class mixin requirement ${JSON.stringify(name)} is incompatible with the host field`
      );
    }
  }
}

function isSchemaInputValue(value: unknown): value is SchemaInput<ATS.AnyTypeSchema> {
  return (
    ((typeof value === "object" || typeof value === "function") &&
      value !== null &&
      "schema" in value &&
      typeof value.schema === "object") ||
    (typeof value === "object" && value !== null && "type" in value && "def" in value)
  );
}

function replaceSchemaField(
  schema: ATS.AnyTypeSchema,
  name: string,
  replacement: ATS.AnyTypeSchema
): ATS.AnyTypeSchema {
  const object = resolveEffectiveObjectSchema(schema);
  return createSchema(
    TypeName.object,
    {
      props: { ...object.def.props, [name]: replacement },
      unknownKeys: object.def.unknownKeys,
      catchall: object.def.catchall,
      checks: object.def.checks,
    },
    object.annotations
  );
}

function addSchemaField(schema: ATS.AnyTypeSchema, name: string, field: ATS.AnyTypeSchema): ATS.AnyTypeSchema {
  const object = resolveEffectiveObjectSchema(schema);
  return createSchema(
    TypeName.object,
    {
      props: { ...object.def.props, [name]: field },
      unknownKeys: object.def.unknownKeys,
      catchall: object.def.catchall,
      checks: object.def.checks,
    },
    object.annotations
  );
}

function reapplyManagedAfterOverride(
  schema: ATS.AnyTypeSchema,
  managedFields: readonly ManagedFieldDescriptor[]
): ATS.AnyTypeSchema {
  try {
    return reapplyManagedFields(schema, managedFields);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new JITError("DDD_CAPABILITY_SCHEMA_CONFLICT", message);
  }
}

function methodDefinitionFromDescriptor(name: string, descriptor: PropertyDescriptor): ClassMethodDefinition {
  if (descriptor.get !== undefined || descriptor.set !== undefined) {
    return {
      name,
      kind: descriptor.get === undefined ? "set" : "get",
      source: (descriptor.get ?? descriptor.set) as Function,
    };
  }
  if (typeof descriptor.value !== "function") {
    throw new JITError(
      "INVALID_OPERATION",
      `Class extension ${JSON.stringify(name)} must be a method, a getter or a setter`
    );
  }
  return { name, kind: "method", source: descriptor.value };
}

function methodDefinitionFromContract(
  name: string,
  definition: Extract<ClassMemberDefinition, { readonly kind: "method" }>
): ClassMethodDefinition {
  if (definition.implementation === undefined) {
    throw new JITError("INVALID_OPERATION", `Class method ${JSON.stringify(name)} must be implemented`);
  }
  return {
    name,
    kind: "method",
    source: definition.implementation,
    schema: definition.schema as ATS.FunctionSchema,
    ...(definition.async === undefined ? {} : { async: definition.async }),
  };
}

function descriptorMethods(
  name: string,
  definition: Extract<ClassMemberDefinition, { readonly kind: "accessor" | "field" }>
): readonly ClassMethodDefinition[] {
  const methods: ClassMethodDefinition[] = [];
  if (typeof definition.getter === "function") methods.push({ name, kind: "get", source: definition.getter });
  if (typeof definition.setter === "function") methods.push({ name, kind: "set", source: definition.setter });
  return methods;
}

function applyFieldPolicy(
  policies: Map<string, ClassFieldPolicy>,
  name: string,
  definition: Extract<ClassMemberDefinition, { readonly kind: "accessor" | "field" }>
): void {
  const previous = policies.get(name);
  const visibility = definition.visibility ?? previous?.visibility ?? "public";
  const accessors = fieldAccessorDefaults(definition, previous);
  assertFieldPolicyCompatible(name, definition, previous);
  policies.set(name, {
    visibility,
    getter: accessors.getter,
    setter: accessors.setter,
    noConstructor:
      definition.kind === "field" && definition.noConstructor === true ? true : (previous?.noConstructor ?? false),
  });
}

function fieldAccessorDefaults(
  definition: Extract<ClassMemberDefinition, { readonly kind: "accessor" | "field" }>,
  previous: ClassFieldPolicy | undefined
): Pick<ClassFieldPolicy, "getter" | "setter"> {
  const defaults = defaultFieldAccessors(definition);
  const getter = definition.getter ?? previous?.getter ?? defaults.getter;
  const setter = definition.setter ?? previous?.setter ?? defaults.setter;
  return { getter, setter };
}

function defaultFieldAccessors(
  definition: Extract<ClassMemberDefinition, { readonly kind: "accessor" | "field" }>
): Pick<ClassFieldPolicy, "getter" | "setter"> {
  if (definition.kind !== "field") return { getter: false, setter: false };
  if (definition.getter !== undefined || definition.setter !== undefined) {
    return { getter: definition.visibility === "public", setter: false };
  }
  const visible = definition.visibility !== undefined || definition.noConstructor === true;
  return { getter: visible, setter: visible };
}

function assertFieldPolicyCompatible(
  name: string,
  definition: Extract<ClassMemberDefinition, { readonly kind: "accessor" | "field" }>,
  previous: ClassFieldPolicy | undefined
): void {
  if (previous === undefined) return;
  if (definition.getter !== undefined && previous.getter !== false) {
    throw new JITError("CLASS_ACCESSOR_CONFLICT", `Field ${JSON.stringify(name)} declares more than one getter`);
  }
  if (definition.setter !== undefined && previous.setter !== false) {
    throw new JITError("CLASS_ACCESSOR_CONFLICT", `Field ${JSON.stringify(name)} declares more than one setter`);
  }
  if (definition.visibility !== undefined && previous.visibility !== definition.visibility) {
    throw new JITError("CLASS_FIELD_DESCRIPTOR_CONFLICT", `Field ${JSON.stringify(name)} has conflicting visibility`);
  }
}

function methodDefinitionFromValue(name: string, value: unknown): ClassMethodDefinition {
  if (typeof value !== "function") {
    throw new JITError(
      "INVALID_OPERATION",
      `Override ${JSON.stringify(name)} must provide a method function or schema`
    );
  }
  return { name, kind: "method", source: value };
}

function replaceMethod(methods: ClassMethodDefinition[], name: string, replacement: ClassMethodDefinition): void {
  const index = methods.findIndex((method) => method.name === name);
  if (index === -1) methods.push(replacement);
  else methods[index] = replacement;
}
