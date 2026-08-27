/**
 * Registry linking compiled artifacts back to the source/schema metadata that
 * produced them. `jit generate` uses it for object-style `JIT.compile` extras
 * and for explicitly exported standalone functions.
 */

import type { AccessDescriptor } from "../compiler/access.js";
import type { CacheKeyDescriptor } from "../compiler/cache-key.js";
import type { ChangedDescriptor } from "../compiler/changed.js";
import type { ExecutionPlan } from "../compiler/execution-plan.js";
import type { IndexDescriptor } from "../compiler/indexing.js";
import type { JoinPlan } from "../compiler/join.js";
import type { LookupDescriptor } from "../compiler/lookup.js";
import type { MatchDescriptor } from "../compiler/match.js";
import type { OrderingDescriptor } from "../compiler/ordering.js";
import type { ProjectionTree } from "../compiler/projection.js";
import type { ReconcileDescriptor } from "../compiler/reconcile.js";
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
  readonly standard?: unknown;
}

/**
 * A standalone lookup carries its descriptor, not source: the access path is
 * chosen from the collection's facts, and AOT re-chooses it the same way.
 */
interface LookupPlanArtifact {
  readonly kind: "lookup-plan";
  readonly schema: ATS.AnyTypeSchema;
  readonly lookup: LookupDescriptor;
}

/** A reconciliation carries its descriptor: identity, channels, sink and change mode. */
interface ReconcilePlanArtifact {
  readonly kind: "reconcile-plan";
  readonly schema: ATS.AnyTypeSchema;
  readonly descriptor: ReconcileDescriptor;
}

/** A projection carries its selection tree; AOT re-emits the literal from it. */
interface ProjectPlanArtifact {
  readonly kind: "project-plan";
  readonly schema: ATS.AnyTypeSchema;
  readonly tree: ProjectionTree;
}

/** A change mask carries its watched fields and their bit order. */
interface ChangedPlanArtifact {
  readonly kind: "changed-plan";
  readonly schema: ATS.AnyTypeSchema;
  readonly descriptor: ChangedDescriptor;
}

/** A patch carries only which contract it implements; the emitter rebuilds it. */
interface PatchPlanArtifact {
  readonly kind: "patch-plan";
  readonly schema: ATS.AnyTypeSchema;
  readonly mode: "merge" | "json";
}

/** A cache key carries its selection and which form it produces. */
interface CacheKeyPlanArtifact {
  readonly kind: "cache-key-plan";
  readonly schema: ATS.AnyTypeSchema;
  readonly descriptor: CacheKeyDescriptor;
}

/** Canonicalization is fully described by the schema; nothing else is carried. */
interface CanonicalPlanArtifact {
  readonly kind: "canonical-plan";
  readonly schema: ATS.AnyTypeSchema;
}

/** An ability carries its rules; the emitter rebuilds the dispatch from them. */
interface AccessPlanArtifact {
  readonly kind: "access-plan";
  readonly schema: ATS.AnyTypeSchema;
  readonly descriptor: AccessDescriptor;
}

/** A match carries its tags; the handlers are user values, bound at compile time. */
interface MatchPlanArtifact {
  readonly kind: "match-plan";
  readonly schema: ATS.AnyTypeSchema;
  readonly descriptor: MatchDescriptor;
}

interface CqrsInputArtifact {
  readonly kind: "cqrs-input";
  readonly definition: unknown;
  /** Import-free function-body source that returns the specialized parser. */
  readonly source: string;
}

interface CqrsParserArtifact {
  readonly kind: "cqrs-parser";
  readonly definition: unknown;
  /** Import-free function-body source that returns the specialized parser. */
  readonly source: string;
}

interface IndexPlanArtifact {
  readonly kind: "index-plan";
  readonly schema: ATS.AnyTypeSchema;
  readonly descriptor: IndexDescriptor;
}

interface SortPlanArtifact {
  readonly kind: "sort-plan";
  readonly schema: ATS.AnyTypeSchema;
  readonly descriptor: OrderingDescriptor;
}

interface JoinPlanArtifact {
  readonly kind: "join-plan";
  readonly plan: JoinPlan;
  readonly standard?: unknown;
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
    | "mock"
    | "update";
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

/** A runtime class reduced to the data needed by the import-free AOT emitter. */
interface ClassArtifact {
  readonly kind: "class";
  readonly schema: ATS.AnyTypeSchema;
  readonly abstract: boolean;
  readonly frozen: boolean;
  readonly aggregate: boolean;
  readonly capabilities: readonly string[];
  readonly factories: { readonly create: string | false; readonly hydrate: string | false };
  readonly accessors?:
    | readonly {
        readonly key: string;
        readonly field: "public" | "protected" | "private" | false;
        readonly get: string | false;
        readonly set: string | false;
      }[]
    | undefined;
  readonly mutation?: { readonly updatedAt?: string; readonly version?: string; readonly deletedAt?: string };
  readonly domainEvent?: { readonly type: string; readonly version: number };
}

export type CompiledArtifact =
  | SourceArtifact
  | QueryPlanArtifact
  | CqrsInputArtifact
  | CqrsParserArtifact
  | SortPlanArtifact
  | JoinPlanArtifact
  | IndexPlanArtifact
  | LookupPlanArtifact
  | ReconcilePlanArtifact
  | ProjectPlanArtifact
  | ChangedPlanArtifact
  | PatchPlanArtifact
  | CacheKeyPlanArtifact
  | CanonicalPlanArtifact
  | AccessPlanArtifact
  | MatchPlanArtifact
  | ValidatorArtifact
  | OperationArtifact
  | ExecutionArtifact
  | ClassArtifact;

const REGISTRY = new WeakMap<object, CompiledArtifact>();

export function registerArtifact(value: object, artifact: CompiledArtifact): void {
  REGISTRY.set(value, artifact);
}

export function getArtifact(value: unknown): CompiledArtifact | undefined {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return undefined;
  return REGISTRY.get(value as object);
}

/** Updates class-only declarative metadata without changing the class identity. */
export function setClassMutationArtifact(
  value: object,
  mutation: { readonly updatedAt?: string; readonly version?: string; readonly deletedAt?: string }
): void {
  const artifact = REGISTRY.get(value);
  if (artifact?.kind !== "class") return;
  REGISTRY.set(value, { ...artifact, mutation });
}
