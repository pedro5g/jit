/**
 * Registry linking compiled artifacts back to the source/schema metadata that
 * produced them. `jit generate` uses it for object-style `JIT.compile` extras
 * and for explicitly exported standalone functions.
 */
import type * as ATS from "../core/ats/index.js";

interface SourceArtifact {
  readonly kind: "query" | "mapper";
  /** Expression source: evaluates to the compiled function/object. */
  readonly source: string;
  readonly bindingNames: readonly string[];
  readonly bindingValues: readonly unknown[];
}

interface ValidatorArtifact {
  readonly kind: "validator";
  readonly schema: ATS.AnyTypeSchema;
  readonly op: "is" | "parse" | "safeParse" | "parseAsync" | "safeParseAsync";
}

interface OperationArtifact {
  readonly kind: "operation";
  readonly schema: ATS.AnyTypeSchema;
  readonly op: "hash" | "equal" | "clone" | "diff" | "stringify" | "fromJSON" | "mask" | "sanitize" | "codec";
}

export type CompiledArtifact = SourceArtifact | ValidatorArtifact | OperationArtifact;

const REGISTRY = new WeakMap<object, CompiledArtifact>();

export function registerArtifact(value: object, artifact: CompiledArtifact): void {
  REGISTRY.set(value, artifact);
}

export function getArtifact(value: unknown): CompiledArtifact | undefined {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return undefined;
  return REGISTRY.get(value as object);
}
