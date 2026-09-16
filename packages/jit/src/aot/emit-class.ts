import { buildCloneIR } from "../compiler/clone/build-clone-ir.js";
import { emitCloneBodyWithBindings } from "../compiler/clone/emit-clone.js";
import { emitDiffMethodBody } from "../compiler/diff.js";
import { emitEqualMethodBody, emitEqualSource } from "../compiler/equal.js";
import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import { emitSerialize } from "../compiler/serialize/emit-serialize.js";
import { emitUpdateSource } from "../compiler/update.js";
import { canUseFastParse } from "../compiler/validate/emit-validate.js";
import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import type { SkippedOperation } from "./generate.js";

export interface EmittedBinding {
  readonly binding: string;
  readonly type: string;
}

export type ClassArtifactFlag =
  | "validationError"
  | "assertionError"
  | "runtimeGetIndex"
  | "hashHelpers"
  | "hashCache"
  | "jsonPatchHelpers"
  | "aggregateType"
  | "domainStateType"
  | "domainEventType";

export interface ValidatorSelection {
  readonly is: boolean;
  readonly safeParse: boolean;
  readonly parse?: boolean;
  readonly resolveDefaults?: boolean;
  readonly materializeRuntimeTypes?: boolean;
  readonly validateChecks?: boolean;
  readonly maxIssues?: number;
}

export interface ClassArtifactEmitContext {
  readonly js: string[];
  readonly skipped: SkippedOperation[];
  readonly mark: (flag: ClassArtifactFlag) => void;
  readonly internalIdentifier: (preferred: string) => string;
  readonly classMemberName: (name: string) => string;
  readonly inlineBindings: (names: readonly string[], values: readonly unknown[]) => string[] | undefined;
  readonly serializeBindingValue: (value: unknown) => string | undefined;
  readonly indentBlock: (source: string) => string[];
  readonly asExpression: (source: string, entry: string) => string;
  readonly tryEmit: <TValue>(
    schema: string,
    operation: string,
    skipped: SkippedOperation[],
    emit: () => TValue
  ) => TValue | undefined;
  readonly emitValidatorBinding: (
    binding: string,
    schema: ATS.AnyTypeSchema,
    reportName: string,
    operation: string,
    selection: ValidatorSelection
  ) => string | undefined;
  readonly emitHashBinding: (
    binding: string,
    schema: ATS.AnyTypeSchema,
    reportName: string,
    cache?: boolean
  ) => string | undefined;
  readonly classBindings: ReadonlyMap<unknown, string>;
  readonly assertionBindings: ReadonlyMap<unknown, string>;
  readonly hasNestedValidation: (schema: ATS.AnyTypeSchema, seen?: Set<ATS.AnyTypeSchema>) => boolean;
}

function resolveObjectSchema(schema: ATS.AnyTypeSchema): ATS.ObjectSchema | undefined {
  const base = resolveWrappers(schema).base;
  return base.type === TypeName.object ? (base as ATS.ObjectSchema) : undefined;
}

/**
 * Emits the failure policy as local helpers.
 *
 * The result shape, the error construction and each invariant become plain
 * source in the module. A custom error factory is a callback like any other:
 * when it cannot be reconstructed the artifact is context.skipped with a reason
 * rather than generated with a silently different failure.
 */
export function emitClassPolicy(
  context: ClassArtifactEmitContext,
  policy: NonNullable<Extract<CompiledArtifact, { readonly kind: "class" }>["policy"]>,
  reportName: string
): string[] | undefined {
  const lines: string[] = [];
  const errorBinding = policy.error === undefined ? undefined : context.serializeBindingValue(policy.error);
  const nestedAssertions = (policy.nestedErrors ?? []).filter(
    (candidate) => candidate.runtimeBinding !== true && candidate.assertion !== undefined
  );

  if (policy.error !== undefined && errorBinding === undefined) {
    context.skipped.push({
      schema: reportName,
      operation: "class.validate",
      reason: "the configured error factory cannot be serialized ahead of time",
    });
    return undefined;
  }
  lines.push(
    `  const __baseError = ${errorBinding ?? "(issues) => new JITValidationError(issues)"};`,
    policy.result === "either"
      ? "  const __success = (value) => value;"
      : policy.result === "tuple"
        ? "  const __success = (value) => [null, value];"
        : "  const __success = (value) => value;",
    policy.result === "either"
      ? '  const __factoryFailure = Symbol.for("jit.factory.failure"); const __failure = (error) => Object.defineProperties({ ok: false, error }, { [__factoryFailure]: { enumerable: false, value: true } });'
      : policy.result === "tuple"
        ? "  const __failure = (error) => [error, null];"
        : "  const __failure = (error) => { throw error; };"
  );
  if (nestedAssertions.length === 0) {
    lines.push("  const __error = __baseError;");
  } else {
    context.mark("assertionError");
    lines.push(
      "  const __error = (issues) => {",
      `    let __selectedPriority = ${policy.error === undefined ? "-Infinity" : String(policy.errorPriority ?? 1000)};`,
      `    let __selectedDepth = ${policy.error === undefined ? "Infinity" : "0"};`,
      `    let __selectedOrder = ${policy.error === undefined ? "Infinity" : "-1"};`,
      "    let __selectedNested = -1;"
    );
    nestedAssertions.forEach((candidate, index) => {
      lines.push(
        `    if (issues.some((issue) => ${JSON.stringify(candidate.path)}.every((part, index) => issue.path[index] === part)) && (${candidate.priority} > __selectedPriority || (${candidate.priority} === __selectedPriority && (${candidate.depth} < __selectedDepth || (${candidate.depth} === __selectedDepth && ${candidate.order} < __selectedOrder))))) {`,
        `      __selectedPriority = ${candidate.priority}; __selectedDepth = ${candidate.depth}; __selectedOrder = ${candidate.order}; __selectedNested = ${index};`,
        "    }"
      );
    });
    nestedAssertions.forEach((candidate, index) => {
      const assertion = candidate.assertion as {
        readonly rule: string | undefined;
        readonly field: string | undefined;
        readonly message: string;
      };
      const details = JSON.stringify({
        ...(assertion.rule === undefined ? {} : { rule: assertion.rule }),
        ...(assertion.field === undefined ? {} : { field: assertion.field }),
      });
      lines.push(
        `    if (__selectedNested === ${index}) return new DomainAssertionError(${JSON.stringify(assertion.message)}, { ...${details}, issues });`
      );
    });
    lines.push("    return __baseError(issues);", "  };");
  }
  if (policy.result === "throw") context.mark("validationError");

  const assertions = policy.assertions;
  if (assertions !== undefined) {
    const inlined = context.inlineBindings(assertions.bindingNames, assertions.bindingValues);
    if (inlined === undefined) {
      context.skipped.push({
        schema: reportName,
        operation: "class.assert",
        reason: "an assertion value cannot be serialized ahead of time",
      });
      return undefined;
    }
    lines.push(...inlined.map((line) => `  ${line}`));
    context.mark("assertionError");
    for (const [index, failure] of assertions.failures.entries()) {
      const custom = failure.error === undefined ? undefined : context.serializeBindingValue(failure.error);
      if (failure.error !== undefined && custom === undefined) {
        context.skipped.push({
          schema: reportName,
          operation: "class.assert",
          reason: "an assertion error factory cannot be serialized ahead of time",
        });
        return undefined;
      }
      lines.push(
        `  const __issue${index} = Object.freeze(${JSON.stringify({
          path: failure.field === undefined ? [] : [failure.field],
          code: failure.code,
          expected: failure.rule ?? "a domain invariant",
          message: failure.message,
        })});`,
        custom === undefined
          ? `  const __fail${index} = () => undefined;`
          : `  const __errorCandidate${index} = ${custom}; const __fail${index} = () => true;`
      );
    }
    lines.push(...context.indentBlock(assertions.source));
    // One error carries every invariant that did not hold, matching the
    // runtime host exactly.
    lines.push(
      `  const __assertFailure = (outcome, value) => { ${policy.error === undefined ? "" : `if (outcome.errorIndex < 0 || ${policy.errorPriority ?? 1000} >= (outcome.errorIndex < 0 ? -1 : [${assertions.failures.map((failure) => failure.priority).join(", ")}][outcome.errorIndex])) return __error(outcome.issues);`} ${assertions.failures
        .map((failure, index) =>
          failure.error === undefined
            ? ""
            : `if (outcome.errorIndex === ${index}) return __errorCandidate${index}(value, ${JSON.stringify({
                rule: failure.rule,
                field: failure.field,
                code: failure.code,
                message: failure.message,
                priority: failure.priority,
              })});`
        )
        .join(
          " "
        )} const first = outcome.issues[0]; const rule = first?.expected === "a domain invariant" ? undefined : first?.expected; return new DomainAssertionError(first?.message ?? "a domain assertion does not hold", { rule, field: first?.path?.[0] === undefined ? undefined : String(first.path[0]), issues: outcome.issues }); };`
    );
  }
  return lines;
}

export function emitClassArtifact(
  context: ClassArtifactEmitContext,
  binding: string,
  declaration: string,
  artifact: Extract<CompiledArtifact, { readonly kind: "class" }>,
  reportName: string,
  type: string,
  assertedType: string | undefined
): EmittedBinding | undefined {
  const base = resolveObjectSchema(artifact.schema);
  const valueRepresentation = artifact.representation === "value";
  const hasDomainState = artifact.encapsulateFields === true || artifact.domainStateLayout?.storage === "symbol";

  if (!base && !valueRepresentation) {
    context.skipped.push({
      schema: reportName,
      operation: "class",
      reason: "JIT classes require an object schema",
    });
    return undefined;
  }
  // Application methods are ordinary JavaScript runtime bindings. A
  // function's source text is not a reconstructive artifact: it loses its
  // lexical environment and can change meaning when moved to this module.
  // Refuse the complete class before emitting any partial validator/helper.
  const applicationMethods = artifact.methods ?? [];
  if (applicationMethods.length > 0) {
    context.skipped.push({
      schema: reportName,
      operation: "class.extends",
      reason: `application extension ${JSON.stringify(applicationMethods[0]?.name)} is a runtime binding and has no reconstructive AOT representation`,
    });
    return undefined;
  }
  if (artifact.customFactories?.create !== undefined || artifact.customFactories?.hydrate !== undefined) {
    context.skipped.push({
      schema: reportName,
      operation: "class.factories",
      reason: "a custom factory is a runtime binding and has no standalone AOT representation",
    });
    return undefined;
  }
  if (artifact.mutation?.timestampClock !== undefined || artifact.mutation?.deletionClock !== undefined) {
    context.skipped.push({
      schema: reportName,
      operation: "class.extends",
      reason: "a custom DDD clock is a runtime binding and has no standalone AOT representation",
    });
    return undefined;
  }
  if (artifact.policy?.nestedErrors?.some((candidate) => candidate.runtimeBinding === true) === true) {
    context.skipped.push({
      schema: reportName,
      operation: "class.validate",
      reason: "a nested custom error factory is a runtime binding and has no standalone AOT representation",
    });
    return undefined;
  }
  const creationSchema = artifact.domainEvent
    ? (base as ATS.ObjectSchema).def.props.payload
    : (artifact.creationSchema ?? artifact.schema);
  const hydrateSchema = artifact.hydrateSchema ?? artifact.schema;
  const fastPolicyCreate = artifact.policy?.maxIssues === undefined && canUseFastParse(creationSchema);
  const fastPolicyHydrate = artifact.policy?.maxIssues === undefined && canUseFastParse(hydrateSchema);
  const unvalidatedDdd =
    artifact.domainEvent === undefined &&
    artifact.factoryValidationOptIn === true &&
    artifact.policy?.validationConfigured !== true;
  const materializerNeedsIssues =
    context.hasNestedValidation(creationSchema) || context.hasNestedValidation(hydrateSchema);
  const validator = unvalidatedDdd
    ? undefined
    : context.emitValidatorBinding(binding, creationSchema, reportName, "class", {
        is: fastPolicyCreate,
        safeParse: true,
        ...(artifact.policy?.maxIssues === undefined ? {} : { maxIssues: artifact.policy.maxIssues }),
      });
  const hydrateValidator = unvalidatedDdd
    ? undefined
    : artifact.domainEvent
      ? validator
      : context.emitValidatorBinding(binding, hydrateSchema, reportName, "class.hydrate", {
          is: fastPolicyHydrate,
          safeParse: true,
          resolveDefaults: false,
          ...(artifact.policy?.maxIssues === undefined ? {} : { maxIssues: artifact.policy.maxIssues }),
        });
  if (!unvalidatedDdd && (validator === undefined || hydrateValidator === undefined)) return undefined;
  const materializer = unvalidatedDdd
    ? context.emitValidatorBinding(binding, creationSchema, reportName, "class.materialize", {
        is: false,
        safeParse: artifact.policy !== undefined || materializerNeedsIssues,
        parse: artifact.policy === undefined && !materializerNeedsIssues,
        validateChecks: false,
      })
    : undefined;
  const hydrateMaterializer = unvalidatedDdd
    ? context.emitValidatorBinding(binding, hydrateSchema, reportName, "class.materializeHydrate", {
        is: false,
        safeParse: artifact.policy !== undefined || materializerNeedsIssues,
        parse: artifact.policy === undefined && !materializerNeedsIssues,
        resolveDefaults: false,
        validateChecks: false,
      })
    : undefined;
  if (unvalidatedDdd && (materializer === undefined || hydrateMaterializer === undefined)) return undefined;
  const validationBinding = (validator ?? materializer) as string;
  const hydrateBinding = (hydrateValidator ?? hydrateMaterializer) as string;
  if (!unvalidatedDdd || materializerNeedsIssues) context.mark("validationError");
  const helpers: string[] = [];
  const methods: string[] = [];
  const capabilities = new Set(artifact.capabilities);
  const fields = valueRepresentation ? ["value"] : Object.keys((base as ATS.ObjectSchema).def.props);
  const managedFieldNames = new Set((artifact.managedFields ?? []).map((managed) => managed.field));
  const fieldPolicies = new Map((artifact.fieldPolicies ?? []).map((policy) => [policy.name, policy] as const));
  const noConstructorFields = [...fieldPolicies.values()]
    .filter((policy) => policy.noConstructor)
    .map((policy) => policy.name);
  const boundaryInputName =
    noConstructorFields.length === 0 ? undefined : context.internalIdentifier(`${binding}_withoutGenerated`);
  const creationInput = boundaryInputName === undefined ? "input" : `${boundaryInputName}(input)`;
  const hydrationInput = boundaryInputName === undefined ? "state" : `${boundaryInputName}(state)`;
  const managedStorage = new Map(
    fields
      .filter((field) => {
        const policy = fieldPolicies.get(field);
        return !hasDomainState && (managedFieldNames.has(field) || policy !== undefined);
      })
      .map((field, index) => [field, `__managed${index}`] as const)
  );
  const domainStateKey = hasDomainState ? context.internalIdentifier(`${binding}_state`) : undefined;
  const eventBufferKey = artifact.aggregate ? context.internalIdentifier(`${binding}_events`) : undefined;
  const accessorByKey = new Map(artifact.accessors?.map((accessor) => [accessor.key, accessor]));
  const slots = new Map<string, string>();
  let slotIndex = 0;

  const fieldInitializers = new Map<string, string>();
  for (const field of fields) {
    if (fieldPolicies.get(field)?.noConstructor !== true) continue;
    const initializer = context.emitValidatorBinding(
      `${binding}_initializer_${field}`,
      (base as ATS.ObjectSchema).def.props[field],
      reportName,
      "class.noConstructor",
      { is: false, safeParse: true }
    );
    if (!initializer) return undefined;
    fieldInitializers.set(field, initializer);
  }

  for (const field of fields) {
    if (domainStateKey === undefined && accessorByKey.get(field)?.field === "private" && !managedStorage.has(field))
      slots.set(field, `#p${slotIndex++}`);
  }
  const readField = (field: string) => {
    if (domainStateKey !== undefined) return `this[${domainStateKey}][${JSON.stringify(field)}]`;
    const managed = managedStorage.get(field);
    if (managed !== undefined) return `this[${managed}]`;
    const slot = slots.get(field);
    return slot ? `this.${slot}` : `this[${JSON.stringify(field)}]`;
  };
  const writeField = (field: string, value: string) =>
    domainStateKey !== undefined
      ? `${readField(field)} = ${value};`
      : managedStorage.has(field)
        ? `${readField(field)} = ${value};`
        : managedFieldNames.has(field)
          ? `Object.defineProperty(this, ${JSON.stringify(field)}, { value: ${value}, writable: false, enumerable: true, configurable: true });`
          : `${readField(field)} = ${value};`;
  const accessorDefinitions = (artifact.accessors ?? [])
    .filter((accessor) => accessor.field === "private")
    .flatMap((accessor) => {
      const slot = slots.get(accessor.key);
      const managed = managedStorage.get(accessor.key);
      const definitions: string[] = [];

      if (accessor.get !== false) {
        definitions.push(
          domainStateKey !== undefined
            ? `get [${JSON.stringify(accessor.get)}]() { return ${readField(accessor.key)}; }`
            : managed === undefined
              ? `get [${JSON.stringify(accessor.get)}]() { return this.${slot}; }`
              : `get [${JSON.stringify(accessor.get)}]() { return this[${managed}]; }`
        );
      }
      if (accessor.set !== false) {
        definitions.push(
          domainStateKey !== undefined
            ? `set [${JSON.stringify(accessor.set)}](value) { ${writeField(accessor.key, "value")} }`
            : managed === undefined
              ? `set [${JSON.stringify(accessor.set)}](value) { this.${slot} = value; }`
              : `set [${JSON.stringify(accessor.set)}](value) { this[${managed}] = value; }`
        );
      }
      return definitions;
    });

  for (const field of fields) {
    const managed = managedStorage.get(field);
    const policy = fieldPolicies.get(field);
    const defaultDdd = hasDomainState && policy === undefined;
    const getter =
      policy?.getter === true ||
      defaultDdd ||
      (policy === undefined &&
        (managedFieldNames.has(field) || (accessorByKey.has(field) && accessorByKey.get(field)?.field !== "private")));
    const setter = policy?.setter === true && (domainStateKey !== undefined || managed !== undefined);
    if (getter) methods.push(`get [${JSON.stringify(field)}]() { return ${readField(field)}; }`);
    if (setter) methods.push(`set [${JSON.stringify(field)}](value) { ${writeField(field, "value")} }`);
  }

  if (capabilities.has("equals")) {
    if (valueRepresentation) {
      const equal = context.internalIdentifier(`${binding}_equal`);
      const source = context.tryEmit(reportName, "class.equals", context.skipped, () =>
        emitEqualSource(artifact.schema)
      );
      if (!source) return undefined;
      helpers.push(`const ${equal} = ${context.asExpression(source, "equal")};`);
      methods.push(`equals(other) { return other instanceof ${binding} && ${equal}(this.value, other.value); }`);
    } else {
      const body = context.tryEmit(reportName, "class.equals", context.skipped, () =>
        emitEqualMethodBody(artifact.schema)
      );
      if (!body) return undefined;
      if (body.includes("__getIndex")) context.mark("runtimeGetIndex");
      if (body.includes("__hash")) {
        const hash = context.internalIdentifier(`${binding}_equal_hash`);
        if (!context.emitHashBinding(hash, artifact.schema, reportName, artifact.frozen)) return undefined;
        helpers.push(`const __hash = ${hash};`);
      }
      methods.push(`equals(other) { ${body} }`);
    }
  }
  if (capabilities.has("hashCode")) {
    const hash = context.internalIdentifier(`${binding}_hash`);
    if (!context.emitHashBinding(hash, artifact.schema, reportName, artifact.frozen)) return undefined;
    methods.push(`hashCode() { return ${hash}(${valueRepresentation ? "this.value" : "this"}); }`);
  }
  if (capabilities.has("diff")) {
    const source = context.tryEmit(reportName, "class.diff", context.skipped, () =>
      emitDiffMethodBody(artifact.schema)
    );
    if (!source) return undefined;
    methods.push(`diff(other) { ${source} }`);
  }
  if (capabilities.has("clone")) {
    const emitted = context.tryEmit(reportName, "class.clone", context.skipped, () =>
      emitCloneBodyWithBindings(buildCloneIR(artifact.schema), {
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
    helpers.push(`const ${clone} = /*#__PURE__*/ (() => {`);
    helpers.push(...(inlined as string[]).map((line) => `  ${line}`));
    helpers.push(
      ...context.indentBlock(`return function clone(value) {
${emitted.source}
};`)
    );
    helpers.push("})();");
    // An aggregate's pending events belong to the transition that raised
    // them; a copy of the state starts with an empty queue.
    methods.push(`clone() { return this.constructor["__jitMaterialize"](${clone}(this)); }`);
  }
  if (capabilities.has("value")) methods.push("get value() { return this; }");
  const needsUpdate = capabilities.has("with");
  let update: string | undefined;
  if (needsUpdate) {
    const source = context.tryEmit(reportName, "class.update", context.skipped, () =>
      emitUpdateSource(artifact.schema)
    );
    if (!source) return undefined;
    update = context.internalIdentifier(`${binding}_update`);
    helpers.push(`const ${update} = ${context.asExpression(source, "update")};`);
  }
  if (capabilities.has("with") && update)
    methods.push(`with(patch) { return new this.constructor(${update}(this, patch), __construct); }`);
  const classJsonMember = artifact.resolvedMembers?.find(
    (member) => member.owner === "class.json" && member.kind === "method"
  )?.name;
  if (classJsonMember !== undefined) {
    const source = context.tryEmit(reportName, "class.json", context.skipped, () =>
      emitSerialize(artifact.wireSchema ?? artifact.schema)
    );
    if (!source) return undefined;
    const stringify = context.internalIdentifier(`${binding}_json`);
    helpers.push(`const ${stringify} = ${context.asExpression(source, "stringify")};`);
    methods.push(`${context.classMemberName(classJsonMember)}() { return ${stringify}(this); }`);
  }
  if (artifact.aggregate) {
    methods.push(
      `raise(event) { this[${eventBufferKey}].push(event); }`,
      `peekEvents() { return this[${eventBufferKey}].slice(); }`,
      `pullEvents() { const events = this[${eventBufferKey}]; this[${eventBufferKey}] = []; return events; }`,
      `async commit(publisher) { const pending = this[${eventBufferKey}]; for (let index = 0; index < pending.length; index++) await publisher.publish(pending[index]); pending.splice(0, pending.length); }`
    );
  }
  if (artifact.mutation?.deletedAt !== undefined) {
    const deletedAt = artifact.mutation.deletedAt;
    const updatedAt = artifact.mutation.updatedAt;
    const version = artifact.mutation.version;
    const deleteMethod = context.classMemberName(artifact.mutation.deleteMethod ?? "softDelete");
    const restoreMethod = context.classMemberName(artifact.mutation.restoreMethod ?? "restore");
    const isDeletedMember = context.classMemberName(artifact.mutation.isDeletedMember ?? "isDeleted");
    methods.push(
      `${deleteMethod}() { if (${readField(deletedAt)} !== null) return; const now = new Date(); ${writeField(deletedAt, "now")}${updatedAt === undefined ? "" : ` ${writeField(updatedAt, "now")}`}${version === undefined ? "" : ` ${writeField(version, `${readField(version)} + 1`)}`} }`,
      `${restoreMethod}() { if (${readField(deletedAt)} === null) return; ${writeField(deletedAt, "null")}${updatedAt === undefined ? "" : ` const now = new Date(); ${writeField(updatedAt, "now")}`}${version === undefined ? "" : ` ${writeField(version, `${readField(version)} + 1`)}`} }`,
      `get ${isDeletedMember}() { return ${readField(deletedAt)} !== null; }`
    );
  }
  if (artifact.mutation?.touchAt !== undefined || artifact.mutation?.version !== undefined) {
    const version = artifact.mutation.version;
    methods.push(
      `${context.classMemberName(artifact.mutation.touchMethod ?? "touch")}() { ${artifact.mutation.touchAt === undefined ? "" : `const now = new Date(); ${writeField(artifact.mutation.touchAt, "now")}`} ${version === undefined ? "" : writeField(version, `${readField(version)} + 1`)} }`
    );
  }
  if (domainStateKey !== undefined) methods.push(`get _props() { return this[${domainStateKey}]; }`);
  const assignments = valueRepresentation
    ? "this.value = state;"
    : fields
        .map((field) => {
          const initializer = fieldInitializers.get(field);
          if (domainStateKey !== undefined && initializer === undefined) return "";
          const value =
            initializer === undefined
              ? `state[${JSON.stringify(field)}]`
              : `state[${JSON.stringify(field)}] === undefined ? ${initializer}.safeParse(undefined).data : state[${JSON.stringify(field)}]`;
          return domainStateKey === undefined
            ? `${readField(field)} = ${value};`
            : `state[${JSON.stringify(field)}] = ${value};`;
        })
        .join(" ");
  const trustedAssignments = fields
    .map((field) => {
      const initializer = fieldInitializers.get(field);
      const value = valueRepresentation
        ? "state"
        : initializer === undefined
          ? `state[${JSON.stringify(field)}]`
          : `state[${JSON.stringify(field)}] === undefined ? ${initializer}.safeParse(undefined).data : state[${JSON.stringify(field)}]`;
      const target = valueRepresentation
        ? "instance.value"
        : domainStateKey !== undefined
          ? `state[${JSON.stringify(field)}]`
          : managedStorage.has(field)
            ? `instance[${managedStorage.get(field)}]`
            : `instance[${JSON.stringify(field)}]`;
      if (domainStateKey !== undefined && initializer === undefined) return "";
      return `${target} = ${value};`;
    })
    .join(" ");
  const attachState =
    domainStateKey === undefined ? "" : ` ${valueRepresentation ? "instance" : "this"}[${domainStateKey}] = state;`;
  const events = artifact.aggregate
    ? ` Object.defineProperty(this, ${eventBufferKey}, { configurable: false, enumerable: false, value: [], writable: true });`
    : "";
  const freeze = artifact.frozen ? " Object.freeze(this);" : "";
  const abstractGuard = artifact.abstract
    ? `if (this === ${binding}) throw new Error("Cannot create an instance of an abstract JIT class"); `
    : "";
  // A configured policy needs the issues rather than an exception, so the
  // factory validates first and constructs a value it already trusts. An
  // unconfigured class keeps the constructor-validating shape it had.
  const policy = artifact.policy;
  const assertionCall = (value: string): string =>
    policy?.assertions === undefined
      ? ""
      : `const outcome = __assert(${value}); if (outcome !== undefined) return __failure(__assertFailure(outcome, ${value})); `;
  const policyCreate = unvalidatedDdd
    ? policy === undefined
      ? materializerNeedsIssues
        ? `const result = ${materializer}.safeParse(${creationInput}); if (!result.success) throw new JITValidationError(result.issues); return new this(result.data, __construct, true);`
        : `return new this(${materializer}.parse(${creationInput}), __construct, true);`
      : !policy.create
        ? undefined
        : `const result = ${materializer}.safeParse(${creationInput}); if (!result.success) return __failure(__error(result.issues)); ${assertionCall("result.data")}return __success(new this(result.data, __construct, true));`
    : policy === undefined || !policy.create
      ? undefined
      : fastPolicyCreate
        ? `let __createdState; if (${validationBinding}.is(${creationInput})) __createdState = ${creationInput}; else { const result = ${validationBinding}.safeParse(${creationInput}); if (!result.success) return __failure(__error(result.issues)); __createdState = result.data; } ${assertionCall("__createdState")}return __success(new this(__createdState, __construct, true));`
        : `const result = ${validationBinding}.safeParse(${creationInput}); if (!result.success) return __failure(__error(result.issues)); ${assertionCall("result.data")}return __success(new this(result.data, __construct, true));`;
  const policyHydrate = unvalidatedDdd
    ? policy === undefined
      ? materializerNeedsIssues
        ? `const result = ${hydrateMaterializer}.safeParse(${hydrationInput}); if (!result.success) throw new JITValidationError(result.issues); return new this(result.data, __construct, true);`
        : `return new this(${hydrateMaterializer}.parse(${hydrationInput}), __construct, true);`
      : !policy.hydrate
        ? undefined
        : `const result = ${hydrateMaterializer}.safeParse(${hydrationInput}); if (!result.success) return __failure(__error(result.issues)); ${assertionCall("result.data")}return __success(new this(result.data, __construct, true));`
    : policy === undefined || !policy.hydrate
      ? undefined
      : fastPolicyHydrate
        ? `let __hydratedState; if (${hydrateBinding}.is(${hydrationInput})) __hydratedState = ${hydrationInput}; else { const result = ${hydrateBinding}.safeParse(${hydrationInput}); if (!result.success) return __failure(__error(result.issues)); __hydratedState = result.data; } ${assertionCall("__hydratedState")}return __success(new this(__hydratedState, __construct, true));`
        : `const result = ${hydrateBinding}.safeParse(${hydrationInput}); if (!result.success) return __failure(__error(result.issues)); ${assertionCall("result.data")}return __success(new this(result.data, __construct, true));`;
  const create = artifact.domainEvent
    ? `const result = ${validationBinding}.safeParse(input); if (!result.success) throw new JITValidationError(result.issues); return new this({ id: globalThis.crypto?.randomUUID?.() ?? \`evt_\${Date.now().toString(36)}_\${Math.random().toString(36).slice(2)}\`, type: ${JSON.stringify(artifact.domainEvent.type)}, version: ${artifact.domainEvent.version}, occurredAt: new Date(), payload: result.data }, __construct);`
    : (policyCreate ?? `return new this(${creationInput}, __construct);`);
  const hydrate = artifact.domainEvent
    ? `if (state === null || typeof state !== "object" || state.type !== ${JSON.stringify(artifact.domainEvent.type)} || state.version !== ${artifact.domainEvent.version} || typeof state.id !== "string") throw new JITValidationError([]); const occurredAt = state.occurredAt instanceof Date ? state.occurredAt : new Date(state.occurredAt); if (Number.isNaN(occurredAt.getTime())) throw new JITValidationError([]); const result = ${validationBinding}.safeParse(state.payload); if (!result.success) throw new JITValidationError(result.issues); return new this({ ...state, occurredAt, payload: result.data }, __construct);`
    : (policyHydrate ??
      `const result = ${hydrateBinding}.safeParse(${hydrationInput}); if (!result.success) throw new JITValidationError(result.issues); return new this(result.data, __construct, true);`);
  const constructionGuard =
    artifact.construction === "factory"
      ? `if (token !== __construct && token !== true) throw new Error("This Runtime Type uses factory construction; call its create() or hydrate() factory"); `
      : "";
  const constructorSource = artifact.domainEvent
    ? `constructor(state, token) { ${constructionGuard}${assignments}${events}${freeze} }`
    : `constructor(input, token, validated) { ${constructionGuard}const state = token === true || validated === true ? input : ${unvalidatedDdd && policy === undefined && !materializerNeedsIssues ? `${validationBinding}.parse(${creationInput})` : `(() => { const result = ${validationBinding}.safeParse(${creationInput}); if (!result.success) throw new JITValidationError(result.issues); return result.data; })()`}; ${assignments}${attachState}${events}${freeze} }`;
  const trustedMaterializer =
    slots.size > 0
      ? `static ["__jitMaterialize"](state) { return new this(state, __construct, true); }`
      : `static ["__jitMaterialize"](state) { const instance = Object.create(this.prototype); ${trustedAssignments}${domainStateKey === undefined ? "" : ` instance[${domainStateKey}] = state;`}${artifact.aggregate ? ` Object.defineProperty(instance, ${eventBufferKey}, { configurable: false, enumerable: false, value: [], writable: true });` : ""}${artifact.frozen ? " Object.freeze(instance);" : ""} return instance; }`;
  context.js.push(`${declaration} /*#__PURE__*/ (() => {`);
  context.js.push("  const __construct = Symbol();");
  if (domainStateKey !== undefined) context.js.push(`  const ${domainStateKey} = Symbol();`);
  if (eventBufferKey !== undefined) context.js.push(`  const ${eventBufferKey} = Symbol();`);
  for (const managed of managedStorage.values()) context.js.push(`  const ${managed} = Symbol();`);
  if (boundaryInputName !== undefined) {
    const checks = noConstructorFields
      .map((field) => `Object.prototype.hasOwnProperty.call(input, ${JSON.stringify(field)})`)
      .join(" || ");
    context.js.push(
      `  const ${boundaryInputName} = (input) => { if (input === null || typeof input !== "object" || !(${checks})) return input; const state = { ...input }; ${noConstructorFields.map((field) => `delete state[${JSON.stringify(field)}];`).join(" ")} return state; };`
    );
  }
  if (policy !== undefined) {
    const policyLines = emitClassPolicy(context, policy, reportName);
    if (policyLines === undefined) return undefined;
    context.js.push(...policyLines);
  }
  if (helpers.length > 0) context.js.push(`  ${helpers.join("\n  ")}`);
  context.js.push(`  return class ${binding} {`);
  context.js.push(...[...slots.values()].map((slot) => `    ${slot};`));
  context.js.push(`    ${constructorSource}`);
  context.js.push(`    ${trustedMaterializer}`);
  if (artifact.factories.create !== false)
    context.js.push(
      `    static ${context.classMemberName(artifact.factories.create)}(input) { ${abstractGuard}${create} }`
    );
  if (artifact.factories.hydrate !== false)
    context.js.push(
      `    static ${context.classMemberName(artifact.factories.hydrate)}(state) { ${abstractGuard}${hydrate} }`
    );
  if (artifact.domainEvent)
    context.js.push(
      `    static type = ${JSON.stringify(artifact.domainEvent.type)};`,
      `    static version = ${artifact.domainEvent.version};`,
      `    static ["~event"] = /*#__PURE__*/ Object.freeze({ version: 1, type: ${JSON.stringify(artifact.domainEvent.type)}, schemaVersion: ${artifact.domainEvent.version} });`,
      `    get ["~event"]() { return ${binding}["~event"]; }`
    );
  if (valueRepresentation) context.js.push("    toJSON() { return this.value; }");
  context.js.push(...accessorDefinitions.map((definition) => `    ${definition}`));
  context.js.push(...methods.map((method) => `    ${method}`));
  context.js.push("  };");
  context.js.push(`})()${assertedType === undefined ? "" : ` as unknown as ${assertedType}`};`);
  return { binding, type };
}
