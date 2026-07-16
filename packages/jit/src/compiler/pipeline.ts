import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitLiteral } from "./source/literal.js";

type InnerSchema = ATS.AnyTypeSchema & {
  readonly def: ATS.InnerTypeDef<ATS.AnyTypeSchema>;
};
type TransformSchema = ATS.AnyTypeSchema & {
  readonly def: ATS.TransformDef<ATS.AnyTypeSchema, Record<string, unknown>>;
};
type PipeSchema = ATS.AnyTypeSchema & {
  readonly def: ATS.PipeDef<ATS.AnyTypeSchema, unknown>;
};
type RefineSchema = ATS.AnyTypeSchema & {
  readonly def: ATS.RefineDef<ATS.AnyTypeSchema>;
};
type CoerceSchema = ATS.AnyTypeSchema & {
  readonly def: ATS.CoerceDef<ATS.AnyTypeSchema>;
};

/**
 * A compiled value pipeline: applies the schema's transform/pipe/refine/coerce
 * steps in declaration order.
 *
 * @template TInput - The raw input accepted by the pipeline.
 * @template TOutput - The value type after every step has been applied.
 * @param value - The input value to process.
 * @returns The output value after every pipeline step has run.
 */
export type Pipeline<TInput, TOutput> = (value: TInput) => TOutput;

/**
 * The emitted pipeline source plus the external bindings (user callbacks) it
 * closes over. Callbacks are passed as bindings, never interpolated into the
 * generated source.
 */
export interface PipelineProgram {
  readonly source: string;
  readonly bindings: readonly unknown[];
}

/**
 * Emits the pipeline source together with its external bindings.
 *
 * @param schema - The schema whose wrapper chain is compiled.
 * @returns The generated source and the external bindings it references.
 */
export function emitPipelineProgram(schema: ATS.AnyTypeSchema): PipelineProgram {
  const bindings: unknown[] = [];
  const writer = new CodeWriter();

  writer.line("function pipeline(value) {");
  writer.indent(() => {
    writer.line("let out = value;");
    emitPipelineSteps(writer, schema, bindings);
    writer.line("return out;");
  });
  writer.line("}");

  return { source: writer.toString(), bindings };
}

/**
 * Emits only the JavaScript source of the pipeline (without bindings).
 *
 * @param schema - The schema whose wrapper chain is compiled.
 * @returns The generated pipeline source.
 */
export function emitPipelineSource(schema: ATS.AnyTypeSchema): string {
  return emitPipelineProgram(schema).source;
}

/**
 * Compiles the schema's wrapper chain (transform, pipe, refine, coerce,
 * default) into a single flat function with no per-step dispatch.
 *
 * @template TSchema - The schema whose wrapper chain drives the generated steps.
 * @param schema - The schema used to compile the pipeline.
 * @returns A compiled pipeline for values inferred from `schema`.
 *
 * @throws JITError with code `REFINE_FAILED` (at call time) when a refine
 * predicate rejects the value.
 */
export function compilePipeline<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema
): Pipeline<unknown, ATS.TypeofSchema<TSchema>> {
  const program = emitPipelineProgram(schema);
  const bindingNames = program.bindings.map((_, index) => `__p${index}`);

  return globalThis.Function(
    ...bindingNames,
    "__JITError",
    `return ${program.source};`
  )(...program.bindings, JITError) as Pipeline<unknown, ATS.TypeofSchema<TSchema>>;
}

function emitPipelineSteps(writer: CodeWriter, schema: ATS.AnyTypeSchema, bindings: unknown[]): void {
  if (hasInnerType(schema)) {
    emitPipelineSteps(writer, (schema as InnerSchema).def.innerType, bindings);
  }

  switch (schema.type) {
    case TypeName.coerce: {
      const binding = addBinding(bindings, (schema as CoerceSchema).def.coercer);
      writer.line(`out = ${binding}(out);`);
      return;
    }
    case TypeName.transform: {
      const transformSchema = schema as TransformSchema;
      const transforms = transformSchema.def.transforms;
      const keys = objectKeys(transformSchema.def.innerType, transforms);
      const entries = keys.map((key) => {
        const transform = transforms[key];
        const source = emitPropertyAccess("out", key);
        const value = typeof transform === "function" ? `${addBinding(bindings, transform)}(${source}, out)` : source;

        return `${emitLiteral(key)}: ${value}`;
      });

      writer.line(`out = { ${entries.join(", ")} };`);
      return;
    }
    case TypeName.pipe: {
      const binding = addBinding(bindings, (schema as PipeSchema).def.transform);
      writer.line(`out = ${binding}(out);`);
      return;
    }
    case TypeName.refine: {
      const binding = addBinding(bindings, (schema as RefineSchema).def.predicate);
      writer.line(`if (!${binding}(out)) {`);
      writer.indent(() => writer.line('throw new __JITError("REFINE_FAILED", "Refine predicate failed");'));
      writer.line("}");
      return;
    }
  }
}

function objectKeys(schema: ATS.AnyTypeSchema, transforms: Record<string, unknown>): string[] {
  const base = unwrapBase(schema);

  return base.type === TypeName.object
    ? Object.keys((base as ATS.ObjectSchema<ATS.SchemaShape>).def.props)
    : Object.keys(transforms);
}

function unwrapBase(schema: ATS.AnyTypeSchema): ATS.AnyTypeSchema {
  let current = schema;

  while (hasInnerType(current)) {
    current = (current as InnerSchema).def.innerType;
  }

  return current;
}

function addBinding(bindings: unknown[], value: unknown): string {
  const name = `__p${bindings.length}`;
  bindings[bindings.length] = value;
  return name;
}

function hasInnerType(schema: ATS.AnyTypeSchema): boolean {
  return (
    schema.type === TypeName.optional ||
    schema.type === TypeName.nullable ||
    schema.type === TypeName.nullish ||
    schema.type === TypeName.default ||
    schema.type === TypeName.brand ||
    schema.type === TypeName.transform ||
    schema.type === TypeName.pipe ||
    schema.type === TypeName.refine ||
    schema.type === TypeName.coerce ||
    schema.type === TypeName.readonly ||
    schema.type === TypeName.promise
  );
}
