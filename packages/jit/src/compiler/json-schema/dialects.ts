import { JITError } from "../../errors/index.js";
import type { JsonSchemaTarget } from "./types.js";

/**
 * Everything that differs between protocol versions, in one descriptor.
 *
 * Adding a version is adding an entry here: the emitter never branches on a
 * target name, it only reads these capabilities. Keep the flags behavioural
 * ("can a `$ref` carry siblings?") rather than nominal ("is this draft-07?"),
 * so a future dialect composes instead of forking the emitter.
 */
export interface JsonSchemaDialect {
  readonly target: JsonSchemaTarget;
  /** `$schema` value; `undefined` for dialects that do not use the keyword. */
  readonly uri: string | undefined;
  /** Where extracted definitions live. */
  readonly defs: "$defs" | "definitions";
  /** Whether `$ref` may sit beside other keywords, or needs an `allOf` wrapper. */
  readonly refSiblings: boolean;
  /** `const: v` when true, `enum: [v]` when false. */
  readonly constKeyword: boolean;
  /** `prefixItems` for tuples when true, array-form `items` when false. */
  readonly prefixItems: boolean;
  /** `exclusiveMinimum: 3` when true, `minimum: 3, exclusiveMinimum: true` when false. */
  readonly exclusiveAsNumber: boolean;
  /** `nullable: true` instead of a union with `{ type: "null" }`. */
  readonly nullableKeyword: boolean;
  /** Plural `examples` when true, singular `example` when false. */
  readonly examplesKeyword: "examples" | "example";
  /** Whether `contentEncoding` / `contentMediaType` are understood. */
  readonly contentEncoding: boolean;
  /** Whether `{ type: [...] }` may list several primitive types. */
  readonly typeUnions: boolean;
}

const DIALECTS: Readonly<Record<JsonSchemaTarget, JsonSchemaDialect>> = {
  "draft-2020-12": {
    target: "draft-2020-12",
    uri: "https://json-schema.org/draft/2020-12/schema",
    defs: "$defs",
    refSiblings: true,
    constKeyword: true,
    prefixItems: true,
    exclusiveAsNumber: true,
    nullableKeyword: false,
    examplesKeyword: "examples",
    contentEncoding: true,
    typeUnions: true,
  },
  "draft-07": {
    target: "draft-07",
    uri: "http://json-schema.org/draft-07/schema#",
    defs: "definitions",
    // Draft-07 readers ignore keywords beside `$ref`, so siblings must be
    // wrapped in `allOf` to survive.
    refSiblings: false,
    constKeyword: true,
    prefixItems: false,
    exclusiveAsNumber: true,
    nullableKeyword: false,
    examplesKeyword: "examples",
    contentEncoding: true,
    typeUnions: true,
  },
  "draft-04": {
    target: "draft-04",
    uri: "http://json-schema.org/draft-04/schema#",
    defs: "definitions",
    refSiblings: false,
    constKeyword: false,
    prefixItems: false,
    exclusiveAsNumber: false,
    nullableKeyword: false,
    examplesKeyword: "examples",
    contentEncoding: false,
    typeUnions: true,
  },
  "openapi-3.0": {
    target: "openapi-3.0",
    // OpenAPI Schema Objects are embedded in a document that declares the
    // version itself, so they never carry `$schema`.
    uri: undefined,
    defs: "definitions",
    refSiblings: false,
    constKeyword: false,
    prefixItems: false,
    exclusiveAsNumber: false,
    nullableKeyword: true,
    examplesKeyword: "example",
    contentEncoding: true,
    typeUnions: false,
  },
};

/** Spellings accepted for convenience; they resolve to one canonical target. */
const ALIASES: Readonly<Record<string, JsonSchemaTarget>> = {
  "draft-4": "draft-04",
  "draft-7": "draft-07",
  "2020-12": "draft-2020-12",
  openapi: "openapi-3.0",
  "openapi-3": "openapi-3.0",
  "openapi-3.1": "draft-2020-12",
};

export function resolveDialect(target: string = "draft-2020-12"): JsonSchemaDialect {
  const canonical = (ALIASES[target] ?? target) as JsonSchemaTarget;
  const dialect = DIALECTS[canonical];

  if (!dialect) {
    throw new JITError(
      "INVALID_OPERATION",
      `unknown JSON Schema target "${target}"; expected one of ${Object.keys(DIALECTS).join(", ")}`
    );
  }

  return dialect;
}

export const JSON_SCHEMA_TARGETS = Object.keys(DIALECTS) as readonly JsonSchemaTarget[];
