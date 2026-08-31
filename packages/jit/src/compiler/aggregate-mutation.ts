import { CodeWriter } from "./emitter/code-writer.js";
import { emitPropertyAccess } from "./source/access.js";

/**
 * Declarative side effects of one aggregate mutation. The plan is assembled
 * before source emission so timestamp and version policies share a single
 * generated mutation body rather than wrapping `update()` at runtime.
 *
 * This is the Runtime Class plan: it assigns to `this`. Immutable state
 * evolution is described by `MutationPlan` in `mutation/`, which never mutates
 * its input.
 */
export interface AggregateMutationPlan {
  readonly mutableFields: readonly string[];
  readonly updatedAt?: string;
  readonly version?: string;
}

export interface AggregateMutationPlanOptions {
  readonly fields: readonly string[];
  readonly readonlyFields?: readonly string[];
  readonly updatedAt?: string;
  readonly version?: string;
}

export function buildAggregateMutationPlan(options: AggregateMutationPlanOptions): AggregateMutationPlan {
  const readonlyFields = new Set(options.readonlyFields);
  const mutableFields = [...new Set(options.fields)].filter((field) => !readonlyFields.has(field));

  return Object.freeze({
    mutableFields: Object.freeze(mutableFields),
    ...(options.updatedAt === undefined ? {} : { updatedAt: options.updatedAt }),
    ...(options.version === undefined ? {} : { version: options.version }),
  });
}

/** Emits the hot aggregate mutation body with at most one clock read. */
export function emitAggregateMutationBody(
  plan: AggregateMutationPlan,
  updates: ReadonlyMap<string, string | null>,
  clockExpression = "new Date()"
): string {
  const writer = new CodeWriter();

  writer.line("let changed = false;");
  for (const field of plan.mutableFields) {
    const update = updates.get(field);
    if (update === undefined) continue;
    const current = `this${emitPropertyAccess("", field)}`;
    const fieldPatch = `patch${emitPropertyAccess("", field)}`;
    writer.line(`if (${fieldPatch} !== undefined) {`);
    writer.indent(() => {
      writer.line(`const next = ${update === null ? fieldPatch : `${update}(${current}, ${fieldPatch})`};`);
      writer.line(`if (next !== ${current}) { ${current} = next; changed = true; }`);
    });
    writer.line("}");
  }
  writer.line("if (!changed) return;");
  if (plan.updatedAt !== undefined) writer.line(`const now = ${clockExpression};`);
  if (plan.updatedAt !== undefined) writer.line(`this${emitPropertyAccess("", plan.updatedAt)} = now;`);
  if (plan.version !== undefined) writer.line(`this${emitPropertyAccess("", plan.version)} += 1;`);
  return writer.toString();
}
