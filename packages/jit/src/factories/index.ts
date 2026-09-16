/** JSON Schema import/export helpers and their extension contexts. */
export type {
  FromJsonSchemaOptions,
  InferJsonSchema,
  JsonSchemaDocument,
  JsonSchemaNode,
  JsonSchemaTarget,
  OverrideContext,
  RefineContext,
  ToJsonSchemaOptions,
  UnsupportedContext,
} from "../compiler/json-schema/index.js";
/** Deterministic mock generation and incremental stream contracts. */
export type { Mock, MockOptions } from "../compiler/mock.js";
export type { CompiledStream, StreamOptions } from "../compiler/stream.js";
/** Fluent JSON Schema declaration builder. */
export { type JsonSchemaBuilder, jsonSchema } from "./json-schema.js";
/** Resolves the output type of a schema or builder as `JIT.Typeof<typeof User>`. */
export type Typeof<TSchemaLike> = import("../core/ats/typeof.js").Typeof<TSchemaLike>;
/** Resolves the accepted boundary input of a schema or builder. */
export type Input<TSchemaLike> = import("../core/ats/input.js").Input<TSchemaLike>;
/** Resolves the immutable update patch accepted by a schema or builder. */
export type Update<TSchemaLike> = import("../core/ats/input.js").Update<TSchemaLike>;
/** Resolves complete persisted state accepted by `hydrate()`. */
export type Hydrate<TSchemaLike> = import("../core/ats/representations.js").Hydrate<TSchemaLike>;
/** Resolves the transport representation of a schema or Runtime Type. */
export type Wire<TSchemaLike> = import("../core/ats/representations.js").Wire<TSchemaLike>;
export type {
  ClassFactoryContext,
  ClassFactoryMemberDescriptor,
  ClassFieldMemberDescriptor,
  ClassMemberDefinition,
  ClassMemberDescriptor,
  ClassMemberVisibility,
  ClassMethodBuilder,
  ClassMethodOptions,
} from "../classes/member-descriptors.js";
/** Format regexes behind the string checks — reusable and overridable. */
export * as regexes from "../shared/regexes.js";
/** Declarative authorization conditions and access explanations. */
export {
  type Ability,
  type AccessBuilder,
  type AccessConditionBuilder,
  type AccessExplanation,
  type AccessPlan,
  type AccessPredicate,
  type AccessRuleOptions,
  type ActorRef,
  access,
} from "./access.js";
/** Deny-by-default request query boundary. */
export { type ApiQuery, type ApiQueryOptions, api } from "./api.js";
/** Schema-specialized string and hash cache keys. */
export { type CacheKeyBuilder, cacheKey } from "./cache-key.js";
/** Canonicalizes values using the schema's semantic representation. */
export { canonical } from "./canonical.js";
/** Runtime Class construction, factory, capability and DDD contracts. */
export type { OverrideDescriptor } from "./class.js";
/** Runtime Class construction, factory, capability and DDD contracts. */
export {
  type AbstractRuntimeClass,
  type AggregateRuntimeClass,
  type AnyDomainEvent,
  type ClassConstructorInput,
  type ClassCreateInput,
  type ClassExtensionBuilder,
  type ClassExtensionFieldBuilder,
  type ClassFactory,
  type ClassHydrateInput,
  type ClassJsonCapability,
  type ClassJsonOptions,
  type ClassMixin,
  type ClassMixinDefinition,
  class,
  type DefaultRuntimeTypeFactoryPolicyTraits,
  type DefaultRuntimeTypeTraits,
  type DomainEvent,
  type DomainEventBrand,
  type DomainState,
  type DomainStateCarrier,
  type EventPublisher,
  type FactoryEither,
  type FactoryFailure,
  type FactoryReturnMode,
  type InternalInstance,
  type PublicInstance,
  type RuntimeClass,
  type RuntimeTypeFactoryPolicyTraits,
  type RuntimeTypeTraits,
  type ScalarValueObject,
  type SoftDeleteCapability,
  type SoftDeleteOptions,
  type StandardEvent,
  type TimestampCapability,
  type TimestampOptions,
  type VersionedCapability,
  type VersionedOptions,
} from "./class.js";
/** Collection state mutation and collection capability contracts. */
export * from "./collection/index.js";
export type {
  CollectionMutation,
  CollectionState,
} from "./collection-state.js";
/** Fluent composition and execution-pipeline contracts. */
export * from "./composition/index.js";
/** Trusted CQRS query builders and portable query contracts. */
export {
  type CqrsQuery,
  cqrs,
  type StandardQuery,
  type StandardQueryCondition,
  type StandardQueryDefinition,
  type StandardQueryStep,
  type StandardQueryValue,
} from "./cqrs.js";
/** CSV parsing and serialization plans. */
export {
  type CsvChunk,
  type CsvInput,
  type CsvParsePlan,
  type CsvSchemaOptions,
  type CsvStringifyPlan,
  csv,
} from "./csv.js";
/** Domain-driven design presets and extension namespace. */
export { type DddExtensions, type DddNamespace, ddd } from "./ddd.js";
/** Dependency-aware derived computations. */
export type {
  DerivedBuilder,
  DerivedComputation,
  DerivedExplanation,
} from "./derive.js";
/** Data-transfer-object schema helpers. */
export { dto } from "./dto.js";
/** Schema-backed indexes and keyed lookup plans. */
export {
  type IndexBuilder,
  type IndexPlan,
  index,
  type KeyedIndexPlan,
} from "./indexing.js";
/** ISO date, time and duration schema factories. */
export { type IsoFactories, iso } from "./iso.js";
/** Schema-specialized lookup builders. */
export { type LookupBuilder, type LookupPlan, lookup } from "./lookup.js";
/** Mapper override contracts for shape-specific transformations. */
export type { MapperOverride, MapperOverrides } from "./mapper.js";
/** Discriminated-union matching builder. */
export { type MatchBuilder, match } from "./match.js";
/** Versioned schema migration plans. */
export { type MigrationPlan, migrate } from "./migration.js";
/** NDJSON parsing and serialization plans. */
export {
  type NdjsonChunk,
  type NdjsonInput,
  type NdjsonParsePlan,
  type NdjsonStringifyPlan,
  ndjson,
} from "./ndjson.js";
/** Object-schema transforms and object-specific builders. */
export * from "./object/index.js";
/** Compiled operation chains over scalar values. */
export {
  type AnyOpChain,
  type DateOps,
  type NumberOps,
  type OpChain,
  ops,
  type StringOps,
} from "./ops.js";
/** JSON Merge Patch and JSON Patch input contracts. */
export type { JsonPatchOperation, MergePatch } from "./patch.js";
/** Primitive schema factories such as `string`, `number` and `boolean`. */
export * from "./primitive/index.js";
/** Binary process builders and compiled process contracts. */
export type {
  BinaryProcessBuilder,
  BinaryProcessCompiled,
  ProcessBuilder,
} from "./process.js";
/** Executes a compiled binary processing pipeline. */
export { process } from "./process.js";
/** Schema projection plans for selecting nested fields. */
export {
  type ProjectablePath,
  type ProjectBuilder,
  type Projected,
  project,
} from "./project.js";
/** Query builder types for eager, lazy and binary backends. */
export type {
  BinaryQueryBuilder,
  LazyQueryBuilder,
  QueryBuilder,
  QueryConditionBuilder,
} from "./query.js";
/** Reconciliation result, channel and visitor contracts. */
export type {
  ReconcileChange,
  ReconcileChangeWithDiff,
  ReconcileDelta,
  ReconcileEvent,
  ReconcilePlan,
  ReconcileResult,
  ReconcileVisitor,
  ResolvedChannels,
} from "./reconcile.js";
/** Declarative rule builders, plans and result sinks. */
export {
  type RuleConditionBuilder,
  type RuleInputRef,
  type RuleInputValue,
  type RuleOptions,
  type RulesBuilder,
  type RulesPlan,
  rules,
} from "./rules.js";
/** Runtime operation artifacts and their callable type. */
export type { RuntimeCompiledFunction } from "./runtime-ops.js";
/** Validation, JSON, binary, comparison and security operation namespaces. */
export {
  binary,
  clone,
  compare,
  format,
  from,
  json,
  map,
  mock,
  security,
  validate,
} from "./runtime-ops.js";
/** Bidirectional schema codecs. */
export { codec } from "./serialize.js";
/** Schema-specialized ordering builders and plans. */
export { type SortBuilder, type SortPlan, sort } from "./sort.js";
/** Special schema factories such as literals, unions and recursive types. */
export * from "./special/index.js";
/** Immutable state update and watch namespace. */
export { state } from "./state.js";
/** Stateful streaming boundary helpers. */
export { stream } from "./stream.js";
/** Declarative value transforms. */
export type { TransformBuilder, TransformFieldOps } from "./transform.js";
export { transform } from "./transform.js";
/** Reactive immutable update, subscription and watch contracts. */
export type {
  Draft,
  ReactiveChange,
  ReactivePath,
  ReactivePathEvent,
  ReactivePathValue,
  ReactiveScheduler,
  ReactiveSelectionEvent,
  ReactiveSubscribeOptions,
  ReactiveUpdate,
  ReactiveUpdateEvent,
  ReactiveUpdateOptions,
  ReactiveWatchOptions,
  RuntimeUpdate,
  UpdateInput,
  UpdateRecipe,
} from "./update.js";
/** Custom validation message input accepted by schema factories. */
export type { ValidationMessage } from "./validation-message.js";
/** Watched collection runtime and event contracts. */
export type {
  RuntimeWatch,
  WatchedListOptions,
  WatchedListResult,
  WatchedListSnapshot,
  WatchedListUpdate,
  WatchInput,
} from "./watch.js";
export { KeyedWatchedList, WatchedList } from "./watch.js";
/** Optional and other schema wrapper factories. */
export * from "./wrappers/index.js";
/** Default export for consumers that prefer the wrapper namespace directly. */
export { default } from "./wrappers/index.js";
