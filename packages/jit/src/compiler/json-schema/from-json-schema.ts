import type * as ATS from "../../core/ats/index.js";
import { createSchema, TypeName } from "../../core/ats/index.js";
import { JITError } from "../../errors/index.js";
import type { FromJsonSchemaOptions, JsonSchemaNode, RefineContext } from "./types.js";

type Check = { readonly kind: string; readonly value?: unknown };

/** JSON Schema `format` values that map onto a compiled JIT string check. */
const FORMAT_CHECKS: Readonly<Record<string, string>> = {
  email: "email",
  "idn-email": "email",
  uuid: "uuid",
  uri: "url",
  "uri-reference": "url",
  url: "url",
  "date-time": "datetime",
  date: "plainDate",
  time: "plainTime",
  duration: "duration",
  ipv4: "ipv4",
  ipv6: "ipv6",
  hostname: "hostname",
  regex: "regex",
};

/**
 * Builds a JIT schema from a JSON Schema document, so a contract that arrives
 * as data becomes a first-class schema every compiled operation understands.
 *
 * The conversion is structural: it reads only keywords the compiled validator
 * can enforce. Anything else is reported through `unknownKeywords`, and the
 * `refine` hook is where a caller adds what the document could not say.
 *
 * In AOT this happens entirely at generation time — the document never
 * reaches the bundle, only the specialized functions built from it.
 */
export function compileSchemaFromJson(
  document: JsonSchemaNode,
  options: FromJsonSchemaOptions = {}
): ATS.AnyTypeSchema {
  return new SchemaBuilder(document, options).build(document, []);
}

/** Keywords the builder reads; anything else triggers `unknownKeywords`. */
const KNOWN_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "type",
  "const",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "prefixItems",
  "additionalItems",
  "anyOf",
  "oneOf",
  "allOf",
  "nullable",
  "default",
  "title",
  "description",
  "deprecated",
  "examples",
  "example",
  "format",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
  "readOnly",
  "contentEncoding",
  "contentMediaType",
]);

class SchemaBuilder {
  private readonly building = new Map<JsonSchemaNode, ATS.AnyTypeSchema>();

  constructor(
    private readonly root: JsonSchemaNode,
    private readonly options: FromJsonSchemaOptions
  ) {}

  build(node: JsonSchemaNode, path: readonly (string | number)[]): ATS.AnyTypeSchema {
    this.assertKnown(node, path);

    const resolved = this.resolve(node, path);
    const started = this.building.get(resolved);

    // A `$ref` cycle becomes a lazy schema, exactly like a hand-written
    // recursive definition would.
    if (started !== undefined) return started;

    const placeholder = createSchema(TypeName.lazy, {
      getter: () => this.building.get(resolved) ?? unknownSchema(),
    }) as ATS.AnyTypeSchema;

    this.building.set(resolved, placeholder);

    const built = this.shape(resolved, path);
    const annotated = annotate(built, resolved);
    const refined = this.options.refine?.({ node: resolved, path, schema: annotated } satisfies RefineContext);
    const result = refined ?? annotated;

    this.building.set(resolved, result);
    return result;
  }

  private assertKnown(node: JsonSchemaNode, path: readonly (string | number)[]): void {
    if (this.options.unknownKeywords !== "throw") return;

    const unknown = Object.keys(node).filter((keyword) => !KNOWN_KEYWORDS.has(keyword));

    if (unknown.length > 0) {
      throw new JITError(
        "INVALID_OPERATION",
        `JSON Schema keyword(s) ${unknown.join(", ")} at /${path.join("/")} have no compiled equivalent; use refine to express them or unknownKeywords: "ignore"`
      );
    }
  }

  /** Follows a local `$ref` into the document's definitions. */
  private resolve(node: JsonSchemaNode, path: readonly (string | number)[]): JsonSchemaNode {
    const reference = node.$ref;

    if (typeof reference !== "string") return node;
    if (reference === "#") return this.root;

    const match = /^#\/(\$defs|definitions)\/(.+)$/.exec(reference);

    if (!match) {
      throw new JITError(
        "INVALID_OPERATION",
        `cannot resolve external $ref "${reference}" at /${path.join("/")}; inline the definition or pass it through refine`
      );
    }

    const defs = this.root[match[1]] as Record<string, JsonSchemaNode> | undefined;
    const target = defs?.[match[2]];

    if (!target) {
      throw new JITError(
        "INVALID_OPERATION",
        `$ref "${reference}" at /${path.join("/")} was not found in the document`
      );
    }

    return target;
  }

  private shape(node: JsonSchemaNode, path: readonly (string | number)[]): ATS.AnyTypeSchema {
    if ("const" in node) return literalSchema(node.const);

    if (Array.isArray(node.enum)) {
      const values = node.enum;

      if (values.length === 1) return literalSchema(values[0]);
      return union(values.map((value) => literalSchema(value)));
    }

    for (const keyword of ["anyOf", "oneOf"] as const) {
      const options = node[keyword];

      if (Array.isArray(options)) {
        return union(options.map((option, index) => this.build(option as JsonSchemaNode, [...path, keyword, index])));
      }
    }

    if (Array.isArray(node.allOf)) {
      const options = node.allOf.map((option, index) =>
        this.build(option as JsonSchemaNode, [...path, "allOf", index])
      );

      return options.length === 1
        ? options[0]
        : (createSchema(TypeName.intersection, { options }) as ATS.AnyTypeSchema);
    }

    // OpenAPI 3.0 spells nullability as a sibling keyword.
    if (node.nullable === true) {
      const inner = this.shape({ ...node, nullable: undefined }, path);

      return createSchema(TypeName.nullable, { innerType: inner }) as ATS.AnyTypeSchema;
    }

    if (Array.isArray(node.type)) {
      const types = node.type as readonly string[];
      const nullable = types.includes("null");
      const rest = types.filter((entry) => entry !== "null");
      const inner =
        rest.length === 1
          ? this.primitive(rest[0], node, path)
          : union(rest.map((entry) => this.primitive(entry, node, path)));

      return nullable ? (createSchema(TypeName.nullable, { innerType: inner }) as ATS.AnyTypeSchema) : inner;
    }

    if (typeof node.type === "string") return this.primitive(node.type, node, path);

    // No type keyword: the document describes any JSON value.
    return unknownSchema();
  }

  private primitive(type: string, node: JsonSchemaNode, path: readonly (string | number)[]): ATS.AnyTypeSchema {
    switch (type) {
      case "string":
        return withChecks(createSchema(TypeName.string, {}) as ATS.AnyTypeSchema, stringChecks(node));
      case "integer":
        return withChecks(createSchema(TypeName.int, {}) as ATS.AnyTypeSchema, numberChecks(node));
      case "number":
        return withChecks(createSchema(TypeName.number, {}) as ATS.AnyTypeSchema, numberChecks(node));
      case "boolean":
        return createSchema(TypeName.boolean, {}) as ATS.AnyTypeSchema;
      case "null":
        return createSchema(TypeName.null, {}) as ATS.AnyTypeSchema;
      case "array":
        return this.arraySchema(node, path);
      case "object":
        return this.objectSchema(node, path);
      default:
        return unknownSchema();
    }
  }

  private arraySchema(node: JsonSchemaNode, path: readonly (string | number)[]): ATS.AnyTypeSchema {
    const prefix = (node.prefixItems ?? (Array.isArray(node.items) ? node.items : undefined)) as
      | readonly JsonSchemaNode[]
      | undefined;

    if (prefix) {
      const rest = (node.additionalItems ?? (Array.isArray(node.items) ? undefined : node.items)) as
        | JsonSchemaNode
        | undefined;

      return createSchema(TypeName.tuple, {
        items: prefix.map((item, index) => this.build(item, [...path, index])),
        ...(rest && typeof rest === "object" ? { rest: this.build(rest, [...path, "items"]) } : {}),
      }) as ATS.AnyTypeSchema;
    }

    const element =
      node.items && typeof node.items === "object"
        ? this.build(node.items as JsonSchemaNode, [...path, "items"])
        : unknownSchema();

    return withChecks(createSchema(TypeName.array, { element }) as ATS.AnyTypeSchema, arrayChecks(node));
  }

  private objectSchema(node: JsonSchemaNode, path: readonly (string | number)[]): ATS.AnyTypeSchema {
    const properties = node.properties as Record<string, JsonSchemaNode> | undefined;

    if (!properties) {
      const value =
        node.additionalProperties && typeof node.additionalProperties === "object"
          ? this.build(node.additionalProperties as JsonSchemaNode, [...path, "additionalProperties"])
          : unknownSchema();

      return createSchema(TypeName.record, {
        key: createSchema(TypeName.string, {}),
        value,
      }) as ATS.AnyTypeSchema;
    }

    const required = new Set((node.required as readonly string[] | undefined) ?? []);
    const props: Record<string, ATS.AnyTypeSchema> = {};

    for (const key of Object.keys(properties)) {
      const built = this.build(properties[key], [...path, "properties", key]);

      props[key] = required.has(key)
        ? built
        : (createSchema(TypeName.optional, { innerType: built }) as ATS.AnyTypeSchema);
    }

    return createSchema(TypeName.object, { props }) as ATS.AnyTypeSchema;
  }
}

function union(options: readonly ATS.AnyTypeSchema[]): ATS.AnyTypeSchema {
  if (options.length === 0) return unknownSchema();
  if (options.length === 1) return options[0];
  return createSchema(TypeName.union, { options }) as ATS.AnyTypeSchema;
}

function literalSchema(value: unknown): ATS.AnyTypeSchema {
  if (value === null) return createSchema(TypeName.null, {}) as ATS.AnyTypeSchema;
  return createSchema(TypeName.literal, { value }) as ATS.AnyTypeSchema;
}

function unknownSchema(): ATS.AnyTypeSchema {
  return createSchema(TypeName.unknown, {}) as ATS.AnyTypeSchema;
}

function withChecks(schema: ATS.AnyTypeSchema, checks: readonly Check[]): ATS.AnyTypeSchema {
  if (checks.length === 0) return schema;

  return { ...schema, def: { ...(schema.def as object), checks } } as ATS.AnyTypeSchema;
}

/** Copies document annotations onto the schema so a round trip keeps them. */
function annotate(schema: ATS.AnyTypeSchema, node: JsonSchemaNode): ATS.AnyTypeSchema {
  const metadata = {
    ...(typeof node.title === "string" ? { title: node.title } : {}),
    ...(typeof node.description === "string" ? { description: node.description } : {}),
    ...(node.deprecated === true ? { deprecated: true } : {}),
    ...(Array.isArray(node.examples) ? { examples: [...node.examples] } : {}),
    ...(node.example !== undefined ? { examples: [node.example] } : {}),
    ...(typeof node.$id === "string" ? { id: node.$id } : {}),
  };
  const withDefault =
    node.default === undefined
      ? schema
      : (createSchema(TypeName.default, { innerType: schema, defaultValue: node.default }) as ATS.AnyTypeSchema);

  if (Object.keys(metadata).length === 0) return withDefault;

  return {
    ...withDefault,
    annotations: { ...((withDefault.annotations as object | undefined) ?? {}), metadata },
  } as ATS.AnyTypeSchema;
}

function stringChecks(node: JsonSchemaNode): readonly Check[] {
  const checks: Check[] = [];
  const format = typeof node.format === "string" ? FORMAT_CHECKS[node.format] : undefined;

  if (typeof node.minLength === "number") checks.push({ kind: "min", value: node.minLength });
  if (typeof node.maxLength === "number") checks.push({ kind: "max", value: node.maxLength });
  if (typeof node.pattern === "string") checks.push({ kind: "regex", value: new RegExp(node.pattern) });
  if (format) checks.push({ kind: format });

  return checks;
}

function numberChecks(node: JsonSchemaNode): readonly Check[] {
  const checks: Check[] = [];

  if (typeof node.minimum === "number") {
    // Draft-04 spells exclusivity as a boolean beside the bound.
    checks.push(
      node.exclusiveMinimum === true ? { kind: "moreThan", value: node.minimum } : { kind: "min", value: node.minimum }
    );
  }
  if (typeof node.maximum === "number") {
    checks.push(
      node.exclusiveMaximum === true ? { kind: "lessThan", value: node.maximum } : { kind: "max", value: node.maximum }
    );
  }
  if (typeof node.exclusiveMinimum === "number") checks.push({ kind: "moreThan", value: node.exclusiveMinimum });
  if (typeof node.exclusiveMaximum === "number") checks.push({ kind: "lessThan", value: node.exclusiveMaximum });
  if (typeof node.multipleOf === "number") checks.push({ kind: "multipleOf", value: node.multipleOf });
  if (node.format === "int32") checks.push({ kind: "int32" });

  return checks;
}

function arrayChecks(node: JsonSchemaNode): readonly Check[] {
  const checks: Check[] = [];

  if (typeof node.minItems === "number") checks.push({ kind: "min", value: node.minItems });
  if (typeof node.maxItems === "number") checks.push({ kind: "max", value: node.maxItems });
  if (node.uniqueItems === true) checks.push({ kind: "unique" });

  return checks;
}
