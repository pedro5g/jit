import { sha256, stableJson } from "../aot/artifact-manifest.js";
import type { JsonPrimitive, JsonValue } from "./contracts.js";

/** Current version of the structured agent declaration protocol. */
export const DECLARATION_PROTOCOL_VERSION = 1 as const;

/** A portable check understood by the existing JIT builder lowering. */
export interface DeclarationCheck {
  /** Stable validation operator name. */
  readonly kind: string;
  /** Optional JSON value consumed by the check. */
  readonly value?: JsonValue;
}

/** A schema node accepted by Declaration Protocol V1. */
export type DeclarationSchema =
  | { readonly type: "string" | "number" | "boolean" | "bigint"; readonly checks?: readonly DeclarationCheck[] }
  | { readonly type: "object"; readonly fields: Readonly<Record<string, DeclarationSchema>> }
  | { readonly type: "array"; readonly element: DeclarationSchema }
  | { readonly type: "literal"; readonly value: JsonPrimitive }
  | { readonly type: "ref"; readonly name: string }
  | { readonly type: "union"; readonly options: readonly DeclarationSchema[] };

/** One declarative domain or schema declaration. */
export interface AgentDeclaration {
  /** Domain role represented by the declaration. */
  readonly kind: "schema" | "valueObject" | "entity" | "aggregateRoot" | "domainEvent";
  /** Portable schema definition for the declaration. */
  readonly schema: DeclarationSchema;
  /** Optional project module that owns the declaration. */
  readonly module?: string;
  /** Optional identity policy for entity-like declarations. */
  readonly identity?: string | boolean;
  /** Optional runtime capabilities attached during materialization. */
  readonly extends?: readonly {
    /** Capability name. */
    readonly capability: string;
    /** Capability configuration values. */
    readonly options?: Readonly<Record<string, JsonValue>>;
  }[];
}

/** A revisioned, transport-neutral declaration project. */
export interface DeclarationProjectV1 {
  /** Wire version of the declaration protocol. */
  readonly version: typeof DECLARATION_PROTOCOL_VERSION;
  /** Content revision used for optimistic concurrency. */
  readonly revision: string;
  /** Project modules referenced by declarations. */
  readonly modules: readonly string[];
  /** Named declarations in the project. */
  readonly declarations: Readonly<Record<string, AgentDeclaration>>;
}

/** Operations accepted by the transactional model editor. */
export type DeclarationOperation =
  | { readonly op: "create"; readonly name: string; readonly declaration: AgentDeclaration }
  | { readonly op: "update"; readonly name: string; readonly declaration: AgentDeclaration }
  | { readonly op: "remove"; readonly name: string }
  | { readonly op: "rename"; readonly from: string; readonly to: string }
  | { readonly op: "move"; readonly name: string; readonly module: string }
  | { readonly op: "createModule"; readonly module: string }
  | { readonly op: "removeModule"; readonly module: string };

/** One optimistic-concurrency model edit. */
export interface DeclarationPatchV1 {
  /** Wire version of the declaration protocol. */
  readonly version: typeof DECLARATION_PROTOCOL_VERSION;
  /** Revision that must still be current before applying the patch. */
  readonly baseRevision: string;
  /** Ordered transactional operations to apply. */
  readonly operations: readonly DeclarationOperation[];
}

/** Parses untrusted JSON into a validated Declaration Protocol patch shape. */
export function parseDeclarationPatch(input: JsonValue): DeclarationPatchV1 {
  const record = asRecord(input, "patch");
  const baseRevision = requiredString(record, "baseRevision", "patch");
  const rawOperations = record.operations;
  if (!Array.isArray(rawOperations) || rawOperations.length === 0)
    throw new Error("patch.operations must be a non-empty array.");

  return {
    version: record.version === undefined ? DECLARATION_PROTOCOL_VERSION : requiredVersion(record.version),
    baseRevision,
    operations: rawOperations.map((operation, index) => parseOperation(operation, index)),
  };
}

/** Machine-readable revision conflict from an optimistic model edit. */
export class RevisionConflictError extends Error {
  /** Stable machine-readable error code. */
  readonly code = "REVISION_CONFLICT";
  /** Revision supplied by the caller. */
  readonly expected: string;
  /** Revision currently held by the project. */
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(`Declaration project changed: expected revision ${expected}, received ${actual}.`);
    this.name = "RevisionConflictError";
    this.expected = expected;
    this.actual = actual;
  }
}

/** Creates a validated project with a deterministic initial revision. */
export function createDeclarationProject(
  declarations: Readonly<Record<string, AgentDeclaration>> = {},
  modules: readonly string[] = []
): DeclarationProjectV1 {
  const project = {
    version: DECLARATION_PROTOCOL_VERSION,
    revision: "",
    modules: [...new Set(modules)].sort(compareText),
    declarations: { ...declarations },
  } satisfies Omit<DeclarationProjectV1, "revision"> & { readonly revision: string };
  validateDeclarationProject(project);
  return freezeProject({ ...project, revision: revisionFor(project) });
}

/** Validates a protocol project without compiling it or executing callbacks. */
export function validateDeclarationProject(project: DeclarationProjectV1): void {
  if (project.version !== DECLARATION_PROTOCOL_VERSION) throw new Error("Unsupported Declaration Protocol version.");
  if (project.revision !== "" && project.revision !== declarationProjectRevision(project)) {
    throw new Error(`Declaration project revision ${project.revision} does not match its contents.`);
  }
  const modules = new Set(project.modules);
  for (const module of project.modules) validateModuleName(module);

  for (const [name, declaration] of Object.entries(project.declarations)) {
    validateDeclarationName(name);
    if (declaration.module !== undefined) {
      validateModuleName(declaration.module);
      if (!modules.has(declaration.module))
        throw new Error(`Declaration ${name} refers to missing module ${declaration.module}.`);
    }
    validateSchema(declaration.schema, project.declarations, name);
  }
}

/** Applies a patch only when its base revision is still current. */
export function applyDeclarationPatch(project: DeclarationProjectV1, patch: DeclarationPatchV1): DeclarationProjectV1 {
  if (patch.version !== DECLARATION_PROTOCOL_VERSION) throw new Error("Unsupported Declaration Protocol version.");
  if (patch.baseRevision !== project.revision) throw new RevisionConflictError(patch.baseRevision, project.revision);

  const declarations = { ...project.declarations };
  const modules = new Set(project.modules);

  for (const operation of patch.operations) applyDeclarationOperation(operation, declarations, modules);

  const next = createDeclarationProject(declarations, [...modules]);
  return freezeProject(next);
}

function applyDeclarationOperation(
  operation: DeclarationOperation,
  declarations: Record<string, AgentDeclaration>,
  modules: Set<string>
): void {
  switch (operation.op) {
    case "create":
    case "update":
      applyDeclarationUpsert(operation, declarations, modules);
      return;
    case "remove":
      removeDeclaration(operation.name, declarations);
      return;
    case "rename":
      renameDeclaration(operation.from, operation.to, declarations);
      return;
    case "move":
      moveDeclaration(operation.name, operation.module, declarations, modules);
      return;
    case "createModule":
      createModule(operation.module, modules);
      return;
    case "removeModule":
      removeModule(operation.module, declarations, modules);
      return;
  }
}

function applyDeclarationUpsert(
  operation: Extract<DeclarationOperation, { readonly op: "create" | "update" }>,
  declarations: Record<string, AgentDeclaration>,
  modules: Set<string>
): void {
  const exists = declarations[operation.name] !== undefined;
  if (operation.op === "create" && exists) throw new Error(`Declaration ${operation.name} already exists.`);
  if (operation.op === "update" && !exists) throw new Error(`Declaration ${operation.name} does not exist.`);
  declarations[operation.name] = operation.declaration;
  if (operation.declaration.module !== undefined) modules.add(operation.declaration.module);
}

function removeDeclaration(name: string, declarations: Record<string, AgentDeclaration>): void {
  if (!declarations[name]) throw new Error(`Declaration ${name} does not exist.`);
  delete declarations[name];
}

function renameDeclaration(from: string, to: string, declarations: Record<string, AgentDeclaration>): void {
  const declaration = declarations[from];
  if (!declaration) throw new Error(`Declaration ${from} does not exist.`);
  if (declarations[to]) throw new Error(`Declaration ${to} already exists.`);
  delete declarations[from];
  declarations[to] = rewriteReference(declaration, from, to);
  for (const [name, value] of Object.entries(declarations)) declarations[name] = rewriteReference(value, from, to);
}

function moveDeclaration(
  name: string,
  module: string,
  declarations: Record<string, AgentDeclaration>,
  modules: Set<string>
): void {
  const declaration = declarations[name];
  if (!declaration) throw new Error(`Declaration ${name} does not exist.`);
  modules.add(module);
  declarations[name] = { ...declaration, module };
}

function createModule(name: string, modules: Set<string>): void {
  validateModuleName(name);
  if (modules.has(name)) throw new Error(`Module ${name} already exists.`);
  modules.add(name);
}

function removeModule(name: string, declarations: Record<string, AgentDeclaration>, modules: Set<string>): void {
  if (Object.values(declarations).some((declaration) => declaration.module === name)) {
    throw new Error(`Module ${name} still owns declarations.`);
  }
  if (!modules.delete(name)) throw new Error(`Module ${name} does not exist.`);
}

/** Returns only the requested declaration scope, preserving its revision. */
export function declarationScope(project: DeclarationProjectV1, scope: string | undefined): DeclarationProjectV1 {
  if (!scope) return project;
  const declaration = project.declarations[scope];
  if (!declaration) return freezeProject({ ...project, declarations: {} });
  return freezeProject({ ...project, declarations: { [scope]: declaration } });
}

function validateSchema(
  schema: DeclarationSchema,
  declarations: Readonly<Record<string, AgentDeclaration>>,
  owner: string
): void {
  if (schema.type === "ref") {
    if (!declarations[schema.name])
      throw new Error(`Declaration ${owner} refers to missing declaration ${schema.name}.`);
    return;
  }
  if (schema.type === "object") {
    for (const [field, child] of Object.entries(schema.fields)) {
      if (field.length === 0) throw new Error(`Declaration ${owner} contains an empty field name.`);
      validateSchema(child, declarations, owner);
    }
    return;
  }
  if (schema.type === "array") {
    validateSchema(schema.element, declarations, owner);
    return;
  }
  if (schema.type === "union") {
    if (schema.options.length === 0) throw new Error(`Declaration ${owner} contains an empty union.`);
    for (const option of schema.options) validateSchema(option, declarations, owner);
  }
}

function parseOperation(input: JsonValue, index: number): DeclarationOperation {
  const record = asRecord(input, `patch.operations[${index}]`);
  const op = requiredString(record, "op", `patch.operations[${index}]`);
  if (op === "create" || op === "update") {
    return {
      op,
      name: requiredString(record, "name", `patch.operations[${index}]`),
      declaration: parseDeclaration(record.declaration, `patch.operations[${index}].declaration`),
    };
  }
  if (op === "remove" || op === "move") {
    const name = requiredString(record, "name", `patch.operations[${index}]`);
    if (op === "remove") return { op, name };
    return { op, name, module: requiredString(record, "module", `patch.operations[${index}]`) };
  }
  if (op === "rename") {
    return {
      op,
      from: requiredString(record, "from", `patch.operations[${index}]`),
      to: requiredString(record, "to", `patch.operations[${index}]`),
    };
  }
  if (op === "createModule" || op === "removeModule") {
    return { op, module: requiredString(record, "module", `patch.operations[${index}]`) };
  }
  throw new Error(`Unsupported declaration operation ${JSON.stringify(op)}.`);
}

function parseDeclaration(input: JsonValue | undefined, path: string): AgentDeclaration {
  const record = asRecord(input, path);
  const kind = requiredString(record, "kind", path);
  if (
    kind !== "schema" &&
    kind !== "valueObject" &&
    kind !== "entity" &&
    kind !== "aggregateRoot" &&
    kind !== "domainEvent"
  ) {
    throw new Error(`Unsupported declaration kind ${JSON.stringify(kind)} at ${path}.`);
  }
  const module = optionalString(record.module, `${path}.module`);
  const identity = record.identity === undefined ? undefined : parseIdentity(record.identity, `${path}.identity`);
  const rawExtends = record.extends;
  const extendsValue = rawExtends === undefined ? undefined : parseExtensions(rawExtends, `${path}.extends`);
  return {
    kind,
    schema: parseSchema(record.schema, `${path}.schema`),
    ...(module === undefined ? {} : { module }),
    ...(identity === undefined ? {} : { identity }),
    ...(extendsValue === undefined ? {} : { extends: extendsValue }),
  };
}

function parseSchema(input: JsonValue | undefined, path: string): DeclarationSchema {
  const record = asRecord(input, path);
  const type = requiredString(record, "type", path);
  if (type === "string" || type === "number" || type === "boolean" || type === "bigint") {
    const checks = record.checks === undefined ? undefined : parseChecks(record.checks, `${path}.checks`);
    return checks === undefined ? { type } : { type, checks };
  }
  if (type === "literal") {
    if (!isJsonPrimitive(record.value)) throw new Error(`${path}.value must be a JSON primitive.`);
    return { type, value: record.value };
  }
  if (type === "ref") return { type, name: requiredString(record, "name", path) };
  if (type === "array") return { type, element: parseSchema(record.element, `${path}.element`) };
  if (type === "union") {
    if (!Array.isArray(record.options) || record.options.length === 0)
      throw new Error(`${path}.options must be a non-empty array.`);
    return { type, options: record.options.map((option, index) => parseSchema(option, `${path}.options[${index}]`)) };
  }
  if (type === "object") {
    const fields = asRecord(record.fields, `${path}.fields`);
    return {
      type,
      fields: Object.fromEntries(
        Object.entries(fields).map(([name, child]) => [name, parseSchema(child, `${path}.fields.${name}`)])
      ),
    };
  }
  throw new Error(`Unsupported declaration schema type ${JSON.stringify(type)} at ${path}.`);
}

function parseChecks(input: JsonValue, path: string): readonly DeclarationCheck[] {
  if (!Array.isArray(input)) throw new Error(`${path} must be an array.`);
  return input.map((value, index) => {
    const record = asRecord(value, `${path}[${index}]`);
    const kind = requiredString(record, "kind", `${path}[${index}]`);
    return record.value === undefined ? { kind } : { kind, value: record.value };
  });
}

function parseExtensions(
  input: JsonValue,
  path: string
): readonly { readonly capability: string; readonly options?: Readonly<Record<string, JsonValue>> }[] {
  if (!Array.isArray(input)) throw new Error(`${path} must be an array.`);
  return input.map((value, index) => {
    const record = asRecord(value, `${path}[${index}]`);
    const capability = requiredString(record, "capability", `${path}[${index}]`);
    const options = record.options === undefined ? undefined : asRecord(record.options, `${path}[${index}].options`);
    return options === undefined ? { capability } : { capability, options };
  });
}

function parseIdentity(value: JsonValue, path: string): string | boolean {
  if (typeof value === "string" || typeof value === "boolean") return value;
  throw new Error(`${path} must be a string or boolean.`);
}

function asRecord(value: JsonValue | undefined, path: string): Readonly<Record<string, JsonValue>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${path} must be an object.`);
  return value as Readonly<Record<string, JsonValue>>;
}

function requiredString(record: Readonly<Record<string, JsonValue>>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path}.${key} must be a non-empty string.`);
  return value;
}

function optionalString(value: JsonValue | undefined, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string.`);
  return value;
}

function requiredVersion(value: JsonValue): typeof DECLARATION_PROTOCOL_VERSION {
  if (value !== DECLARATION_PROTOCOL_VERSION) throw new Error("Unsupported Declaration Protocol version.");
  return DECLARATION_PROTOCOL_VERSION;
}

function isJsonPrimitive(value: JsonValue | undefined): value is JsonPrimitive {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function rewriteReference<T extends AgentDeclaration>(declaration: T, from: string, to: string): T {
  return { ...declaration, schema: rewriteSchema(declaration.schema, from, to) };
}

function rewriteSchema(schema: DeclarationSchema, from: string, to: string): DeclarationSchema {
  if (schema.type === "ref") return schema.name === from ? { ...schema, name: to } : schema;
  if (schema.type === "object")
    return {
      ...schema,
      fields: Object.fromEntries(
        Object.entries(schema.fields).map(([key, child]) => [key, rewriteSchema(child, from, to)])
      ),
    };
  if (schema.type === "array") return { ...schema, element: rewriteSchema(schema.element, from, to) };
  if (schema.type === "union")
    return { ...schema, options: schema.options.map((option) => rewriteSchema(option, from, to)) };
  return schema;
}

function revisionFor(project: Omit<DeclarationProjectV1, "revision"> & { readonly revision: string }): string {
  return declarationProjectRevision(project);
}

/** Computes the stable revision from declarations and module ownership only. */
export function declarationProjectRevision(
  project: Pick<DeclarationProjectV1, "version" | "modules" | "declarations">
): string {
  return `R${declarationProjectDigest(project).slice(0, 12)}`;
}

/** Computes the full hash used to bind a generated artifact to this model. */
export function declarationProjectDigest(
  project: Pick<DeclarationProjectV1, "version" | "modules" | "declarations">
): string {
  return sha256(stableJson({ version: project.version, modules: project.modules, declarations: project.declarations }));
}

function freezeProject(project: DeclarationProjectV1): DeclarationProjectV1 {
  return Object.freeze({
    ...project,
    modules: Object.freeze([...project.modules]),
    declarations: Object.freeze({ ...project.declarations }),
  });
}

function validateDeclarationName(name: string): void {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) throw new Error(`Invalid declaration name ${JSON.stringify(name)}.`);
}

function validateModuleName(name: string): void {
  if (name.length === 0 || name.startsWith("/") || name.includes("..") || name.includes("\\")) {
    throw new Error(`Invalid module path ${JSON.stringify(name)}.`);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
