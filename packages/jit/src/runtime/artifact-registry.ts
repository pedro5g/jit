/**
 * Registry linking compiled artifacts back to the source/schema metadata that
 * produced them. `jit generate` uses it for object-style `JIT.compile` extras
 * and for explicitly exported standalone functions.
 */

import type { ExecutionPlan } from "../compiler/execution-plan.js";
import type * as ATS from "../core/ats/index.js";

interface SourceArtifact {
  readonly kind: "query" | "mapper" | "watch";
  /** Expression source: evaluates to the compiled function/object. */
  readonly source: string;
  readonly bindingNames: readonly string[];
  readonly bindingValues: readonly unknown[];
}

/**
 * A query builder registers its declarative program instead of compiled
 * source: it is the artifact the developer exports, and AOT re-emits it for
 * the requested result shape without the builder ever compiling at runtime.
 */
interface QueryPlanArtifact {
  readonly kind: "query-plan";
  readonly schema: ATS.AnyTypeSchema;
  readonly program: {
    readonly nodes: readonly unknown[];
    readonly bindings: readonly unknown[];
    readonly params?: readonly string[];
  };
  readonly mode: "array" | "iterator" | "async-iterator" | "visitor";
}

interface ValidatorArtifact {
  readonly kind: "validator";
  readonly schema: ATS.AnyTypeSchema;
  readonly op: "is" | "parse" | "safeParse" | "parseAsync" | "safeParseAsync";
}

interface OperationArtifact {
  readonly kind: "operation";
  readonly schema: ATS.AnyTypeSchema;
  readonly op:
    | "hash"
    | "equal"
    | "clone"
    | "diff"
    | "stringify"
    | "fromJSON"
    | "format"
    | "mask"
    | "sanitize"
    | "codec"
    | "jsonSchema"
    | "mock";
}

/**
 * Public capability artifacts register their immutable descriptor directly.
 * Runtime and AOT therefore see the same API-free program, rather than a
 * namespace-specific wrapper function.
 */
interface ExecutionArtifact {
  readonly kind: "execution";
  readonly plan: ExecutionPlan;
}

export type CompiledArtifact =
  | SourceArtifact
  | QueryPlanArtifact
  | ValidatorArtifact
  | OperationArtifact
  | ExecutionArtifact;

const REGISTRY = new WeakMap<object, CompiledArtifact>();

export function registerArtifact(value: object, artifact: CompiledArtifact): void {
  REGISTRY.set(value, artifact);
}

export function getArtifact(value: unknown): CompiledArtifact | undefined {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return undefined;
  return REGISTRY.get(value as object);
}
