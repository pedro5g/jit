/**
 * Registry linking compiled artifacts (query functions, mapper objects) back
 * to the source and bindings that produced them. `JIT.compile` extras use it
 * so `jit generate` can re-emit dev-defined functions (`findById`, `getADM`,
 * `toDTO`, ...) as pure AOT code when their bindings are serializable.
 */

export interface CompiledArtifact {
  readonly kind: "query" | "mapper";
  /** Expression source: evaluates to the compiled function/object. */
  readonly source: string;
  readonly bindingNames: readonly string[];
  readonly bindingValues: readonly unknown[];
}

const REGISTRY = new WeakMap<object, CompiledArtifact>();

export function registerArtifact(value: object, artifact: CompiledArtifact): void {
  REGISTRY.set(value, artifact);
}

export function getArtifact(value: unknown): CompiledArtifact | undefined {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return undefined;
  return REGISTRY.get(value as object);
}
