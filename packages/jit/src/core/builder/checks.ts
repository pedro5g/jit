import { JITError } from "../../errors/index.js";
import type { AnyTypeSchema } from "../ats/index.js";

type CheckInput = { readonly kind: string; readonly value?: unknown; readonly message?: string | undefined };

export function appendCheck(schema: AnyTypeSchema, check: CheckInput): AnyTypeSchema {
  const def = schema.def as { readonly checks?: readonly unknown[] };
  const entry = {
    kind: check.kind,
    ...(check.value !== undefined ? { value: check.value } : {}),
    ...(check.message !== undefined ? { message: check.message } : {}),
  };
  return { ...schema, def: { ...(schema.def as object), checks: [...(def.checks ?? []), entry] } } as AnyTypeSchema;
}

export function appendSingletonCheck(schema: AnyTypeSchema, check: CheckInput): AnyTypeSchema {
  const def = schema.def as { readonly checks?: readonly { readonly kind?: unknown }[] };
  if (def.checks?.some((entry) => entry.kind === check.kind))
    throw new JITError("INVALID_OPERATION", `${check.kind} cannot be applied twice to the same schema`);
  return appendCheck(schema, check);
}
