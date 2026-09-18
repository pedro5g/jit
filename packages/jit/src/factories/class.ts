/**
 * Runtime Class construction, factory and DDD public surface.
 *
 * @example
 * ```ts
 * const User = JIT.class(JIT.object({ id: JIT.number() }));
 * const user = new User({ id: 1 });
 * ```
 */
export type {
  ClassFactoryMemberDescriptor,
  ClassFieldMemberDescriptor,
  ClassMemberDefinition,
  ClassMemberDescriptor,
  ClassMemberVisibility,
  ClassMethodBuilder,
  ClassMethodOptions,
} from "../classes/member-descriptors.js";
export type { OverrideDescriptor } from "../classes/override.js";
export { override } from "../classes/override.js";
export type {
  DefaultRuntimeTypeFactoryPolicyTraits,
  DefaultRuntimeTypeTraits,
  RuntimeTypeFactoryPolicyTraits,
  RuntimeTypeTraits,
} from "../core/ats/type-schema.js";
export type { FactoryReturnMode } from "../core/factory-policy.js";
export type { ClassFactory } from "./class-core.js";
export { classMixin, classType, classType as class, getRuntimeClassTarget } from "./class-core.js";
export type { IdentityState } from "./class-core-state.js";
export type { DomainEvent } from "./class-ddd.js";
export {
  abstractAggregateRoot,
  abstractEntity,
  abstractValueObject,
  aggregateRoot,
  domainEvent,
  entity,
  softDelete,
  timestamps,
  uniqueIdentifier,
  valueObject,
  versioned,
} from "./class-ddd.js";
export type {
  AbstractRuntimeClass,
  AccessorMember,
  AccessorOptions,
  AccessorVisibility,
  AggregateRuntimeClass,
  AnyDomainEvent,
  AssertionOptions,
  CallableClassCapability,
  ClassCapability,
  ClassConstructorInput,
  ClassCreateInput,
  ClassExtensionArgs,
  ClassExtensionBuilder,
  ClassExtensionFieldBuilder,
  ClassHydrateInput,
  ClassJsonCapability,
  ClassJsonOptions,
  ClassMethodsInput,
  ClassMixin,
  ClassMixinDefinition,
  ConfiguredRuntimeClass,
  ConstructionMode,
  ConstructorRuntimeClass,
  DomainEventBrand,
  DomainState,
  DomainStateCarrier,
  EventPublisher,
  FactoryConstructionContext,
  FactoryEither,
  FactoryFailure,
  FactoryOptions,
  FactoryOutcome,
  FactoryRuntimeClass,
  FactoryValidationOptions,
  InternalInstance,
  PendingEntityRuntimeClass,
  PublicInstance,
  RuntimeClass,
  ScalarValueObject,
  SoftDeleteCapability,
  SoftDeleteOptions,
  StandardEvent,
  TimestampCapability,
  TimestampOptions,
  VersionedCapability,
  VersionedOptions,
} from "./class-types.js";
