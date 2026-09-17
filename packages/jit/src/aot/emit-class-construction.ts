import type { ClassArtifactStorage, ClassMembers } from "./emit-class-members.js";
import type { ClassArtifactSetup } from "./emit-class-setup.js";
import type { ClassArtifactEmitContext } from "./emit-class-types.js";

type ClassArtifact = ClassArtifactSetup["artifact"];
type ClassPolicy = NonNullable<ClassArtifact["policy"]>;

export interface ClassConstructionPlan {
  readonly constructorSource: string;
  readonly trustedMaterializer: string;
  readonly create: string;
  readonly hydrate: string;
}

/** Emits the constructor, trusted materializer and factory bodies for a class. */
export function createClassConstructionPlan(
  _context: ClassArtifactEmitContext,
  setup: ClassArtifactSetup,
  storage: ClassArtifactStorage,
  _members: ClassMembers,
  _binding: string,
  _reportName: string
): ClassConstructionPlan {
  const assignments = classAssignments(setup, storage);
  const trustedAssignments = trustedClassAssignments(setup, storage);
  const assertionCall = classAssertionCall(setup.artifact.policy);
  const create = classCreateSource(setup, storage, assertionCall);
  const hydrate = classHydrateSource(setup, storage, assertionCall);
  const constructorSource = classConstructorSource(setup, storage, assignments);
  const trustedMaterializer = classTrustedMaterializer(setup, storage, trustedAssignments);
  return { constructorSource, trustedMaterializer, create, hydrate };
}

function classAssignments(setup: ClassArtifactSetup, storage: ClassArtifactStorage): string {
  if (setup.valueRepresentation) return "this.value = state;";
  return storage.fields.map((field) => classAssignment(storage, field)).join(" ");
}

function classAssignment(storage: ClassArtifactStorage, field: string): string {
  const initializer = storage.fieldInitializers.get(field);
  if (storage.domainStateKey !== undefined && initializer === undefined) return "";
  const value = classStateValue(field, initializer);
  return storage.domainStateKey === undefined
    ? `${storage.readField(field)} = ${value};`
    : `state[${JSON.stringify(field)}] = ${value};`;
}

function trustedClassAssignments(setup: ClassArtifactSetup, storage: ClassArtifactStorage): string {
  return storage.fields.map((field) => trustedClassAssignment(setup, storage, field)).join(" ");
}

function trustedClassAssignment(setup: ClassArtifactSetup, storage: ClassArtifactStorage, field: string): string {
  const initializer = storage.fieldInitializers.get(field);
  const value = setup.valueRepresentation ? "state" : classStateValue(field, initializer);
  const target = trustedClassTarget(setup, storage, field);
  if (storage.domainStateKey !== undefined && initializer === undefined) return "";
  return `${target} = ${value};`;
}

function classStateValue(field: string, initializer: string | undefined): string {
  return initializer === undefined
    ? `state[${JSON.stringify(field)}]`
    : `state[${JSON.stringify(field)}] === undefined ? ${initializer}.safeParse(undefined).data : state[${JSON.stringify(field)}]`;
}

function trustedClassTarget(setup: ClassArtifactSetup, storage: ClassArtifactStorage, field: string): string {
  if (setup.valueRepresentation) return "instance.value";
  if (storage.domainStateKey !== undefined) return `state[${JSON.stringify(field)}]`;
  const managed = storage.managedStorage.get(field);
  return managed === undefined ? `instance[${JSON.stringify(field)}]` : `instance[${managed}]`;
}

function classAssertionCall(policy: ClassPolicy | undefined): (value: string) => string {
  if (policy?.assertions === undefined) return () => "";
  return (value: string): string =>
    `const outcome = __assert(${value}); if (outcome !== undefined) return __failure(__assertFailure(outcome, ${value})); `;
}

function createPolicyCreate(
  setup: ClassArtifactSetup,
  storage: ClassArtifactStorage,
  assertionCall: (value: string) => string
): string | undefined {
  return setup.unvalidatedDdd
    ? createUnvalidatedCreate(setup, storage, assertionCall)
    : createValidatedCreate(setup, storage, assertionCall);
}

function createUnvalidatedCreate(
  setup: ClassArtifactSetup,
  storage: ClassArtifactStorage,
  assertionCall: (value: string) => string
): string | undefined {
  const policy = setup.artifact.policy;
  const materializer = setup.materializer as string;
  if (policy === undefined) {
    return setup.materializerNeedsIssues
      ? `const result = ${materializer}.safeParse(${storage.creationInput}); if (!result.success) throw new JITValidationError(result.issues); return new this(result.data, __construct, true);`
      : `return new this(${materializer}.parse(${storage.creationInput}), __construct, true);`;
  }
  if (!policy.create) return undefined;
  return `const result = ${materializer}.safeParse(${storage.creationInput}); if (!result.success) return __failure(__error(result.issues)); ${assertionCall("result.data")}return __success(new this(result.data, __construct, true));`;
}

function createValidatedCreate(
  setup: ClassArtifactSetup,
  storage: ClassArtifactStorage,
  assertionCall: (value: string) => string
): string | undefined {
  const policy = setup.artifact.policy;
  if (policy === undefined || !policy.create) return undefined;
  if (setup.fastPolicyCreate)
    return `let __createdState; if (${setup.validationBinding}.is(${storage.creationInput})) __createdState = ${storage.creationInput}; else { const result = ${setup.validationBinding}.safeParse(${storage.creationInput}); if (!result.success) return __failure(__error(result.issues)); __createdState = result.data; } ${assertionCall("__createdState")}return __success(new this(__createdState, __construct, true));`;
  return `const result = ${setup.validationBinding}.safeParse(${storage.creationInput}); if (!result.success) return __failure(__error(result.issues)); ${assertionCall("result.data")}return __success(new this(result.data, __construct, true));`;
}

function createPolicyHydrate(
  setup: ClassArtifactSetup,
  storage: ClassArtifactStorage,
  assertionCall: (value: string) => string
): string | undefined {
  return setup.unvalidatedDdd
    ? hydrateUnvalidatedCreate(setup, storage, assertionCall)
    : hydrateValidatedCreate(setup, storage, assertionCall);
}

function hydrateUnvalidatedCreate(
  setup: ClassArtifactSetup,
  storage: ClassArtifactStorage,
  assertionCall: (value: string) => string
): string | undefined {
  const policy = setup.artifact.policy;
  const materializer = setup.hydrateMaterializer as string;
  if (policy === undefined) {
    return setup.materializerNeedsIssues
      ? `const result = ${materializer}.safeParse(${storage.hydrationInput}); if (!result.success) throw new JITValidationError(result.issues); return new this(result.data, __construct, true);`
      : `return new this(${materializer}.parse(${storage.hydrationInput}), __construct, true);`;
  }
  if (!policy.hydrate) return undefined;
  return `const result = ${materializer}.safeParse(${storage.hydrationInput}); if (!result.success) return __failure(__error(result.issues)); ${assertionCall("result.data")}return __success(new this(result.data, __construct, true));`;
}

function hydrateValidatedCreate(
  setup: ClassArtifactSetup,
  storage: ClassArtifactStorage,
  assertionCall: (value: string) => string
): string | undefined {
  const policy = setup.artifact.policy;
  if (policy === undefined || !policy.hydrate) return undefined;
  if (setup.fastPolicyHydrate)
    return `let __hydratedState; if (${setup.hydrateBinding}.is(${storage.hydrationInput})) __hydratedState = ${storage.hydrationInput}; else { const result = ${setup.hydrateBinding}.safeParse(${storage.hydrationInput}); if (!result.success) return __failure(__error(result.issues)); __hydratedState = result.data; } ${assertionCall("__hydratedState")}return __success(new this(__hydratedState, __construct, true));`;
  return `const result = ${setup.hydrateBinding}.safeParse(${storage.hydrationInput}); if (!result.success) return __failure(__error(result.issues)); ${assertionCall("result.data")}return __success(new this(result.data, __construct, true));`;
}

function classCreateSource(
  setup: ClassArtifactSetup,
  storage: ClassArtifactStorage,
  assertionCall: (value: string) => string
): string {
  if (setup.artifact.domainEvent !== undefined) {
    const event = setup.artifact.domainEvent;
    return `const result = ${setup.validationBinding}.safeParse(input); if (!result.success) throw new JITValidationError(result.issues); return new this({ id: globalThis.crypto?.randomUUID?.() ?? \`evt_\${Date.now().toString(36)}_\${Math.random().toString(36).slice(2)}\`, type: ${JSON.stringify(event.type)}, version: ${event.version}, occurredAt: new Date(), payload: result.data }, __construct);`;
  }
  const policyCreate = createPolicyCreate(setup, storage, assertionCall);
  return policyCreate ?? `return new this(${storage.creationInput}, __construct);`;
}

function classHydrateSource(
  setup: ClassArtifactSetup,
  storage: ClassArtifactStorage,
  assertionCall: (value: string) => string
): string {
  if (setup.artifact.domainEvent !== undefined) {
    const event = setup.artifact.domainEvent;
    return `if (state === null || typeof state !== "object" || state.type !== ${JSON.stringify(event.type)} || state.version !== ${event.version} || typeof state.id !== "string") throw new JITValidationError([]); const occurredAt = state.occurredAt instanceof Date ? state.occurredAt : new Date(state.occurredAt); if (Number.isNaN(occurredAt.getTime())) throw new JITValidationError([]); const result = ${setup.validationBinding}.safeParse(state.payload); if (!result.success) throw new JITValidationError(result.issues); return new this({ ...state, occurredAt, payload: result.data }, __construct);`;
  }
  const policyHydrate = createPolicyHydrate(setup, storage, assertionCall);
  return (
    policyHydrate ??
    `const result = ${setup.hydrateBinding}.safeParse(${storage.hydrationInput}); if (!result.success) throw new JITValidationError(result.issues); return new this(result.data, __construct, true);`
  );
}

function classConstructorSource(setup: ClassArtifactSetup, storage: ClassArtifactStorage, assignments: string): string {
  const guard = classConstructionGuard(setup.artifact);
  const events = classEvents(setup.artifact, storage);
  const freeze = classFreeze(setup.artifact);
  if (setup.artifact.domainEvent !== undefined)
    return `constructor(state, token) { ${guard}${assignments}${events}${freeze} }`;
  const state = classConstructorState(setup, storage);
  const attachState = classAttachState(setup, storage);
  return `constructor(input, token, validated) { ${guard}const state = token === true || validated === true ? input : ${state}; ${assignments}${attachState}${events}${freeze} }`;
}

function classConstructionGuard(artifact: ClassArtifact): string {
  return artifact.construction === "factory"
    ? `if (token !== __construct && token !== true) throw new Error("This Runtime Type uses factory construction; call its create() or hydrate() factory"); `
    : "";
}

function classConstructorState(setup: ClassArtifactSetup, storage: ClassArtifactStorage): string {
  const policy = setup.artifact.policy;
  if (setup.unvalidatedDdd && policy === undefined && !setup.materializerNeedsIssues)
    return `${setup.materializer}.parse(${storage.creationInput})`;
  return `(() => { const result = ${setup.validationBinding}.safeParse(${storage.creationInput}); if (!result.success) throw new JITValidationError(result.issues); return result.data; })()`;
}

function classAttachState(setup: ClassArtifactSetup, storage: ClassArtifactStorage): string {
  if (storage.domainStateKey === undefined) return "";
  return ` ${setup.valueRepresentation ? "instance" : "this"}[${storage.domainStateKey}] = state;`;
}

function classEvents(artifact: ClassArtifact, storage: ClassArtifactStorage): string {
  return artifact.aggregate
    ? ` Object.defineProperty(this, ${storage.eventBufferKey}, { configurable: false, enumerable: false, value: [], writable: true });`
    : "";
}

function classFreeze(artifact: ClassArtifact): string {
  return artifact.frozen ? " Object.freeze(this);" : "";
}

function classTrustedMaterializer(
  setup: ClassArtifactSetup,
  storage: ClassArtifactStorage,
  trustedAssignments: string
): string {
  if (storage.slots.size > 0)
    return `static ["__jitMaterialize"](state) { return new this(state, __construct, true); }`;
  const state = storage.domainStateKey === undefined ? "" : ` instance[${storage.domainStateKey}] = state;`;
  const events = setup.artifact.aggregate
    ? ` Object.defineProperty(instance, ${storage.eventBufferKey}, { configurable: false, enumerable: false, value: [], writable: true });`
    : "";
  const freeze = setup.artifact.frozen ? " Object.freeze(instance);" : "";
  return `static ["__jitMaterialize"](state) { const instance = Object.create(this.prototype); ${trustedAssignments}${state}${events}${freeze} return instance; }`;
}

/** Appends one complete import-free class artifact to the generated module. */
export function appendClassArtifactSource(
  context: ClassArtifactEmitContext,
  setup: ClassArtifactSetup,
  storage: ClassArtifactStorage,
  members: ClassMembers,
  construction: ClassConstructionPlan,
  options: {
    readonly binding: string;
    readonly declaration: string;
    readonly assertedType: string | undefined;
    readonly policyLines: readonly string[];
  }
): void {
  const { artifact } = setup;
  const { binding, declaration, assertedType, policyLines } = options;
  context.js.push(`${declaration} /*#__PURE__*/ (() => {`);
  context.js.push("  const __construct = Symbol();");
  if (storage.domainStateKey !== undefined) context.js.push(`  const ${storage.domainStateKey} = Symbol();`);
  if (storage.eventBufferKey !== undefined) context.js.push(`  const ${storage.eventBufferKey} = Symbol();`);
  for (const managed of storage.managedStorage.values()) context.js.push(`  const ${managed} = Symbol();`);
  if (storage.boundaryInputName !== undefined) {
    const checks = storage.noConstructorFields
      .map((field) => `Object.prototype.hasOwnProperty.call(input, ${JSON.stringify(field)})`)
      .join(" || ");
    context.js.push(
      `  const ${storage.boundaryInputName} = (input) => { if (input === null || typeof input !== "object" || !(${checks})) return input; const state = { ...input }; ${storage.noConstructorFields.map((field) => `delete state[${JSON.stringify(field)}];`).join(" ")} return state; };`
    );
  }
  if (policyLines.length > 0) context.js.push(...policyLines);
  if (members.helpers.length > 0) context.js.push(`  ${members.helpers.join("\n  ")}`);
  context.js.push(`  return class ${binding} {`);
  context.js.push(...[...storage.slots.values()].map((slot) => `    ${slot};`));
  context.js.push(`    ${construction.constructorSource}`);
  context.js.push(`    ${construction.trustedMaterializer}`);
  if (artifact.factories.create !== false)
    context.js.push(
      `    static ${context.classMemberName(artifact.factories.create)}(input) { ${abstractGuard(artifact, binding)}${construction.create} }`
    );
  if (artifact.factories.hydrate !== false)
    context.js.push(
      `    static ${context.classMemberName(artifact.factories.hydrate)}(state) { ${abstractGuard(artifact, binding)}${construction.hydrate} }`
    );
  if (artifact.domainEvent)
    context.js.push(
      `    static type = ${JSON.stringify(artifact.domainEvent.type)};`,
      `    static version = ${artifact.domainEvent.version};`,
      `    static ["~event"] = /*#__PURE__*/ Object.freeze({ version: 1, type: ${JSON.stringify(artifact.domainEvent.type)}, schemaVersion: ${artifact.domainEvent.version} });`,
      `    get ["~event"]() { return ${binding}["~event"]; }`
    );
  if (setup.valueRepresentation) context.js.push("    toJSON() { return this.value; }");
  context.js.push(...members.accessorDefinitions.map((definition) => `    ${definition}`));
  context.js.push(...members.methods.map((method) => `    ${method}`));
  context.js.push("  };");
  context.js.push(`})()${assertedType === undefined ? "" : ` as unknown as ${assertedType}`};`);
}

function abstractGuard(artifact: ClassArtifact, binding: string): string {
  return artifact.abstract
    ? `if (this === ${binding}) throw new Error("Cannot create an instance of an abstract JIT class"); `
    : "";
}
