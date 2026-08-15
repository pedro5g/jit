import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";

type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

/** Resolves a `lazy` wrapper to the schema it stands for. */
export function resolveLazySchema(schema: ATS.AnyTypeSchema): ATS.AnyTypeSchema {
  let current = schema as AnySchema;
  let guard = 0;

  while (current.type === TypeName.lazy && guard++ < 100) {
    current = (current.def.getter as () => AnySchema)();
  }

  return current;
}

/** Schemas reachable from this one, following lazy references. */
export function schemaChildren(schema: ATS.AnyTypeSchema): readonly ATS.AnyTypeSchema[] {
  const current = schema as AnySchema;
  const def = current.def as Record<string, unknown>;

  switch (current.type) {
    case TypeName.object:
      return Object.values((def.props as Record<string, ATS.AnyTypeSchema>) ?? {});
    case TypeName.array:
    case TypeName.set:
      return def.element ? [def.element as ATS.AnyTypeSchema] : [];
    case TypeName.map:
      return [def.key as ATS.AnyTypeSchema, def.value as ATS.AnyTypeSchema].filter(Boolean);
    case TypeName.record:
      return def.value ? [def.value as ATS.AnyTypeSchema] : [];
    case TypeName.tuple:
      return [
        ...(((def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? []) as readonly ATS.AnyTypeSchema[]),
        ...(def.rest ? [def.rest as ATS.AnyTypeSchema] : []),
      ];
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion:
    case TypeName.intersection:
      return (def.options as readonly ATS.AnyTypeSchema[]) ?? [];
    case TypeName.when:
      return [def.thenType as ATS.AnyTypeSchema, def.otherwiseType as ATS.AnyTypeSchema].filter(Boolean);
    case TypeName.codec:
      return [def.input as ATS.AnyTypeSchema, def.output as ATS.AnyTypeSchema].filter(Boolean);
    default:
      return def.innerType ? [def.innerType as ATS.AnyTypeSchema] : [];
  }
}

/**
 * Finds the schemas that close a cycle — the ones an emitter must reach
 * through a named function instead of inlining. Only those need special
 * treatment, so a non-recursive schema keeps generating identical source.
 */
export function findRecursiveSchemas(schema: ATS.AnyTypeSchema): ReadonlySet<ATS.AnyTypeSchema> {
  const recursive = new Set<ATS.AnyTypeSchema>();
  const stack = new Set<ATS.AnyTypeSchema>();
  const seen = new Set<ATS.AnyTypeSchema>();

  const walk = (node: ATS.AnyTypeSchema): void => {
    const target = resolveLazySchema(node);

    if (stack.has(target)) {
      recursive.add(target);
      return;
    }
    if (seen.has(target)) return;

    seen.add(target);
    stack.add(target);
    for (const child of schemaChildren(target)) walk(child);
    stack.delete(target);
  };

  walk(schema);
  return recursive;
}
