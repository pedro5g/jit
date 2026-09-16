import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
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
import { acceptsMissingBoundary, emitBoundaryType, emitTypeScriptType } from "./emit-type.js";

function resolveObjectSchema(schema: ATS.AnyTypeSchema): ATS.ObjectSchema | undefined {
  const base = resolveWrappers(schema).base;
  return base.type === TypeName.object ? (base as ATS.ObjectSchema) : undefined;
}
/** Emits the generated TypeScript surface for one compiled artifact. */
export interface ArtifactTypeContext {
  readonly typeNames: ReadonlyMap<ATS.AnyTypeSchema, string>;
  readonly classMemberName: (name: string) => string;
  readonly classUpdateType: (schema: ATS.AnyTypeSchema, seen?: Set<ATS.AnyTypeSchema>) => string;
  readonly mark: (flag: "aggregateType" | "domainStateType" | "domainEventType") => void;
}

export function artifactType(context: ArtifactTypeContext, artifact: CompiledArtifact): string {
  const { typeNames, classMemberName, classUpdateType } = context;
  if (artifact.kind === "validator") return standaloneType(artifact, typeNames);
  if (artifact.kind === "operation") return operationType(artifact, typeNames);
  if (artifact.kind === "execution") return executionPlanType(artifact.plan, typeNames);
  if (artifact.kind === "query-plan") return queryPlanType(artifact, typeNames);
  if (artifact.kind === "join-plan") return joinPlanType(artifact, typeNames);
  if (artifact.kind === "cqrs-input")
    return '{ readonly "~query": unknown; readonly parse: (input: unknown) => unknown; readonly explain: () => unknown }';
  if (artifact.kind === "cqrs-parser") return "(input: unknown) => unknown";
  if (artifact.kind === "cqrs-authorized-parser") return "(input: unknown, actor?: unknown) => unknown";
  if (artifact.kind === "collection-mutation-plan") {
    const value = namedType(artifact.schema, typeNames);
    return `(value: ${value}, params: Readonly<Record<string, unknown>>) => ${value}`;
  }
  if (artifact.kind === "derived-plan") {
    const state = namedType(artifact.schema, typeNames);
    return artifact.memo
      ? `((state: ${state}, mask?: number | bigint) => unknown) & { layout(): unknown; accepts(layout: { readonly id: string }): boolean }`
      : `(state: ${state}) => unknown`;
  }
  if (artifact.kind === "mutation-plan") {
    const value = namedType(artifact.schema, typeNames);
    return `(value: ${value}, params: Readonly<Record<${
      artifact.params.map((name) => JSON.stringify(name)).join(" | ") || "never"
    }, unknown>>) => ${value}`;
  }
  if (artifact.kind === "sort-plan") return sortPlanType(artifact, typeNames);
  if (artifact.kind === "index-plan") return indexPlanType(artifact, typeNames);
  if (artifact.kind === "lookup-plan") return lookupPlanType(artifact, typeNames);
  if (artifact.kind === "project-plan") return projectPlanType(artifact, typeNames);
  if (artifact.kind === "authorized-project-plan")
    return `(value: ${namedType(artifact.schema, typeNames)}) => Partial<${namedType(artifact.schema, typeNames)}>`;
  if (artifact.kind === "authorized-update-plan")
    return `(value: ${namedType(artifact.schema, typeNames)}, patch: unknown) => ${namedType(artifact.schema, typeNames)}`;
  if (artifact.kind === "changed-plan") return changedPlanType(artifact, typeNames);
  if (artifact.kind === "patch-plan") return patchPlanType(artifact, typeNames);
  if (artifact.kind === "cache-key-plan")
    return `(value: ${namedType(artifact.schema, typeNames)}) => ${artifact.descriptor.form === "hash" ? "number" : "string"}`;
  if (artifact.kind === "match-plan") return `(value: ${namedType(artifact.schema, typeNames)}) => unknown`;
  if (artifact.kind === "migration-plan") return migrationPlanType(artifact, typeNames);
  if (artifact.kind === "csv-plan") return csvPlanType(artifact, typeNames);
  if (artifact.kind === "ndjson-plan") return ndjsonPlanType(artifact, typeNames);
  if (artifact.kind === "access-plan") return accessPlanType(artifact, typeNames);
  if (artifact.kind === "rules-plan") return rulesPlanType(artifact, typeNames);
  if (artifact.kind === "canonical-plan") {
    const canonicalValue = namedType(artifact.schema, typeNames);

    return `(value: ${canonicalValue}) => ${canonicalValue}`;
  }
  if (artifact.kind === "class") {
    const value = emitTypeScriptType(artifact.schema, typeNames);
    if (artifact.domainEvent) {
      const object = resolveObjectSchema(artifact.schema);
      const payload = object ? emitTypeScriptType(object.def.props.payload, typeNames) : "unknown";
      const event = `${value} & { readonly "~event": { readonly version: 1; readonly type: ${JSON.stringify(artifact.domainEvent.type)}; readonly schemaVersion: ${artifact.domainEvent.version} } }`;
      context.mark("domainEventType");

      return `(abstract new (state: ${value}) => ${event} & __JitDomainEventBrand) & { create(input: ${payload}): ${event} & __JitDomainEventBrand; hydrate(state: ${value}): ${event} & __JitDomainEventBrand; readonly type: ${JSON.stringify(artifact.domainEvent.type)}; readonly version: ${artifact.domainEvent.version} }`;
    }
    const methods: string[] = [];
    const capabilities = new Set(artifact.capabilities);
    const hasDomainState = artifact.encapsulateFields === true || artifact.domainStateLayout?.storage === "symbol";
    if (capabilities.has("equals")) methods.push("equals(other: unknown): boolean;");
    if (capabilities.has("hashCode")) methods.push("hashCode(): number;");
    if (capabilities.has("clone")) methods.push(`clone(): ${value};`);
    if (capabilities.has("diff"))
      methods.push(
        'diff(other: unknown): ({ readonly type: "add" | "update"; readonly path: readonly PropertyKey[]; readonly value: unknown } | { readonly type: "remove"; readonly path: readonly PropertyKey[] })[];'
      );
    if (capabilities.has("value")) methods.push(`readonly value: Readonly<${value}>;`);
    if (capabilities.has("with")) {
      methods.push(`with(patch: ${classUpdateType(artifact.schema)}): this;`);
    }
    // A serialized method carries its arity but not its types. The generated
    // declaration says so rather than inventing a signature; the TypeScript
    // output format infers the real one from the emitted body.
    for (const method of artifact.methods ?? []) {
      const name = classMemberName(method.name);
      if (method.kind === "get") methods.push(`readonly ${name}: unknown;`);
      else if (method.kind === "set") methods.push(`${name}: unknown;`);
      else methods.push(`${name}(...args: never[]): unknown;`);
    }
    const mixins: string[] = [];
    if (methods.length > 0) mixins.push(`{ ${methods.join(" ")} }`);
    if (artifact.aggregate) {
      context.mark("aggregateType");
      context.mark("domainEventType");
      mixins.push(`__JitAggregate<${classUpdateType(artifact.schema)}, __JitDomainEventBrand>`);
      if (artifact.mutation?.deletedAt !== undefined) {
        const deleteMethod = classMemberName(artifact.mutation.deleteMethod ?? "softDelete");
        const restoreMethod = classMemberName(artifact.mutation.restoreMethod ?? "restore");
        const isDeletedMember = classMemberName(artifact.mutation.isDeletedMember ?? "isDeleted");
        mixins.push(`{ ${deleteMethod}(): void; ${restoreMethod}(): void; readonly ${isDeletedMember}: boolean }`);
      }
      if (artifact.mutation?.touchAt !== undefined || artifact.mutation?.version !== undefined) {
        mixins.push(`{ ${classMemberName(artifact.mutation.touchMethod ?? "touch")}(): void }`);
      }
    }
    if (hasDomainState) {
      context.mark("domainStateType");
      mixins.push(`__JitDomainState<${value}>`);
    }
    const runtimeValue =
      artifact.representation === "value"
        ? `{ readonly value: ${value} }`
        : hasDomainState
          ? `Readonly<${value}>`
          : value;
    const instance = mixins.length === 0 ? runtimeValue : `${runtimeValue} & ${mixins.join(" & ")}`;
    const managedFields = new Set((artifact.managedFields ?? []).map((managed) => managed.field));
    const createInput = emitBoundaryType(artifact.schema, "create", typeNames, managedFields);
    const hydrateInput = emitBoundaryType(artifact.schema, "hydrate", typeNames);
    const createParameters = acceptsMissingBoundary(artifact.schema, managedFields)
      ? `...args: [] | [input: ${createInput}]`
      : `input: ${createInput}`;
    const factories = [
      artifact.factories.create === false
        ? ""
        : `${JSON.stringify(artifact.factories.create)}<TThis extends abstract new (...args: never[]) => unknown>(this: TThis, ${createParameters}): InstanceType<TThis>;`,
      artifact.factories.hydrate === false
        ? ""
        : `${JSON.stringify(artifact.factories.hydrate)}<TThis extends abstract new (...args: never[]) => unknown>(this: TThis, state: ${hydrateInput}): InstanceType<TThis>;`,
    ].filter(Boolean);
    const construct =
      artifact.construction === "factory"
        ? `(abstract new (state: ${value}) => ${instance})`
        : `(new (state: ${value}) => ${instance})`;
    return `${construct} & { ${factories.join(" ")} }`;
  }
  return "unknown";
}
