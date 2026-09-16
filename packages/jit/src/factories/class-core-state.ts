import type { LifecycleDefinition, ManagedFieldDescriptor } from "../classes/effective-schema.js";
import type { ResolvedMemberTable } from "../classes/members.js";
import type * as ATS from "../core/ats/index.js";
import type { ClassFieldPolicy, ResolvedAccessors } from "./class-layout.js";
import type { FactoryPolicyState } from "./class-policy.js";
import type { AnyClassCapability, ConstructionMode } from "./class-types.js";

/** @internal Normalized prototype method descriptor shared by class builders. */
export interface ClassMethodDefinition {
  readonly name: string;
  readonly kind: "method" | "get" | "set";
  readonly source: Function;
  readonly schema?: ATS.FunctionSchema;
  readonly async?: boolean;
}

/** @internal Identity resolution state carried while declaring a Runtime Class. */
export type IdentityState =
  | { readonly state: "none" }
  | { readonly state: "resolved"; readonly key: string; readonly explicit: boolean }
  | { readonly state: "pending" }
  | { readonly state: "ambiguous"; readonly candidates: readonly string[] };

/** @internal Immutable declaration state used to materialize a Runtime Class. */
export interface ClassDefinitionState {
  readonly declaredSchema: ATS.AnyTypeSchema;
  readonly schema: ATS.AnyTypeSchema;
  readonly isAbstract: boolean;
  readonly freezeInstances: boolean;
  readonly aggregate: boolean;
  readonly construction: ConstructionMode;
  readonly factoryValidationOptIn: boolean;
  readonly constructionConfigured: boolean;
  readonly factoriesConfigured: boolean;
  readonly factoryNames: { readonly create: string | false; readonly hydrate: string | false };
  readonly customFactories: {
    readonly create?: Function;
    readonly hydrate?: Function;
  };
  readonly accessors: ResolvedAccessors | undefined;
  readonly fieldPolicies: ReadonlyMap<string, ClassFieldPolicy>;
  readonly encapsulateFields: boolean;
  readonly capabilities: readonly AnyClassCapability[];
  readonly methods: readonly ClassMethodDefinition[];
  readonly lifecycle: LifecycleDefinition;
  readonly managedFields: readonly ManagedFieldDescriptor[];
  readonly members: ResolvedMemberTable;
  readonly policy: FactoryPolicyState;
  readonly identity: IdentityState;
}

/** @internal State overrides used when a fluent class creates its next artifact. */
export interface ClassStateSeed {
  readonly declaredSchema?: ATS.AnyTypeSchema;
  readonly capabilities?: readonly AnyClassCapability[];
  readonly methods?: readonly ClassMethodDefinition[];
  readonly lifecycle?: LifecycleDefinition;
  readonly managedFields?: readonly ManagedFieldDescriptor[];
  readonly members?: ResolvedMemberTable;
  readonly policy?: FactoryPolicyState;
  readonly fieldPolicies?: ReadonlyMap<string, ClassFieldPolicy>;
  readonly encapsulateFields?: boolean;
  readonly factoryNames?: { readonly create: string | false; readonly hydrate: string | false };
  readonly customFactories?: { readonly create?: Function; readonly hydrate?: Function };
  readonly constructionConfigured?: boolean;
  readonly factoriesConfigured?: boolean;
  readonly identity?: IdentityState;
  readonly factoryValidationOptIn?: boolean;
}

/** @internal State overrides used when a scalar Value Object creates its next artifact. */
export interface ScalarClassSeed {
  readonly policy?: FactoryPolicyState;
  readonly capabilities?: readonly AnyClassCapability[];
  readonly methods?: readonly InstalledScalarMethod[];
  readonly factoryNames?: { readonly create: string | false; readonly hydrate: string | false };
  readonly customFactories?: { readonly create?: Function; readonly hydrate?: Function };
  readonly construction?: ConstructionMode;
  readonly constructionConfigured?: boolean;
  readonly factoriesConfigured?: boolean;
}

/** @internal Serializable method metadata retained for scalar class artifacts. */
export type InstalledScalarMethod = ClassMethodDefinition;
