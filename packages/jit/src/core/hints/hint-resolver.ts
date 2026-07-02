import type { AnyTypeSchema, InnerTypeDef, LazyDef, SchemaAnnotations } from "../ats/index.js";
import type { CompileHints } from "./compile-hints.js";
import { mergeHints } from "./hint-merge.js";

export function resolveHints(schema: AnyTypeSchema): CompileHints {
  let current: AnyTypeSchema | undefined = schema;
  let hints: CompileHints = {};

  while (current) {
    const annotations = current.annotations as SchemaAnnotations | undefined;
    hints = mergeHints(annotations?.hints, hints);
    current = innerSchema(current);
  }

  if (hints.order && !hints.order.key && typeof hints.collection?.identify === "string") {
    hints = mergeHints(hints, {
      order: {
        ...hints.order,
        key: hints.collection.identify,
      },
    });
  }

  return hints;
}

function innerSchema(schema: AnyTypeSchema): AnyTypeSchema | undefined {
  if (
    schema.type === "optional" ||
    schema.type === "nullable" ||
    schema.type === "nullish" ||
    schema.type === "readonly" ||
    schema.type === "promise" ||
    schema.type === "default" ||
    schema.type === "brand" ||
    schema.type === "pipe" ||
    schema.type === "refine" ||
    schema.type === "coerce"
  ) {
    return (schema.def as InnerTypeDef).innerType;
  }

  if (schema.type === "lazy") return (schema.def as LazyDef).getter();

  return undefined;
}
