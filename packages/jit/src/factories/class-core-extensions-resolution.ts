import {
  addMember,
  applyDddCapability,
  type CapabilityOptions,
  type ManagedFieldDescriptor,
  reapplyManagedFields,
  resolveEffectiveObjectSchema,
  validateManagedFields,
} from "../classes/effective-schema.js";
import { type ClassMemberDefinition, isClassMemberDescriptor } from "../classes/member-descriptors.js";
import type { ResolvedMemberTable } from "../classes/members.js";
import { isOverrideDescriptor } from "../classes/override.js";
import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { isIdentifierSchema } from "./class-core-schema.js";
import type { ClassDefinitionState, ClassMethodDefinition } from "./class-core-state.js";
import {
  createClassExtensionBuilder,
  isClassCapability,
  isClassExtensionFactory,
  isClassExtensionFieldBuilder,
  isClassMixin,
  RESERVED_EXTENSION_NAMES,
} from "./class-extensions.js";
import type { ClassFieldPolicy } from "./class-layout.js";
import type { AnyClassCapability, AnyClassExtension, ClassMethodsInput } from "./class-types.js";

export function resolveClassExtensions(
  current: ClassDefinitionState,
  extensions: readonly AnyClassExtension[]
): ClassDefinitionState {
  let next: ClassDefinitionState = {
    ...current,
    capabilities: [...current.capabilities],
    methods: [...current.methods],
    managedFields: [...current.managedFields],
    members: current.members.clone(),
    fieldPolicies: new Map(current.fieldPolicies),
  };

  for (const rawExtension of extensions) {
    const mixin = isClassMixin(rawExtension) ? rawExtension : undefined;
    const factory = isClassExtensionFactory(rawExtension) ? rawExtension : undefined;
    if (mixin !== undefined) validateMixinRequirements(next.schema, mixin.__requires);
    const extension =
      factory !== undefined ? factory(createClassExtensionBuilder()) : mixin === undefined ? rawExtension : mixin();
    if (isClassCapability(extension)) {
      if (next.capabilities.some((capability) => capability.kind === extension.kind)) {
        throw new JITError(
          "INVALID_OPERATION",
          `Class capability ${JSON.stringify(extension.kind)} is already installed`
        );
      }
      for (const name of capabilityMemberNames(extension)) assertNewMember(next.members, name, extension.kind);
      if (
        extension.kind === "ddd.timestamps" ||
        extension.kind === "ddd.softDelete" ||
        extension.kind === "ddd.versioned"
      ) {
        try {
          const resolved = applyDddCapability(
            {
              schema: next.schema,
              lifecycle: next.lifecycle,
              managedFields: next.managedFields,
              members: next.members,
            },
            extension.kind,
            capabilityOptions(extension)
          );
          next = {
            ...next,
            schema: resolved.schema,
            lifecycle: resolved.lifecycle,
            managedFields: resolved.managedFields,
            members: resolved.members,
            capabilities: [...next.capabilities, extension],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new JITError("DDD_CAPABILITY_SCHEMA_CONFLICT", `${extension.kind} declaration conflict: ${message}`);
        }
      } else {
        const names = capabilityMemberNames(extension);
        for (const name of names) assertNewMember(next.members, name, extension.kind);
        const members = next.members.clone();
        for (const name of names) addMember(members, name, "capability", extension.kind, "method");
        next = {
          ...next,
          members,
          capabilities: [...next.capabilities, extension],
        };
      }
      continue;
    }

    const members = next.members.clone();
    const methods = [...next.methods];
    const fieldPolicies = new Map(next.fieldPolicies);
    let schema = next.schema;
    for (const name of Object.getOwnPropertyNames(extension)) {
      const descriptor = Object.getOwnPropertyDescriptor(extension, name);
      if (descriptor === undefined) continue;
      const value = isClassExtensionFieldBuilder(descriptor.value)
        ? descriptor.value.toDescriptor(name)
        : descriptor.value;
      if (isOverrideDescriptor(value)) {
        const existing = members.get(name);
        if (existing === undefined) {
          throw new JITError(
            "CLASS_OVERRIDE_TARGET_NOT_FOUND",
            `Class member ${JSON.stringify(name)} does not exist. JIT.class.override() can only replace an existing member.`
          );
        }
        if (isClassMemberDescriptor(value.value)) {
          const definition = value.value.definition;
          if (definition.kind === "method") {
            if (existing.kind === "field") {
              throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is a schema field`);
            }
            replaceMethod(methods, name, methodDefinitionFromContract(name, definition));
            members.replace(name, {
              ...existing,
              source: "override",
              descriptor: { value: definition.implementation },
            });
          } else {
            if (definition.kind === "factory") {
              throw new JITError("CLASS_FACTORY_CONFLICT", "Factory descriptors cannot override instance members");
            }
            if (existing.kind !== "field") {
              throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is not a schema field`);
            }
            if (definition.kind === "field" && definition.schema !== undefined) {
              schema = replaceSchemaField(schema, name, unwrapSchema(definition.schema));
              schema = reapplyManagedAfterOverride(schema, next.managedFields);
              members.replace(name, {
                ...existing,
                source: "override",
                schema: resolveEffectiveObjectSchema(schema).def.props[name],
              });
            }
            applyFieldPolicy(fieldPolicies, name, definition);
          }
          continue;
        }
        if (isSchemaInputValue(value.value)) {
          if (existing.kind !== "field") {
            throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is not a schema field`);
          }
          schema = replaceSchemaField(schema, name, unwrapSchema(value.value as SchemaInput<ATS.AnyTypeSchema>));
          schema = reapplyManagedAfterOverride(schema, next.managedFields);
          const effectiveField = resolveEffectiveObjectSchema(schema).def.props[name];
          members.replace(name, {
            ...existing,
            source: "override",
            schema: effectiveField,
          });
        } else {
          if (existing.kind === "field") {
            throw new JITError(
              "CLASS_MEMBER_ALREADY_EXISTS",
              `Member ${JSON.stringify(name)} is a schema field; use a schema value with JIT.class.override(...)`
            );
          }
          const replacement = methodDefinitionFromValue(name, value.value);
          replaceMethod(methods, name, replacement);
          members.replace(name, { ...existing, source: "override", descriptor: { value: replacement.source } });
        }
        continue;
      }

      if (members.has(name) || RESERVED_EXTENSION_NAMES.has(name)) {
        throw new JITError(
          "CLASS_MEMBER_ALREADY_EXISTS",
          `Class member ${JSON.stringify(name)} would shadow an existing member. Use ${JSON.stringify(`${name}: JIT.class.override(...)`)} to replace it explicitly.`
        );
      }
      if (isClassMemberDescriptor(value)) {
        const definition = value.definition;
        if (definition.kind === "method") {
          if (definition.implementation === undefined) {
            throw new JITError("INVALID_OPERATION", `Class method ${JSON.stringify(name)} must be implemented`);
          }
          const method = methodDefinitionFromContract(name, definition);
          methods.push(method);
          addMember(members, name, "extension", "custom extension", "method");
          continue;
        }
        if (definition.kind === "factory") {
          throw new JITError(
            "INVALID_OPERATION",
            "Factory descriptors belong in .factories(), not an instance extension"
          );
        }
        const fieldSchema = definition.schema;
        if (fieldSchema !== undefined) {
          const field = unwrapSchema(fieldSchema);
          if (definition.kind === "field" && definition.noConstructor && !hasDefault(field)) {
            throw new JITError(
              "CLASS_FIELD_DESCRIPTOR_CONFLICT",
              `No-constructor field ${JSON.stringify(name)} requires a default initializer`
            );
          }
          schema = addSchemaField(schema, name, field);
          members.add({ name, kind: "field", source: "extension", owner: "custom extension", schema: field });
        } else {
          const hasCustomAccessor =
            definition.kind === "accessor" &&
            (typeof definition.getter === "function" || typeof definition.setter === "function");
          if (!hasCustomAccessor) {
            throw new JITError(
              "CLASS_FIELD_DESCRIPTOR_CONFLICT",
              `Class member ${JSON.stringify(name)} needs a schema or a custom getter/setter`
            );
          }
          const methodDefinitions = descriptorMethods(name, definition);
          methods.push(...methodDefinitions);
          addMember(
            members,
            name,
            "extension",
            "custom extension",
            methodDefinitions[0]?.kind === "get" ? "getter" : "setter"
          );
        }
        applyFieldPolicy(fieldPolicies, name, definition);
        continue;
      }
      if (isSchemaInputValue(value)) {
        const field = unwrapSchema(value);
        schema = addSchemaField(schema, name, field);
        members.add({ name, kind: "field", source: "extension", owner: "custom extension", schema: field });
        continue;
      }
      const method = methodDefinitionFromDescriptor(name, descriptor);
      methods.push(method);
      addMember(
        members,
        name,
        "extension",
        "custom extension",
        method.kind === "get" ? "getter" : method.kind === "set" ? "setter" : "method"
      );
    }
    validateManagedFields(schema, next.managedFields);
    next = { ...next, schema, methods, members, fieldPolicies };
  }
  if (next.identity.state === "pending") {
    const object = resolveEffectiveObjectSchema(next.schema);
    const candidates = Object.keys(object.def.props).filter((key) => isIdentifierSchema(object.def.props[key]));
    if (candidates.length === 1) {
      const key = candidates[0];
      next = {
        ...next,
        identity: { state: "resolved", key, explicit: false },
      };
    } else if (candidates.length > 1) {
      next = { ...next, identity: { state: "ambiguous", candidates: Object.freeze(candidates) } };
    }
  }
  validateManagedFields(next.schema, next.managedFields);
  return next;
}

function validateMixinRequirements(schema: ATS.AnyTypeSchema, requirements: ClassMethodsInput | undefined): void {
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

function capabilityOptions(capability: AnyClassCapability): CapabilityOptions | undefined {
  return (capability as AnyClassCapability & { readonly __options?: CapabilityOptions }).__options;
}

export function capabilityMemberNames(capability: AnyClassCapability): readonly string[] {
  return (capability as AnyClassCapability & { readonly __memberNames?: readonly string[] }).__memberNames ?? [];
}

function assertNewMember(members: ResolvedMemberTable, name: string, owner: string): void {
  const existing = members.get(name);
  if (existing !== undefined) {
    if (existing.kind === "field") {
      throw new JITError(
        "CLASS_MEMBER_ALREADY_EXISTS",
        `Member ${JSON.stringify(name)} is a schema field and cannot be installed by ${owner}`
      );
    }
    throw new JITError(
      "CLASS_MEMBER_ALREADY_EXISTS",
      `Member ${JSON.stringify(name)} already exists. Existing source conflicts with ${owner}; use JIT.class.override(...) explicitly.`
    );
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
  const props = { ...object.def.props, [name]: replacement };
  return createSchema(
    TypeName.object,
    {
      props,
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
  const hasAccessorIntent = definition.getter !== undefined || definition.setter !== undefined;
  const defaultPublicField =
    definition.kind === "field" &&
    (definition.visibility === "public" || definition.noConstructor === true) &&
    !hasAccessorIntent;
  const internalVisibilityField =
    definition.kind === "field" &&
    (definition.visibility === "protected" || definition.visibility === "private") &&
    !hasAccessorIntent;
  const explicitPublicField = definition.kind === "field" && definition.visibility === "public";
  const getter =
    definition.getter ?? previous?.getter ?? (defaultPublicField || internalVisibilityField || explicitPublicField);
  const setter = definition.setter ?? previous?.setter ?? (defaultPublicField || internalVisibilityField);
  if (previous !== undefined) {
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
  policies.set(name, {
    visibility,
    getter,
    setter,
    noConstructor:
      definition.kind === "field" && definition.noConstructor === true ? true : (previous?.noConstructor ?? false),
  });
}

function hasDefault(schema: ATS.AnyTypeSchema): boolean {
  let current = schema;
  while (true) {
    if (current.type === TypeName.default) return true;
    if (current.type === TypeName.lazy) {
      current = (current.def as ATS.LazyDef).getter();
      continue;
    }
    if (
      current.type === TypeName.readonly ||
      current.type === TypeName.optional ||
      current.type === TypeName.nullable ||
      current.type === TypeName.nullish ||
      current.type === TypeName.brand ||
      current.type === TypeName.refine ||
      current.type === TypeName.coerce ||
      current.type === TypeName.pipe ||
      current.type === TypeName.transform
    ) {
      current = (current.def as ATS.InnerTypeDef).innerType;
      continue;
    }
    return false;
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
