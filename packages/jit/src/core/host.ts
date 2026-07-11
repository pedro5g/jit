import type * as ATS from "./ats/index.js";

export type AnyCompiledFunction = (...args: never[]) => unknown;

export type CompilationTarget = "runtime" | "aot";
export type OptimizationLevel = "none" | "standard" | "aggressive";

export interface PerformanceHints {
  readonly shapes?: boolean;
  readonly strings?: boolean;
  readonly allocation?: "auto" | "low" | "throughput";
  readonly strategies?: "auto" | "simple" | "specialized";
}

export interface CompilationOptions {
  readonly target?: CompilationTarget;
  readonly mode?: "development" | "production";
  readonly optimization?: OptimizationLevel;
  readonly performance?: PerformanceHints;
  readonly diagnostics?: boolean;
  readonly sourceMap?: boolean;
}

export type OperationDescriptor =
  | { readonly kind: "validate"; readonly op: "is" | "parse" | "safeParse" | "parseAsync" | "safeParseAsync" }
  | { readonly kind: "operation"; readonly op: "equal" | "clone" | "diff" | "hash" | "stringify" | "fromJSON" }
  | { readonly kind: "query"; readonly params?: readonly string[] }
  | { readonly kind: "transform" };

export interface CompilationRequest<TFunction extends AnyCompiledFunction = AnyCompiledFunction> {
  readonly schema: ATS.AnyTypeSchema;
  readonly operation: OperationDescriptor;
  readonly options?: CompilationOptions;
  readonly expectedFunction?: TFunction;
}

export interface CompilationDiagnostic {
  readonly level: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly path?: readonly PropertyKey[];
}

export interface TypeDescriptor {
  readonly name: string;
}

export interface DeclarationNode {
  readonly kind: string;
}

export interface ArtifactDependency {
  readonly id: string;
}

export interface HelperReference {
  readonly id: string;
}

export interface PerformancePlan {
  readonly steps: readonly string[];
}

export interface CompiledArtifact {
  readonly id: string;
  readonly hash: string;
  readonly name: string | null;
  readonly inputTypes: readonly TypeDescriptor[];
  readonly outputType: TypeDescriptor;
  readonly source: string;
  readonly declaration: DeclarationNode;
  readonly dependencies: readonly ArtifactDependency[];
  readonly helpers: readonly HelperReference[];
  readonly plan: PerformancePlan;
  readonly diagnostics: readonly CompilationDiagnostic[];
  readonly sourceMap?: string;
}

export interface CompilerHost {
  compile<TFunction extends AnyCompiledFunction>(request: CompilationRequest<TFunction>): TFunction;
}

/**
 * Transitional host adapter used until the schema factories move into a
 * compiler-free core package. The final split will let callers provide only
 * a host; for now the namespace is injected explicitly so runtime and define
 * can share the same public shape without duplicating schema builders.
 */
export function createJIT<TNamespace>(host: CompilerHost, namespace: TNamespace): TNamespace {
  void host;
  return namespace;
}

export const SCHEMA_METADATA = Symbol.for("@jit/schema");
export const AOT_ARTIFACT = Symbol.for("@jit/aot-artifact");

export interface SchemaMetadata {
  readonly id: string;
  readonly schema: ATS.AnyTypeSchema;
}

export interface ArtifactDescriptor {
  readonly artifactId: string;
  readonly schemaId: string;
  readonly operation: OperationDescriptor;
  readonly options?: CompilationOptions;
}

export type AOTArtifact<TFunction extends AnyCompiledFunction> = TFunction & {
  readonly [AOT_ARTIFACT]: ArtifactDescriptor;
};
