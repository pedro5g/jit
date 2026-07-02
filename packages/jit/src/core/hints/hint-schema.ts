import type { AnyTypeSchema, SchemaAnnotations } from "../ats/index.js";
import type { CompileHints } from "./compile-hints.js";
import { mergeHints } from "./hint-merge.js";

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
