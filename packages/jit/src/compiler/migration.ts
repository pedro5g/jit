import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { buildMapperPlan, type MapperFieldPlan, type MapperPlan } from "./mapper/build-mapper-plan.js";
import { emitMapperPlanFunctionSource } from "./mapper.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitLiteral } from "./source/literal.js";

export type MigrationVersion = string | number;

export interface MigrationEdge {
  readonly source: ATS.AnyTypeSchema;
  readonly target: ATS.AnyTypeSchema;
  readonly from: MigrationVersion;
  readonly to: MigrationVersion;
  readonly mapper: MapperPlan;
}

export interface MigrationDescriptor {
  readonly schemas: readonly ATS.AnyTypeSchema[];
  readonly versions: readonly MigrationVersion[];
  readonly edges: readonly MigrationEdge[];
  readonly bindingNames: readonly string[];
  readonly bindingValues: readonly unknown[];
}

type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };

export function createMigrationDescriptor(schema: ATS.AnyTypeSchema): MigrationDescriptor {
  const version = resolveMigrationVersion(schema);

  return Object.freeze({
    schemas: Object.freeze([schema]),
    versions: Object.freeze([version]),
    edges: Object.freeze([]),
    bindingNames: Object.freeze([]),
    bindingValues: Object.freeze([]),
  });
}

export function appendMigrationEdge(
  descriptor: MigrationDescriptor,
  target: ATS.AnyTypeSchema,
  overrides: Readonly<Record<string, unknown>> = {}
): MigrationDescriptor {
  const source = descriptor.schemas[descriptor.schemas.length - 1];
  const from = descriptor.versions[descriptor.versions.length - 1];
  const to = resolveMigrationVersion(target);

  if (descriptor.versions.includes(to)) {
    throw new JITError("INVALID_OPERATION", `JIT.migrate() repeats version ${JSON.stringify(to)}`);
  }

  const edgeIndex = descriptor.edges.length;
  const mapper = prefixMapperBindings(
    forceVersionConstant(buildMapperPlan(source, target, { ...overrides, version: { default: to } })),
    `__migration${edgeIndex}_`
  );
  const edge = Object.freeze({ source, target, from, to, mapper });

  return Object.freeze({
    schemas: Object.freeze([...descriptor.schemas, target]),
    versions: Object.freeze([...descriptor.versions, to]),
    edges: Object.freeze([...descriptor.edges, edge]),
    bindingNames: Object.freeze([...descriptor.bindingNames, ...mapper.bindingNames]),
    bindingValues: Object.freeze([...descriptor.bindingValues, ...mapper.bindings]),
  });
}

/**
 * Emits one version dispatch. Fallthrough applies only the remaining mapper
 * edges, so an input already at the current version is returned by reference.
 */
export function emitMigrationSource(descriptor: MigrationDescriptor): string {
  const writer = new CodeWriter();

  writer.line("(() => {");
  writer.indent(() => {
    descriptor.edges.forEach((edge, index) => {
      for (const line of emitMapperPlanFunctionSource(edge.mapper, "map", `migrateEdge${index}`)
        .trimEnd()
        .split("\n")) {
        writer.line(line);
      }
    });
    writer.line("function migrate(value) {");
    writer.indent(() => {
      writer.line(
        'if (value === null || typeof value !== "object") throw new TypeError("migration input must be an object");'
      );
      writer.line("switch (value.version) {");
      writer.indent(() => {
        descriptor.edges.forEach((edge, index) => {
          writer.line(`case ${emitLiteral(edge.from)}:`);
          writer.indent(() => writer.line(`value = migrateEdge${index}(value);`));
        });
        const current = descriptor.versions[descriptor.versions.length - 1];
        writer.line(`case ${emitLiteral(current)}:`);
        writer.indent(() => writer.line("return value;"));
        writer.line("default:");
        writer.indent(() =>
          writer.line(
            `throw new RangeError("unsupported migration version: " + String(value.version) + "; expected one of ${descriptor.versions.map(String).join(", ")}");`
          )
        );
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line("return migrate;");
  });
  writer.line("})()");

  return writer.toString();
}

export function compileMigration<TInput, TOutput>(descriptor: MigrationDescriptor): (value: TInput) => TOutput {
  const source = emitMigrationSource(descriptor);
  const compiled = globalThis.Function(
    ...descriptor.bindingNames,
    `return ${source};`
  )(...descriptor.bindingValues) as (value: TInput) => TOutput;

  registerArtifact(compiled as object, { kind: "migration-plan", descriptor });
  return compiled;
}

export function resolveMigrationVersion(schema: ATS.AnyTypeSchema): MigrationVersion {
  const base = resolveWrappers(schema).base;

  if (base.type !== TypeName.object) {
    throw new JITError("UNSUPPORTED_SCHEMA", "JIT.migrate() requires an object schema with a literal version field");
  }

  const versionSchema = (base as ObjectSchema).def.props.version;
  const version = versionSchema === undefined ? undefined : resolveWrappers(versionSchema).base;

  if (version?.type !== TypeName.literal) {
    throw new JITError("UNSUPPORTED_SCHEMA", 'JIT.migrate() requires a literal "version" field');
  }

  const value = (version.def as { readonly value: unknown }).value;

  if (typeof value !== "string" && typeof value !== "number") {
    throw new JITError("UNSUPPORTED_SCHEMA", 'JIT.migrate() requires "version" to be a string or number literal');
  }
  return value;
}

function prefixMapperBindings(plan: MapperPlan, prefix: string): MapperPlan {
  const replacements = new Map(plan.bindingNames.map((name, index) => [name, `${prefix}${index}`]));

  return Object.freeze({
    fields: rewriteFields(plan.fields, replacements),
    bindingNames: Object.freeze(plan.bindingNames.map((name) => replacements.get(name) as string)),
    bindings: plan.bindings,
  });
}

function forceVersionConstant(plan: MapperPlan): MapperPlan {
  return {
    ...plan,
    fields: plan.fields.map((field) => {
      if (field.key !== "version" || field.source.kind !== "default") return field;
      return { ...field, source: { ...field.source, from: undefined } };
    }),
  };
}

function rewriteFields(
  fields: readonly MapperFieldPlan[],
  replacements: ReadonlyMap<string, string>
): readonly MapperFieldPlan[] {
  return Object.freeze(
    fields.map((field): MapperFieldPlan => {
      const source = field.source;

      switch (source.kind) {
        case "copy-object":
          return { ...field, source: { ...source, fields: rewriteFields(source.fields, replacements) } };
        case "copy-array":
          return {
            ...field,
            source: {
              ...source,
              element: source.element === undefined ? undefined : rewriteFields(source.element, replacements),
            },
          };
        case "via":
        case "computed":
        case "default":
          return { ...field, source: { ...source, binding: replacements.get(source.binding) as string } };
        default:
          return field;
      }
    })
  );
}
