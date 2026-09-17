import { buildCloneIR } from "../compiler/clone/build-clone-ir.js";
import { emitCloneBodyWithBindings } from "../compiler/clone/emit-clone.js";
import { emitDiffMethodBody } from "../compiler/diff.js";
import { emitEqualMethodBody, emitEqualSource } from "../compiler/equal.js";
import { emitSerialize } from "../compiler/serialize/emit-serialize.js";
import { emitUpdateSource } from "../compiler/update.js";
import type * as ATS from "../core/ats/index.js";
import { emitClassLifecycleMembers } from "./emit-class-lifecycle.js";
import type { ClassArtifactSetup } from "./emit-class-setup.js";
import type { ClassArtifact, ClassArtifactEmitContext } from "./emit-class-types.js";

type ClassFieldPolicy = NonNullable<ClassArtifact["fieldPolicies"]>[number];
type ClassAccessor = NonNullable<ClassArtifact["accessors"]>[number];

export interface ClassArtifactStorage {
  readonly fields: readonly string[];
  readonly managedFieldNames: ReadonlySet<string>;
  readonly fieldPolicies: ReadonlyMap<string, ClassFieldPolicy>;
  readonly noConstructorFields: readonly string[];
  readonly boundaryInputName: string | undefined;
  readonly creationInput: string;
  readonly hydrationInput: string;
  readonly managedStorage: ReadonlyMap<string, string>;
  readonly domainStateKey: string | undefined;
  readonly eventBufferKey: string | undefined;
  readonly accessorByKey: ReadonlyMap<string, ClassAccessor | undefined>;
  readonly slots: ReadonlyMap<string, string>;
  readonly fieldInitializers: ReadonlyMap<string, string>;
  readonly readField: (field: string) => string;
  readonly writeField: (field: string, value: string) => string;
}

export interface ClassMembers {
  readonly helpers: readonly string[];
  readonly methods: readonly string[];
  readonly accessorDefinitions: readonly string[];
}

/** Resolves storage slots and boundary-specific field materializers for a class. */
export function createClassStorage(
  context: ClassArtifactEmitContext,
  setup: ClassArtifactSetup,
  binding: string,
  reportName: string
): ClassArtifactStorage | undefined {
  const { artifact, base, hasDomainState } = setup;
  const fields = classFields(setup);
  const managedFieldNames = classManagedFieldNames(artifact);
  const fieldPolicies = classFieldPolicies(artifact);
  const noConstructorFields = classNoConstructorFields(fieldPolicies);
  const boundaryInputName =
    noConstructorFields.length === 0 ? undefined : context.internalIdentifier(`${binding}_withoutGenerated`);
  const creationInput = boundaryInputName === undefined ? "input" : `${boundaryInputName}(input)`;
  const hydrationInput = boundaryInputName === undefined ? "state" : `${boundaryInputName}(state)`;
  const managedStorage = classManagedStorage(fields, managedFieldNames, fieldPolicies, hasDomainState);
  const domainStateKey = hasDomainState ? context.internalIdentifier(`${binding}_state`) : undefined;
  const eventBufferKey = artifact.aggregate ? context.internalIdentifier(`${binding}_events`) : undefined;
  const accessorByKey = classAccessorsByKey(artifact);
  const slots = classPrivateSlots(fields, accessorByKey, domainStateKey, managedStorage);
  const fieldInitializers = emitClassInitializers(context, artifact, base, fields, fieldPolicies, binding, reportName);
  if (fieldInitializers === undefined) return undefined;
  const readField = classReadField(domainStateKey, managedStorage, slots);
  const writeField = classWriteField(readField, domainStateKey, managedStorage, managedFieldNames);

  return {
    fields,
    managedFieldNames,
    fieldPolicies,
    noConstructorFields,
    boundaryInputName,
    creationInput,
    hydrationInput,
    managedStorage,
    domainStateKey,
    eventBufferKey,
    accessorByKey,
    slots,
    fieldInitializers,
    readField,
    writeField,
  };
}

function classFields(setup: ClassArtifactSetup): readonly string[] {
  return setup.valueRepresentation ? ["value"] : Object.keys((setup.base as ATS.ObjectSchema).def.props);
}

function classManagedFieldNames(artifact: ClassArtifact): ReadonlySet<string> {
  return new Set((artifact.managedFields ?? []).map((managed) => managed.field));
}

function classFieldPolicies(artifact: ClassArtifact): ReadonlyMap<string, ClassFieldPolicy> {
  return new Map((artifact.fieldPolicies ?? []).map((policy) => [policy.name, policy] as const));
}

function classNoConstructorFields(fieldPolicies: ReadonlyMap<string, ClassFieldPolicy>): readonly string[] {
  return [...fieldPolicies.values()].filter((policy) => policy.noConstructor).map((policy) => policy.name);
}

function classManagedStorage(
  fields: readonly string[],
  managedFieldNames: ReadonlySet<string>,
  fieldPolicies: ReadonlyMap<string, ClassFieldPolicy>,
  hasDomainState: boolean
): ReadonlyMap<string, string> {
  return new Map(
    fields
      .filter((field) => !hasDomainState && (managedFieldNames.has(field) || fieldPolicies.has(field)))
      .map((field, index) => [field, `__managed${index}`] as const)
  );
}

function classAccessorsByKey(artifact: ClassArtifact): ReadonlyMap<string, ClassAccessor | undefined> {
  return new Map(artifact.accessors?.map((accessor) => [accessor.key, accessor]));
}

function classPrivateSlots(
  fields: readonly string[],
  accessorByKey: ReadonlyMap<string, ClassAccessor | undefined>,
  domainStateKey: string | undefined,
  managedStorage: ReadonlyMap<string, string>
): ReadonlyMap<string, string> {
  const slots = new Map<string, string>();
  let slotIndex = 0;
  for (const field of fields) {
    if (domainStateKey === undefined && accessorByKey.get(field)?.field === "private" && !managedStorage.has(field))
      slots.set(field, `#p${slotIndex++}`);
  }
  return slots;
}

function emitClassInitializers(
  context: ClassArtifactEmitContext,
  artifact: ClassArtifact,
  base: ATS.ObjectSchema | undefined,
  fields: readonly string[],
  fieldPolicies: ReadonlyMap<string, ClassFieldPolicy>,
  binding: string,
  reportName: string
): ReadonlyMap<string, string> | undefined {
  const initializers = new Map<string, string>();
  for (const field of fields) {
    if (fieldPolicies.get(field)?.noConstructor !== true) continue;
    const fieldSchema = base?.def.props[field] ?? artifact.schema;
    const initializer = context.emitValidatorBinding(
      `${binding}_initializer_${field}`,
      fieldSchema,
      reportName,
      "class.noConstructor",
      { is: false, safeParse: true }
    );
    if (!initializer) return undefined;
    initializers.set(field, initializer);
  }
  return initializers;
}

function classReadField(
  domainStateKey: string | undefined,
  managedStorage: ReadonlyMap<string, string>,
  slots: ReadonlyMap<string, string>
): (field: string) => string {
  return (field: string): string => {
    if (domainStateKey !== undefined) return `this[${domainStateKey}][${JSON.stringify(field)}]`;
    const managed = managedStorage.get(field);
    if (managed !== undefined) return `this[${managed}]`;
    const slot = slots.get(field);
    return slot ? `this.${slot}` : `this[${JSON.stringify(field)}]`;
  };
}

function classWriteField(
  readField: (field: string) => string,
  domainStateKey: string | undefined,
  managedStorage: ReadonlyMap<string, string>,
  managedFieldNames: ReadonlySet<string>
): (field: string, value: string) => string {
  return (field: string, value: string): string =>
    domainStateKey !== undefined
      ? `${readField(field)} = ${value};`
      : managedStorage.has(field)
        ? `${readField(field)} = ${value};`
        : managedFieldNames.has(field)
          ? `Object.defineProperty(this, ${JSON.stringify(field)}, { value: ${value}, writable: false, enumerable: true, configurable: true });`
          : `${readField(field)} = ${value};`;
}

/** Emits prototype accessors, capabilities and lifecycle methods for a class. */
export function emitClassMembers(
  context: ClassArtifactEmitContext,
  setup: ClassArtifactSetup,
  storage: ClassArtifactStorage,
  binding: string,
  reportName: string
): ClassMembers | undefined {
  const fieldMembers = emitClassFieldMembers(setup, storage);
  const capabilities = new Set(setup.artifact.capabilities);
  const capabilityMembers = emitClassCapabilities(context, setup, capabilities, binding, reportName);
  if (capabilityMembers === undefined) return undefined;
  const methods = [
    ...fieldMembers.methods,
    ...capabilityMembers.methods,
    ...emitClassLifecycleMembers(context, setup, storage),
  ];
  return {
    helpers: capabilityMembers.helpers,
    methods,
    accessorDefinitions: fieldMembers.accessorDefinitions,
  };
}

interface ClassFieldMembers {
  readonly methods: readonly string[];
  readonly accessorDefinitions: readonly string[];
}

function emitClassFieldMembers(setup: ClassArtifactSetup, storage: ClassArtifactStorage): ClassFieldMembers {
  return {
    accessorDefinitions: emitPrivateAccessorDefinitions(setup.artifact, storage),
    methods: emitFieldAccessorMethods(setup, storage),
  };
}

function emitPrivateAccessorDefinitions(artifact: ClassArtifact, storage: ClassArtifactStorage): readonly string[] {
  return (artifact.accessors ?? [])
    .filter((accessor) => accessor.field === "private")
    .flatMap((accessor) => privateAccessorDefinitions(accessor, storage));
}

function privateAccessorDefinitions(accessor: ClassAccessor, storage: ClassArtifactStorage): readonly string[] {
  const slot = storage.slots.get(accessor.key);
  const managed = storage.managedStorage.get(accessor.key);
  const definitions: string[] = [];
  if (accessor.get !== false) definitions.push(privateGetterDefinition(accessor, storage, slot, managed));
  if (accessor.set !== false) definitions.push(privateSetterDefinition(accessor, storage, slot, managed));
  return definitions;
}

function privateGetterDefinition(
  accessor: ClassAccessor,
  storage: ClassArtifactStorage,
  slot: string | undefined,
  managed: string | undefined
): string {
  return storage.domainStateKey !== undefined
    ? `get [${JSON.stringify(accessor.get)}]() { return ${storage.readField(accessor.key)}; }`
    : managed === undefined
      ? `get [${JSON.stringify(accessor.get)}]() { return this.${slot}; }`
      : `get [${JSON.stringify(accessor.get)}]() { return this[${managed}]; }`;
}

function privateSetterDefinition(
  accessor: ClassAccessor,
  storage: ClassArtifactStorage,
  slot: string | undefined,
  managed: string | undefined
): string {
  return storage.domainStateKey !== undefined
    ? `set [${JSON.stringify(accessor.set)}](value) { ${storage.writeField(accessor.key, "value")} }`
    : managed === undefined
      ? `set [${JSON.stringify(accessor.set)}](value) { this.${slot} = value; }`
      : `set [${JSON.stringify(accessor.set)}](value) { this[${managed}] = value; }`;
}

function emitFieldAccessorMethods(setup: ClassArtifactSetup, storage: ClassArtifactStorage): readonly string[] {
  const methods: string[] = [];
  for (const field of storage.fields) {
    const managed = storage.managedStorage.get(field);
    const policy = storage.fieldPolicies.get(field);
    if (fieldHasGetter(setup, storage, field, policy))
      methods.push(`get [${JSON.stringify(field)}]() { return ${storage.readField(field)}; }`);
    if (fieldHasSetter(storage, policy, managed))
      methods.push(`set [${JSON.stringify(field)}](value) { ${storage.writeField(field, "value")} }`);
  }
  return methods;
}

function fieldHasGetter(
  setup: ClassArtifactSetup,
  storage: ClassArtifactStorage,
  field: string,
  policy: ClassFieldPolicy | undefined
): boolean {
  const defaultDdd = setup.hasDomainState && policy === undefined;
  return (
    policy?.getter === true ||
    defaultDdd ||
    (policy === undefined &&
      (storage.managedFieldNames.has(field) ||
        (storage.accessorByKey.has(field) && storage.accessorByKey.get(field)?.field !== "private")))
  );
}

function fieldHasSetter(
  storage: ClassArtifactStorage,
  policy: ClassFieldPolicy | undefined,
  managed: string | undefined
): boolean {
  return policy?.setter === true && (storage.domainStateKey !== undefined || managed !== undefined);
}

function emitClassCapabilities(
  context: ClassArtifactEmitContext,
  setup: ClassArtifactSetup,
  capabilities: ReadonlySet<string>,
  binding: string,
  reportName: string
): ClassMembersPart | undefined {
  const result: ClassMembersPart = { helpers: [], methods: [] };
  for (const part of [
    emitEqualityMembers(context, setup, capabilities, binding, reportName),
    emitHashMembers(context, setup, capabilities, binding, reportName),
    emitDiffMembers(context, setup, capabilities, reportName),
    emitCloneMembers(context, setup, capabilities, binding, reportName),
    emitValueMembers(capabilities),
    emitWithMembers(context, setup, capabilities, binding, reportName),
    emitJsonMembers(context, setup, binding, reportName),
  ]) {
    if (part === undefined) return undefined;
    result.helpers.push(...part.helpers);
    result.methods.push(...part.methods);
  }
  return result;
}

interface ClassMembersPart {
  readonly helpers: string[];
  readonly methods: string[];
}

const EMPTY_CLASS_MEMBERS: ClassMembersPart = { helpers: [], methods: [] };

function emitEqualityMembers(
  context: ClassArtifactEmitContext,
  setup: ClassArtifactSetup,
  capabilities: ReadonlySet<string>,
  binding: string,
  reportName: string
): ClassMembersPart | undefined {
  if (!capabilities.has("equals")) return EMPTY_CLASS_MEMBERS;
  const { artifact } = setup;
  if (setup.valueRepresentation) {
    const equal = context.internalIdentifier(`${binding}_equal`);
    const source = context.tryEmit(reportName, "class.equals", context.skipped, () => emitEqualSource(artifact.schema));
    if (!source) return undefined;
    return {
      helpers: [`const ${equal} = ${context.asExpression(source, "equal")};`],
      methods: [`equals(other) { return other instanceof ${binding} && ${equal}(this.value, other.value); }`],
    };
  }
  const body = context.tryEmit(reportName, "class.equals", context.skipped, () => emitEqualMethodBody(artifact.schema));
  if (!body) return undefined;
  const helpers: string[] = [];
  if (body.includes("__getIndex")) context.mark("runtimeGetIndex");
  if (body.includes("__hash")) {
    const hash = context.internalIdentifier(`${binding}_equal_hash`);
    if (!context.emitHashBinding(hash, artifact.schema, reportName, artifact.frozen)) return undefined;
    helpers.push(`const __hash = ${hash};`);
  }
  return { helpers, methods: [`equals(other) { ${body} }`] };
}

function emitHashMembers(
  context: ClassArtifactEmitContext,
  setup: ClassArtifactSetup,
  capabilities: ReadonlySet<string>,
  binding: string,
  reportName: string
): ClassMembersPart | undefined {
  if (!capabilities.has("hashCode")) return EMPTY_CLASS_MEMBERS;
  const hash = context.internalIdentifier(`${binding}_hash`);
  if (!context.emitHashBinding(hash, setup.artifact.schema, reportName, setup.artifact.frozen)) return undefined;
  return {
    helpers: [],
    methods: [`hashCode() { return ${hash}(${setup.valueRepresentation ? "this.value" : "this"}); }`],
  };
}

function emitDiffMembers(
  context: ClassArtifactEmitContext,
  setup: ClassArtifactSetup,
  capabilities: ReadonlySet<string>,
  reportName: string
): ClassMembersPart | undefined {
  if (!capabilities.has("diff")) return EMPTY_CLASS_MEMBERS;
  const source = context.tryEmit(reportName, "class.diff", context.skipped, () =>
    emitDiffMethodBody(setup.artifact.schema)
  );
  return source === undefined ? undefined : { helpers: [], methods: [`diff(other) { ${source} }`] };
}

function emitCloneMembers(
  context: ClassArtifactEmitContext,
  setup: ClassArtifactSetup,
  capabilities: ReadonlySet<string>,
  binding: string,
  reportName: string
): ClassMembersPart | undefined {
  if (!capabilities.has("clone")) return EMPTY_CLASS_MEMBERS;
  const emitted = context.tryEmit(reportName, "class.clone", context.skipped, () =>
    emitCloneBodyWithBindings(buildCloneIR(setup.artifact.schema), {
      allowRuntimeTypeBindings: true,
      useTrustedRuntimeTypeMaterializers: false,
    })
  );
  if (!emitted) return undefined;
  const inlined = emitted.bindings.names.map((name, index) => {
    const value = emitted.bindings.values[index];
    const classBinding = context.classBindings.get(value);
    if (classBinding !== undefined) return `const ${name} = ${classBinding};`;
    const literal = context.serializeBindingValue(value);
    return literal === undefined ? undefined : `const ${name} = ${literal};`;
  });
  if (inlined.some((line) => line === undefined)) {
    context.skipped.push({
      schema: reportName,
      operation: "class.clone",
      reason: "nested Runtime Type materializers cannot be serialized ahead of time",
    });
    return undefined;
  }
  const clone = context.internalIdentifier(`${binding}_clone`);
  const helpers = [`const ${clone} = /*#__PURE__*/ (() => {`];
  helpers.push(...(inlined as string[]).map((line) => `  ${line}`));
  helpers.push(
    ...context.indentBlock(`return function clone(value) {
${emitted.source}
};`)
  );
  helpers.push("})();");
  return {
    helpers,
    // An aggregate's pending events belong to the transition that raised
    // them; a copy of the state starts with an empty queue.
    methods: [`clone() { return this.constructor["__jitMaterialize"](${clone}(this)); }`],
  };
}

function emitValueMembers(capabilities: ReadonlySet<string>): ClassMembersPart {
  return capabilities.has("value") ? { helpers: [], methods: ["get value() { return this; }"] } : EMPTY_CLASS_MEMBERS;
}

function emitWithMembers(
  context: ClassArtifactEmitContext,
  setup: ClassArtifactSetup,
  capabilities: ReadonlySet<string>,
  binding: string,
  reportName: string
): ClassMembersPart | undefined {
  if (!capabilities.has("with")) return EMPTY_CLASS_MEMBERS;
  const source = context.tryEmit(reportName, "class.update", context.skipped, () =>
    emitUpdateSource(setup.artifact.schema)
  );
  if (!source) return undefined;
  const update = context.internalIdentifier(`${binding}_update`);
  return {
    helpers: [`const ${update} = ${context.asExpression(source, "update")};`],
    methods: [`with(patch) { return new this.constructor(${update}(this, patch), __construct); }`],
  };
}

function emitJsonMembers(
  context: ClassArtifactEmitContext,
  setup: ClassArtifactSetup,
  binding: string,
  reportName: string
): ClassMembersPart | undefined {
  const classJsonMember = setup.artifact.resolvedMembers?.find(
    (member) => member.owner === "class.json" && member.kind === "method"
  )?.name;
  if (classJsonMember === undefined) return EMPTY_CLASS_MEMBERS;
  const source = context.tryEmit(reportName, "class.json", context.skipped, () =>
    emitSerialize(setup.artifact.wireSchema ?? setup.artifact.schema)
  );
  if (!source) return undefined;
  const stringify = context.internalIdentifier(`${binding}_json`);
  return {
    helpers: [`const ${stringify} = ${context.asExpression(source, "stringify")};`],
    methods: [`${context.classMemberName(classJsonMember)}() { return ${stringify}(this); }`],
  };
}
