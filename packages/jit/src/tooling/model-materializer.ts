import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import * as JIT from "../factories/index.js";
import type {
  AgentDeclaration,
  DeclarationCheck,
  DeclarationProjectV1,
  DeclarationSchema,
} from "./declaration-protocol.js";

/** Runtime values and artifact bindings lowered from a Declaration Protocol project. */
export interface MaterializedProject {
  readonly artifacts: Readonly<Record<string, unknown>>;
  readonly schemas: Readonly<Record<string, SchemaInput>>;
  readonly modulePaths: Readonly<Record<string, string>>;
}

/** Materializes declarations through the existing JIT builders and DDD factories. */
export function materializeProject(project: DeclarationProjectV1): MaterializedProject {
  const values = new Map<string, unknown>();
  const schemas = new Map<string, ATS.AnyTypeSchema>();
  const building = new Set<string>();

  const resolveValue = (name: string): unknown => {
    const existing = values.get(name);
    if (existing !== undefined) return existing;
    const declaration = project.declarations[name];
    if (!declaration) throw new Error(`Declaration ${name} does not exist.`);
    if (building.has(name))
      throw new Error(`Cyclic declaration reference at ${name}; use a TypeScript declaration for recursive schemas.`);
    building.add(name);
    const base = buildSchema(declaration.schema, resolveValue);
    const value = declaration.kind === "schema" ? base : buildRuntimeType(declaration, base, name);
    values.set(name, value);
    schemas.set(name, schemaOf(value));
    building.delete(name);
    return value;
  };

  const artifacts: Record<string, unknown> = {};
  const exportedSchemas: Record<string, SchemaInput> = {};
  const modulePaths: Record<string, string> = {};
  for (const name of Object.keys(project.declarations).sort()) {
    const value = resolveValue(name);
    const declaration = project.declarations[name];
    const modulePath = declaration?.module === undefined ? name : `${declaration.module}/${name}`;
    modulePaths[name] = modulePath;
    if (declaration?.kind === "schema") {
      exportedSchemas[name] = schemaOf(value) as SchemaInput;
      artifacts[`is${name}`] = JIT.validate.is(schemaOf(value));
      artifacts[`parse${name}`] = JIT.validate.parse(schemaOf(value));
      modulePaths[`is${name}`] = modulePath;
      modulePaths[`parse${name}`] = modulePath;
    } else {
      artifacts[name] = value;
    }
  }
  return { artifacts, schemas: exportedSchemas, modulePaths };
}

function buildSchema(schema: DeclarationSchema, resolveDeclaration: (name: string) => unknown): unknown {
  if (schema.type === "string" || schema.type === "number" || schema.type === "boolean" || schema.type === "bigint") {
    const builder =
      schema.type === "string"
        ? JIT.string()
        : schema.type === "number"
          ? JIT.number()
          : schema.type === "boolean"
            ? JIT.boolean()
            : JIT.bigint();
    return applyChecks(builder, schema.checks ?? []);
  }
  if (schema.type === "literal") return JIT.literal(schema.value);
  if (schema.type === "ref") return schemaOf(resolveDeclaration(schema.name));
  if (schema.type === "array") return JIT.array(schemaOf(buildSchema(schema.element, resolveDeclaration)));
  if (schema.type === "union")
    return invoke(
      JIT.union,
      schema.options.map((option) => schemaOf(buildSchema(option, resolveDeclaration)))
    );
  if (schema.type !== "object") throw new Error(`Unsupported declaration schema ${schema.type}.`);
  const fields: Record<string, SchemaInput> = {};
  for (const [name, child] of Object.entries(schema.fields)) {
    fields[name] = schemaOf(buildSchema(child as DeclarationSchema, resolveDeclaration)) as SchemaInput;
  }
  return JIT.object(fields);
}

function buildRuntimeType(declaration: AgentDeclaration, schema: unknown, name: string): unknown {
  const structural = unwrapSchema(schema as SchemaInput<ATS.AnyTypeSchema>);
  if (declaration.kind === "valueObject") {
    return declaration.identity === true
      ? invoke(JIT.ddd.uniqueIdentifier, [structural])
      : invoke(JIT.ddd.valueObject, [structural]);
  }
  if (declaration.kind === "domainEvent")
    return invoke(JIT.ddd.domainEvent, [name, { version: 1, payload: structural }]);

  const factory = declaration.kind === "entity" ? JIT.ddd.entity : JIT.ddd.aggregateRoot;
  const identity = typeof declaration.identity === "string" ? { id: declaration.identity } : undefined;
  let runtime = invoke(factory, identity === undefined ? [structural] : [structural, identity]);
  for (const extension of declaration.extends ?? []) {
    const capabilityFactory = (JIT.ddd as unknown as Readonly<Record<string, unknown>>)[extension.capability];
    if (typeof capabilityFactory !== "function") {
      throw new Error(`Declaration ${name} uses unavailable capability ${extension.capability}.`);
    }
    const capability = invoke(capabilityFactory, extension.options === undefined ? [] : [extension.options]);
    const extend = (runtime as Readonly<Record<string, unknown>>).extends;
    runtime = invoke(extend, [capability]);
  }
  return runtime;
}

function applyChecks(builder: unknown, checks: readonly DeclarationCheck[]): unknown {
  let current = builder;
  for (const check of checks) {
    const value = current as Record<string, unknown>;
    const method = value[check.kind];
    if (typeof method !== "function")
      throw new Error(`Declaration check ${check.kind} is not available on this schema.`);
    current = (method as (...args: readonly unknown[]) => unknown).call(
      current,
      ...(check.value === undefined ? [] : [check.value])
    );
  }
  return current;
}

function schemaOf(value: unknown): ATS.AnyTypeSchema {
  if (typeof value === "object" && value !== null && "schema" in value) {
    const schema = (value as { readonly schema?: unknown }).schema;
    if (schema !== undefined) return unwrapSchema(schema as SchemaInput<ATS.AnyTypeSchema>);
  }
  return unwrapSchema(value as SchemaInput<ATS.AnyTypeSchema>);
}

function invoke(functionValue: unknown, args: readonly unknown[]): unknown {
  if (typeof functionValue !== "function") throw new Error("Declaration schema operator is unavailable.");
  return (functionValue as (...values: readonly unknown[]) => unknown)(...args);
}
