import type * as ATS from "./ats/index.js";

/** Provides the JIT any compiled function operation for the supplied input. */
export type AnyCompiledFunction = (...args: never[]) => unknown;

/** Describes the JIT compilation target contract used by the public API. */
export type CompilationTarget = "runtime" | "aot";
/** Describes the JIT optimization level contract used by the public API. */
export type OptimizationLevel = "none" | "standard" | "aggressive";

/** Describes the JIT performance hints contract used by the public API. */
export interface PerformanceHints {
  readonly shapes?: boolean;
  readonly strings?: boolean;
  readonly allocation?: "auto" | "low" | "throughput";
  readonly strategies?: "auto" | "simple" | "specialized";
}

/** Provides the JIT compilation options operation for the supplied input. */
export interface CompilationOptions {
  readonly target?: CompilationTarget;
  readonly mode?: "development" | "production";
  readonly optimization?: OptimizationLevel;
  readonly performance?: PerformanceHints;
  readonly diagnostics?: boolean;
  readonly sourceMap?: boolean;
}

/** Provides the JIT operation descriptor operation for the supplied input. */
export type OperationDescriptor =
  | { readonly kind: "validate"; readonly op: "is" | "parse" | "safeParse" | "parseAsync" | "safeParseAsync" }
  | {
      readonly kind: "operation";
      readonly op:
        | "equal"
        | "clone"
        | "diff"
        | "hash"
        | "stringify"
        | "fromJSON"
        | "format"
        | "sort"
        | "index"
        | "lookup"
        | "reconcile"
        | "project"
        | "changed"
        | "patch"
        | "state.collection"
        | "cacheKey"
        | "canonical"
        | "access"
        | "rules"
        | "match"
        | "migrate"
        | "csv"
        | "ndjson";
    }
  | { readonly kind: "query"; readonly params?: readonly string[] }
  | { readonly kind: "transform" };

/** Provides the JIT compilation request operation for the supplied input. */
export interface CompilationRequest<TFunction extends AnyCompiledFunction = AnyCompiledFunction> {
  readonly schema: ATS.AnyTypeSchema;
  readonly operation: OperationDescriptor;
  readonly options?: CompilationOptions;
  readonly expectedFunction?: TFunction;
}

/** Describes the JIT compilation diagnostic contract used by the public API. */
export interface CompilationDiagnostic {
  readonly level: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly path?: readonly PropertyKey[];
}

/** Describes the JIT type descriptor contract used by the public API. */
export interface TypeDescriptor {
  readonly name: string;
}

/** Describes the JIT declaration node contract used by the public API. */
export interface DeclarationNode {
  readonly kind: string;
}

/** Describes the JIT artifact dependency contract used by the public API. */
export interface ArtifactDependency {
  readonly id: string;
}

/** Describes the JIT helper reference contract used by the public API. */
export interface HelperReference {
  readonly id: string;
}

/** Describes the JIT performance plan contract used by the public API. */
export interface PerformancePlan {
  readonly steps: readonly string[];
}

/** Creates the JIT compiled artifact artifact from the supplied input. */
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

/** Creates the JIT compiler host artifact from the supplied input. */
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

/** Provides the JIT schema metadata configuration used by the public contract. */
export const SCHEMA_METADATA = Symbol.for("@jit/schema");
/** Provides the JIT aot artifact configuration used by the public contract. */
export const AOT_ARTIFACT = Symbol.for("@jit/aot-artifact");

/** Provides the JIT schema metadata operation for the supplied input. */
export interface SchemaMetadata {
  readonly id: string;
  readonly schema: ATS.AnyTypeSchema;
}

/** Provides the JIT artifact descriptor operation for the supplied input. */
export interface ArtifactDescriptor {
  readonly artifactId: string;
  readonly schemaId: string;
  readonly operation: OperationDescriptor;
  readonly options?: CompilationOptions;
}

/** Provides the JIT aotartifact operation for the supplied input. */
export type AOTArtifact<TFunction extends AnyCompiledFunction> = TFunction & {
  readonly [AOT_ARTIFACT]: ArtifactDescriptor;
};
