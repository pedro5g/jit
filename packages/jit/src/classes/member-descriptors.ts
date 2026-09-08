import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/unwrap-schema.js";
import { JITError } from "../errors/index.js";

const CLASS_MEMBER_DESCRIPTOR = Symbol("jit.class.member");

export type ClassMemberVisibility = "public" | "protected" | "private";

export interface ClassFieldMemberDescriptor {
  readonly kind: "field";
  readonly schema?: SchemaInput<ATS.AnyTypeSchema>;
  readonly visibility?: ClassMemberVisibility;
  readonly getter?: true | Function;
  readonly setter?: true | Function;
  readonly noConstructor?: true;
}

export interface ClassMethodMemberDescriptor {
  readonly kind: "method";
  readonly schema: ATS.AnyTypeSchema;
  readonly visibility?: ClassMemberVisibility;
  readonly implementation?: Function;
  readonly async?: boolean;
}

export interface ClassAccessorMemberDescriptor {
  readonly kind: "accessor";
  /** Schema source for a persisted field-backed accessor. */
  readonly schema?: SchemaInput<ATS.AnyTypeSchema>;
  readonly visibility?: ClassMemberVisibility;
  readonly getter?: true | Function;
  readonly setter?: true | Function;
}

export interface ClassFactoryMemberDescriptor {
  readonly kind: "factory";
  readonly name: string;
  readonly implementation: Function;
  readonly phase: "create" | "hydrate";
}

export interface ClassFactoryContext<TInstance = unknown> {
  readonly construct: (state: unknown) => TInstance;
}

export type ClassMemberDefinition =
  | ClassFieldMemberDescriptor
  | ClassMethodMemberDescriptor
  | ClassAccessorMemberDescriptor
  | ClassFactoryMemberDescriptor;

export interface ClassMemberDescriptor<TDefinition extends ClassMemberDefinition = ClassMemberDefinition> {
  readonly [CLASS_MEMBER_DESCRIPTOR]: true;
  readonly definition: TDefinition;
}

type DefinitionOf<TValue> = TValue extends ClassMemberDescriptor<infer TDefinition> ? TDefinition : never;
type SchemaInputOf<TValue> =
  TValue extends SchemaInput<ATS.AnyTypeSchema>
    ? TValue
    : DefinitionOf<TValue> extends infer TDefinition
      ? TDefinition extends {
          readonly kind: "field" | "accessor";
          readonly schema: infer TSchema extends SchemaInput<ATS.AnyTypeSchema>;
        }
        ? TSchema
        : never
      : never;
type GetterOf<TValue> =
  TValue extends ClassMemberDescriptor<infer TDefinition>
    ? TDefinition extends { readonly getter: infer TGetter }
      ? TGetter
      : never
    : never;
type SetterOf<TValue> =
  TValue extends ClassMemberDescriptor<infer TDefinition>
    ? TDefinition extends { readonly setter: infer TSetter }
      ? TSetter
      : never
    : never;
type NoConstructorOf<TValue> =
  TValue extends ClassMemberDescriptor<infer TDefinition>
    ? TDefinition extends { readonly noConstructor: true }
      ? true
      : never
    : never;
type AccessorParts<TValues> = ([GetterOf<TValues>] extends [never] ? {} : { readonly getter: GetterOf<TValues> }) &
  ([SetterOf<TValues>] extends [never] ? {} : { readonly setter: SetterOf<TValues> }) &
  ([true] extends [NoConstructorOf<TValues>] ? { readonly noConstructor: true } : {});
type MergedDefinition<
  TValue,
  TMembers extends readonly ClassMemberDescriptor[],
  TVisibility extends ClassMemberVisibility,
> =
  DefinitionOf<TValue | TMembers[number]> extends infer TDefinitions
    ? Extract<TDefinitions, { readonly kind: "method" }> extends infer TMethod
      ? [TMethod] extends [never]
        ? [SchemaInputOf<TValue | TMembers[number]>] extends [never]
          ? {
              readonly kind: "accessor";
              readonly visibility: TVisibility;
            } & AccessorParts<TValue | TMembers[number]>
          : {
              readonly kind: "field";
              readonly schema: SchemaInputOf<TValue | TMembers[number]>;
              readonly visibility: TVisibility;
            } & AccessorParts<TValue | TMembers[number]>
        : TMethod & { readonly visibility: TVisibility }
      : never
    : never;

export type ClassMethodInput = SchemaInput<ATS.AnyTypeSchema>;

export interface ClassMethodOptions<
  TInput extends readonly ClassMethodInput[],
  TOutput extends ClassMethodInput | undefined = undefined,
> {
  readonly input: TInput;
  readonly output?: TOutput;
}

type UnwrapInput<TInput extends readonly ClassMethodInput[]> = {
  readonly [TKey in keyof TInput]: TInput[TKey] extends SchemaInput<infer TSchema extends ATS.AnyTypeSchema>
    ? TSchema
    : never;
};

type UnwrapOutput<TOutput extends ClassMethodInput | undefined> =
  TOutput extends SchemaInput<infer TSchema extends ATS.AnyTypeSchema> ? TSchema : undefined;

export interface ClassMethodBuilder<
  TInput extends readonly ClassMethodInput[],
  TOutput extends ClassMethodInput | undefined = undefined,
> {
  implement<
    TImplementation extends (
      ...args: ATS.FunctionArgs<UnwrapInput<TInput>>
    ) => ATS.FunctionReturn<UnwrapOutput<TOutput>>,
  >(
    implementation: TImplementation
  ): ClassMemberDescriptor<
    ClassMethodMemberDescriptor & {
      readonly schema: ATS.AnyTypeSchema;
      readonly implementation: TImplementation;
      readonly async: false;
    }
  >;
  implementAsync<
    TImplementation extends (
      ...args: ATS.FunctionArgs<UnwrapInput<TInput>>
    ) => PromiseLike<ATS.FunctionReturn<UnwrapOutput<TOutput>>>,
  >(
    implementation: TImplementation
  ): ClassMemberDescriptor<
    ClassMethodMemberDescriptor & {
      readonly schema: ATS.AnyTypeSchema;
      readonly implementation: TImplementation;
      readonly async: true;
    }
  >;
}

export function isClassMemberDescriptor(value: unknown): value is ClassMemberDescriptor {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly [CLASS_MEMBER_DESCRIPTOR]?: unknown })[CLASS_MEMBER_DESCRIPTOR] === true
  );
}

function descriptor<TDefinition extends ClassMemberDefinition>(
  definition: TDefinition
): ClassMemberDescriptor<TDefinition> {
  return Object.freeze({
    [CLASS_MEMBER_DESCRIPTOR]: true,
    definition,
  }) as ClassMemberDescriptor<TDefinition>;
}

function mergeDefinitions(
  values: readonly (SchemaInput<ATS.AnyTypeSchema> | ClassMemberDescriptor)[],
  visibility?: ClassMemberVisibility
): ClassMemberDescriptor {
  let schema: SchemaInput<ATS.AnyTypeSchema> | undefined;
  let getter: true | Function | undefined;
  let setter: true | Function | undefined;
  let noConstructor: true | undefined;
  let method: ClassMethodMemberDescriptor | undefined;
  let nestedVisibility: ClassMemberVisibility | undefined;

  for (const value of values) {
    if (isClassMemberDescriptor(value)) {
      const definition = value.definition;
      if (definition.kind === "factory") {
        throw new JITError("CLASS_FIELD_DESCRIPTOR_CONFLICT", "Factory descriptors cannot be used as member modifiers");
      }
      const definitionVisibility = "visibility" in definition ? definition.visibility : undefined;
      if (definitionVisibility !== undefined) {
        if (nestedVisibility !== undefined && nestedVisibility !== definitionVisibility) {
          throw new JITError("CLASS_FIELD_DESCRIPTOR_CONFLICT", "A class member cannot be both public and hidden");
        }
        nestedVisibility = definitionVisibility;
      }
      if (definition.kind === "method") {
        if (method !== undefined || schema !== undefined || getter !== undefined || setter !== undefined) {
          throw new JITError(
            "CLASS_MEMBER_ALREADY_EXISTS",
            "A member descriptor cannot combine methods with fields or accessors"
          );
        }
        method = definition;
      }
      if (definition.kind === "field" || definition.kind === "accessor") {
        const nextSchema = definition.schema;
        if (nextSchema !== undefined && schema !== undefined) {
          throw new JITError("CLASS_FIELD_DESCRIPTOR_CONFLICT", "A member descriptor cannot declare two schemas");
        }
        schema ??= nextSchema;
        if (definition.getter !== undefined) {
          if (getter !== undefined)
            throw new JITError("CLASS_ACCESSOR_CONFLICT", "A member descriptor cannot declare two getters");
          getter = definition.getter;
        }
        if (definition.setter !== undefined) {
          if (setter !== undefined)
            throw new JITError("CLASS_ACCESSOR_CONFLICT", "A member descriptor cannot declare two setters");
          setter = definition.setter;
        }
        noConstructor ??= definition.kind === "field" ? definition.noConstructor : undefined;
      }
      continue;
    }
    if (schema !== undefined) {
      throw new JITError("CLASS_FIELD_DESCRIPTOR_CONFLICT", "A member descriptor cannot declare two schemas");
    }
    schema ??= value;
  }

  if (visibility !== undefined && nestedVisibility !== undefined && visibility !== nestedVisibility) {
    throw new JITError("CLASS_FIELD_DESCRIPTOR_CONFLICT", "A class member cannot be both public and hidden");
  }
  if (method !== undefined) {
    const resolvedVisibility = visibility ?? nestedVisibility;
    return descriptor({
      ...method,
      ...(resolvedVisibility === undefined ? {} : { visibility: resolvedVisibility }),
    });
  }
  const resolvedVisibility = visibility ?? nestedVisibility;
  return descriptor({
    kind: schema === undefined ? "accessor" : "field",
    ...(schema === undefined ? {} : { schema }),
    ...(resolvedVisibility === undefined ? {} : { visibility: resolvedVisibility }),
    ...(getter === undefined ? {} : { getter }),
    ...(setter === undefined ? {} : { setter }),
    ...(noConstructor === undefined ? {} : { noConstructor }),
  } as ClassFieldMemberDescriptor | ClassAccessorMemberDescriptor);
}

export function classPublic<
  TValue extends SchemaInput<ATS.AnyTypeSchema> | ClassMemberDescriptor,
  const TMembers extends readonly ClassMemberDescriptor[],
>(value: TValue, ...members: TMembers): ClassMemberDescriptor<MergedDefinition<TValue, TMembers, "public">>;
export function classPublic<const TMembers extends readonly ClassMemberDescriptor[]>(
  ...members: TMembers
): ClassMemberDescriptor<MergedDefinition<undefined, TMembers, "public">>;
export function classPublic(
  value?: SchemaInput<ATS.AnyTypeSchema> | ClassMemberDescriptor,
  ...members: readonly ClassMemberDescriptor[]
): ClassMemberDescriptor {
  return mergeDefinitions(value === undefined ? members : [value, ...members], "public");
}

export function classProtected<
  TValue extends SchemaInput<ATS.AnyTypeSchema> | ClassMemberDescriptor,
  const TMembers extends readonly ClassMemberDescriptor[],
>(value: TValue, ...members: TMembers): ClassMemberDescriptor<MergedDefinition<TValue, TMembers, "protected">>;
export function classProtected<const TMembers extends readonly ClassMemberDescriptor[]>(
  ...members: TMembers
): ClassMemberDescriptor<MergedDefinition<undefined, TMembers, "protected">>;
export function classProtected(
  value?: SchemaInput<ATS.AnyTypeSchema> | ClassMemberDescriptor,
  ...members: readonly ClassMemberDescriptor[]
): ClassMemberDescriptor {
  return mergeDefinitions(value === undefined ? members : [value, ...members], "protected");
}

export function classPrivate<
  TValue extends SchemaInput<ATS.AnyTypeSchema> | ClassMemberDescriptor,
  const TMembers extends readonly ClassMemberDescriptor[],
>(value: TValue, ...members: TMembers): ClassMemberDescriptor<MergedDefinition<TValue, TMembers, "private">>;
export function classPrivate<const TMembers extends readonly ClassMemberDescriptor[]>(
  ...members: TMembers
): ClassMemberDescriptor<MergedDefinition<undefined, TMembers, "private">>;
export function classPrivate(
  value?: SchemaInput<ATS.AnyTypeSchema> | ClassMemberDescriptor,
  ...members: readonly ClassMemberDescriptor[]
): ClassMemberDescriptor {
  return mergeDefinitions(value === undefined ? members : [value, ...members], "private");
}

export function classGetter<TSchema extends SchemaInput<ATS.AnyTypeSchema>>(
  schema: TSchema
): ClassMemberDescriptor<{ readonly kind: "accessor"; readonly schema: TSchema; readonly getter: true }>;
export function classGetter<TImplementation extends Function>(
  implementation: TImplementation
): ClassMemberDescriptor<{ readonly kind: "accessor"; readonly getter: TImplementation }>;
export function classGetter(): ClassMemberDescriptor<{ readonly kind: "accessor"; readonly getter: true }>;
export function classGetter(schemaOrImplementation?: SchemaInput<ATS.AnyTypeSchema> | Function): ClassMemberDescriptor {
  if (typeof schemaOrImplementation === "function")
    return descriptor({ kind: "accessor", getter: schemaOrImplementation });
  return descriptor({
    kind: "accessor",
    ...(schemaOrImplementation === undefined ? {} : { schema: schemaOrImplementation }),
    getter: true,
  });
}

export function classSetter<TImplementation extends Function>(
  implementation: TImplementation
): ClassMemberDescriptor<{ readonly kind: "accessor"; readonly setter: TImplementation }>;
export function classSetter(): ClassMemberDescriptor<{ readonly kind: "accessor"; readonly setter: true }>;
export function classSetter(implementation?: Function): ClassMemberDescriptor {
  return descriptor({ kind: "accessor", setter: implementation ?? true });
}

type NoConstructorDefinition<TValue> =
  TValue extends ClassMemberDescriptor<infer TDefinition>
    ? TDefinition extends ClassFieldMemberDescriptor
      ? Omit<TDefinition, "noConstructor"> & { readonly kind: "field"; readonly noConstructor: true }
      : never
    : {
        readonly kind: "field";
        readonly schema: TValue;
        readonly noConstructor: true;
      };

export function classNoConstructor<TValue extends SchemaInput<ATS.AnyTypeSchema>>(
  value: TValue
): ClassMemberDescriptor<NoConstructorDefinition<TValue>>;
export function classNoConstructor<TDefinition extends ClassFieldMemberDescriptor>(
  value: ClassMemberDescriptor<TDefinition>
): ClassMemberDescriptor<NoConstructorDefinition<ClassMemberDescriptor<TDefinition>>>;
export function classNoConstructor(
  value: SchemaInput<ATS.AnyTypeSchema> | ClassMemberDescriptor<ClassFieldMemberDescriptor>
): ClassMemberDescriptor {
  const merged = mergeDefinitions([value]);
  const definition = merged.definition;
  if (definition.kind === "method" || definition.kind === "factory" || definition.kind === "accessor") {
    throw new JITError("CLASS_FIELD_DESCRIPTOR_CONFLICT", "noConstructor() requires a schema field");
  }
  return descriptor({
    ...definition,
    kind: "field",
    noConstructor: true,
  } as ClassFieldMemberDescriptor);
}

export function classMethod<
  const TInput extends readonly ClassMethodInput[],
  TOutput extends ClassMethodInput | undefined = undefined,
>(options: ClassMethodOptions<TInput, TOutput>): ClassMethodBuilder<TInput, TOutput> {
  const input = options.input.map((item) => unwrapSchema(item)) as unknown as UnwrapInput<TInput>;
  const output = (options.output === undefined ? undefined : unwrapSchema(options.output)) as UnwrapOutput<TOutput>;
  const args = createSchema(TypeName.tuple, { items: input, rest: undefined }) as ATS.TupleSchema<UnwrapInput<TInput>>;
  const schema = createSchema(TypeName.function, { input, output, args }) as ATS.FunctionSchema<
    UnwrapInput<TInput>,
    UnwrapOutput<TOutput>
  >;

  return {
    implement(implementation: Function) {
      return descriptor({ kind: "method", schema, implementation, async: false });
    },
    implementAsync(implementation: Function) {
      return descriptor({ kind: "method", schema, implementation, async: true });
    },
  } as ClassMethodBuilder<TInput, TOutput>;
}

export function classFactory<TData = unknown, TInstance = unknown>(
  name: string,
  implementation: (data: TData, context: ClassFactoryContext<TInstance>) => unknown,
  phase?: "create" | "hydrate"
): ClassMemberDescriptor<ClassFactoryMemberDescriptor>;
export function classFactory(
  name: string,
  implementation: Function,
  phase: "create" | "hydrate" = "create"
): ClassMemberDescriptor<ClassFactoryMemberDescriptor> {
  return descriptor({ kind: "factory", name, implementation, phase });
}
