import {
  addMember,
  applyDddCapability,
  type CapabilityOptions,
  initialEffectiveSchema,
  type LifecycleDefinition,
  type ManagedFieldDescriptor,
  reapplyManagedFields,
} from "./classes/effective-schema.js";
import {
  classFactory as classFactoryDescriptor,
  classGetter,
  classMethod,
  classNoConstructor,
  classPrivate,
  classProtected,
  classPublic,
  classSetter,
  isClassMemberDescriptor,
} from "./classes/member-descriptors.js";
import { ResolvedMemberTable } from "./classes/members.js";
import { isOverrideDescriptor, override } from "./classes/override.js";
import { type AssertionDescriptor, emitAssertionSource, resolveAssertionDescriptor } from "./compiler/assertion.js";
import { resolveWrappers } from "./compiler/resolvers/resolve-wrappers.js";
import { schemaChildren } from "./compiler/schema-recursion.js";
import type { QueryConditionNode } from "./core/ast/index.js";
import type * as ATS from "./core/ats/index.js";
import { createSchema, TypeName } from "./core/ats/index.js";
import { type SchemaInput, unwrapSchema } from "./core/builder/index.js";
import {
  type FactoryPolicyCandidate,
  type FactoryReturnMode,
  type FactoryReturnModeInput,
  normalizeFactoryReturnMode,
  selectFactoryPolicyCandidate,
} from "./core/factory-policy.js";
import { JITError } from "./errors/index.js";
import type {
  AssertionOptions,
  ClassCapability,
  ClassFactory,
  ClassJsonCapability,
  ClassJsonOptions,
  ClassMethodsInput,
  ClassMixin,
  FactoryOptions,
  FactoryValidationOptions,
} from "./factories/class.js";
import { classMixin } from "./factories/class.js";
import { createConditionBuilder, type QueryConditionBuilder } from "./factories/query.js";
import { registerArtifact } from "./runtime/artifact-registry.js";

interface DefinedClassMethod {
  readonly name: string;
  readonly kind: "method" | "get" | "set";
  readonly source: Function;
}

interface DefinedClassAssertionFailure {
  readonly rule: string | undefined;
  readonly field: string | undefined;
  readonly code: string;
  readonly message: string;
  readonly priority: number;
  readonly error?: unknown;
}

interface DefinedClassFieldPolicy {
  readonly name: string;
  readonly visibility: "public" | "protected" | "private";
  readonly getter: boolean;
  readonly setter: boolean;
  readonly noConstructor: boolean;
}

interface DefinedClassAssertions {
  readonly descriptors: readonly AssertionDescriptor[];
  readonly source: string;
  readonly bindingNames: readonly string[];
  readonly bindingValues: readonly unknown[];
  readonly failures: readonly DefinedClassAssertionFailure[];
}

interface DefinedClassPolicy {
  readonly result: FactoryReturnMode;
  readonly create: boolean;
  readonly hydrate: boolean;
  readonly validationConfigured?: boolean;
  readonly resultModeExplicit?: boolean;
  readonly resultModeInherited?: boolean;
  readonly maxIssues?: number;
  readonly errorPriority?: number;
  readonly errorPriorityExplicit?: boolean;
  readonly error?: unknown;
  readonly assertions?: DefinedClassAssertions;
}

interface DefinedClassState {
  readonly declaredSchema: ATS.AnyTypeSchema;
  readonly schema: ATS.AnyTypeSchema;
  readonly representation: "object" | "value";
  readonly identifier: boolean;
  readonly abstract: boolean;
  readonly aggregate: boolean;
  readonly frozen: boolean;
  readonly construction: "constructor" | "factory";
  readonly factoryValidationOptIn: boolean;
  readonly factories: { readonly create: string | false; readonly hydrate: string | false };
  readonly capabilities: readonly string[];
  readonly methods: readonly DefinedClassMethod[];
  readonly lifecycle: LifecycleDefinition;
  readonly managedFields: readonly ManagedFieldDescriptor[];
  readonly members: ResolvedMemberTable;
  readonly fieldPolicies: readonly DefinedClassFieldPolicy[];
  readonly encapsulateFields: boolean;
  readonly accessors: readonly unknown[];
  readonly customFactories?: { readonly create?: Function; readonly hydrate?: Function };
  readonly validationConfigured: boolean;
  readonly policy: DefinedClassPolicy | undefined;
  readonly domainEvent?: { readonly type: string; readonly version: number };
}

const DEFINED_RESERVED_MEMBER_NAMES: ReadonlySet<string> = new Set([
  "constructor",
  "schema",
  "create",
  "hydrate",
  "extends",
  "factories",
  "construction",
  "accessors",
  "validate",
  "assert",
]);

type DefinedCapability = ClassCapability<object> &
  (() => DefinedCapability) & {
    readonly __memberNames?: readonly string[];
    readonly __options?: unknown;
  };

const DEFINE_EXECUTION_ERROR =
  "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead.";

function defineArtifactFailure(): never {
  throw new JITError("JIT_AOT_001_ARTIFACT_EXECUTED", DEFINE_EXECUTION_ERROR);
}

export function defineCapability(
  kind: string,
  memberNames: readonly string[] = [],
  options?: CapabilityOptions
): DefinedCapability {
  let capability: DefinedCapability;
  capability = (() => capability) as DefinedCapability;
  Object.defineProperties(capability, {
    kind: { enumerable: true, value: kind },
    __memberNames: { enumerable: false, value: Object.freeze([...memberNames]) },
    ...(options === undefined ? {} : { __options: { enumerable: false, value: options } }),
    install: { enumerable: false, value: () => undefined },
  });
  return Object.freeze(capability);
}

export function defineClassState(
  schema: ATS.AnyTypeSchema,
  abstract: boolean,
  aggregate: boolean,
  encapsulateFields = false
): DefinedClassState {
  const base = resolveWrappers(schema).base;
  const initial = base.type === TypeName.object ? initialEffectiveSchema(schema) : undefined;
  const members = initial?.members.clone() ?? new ResolvedMemberTable();
  const capabilities: string[] = [];
  if (aggregate) {
    for (const name of ["raise", "peekEvents", "pullEvents", "commit"])
      addMember(members, name, "preset", "ddd.aggregateRoot", "method");
  }
  return {
    declaredSchema: schema,
    schema,
    representation: "object",
    identifier: false,
    abstract,
    aggregate,
    frozen: false,
    construction: aggregate ? "factory" : "constructor",
    factoryValidationOptIn: false,
    factories: aggregate ? { create: "create", hydrate: "hydrate" } : { create: false, hydrate: false },
    capabilities,
    methods: [],
    lifecycle: initial?.lifecycle ?? {},
    managedFields: [],
    members,
    fieldPolicies: [],
    encapsulateFields,
    accessors: [],
    validationConfigured: false,
    policy: undefined,
  };
}

function definedCapabilityOptions(value: DefinedCapability): CapabilityOptions | undefined {
  return value.__options as CapabilityOptions | undefined;
}

function definedCapabilityMembers(value: DefinedCapability): readonly string[] {
  return value.__memberNames ?? [];
}

function isDefinedSchema(value: unknown): value is ATS.AnyTypeSchema {
  return typeof value === "object" && value !== null && "type" in value && "def" in value;
}

function isDefinedSchemaInput(value: unknown): value is SchemaInput<ATS.AnyTypeSchema> {
  return (
    isDefinedSchema(value) ||
    (typeof value === "object" && value !== null && "schema" in value && typeof value.schema === "object")
  );
}

function isDefinedClassMixin(value: unknown): value is ClassMixin {
  return typeof value === "function" && (value as { readonly __classMixin?: unknown }).__classMixin === true;
}

function resolveDefinedFactoryName(
  option: FactoryOptions["create"] | FactoryOptions["hydrate"] | undefined,
  fallback: string,
  phase: "create" | "hydrate"
): { readonly name: string | false; readonly implementation?: Function } {
  if (option === undefined) return { name: fallback };
  if (typeof option === "object") {
    if (!isClassMemberDescriptor(option) || option.definition.kind !== "factory") {
      throw new JITError("CLASS_FACTORY_CONFLICT", "Invalid class factory descriptor");
    }
    if (option.definition.phase !== phase) {
      throw new JITError(
        "CLASS_FACTORY_CONFLICT",
        `A ${option.definition.phase} factory descriptor cannot configure ${phase}`
      );
    }
    return { name: option.definition.name, implementation: option.definition.implementation };
  }
  return { name: option };
}

export function defineClassExtensions(
  state: DefinedClassState,
  extensions: readonly (DefinedCapability | ClassMethodsInput | ClassMixin)[]
): DefinedClassState {
  let next = state;
  for (const rawExtension of extensions) {
    const extension = isDefinedClassMixin(rawExtension) ? rawExtension() : rawExtension;
    if (
      (typeof extension === "object" || typeof extension === "function") &&
      extension !== null &&
      typeof (extension as { install?: unknown }).install === "function"
    ) {
      const capability = extension as DefinedCapability;
      if (next.capabilities.includes(capability.kind)) {
        throw new JITError(
          "INVALID_OPERATION",
          `Class capability ${JSON.stringify(capability.kind)} is already installed`
        );
      }
      for (const name of definedCapabilityMembers(capability)) {
        if (next.members.has(name)) {
          throw new JITError(
            "CLASS_MEMBER_ALREADY_EXISTS",
            `Member ${JSON.stringify(name)} already exists; use JIT.class.override(...) explicitly`
          );
        }
      }
      if (
        capability.kind === "ddd.timestamps" ||
        capability.kind === "ddd.softDelete" ||
        capability.kind === "ddd.versioned"
      ) {
        let resolved: ReturnType<typeof applyDddCapability>;
        try {
          resolved = applyDddCapability(
            {
              schema: next.schema,
              lifecycle: next.lifecycle,
              managedFields: next.managedFields,
              members: next.members,
            },
            capability.kind,
            definedCapabilityOptions(capability)
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new JITError("DDD_CAPABILITY_SCHEMA_CONFLICT", `${capability.kind} declaration conflict: ${message}`);
        }
        next = {
          ...next,
          schema: resolved.schema,
          lifecycle: resolved.lifecycle,
          managedFields: resolved.managedFields,
          members: resolved.members,
          capabilities: [...next.capabilities, capability.kind],
        };
      } else {
        const members = next.members.clone();
        for (const name of definedCapabilityMembers(capability))
          addMember(members, name, "capability", capability.kind, "method");
        next = { ...next, capabilities: [...next.capabilities, capability.kind], members };
      }
      continue;
    }

    const members = next.members.clone();
    const methods = [...next.methods];
    const fieldPolicies = [...next.fieldPolicies];
    let schema = next.schema;
    for (const name of Object.getOwnPropertyNames(extension)) {
      const descriptor = Object.getOwnPropertyDescriptor(extension, name);
      if (descriptor === undefined) continue;
      const value = descriptor.value;
      if (isOverrideDescriptor(value)) {
        const existing = members.get(name);
        if (existing === undefined) {
          throw new JITError(
            "CLASS_OVERRIDE_TARGET_NOT_FOUND",
            `Class member ${JSON.stringify(name)} does not exist. JIT.class.override() can only replace an existing member.`
          );
        }
        const member = isClassMemberDescriptor(value.value) ? value.value.definition : undefined;
        if (member?.kind === "factory") {
          throw new JITError("CLASS_FACTORY_CONFLICT", "Factory descriptors cannot override instance members");
        }
        if (member?.kind === "method") {
          if (existing.kind === "field") {
            throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is a schema field`);
          }
          if (member.implementation === undefined) {
            throw new JITError("INVALID_OPERATION", `Class method ${JSON.stringify(name)} must be implemented`);
          }
          const replacement = { name, kind: "method" as const, source: member.implementation };
          const index = methods.findIndex((method) => method.name === name);
          if (index === -1) methods.push(replacement);
          else methods[index] = replacement;
          members.replace(name, { ...existing, source: "override", descriptor: { value: member.implementation } });
        } else if (member?.kind === "accessor") {
          const implementation = member.getter ?? member.setter;
          if (typeof implementation === "function") {
            const kind = member.getter !== undefined ? "get" : "set";
            const replacement = { name, kind: kind as "get" | "set", source: implementation };
            const index = methods.findIndex((method) => method.name === name && method.kind === kind);
            if (index === -1) methods.push(replacement);
            else methods[index] = replacement;
          }
          applyDefinedFieldPolicy(fieldPolicies, name, member);
          members.replace(name, { ...existing, source: "override" });
        } else if (member?.kind === "field" && member.schema !== undefined) {
          if (existing.kind !== "field") {
            throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is not a schema field`);
          }
          const replacement = unwrapSchema(member.schema);
          const object = resolveWrappers(schema).base;
          if (object.type !== TypeName.object)
            throw new JITError("INVALID_OPERATION", "Class schema must be an object");
          const props = { ...(object as ATS.ObjectSchema).def.props, [name]: replacement };
          schema = createSchema(
            TypeName.object,
            {
              props,
              unknownKeys: (object as ATS.ObjectSchema).def.unknownKeys,
              catchall: (object as ATS.ObjectSchema).def.catchall,
              checks: (object as ATS.ObjectSchema).def.checks,
            },
            object.annotations
          );
          const rechecked = applyManagedFieldsForDefine(schema, next.managedFields);
          schema = rechecked;
          const effectiveObject = resolveWrappers(schema).base;
          const effectiveField =
            effectiveObject.type === TypeName.object
              ? (effectiveObject as ATS.ObjectSchema).def.props[name]
              : replacement;
          applyDefinedFieldPolicy(fieldPolicies, name, member);
          members.replace(name, { ...existing, source: "override", schema: effectiveField });
        } else if (isDefinedSchemaInput(value.value)) {
          if (existing.kind !== "field")
            throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is not a schema field`);
          const replacement = unwrapSchema(value.value as SchemaInput<ATS.AnyTypeSchema>);
          const object = resolveWrappers(schema).base;
          if (object.type !== TypeName.object)
            throw new JITError("INVALID_OPERATION", "Class schema must be an object");
          const props = { ...(object as ATS.ObjectSchema).def.props, [name]: replacement };
          schema = createSchema(
            TypeName.object,
            {
              props,
              unknownKeys: (object as ATS.ObjectSchema).def.unknownKeys,
              catchall: (object as ATS.ObjectSchema).def.catchall,
              checks: (object as ATS.ObjectSchema).def.checks,
            },
            object.annotations
          );
          const rechecked = applyManagedFieldsForDefine(schema, next.managedFields);
          schema = rechecked;
          const effectiveObject = resolveWrappers(schema).base;
          const effectiveField =
            effectiveObject.type === TypeName.object
              ? (effectiveObject as ATS.ObjectSchema).def.props[name]
              : replacement;
          members.replace(name, { ...existing, source: "override", schema: effectiveField });
        } else {
          if (existing.kind === "field")
            throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is a schema field`);
          if (typeof value.value !== "function")
            throw new JITError("INVALID_OPERATION", `Override ${JSON.stringify(name)} must provide a method`);
          const replacement = { name, kind: "method" as const, source: value.value };
          const index = methods.findIndex((method) => method.name === name);
          if (index === -1) methods.push(replacement);
          else methods[index] = replacement;
          members.replace(name, { ...existing, source: "override", descriptor: { value: value.value } });
        }
        continue;
      }
      if (members.has(name) || DEFINED_RESERVED_MEMBER_NAMES.has(name)) {
        throw new JITError(
          "CLASS_MEMBER_ALREADY_EXISTS",
          `Member ${JSON.stringify(name)} already exists. Use ${JSON.stringify(`${name}: JIT.class.override(...)`)} to replace it.`
        );
      }
      if (isClassMemberDescriptor(value)) {
        const definition = value.definition;
        if (definition.kind === "factory") {
          throw new JITError(
            "CLASS_FACTORY_CONFLICT",
            "Factory descriptors belong in .factories(), not an instance extension"
          );
        }
        if (definition.kind === "method") {
          if (definition.implementation === undefined) {
            throw new JITError("INVALID_OPERATION", `Class method ${JSON.stringify(name)} must be implemented`);
          }
          methods.push({ name, kind: "method", source: definition.implementation });
          addMember(members, name, "extension", "custom extension", "method");
          continue;
        }
        if (definition.kind === "field" && definition.schema !== undefined) {
          const field = unwrapSchema(definition.schema);
          if (definition.noConstructor === true && !definedHasDefault(field)) {
            throw new JITError(
              "CLASS_FIELD_DESCRIPTOR_CONFLICT",
              `No-constructor field ${JSON.stringify(name)} requires a default initializer`
            );
          }
          const object = resolveWrappers(schema).base;
          if (object.type !== TypeName.object)
            throw new JITError("INVALID_OPERATION", "Class schema must be an object");
          schema = createSchema(
            TypeName.object,
            {
              props: { ...(object as ATS.ObjectSchema).def.props, [name]: field },
              unknownKeys: (object as ATS.ObjectSchema).def.unknownKeys,
              catchall: (object as ATS.ObjectSchema).def.catchall,
              checks: (object as ATS.ObjectSchema).def.checks,
            },
            object.annotations
          );
          applyDefinedFieldPolicy(fieldPolicies, name, definition);
          members.add({ name, kind: "field", source: "extension", owner: "custom extension", schema: field });
          continue;
        }
        if (definition.kind === "accessor") {
          const implementation = definition.getter ?? definition.setter;
          if (typeof implementation === "function") {
            methods.push({
              name,
              kind: definition.getter !== undefined ? "get" : "set",
              source: implementation,
            });
          }
          addMember(
            members,
            name,
            "extension",
            "custom extension",
            definition.getter !== undefined ? "getter" : "setter"
          );
          applyDefinedFieldPolicy(fieldPolicies, name, definition);
          continue;
        }
        throw new JITError("CLASS_FIELD_DESCRIPTOR_CONFLICT", `Class member ${JSON.stringify(name)} is invalid`);
      }
      if (isDefinedSchemaInput(value)) {
        const field = unwrapSchema(value);
        const object = resolveWrappers(schema).base;
        if (object.type !== TypeName.object) throw new JITError("INVALID_OPERATION", "Class schema must be an object");
        schema = createSchema(
          TypeName.object,
          {
            props: { ...(object as ATS.ObjectSchema).def.props, [name]: field },
            unknownKeys: (object as ATS.ObjectSchema).def.unknownKeys,
            catchall: (object as ATS.ObjectSchema).def.catchall,
            checks: (object as ATS.ObjectSchema).def.checks,
          },
          object.annotations
        );
        members.add({ name, kind: "field", source: "extension", owner: "custom extension", schema: field });
        continue;
      }
      if (descriptor.get === undefined && descriptor.set === undefined && typeof value !== "function") {
        throw new JITError("INVALID_OPERATION", `Class extension ${JSON.stringify(name)} must be a method or getter`);
      }
      const kind = descriptor.get === undefined ? (descriptor.set === undefined ? "method" : "set") : "get";
      methods.push({ name, kind, source: (descriptor.get ?? descriptor.set ?? value) as Function });
      addMember(
        members,
        name,
        "extension",
        "custom extension",
        kind === "get" ? "getter" : kind === "set" ? "setter" : "method"
      );
    }
    next = { ...next, schema, methods, members, fieldPolicies };
  }
  return next;
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
  const hasAccessorIntent = definition.getter !== undefined || definition.setter !== undefined;
  const defaultField =
    definition.kind === "field" &&
    (definition.visibility === "public" || definition.noConstructor === true) &&
    !hasAccessorIntent;
  const getter =
    definition.getter !== undefined
      ? definition.getter === true || typeof definition.getter === "function"
      : (previous?.getter ?? defaultField);
  const setter =
    definition.setter !== undefined
      ? definition.setter === true || typeof definition.setter === "function"
      : (previous?.setter ?? defaultField);
  const next: DefinedClassFieldPolicy = {
    name,
    visibility,
    getter: getter === true || typeof getter === "function",
    setter: setter === true || typeof setter === "function",
    noConstructor: definition.noConstructor === true || previous?.noConstructor === true,
  };
  const index = policies.findIndex((policy) => policy.name === name);
  if (index === -1) policies.push(next);
  else policies[index] = next;
}

function definedHasDefault(schema: ATS.AnyTypeSchema): boolean {
  let current = schema;
  while (true) {
    if (current.type === TypeName.default) return true;
    if (current.type === TypeName.lazy) {
      current = (current.def as ATS.LazyDef).getter();
      continue;
    }
    if (
      current.type === TypeName.optional ||
      current.type === TypeName.nullable ||
      current.type === TypeName.nullish ||
      current.type === TypeName.brand ||
      current.type === TypeName.readonly ||
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

function applyManagedFieldsForDefine(
  schema: ATS.AnyTypeSchema,
  managedFields: readonly ManagedFieldDescriptor[]
): ATS.AnyTypeSchema {
  if (managedFields.length === 0) return schema;
  try {
    return reapplyManagedFields(schema, managedFields);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new JITError("DDD_CAPABILITY_SCHEMA_CONFLICT", message);
  }
}

function definedPolicyBase(state: DefinedClassState): DefinedClassPolicy {
  return (
    state.policy ?? {
      result: "throw",
      create: true,
      hydrate: true,
    }
  );
}

function resolveDefinedNestedResultPolicy(schema: ATS.AnyTypeSchema): FactoryPolicyCandidate | undefined {
  const candidates: FactoryPolicyCandidate[] = [];
  const active = new Set<ATS.AnyTypeSchema>();
  const visit = (current: ATS.AnyTypeSchema, depth: number): void => {
    if (active.has(current)) return;
    active.add(current);
    if (current.type === TypeName.runtimeType) {
      const traits = (current as ATS.RuntimeTypeSchema).def.traits.factoryPolicy;
      if (traits.configured && (traits.resultModeExplicit || traits.resultModeInherited)) {
        candidates.push({
          mode: traits.resultMode as FactoryReturnMode,
          priority: traits.priority,
          explicitMode: traits.resultModeExplicit,
          depth,
          source: String(candidates.length),
        });
      }
      active.delete(current);
      return;
    }
    if (current.type === TypeName.object) {
      for (const child of Object.values((current as ATS.ObjectSchema).def.props)) visit(child, depth + 1);
    } else {
      for (const child of schemaChildren(current)) visit(child, depth + 1);
    }
    active.delete(current);
  };
  visit(schema, 0);
  return selectFactoryPolicyCandidate(candidates);
}

function resolveDefinedPolicy(state: DefinedClassState): DefinedClassPolicy | undefined {
  if (state.validationConfigured) return state.policy;
  const previous = state.policy;
  if (previous !== undefined && previous.resultModeInherited !== true) return previous;
  const nestedPolicy = resolveDefinedNestedResultPolicy(state.schema);
  if (nestedPolicy === undefined) {
    if (previous === undefined) return undefined;
    return {
      ...previous,
      result: "throw",
      resultModeInherited: false,
    };
  }
  return {
    ...(previous ?? { result: "throw", create: true, hydrate: true }),
    result: nestedPolicy.mode,
    errorPriority: nestedPolicy.priority,
    resultModeInherited: true,
  };
}

function definedAssertions(
  descriptors: readonly AssertionDescriptor[],
  maxIssues: number | undefined,
  errors: readonly (unknown | undefined)[]
): DefinedClassAssertions {
  const bindingValues = descriptors.flatMap((descriptor) => descriptor.bindings);
  return {
    descriptors: Object.freeze([...descriptors]),
    source: emitAssertionSource(descriptors, maxIssues),
    bindingNames: Object.freeze(bindingValues.map((_, index) => `__q${index}`)),
    bindingValues: Object.freeze(bindingValues),
    failures: Object.freeze(
      descriptors.map((descriptor, index) => ({
        rule: descriptor.rule,
        field: descriptor.field,
        code: descriptor.code,
        message: descriptor.message,
        priority: descriptor.priority,
        ...(errors[index] === undefined ? {} : { error: errors[index] }),
      }))
    ),
  };
}

function defineClassAssertion(
  state: DefinedClassState,
  predicate: (query: QueryConditionBuilder<unknown>) => QueryConditionNode,
  options: AssertionOptions | undefined
): DefinedClassState {
  const policy = definedPolicyBase(state);
  const previous = policy.assertions;
  const startIndex = previous?.bindingValues.length ?? 0;
  const builder = createConditionBuilder(startIndex);
  const condition = predicate(builder.builder);
  if (options?.priority !== undefined && !Number.isFinite(options.priority)) {
    throw new RangeError("priority must be a finite number");
  }
  const descriptor = resolveAssertionDescriptor({
    condition,
    bindings: builder.bindings,
    ...(options?.rule === undefined ? {} : { rule: options.rule }),
    ...(options?.code === undefined ? {} : { code: options.code }),
    ...(options?.message === undefined ? {} : { message: options.message }),
    ...(options?.priority === undefined ? {} : { priority: options.priority }),
  });
  const descriptors = [...(previous?.descriptors ?? []), descriptor];
  const errors = [...(previous?.failures.map((failure) => failure.error) ?? []), options?.error];
  return {
    ...state,
    policy: {
      ...policy,
      assertions: definedAssertions(descriptors, policy.maxIssues, errors),
    },
  };
}

function definedLifecycleMutation(lifecycle: LifecycleDefinition):
  | {
      readonly updatedAt?: string;
      readonly touchAt?: string;
      readonly version?: string;
      readonly deletedAt?: string;
      readonly touchMethod?: string;
      readonly deleteMethod?: string;
      readonly restoreMethod?: string;
      readonly isDeletedMember?: string;
      readonly timestampClock?: unknown;
      readonly deletionClock?: unknown;
    }
  | undefined {
  const timestamps = lifecycle.timestamps;
  const deletion = lifecycle.softDelete;
  const versioned = lifecycle.versioned;
  if (timestamps === undefined && deletion === undefined && versioned === undefined) return undefined;
  return {
    ...(timestamps?.touch === "manual" || timestamps === undefined ? {} : { updatedAt: timestamps.updatedAt }),
    ...(timestamps === undefined ? {} : { touchAt: timestamps.updatedAt, touchMethod: timestamps.touchMethod }),
    ...(versioned === undefined ? {} : { version: versioned.field }),
    ...(deletion === undefined
      ? {}
      : {
          deletedAt: deletion.field,
          deleteMethod: deletion.deleteMethod,
          restoreMethod: deletion.restoreMethod,
          isDeletedMember: deletion.isDeletedMember,
        }),
    ...(timestamps?.clock === undefined ? {} : { timestampClock: timestamps.clock }),
    ...(deletion?.clock === undefined ? {} : { deletionClock: deletion.clock }),
  };
}

function removeDefinedNoConstructorFields(
  schema: ATS.AnyTypeSchema,
  policies: readonly DefinedClassFieldPolicy[]
): ATS.AnyTypeSchema {
  const excluded = new Set(policies.filter((policy) => policy.noConstructor).map((policy) => policy.name));
  if (excluded.size === 0) return schema;
  const object = resolveWrappers(schema).base;
  if (object.type !== TypeName.object) return schema;
  return createSchema(
    TypeName.object,
    {
      props: Object.fromEntries(
        Object.entries((object as ATS.ObjectSchema).def.props).filter(([name]) => !excluded.has(name))
      ),
      unknownKeys: (object as ATS.ObjectSchema).def.unknownKeys,
      catchall: (object as ATS.ObjectSchema).def.catchall,
      checks: (object as ATS.ObjectSchema).def.checks,
    },
    object.annotations
  );
}

export function defineRuntimeClass(state: DefinedClassState): unknown {
  const policy = resolveDefinedPolicy(state);
  const resolvedState = policy === state.policy ? state : { ...state, policy };
  const base = resolveWrappers(resolvedState.schema).base;
  const target = function definedRuntimeClass(): never {
    return defineArtifactFailure();
  };
  const materialize = function materializeDefinedClass(): never {
    return defineArtifactFailure();
  } as unknown as new (
    input: unknown,
    validated?: boolean
  ) => unknown;
  const mutation = definedLifecycleMutation(resolvedState.lifecycle);
  const creationSchema = removeDefinedNoConstructorFields(resolvedState.schema, resolvedState.fieldPolicies);
  const hydrateSchema = removeDefinedNoConstructorFields(resolvedState.schema, resolvedState.fieldPolicies);
  const domainStateLayout =
    resolvedState.encapsulateFields && base.type === TypeName.object
      ? {
          storage: "symbol" as const,
          mutableFields: Object.keys((base as ATS.ObjectSchema).def.props).filter(
            (field) => !resolveWrappers((base as ATS.ObjectSchema).def.props[field]).readonly
          ),
          readonlyFields: Object.keys((base as ATS.ObjectSchema).def.props).filter(
            (field) => resolveWrappers((base as ATS.ObjectSchema).def.props[field]).readonly
          ),
        }
      : undefined;
  const assertion = policy?.assertions === undefined ? undefined : () => undefined;
  registerArtifact(target, {
    kind: "class",
    declaredSchema: resolvedState.declaredSchema,
    schema: resolvedState.schema,
    creationSchema,
    wireSchema: hydrateSchema,
    abstract: resolvedState.abstract,
    frozen: resolvedState.frozen || resolvedState.representation === "value",
    aggregate: resolvedState.aggregate,
    construction: resolvedState.construction,
    factoryValidationOptIn: resolvedState.factoryValidationOptIn,
    representation: resolvedState.representation,
    capabilities: resolvedState.capabilities,
    managedFields: resolvedState.managedFields,
    hydrateSchema,
    encapsulateFields: resolvedState.encapsulateFields,
    ...(domainStateLayout === undefined ? {} : { domainStateLayout }),
    ...(resolvedState.fieldPolicies.length === 0 ? {} : { fieldPolicies: resolvedState.fieldPolicies }),
    lifecycle: resolvedState.lifecycle,
    resolvedMembers: resolvedState.members.entries(),
    ...(mutation === undefined ? {} : { mutation }),
    ...(resolvedState.methods.length === 0 ? {} : { methods: resolvedState.methods }),
    ...(policy === undefined
      ? {}
      : { policy: { ...policy, validationConfigured: resolvedState.validationConfigured } }),
    ...(resolvedState.customFactories === undefined ? {} : { customFactories: resolvedState.customFactories }),
    ...(resolvedState.domainEvent === undefined ? {} : { domainEvent: resolvedState.domainEvent }),
    factories: resolvedState.factories,
    accessors: resolvedState.accessors as never,
  });
  Object.defineProperties(target, {
    schema: {
      enumerable: true,
      value: createSchema(TypeName.runtimeType, {
        innerType: resolvedState.schema,
        materialize,
        representation: resolvedState.representation,
        identifier: resolvedState.identifier,
        traits: {
          representation: resolvedState.representation,
          identifier: resolvedState.identifier,
          factoryPolicy: {
            configured: policy !== undefined,
            resultMode: policy?.result ?? "throw",
            resultModeExplicit: policy?.resultModeExplicit === true,
            resultModeInherited: policy?.resultModeInherited === true,
            errorType: undefined,
            priority: policy?.errorPriority ?? 1000,
            hasAssertions: policy?.assertions !== undefined,
            validationConfigured: resolvedState.validationConfigured,
          },
        },
        assertion,
      }),
    },
    create: { enumerable: false, value: defineArtifactFailure },
    hydrate: { enumerable: false, value: defineArtifactFailure },
    extends: {
      enumerable: false,
      value: (...extensions: readonly (DefinedCapability | ClassMethodsInput | ClassMixin)[]) =>
        defineRuntimeClass(defineClassExtensions(resolvedState, extensions)),
    },
    ...(resolvedState.aggregate
      ? {
          events: {
            enumerable: false,
            value: (...eventTypes: readonly Function[]) => {
              void eventTypes;
              return target;
            },
          },
        }
      : {}),
    construction: {
      enumerable: false,
      value: (mode: "constructor" | "factory") => {
        if (policy !== undefined) {
          throw new JITError("INVALID_OPERATION", "Construction must be configured before validation or assertions");
        }
        return defineRuntimeClass({
          ...resolvedState,
          construction: mode,
          factories: mode === "factory" ? { create: "create", hydrate: "hydrate" } : { create: false, hydrate: false },
        });
      },
    },
    factories: {
      enumerable: false,
      value: (options: FactoryOptions) => {
        const create = resolveDefinedFactoryName(options.create, "create", "create");
        const hydrate = resolveDefinedFactoryName(options.hydrate, "hydrate", "hydrate");
        return defineRuntimeClass({
          ...resolvedState,
          construction: "factory",
          factories: { create: create.name, hydrate: hydrate.name },
          customFactories: {
            ...(resolvedState.customFactories ?? {}),
            ...(create.implementation === undefined ? {} : { create: create.implementation }),
            ...(hydrate.implementation === undefined ? {} : { hydrate: hydrate.implementation }),
          },
        });
      },
    },
    accessors: { enumerable: false, value: () => defineRuntimeClass(resolvedState) },
    validate: {
      enumerable: false,
      value: (options?: FactoryValidationOptions) => {
        if (resolvedState.validationConfigured) {
          throw new JITError("INVALID_OPERATION", "Factory validation is already configured for this Runtime Class");
        }
        if (options?.maxIssues !== undefined && (!Number.isSafeInteger(options.maxIssues) || options.maxIssues < 1)) {
          throw new RangeError("maxIssues must be a positive safe integer");
        }
        if (options?.priority !== undefined && !Number.isFinite(options.priority)) {
          throw new RangeError("priority must be a finite number");
        }
        const previous = definedPolicyBase(resolvedState);
        return defineRuntimeClass({
          ...resolvedState,
          validationConfigured: true,
          policy: {
            ...previous,
            result:
              options?.result === undefined
                ? previous.result
                : normalizeFactoryReturnMode(options.result as FactoryReturnModeInput),
            create: options?.create ?? previous.create,
            hydrate: options?.hydrate ?? previous.hydrate,
            ...(options?.result === undefined ? {} : { resultModeExplicit: true, resultModeInherited: false }),
            ...(options?.maxIssues === undefined ? {} : { maxIssues: options.maxIssues }),
            ...(options?.priority === undefined
              ? {}
              : { errorPriority: options.priority, errorPriorityExplicit: true }),
            ...(options?.error === undefined ? {} : { error: options.error }),
          },
        });
      },
    },
    assert: {
      enumerable: false,
      value: (predicate: (query: QueryConditionBuilder<unknown>) => QueryConditionNode, options?: AssertionOptions) =>
        defineRuntimeClass(defineClassAssertion(resolvedState, predicate, options)),
    },
  });
  return target;
}

export const defineClass = Object.assign(
  ((schema: SchemaInput<ATS.AnyTypeSchema>) =>
    defineRuntimeClass(defineClassState(unwrapSchema(schema), false, false))) as ClassFactory,
  {
    abstract: (schema: SchemaInput<ATS.AnyTypeSchema>) =>
      defineRuntimeClass(defineClassState(unwrapSchema(schema), true, false)),
    equals: defineCapability("equals", ["equals"]),
    hashCode: defineCapability("hashCode", ["hashCode"]),
    with: defineCapability("with", ["with"]),
    diff: defineCapability("diff", ["diff"]),
    clone: defineCapability("clone", ["clone"]),
    override,
    public: classPublic,
    protected: classProtected,
    private: classPrivate,
    getter: classGetter,
    setter: classSetter,
    method: classMethod,
    factory: classFactoryDescriptor,
    noConstructor: classNoConstructor,
    mixin: classMixin,
    json: (options?: ClassJsonOptions) =>
      defineCapability("class.json", [options?.method ?? "toJson"]) as ClassJsonCapability,
  }
) as ClassFactory;
