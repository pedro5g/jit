import { emitCodec } from "../compiler/codec/emit-codec.js";
import { optimizeExecutionPlan } from "../compiler/execution-optimize.js";
import type { ExecutionPlan, ExecutionStage } from "../compiler/execution-plan.js";
import { buildMapperPlan, type MapperOverridesInput } from "../compiler/mapper/build-mapper-plan.js";
import { emitMapperSource } from "../compiler/mapper.js";
import { emitSerialize } from "../compiler/serialize/emit-serialize.js";
import { canUseFastParse } from "../compiler/validate/emit-validate-support.js";
import type * as ATS from "../core/ats/index.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import { type AotComposedExecutionHost, emitComposedExecutionArtifact } from "./emit-composed-execution.js";

type EmittedBinding = { readonly binding: string; readonly type: string };
type OperationArtifact = Extract<CompiledArtifact, { readonly kind: "operation" }>;
type ValidatorSelection = {
  readonly is: boolean;
  readonly safeParse: boolean;
  readonly parse?: boolean;
  readonly resolveDefaults?: boolean;
  readonly materializeRuntimeTypes?: boolean;
  readonly maxIssues?: number;
};

export interface AotExecutionHost extends AotComposedExecutionHost {
  readonly classArtifacts: ReadonlyMap<unknown, Extract<CompiledArtifact, { readonly kind: "class" }>>;
  emitStringifyChunks(schema: ATS.AnyTypeSchema, options: { readonly chunkBytes?: number }): string | undefined;
  emitValidatorBinding(
    binding: string,
    schema: ATS.AnyTypeSchema,
    reportName: string,
    operation: string,
    selection: ValidatorSelection
  ): string | undefined;
  emitOperationArtifact(
    binding: string,
    declaration: string,
    artifact: OperationArtifact,
    reportName: string,
    type: string
  ): EmittedBinding | undefined;
}

/** Emits the AOT forms of execution plans that do not need a fused closure. */
export function emitExecutionArtifact(
  host: AotExecutionHost,
  binding: string,
  declaration: string,
  plan: ExecutionPlan,
  reportName: string,
  type: string
): EmittedBinding | undefined {
  return new ExecutionArtifactEmitter(host, binding, declaration, plan, reportName, type).emit();
}

class ExecutionArtifactEmitter {
  readonly #host: AotExecutionHost;
  readonly #binding: string;
  readonly #declaration: string;
  readonly #plan: ExecutionPlan;
  readonly #reportName: string;
  readonly #type: string;
  readonly #stages: readonly ExecutionStage[];

  constructor(
    host: AotExecutionHost,
    binding: string,
    declaration: string,
    plan: ExecutionPlan,
    reportName: string,
    type: string
  ) {
    this.#host = host;
    this.#binding = binding;
    this.#declaration = declaration;
    this.#plan = plan;
    this.#reportName = reportName;
    this.#type = type;
    this.#stages = optimizeExecutionPlan(plan).stages;
  }

  emit(): EmittedBinding | undefined {
    const construct = this.#stages.find((stage) => stage.kind === "construct");
    if (construct?.kind === "construct" && !this.#host.classBindings.has(construct.target)) {
      this.#skip(
        "construct",
        "AOT class construction requires exporting the Runtime Class artifact alongside the execution pipeline"
      );
      return undefined;
    }
    const chunks = this.#stages.find((stage) => stage.kind === "json.encode" && stage.mode === "chunks");

    if (chunks?.kind === "json.encode") return this.#emitChunks(chunks);
    if (this.#stages.some((stage) => this.#isComposed(stage))) return this.#emitComposed();

    const map = this.#stages.find((stage) => stage.kind === "map");
    if (map?.kind === "map") return this.#emitMap(map);

    const validation = this.#stages.find((stage) => stage.kind === "validate");
    if (validation?.kind === "validate") return this.#emitValidation(validation);

    return this.#emitTerminalOperations();
  }

  #isComposed(stage: ExecutionStage): boolean {
    return (
      stage.kind === "query" ||
      stage.kind === "aggregate" ||
      stage.kind === "map" ||
      stage.kind === "transform" ||
      stage.kind === "update" ||
      stage.kind === "security"
    );
  }

  #emitted(): EmittedBinding {
    return { binding: this.#binding, type: this.#type };
  }

  #emitChunks(stage: Extract<ExecutionStage, { readonly kind: "json.encode" }>): EmittedBinding | undefined {
    const source = this.#host.emitStringifyChunks(stage.schema ?? this.#plan.schema, {
      ...(stage.chunkBytes === undefined ? {} : { chunkBytes: stage.chunkBytes }),
    });

    if (!source) return undefined;
    this.#host.js.push(`${this.#declaration} /*#__PURE__*/ (${source});`);
    return this.#emitted();
  }

  #emitComposed(): EmittedBinding | undefined {
    return emitComposedExecutionArtifact(
      this.#host,
      this.#binding,
      this.#declaration,
      this.#plan,
      this.#reportName,
      this.#type
    );
  }

  #emitMap(stage: Extract<ExecutionStage, { readonly kind: "map" }>): EmittedBinding | undefined {
    const mapping = stage.bindings[0];

    if (mapping === null || typeof mapping !== "object" || Array.isArray(mapping)) {
      this.#skip("map", "mapping descriptor is malformed");
      return undefined;
    }
    const mapperPlan = this.#host.tryEmit(this.#reportName, "map", this.#host.skipped, () =>
      buildMapperPlan(stage.source, stage.target, mapping as MapperOverridesInput)
    );

    if (!mapperPlan) return undefined;
    const inlined = this.#host.inlineBindings(mapperPlan.bindingNames, mapperPlan.bindings);

    if (inlined === undefined) {
      this.#skip("map", "mapping callbacks cannot be serialized ahead of time");
      return undefined;
    }
    const source = this.#host.tryEmit(this.#reportName, "map", this.#host.skipped, () =>
      emitMapperSource(stage.source, stage.target, mapping as MapperOverridesInput, [stage.many ? "many" : "map"])
    );

    if (!source) return undefined;
    const method = stage.many ? "many" : "map";
    if (this.#stages.some((candidate) => candidate.kind === "json.encode")) {
      return this.#emitMappedJson(source, inlined, method);
    }
    this.#host.js.push(`${this.#declaration} /*#__PURE__*/ ((mapper) => mapper.${method})((() => {`);
    this.#host.js.push(...inlined.map((line) => `  ${line}`));
    this.#host.js.push(...this.#host.indentBlock(`return (${source});`));
    this.#host.js.push("})());");
    return this.#emitted();
  }

  #emitMappedJson(source: string, inlined: readonly string[], method: "map" | "many"): EmittedBinding | undefined {
    const serialize = this.#host.tryEmit(this.#reportName, "json.encode", this.#host.skipped, () =>
      emitSerialize(this.#plan.schema)
    );

    if (!serialize) return undefined;
    this.#host.js.push(
      `${this.#declaration} /*#__PURE__*/ ((mapper, stringify) => (value) => stringify(mapper.${method}(value)))((() => {`
    );
    this.#host.js.push(...inlined.map((line) => `  ${line}`));
    this.#host.js.push(...this.#host.indentBlock(`return (${source});`));
    this.#host.js.push(`})()), (${serialize}));`);
    return this.#emitted();
  }

  #emitValidation(stage: Extract<ExecutionStage, { readonly kind: "validate" }>): EmittedBinding | undefined {
    if (stage.operation === "issues" || stage.operation === "parseAsync" || stage.operation === "safeParseAsync") {
      this.#skip(stage.operation, "this validation sink is runtime-only in AOT output");
      return undefined;
    }
    const construct = this.#stages.find((candidate) => candidate.kind === "construct");
    const classBinding = construct?.kind === "construct" ? this.#host.classBindings.get(construct.target) : undefined;
    const classArtifact = construct?.kind === "construct" ? this.#host.classArtifacts.get(construct.target) : undefined;
    const fastParse =
      (stage.operation === "parse" || stage.operation === "safeParse") &&
      classBinding === undefined &&
      canUseFastParse(this.#plan.schema);
    const validator = this.#host.emitValidatorBinding(
      this.#binding,
      this.#plan.schema,
      this.#reportName,
      stage.operation,
      {
        is: stage.operation === "is" || fastParse,
        safeParse: stage.operation !== "is",
        ...(classBinding ? { materializeRuntimeTypes: false } : {}),
        ...(classArtifact?.domainEvent ? { resolveDefaults: false } : {}),
        ...(stage.maxIssues === undefined ? {} : { maxIssues: stage.maxIssues }),
      }
    );

    if (!validator) return undefined;
    return this.#emitValidationResult(stage, validator, fastParse, classBinding);
  }

  #emitValidationResult(
    stage: Extract<ExecutionStage, { readonly kind: "validate" }>,
    validator: string,
    fastParse: boolean,
    classBinding: string | undefined
  ): EmittedBinding | undefined {
    const hasJsonDecode = this.#stages.some((candidate) => candidate.kind === "json.decode");
    const hasBinaryDecode = this.#stages.some((candidate) => candidate.kind === "binary.decode");

    if (stage.operation === "is") {
      if (hasJsonDecode || hasBinaryDecode)
        return this.#skipAndReturn("is", "is must receive a value source in AOT output");
      this.#host.js.push(`${this.#declaration} /*#__PURE__*/ ((v) => v.is)(${validator});`);
    } else if (stage.operation === "safeParse") {
      if (hasJsonDecode || hasBinaryDecode)
        return this.#skipAndReturn("safeParse", "safeParse source composition is not an AOT sink");
      this.#host.js.push(
        fastParse
          ? `${this.#declaration} (value) => ${validator}.is(value) ? { success: true, data: value } : ${validator}.safeParse(value);`
          : `${this.#declaration} /*#__PURE__*/ ((v) => v.safeParse)(${validator});`
      );
    } else if (hasJsonDecode) {
      this.#emitJsonValidation(validator, fastParse, classBinding);
    } else if (hasBinaryDecode) {
      return this.#emitBinaryValidation(validator, fastParse, classBinding);
    } else {
      this.#emitValueValidation(validator, fastParse, classBinding);
    }
    return this.#emitted();
  }

  #emitJsonValidation(validator: string, fastParse: boolean, classBinding: string | undefined): void {
    this.#host.markValidationError();
    this.#host.js.push(
      fastParse
        ? `${this.#declaration} (json) => { const value = JSON.parse(json); if (${validator}.is(value)) return value; const r = ${validator}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
        : `${this.#declaration} (json) => { const r = ${validator}.safeParse(JSON.parse(json)); if (r.success) return ${classBinding ? `new ${classBinding}(r.data, true)` : "r.data"}; throw new JITValidationError(r.issues); };`
    );
  }

  #emitBinaryValidation(
    validator: string,
    fastParse: boolean,
    classBinding: string | undefined
  ): EmittedBinding | undefined {
    const codec = this.#host.tryEmit(this.#reportName, "binary.decode", this.#host.skipped, () =>
      emitCodec(this.#plan.schema)
    );

    if (!codec) return undefined;
    const bindings = this.#host.inlineCodecBindings(codec.bindingNames, codec.bindingValues);

    if (bindings === undefined) return this.#skipAndReturn("binary.decode", "codec bindings cannot be serialized");
    this.#host.markValidationError();
    this.#host.js.push(
      fastParse
        ? `${this.#declaration} /*#__PURE__*/ ((codec, is, safeParse) => (bytes) => { const value = codec.decode(bytes); if (is(value)) return value; const r = safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); })((() => {`
        : `${this.#declaration} /*#__PURE__*/ ((codec, safeParse) => (bytes) => { const r = safeParse(codec.decode(bytes)); if (r.success) return ${classBinding ? `new ${classBinding}(r.data, true)` : "r.data"}; throw new JITValidationError(r.issues); })((() => {`
    );
    this.#host.js.push(...bindings.map((line) => `  ${line}`));
    this.#host.js.push(...this.#host.indentBlock(codec.source));
    this.#host.js.push(
      fastParse ? `})()), ${validator}.is, ${validator}.safeParse);` : `})()), ${validator}.safeParse);`
    );
    return this.#emitted();
  }

  #emitValueValidation(validator: string, fastParse: boolean, classBinding: string | undefined): void {
    this.#host.markValidationError();
    this.#host.js.push(
      fastParse
        ? `${this.#declaration} (value) => { if (${validator}.is(value)) return value; const r = ${validator}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
        : `${this.#declaration} (value) => { const r = ${validator}.safeParse(value); if (r.success) return ${classBinding ? `new ${classBinding}(r.data, true)` : "r.data"}; throw new JITValidationError(r.issues); };`
    );
  }

  #emitTerminalOperations(): EmittedBinding | undefined {
    const hasJsonDecode = this.#stages.some((stage) => stage.kind === "json.decode");
    const hasJsonEncode = this.#stages.some((stage) => stage.kind === "json.encode");
    const hasBinaryDecode = this.#stages.some((stage) => stage.kind === "binary.decode");
    const hasBinaryEncode = this.#stages.some((stage) => stage.kind === "binary.encode");
    const operation = this.#stages.find((stage) => stage.kind === "operation");

    if (hasJsonDecode) {
      this.#host.js.push(`${this.#declaration} JSON.parse;`);
      return this.#emitted();
    }
    if (hasJsonEncode) return this.#emitJsonEncode();
    if (hasBinaryDecode || hasBinaryEncode) return this.#emitBinaryCodec(hasBinaryDecode);
    if (operation?.kind === "operation") {
      return this.#host.emitOperationArtifact(
        this.#binding,
        this.#declaration,
        { kind: "operation", schema: this.#plan.schema, op: operation.operation },
        this.#reportName,
        this.#type
      );
    }
    this.#skip("execution", "no AOT backend matches this execution plan");
    return undefined;
  }

  #emitJsonEncode(): EmittedBinding | undefined {
    const source = this.#host.tryEmit(this.#reportName, "json.encode", this.#host.skipped, () =>
      emitSerialize(this.#plan.schema)
    );

    if (!source) return undefined;
    this.#host.js.push(`${this.#declaration} ${this.#host.asExpression(source, "stringify")};`);
    return this.#emitted();
  }

  #emitBinaryCodec(decode: boolean): EmittedBinding | undefined {
    const operation = decode ? "binary.decode" : "binary.encode";
    const codec = this.#host.tryEmit(this.#reportName, operation, this.#host.skipped, () =>
      emitCodec(this.#plan.schema)
    );

    if (!codec) return undefined;
    const bindings = this.#host.inlineCodecBindings(codec.bindingNames, codec.bindingValues);

    if (bindings === undefined) return this.#skipAndReturn("binary", "codec bindings cannot be serialized");
    this.#host.js.push(
      `${this.#declaration} /*#__PURE__*/ ((codec) => codec.${decode ? "decode" : "encode"})((() => {`
    );
    this.#host.js.push(...bindings.map((line) => `  ${line}`));
    this.#host.js.push(...this.#host.indentBlock(codec.source));
    this.#host.js.push("})());");
    return this.#emitted();
  }

  #skip(operation: string, reason: string): void {
    this.#host.skipped.push({ schema: this.#reportName, operation, reason });
  }

  #skipAndReturn(operation: string, reason: string): undefined {
    this.#skip(operation, reason);
    return undefined;
  }
}
