import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import type { ArtifactTypeContext } from "./artifact-type-context.js";
import { acceptsMissingBoundary, emitBoundaryType, emitTypeScriptType } from "./emit-type.js";

type ClassArtifact = Extract<CompiledArtifact, { readonly kind: "class" }>;

function resolveObjectSchema(schema: ATS.AnyTypeSchema): ATS.ObjectSchema | undefined {
  const base = resolveWrappers(schema).base;
  return base.type === TypeName.object ? (base as ATS.ObjectSchema) : undefined;
}

export function classArtifactType(context: ArtifactTypeContext, artifact: ClassArtifact): string {
  const value = emitTypeScriptType(artifact.schema, context.typeNames);
  if (artifact.domainEvent) return domainEventType(context, artifact, value);

  const instance = classInstanceType(context, artifact, value);
  const managedFields = new Set((artifact.managedFields ?? []).map((managed) => managed.field));
  const createInput = emitBoundaryType(artifact.schema, "create", context.typeNames, managedFields);
  const hydrateInput = emitBoundaryType(artifact.schema, "hydrate", context.typeNames);
  const trustedInput = artifact.representation === "value" ? hydrateInput : value;
  const createParameters = acceptsMissingBoundary(artifact.schema, managedFields)
    ? `...args: [] | [input: ${createInput}]`
    : `input: ${createInput}`;
  const factories = classFactories(artifact, createParameters, hydrateInput, trustedInput);
  const construct =
    artifact.construction === "factory"
      ? `(abstract new (state: ${value}) => ${instance})`
      : `(new (state: ${value}) => ${instance})`;
  return `${construct} & { ${factories.join(" ")} }`;
}

function domainEventType(context: ArtifactTypeContext, artifact: ClassArtifact, value: string): string {
  const domainEvent = artifact.domainEvent;
  if (!domainEvent) return value;
  const object = resolveObjectSchema(artifact.schema);
  const payload = object ? emitTypeScriptType(object.def.props.payload, context.typeNames) : "unknown";
  const event = `${value} & { readonly "~event": { readonly version: 1; readonly type: ${JSON.stringify(domainEvent.type)}; readonly schemaVersion: ${domainEvent.version} } }`;
  context.mark("domainEventType");
  return `(abstract new (state: ${value}) => ${event} & __JitDomainEventBrand) & { create(input: ${payload}): ${event} & __JitDomainEventBrand; hydrate(state: ${value}): ${event} & __JitDomainEventBrand; readonly type: ${JSON.stringify(domainEvent.type)}; readonly version: ${domainEvent.version} }`;
}

function classInstanceType(context: ArtifactTypeContext, artifact: ClassArtifact, value: string): string {
  const methods = classMethods(context, artifact, value);
  const hasDomainState = artifact.encapsulateFields === true || artifact.domainStateLayout?.storage === "symbol";
  const mixins = classMixins(context, artifact, value, hasDomainState, methods);
  const runtimeValue =
    artifact.representation === "value"
      ? `{ readonly value: ${value} }`
      : hasDomainState
        ? `Readonly<${value}>`
        : value;
  return mixins.length === 0 ? runtimeValue : `${runtimeValue} & ${mixins.join(" & ")}`;
}

function classMethods(context: ArtifactTypeContext, artifact: ClassArtifact, value: string): string[] {
  const methods: string[] = [];
  const capabilities = new Set(artifact.capabilities);
  if (capabilities.has("equals")) methods.push("equals(other: unknown): boolean;");
  if (capabilities.has("hashCode")) methods.push("hashCode(): number;");
  if (capabilities.has("clone")) methods.push(`clone(): ${value};`);
  if (capabilities.has("diff")) {
    methods.push(
      'diff(other: unknown): ({ readonly type: "add" | "update"; readonly path: readonly PropertyKey[]; readonly value: unknown } | { readonly type: "remove"; readonly path: readonly PropertyKey[] })[];'
    );
  }
  if (capabilities.has("value")) methods.push(`readonly value: Readonly<${value}>;`);
  if (capabilities.has("with")) methods.push(`with(patch: ${context.classUpdateType(artifact.schema)}): this;`);
  for (const method of artifact.methods ?? []) methods.push(methodType(context, method));
  return methods;
}

function methodType(context: ArtifactTypeContext, method: NonNullable<ClassArtifact["methods"]>[number]): string {
  const name = context.classMemberName(method.name);
  if (method.kind === "get") return `readonly ${name}: unknown;`;
  if (method.kind === "set") return `${name}: unknown;`;
  return `${name}(...args: never[]): unknown;`;
}

function classMixins(
  context: ArtifactTypeContext,
  artifact: ClassArtifact,
  value: string,
  hasDomainState: boolean,
  methods: readonly string[]
): string[] {
  const mixins: string[] = [];
  if (methods.length > 0) mixins.push(`{ ${methods.join(" ")} }`);
  if (artifact.aggregate) addAggregateMixin(context, artifact, mixins);
  if (hasDomainState) {
    context.mark("domainStateType");
    mixins.push(`__JitDomainState<${value}>`);
  }
  return mixins;
}

function addAggregateMixin(context: ArtifactTypeContext, artifact: ClassArtifact, mixins: string[]): void {
  context.mark("aggregateType");
  context.mark("domainEventType");
  mixins.push(`__JitAggregate<${context.classUpdateType(artifact.schema)}, __JitDomainEventBrand>`);
  const mutation = artifact.mutation;
  if (mutation?.deletedAt !== undefined) {
    const deleteMethod = context.classMemberName(mutation.deleteMethod ?? "softDelete");
    const restoreMethod = context.classMemberName(mutation.restoreMethod ?? "restore");
    const isDeletedMember = context.classMemberName(mutation.isDeletedMember ?? "isDeleted");
    mixins.push(`{ ${deleteMethod}(): void; ${restoreMethod}(): void; readonly ${isDeletedMember}: boolean }`);
  }
  if (mutation?.touchAt !== undefined || mutation?.version !== undefined) {
    mixins.push(`{ ${context.classMemberName(mutation.touchMethod ?? "touch")}(): void }`);
  }
}

function classFactories(
  artifact: ClassArtifact,
  createParameters: string,
  hydrateInput: string,
  trustedInput: string
): string[] {
  return [
    `["__jitMaterialize"]<TThis extends abstract new (...args: never[]) => unknown>(this: TThis, state: ${trustedInput}): InstanceType<TThis>;`,
    artifact.factories.create === false
      ? ""
      : `${JSON.stringify(artifact.factories.create)}<TThis extends abstract new (...args: never[]) => unknown>(this: TThis, ${createParameters}): InstanceType<TThis>;`,
    artifact.factories.hydrate === false
      ? ""
      : `${JSON.stringify(artifact.factories.hydrate)}<TThis extends abstract new (...args: never[]) => unknown>(this: TThis, state: ${hydrateInput}): InstanceType<TThis>;`,
  ].filter(Boolean);
}
