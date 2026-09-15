import type { AnyTypeSchema, SchemaCheck, StringSchema } from "../ats/index.js";

export type { SchemaInput } from "./unwrap-schema.js";

export type HasStringCheck<TSchema extends AnyTypeSchema, TKind extends string> =
  TSchema extends StringSchema<infer TChecks>
    ? number extends TChecks["length"]
      ? false
      : Extract<TChecks[number], SchemaCheck<TKind>> extends never
        ? false
        : true
    : false;
