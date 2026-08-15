import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";

/** A JSON Schema document; plain data, safe to serialize and cache. */
export type JsonSchemaDocument = { readonly [key: string]: unknown };

export interface JsonSchemaOptions {
  /**
   * Dialect written as `$schema` on the root document. Set to `false` to
   * omit it, which is what OpenAPI 3.1 component schemas want.
   * @default "https://json-schema.org/draft/2020-12/schema"
   */
  readonly dialect?: string | false;
  /**
   * Object schemas reject unknown keys by default, matching the validator.
   * Set to `true` when the document describes a forward-compatible payload.
   */
  readonly additionalProperties?: boolean;
}

const DEFAULT_DIALECT = "https://json-schema.org/draft/2020-12/schema";
const DOCUMENTS = new WeakMap<ATS.AnyTypeSchema, Map<string, JsonSchemaDocument>>();

type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };
type SchemaCheck = { readonly kind: string; readonly value?: unknown };
type SchemaMetadata = {
  readonly title?: string;
  readonly description?: string;
  readonly deprecated?: boolean;
  readonly examples?: readonly unknown[];
};

function metadataOf(schema: ATS.AnyTypeSchema): SchemaMetadata | undefined {
  return (schema.annotations as { readonly metadata?: SchemaMetadata } | undefined)?.metadata;
}

/**
 * Describes a schema as a JSON Schema document — the interchange format
 * OpenAPI, form builders and LLM structured-output APIs already speak.
 *
 * The result is static data derived only from the schema, so it is computed
 * once per schema identity and inlined as a literal by AOT: the application
 * ships the document, never the translator.
 *
 * Constraints that JSON Schema cannot express (custom refinements, transforms,
 * branded identity) are dropped rather than approximated, so a document never
 * claims a guarantee the validator does not enforce.
 *
 * @example
 * ```ts
 * const document = JIT.jsonSchema(User);
 * // { $schema: "…/2020-12/schema", type: "object", properties: { … } }
 * ```
 */
export function compileJsonSchema(schema: ATS.AnyTypeSchema, options: JsonSchemaOptions = {}): JsonSchemaDocument {
  const cacheKey = `${options.dialect === undefined ? DEFAULT_DIALECT : String(options.dialect)}|${options.additionalProperties === true}`;
  const cached = DOCUMENTS.get(schema)?.get(cacheKey);

  if (cached) return cached;

  const emitter = new JsonSchemaEmitter(options);
  const document = emitter.document(schema);
  const documents = DOCUMENTS.get(schema);

  if (documents) documents.set(cacheKey, document);
  else DOCUMENTS.set(schema, new Map([[cacheKey, document]]));

  registerArtifact(document, { kind: "operation", schema, op: "jsonSchema" });
  return document;
}

class JsonSchemaEmitter {
  private readonly recursive = new Set<ATS.AnyTypeSchema>();
  private readonly names = new Map<ATS.AnyTypeSchema, string>();
  private readonly defs = new Map<string, JsonSchemaDocument>();
  private readonly stack = new Set<ATS.AnyTypeSchema>();

  constructor(private readonly options: JsonSchemaOptions) {}

  document(schema: ATS.AnyTypeSchema): JsonSchemaDocument {
    this.findRecursive(schema);

    const body = this.emit(schema);
    const dialect = this.options.dialect === undefined ? DEFAULT_DIALECT : this.options.dialect;

    return Object.freeze({
      ...(dialect === false ? {} : { $schema: dialect }),
      ...body,
      ...(this.defs.size > 0 ? { $defs: Object.freeze(Object.fromEntries(this.defs)) } : {}),
    });
  }

  /** Marks every schema that participates in a cycle, so it earns a `$defs` entry. */
  private findRecursive(schema: ATS.AnyTypeSchema, seen = new Set<ATS.AnyTypeSchema>()): void {
    if (seen.has(schema)) {
      this.recursive.add(schema);
      return;
    }

    seen.add(schema);
    for (const child of children(schema)) this.findRecursive(child, seen);
    seen.delete(schema);
  }

  private emit(schema: ATS.AnyTypeSchema): JsonSchemaDocument {
    if (this.recursive.has(schema)) {
      const name = this.nameFor(schema);

      if (!this.stack.has(schema) && !this.defs.has(name)) {
        // Reserve the slot before recursing so the back-edge resolves.
        this.defs.set(name, Object.freeze({}));
        this.stack.add(schema);
        this.defs.set(name, Object.freeze(this.body(schema)));
        this.stack.delete(schema);
      }
      return Object.freeze({ $ref: `#/$defs/${name}` });
    }

    return Object.freeze(this.body(schema));
  }

  private nameFor(schema: ATS.AnyTypeSchema): string {
    const existing = this.names.get(schema);

    if (existing) return existing;

    const title = metadataOf(schema)?.title;
    const preferred = title && /^[A-Za-z_][A-Za-z0-9_]*$/.test(title) ? title : `Node${this.names.size + 1}`;
    let candidate = preferred;
    let suffix = 1;

    while ([...this.names.values()].includes(candidate)) candidate = `${preferred}${++suffix}`;
    this.names.set(schema, candidate);
    return candidate;
  }

  private body(schema: ATS.AnyTypeSchema): Record<string, unknown> {
    return { ...this.shape(schema), ...describe(schema) };
  }

  private shape(schema: ATS.AnyTypeSchema): Record<string, unknown> {
    const current = schema as AnySchema;
    const checks = (current.def.checks as readonly SchemaCheck[] | undefined) ?? [];

    switch (current.type) {
      case TypeName.string:
      case TypeName.templateLiteral:
        return { type: "string", ...stringConstraints(checks) };
      case TypeName.int:
        return { type: "integer", ...numberConstraints(checks) };
      case TypeName.number:
        return { type: isInteger(checks) ? "integer" : "number", ...numberConstraints(checks) };
      case TypeName.nan:
        return { type: "number" };
      case TypeName.bigint:
        return { type: "integer", format: "int64" };
      case TypeName.boolean:
        return { type: "boolean" };
      case TypeName.null:
        return { type: "null" };
      case TypeName.date:
        return { type: "string", format: "date-time" };
      case TypeName.temporal:
        return { type: "string", format: "date-time" };
      case TypeName.regex:
        return { type: "string", format: "regex" };
      case TypeName.literal:
        return { const: current.def.value };
      case TypeName.enum:
        return { enum: Object.values(current.def.values as Record<string, unknown>) };
      case TypeName.object:
        return this.objectShape(current);
      case TypeName.array:
        return {
          type: "array",
          items: this.emit(current.def.element as ATS.AnyTypeSchema),
          ...arrayConstraints(checks),
        };
      case TypeName.set:
        return {
          type: "array",
          uniqueItems: true,
          items: this.emit(current.def.element as ATS.AnyTypeSchema),
          ...arrayConstraints(checks),
        };
      case TypeName.map:
        // A Map is not JSON; its faithful wire shape is a list of entries.
        return {
          type: "array",
          items: {
            type: "array",
            prefixItems: [
              this.emit(current.def.key as ATS.AnyTypeSchema),
              this.emit(current.def.value as ATS.AnyTypeSchema),
            ],
            minItems: 2,
            maxItems: 2,
          },
        };
      case TypeName.record:
        return { type: "object", additionalProperties: this.emit(current.def.value as ATS.AnyTypeSchema) };
      case TypeName.tuple: {
        const items = (current.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];
        const rest = current.def.rest as ATS.AnyTypeSchema | undefined;

        return {
          type: "array",
          prefixItems: items.map((item) => this.emit(item)),
          ...(rest ? { items: this.emit(rest) } : { items: false, minItems: items.length, maxItems: items.length }),
        };
      }
      case TypeName.union:
      case TypeName.xor:
        return { anyOf: (current.def.options as readonly ATS.AnyTypeSchema[]).map((option) => this.emit(option)) };
      case TypeName.discriminatedUnion:
        return { oneOf: (current.def.options as readonly ATS.AnyTypeSchema[]).map((option) => this.emit(option)) };
      case TypeName.intersection:
        return { allOf: (current.def.options as readonly ATS.AnyTypeSchema[]).map((option) => this.emit(option)) };
      case TypeName.nullable:
        return { anyOf: [this.emit(current.def.innerType as ATS.AnyTypeSchema), { type: "null" }] };
      case TypeName.nullish:
        return { anyOf: [this.emit(current.def.innerType as ATS.AnyTypeSchema), { type: "null" }] };
      // Wrappers merge into the inner document. `emit` is used rather than
      // `body` so a recursive inner schema still resolves to its `$ref`;
      // 2020-12 allows `$ref` to sit beside other keywords.
      case TypeName.optional:
        return { ...this.emit(current.def.innerType as ATS.AnyTypeSchema) };
      case TypeName.default:
        return { ...this.emit(current.def.innerType as ATS.AnyTypeSchema), default: readDefault(current) };
      case TypeName.readonly:
        return { ...this.emit(current.def.innerType as ATS.AnyTypeSchema), readOnly: true };
      case TypeName.brand:
      case TypeName.refine:
      case TypeName.coerce:
      case TypeName.pipe:
      case TypeName.transform:
      case TypeName.promise:
        return { ...this.emit(current.def.innerType as ATS.AnyTypeSchema) };
      case TypeName.lazy:
        return { ...this.emit((current.def.getter as () => ATS.AnyTypeSchema)()) };
      case TypeName.json:
      case TypeName.any:
      case TypeName.unknown:
        return {};
      case TypeName.never:
        return { not: {} };
      default:
        return {};
    }
  }

  private objectShape(schema: AnySchema): Record<string, unknown> {
    const props = (schema.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>) ?? {};
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const key of Object.keys(props)) {
      const prop = props[key];

      properties[key] = this.emit(prop);
      if (!isOptionalSchema(prop)) required.push(key);
    }

    const checks = (schema.def.checks as readonly SchemaCheck[] | undefined) ?? [];
    const passthrough = checks.some((check) => check.kind === "passthrough");

    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: passthrough || this.options.additionalProperties === true,
    };
  }
}

function children(schema: ATS.AnyTypeSchema): readonly ATS.AnyTypeSchema[] {
  const current = schema as AnySchema;
  const def = current.def;

  switch (current.type) {
    case TypeName.object:
      return Object.values((def.props as Record<string, ATS.AnyTypeSchema>) ?? {});
    case TypeName.array:
    case TypeName.set:
      return [def.element as ATS.AnyTypeSchema];
    case TypeName.map:
      return [def.key as ATS.AnyTypeSchema, def.value as ATS.AnyTypeSchema];
    case TypeName.record:
      return [def.value as ATS.AnyTypeSchema];
    case TypeName.tuple:
      return [
        ...(((def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? []) as readonly ATS.AnyTypeSchema[]),
        ...(def.rest ? [def.rest as ATS.AnyTypeSchema] : []),
      ];
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion:
    case TypeName.intersection:
      return (def.options as readonly ATS.AnyTypeSchema[]) ?? [];
    case TypeName.optional:
    case TypeName.nullable:
    case TypeName.nullish:
    case TypeName.default:
    case TypeName.readonly:
    case TypeName.brand:
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
    case TypeName.promise:
      return [def.innerType as ATS.AnyTypeSchema];
    case TypeName.lazy:
      return [(def.getter as () => ATS.AnyTypeSchema)()];
    default:
      return [];
  }
}

function isOptionalSchema(schema: ATS.AnyTypeSchema): boolean {
  return schema.type === TypeName.optional || schema.type === TypeName.nullish || schema.type === TypeName.default;
}

function describe(schema: ATS.AnyTypeSchema): Record<string, unknown> {
  const metadata = metadataOf(schema);

  if (!metadata) return {};
  return {
    ...(metadata.title ? { title: metadata.title } : {}),
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.deprecated ? { deprecated: true } : {}),
    ...(metadata.examples && metadata.examples.length > 0 ? { examples: [...metadata.examples] } : {}),
  };
}

function readDefault(schema: AnySchema): unknown {
  const value = schema.def.defaultValue ?? schema.def.value;

  return typeof value === "function" ? undefined : value;
}

function isInteger(checks: readonly SchemaCheck[]): boolean {
  return checks.some((check) => check.kind === "int32" || check.kind === "integer" || check.kind === "safe");
}

/** JSON Schema `format` names for the string checks that carry a regex. */
const STRING_FORMATS: Readonly<Record<string, string>> = {
  email: "email",
  uuid: "uuid",
  guid: "uuid",
  url: "uri",
  httpUrl: "uri",
  datetime: "date-time",
  instant: "date-time",
  plainDate: "date",
  plainTime: "time",
  duration: "duration",
  ipv4: "ipv4",
  ipv6: "ipv6",
  hostname: "hostname",
  idnEmail: "idn-email",
};

function stringConstraints(checks: readonly SchemaCheck[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const check of checks) {
    switch (check.kind) {
      case "min":
        out.minLength = check.value;
        break;
      case "max":
        out.maxLength = check.value;
        break;
      case "length":
        out.minLength = check.value;
        out.maxLength = check.value;
        break;
      case "nonEmpty":
        out.minLength = 1;
        break;
      case "regex":
        if (check.value instanceof RegExp) out.pattern = check.value.source;
        break;
      case "oneOf":
        if (Array.isArray(check.value)) out.enum = [...check.value];
        break;
      case "stringFormat": {
        const spec = check.value as { readonly name?: string; readonly pattern?: RegExp } | undefined;

        if (spec?.pattern instanceof RegExp) out.pattern = spec.pattern.source;
        break;
      }
      default: {
        const format = STRING_FORMATS[check.kind];

        if (format) out.format = format;
        else if (check.value instanceof RegExp) out.pattern = check.value.source;
        break;
      }
    }
  }

  return out;
}

function numberConstraints(checks: readonly SchemaCheck[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const check of checks) {
    switch (check.kind) {
      case "min":
        out.minimum = check.value;
        break;
      case "max":
        out.maximum = check.value;
        break;
      case "moreThan":
        out.exclusiveMinimum = check.value;
        break;
      case "lessThan":
        out.exclusiveMaximum = check.value;
        break;
      case "positive":
        out.exclusiveMinimum = 0;
        break;
      case "negative":
        out.exclusiveMaximum = 0;
        break;
      case "multipleOf":
        out.multipleOf = check.value;
        break;
      case "int32":
        out.format = "int32";
        break;
      case "float32":
        out.format = "float";
        break;
      case "float64":
        out.format = "double";
        break;
      case "oneOf":
        if (Array.isArray(check.value)) out.enum = [...check.value];
        break;
      case "between":
        if (Array.isArray(check.value)) {
          out.minimum = check.value[0];
          out.maximum = check.value[1];
        }
        break;
      default:
        break;
    }
  }

  return out;
}

function arrayConstraints(checks: readonly SchemaCheck[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const check of checks) {
    switch (check.kind) {
      case "min":
        out.minItems = check.value;
        break;
      case "max":
        out.maxItems = check.value;
        break;
      case "length":
        out.minItems = check.value;
        out.maxItems = check.value;
        break;
      case "nonEmpty":
        out.minItems = 1;
        break;
      case "unique":
        out.uniqueItems = true;
        break;
      default:
        break;
    }
  }

  return out;
}
