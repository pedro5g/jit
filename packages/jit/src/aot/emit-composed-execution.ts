import { emitCodec } from "../compiler/codec/emit-codec.js";
import { optimizeExecutionPlan } from "../compiler/execution-optimize.js";
import type { ExecutionPlan, ExecutionStage } from "../compiler/execution-plan.js";
import { buildMapperPlan, type MapperOverridesInput } from "../compiler/mapper/build-mapper-plan.js";
import { emitMapperSource } from "../compiler/mapper.js";
import { emitMaskSource } from "../compiler/mask.js";
import { emitTransformSource } from "../compiler/object-ops.js";
import { emitQuerySource } from "../compiler/query.js";
import { emitSanitizeSource, sanitizeChainBindings } from "../compiler/sanitize.js";
import { emitSerialize } from "../compiler/serialize/emit-serialize.js";
import { emitUpdateSource } from "../compiler/update.js";
import { canUseFastParse, emitValidator } from "../compiler/validate/emit-validate.js";
import type * as ATS from "../core/ats/index.js";
import type { SkippedOperation } from "./generate.js";

export interface AotComposedExecutionHost {
  readonly js: string[];
  readonly skipped: SkippedOperation[];
  readonly classBindings: ReadonlyMap<unknown, string>;
  markValidationError(): void;
  internalIdentifier(preferred: string): string;
  tryEmit<TValue>(
    schema: string,
    operation: string,
    skipped: SkippedOperation[],
    emitter: () => TValue
  ): TValue | undefined;
  inlineBindings(names: readonly string[], values: readonly unknown[]): string[] | undefined;
  inlineCodecBindings(names: readonly string[], values: readonly unknown[]): string[] | undefined;
  serializeStaticData(value: unknown): string | undefined;
  asExpression(source: string, label: string): string;
  indentBlock(source: string): string[];
}

type EmittedBinding = { readonly binding: string; readonly type: string };
type StageHandler = (stage: ExecutionStage, index: number) => number | undefined;

/** Emits one fused AOT closure for a composed execution plan. */
export function emitComposedExecutionArtifact(
  host: AotComposedExecutionHost,
  binding: string,
  declaration: string,
  plan: ExecutionPlan,
  name: string,
  type: string
): EmittedBinding | undefined {
  return new ComposedExecutionEmitter(host, binding, declaration, plan, name, type).emit();
}

class ComposedExecutionEmitter {
  readonly #host: AotComposedExecutionHost;
  readonly #binding: string;
  readonly #declaration: string;
  readonly #plan: ExecutionPlan;
  readonly #name: string;
  readonly #type: string;
  readonly #stages: readonly ExecutionStage[];
  readonly #setup: string[] = [];
  readonly #body: string[] = ["let value = input;"];
  #manyIndex = 0;

  constructor(
    host: AotComposedExecutionHost,
    binding: string,
    declaration: string,
    plan: ExecutionPlan,
    name: string,
    type: string
  ) {
    this.#host = host;
    this.#binding = binding;
    this.#declaration = declaration;
    this.#plan = plan;
    this.#name = name;
    this.#type = type;
    this.#stages = optimizeExecutionPlan(plan).stages;
  }

  #emitComposedValidator = (schema: ATS.AnyTypeSchema, materializeRuntimeTypes = true): string | undefined => {
    const fastParse = canUseFastParse(schema);
    const validator = this.#host.tryEmit(this.#name, "validate", this.#host.skipped, () =>
      emitValidator(schema, {
        is: fastParse,
        safeParse: true,
        safeParseAsync: false,
        materializeRuntimeTypes,
      })
    );

    if (!validator) return undefined;
    const inlined = this.#host.inlineBindings(validator.bindings.names, validator.bindings.values);

    if (inlined === undefined) {
      this.#host.skipped.push({
        schema: this.#name,
        operation: "validate",
        reason: "refine/transform/default callbacks cannot be serialized ahead of time",
      });
      return undefined;
    }
    const validatorName = this.#host.internalIdentifier(`${this.#binding}_validator`);

    this.#setup.push(`const ${validatorName} = /*#__PURE__*/ (() => {`);
    this.#setup.push(...inlined.map((line) => `  ${line}`));
    this.#setup.push(...this.#host.indentBlock(validator.source));
    this.#setup.push("})();");
    return validatorName;
  };

  #emitComposedCodec = (
    schema: ATS.AnyTypeSchema,
    operation: "binary.decode" | "binary.encode"
  ): string | undefined => {
    const codec = this.#host.tryEmit(this.#name, operation, this.#host.skipped, () => emitCodec(schema));

    if (!codec) return undefined;
    const inlined = this.#host.inlineCodecBindings(codec.bindingNames, codec.bindingValues);

    if (inlined === undefined) {
      this.#host.skipped.push({
        schema: this.#name,
        operation,
        reason: "codec bindings cannot be serialized",
      });
      return undefined;
    }
    const codecName = this.#host.internalIdentifier(`${this.#binding}_codec`);

    this.#setup.push(`const ${codecName} = /*#__PURE__*/ (() => {`);
    this.#setup.push(...inlined.map((line) => `  ${line}`));
    this.#setup.push(...this.#host.indentBlock(codec.source));
    this.#setup.push("})();");
    return codecName;
  };

  #emitComposedQuery = (stage: Extract<ExecutionStage, { readonly kind: "query" | "aggregate" }>) => {
    const source = this.#host.tryEmit(this.#name, "query", this.#host.skipped, () =>
      emitQuerySource(stage.source, stage.program)
    );

    if (!source) return undefined;
    const bindings = this.#host.inlineBindings(
      stage.program.bindings.map((_, index) => `__q${index}`),
      stage.program.bindings
    );

    if (bindings === undefined) {
      this.#host.skipped.push({
        schema: this.#name,
        operation: "query",
        reason: "query bindings cannot be serialized ahead of time",
      });
      return undefined;
    }
    const queryName = this.#host.internalIdentifier(`${this.#binding}_query`);

    this.#setup.push(`const ${queryName} = /*#__PURE__*/ (() => {`);
    this.#setup.push(...bindings.map((line) => `  ${line}`));
    this.#setup.push(...this.#host.indentBlock(`return (${source});`));
    this.#setup.push("})();");
    return queryName;
  };

  #emitComposedMapper = (
    stage: Extract<ExecutionStage, { readonly kind: "map" }>,
    operation: "map" | "many" = stage.many ? "many" : "map"
  ): string | undefined => {
    const mapping = stage.bindings[0];

    if (mapping === null || typeof mapping !== "object" || Array.isArray(mapping)) {
      this.#host.skipped.push({
        schema: this.#name,
        operation: "map",
        reason: "mapping descriptor is malformed",
      });
      return undefined;
    }
    const mapperPlan = this.#host.tryEmit(this.#name, "map", this.#host.skipped, () =>
      buildMapperPlan(stage.source, stage.target, mapping as MapperOverridesInput)
    );

    if (!mapperPlan) return undefined;
    const inlined = this.#host.inlineBindings(mapperPlan.bindingNames, mapperPlan.bindings);

    if (inlined === undefined) {
      this.#host.skipped.push({
        schema: this.#name,
        operation: "map",
        reason: "mapping callbacks cannot be serialized ahead of time",
      });
      return undefined;
    }
    const source = this.#host.tryEmit(this.#name, "map", this.#host.skipped, () =>
      emitMapperSource(stage.source, stage.target, mapping as MapperOverridesInput, [operation])
    );

    if (!source) return undefined;
    const mapperName = this.#host.internalIdentifier(`${this.#binding}_mapper`);

    this.#setup.push(`const ${mapperName} = /*#__PURE__*/ (() => {`);
    this.#setup.push(...inlined.map((line) => `  ${line}`));
    this.#setup.push(...this.#host.indentBlock(`return (${source});`));
    this.#setup.push("})();");
    return mapperName;
  };

  #emitComposedTransform = (stage: Extract<ExecutionStage, { readonly kind: "transform" }>): string | undefined => {
    const keys = Object.keys(stage.transforms);
    const bindings = this.#host.inlineBindings(
      keys.map((_, index) => `__t${index}`),
      keys.map((key) => stage.transforms[key])
    );

    if (bindings === undefined) {
      this.#host.skipped.push({
        schema: this.#name,
        operation: "transform",
        reason: "transform callbacks cannot be serialized ahead of time",
      });
      return undefined;
    }
    const source = this.#host.tryEmit(this.#name, "transform", this.#host.skipped, () =>
      emitTransformSource(stage.source, stage.transforms as never)
    );

    if (!source) return undefined;
    const transformName = this.#host.internalIdentifier(`${this.#binding}_transform`);

    this.#setup.push(`const ${transformName} = /*#__PURE__*/ (() => {`);
    this.#setup.push(...bindings.map((line) => `  ${line}`));
    this.#setup.push(...this.#host.indentBlock(`return (${source});`));
    this.#setup.push("})();");
    return transformName;
  };

  #emitComposedUpdate = (
    stage: Extract<ExecutionStage, { readonly kind: "update" }>
  ): { readonly update: string; readonly patch: string } | undefined => {
    const patch = this.#host.serializeStaticData(stage.patch);

    if (patch === undefined) {
      this.#host.skipped.push({
        schema: this.#name,
        operation: "update",
        reason: "update patches must be serializable static data for AOT output",
      });
      return undefined;
    }
    const source = this.#host.tryEmit(this.#name, "update", this.#host.skipped, () => emitUpdateSource(stage.schema));

    if (!source) return undefined;
    const update = this.#host.internalIdentifier(`${this.#binding}_update`);
    const patchName = this.#host.internalIdentifier(`${this.#binding}_patch`);

    this.#setup.push(`const ${update} = ${this.#host.asExpression(source, "update")};`);
    this.#setup.push(`const ${patchName} = ${patch};`);
    return { update, patch: patchName };
  };

  #emitComposedSecurity = (stage: Extract<ExecutionStage, { readonly kind: "security" }>): string | undefined => {
    const source = this.#host.tryEmit(this.#name, stage.operation, this.#host.skipped, () =>
      stage.operation === "mask" ? emitMaskSource(stage.schema) : emitSanitizeSource(stage.schema)
    );

    if (!source) return undefined;
    const securityName = this.#host.internalIdentifier(`${this.#binding}_${stage.operation}`);

    if (stage.operation === "sanitize") {
      this.#setup.push(`const ${securityName} = /*#__PURE__*/ (() => {`);
      this.#setup.push(
        ...sanitizeChainBindings.names.map(
          (bindingName, position) => `  const ${bindingName} = ${String(sanitizeChainBindings.values[position])};`
        )
      );
      this.#setup.push(...this.#host.indentBlock(`return ${this.#host.asExpression(source, "scrub")};`));
      this.#setup.push("})();");
    } else {
      this.#setup.push(`const ${securityName} = ${this.#host.asExpression(source, "scrub")};`);
    }
    return securityName;
  };

  #emitManyApplication = (applied: string, patch?: string): void => {
    const list = `list${this.#manyIndex}`;
    const length = `len${this.#manyIndex}`;
    const out = `out${this.#manyIndex}`;
    const index = `i${this.#manyIndex++}`;

    this.#body.push(`const ${list} = value;`);
    this.#body.push(`const ${length} = ${list}.length;`);
    this.#body.push(`const ${out} = new Array(${length});`);
    this.#body.push(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
    this.#body.push(`  ${out}[${index}] = ${applied}(${list}[${index}]${patch ? `, ${patch}` : ""});`);
    this.#body.push("}");
    this.#body.push(`value = ${out};`);
  };

  #emitMappedJsonArray = (mapper: string, stringify: string): void => {
    const list = `mappedList${this.#manyIndex}`;
    const length = `mappedLen${this.#manyIndex}`;
    const item = `mappedItem${this.#manyIndex}`;
    const index = `mappedIndex${this.#manyIndex++}`;
    const json = `mappedJson${this.#manyIndex}`;

    this.#body.push(`const ${list} = value;`);
    this.#body.push(`const ${length} = ${list}.length;`);
    this.#body.push(`let ${json} = "[";`);
    this.#body.push(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
    this.#body.push(`  if (${index} !== 0) ${json} += ",";`);
    this.#body.push(`  const ${item} = ${mapper}.map(${list}[${index}]);`);
    this.#body.push(`  ${json} += ${stringify}(${item});`);
    this.#body.push("}");
    this.#body.push(`${json} += "]";`);
    this.#body.push(`value = ${json};`);
  };

  emit(): EmittedBinding | undefined {
    if (!this.#emitStages()) return undefined;
    this.#body.push("return value;");
    this.#host.js.push(`${this.#declaration} /*#__PURE__*/ (() => {`);
    this.#host.js.push(...this.#setup.map((line) => `  ${line}`));
    this.#host.js.push("  return (input) => {");
    this.#host.js.push(...this.#body.map((line) => `    ${line}`));
    this.#host.js.push("  };");
    this.#host.js.push("})();");
    return { binding: this.#binding, type: this.#type };
  }

  #emitStages = (): boolean => {
    for (let index = 0; index < this.#stages.length; index++) {
      const nextIndex = this.#emitStage(this.#stages[index], index);

      if (nextIndex === undefined) return false;
      index = nextIndex;
    }
    return true;
  };

  #stageHandlers: { readonly [TKind in ExecutionStage["kind"]]: StageHandler } = {
    value: (_stage, index) => index,
    "to.array": (_stage, index) => index,
    "json.decode": (_stage, index) => {
      this.#body.push("value = JSON.parse(value);");
      return index;
    },
    "binary.decode": (stage, index) =>
      this.#emitBinaryDecode(stage as Extract<ExecutionStage, { readonly kind: "binary.decode" }>, index),
    validate: (stage, index) =>
      this.#emitValidation(stage as Extract<ExecutionStage, { readonly kind: "validate" }>, index) ? index : undefined,
    construct: (stage, index) =>
      this.#emitConstruct(stage as Extract<ExecutionStage, { readonly kind: "construct" }>) ? index : undefined,
    query: (stage, index) => this.#emitQueryStage(stage as Extract<ExecutionStage, { readonly kind: "query" }>, index),
    aggregate: (stage, index) =>
      this.#emitAggregateStage(stage as Extract<ExecutionStage, { readonly kind: "aggregate" }>, index),
    map: (stage, index) => this.#emitMapStage(stage as Extract<ExecutionStage, { readonly kind: "map" }>, index),
    transform: (stage, index) =>
      this.#emitTransformStage(stage as Extract<ExecutionStage, { readonly kind: "transform" }>) ? index : undefined,
    update: (stage, index) =>
      this.#emitUpdateStage(stage as Extract<ExecutionStage, { readonly kind: "update" }>) ? index : undefined,
    security: (stage, index) =>
      this.#emitSecurityStage(stage as Extract<ExecutionStage, { readonly kind: "security" }>) ? index : undefined,
    "json.encode": (stage, index) =>
      this.#emitJsonEncode(stage as Extract<ExecutionStage, { readonly kind: "json.encode" }>) ? index : undefined,
    "binary.encode": (stage, index) =>
      this.#emitBinaryEncode(stage as Extract<ExecutionStage, { readonly kind: "binary.encode" }>, index),
    operation: (stage) =>
      this.#emitUnsupportedOperation(stage as Extract<ExecutionStage, { readonly kind: "operation" }>),
  };

  #emitStage = (stage: ExecutionStage, index: number): number | undefined =>
    this.#stageHandlers[stage.kind](stage, index);

  #emitBinaryDecode = (
    stage: Extract<ExecutionStage, { readonly kind: "binary.decode" }>,
    index: number
  ): number | undefined => {
    const codec = this.#emitComposedCodec(stage.schema, "binary.decode");

    if (!codec) return undefined;
    this.#body.push(`value = ${codec}.decode(value);`);
    return index;
  };

  #emitValidation = (stage: Extract<ExecutionStage, { readonly kind: "validate" }>, index: number): boolean => {
    if (stage.operation !== "parse") {
      this.#host.skipped.push({
        schema: this.#name,
        operation: stage.operation,
        reason: "only parse validation can continue into a collection execution pipeline",
      });
      return false;
    }
    const construct = this.#stages[index + 1];
    const constructBinding =
      construct?.kind === "construct" ? this.#host.classBindings.get(construct.target) : undefined;

    if (construct?.kind === "construct" && !constructBinding) {
      this.#host.skipped.push({
        schema: this.#name,
        operation: "construct",
        reason: "AOT class construction requires exporting the Runtime Class artifact alongside the execution pipeline",
      });
      return false;
    }
    const validator = this.#emitComposedValidator(stage.schema, constructBinding === undefined);

    if (!validator) return false;
    this.#host.markValidationError();
    if (canUseFastParse(stage.schema)) {
      this.#body.push(`if (!${validator}.is(value)) {`);
      this.#body.push(`  const result = ${validator}.safeParse(value);`);
      this.#body.push("  if (!result.success) throw new JITValidationError(result.issues);");
      this.#body.push("  value = result.data;");
      this.#body.push("}");
    } else {
      this.#body.push(`const result = ${validator}.safeParse(value);`);
      this.#body.push("if (!result.success) throw new JITValidationError(result.issues);");
      this.#body.push("value = result.data;");
    }
    return true;
  };

  #emitConstruct = (stage: Extract<ExecutionStage, { readonly kind: "construct" }>): boolean => {
    const classBinding = this.#host.classBindings.get(stage.target);

    if (!classBinding) {
      this.#host.skipped.push({
        schema: this.#name,
        operation: "construct",
        reason: "AOT class construction requires exporting the Runtime Class artifact alongside the execution pipeline",
      });
      return false;
    }
    this.#body.push(`value = new ${classBinding}(value, true);`);
    return true;
  };

  #emitQueryStage = (
    _stage: Extract<ExecutionStage, { readonly kind: "query" }>,
    index: number
  ): number | undefined => {
    let finalIndex = index;

    while (finalIndex + 1 < this.#stages.length && this.#stages[finalIndex + 1]?.kind === "query") finalIndex++;
    const aggregate = this.#stages[finalIndex + 1];
    if (aggregate?.kind === "aggregate") finalIndex++;
    const finalStage = this.#stages[finalIndex] as Extract<ExecutionStage, { readonly kind: "query" | "aggregate" }>;
    const query = this.#emitComposedQuery(finalStage);

    if (!query) return undefined;
    this.#body.push(`value = ${query}(value);`);
    return finalIndex;
  };

  #emitAggregateStage = (
    stage: Extract<ExecutionStage, { readonly kind: "aggregate" }>,
    index: number
  ): number | undefined => {
    const query = this.#emitComposedQuery(stage);

    if (!query) return undefined;
    this.#body.push(`value = ${query}(value);`);
    return index;
  };

  #emitMapStage = (stage: Extract<ExecutionStage, { readonly kind: "map" }>, index: number): number | undefined => {
    const nextStage = this.#stages[index + 1];
    const fuseJsonEncode = nextStage?.kind === "json.encode";
    const mapper = this.#emitComposedMapper(stage, fuseJsonEncode || !stage.many ? "map" : "many");

    if (!mapper) return undefined;
    if (!fuseJsonEncode) {
      this.#body.push(`value = ${mapper}.${stage.many ? "many" : "map"}(value);`);
      return index;
    }
    const stringify = this.#host.tryEmit(this.#name, "json.encode", this.#host.skipped, () =>
      emitSerialize(stage.target)
    );

    if (!stringify) return undefined;
    const stringifyName = this.#host.internalIdentifier(`${this.#binding}_stringify`);

    this.#setup.push(`const ${stringifyName} = ${this.#host.asExpression(stringify, "stringify")};`);
    if (stage.many) this.#emitMappedJsonArray(mapper, stringifyName);
    else this.#body.push(`value = ${stringifyName}(${mapper}.map(value));`);
    return index + 1;
  };

  #emitTransformStage = (stage: Extract<ExecutionStage, { readonly kind: "transform" }>): boolean => {
    const transform = this.#emitComposedTransform(stage);

    if (!transform) return false;
    if (stage.many) this.#emitManyApplication(transform);
    else this.#body.push(`value = ${transform}(value);`);
    return true;
  };

  #emitUpdateStage = (stage: Extract<ExecutionStage, { readonly kind: "update" }>): boolean => {
    const update = this.#emitComposedUpdate(stage);

    if (!update) return false;
    if (stage.many) this.#emitManyApplication(update.update, update.patch);
    else this.#body.push(`value = ${update.update}(value, ${update.patch});`);
    return true;
  };

  #emitSecurityStage = (stage: Extract<ExecutionStage, { readonly kind: "security" }>): boolean => {
    const security = this.#emitComposedSecurity(stage);

    if (!security) return false;
    if (stage.many) this.#emitManyApplication(security);
    else this.#body.push(`value = ${security}(value);`);
    return true;
  };

  #emitJsonEncode = (stage: Extract<ExecutionStage, { readonly kind: "json.encode" }>): boolean => {
    const stringify = this.#host.tryEmit(this.#name, "json.encode", this.#host.skipped, () =>
      emitSerialize(stage.schema ?? this.#plan.schema)
    );

    if (!stringify) return false;
    const stringifyName = this.#host.internalIdentifier(`${this.#binding}_stringify`);

    this.#setup.push(`const ${stringifyName} = ${this.#host.asExpression(stringify, "stringify")};`);
    this.#body.push(`value = ${stringifyName}(value);`);
    return true;
  };

  #emitBinaryEncode = (
    stage: Extract<ExecutionStage, { readonly kind: "binary.encode" }>,
    index: number
  ): number | undefined => {
    const codec = this.#emitComposedCodec(stage.schema, "binary.encode");

    if (!codec) return undefined;
    this.#body.push(`value = ${codec}.encode(value);`);
    return index;
  };

  #emitUnsupportedOperation = (stage: Extract<ExecutionStage, { readonly kind: "operation" }>): undefined => {
    this.#host.skipped.push({
      schema: this.#name,
      operation: stage.operation,
      reason: "operation stages cannot follow a collection query",
    });
    return undefined;
  };
}
