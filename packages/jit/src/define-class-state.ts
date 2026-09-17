import {
  addMember,
  type CapabilityOptions,
  initialEffectiveSchema,
  type LifecycleDefinition,
  type ManagedFieldDescriptor,
} from "./classes/effective-schema.js";
import { isClassMemberDescriptor } from "./classes/member-descriptors.js";
import { ResolvedMemberTable } from "./classes/members.js";
import type { AssertionDescriptor } from "./compiler/assertion.js";
import { resolveWrappers } from "./compiler/resolvers/resolve-wrappers.js";
import type * as ATS from "./core/ats/index.js";
import { TypeName } from "./core/ats/index.js";
import type { SchemaInput } from "./core/builder/index.js";
import type { FactoryPolicyCandidate, FactoryReturnMode, FactoryReturnModeInput } from "./core/factory-policy.js";
import { JITError } from "./errors/index.js";
import type { ClassCapability, ClassMixin, FactoryOptions } from "./factories/class.js";

export interface DefinedClassMethod {
  readonly name: string;
  readonly kind: "method" | "get" | "set";
  readonly source: Function;
}

export interface DefinedClassAssertionFailure {
  readonly rule: string | undefined;
  readonly field: string | undefined;
  readonly code: string;
  readonly message: string;
  readonly priority: number;
  readonly error?: unknown;
}

export interface DefinedClassFieldPolicy {
  readonly name: string;
  readonly visibility: "public" | "protected" | "private";
  readonly getter: boolean;
  readonly setter: boolean;
  readonly noConstructor: boolean;
}

export interface DefinedClassAssertions {
  readonly descriptors: readonly AssertionDescriptor[];
  readonly source: string;
  readonly bindingNames: readonly string[];
  readonly bindingValues: readonly unknown[];
  readonly failures: readonly DefinedClassAssertionFailure[];
}

export interface DefinedClassPolicy {
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

export interface DefinedClassState {
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

export type DefinedCapability = ClassCapability<object> &
  (() => DefinedCapability) & {
    readonly __memberNames?: readonly string[];
    readonly __options?: unknown;
  };

export const DEFINED_RESERVED_MEMBER_NAMES: ReadonlySet<string> = new Set([
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

/** @internal Failure used by non-executable define-host artifacts. */
export const DEFINE_EXECUTION_ERROR =
  "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead.";

export function defineArtifactFailure(): never {
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
    capabilities: [],
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

export function definedCapabilityOptions(value: DefinedCapability): CapabilityOptions | undefined {
  return value.__options as CapabilityOptions | undefined;
}

export function definedCapabilityMembers(value: DefinedCapability): readonly string[] {
  return value.__memberNames ?? [];
}

export function isDefinedSchema(value: unknown): value is ATS.AnyTypeSchema {
  return typeof value === "object" && value !== null && "type" in value && "def" in value;
}

export function isDefinedSchemaInput(value: unknown): value is SchemaInput<ATS.AnyTypeSchema> {
  return (
    isDefinedSchema(value) ||
    (typeof value === "object" && value !== null && "schema" in value && typeof value.schema === "object")
  );
}

export function isDefinedClassMixin(value: unknown): value is ClassMixin {
  return typeof value === "function" && (value as { readonly __classMixin?: unknown }).__classMixin === true;
}

export function resolveDefinedFactoryName(
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

export type DefinedFactoryPolicyCandidate = FactoryPolicyCandidate;
export type DefinedFactoryReturnModeInput = FactoryReturnModeInput;
