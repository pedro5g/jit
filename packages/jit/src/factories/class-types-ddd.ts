import type * as ATS from "../core/ats/index.js";
import type {
  AnyDomainEvent,
  ClassMethodsInput,
  DomainEventBrand,
  DomainEventConstructor,
  DomainEventUnion,
  EventPublisher,
} from "./class-types-capability.js";

declare class AggregateProtectedMethods<TEvent extends DomainEventBrand = AnyDomainEvent> {
  protected raise(event: TEvent): void;
}

type AggregateMethods<TEvent extends DomainEventBrand = AnyDomainEvent> = AggregateProtectedMethods<TEvent> & {
  peekEvents(): readonly TEvent[];
  pullEvents(): TEvent[];
  commit(publisher: EventPublisher<TEvent>): Promise<void>;
};

import type {
  AnyClassExtension,
  ClassExtensionArgs,
  ClassExtensionArgument,
  ClassExtensionBuilder,
} from "./class-types-extension.js";
import type { FactoryRuntimeClass } from "./class-types-factory.js";
import type { InitialRuntimeTypeTraits } from "./class-types-runtime.js";
import type {
  ApplyClassExtensionSchema,
  ApplySchemaOverrides,
  ClassConstructorInput,
  ExtendedInstance,
  MixinThisSurface,
} from "./class-types-schema.js";

/**
 * Declarative shape of a class mixin.
 *
 * @example
 * ```ts
 * const definition: ClassMixinDefinition = {
 *   fields: { label: "user" },
 *   methods: { describe() { return this.label; } },
 * };
 * const mixin = JIT.class.mixin(definition);
 * ```
 */
export interface ClassMixinDefinition<
  TFields extends ClassMethodsInput = ClassMethodsInput,
  TMethods extends ClassMethodsInput = ClassMethodsInput,
  TRequires extends ClassMethodsInput = ClassMethodsInput,
> {
  /** Existing host fields visible to methods, without adding persistence fields. */
  readonly requires?: TRequires;
  readonly fields?: TFields;
  readonly methods?: TMethods & ThisType<MixinThisSurface<TFields, TRequires>>;
}

/**
 * Aggregate Root Runtime Class with identity and ordered event behavior.
 *
 * @example
 * ```ts
 * const Order = JIT.ddd.aggregateRoot(OrderSchema);
 * const order = Order.create({ id: "o1" });
 * order.pullEvents();
 * ```
 */
export type AggregateRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TEvent extends DomainEventBrand = AnyDomainEvent,
> = (abstract new (
  input: ClassConstructorInput<TSchema>
) => TInstance & AggregateMethods<TEvent>) &
  Omit<
    FactoryRuntimeClass<TSchema, TInstance & AggregateMethods<TEvent>, InitialRuntimeTypeTraits<TSchema>, true>,
    "extends"
  > & {
    extends<TOutput extends ClassMethodsInput>(
      extension: (builder: ClassExtensionBuilder<TSchema, TInstance & AggregateMethods<TEvent>, true>) => TOutput
    ): AggregateRuntimeClass<
      ApplySchemaOverrides<TSchema, [TOutput]>,
      ExtendedInstance<TSchema, TInstance & AggregateMethods<TEvent>, [TOutput], true>,
      TEvent
    >;
    extends<TFirst extends AnyClassExtension, TOutput extends ClassMethodsInput>(
      first: TFirst & ClassExtensionArgument<TSchema, TInstance & AggregateMethods<TEvent>, TFirst, true>,
      extension: (
        builder: ClassExtensionBuilder<
          ApplyClassExtensionSchema<TSchema, TFirst>,
          ExtendedInstance<TSchema, TInstance & AggregateMethods<TEvent>, [TFirst], true>,
          true
        >
      ) => TOutput
    ): AggregateRuntimeClass<
      ApplySchemaOverrides<TSchema, [TFirst, TOutput]>,
      ExtendedInstance<TSchema, TInstance & AggregateMethods<TEvent>, [TFirst, TOutput], true>,
      TEvent
    >;
    extends<const TExtensions extends readonly AnyClassExtension[]>(
      ...extensions: TExtensions & ClassExtensionArgs<TSchema, TInstance & AggregateMethods<TEvent>, TExtensions, true>
    ): AggregateRuntimeClass<
      ApplySchemaOverrides<TSchema, TExtensions>,
      ExtendedInstance<TSchema, TInstance & AggregateMethods<TEvent>, TExtensions, true>,
      TEvent
    >;
    events<const TEvents extends readonly DomainEventConstructor[]>(
      ...events: TEvents
    ): AggregateRuntimeClass<TSchema, TInstance, DomainEventUnion<TEvents>>;
    events<TNextEvent extends DomainEventBrand>(): AggregateRuntimeClass<TSchema, TInstance, TNextEvent>;
  };
