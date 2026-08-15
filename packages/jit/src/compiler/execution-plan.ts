import type * as ATS from "../core/ats/index.js";
import type { QueryProgram } from "./query.js";

/** Runtime representations that can cross an execution-stage boundary. */
export type Representation = "value" | "json-text" | "binary" | "issues" | "boolean";

/** Facts are declarative: they describe what a stage establishes, never an API spelling. */
export type ExecutionFact =
  | "json-syntax-valid"
  | "binary-layout-valid"
  | "schema-validated"
  | "mapped"
  | "transformed"
  | "updated"
  | "filtered"
  | "projected"
  | "masked"
  | "sanitized"
  | "materialized";

/** Side effects relevant to reordering and backend selection. */
export interface ExecutionEffects {
  readonly mayThrow: boolean;
  readonly mayAllocate: boolean;
  readonly usesExternalBindings: boolean;
}

/**
 * The common contract for every source, operator and sink. Public namespace
 * syntax has already disappeared by this point; only dataflow remains.
 */
export interface StageDescriptor {
  readonly kind: string;
  readonly input: Representation;
  readonly output: Representation;
  readonly schema?: ATS.AnyTypeSchema;
  readonly requires: readonly ExecutionFact[];
  readonly provides: readonly ExecutionFact[];
  readonly effects: ExecutionEffects;
}

export interface ValueSourceStage extends StageDescriptor {
  readonly kind: "value";
  readonly input: "value";
  readonly output: "value";
  readonly schema: ATS.AnyTypeSchema;
}

export interface JsonDecodeStage extends StageDescriptor {
  readonly kind: "json.decode";
  readonly input: "json-text";
  readonly output: "value";
  readonly schema: ATS.AnyTypeSchema;
}

export interface BinaryDecodeStage extends StageDescriptor {
  readonly kind: "binary.decode";
  readonly input: "binary";
  readonly output: "value";
  readonly schema: ATS.AnyTypeSchema;
}

export interface ValidateStage extends StageDescriptor {
  readonly kind: "validate";
  readonly input: "value";
  readonly output: "value" | "boolean" | "issues";
  readonly schema: ATS.AnyTypeSchema;
  readonly operation: "is" | "parse" | "safeParse" | "parseAsync" | "safeParseAsync" | "issues";
}

export interface JsonEncodeStage extends StageDescriptor {
  readonly kind: "json.encode";
  readonly input: "value";
  readonly output: "json-text";
  readonly schema?: ATS.AnyTypeSchema;
}

export interface BinaryEncodeStage extends StageDescriptor {
  readonly kind: "binary.encode";
  readonly input: "value";
  readonly output: "binary";
  readonly schema: ATS.AnyTypeSchema;
}

export interface MapStage extends StageDescriptor {
  readonly kind: "map";
  readonly input: "value";
  readonly output: "value";
  readonly source: ATS.AnyTypeSchema;
  readonly target: ATS.AnyTypeSchema;
  readonly many: boolean;
  /** Mapping callbacks/defaults stay outside the descriptor source. */
  readonly bindings: readonly unknown[];
}

/** A schema-aware per-field transform. `many` applies it in one indexed loop. */
export interface TransformStage extends StageDescriptor {
  readonly kind: "transform";
  readonly input: "value";
  readonly output: "value";
  readonly source: ATS.AnyTypeSchema;
  readonly target: ATS.AnyTypeSchema;
  readonly many: boolean;
  /** Per-field callbacks are bindings, never source text. */
  readonly transforms: Readonly<Record<string, unknown>>;
}

/** An immutable structural patch bound once when the execution plan is built. */
export interface UpdateStage extends StageDescriptor {
  readonly kind: "update";
  readonly input: "value";
  readonly output: "value";
  readonly schema: ATS.AnyTypeSchema;
  readonly many: boolean;
  readonly patch: unknown;
}

/** Security rewrites preserve the schema shape and can be applied per collection item. */
export interface SecurityStage extends StageDescriptor {
  readonly kind: "security";
  readonly input: "value";
  readonly output: "value";
  readonly schema: ATS.AnyTypeSchema;
  readonly operation: "mask" | "sanitize";
  readonly many: boolean;
}

export interface QueryStage extends StageDescriptor {
  readonly kind: "query";
  readonly input: "value";
  readonly output: "value";
  /** Collection schema consumed by this declarative query segment. */
  readonly source: ATS.AnyTypeSchema;
  readonly schema: ATS.AnyTypeSchema;
  readonly operation: "filter" | "select";
  /** Full immutable program for the current contiguous query segment. */
  readonly program: QueryProgram;
}

export interface ArraySinkStage extends StageDescriptor {
  readonly kind: "to.array";
  readonly input: "value";
  readonly output: "value";
}

/** A leaf capability which still shares the same descriptor container. */
export interface OperationStage extends StageDescriptor {
  readonly kind: "operation";
  readonly operation: "equal" | "clone" | "diff" | "hash" | "format" | "mask" | "sanitize" | "codec";
  readonly schema: ATS.AnyTypeSchema;
}

export type ExecutionStage =
  | ValueSourceStage
  | JsonDecodeStage
  | BinaryDecodeStage
  | ValidateStage
  | JsonEncodeStage
  | BinaryEncodeStage
  | MapStage
  | TransformStage
  | UpdateStage
  | SecurityStage
  | QueryStage
  | ArraySinkStage
  | OperationStage;

/** Immutable public descriptor consumed by runtime and AOT lowering. */
export interface ExecutionPlan {
  readonly version: 1;
  readonly schema: ATS.AnyTypeSchema;
  readonly stages: readonly ExecutionStage[];
}

export const NO_EFFECTS: ExecutionEffects = Object.freeze({
  mayThrow: false,
  mayAllocate: false,
  usesExternalBindings: false,
});

export const THROWING_EFFECTS: ExecutionEffects = Object.freeze({
  mayThrow: true,
  mayAllocate: false,
  usesExternalBindings: false,
});
