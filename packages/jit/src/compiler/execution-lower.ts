import { JITError, JITValidationError } from "../errors/index.js";
import { getArtifact } from "../runtime/artifact-registry.js";
import { emitCodec } from "./codec/emit-codec.js";
import { optimizeExecutionPlan } from "./execution-optimize.js";
import type { ExecutionPlan, ExecutionStage } from "./execution-plan.js";
import { emitStringifyChunksSource } from "./json-chunks.js";
import { warmJsonParseShape } from "./json-parse.js";
import { buildMapperPlan, type MapperOverridesInput } from "./mapper/build-mapper-plan.js";
import { emitMapperSource } from "./mapper.js";
import { emitMaskSource } from "./mask.js";
import { emitTransformSource } from "./object-ops.js";
import { emitQuerySource } from "./query.js";
import { emitSanitizeSource, sanitizeChainBindings } from "./sanitize.js";
import { emitSerialize } from "./serialize/emit-serialize.js";
import { emitUpdateSource } from "./update.js";
import { canUseFastParse, emitValidator } from "./validate/emit-validate.js";

type FunctionLike = (...args: never[]) => unknown;

/**
 * One generated runtime program for an immutable execution descriptor.
 *
 * Every compiler keeps its own source emitter, but the execution backend
 * installs those emitted helpers in one lexical scope and emits a single hot
 * entry function. This removes the old chain of `previous(value)` closures
 * while retaining external bindings for callbacks and unsafe runtime values.
 */
export interface EmittedExecutionPlan {
  readonly source: string;
  readonly bindingNames: readonly string[];
  readonly bindingValues: readonly unknown[];
}

/** Emits the runtime source and bindings for the complete execution plan. */
export function emitExecutionPlan(plan: ExecutionPlan): EmittedExecutionPlan {
  const optimized = optimizeExecutionPlan(plan);
  const setup: string[] = [];
  const body: string[] = ["let value = input;"];
  const bindingNames: string[] = [];
  const bindingValues: unknown[] = [];
  let helperIndex = 0;
  let valueIndex = 0;

  const bind = (value: unknown): string => {
    const name = `__e${bindingNames.length}`;

    bindingNames.push(name);
    bindingValues.push(value);
    return name;
  };

  const helper = (prefix: string): string => `__${prefix}${helperIndex++}`;

  const emitBoundBlock = (
    prefix: string,
    localNames: readonly string[],
    values: readonly unknown[],
    source: string,
    expression = false
  ): string => {
    const name = helper(prefix);
    const args = values.map(bind);

    setup.push(`const ${name} = ((${localNames.join(", ")}) => {`);
    if (expression) setup.push(...indent(`return (${source});`));
    else setup.push(...indent(source));
    setup.push(`})(${args.join(", ")});`);
    return name;
  };

  const emitMany = (helperName: string, patchName?: string): void => {
    const list = `__list${valueIndex}`;
    const length = `__len${valueIndex}`;
    const out = `__out${valueIndex}`;
    const index = `__i${valueIndex++}`;

    body.push(`const ${list} = value;`);
    body.push(`const ${length} = ${list}.length;`);
    body.push(`const ${out} = new Array(${length});`);
    body.push(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
    body.push(`  ${out}[${index}] = ${helperName}(${list}[${index}]${patchName ? `, ${patchName}` : ""});`);
    body.push("}");
    body.push(`value = ${out};`);
  };

  const stages = optimized.stages;

  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index];

    switch (stage.kind) {
      case "value":
      case "to.array":
        break;
      case "json.decode":
        body.push("value = JSON.parse(value);");
        break;
      case "binary.decode": {
        const codec = emitCodec(stage.schema);
        const codecName = emitBoundBlock("codec", codec.bindingNames, codec.bindingValues, codec.source);

        body.push(`value = ${codecName}.decode(value);`);
        break;
      }
      case "validate": {
        const nextStage = stages[index + 1];
        const constructNext = nextStage?.kind === "construct";
        const constructArtifact = constructNext ? getArtifact(nextStage.target) : undefined;
        const strictDomainEvent = constructArtifact?.kind === "class" && constructArtifact.domainEvent !== undefined;
        const fastParse = stage.operation === "parse" && canUseFastParse(stage.schema);
        const validator = emitValidator(stage.schema, {
          is: stage.operation === "is" || fastParse,
          safeParse:
            stage.operation === "parse" ||
            stage.operation === "safeParse" ||
            stage.operation === "parseAsync" ||
            stage.operation === "safeParseAsync" ||
            stage.operation === "issues",
          safeParseAsync: stage.operation === "parseAsync" || stage.operation === "safeParseAsync",
          materializeRuntimeTypes: !constructNext,
          resolveDefaults: !strictDomainEvent,
        });
        const validatorName = emitBoundBlock(
          "validator",
          validator.bindings.names,
          validator.bindings.values,
          validator.source
        );

        switch (stage.operation) {
          case "is":
            body.push(`value = ${validatorName}.is(value);`);
            break;
          case "parse": {
            const error = bind(JITValidationError);

            if (fastParse) {
              const result = `__result${valueIndex++}`;

              body.push(`if (!${validatorName}.is(value)) {`);
              body.push(`  const ${result} = ${validatorName}.safeParse(value);`);
              body.push(`  if (!${result}.success) throw new ${error}(${result}.issues);`);
              body.push(`  value = ${result}.data;`);
              body.push("}");
            } else {
              const result = `__result${valueIndex++}`;

              body.push(`const ${result} = ${validatorName}.safeParse(value);`);
              body.push(`if (!${result}.success) throw new ${error}(${result}.issues);`);
              body.push(`value = ${result}.data;`);
            }
            break;
          }
          case "safeParse":
            body.push(`value = ${validatorName}.safeParse(value);`);
            break;
          case "parseAsync": {
            const error = bind(JITValidationError);

            body.push(
              `return ${validatorName}.safeParseAsync(value).then((result) => { if (!result.success) throw new ${error}(result.issues); return result.data; });`
            );
            break;
          }
          case "safeParseAsync":
            body.push(`return ${validatorName}.safeParseAsync(value);`);
            break;
          case "issues": {
            const result = `__result${valueIndex++}`;

            body.push(`const ${result} = ${validatorName}.safeParse(value);`);
            body.push(`return (function* issues() { if (!${result}.success) yield* ${result}.issues; })();`);
            break;
          }
        }
        break;
      }
      case "construct": {
        const target = bind(stage.target);

        body.push(`value = new ${target}(value, true);`);
        break;
      }
      case "query": {
        let finalStage: Extract<ExecutionStage, { readonly kind: "query" | "aggregate" }> = stage;

        while (index + 1 < stages.length && stages[index + 1]?.kind === "query") {
          index++;
          finalStage = stages[index] as typeof finalStage;
        }
        const aggregate = stages[index + 1];
        if (aggregate?.kind === "aggregate") {
          index++;
          finalStage = aggregate;
        }
        const queryName = emitBoundBlock(
          "query",
          finalStage.program.bindings.map((_, bindingIndex) => `__q${bindingIndex}`),
          finalStage.program.bindings,
          emitQuerySource(finalStage.source, finalStage.program),
          true
        );

        body.push(`value = ${queryName}(value);`);
        break;
      }
      case "aggregate": {
        const queryName = emitBoundBlock(
          "query",
          stage.program.bindings.map((_, bindingIndex) => `__q${bindingIndex}`),
          stage.program.bindings,
          emitQuerySource(stage.source, stage.program),
          true
        );

        body.push(`value = ${queryName}(value);`);
        break;
      }
      case "map": {
        const mapping = stage.bindings[0];
        const nextStage = stages[index + 1];
        const fuseJsonEncode = nextStage?.kind === "json.encode";

        if (mapping === null || typeof mapping !== "object" || Array.isArray(mapping)) {
          throw new JITError("INVALID_OPERATION", "mapping descriptor is malformed");
        }
        const mapperPlan = buildMapperPlan(stage.source, stage.target, mapping as MapperOverridesInput);
        const mapperName = emitBoundBlock(
          "mapper",
          mapperPlan.bindingNames,
          mapperPlan.bindings,
          emitMapperSource(stage.source, stage.target, mapping as MapperOverridesInput, [
            fuseJsonEncode || !stage.many ? "map" : "many",
          ]),
          true
        );

        if (fuseJsonEncode) {
          const stringifyName = helper("stringify");

          setup.push(`const ${stringifyName} = ${emitSerialize(stage.target)};`);
          if (stage.many) emitMappedJsonArray(mapperName, stringifyName, body, valueIndex++);
          else body.push(`value = ${stringifyName}(${mapperName}.map(value));`);
          index++;
        } else {
          body.push(`value = ${mapperName}.${stage.many ? "many" : "map"}(value);`);
        }
        break;
      }
      case "transform": {
        const keys = Object.keys(stage.transforms);
        const callbacks = keys.map((key) => stage.transforms[key]);
        const transformName = emitBoundBlock(
          "transform",
          keys.map((_, transformIndex) => `__t${transformIndex}`),
          callbacks,
          emitTransformSource(stage.source, stage.transforms as never),
          true
        );

        if (stage.many) emitMany(transformName);
        else body.push(`value = ${transformName}(value);`);
        break;
      }
      case "update": {
        const updateName = helper("update");
        const patchName = bind(stage.patch);

        setup.push(`const ${updateName} = (${emitUpdateSource(stage.schema)});`);
        if (stage.many) emitMany(updateName, patchName);
        else body.push(`value = ${updateName}(value, ${patchName});`);
        break;
      }
      case "security": {
        const source =
          stage.operation === "mask"
            ? emitMaskSource(stage.schema).replace("function scrub", "function mask")
            : emitSanitizeSource(stage.schema).replace("function scrub", "function sanitize");
        const securityName =
          stage.operation === "sanitize"
            ? emitBoundBlock("sanitize", sanitizeChainBindings.names, sanitizeChainBindings.values, source, true)
            : (() => {
                const name = helper("mask");

                setup.push(`const ${name} = (${source});`);
                return name;
              })();

        if (stage.many) emitMany(securityName);
        else body.push(`value = ${securityName}(value);`);
        break;
      }
      case "json.encode": {
        if (stage.mode === "chunks") {
          const chunksName = helper("stringifyChunks");

          setup.push(
            `const ${chunksName} = ${emitStringifyChunksSource(stage.schema ?? optimized.schema, {
              ...(stage.chunkBytes === undefined ? {} : { chunkBytes: stage.chunkBytes }),
            })};`
          );
          body.push(`value = ${chunksName}(value);`);
          break;
        }
        const stringifyName = helper("stringify");

        setup.push(`const ${stringifyName} = ${emitSerialize(stage.schema ?? optimized.schema)};`);
        body.push(`value = ${stringifyName}(value);`);
        break;
      }
      case "binary.encode": {
        const codec = emitCodec(stage.schema);
        const codecName = emitBoundBlock("codec", codec.bindingNames, codec.bindingValues, codec.source);

        body.push(`value = ${codecName}.encode(value);`);
        break;
      }
      case "operation":
        throw new JITError("INVALID_OPERATION", `operation ${stage.operation} requires its dedicated runtime lowering`);
    }
  }

  body.push("return value;");
  return {
    source: ['"use strict";', ...setup, "return function execution(input) {", ...indent(body.join("\n")), "}"].join(
      "\n"
    ),
    bindingNames,
    bindingValues,
  };
}

/** Lowers the descriptor exactly once, when its final callable is first used. */
export function lowerExecutionPlan(plan: ExecutionPlan): FunctionLike {
  const emitted = emitExecutionPlan(plan);
  const compiled = globalThis.Function(
    ...emitted.bindingNames,
    emitted.source
  )(...emitted.bindingValues) as FunctionLike;
  const json = plan.stages.find((stage) => stage.kind === "json.decode");

  if (json?.schema) warmJsonParseShape(json.schema);
  return compiled;
}

function indent(source: string): string[] {
  return source.split("\n").map((line) => `  ${line}`);
}

function emitMappedJsonArray(mapper: string, stringify: string, body: string[], index: number): void {
  const list = `__list${index}`;
  const length = `__len${index}`;
  const item = `__item${index}`;
  const cursor = `__i${index}`;
  const json = `__json${index}`;

  body.push(`const ${list} = value;`);
  body.push(`const ${length} = ${list}.length;`);
  body.push(`let ${json} = "[";`);
  body.push(`for (let ${cursor} = 0; ${cursor} < ${length}; ${cursor}++) {`);
  body.push(`  if (${cursor} !== 0) ${json} += ",";`);
  body.push(`  const ${item} = ${mapper}.map(${list}[${cursor}]);`);
  body.push(`  ${json} += ${stringify}(${item});`);
  body.push("}");
  body.push(`${json} += "]";`);
  body.push(`value = ${json};`);
}
