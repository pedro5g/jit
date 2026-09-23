import type * as ATS from "../../core/ats/index.js";
import { JITError } from "../../errors/index.js";
import { type ConstraintContradiction, normalizeConstraints } from "./constraint-model.js";

/** Throws before source generation when a schema's declarative constraints cannot intersect. */
export function assertSatisfiable(schema: ATS.AnyTypeSchema): void {
  const seen = new Set<ATS.AnyTypeSchema>();
  visit(schema, seen);
}

function visit(schema: ATS.AnyTypeSchema, seen: Set<ATS.AnyTypeSchema>): void {
  if (seen.has(schema)) return;
  seen.add(schema);

  const model = normalizeConstraints(schema);
  const contradiction = model.contradictions[0];
  if (contradiction !== undefined) throw contradictionError(contradiction);

  const definition = schema.def;
  if (typeof definition !== "object" || definition === null) return;
  for (const value of Object.values(definition as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isSchema(item)) visit(item, seen);
    } else if (isSchema(value)) visit(value, seen);
  }
}

function contradictionError(contradiction: ConstraintContradiction): JITError {
  return new JITError("UNSATISFIABLE_SCHEMA", contradiction.message, { meta: contradiction });
}

function isSchema(value: unknown): value is ATS.AnyTypeSchema {
  return typeof value === "object" && value !== null && "type" in value && "def" in value;
}
