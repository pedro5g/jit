import type * as ATS from "../core/ats/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { emitNode } from "./emitter/emit-node.js";
import { buildMapperIR } from "./mapper/build-mapper-ir.js";
import {
  buildMapperPlan,
  type MapperFieldPlan,
  type MapperOverridesInput,
  type MapperPlan,
} from "./mapper/build-mapper-plan.js";

/**
 * A compiled source→target shape mapper.
 *
 * Only fields declared by the target schema exist in the output: the mapper
 * is a whitelist by construction, so unlisted (sensitive) source fields can
 * never leak through it.
 *
 * @template TSource - The source object type.
 * @template TTarget - The mapped output type.
 */
export interface CompiledMapper<TSource, TTarget> {
  /** Maps a single source object into the target shape. */
  readonly map: (source: TSource) => TTarget;
  /** Maps a list in one fused indexed loop with a single output allocation. */
  readonly many: (sources: readonly TSource[]) => TTarget[];
}

/**
 * Emits the JavaScript source of a compiled mapper (`{ map, many }`).
 *
 * @param sourceSchema - The source object schema.
 * @param targetSchema - The target object schema.
 * @param overrides - Per-field overrides (computed, rename, convert, default).
 * @returns The generated mapper source.
 *
 * @throws JITError with code `INVALID_MAPPER` when a required target field
 * cannot be mapped or an override is malformed.
 */
export function emitMapperSource(
  sourceSchema: ATS.AnyTypeSchema,
  targetSchema: ATS.AnyTypeSchema,
  overrides: MapperOverridesInput = {}
): string {
  return emitMapper(buildMapperPlan(sourceSchema, targetSchema, overrides));
}

/**
 * Compiles a source→target mapper into `{ map, many }` specialized functions.
 *
 * Auto-matches target fields by name and compatible type (nested objects and
 * arrays of objects recurse); overrides cover renames, conversions, computed
 * and default values. Override callbacks and default values travel as
 * external bindings — never interpolated into the generated source.
 *
 * Prefer the typed `JIT.mapper(source, target, overrides)` factory; this is
 * the low-level entry point it delegates to.
 *
 * @throws JITError with code `INVALID_MAPPER` when a required target field
 * cannot be mapped or an override is malformed.
 */
export function compileMapper<TSource = unknown, TTarget = unknown>(
  sourceSchema: ATS.AnyTypeSchema,
  targetSchema: ATS.AnyTypeSchema,
  overrides: MapperOverridesInput = {},
  options?: CompileCacheOptions
): CompiledMapper<TSource, TTarget> {
  const plan = buildMapperPlan(sourceSchema, targetSchema, overrides);
  // Override callbacks and defaults are user values: cache only the pure
  // source template and re-apply the bindings on every compile.
  const template = getCompileCached(
    sourceSchema,
    `mapper:${targetKey(targetSchema)}:${serializeFields(plan.fields)}`,
    () => {
      const source = emitMapper(plan);

      return {
        source,
        create: globalThis.Function(...plan.bindingNames, `return ${source};`),
      };
    },
    options
  );
  const compiled = template.create(...plan.bindings) as CompiledMapper<TSource, TTarget>;

  // Lets AOT re-emit this mapper when aggregated via JIT.compile extras.
  registerArtifact(compiled as object, {
    kind: "mapper",
    source: template.source,
    bindingNames: plan.bindingNames,
    bindingValues: plan.bindings,
  });
  return compiled;
}

function emitMapper(plan: MapperPlan): string {
  const programs = buildMapperIR(plan.fields);
  const writer = new CodeWriter();

  writer.line("{");
  writer.indent(() => {
    writer.line("map: function map(source) {");
    writer.indent(() => {
      for (const node of programs.map.body) emitNode(writer, node);
    });
    writer.line("},");
    writer.line("many: function many(list) {");
    writer.indent(() => {
      for (const node of programs.many.body) emitNode(writer, node);
    });
    writer.line("}");
  });
  writer.line("}");

  return writer.toString();
}

const targetKeys = new WeakMap<object, number>();
let targetKeyCounter = 0;

function targetKey(schema: object): number {
  let key = targetKeys.get(schema);

  if (key === undefined) {
    key = ++targetKeyCounter;
    targetKeys.set(schema, key);
  }

  return key;
}

function serializeFields(fields: readonly MapperFieldPlan[]): string {
  return fields.map(serializeField).join(";");
}

function serializeField(field: MapperFieldPlan): string {
  const source = field.source;

  switch (source.kind) {
    case "copy":
      return `${field.key}<c:${source.from}:${source.fromOptional ? "?" : ""}>`;
    case "copy-object":
      return `${field.key}<o:${source.from}:${source.fromOptional ? "?" : ""}[${serializeFields(source.fields)}]>`;
    case "copy-array":
      return `${field.key}<a:${source.from}:${source.fromOptional ? "?" : ""}[${
        source.element ? serializeFields(source.element) : "*"
      }]>`;
    case "via":
      return `${field.key}<v:${source.from}:${source.binding}>`;
    case "computed":
      return `${field.key}<x:${source.binding}>`;
    case "default":
      return `${field.key}<d:${source.from ?? ""}:${source.binding}>`;
  }
}
