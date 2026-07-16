import type * as ATS from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
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

export const MAPPER_OPS = ["map", "many"] as const;

export type MapperOp = (typeof MAPPER_OPS)[number];

export type CompiledMapperSelection<TSource, TTarget, TOps extends readonly MapperOp[]> = Pick<
  CompiledMapper<TSource, TTarget>,
  TOps[number]
>;

export interface MapperGet<TSource, TTarget> {
  /** Compiles and returns exactly the requested mapper operations. */
  get<const TOps extends readonly MapperOp[]>(...ops: TOps): CompiledMapperSelection<TSource, TTarget, TOps>;
}

export type MapperFacade<TSource, TTarget> = CompiledMapper<TSource, TTarget> & MapperGet<TSource, TTarget>;

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
  overrides: MapperOverridesInput = {},
  operations: readonly MapperOp[] = MAPPER_OPS
): string {
  return emitMapper(buildMapperPlan(sourceSchema, targetSchema, overrides), normalizeMapperOps(operations));
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
  return compileMapperSelection<TSource, TTarget, typeof MAPPER_OPS>(
    sourceSchema,
    targetSchema,
    overrides,
    MAPPER_OPS,
    options
  ) as CompiledMapper<TSource, TTarget>;
}

/** Compiles only the selected mapper functions and omits every other operation. */
export function compileMapperSelection<
  TSource = unknown,
  TTarget = unknown,
  const TOps extends readonly MapperOp[] = typeof MAPPER_OPS,
>(
  sourceSchema: ATS.AnyTypeSchema,
  targetSchema: ATS.AnyTypeSchema,
  overrides: MapperOverridesInput,
  operations: TOps,
  options?: CompileCacheOptions
): CompiledMapperSelection<TSource, TTarget, TOps> {
  const plan = buildMapperPlan(sourceSchema, targetSchema, overrides);

  return compileMapperPlanSelection<TSource, TTarget, TOps>(sourceSchema, targetSchema, plan, operations, options);
}

/**
 * Creates a lazy mapper facade. Direct property access compiles one operation;
 * `.get(...)` compiles only the explicit selection in one generated object.
 */
export function createMapperFacade<TSource = unknown, TTarget = unknown>(
  sourceSchema: ATS.AnyTypeSchema,
  targetSchema: ATS.AnyTypeSchema,
  overrides: MapperOverridesInput = {},
  options?: CompileCacheOptions
): MapperFacade<TSource, TTarget> {
  const plan = buildMapperPlan(sourceSchema, targetSchema, overrides);
  const selections = new Map<string, object>();

  const select = <const TOps extends readonly MapperOp[]>(
    operations: TOps
  ): CompiledMapperSelection<TSource, TTarget, TOps> => {
    const normalized = normalizeMapperOps(operations);
    const key = normalized.join(",");
    const cached = selections.get(key);

    if (cached) return cached as CompiledMapperSelection<TSource, TTarget, TOps>;

    const selection = compileMapperPlanSelection<TSource, TTarget, TOps>(
      sourceSchema,
      targetSchema,
      plan,
      normalized as unknown as TOps,
      options
    );
    selections.set(key, selection);
    return selection;
  };
  const target = {
    get<const TOps extends readonly MapperOp[]>(...operations: TOps): CompiledMapperSelection<TSource, TTarget, TOps> {
      return select(operations);
    },
  };

  for (const operation of MAPPER_OPS) {
    Object.defineProperty(target, operation, {
      configurable: false,
      enumerable: true,
      get() {
        return select([operation] as const)[operation];
      },
    });
  }

  const facade = Object.freeze(target) as MapperFacade<TSource, TTarget>;

  registerMapperArtifact(facade, plan, MAPPER_OPS);
  return facade;
}

function compileMapperPlanSelection<TSource, TTarget, const TOps extends readonly MapperOp[]>(
  sourceSchema: ATS.AnyTypeSchema,
  targetSchema: ATS.AnyTypeSchema,
  plan: MapperPlan,
  operations: TOps,
  options: CompileCacheOptions | undefined
): CompiledMapperSelection<TSource, TTarget, TOps> {
  const normalized = normalizeMapperOps(operations);
  const operationKey = normalized.join(",");

  if (normalized.length === 0) {
    const empty = Object.freeze({}) as CompiledMapperSelection<TSource, TTarget, TOps>;

    registerMapperArtifact(empty, plan, normalized, "{}");
    return empty;
  }

  // Override callbacks and defaults are user values: cache only the pure
  // source template and re-apply the bindings on every compile.
  const template = getCompileCached(
    sourceSchema,
    `mapper:${targetKey(targetSchema)}:${operationKey}:${serializeFields(plan.fields)}`,
    () => {
      const source = emitMapper(plan, normalized);

      return {
        source,
        create: globalThis.Function(...plan.bindingNames, `return ${source};`),
      };
    },
    options
  );
  const compiled = Object.freeze(template.create(...plan.bindings)) as CompiledMapperSelection<TSource, TTarget, TOps>;

  registerMapperArtifact(compiled, plan, normalized, template.source);
  const compiledOperations = compiled as Partial<CompiledMapper<TSource, TTarget>>;
  for (const operation of normalized) {
    const compiledOperation = compiledOperations[operation];

    if (compiledOperation) {
      registerMapperArtifact(compiledOperation as object, plan, [operation], emitMapperFunction(plan, operation));
    }
  }
  return compiled;
}

function emitMapper(plan: MapperPlan, operations: readonly MapperOp[]): string {
  const programs = buildMapperIR(plan.fields);
  const writer = new CodeWriter();

  writer.line("{");
  writer.indent(() => {
    operations.forEach((operation, index) => {
      emitMapperFunctionBody(writer, programs, operation, index < operations.length - 1 ? "," : "");
    });
  });
  writer.line("}");

  return writer.toString();
}

function emitMapperFunction(plan: MapperPlan, operation: MapperOp): string {
  const programs = buildMapperIR(plan.fields);
  const writer = new CodeWriter();

  emitMapperFunctionBody(writer, programs, operation, "", false);
  return writer.toString();
}

function emitMapperFunctionBody(
  writer: CodeWriter,
  programs: ReturnType<typeof buildMapperIR>,
  operation: MapperOp,
  suffix: string,
  property = true
): void {
  const parameter = operation === "map" ? "source" : "list";
  const prefix = property ? `${operation}: ` : "";

  writer.line(`${prefix}function ${operation}(${parameter}) {`);
  writer.indent(() => {
    for (const node of programs[operation].body) emitNode(writer, node);
  });
  writer.line(`}${suffix}`);
}

function registerMapperArtifact(
  value: object,
  plan: MapperPlan,
  operations: readonly MapperOp[],
  source?: string
): void {
  registerArtifact(value, {
    kind: "mapper",
    get source() {
      return source ?? emitMapper(plan, operations);
    },
    bindingNames: plan.bindingNames,
    bindingValues: plan.bindings,
  });
}

function normalizeMapperOps(operations: readonly MapperOp[]): readonly MapperOp[] {
  for (const operation of operations) {
    if (!(MAPPER_OPS as readonly string[]).includes(operation)) {
      throw new JITError("INVALID_OPERATION", `unknown mapper operation: ${String(operation)}`);
    }
  }

  return MAPPER_OPS.filter((operation) => operations.includes(operation));
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
