/**
 * What the model is allowed to say about a schema — §43.
 *
 * The model does not write jit. It fills in this shape, and a deterministic
 * generator writes the code. That inversion is the whole point: a model this
 * size will produce syntactically plausible TypeScript containing a method
 * that does not exist, and no amount of prompting reliably stops it. Asking
 * instead for `{ "type": "string", "validators": [{ "type": "uuid" }] }` moves
 * every syntax decision to code that cannot invent anything, and reduces the
 * model's job to the one thing it is actually good at — reading a sentence and
 * choosing from a list.
 *
 * §108 states the division this file encodes: the model understands the
 * wording and selects from what is available; it does not decide what APIs
 * exist or how jit syntax works.
 */

/**
 * The field types the generator can emit, each backed by one real factory.
 *
 * Deliberately short. Every entry here is a name the generator will write, so
 * the list is a promise about the output rather than a menu of everything jit
 * has — and a type nobody asked for is a type that can be added later against
 * a real request.
 */
export const SCHEMA_FIELD_TYPES = [
  "string",
  "number",
  "int",
  "boolean",
  "date",
  "bigint",
  "object",
  "array",
  "enum",
] as const;

export type SchemaFieldType = (typeof SCHEMA_FIELD_TYPES)[number];

/** The factory each type is written with, and the kind its methods live on. */
export const FACTORY_FOR_TYPE: Record<SchemaFieldType, string> = {
  string: "JIT.string",
  number: "JIT.number",
  int: "JIT.int",
  boolean: "JIT.boolean",
  date: "JIT.date",
  bigint: "JIT.bigint",
  object: "JIT.object",
  array: "JIT.array",
  enum: "JIT.enum",
};

/**
 * One chain call, named rather than written.
 *
 * `{ "type": "min", "value": 3 }` becomes `.min(3)`. The name is checked
 * against the methods that kind really has (§54) before anything is emitted,
 * so a model that asks for `.notEmpty()` on a string — a method jit does not
 * have, and one models reach for constantly — is refused rather than printed.
 */
export interface SchemaValidator {
  type: string;
  /** At most one argument. Anything more is not a shape this protocol emits. */
  value?: string | number | boolean;
}

/**
 * A default, as an intent rather than an expression.
 *
 * `crypto.randomUUID` and `now` are named because they are the two the model
 * asks for constantly and both need a *function* rather than a value — a
 * literal `Date` in a schema is one timestamp shared by every parse, which is
 * the kind of bug that surfaces a week later.
 */
export type SchemaDefault =
  | { type: "value"; value: string | number | boolean | null }
  | { type: "crypto.randomUUID" }
  | { type: "now" };

export interface SchemaField {
  name: string;
  type: SchemaFieldType;
  optional?: boolean;
  nullable?: boolean;
  validators?: SchemaValidator[];
  default?: SchemaDefault;
  /** Nested fields, for `object`. */
  fields?: SchemaField[];
  /** The element, for `array`. Its `name` is ignored. */
  items?: SchemaField;
  /** The allowed values, for `enum`. */
  values?: string[];
  /** One line, emitted as a comment when present. */
  description?: string;
}

export interface SchemaIntent {
  kind: "object";
  /** The exported constant's name. Defaults to `Schema` when absent. */
  name?: string;
  fields: SchemaField[];
}

/**
 * How deep a nested intent may go.
 *
 * Not a taste judgement: the shape is recursive, and a model that loops
 * produces a structure that is expensive to walk and impossible to read. Four
 * levels is deeper than any schema a documentation question has ever needed.
 */
export const MAX_INTENT_DEPTH = 4;

/** How many fields one object may declare, at any level. */
export const MAX_INTENT_FIELDS = 40;
