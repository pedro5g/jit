import type { AnyTypeSchema, SchemaAnnotations } from "../ats/index.js";
import type { CompileHints } from "./compile-hints.js";
import { mergeHints } from "./hint-merge.js";
import type { Metadata } from "./metadata.js";

export function attachHint<TSchema extends AnyTypeSchema>(schema: TSchema, hints: CompileHints): TSchema {
  const annotations = (schema.annotations as SchemaAnnotations | undefined) ?? {};

  return {
    type: schema.type,
    _type: null,
    def: schema.def,
    annotations: {
      ...annotations,
      hints: mergeHints(annotations.hints, hints),
    },
  } as TSchema;
}

/**
 * Attaches documentation metadata. It never changes what the validator
 * accepts — it is carried through to descriptive outputs such as the
 * JSON Schema document.
 */
export function attachMetadata<TSchema extends AnyTypeSchema>(schema: TSchema, metadata: Metadata): TSchema {
  const annotations = (schema.annotations as SchemaAnnotations | undefined) ?? {};

  return {
    type: schema.type,
    _type: null,
    def: schema.def,
    annotations: { ...annotations, metadata: { ...annotations.metadata, ...metadata } },
  } as TSchema;
}
