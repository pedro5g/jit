import { resolveEffectiveObjectSchema } from "../classes/effective-schema.js";
import type { ClassMemberVisibility } from "../classes/member-descriptors.js";
import { emitPropertyAccess } from "../compiler/source/access.js";
import { compileValidator } from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import type { AccessorMember, AccessorOptions, AccessorVisibility, ConstructionMode } from "./class.js";

export const INTERNAL_CONSTRUCT = Symbol("jit.class.construct");
export const DOMAIN_STATE = Symbol("jit.class.domainState");
export const EVENT_BUFFER = Symbol("jit.class.events");
export const TRUSTED_MATERIALIZER = "__jitMaterialize";

export interface ResolvedAccessor {
  readonly key: string;
  readonly field: AccessorVisibility;
  readonly get: string | false;
  readonly set: string | false;
}

export type ResolvedAccessors = readonly ResolvedAccessor[];

export interface ClassFieldPolicy {
  readonly visibility: ClassMemberVisibility;
  readonly getter: true | false | Function;
  readonly setter: true | false | Function;
  readonly noConstructor: boolean;
}

export interface ManagedStorageBinding {
  readonly name: string;
  readonly value: symbol;
}

interface ClassLayoutPlan {
  readonly properties: readonly string[];
  readonly accessors: ResolvedAccessors | undefined;
  readonly managedStorage: ReadonlyMap<string, ManagedStorageBinding>;
  readonly domainState: ManagedStorageBinding | undefined;
  readonly fieldPolicies: ReadonlyMap<string, ClassFieldPolicy>;
  readonly encapsulateFields: boolean;
  readonly initializers: ReadonlyMap<string, () => unknown>;
}

export function createClassLayoutPlan(
  properties: readonly string[],
  accessors: ResolvedAccessors | undefined,
  managedStorage: ReadonlyMap<string, ManagedStorageBinding>,
  fieldPolicies: ReadonlyMap<string, ClassFieldPolicy>,
  encapsulateFields: boolean,
  initializers: ReadonlyMap<string, () => unknown>
): ClassLayoutPlan {
  return Object.freeze({
    properties: Object.freeze([...properties]),
    accessors,
    managedStorage,
    domainState: encapsulateFields ? { name: "__domainState", value: DOMAIN_STATE } : undefined,
    fieldPolicies,
    encapsulateFields,
    initializers,
  });
}

/**
 * Installs the internal validation ABI used by nested Runtime Type emitters.
 * Validated nested state is written into the final instance directly, so the
 * common hydrate path does not create a plain state object and copy it again
 * through the public constructor. Layouts that use a native private slot keep
 * the constructor fallback because JavaScript does not allow an external
 * function to initialize that slot.
 */
export function installTrustedMaterializer(
  classTarget: Function,
  layout: ClassLayoutPlan,
  freezeInstances: boolean,
  aggregate: boolean,
  materializerKey: string
): void {
  const accessorByKey = new Map(layout.accessors?.map((accessor) => [accessor.key, accessor]));
  const domainState = layout.domainState;
  const hasNativePrivateSlot = layout.properties.some(
    (property) => accessorByKey.get(property)?.field === "private" && !layout.managedStorage.has(property)
  );
  const materialize = function materialize(this: Function, state: unknown): unknown {
    if (hasNativePrivateSlot) {
      return new (this as new (input: unknown, token: symbol, validated: boolean) => unknown)(
        state,
        INTERNAL_CONSTRUCT,
        true
      );
    }
    const instance = Object.create(this.prototype) as Record<PropertyKey, unknown>;
    const input = state as Record<string, unknown>;
    if (domainState !== undefined) {
      for (const property of layout.properties) {
        const initializer = layout.initializers.get(property);
        if (input[property] === undefined && initializer !== undefined) input[property] = initializer();
      }
      instance[domainState.value] = input;
      if (aggregate) {
        Object.defineProperty(instance, EVENT_BUFFER, {
          configurable: false,
          enumerable: false,
          value: [],
          writable: true,
        });
      }
      return freezeInstances ? Object.freeze(instance) : instance;
    }
    for (const property of layout.properties) {
      const initializer = layout.initializers.get(property);
      const value = input[property] === undefined && initializer !== undefined ? initializer() : input[property];
      const managed = layout.managedStorage.get(property);
      if (managed === undefined) instance[property] = value;
      else instance[managed.value] = value;
    }
    if (aggregate)
      Object.defineProperty(instance, EVENT_BUFFER, {
        configurable: false,
        enumerable: false,
        value: [],
        writable: true,
      });
    return freezeInstances ? Object.freeze(instance) : instance;
  };
  Object.defineProperty(classTarget, materializerKey, {
    configurable: false,
    enumerable: false,
    value: materialize,
  });
}

export function emitConstructor(
  layout: ClassLayoutPlan,
  freezeInstances: boolean,
  aggregate: boolean,
  parse: (input: unknown) => unknown,
  construction: { mode: ConstructionMode }
): unknown {
  const { properties, accessors, managedStorage, domainState, fieldPolicies, initializers } = layout;
  const accessorByKey = new Map(accessors?.map((accessor) => [accessor.key, accessor]));
  const initializerEntries = [...initializers.entries()];
  const initializerBindings = new Map(initializerEntries.map(([field], index) => [field, `__init${index}`] as const));
  const parts =
    domainState === undefined
      ? emitFieldAssignments(
          properties,
          accessorByKey,
          managedStorage,
          fieldPolicies,
          initializers,
          initializerBindings
        )
      : emitDomainAssignments(properties, fieldPolicies, initializerBindings);
  const state = domainState === undefined ? "" : " this[__state] = state;";
  const events = aggregate
    ? " Object.defineProperty(this, __events, { configurable: false, enumerable: false, value: [], writable: true });"
    : "";
  const storageEntries = [...managedStorage.values()];
  const storageNames = storageEntries.map((entry) => entry.name);
  const storageValues = storageEntries.map((entry) => entry.value);
  const initializerNames = initializerEntries.map(([field]) => initializerBindings.get(field) as string);
  const initializerValues = initializerEntries.map(([, initializer]) => initializer);
  const source = `return class JITRuntimeClass { ${parts.slots.map((slot) => `${slot};`).join(" ")} constructor(input, token, validated) { if (__construction.mode === "factory" && token !== __construct && token !== true) throw new Error("This Runtime Type uses factory construction; call its create() or hydrate() factory"); const state = token === true || validated === true ? input : __parse(input); ${parts.assignments.join(" ")}${state}${events}${freezeInstances ? " Object.freeze(this);" : ""} } ${parts.definitions.join(" ")} };`;

  return globalThis.Function(
    ...storageNames,
    ...initializerNames,
    "__parse",
    "__construct",
    "__construction",
    ...(domainState === undefined ? [] : ["__state"]),
    ...(aggregate ? ["__events"] : []),
    source
  )(
    ...storageValues,
    ...initializerValues,
    parse,
    INTERNAL_CONSTRUCT,
    construction,
    ...(domainState === undefined ? [] : [domainState.value]),
    ...(aggregate ? [EVENT_BUFFER] : [])
  );
}

interface ConstructorParts {
  readonly slots: readonly string[];
  readonly definitions: readonly string[];
  readonly assignments: readonly string[];
}

function emitDomainAssignments(
  properties: readonly string[],
  fieldPolicies: ReadonlyMap<string, ClassFieldPolicy>,
  initializerBindings: ReadonlyMap<string, string>
): ConstructorParts {
  const definitions = [`get _props() { return this[__state]; }`];
  for (const property of properties) {
    const policy = fieldPolicies.get(property);
    if (policy === undefined || policy.getter === true) {
      definitions.push(`get [${JSON.stringify(property)}]() { return this[__state][${JSON.stringify(property)}]; }`);
    }
    if (policy?.setter === true) {
      definitions.push(
        `set [${JSON.stringify(property)}](value) { this[__state][${JSON.stringify(property)}] = value; }`
      );
    }
  }
  const assignments = properties.map((property) => {
    const initializer = initializerBindings.get(property);
    if (initializer === undefined) return "";
    const access = emitPropertyAccess("", property);
    const value = `(state${access} === undefined ? ${initializer}() : state${access})`;
    return `state${access} = ${value};`;
  });
  return { slots: [], definitions, assignments };
}

function emitFieldAssignments(
  properties: readonly string[],
  accessorByKey: ReadonlyMap<string, ResolvedAccessor>,
  managedStorage: ReadonlyMap<string, ManagedStorageBinding>,
  fieldPolicies: ReadonlyMap<string, ClassFieldPolicy>,
  initializers: ReadonlyMap<string, () => unknown>,
  initializerBindings: ReadonlyMap<string, string>
): ConstructorParts {
  const slots: string[] = [];
  const definitions: string[] = [];
  let slotIndex = 0;
  const assignments = properties.map((property) => {
    const accessor = accessorByKey.get(property);
    const managed = managedStorage.get(property);
    if (managed !== undefined) {
      const policy = fieldPolicies.get(property);
      const getter = policy?.getter === true || (policy === undefined && accessor?.field !== "private");
      const setter = policy?.setter === true;
      if (getter) definitions.push(`get [${JSON.stringify(property)}]() { return this[${managed.name}]; }`);
      if (setter) definitions.push(`set [${JSON.stringify(property)}](value) { this[${managed.name}] = value; }`);
      const initializer = initializerBindings.get(property);
      const access = emitPropertyAccess("", property);
      const value =
        initializer === undefined
          ? `state${access}`
          : `(state${access} === undefined ? ${initializer}() : state${access})`;
      return `this[${managed.name}] = ${value};`;
    }
    if (accessor?.field !== "private") {
      const initializer = initializers.get(property);
      const access = emitPropertyAccess("", property);
      return initializer === undefined
        ? `this${access} = state${access};`
        : `this${access} = state${access} === undefined ? ${initializerBindings.get(property)}() : state${access};`;
    }
    const slot = `#p${slotIndex++}`;
    slots.push(slot);
    if (accessor.get !== false) definitions.push(`get [${JSON.stringify(accessor.get)}]() { return this.${slot}; }`);
    if (accessor.set !== false)
      definitions.push(`set [${JSON.stringify(accessor.set)}](value) { this.${slot} = value; }`);
    const initializer = initializers.get(property);
    const access = emitPropertyAccess("", property);
    return initializer === undefined
      ? `this.${slot} = state${access};`
      : `this.${slot} = state${access} === undefined ? ${initializerBindings.get(property)}() : state${access};`;
  });
  return { slots, definitions, assignments };
}

export function resolveManagedStorage(
  properties: readonly string[],
  _accessors: ResolvedAccessors | undefined,
  managedFields: readonly { readonly field: string }[],
  encapsulateFields: boolean,
  fieldPolicies: ReadonlyMap<string, ClassFieldPolicy>
): ReadonlyMap<string, ManagedStorageBinding> {
  const storage = new Map<string, ManagedStorageBinding>();
  if (encapsulateFields) return storage;
  let index = 0;
  for (const field of properties) {
    const managed = managedFields.some((item) => item.field === field);
    const policy = fieldPolicies.get(field);
    const needsAccessorStorage =
      policy !== undefined &&
      (policy.visibility !== "public" || policy.getter !== false || policy.setter !== false || policy.noConstructor);
    if (!managed && !encapsulateFields && !needsAccessorStorage) continue;
    storage.set(field, { name: `__managed${index++}`, value: Symbol(`jit.${field}`) });
  }
  return storage;
}

export function removeNoConstructorFields(
  schema: ATS.AnyTypeSchema,
  policies: ReadonlyMap<string, ClassFieldPolicy>
): ATS.AnyTypeSchema {
  const noConstructor = new Set(
    [...policies.entries()].filter(([, policy]) => policy.noConstructor).map(([field]) => field)
  );
  if (noConstructor.size === 0) return schema;
  const object = resolveEffectiveObjectSchema(schema);
  const props = Object.fromEntries(Object.entries(object.def.props).filter(([field]) => !noConstructor.has(field)));
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

export function compileNoConstructorInitializers(
  schema: ATS.AnyTypeSchema,
  policies: ReadonlyMap<string, ClassFieldPolicy>
): ReadonlyMap<string, () => unknown> {
  const object = resolveEffectiveObjectSchema(schema);
  const initializers = new Map<string, () => unknown>();
  for (const [field, policy] of policies) {
    if (!policy.noConstructor) continue;
    const fieldSchema = object.def.props[field];
    if (fieldSchema === undefined) continue;
    const parse = compileValidator(fieldSchema).parse;
    initializers.set(field, () => parse(undefined));
  }
  return initializers;
}

export function installFieldDescriptorAccessors(
  classTarget: Function,
  policies: ReadonlyMap<string, ClassFieldPolicy>
): void {
  for (const [name, policy] of policies) {
    const previous = Object.getOwnPropertyDescriptor(classTarget.prototype, name) ?? {
      configurable: true,
      enumerable: false,
    };
    const next: PropertyDescriptor = { ...previous };
    if (typeof policy.getter === "function") next.get = policy.getter as () => unknown;
    if (typeof policy.setter === "function") next.set = policy.setter as (value: unknown) => void;
    if (typeof policy.getter === "function" || typeof policy.setter === "function") {
      Object.defineProperty(classTarget.prototype, name, next);
    }
  }
}

export function resolveAccessors<TSchema extends ATS.AnyTypeSchema>(
  properties: readonly string[],
  options: AccessorOptions<TSchema>
): ResolvedAccessors {
  return properties.map((key) => {
    const configured = {
      ...options.default,
      ...options.fields?.[key as Extract<keyof ATS.TypeofSchema<TSchema>, string>],
    };
    const get = resolveAccessorMember(key, configured.get);
    const set = resolveAccessorMember(key, configured.set);

    if (configured.field === "private" && get === false && set === false) {
      throw new JITError("INVALID_OPERATION", `Private field ${JSON.stringify(key)} must expose a getter or setter`);
    }
    return { key, field: configured.field ?? "public", get, set };
  });
}

function resolveAccessorMember(key: string, member: AccessorVisibility | AccessorMember | undefined): string | false {
  if (member === undefined) return key;
  if (member === false) return false;
  return typeof member === "string" ? key : (member.name ?? key);
}
