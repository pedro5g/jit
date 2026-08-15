import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { JITError } from "../../errors/index.js";
import { registerArtifact } from "../../runtime/artifact-registry.js";
import { type JsonSchemaDialect, resolveDialect } from "./dialects.js";
import type {
  JsonSchemaDocument,
  JsonSchemaNode,
  OverrideContext,
  ToJsonSchemaOptions,
  UnsupportedContext,
} from "./types.js";

const DOCUMENTS = new WeakMap<ATS.AnyTypeSchema, Map<string, JsonSchemaDocument>>();

type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };
type SchemaCheck = { readonly kind: string; readonly value?: unknown };
type SchemaMetadata = {
  readonly title?: string;
  readonly description?: string;
  readonly deprecated?: boolean;
  readonly examples?: readonly unknown[];
  readonly id?: string;
  readonly custom?: Readonly<Record<string, unknown>>;
};

/**
 * A type is representable exactly when JIT's own JSON serializer defines a
 * wire form for it. Everything else would make the document claim a shape
 * the engine never produces, so it goes through the `unsupported` policy.
 */
const UNSUPPORTED_TYPES: Readonly<Record<string, string>> = {
  [TypeName.bigint]: "bigint has no JSON representation",
  [TypeName.symbol]: "symbol has no JSON representation",
  [TypeName.map]: "Map is not JSON data",
  [TypeName.set]: "Set is not JSON data",
  [TypeName.file]: "File is not JSON data",
  [TypeName.promise]: "a promise cannot be described as a JSON value",
  [TypeName.undefined]: "undefined has no JSON representation",
  [TypeName.void]: "void has no JSON representation",
  [TypeName.function]: "a function has no JSON representation",
  [TypeName.instanceof]: "an instanceof check has no JSON representation",
  [TypeName.custom]: "a custom check has no JSON representation",
  [TypeName.never]: "never accepts no value",
};

/**
 * Describes a schema as a JSON Schema document — the interchange format
 * OpenAPI, form builders and structured-output APIs already speak.
 *
 * The document reports only what the compiled validator enforces. Anything
 * JSON Schema cannot express is refused rather than approximated, so a
 * document never promises a guarantee the engine does not make.
 *
 * The result is static data derived from the schema alone, so it is computed
 * once per schema/options pair and inlined as a frozen literal by AOT: the
 * application ships the document, never the translator.
 */
export function compileJsonSchema(schema: ATS.AnyTypeSchema, options: ToJsonSchemaOptions = {}): JsonSchemaDocument {
  // Callback options make a document caller-specific, so only the pure
  // configurations are memoized by identity.
  const cacheable = options.override === undefined && typeof options.unsupported !== "function";
  const cacheKey = cacheable ? describeOptions(options) : undefined;
  const cached = cacheKey === undefined ? undefined : DOCUMENTS.get(schema)?.get(cacheKey);

  if (cached) return cached;

  const document = new JsonSchemaEmitter(options).document(schema);

  if (cacheKey !== undefined) {
    const documents = DOCUMENTS.get(schema);

    if (documents) documents.set(cacheKey, document);
    else DOCUMENTS.set(schema, new Map([[cacheKey, document]]));
  }

  registerArtifact(document, { kind: "operation", schema, op: "jsonSchema" });
  return document;
}

function describeOptions(options: ToJsonSchemaOptions): string {
  return [
    options.target ?? "draft-2020-12",
    options.io ?? "output",
    options.unsupported ?? "throw",
    options.cycles ?? "ref",
    options.reused ?? "inline",
    options.dialect ?? "auto",
    options.additionalProperties ?? "auto",
    options.ref ? "uri" : "id",
  ].join("|");
}

class JsonSchemaEmitter {
  private readonly dialect: JsonSchemaDialect;
  private readonly input: boolean;
  private readonly names = new Map<ATS.AnyTypeSchema, string>();
  private readonly defs = new Map<string, JsonSchemaNode>();
  private readonly open = new Set<ATS.AnyTypeSchema>();
  private readonly extracted = new Set<ATS.AnyTypeSchema>();
  private readonly cyclic = new Set<ATS.AnyTypeSchema>();
  private readonly reused = new Set<ATS.AnyTypeSchema>();

  constructor(private readonly options: ToJsonSchemaOptions) {
    this.dialect = resolveDialect(options.target);
    this.input = options.io === "input";
  }

  document(schema: ATS.AnyTypeSchema): JsonSchemaDocument {
    this.survey(schema);

    const body = this.emit(schema, []);
    const includeDialect = this.options.dialect ?? this.dialect.uri !== undefined;

    return Object.freeze({
      ...(includeDialect && this.dialect.uri ? { $schema: this.dialect.uri } : {}),
      ...body,
      ...(this.defs.size > 0 ? { [this.dialect.defs]: Object.freeze(Object.fromEntries(this.defs)) } : {}),
    });
  }

  /** One walk that records both cycle participants and repeated schemas. */
  private survey(schema: ATS.AnyTypeSchema, stack = new Set<ATS.AnyTypeSchema>(), seen = new Set<ATS.AnyTypeSchema>()) {
    if (stack.has(schema)) {
      this.cyclic.add(schema);
      return;
    }
    if (seen.has(schema)) {
      this.reused.add(schema);
      return;
    }

    seen.add(schema);
    stack.add(schema);
    for (const child of children(schema)) this.survey(child, stack, seen);
    stack.delete(schema);
  }

  /** True when this schema must live in the defs rather than be inlined. */
  private extractable(schema: ATS.AnyTypeSchema): boolean {
    if (this.cyclic.has(schema)) return true;
    return this.options.reused === "ref" && this.reused.has(schema);
  }

  private emit(schema: ATS.AnyTypeSchema, path: readonly (string | number)[]): JsonSchemaNode {
    if (!this.extractable(schema)) return Object.freeze(this.build(schema, path));

    if (this.cyclic.has(schema) && this.options.cycles === "throw") {
      throw new JITError(
        "INVALID_OPERATION",
        `cannot inline a recursive schema at /${path.join("/")}; use cycles: "ref" to break it with $ref`
      );
    }

    const name = this.nameFor(schema);

    if (!this.open.has(schema) && !this.extracted.has(schema)) {
      this.extracted.add(schema);
      this.open.add(schema);
      this.defs.set(name, Object.freeze(this.build(schema, path)));
      this.open.delete(schema);
    }

    return Object.freeze({ $ref: `#/${this.dialect.defs}/${name}` });
  }

  /** `$ref` plus siblings, in whichever form the dialect understands. */
  private withRef(reference: JsonSchemaNode, siblings: Record<string, unknown>): Record<string, unknown> {
    if (Object.keys(siblings).length === 0) return { ...reference };
    if (this.dialect.refSiblings) return { ...reference, ...siblings };
    return { allOf: [reference], ...siblings };
  }

  private nameFor(schema: ATS.AnyTypeSchema): string {
    const existing = this.names.get(schema);

    if (existing) return existing;

    const metadata = metadataOf(schema);
    const preferred =
      metadata?.id && isIdentifier(metadata.id)
        ? metadata.id
        : metadata?.title && isIdentifier(metadata.title)
          ? metadata.title
          : `schema${this.names.size + 1}`;
    let candidate = preferred;
    let suffix = 1;

    while ([...this.names.values()].includes(candidate)) candidate = `${preferred}${++suffix}`;
    this.names.set(schema, candidate);
    return candidate;
  }

  private build(schema: ATS.AnyTypeSchema, path: readonly (string | number)[]): Record<string, unknown> {
    const node = { ...this.shape(schema, path), ...this.annotate(schema) };

    this.options.override?.({ schema, path, node, target: this.dialect.target } satisfies OverrideContext);
    return node;
  }

  /** Applies the `unsupported` policy for a type with no JSON form. */
  private unsupported(
    schema: ATS.AnyTypeSchema,
    path: readonly (string | number)[],
    message: string
  ): Record<string, unknown> {
    const policy = this.options.unsupported ?? "throw";
    const decision =
      typeof policy === "function"
        ? (policy({ schema, path, message } satisfies UnsupportedContext) ?? "throw")
        : policy;

    if (decision === "any") return {};
    if (decision === "throw") {
      throw new JITError(
        "INVALID_OPERATION",
        `${message} (at /${path.join("/")}); pass unsupported: "any" to emit {} instead, or a function to substitute a node`
      );
    }
    return { ...decision };
  }

  private shape(schema: ATS.AnyTypeSchema, path: readonly (string | number)[]): Record<string, unknown> {
    const current = schema as AnySchema;
    const checks = (current.def.checks as readonly SchemaCheck[] | undefined) ?? [];
    const reason = UNSUPPORTED_TYPES[current.type];

    if (reason) return this.unsupported(schema, path, reason);

    switch (current.type) {
      case TypeName.string:
      case TypeName.templateLiteral:
        return { type: "string", ...this.stringConstraints(checks) };
      case TypeName.int:
        return { type: "integer", ...this.numberConstraints(checks) };
      case TypeName.number:
        return { type: isInteger(checks) ? "integer" : "number", ...this.numberConstraints(checks) };
      case TypeName.nan:
        return { type: "number" };
      case TypeName.boolean:
        return { type: "boolean" };
      case TypeName.null:
        return { type: "null" };
      // JIT serializes dates and temporals as ISO strings, so the document
      // describes exactly what crosses the wire.
      case TypeName.date:
      case TypeName.temporal:
        return { type: "string", format: "date-time" };
      case TypeName.regex:
        return { type: "string", format: "regex" };
      case TypeName.literal:
        return this.constant(current.def.value);
      case TypeName.enum:
        return { enum: Object.values(current.def.values as Record<string, unknown>) };
      case TypeName.object:
        return this.objectShape(current, path);
      case TypeName.array:
        return {
          type: "array",
          items: this.emit(current.def.element as ATS.AnyTypeSchema, [...path, "items"]),
          ...arrayConstraints(checks),
        };
      case TypeName.record:
        return {
          type: "object",
          additionalProperties: this.emit(current.def.value as ATS.AnyTypeSchema, [...path, "additionalProperties"]),
        };
      case TypeName.tuple:
        return this.tupleShape(current, path);
      case TypeName.union:
      case TypeName.xor:
        return this.unionShape(current.def.options as readonly ATS.AnyTypeSchema[], "anyOf", path);
      case TypeName.discriminatedUnion:
        return this.unionShape(current.def.options as readonly ATS.AnyTypeSchema[], "oneOf", path);
      case TypeName.intersection:
        return {
          allOf: (current.def.options as readonly ATS.AnyTypeSchema[]).map((option, index) =>
            this.emit(option, [...path, "allOf", index])
          ),
        };
      case TypeName.nullable:
      case TypeName.nullish:
        return this.nullableShape(current.def.innerType as ATS.AnyTypeSchema, path);
      case TypeName.optional:
        return this.withRef(this.emit(current.def.innerType as ATS.AnyTypeSchema, path), {});
      case TypeName.default: {
        const inner = this.emit(current.def.innerType as ATS.AnyTypeSchema, path);
        const value = readDefault(current);

        return this.withRef(inner, value === undefined ? {} : { default: value });
      }
      case TypeName.readonly:
        return this.withRef(this.emit(current.def.innerType as ATS.AnyTypeSchema, path), { readOnly: true });
      case TypeName.brand:
      case TypeName.refine:
      case TypeName.coerce:
        return this.withRef(this.emit(current.def.innerType as ATS.AnyTypeSchema, path), {});
      case TypeName.transform:
        // The produced value is the callback's return, which the schema does
        // not describe; only the accepted value is knowable.
        if (!this.input) {
          return this.unsupported(schema, path, "a transform's output is not described by the schema");
        }
        return this.withRef(this.emit(current.def.innerType as ATS.AnyTypeSchema, path), {});
      case TypeName.pipe: {
        const output = current.def.output as ATS.AnyTypeSchema | undefined;
        const target = this.input || !output ? (current.def.innerType as ATS.AnyTypeSchema) : output;

        return this.withRef(this.emit(target, path), {});
      }
      case TypeName.lazy:
        return this.withRef(this.emit((current.def.getter as () => ATS.AnyTypeSchema)(), path), {});
      case TypeName.json:
      case TypeName.any:
      case TypeName.unknown:
        return {};
      default:
        return {};
    }
  }

  private constant(value: unknown): Record<string, unknown> {
    return this.dialect.constKeyword ? { const: value } : { enum: [value] };
  }

  private unionShape(
    options: readonly ATS.AnyTypeSchema[],
    keyword: "anyOf" | "oneOf",
    path: readonly (string | number)[]
  ): Record<string, unknown> {
    return { [keyword]: options.map((option, index) => this.emit(option, [...path, keyword, index])) };
  }

  private nullableShape(inner: ATS.AnyTypeSchema, path: readonly (string | number)[]): Record<string, unknown> {
    const node = this.emit(inner, path) as Record<string, unknown>;

    // OpenAPI 3.0 has no null type: nullability is a sibling keyword.
    if (this.dialect.nullableKeyword) return { ...node, nullable: true };
    if (this.dialect.typeUnions && typeof node.type === "string" && Object.keys(node).length === 1) {
      return { type: [node.type, "null"] };
    }
    return { anyOf: [node, { type: "null" }] };
  }

  private tupleShape(schema: AnySchema, path: readonly (string | number)[]): Record<string, unknown> {
    const items = (schema.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];
    const rest = schema.def.rest as ATS.AnyTypeSchema | undefined;
    const entries = items.map((item, index) => this.emit(item, [...path, index]));

    if (!this.dialect.prefixItems) {
      return {
        type: "array",
        items: entries,
        ...(rest
          ? { additionalItems: this.emit(rest, [...path, "additionalItems"]) }
          : { minItems: items.length, maxItems: items.length }),
      };
    }

    return {
      type: "array",
      prefixItems: entries,
      ...(rest
        ? { items: this.emit(rest, [...path, "items"]) }
        : { items: false, minItems: items.length, maxItems: items.length }),
    };
  }

  private objectShape(schema: AnySchema, path: readonly (string | number)[]): Record<string, unknown> {
    const props = (schema.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>) ?? {};
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const key of Object.keys(props)) {
      const prop = props[key];

      properties[key] = this.emit(prop, [...path, "properties", key]);
      if (this.isRequired(prop)) required.push(key);
    }

    const checks = (schema.def.checks as readonly SchemaCheck[] | undefined) ?? [];
    const passthrough = checks.some((check) => check.kind === "passthrough");
    const closed = this.options.additionalProperties ?? (!passthrough && !this.input);

    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      // In input mode the shape stays open: callers may send more, the
      // validator will strip it.
      ...(closed === true ? { additionalProperties: false } : {}),
      ...(this.options.additionalProperties === true ? { additionalProperties: true } : {}),
    };
  }

  /** A defaulted field is optional on the way in and always present on the way out. */
  private isRequired(schema: ATS.AnyTypeSchema): boolean {
    if (schema.type === TypeName.optional || schema.type === TypeName.nullish) return false;
    if (schema.type === TypeName.default) return !this.input;
    return true;
  }

  private annotate(schema: ATS.AnyTypeSchema): Record<string, unknown> {
    const metadata = metadataOf(schema);

    if (!metadata) return {};

    const examples = metadata.examples && metadata.examples.length > 0 ? [...metadata.examples] : undefined;

    return {
      ...(metadata.title ? { title: metadata.title } : {}),
      ...(metadata.description ? { description: metadata.description } : {}),
      ...(metadata.deprecated ? { deprecated: true } : {}),
      ...(examples ? (this.dialect.examplesKeyword === "examples" ? { examples } : { example: examples[0] }) : {}),
      // Metadata takes precedence: an explicit keyword wins over the
      // generated one, which is what makes `.meta()` an escape hatch.
      ...(metadata.custom ?? {}),
      ...(metadata.id && this.options.ref ? { $id: this.options.ref(metadata.id) } : {}),
    };
  }

  private stringConstraints(checks: readonly SchemaCheck[]): Record<string, unknown> {
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
        case "startsWith":
          if (typeof check.value === "string") out.pattern = `^${escapePattern(check.value)}`;
          break;
        case "endsWith":
          if (typeof check.value === "string") out.pattern = `${escapePattern(check.value)}$`;
          break;
        case "oneOf":
          if (Array.isArray(check.value)) out.enum = [...check.value];
          break;
        case "base64":
          if (this.dialect.contentEncoding) out.contentEncoding = "base64";
          else if (check.value instanceof RegExp) out.pattern = check.value.source;
          break;
        case "stringFormat": {
          const spec = check.value as { readonly pattern?: RegExp } | undefined;

          if (spec?.pattern instanceof RegExp) out.pattern = spec.pattern.source;
          break;
        }
        default: {
          const format = STRING_FORMATS[check.kind];

          // A named format the dialect knows becomes `format`; everything
          // else keeps its exact regex, which is always sound.
          if (format) out.format = format;
          else if (check.value instanceof RegExp) out.pattern = check.value.source;
          break;
        }
      }
    }

    return out;
  }

  private numberConstraints(checks: readonly SchemaCheck[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const exclusive = (keyword: "minimum" | "maximum", value: unknown) => {
      if (this.dialect.exclusiveAsNumber) {
        out[keyword === "minimum" ? "exclusiveMinimum" : "exclusiveMaximum"] = value;
        return;
      }
      out[keyword] = value;
      out[keyword === "minimum" ? "exclusiveMinimum" : "exclusiveMaximum"] = true;
    };

    for (const check of checks) {
      switch (check.kind) {
        case "min":
          out.minimum = check.value;
          break;
        case "max":
          out.maximum = check.value;
          break;
        case "moreThan":
          exclusive("minimum", check.value);
          break;
        case "lessThan":
          exclusive("maximum", check.value);
          break;
        case "positive":
          exclusive("minimum", 0);
          break;
        case "negative":
          exclusive("maximum", 0);
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

function metadataOf(schema: ATS.AnyTypeSchema): SchemaMetadata | undefined {
  return (schema.annotations as { readonly metadata?: SchemaMetadata } | undefined)?.metadata;
}

function readDefault(schema: AnySchema): unknown {
  const value = schema.def.defaultValue ?? schema.def.value;

  return typeof value === "function" ? undefined : value;
}

function isInteger(checks: readonly SchemaCheck[]): boolean {
  return checks.some((check) => check.kind === "int32" || check.kind === "integer" || check.kind === "safe");
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

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value);
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
