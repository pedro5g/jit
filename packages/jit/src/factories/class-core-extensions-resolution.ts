import {
  addMember,
  applyDddCapability,
  type CapabilityOptions,
  type DddCapabilityKind,
  validateManagedFields,
} from "../classes/effective-schema.js";
import type { ResolvedMemberTable } from "../classes/members.js";
import { JITError } from "../errors/index.js";
import {
  applyObjectExtension,
  resolvePendingIdentity,
  validateMixinRequirements,
} from "./class-core-extension-members.js";
import type { ClassDefinitionState } from "./class-core-state.js";
import {
  createClassExtensionBuilder,
  isClassCapability,
  isClassExtensionFactory,
  isClassMixin,
} from "./class-extensions.js";
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
    next = isClassCapability(extension)
      ? applyCapabilityExtension(next, extension)
      : applyObjectExtension(next, extension as ClassMethodsInput);
  }
  next = resolvePendingIdentity(next);
  validateManagedFields(next.schema, next.managedFields);
  return next;
}

function applyCapabilityExtension(state: ClassDefinitionState, extension: AnyClassCapability): ClassDefinitionState {
  if (state.capabilities.some((capability) => capability.kind === extension.kind)) {
    throw new JITError("INVALID_OPERATION", `Class capability ${JSON.stringify(extension.kind)} is already installed`);
  }
  for (const name of capabilityMemberNames(extension)) assertNewMember(state.members, name, extension.kind);
  if (isDddCapability(extension)) return applyDddCapabilityExtension(state, extension);
  const members = state.members.clone();
  for (const name of capabilityMemberNames(extension)) addMember(members, name, "capability", extension.kind, "method");
  return { ...state, members, capabilities: [...state.capabilities, extension] };
}

function isDddCapability(
  extension: AnyClassCapability
): extension is AnyClassCapability & { readonly kind: DddCapabilityKind } {
  return (
    extension.kind === "ddd.timestamps" || extension.kind === "ddd.softDelete" || extension.kind === "ddd.versioned"
  );
}

function applyDddCapabilityExtension(
  state: ClassDefinitionState,
  extension: AnyClassCapability & { readonly kind: DddCapabilityKind }
): ClassDefinitionState {
  try {
    const resolved = applyDddCapability(
      {
        schema: state.schema,
        lifecycle: state.lifecycle,
        managedFields: state.managedFields,
        members: state.members,
      },
      extension.kind,
      capabilityOptions(extension)
    );
    return {
      ...state,
      schema: resolved.schema,
      lifecycle: resolved.lifecycle,
      managedFields: resolved.managedFields,
      members: resolved.members,
      capabilities: [...state.capabilities, extension],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new JITError("DDD_CAPABILITY_SCHEMA_CONFLICT", `${extension.kind} declaration conflict: ${message}`);
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
  if (existing === undefined) return;
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
