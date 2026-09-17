import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import type { ArtifactTypeContext } from "./artifact-type-context.js";
import {
  accessPlanType,
  changedPlanType,
  csvPlanType,
  executionPlanType,
  indexPlanType,
  joinPlanType,
  lookupPlanType,
  migrationPlanType,
  namedType,
  ndjsonPlanType,
  operationType,
  patchPlanType,
  projectPlanType,
  queryPlanType,
  rulesPlanType,
  sortPlanType,
  standaloneType,
} from "./artifact-types.js";
import { classArtifactType } from "./emit-class-type.js";

export type { ArtifactTypeContext } from "./artifact-type-context.js";

type ArtifactKind = CompiledArtifact["kind"];
type ArtifactTypeHandler = (context: ArtifactTypeContext, artifact: CompiledArtifact) => string;

const ARTIFACT_TYPE_HANDLERS: Partial<Record<ArtifactKind, ArtifactTypeHandler>> = {
  validator: (context, artifact) =>
    standaloneType(artifact as Extract<CompiledArtifact, { readonly kind: "validator" }>, context.typeNames),
  operation: (context, artifact) =>
    operationType(artifact as Extract<CompiledArtifact, { readonly kind: "operation" }>, context.typeNames),
  execution: (context, artifact) =>
    executionPlanType((artifact as Extract<CompiledArtifact, { readonly kind: "execution" }>).plan, context.typeNames),
  "query-plan": (context, artifact) =>
    queryPlanType(artifact as Extract<CompiledArtifact, { readonly kind: "query-plan" }>, context.typeNames),
  "join-plan": (context, artifact) =>
    joinPlanType(artifact as Extract<CompiledArtifact, { readonly kind: "join-plan" }>, context.typeNames),
  "cqrs-input": () =>
    '{ readonly "~query": unknown; readonly parse: (input: unknown) => unknown; readonly explain: () => unknown }',
  "cqrs-parser": () => "(input: unknown) => unknown",
  "cqrs-authorized-parser": () => "(input: unknown, actor?: unknown) => unknown",
  "collection-mutation-plan": (context, artifact) => {
    const value = namedType(
      (artifact as Extract<CompiledArtifact, { readonly kind: "collection-mutation-plan" }>).schema,
      context.typeNames
    );
    return `(value: ${value}, params: Readonly<Record<string, unknown>>) => ${value}`;
  },
  "derived-plan": (context, artifact) => {
    const derived = artifact as Extract<CompiledArtifact, { readonly kind: "derived-plan" }>;
    const state = namedType(derived.schema, context.typeNames);
    return derived.memo
      ? `((state: ${state}, mask?: number | bigint) => unknown) & { layout(): unknown; accepts(layout: { readonly id: string }): boolean }`
      : `(state: ${state}) => unknown`;
  },
  "mutation-plan": (context, artifact) => {
    const mutation = artifact as Extract<CompiledArtifact, { readonly kind: "mutation-plan" }>;
    const value = namedType(mutation.schema, context.typeNames);
    const params = mutation.params.map((name) => JSON.stringify(name)).join(" | ") || "never";
    return `(value: ${value}, params: Readonly<Record<${params}, unknown>>) => ${value}`;
  },
  "sort-plan": (context, artifact) =>
    sortPlanType(artifact as Extract<CompiledArtifact, { readonly kind: "sort-plan" }>, context.typeNames),
  "index-plan": (context, artifact) =>
    indexPlanType(artifact as Extract<CompiledArtifact, { readonly kind: "index-plan" }>, context.typeNames),
  "lookup-plan": (context, artifact) =>
    lookupPlanType(artifact as Extract<CompiledArtifact, { readonly kind: "lookup-plan" }>, context.typeNames),
  "project-plan": (context, artifact) =>
    projectPlanType(artifact as Extract<CompiledArtifact, { readonly kind: "project-plan" }>, context.typeNames),
  "authorized-project-plan": (context, artifact) => {
    const project = artifact as Extract<CompiledArtifact, { readonly kind: "authorized-project-plan" }>;
    const value = namedType(project.schema, context.typeNames);
    return `(value: ${value}) => Partial<${value}>`;
  },
  "authorized-update-plan": (context, artifact) => {
    const update = artifact as Extract<CompiledArtifact, { readonly kind: "authorized-update-plan" }>;
    const value = namedType(update.schema, context.typeNames);
    return `(value: ${value}, patch: unknown) => ${value}`;
  },
  "changed-plan": (context, artifact) =>
    changedPlanType(artifact as Extract<CompiledArtifact, { readonly kind: "changed-plan" }>, context.typeNames),
  "patch-plan": (context, artifact) =>
    patchPlanType(artifact as Extract<CompiledArtifact, { readonly kind: "patch-plan" }>, context.typeNames),
  "cache-key-plan": (context, artifact) => {
    const cacheKey = artifact as Extract<CompiledArtifact, { readonly kind: "cache-key-plan" }>;
    const value = namedType(cacheKey.schema, context.typeNames);
    return `(value: ${value}) => ${cacheKey.descriptor.form === "hash" ? "number" : "string"}`;
  },
  "match-plan": (context, artifact) => {
    const match = artifact as Extract<CompiledArtifact, { readonly kind: "match-plan" }>;
    return `(value: ${namedType(match.schema, context.typeNames)}) => unknown`;
  },
  "migration-plan": (context, artifact) =>
    migrationPlanType(artifact as Extract<CompiledArtifact, { readonly kind: "migration-plan" }>, context.typeNames),
  "csv-plan": (context, artifact) =>
    csvPlanType(artifact as Extract<CompiledArtifact, { readonly kind: "csv-plan" }>, context.typeNames),
  "ndjson-plan": (context, artifact) =>
    ndjsonPlanType(artifact as Extract<CompiledArtifact, { readonly kind: "ndjson-plan" }>, context.typeNames),
  "access-plan": (context, artifact) =>
    accessPlanType(artifact as Extract<CompiledArtifact, { readonly kind: "access-plan" }>, context.typeNames),
  "rules-plan": (context, artifact) =>
    rulesPlanType(artifact as Extract<CompiledArtifact, { readonly kind: "rules-plan" }>, context.typeNames),
  "canonical-plan": (context, artifact) => {
    const canonical = artifact as Extract<CompiledArtifact, { readonly kind: "canonical-plan" }>;
    const value = namedType(canonical.schema, context.typeNames);
    return `(value: ${value}) => ${value}`;
  },
  class: (context, artifact) =>
    classArtifactType(context, artifact as Extract<CompiledArtifact, { readonly kind: "class" }>),
};

/** Emits the generated TypeScript surface for one compiled artifact. */
export function artifactType(context: ArtifactTypeContext, artifact: CompiledArtifact): string {
  const handler = ARTIFACT_TYPE_HANDLERS[artifact.kind];
  return handler ? handler(context, artifact) : "unknown";
}
