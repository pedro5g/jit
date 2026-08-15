import type * as ATS from "../../core/ats/index.js";

/**
 * One JSON Schema node. Deliberately open: dialects add keywords, and
 * `override` callbacks may add anything an application needs.
 */
export type JsonSchemaNode = { readonly [keyword: string]: unknown };

/** A complete JSON Schema document — plain, frozen, serializable data. */
export type JsonSchemaDocument = JsonSchemaNode;

/** Supported protocol versions. New ones only need a dialect descriptor. */
export type JsonSchemaTarget = "draft-2020-12" | "draft-07" | "draft-04" | "openapi-3.0";

/** Where an unsupported type was found, and what would have been thrown. */
export interface UnsupportedContext {
  /** The JIT schema that has no JSON Schema equivalent. */
  readonly schema: ATS.AnyTypeSchema;
  /** Property path from the document root. */
  readonly path: readonly (string | number)[];
  /** The message the default `"throw"` policy would use. */
  readonly message: string;
}

/** The node produced for a schema, before it is frozen. */
export interface OverrideContext {
  /** The JIT schema that produced this node. */
  readonly schema: ATS.AnyTypeSchema;
  /** Property path from the document root. */
  readonly path: readonly (string | number)[];
  /** Mutable node — assign keywords directly to change the output. */
  readonly node: Record<string, unknown>;
  /** The dialect being targeted, so an override can stay version-aware. */
  readonly target: JsonSchemaTarget;
}

export interface ToJsonSchemaOptions {
  /**
   * Protocol version to emit.
   * - `"draft-2020-12"` — default; `$defs`, `prefixItems`, `const`
   * - `"draft-07"` — `definitions`, array-form `items`
   * - `"draft-04"` — `definitions`, boolean-form `exclusiveMinimum`, no `const`
   * - `"openapi-3.0"` — `nullable: true`, `example`, no `$schema`
   * @default "draft-2020-12"
   */
  readonly target?: JsonSchemaTarget;
  /**
   * Which side of the schema to describe. `"output"` (default) describes the
   * value the validator produces — defaults applied, unknown keys gone.
   * `"input"` describes what callers may send, so defaulted fields become
   * optional and object shapes stay open.
   * @default "output"
   */
  readonly io?: "input" | "output";
  /**
   * Types JSON Schema cannot express (`bigint`, `symbol`, `Map`, `Set`,
   * `Date`, `File`, `undefined`, `NaN`, `Promise`, `function`).
   * - `"any"` — default; they become `{}`, the JSON Schema `unknown`
   * - `"throw"` — refuse to emit a document that would be a lie
   * - a function — return a node to use, or `"any"` / `"throw"`
   * @default "any"
   */
  readonly unsupported?:
    | "throw"
    | "any"
    | ((context: UnsupportedContext) => JsonSchemaNode | "throw" | "any" | undefined);
  /**
   * Self-referencing schemas.
   * - `"ref"` — default; the cycle is broken with a `$ref` into the defs
   * - `"throw"` — refuse a document that cannot be inlined
   * @default "ref"
   */
  readonly cycles?: "ref" | "throw";
  /**
   * Schemas reached more than once.
   * - `"inline"` — default; each occurrence is expanded
   * - `"ref"` — extracted once into the defs and referenced
   * @default "inline"
   */
  readonly reused?: "inline" | "ref";
  /** Last word over every produced node; mutate `context.node` directly. */
  readonly override?: (context: OverrideContext) => void;
  /** Turns a schema `id` into the URI used for external `$ref`s. */
  readonly ref?: (id: string) => string;
  /** Emit the `$schema` keyword. Defaults to true except for OpenAPI. */
  readonly dialect?: boolean;
  /** Forces `additionalProperties`; otherwise it follows the schema and `io`. */
  readonly additionalProperties?: boolean;
}

/** Context handed to `refine` while a JSON Schema node becomes a JIT schema. */
export interface RefineContext {
  /** The JSON Schema node being converted. */
  readonly node: JsonSchemaNode;
  /** Property path from the document root. */
  readonly path: readonly (string | number)[];
  /** The schema built from the node so far — return a new one to replace it. */
  readonly schema: ATS.AnyTypeSchema;
}

export interface FromJsonSchemaOptions {
  /**
   * Adds what the document could not say. It runs for every node, after the
   * structural conversion, and returning a schema replaces the built one —
   * the place to attach brands, refinements or formats a plain document
   * cannot carry.
   */
  readonly refine?: (context: RefineContext) => ATS.AnyTypeSchema | undefined | void;
  /**
   * Keywords the converter does not understand.
   * - `"ignore"` — default; the structural shape is still produced
   * - `"throw"` — refuse to build a schema weaker than the document
   * @default "ignore"
   */
  readonly unknownKeywords?: "ignore" | "throw";
}
