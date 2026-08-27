import * as ATS from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import * as Transform from "../transforms/index.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";

type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };

/**
 * A selection of fields, resolved against a schema.
 *
 * The tree is the shared answer to "which parts of this value does the
 * operation actually touch". Query projection, standalone projection, selective
 * comparison and cache keys all ask that question, so they all build one of
 * these rather than each carrying its own notion of a field list.
 */
export interface ProjectionTree {
  /** Canonical dotted paths, deduplicated and in declaration order. */
  readonly paths: readonly string[];
  /** The selection as a schema, so every existing emitter can consume it. */
  readonly schema: ObjectSchema;
  readonly nodes: readonly ProjectionNode[];
}

export interface ProjectionNode {
  readonly key: string;
  /** The field's own schema, with its wrappers intact. */
  readonly schema: ATS.AnyTypeSchema;
  /** Set when the path continued past this field. */
  readonly children?: ProjectionTree;
}

export function expectProjectionObject(schema: ATS.AnyTypeSchema, operation: string): ObjectSchema {
  const base = resolveWrappers(schema).base;

  if (base.type !== ATS.TypeName.object) {
    throw new JITError("UNSUPPORTED_SCHEMA", `${operation} requires an object schema`);
  }
  return base as ObjectSchema;
}

/**
 * Resolves dotted paths against a schema into one selection.
 *
 * A nested path narrows the child rather than pulling it whole, so selecting
 * `profile.name` keeps `profile` in the shape but drops every other field under
 * it. Wrappers survive: an optional or nullable parent stays optional or
 * nullable, because dropping that would change what the selection means.
 */
export function buildProjectionTree(
  schema: ATS.AnyTypeSchema,
  paths: readonly string[],
  operation: string
): ProjectionTree {
  const object = expectProjectionObject(schema, operation);

  if (paths.length === 0) {
    throw new JITError("UNSUPPORTED_SCHEMA", `${operation} requires at least one field`);
  }

  // Grouped by first segment so a parent selected twice is resolved once.
  const groups = new Map<string, string[]>();

  for (const path of paths) {
    const dot = path.indexOf(".");
    const head = dot === -1 ? path : path.slice(0, dot);
    const rest = dot === -1 ? undefined : path.slice(dot + 1);
    const group = groups.get(head);

    if (group === undefined) groups.set(head, rest === undefined ? [] : [rest]);
    else if (rest !== undefined) group.push(rest);
  }

  const nodes: ProjectionNode[] = [];
  const canonical: string[] = [];
  const props: Record<string, ATS.AnyTypeSchema> = {};

  for (const [key, rest] of groups) {
    const field = object.def.props[key];

    if (field === undefined) {
      throw new JITError("UNSUPPORTED_SCHEMA", `${operation} selects "${key}", which the schema does not declare`);
    }

    if (rest.length === 0) {
      nodes.push(Object.freeze({ key, schema: field }));
      canonical.push(key);
      props[key] = field;
      continue;
    }

    const children = buildProjectionTree(field, rest, operation);

    nodes.push(Object.freeze({ key, schema: field, children }));
    for (const path of children.paths) canonical.push(`${key}.${path}`);
    // The narrowed child keeps the parent's wrappers: an optional profile whose
    // name is selected is still optional.
    props[key] = rewrap(field, children.schema);
  }

  return Object.freeze({
    paths: Object.freeze(canonical),
    nodes: Object.freeze(nodes),
    // The selection as a schema of its own, so `equal`, `hash`, `clone` and
    // every other emitter can consume it without learning what a projection is.
    //
    // Unknown keys and a catchall are deliberately dropped: a projection is
    // exactly the fields it names, and inheriting either would let an emitter
    // reach a field the caller excluded. Object-level checks go too — this
    // describes a shape, it does not validate one.
    schema: ATS.createSchema(
      ATS.TypeName.object,
      { props, unknownKeys: "strip" as const, catchall: undefined, checks: [] },
      object.annotations
    ) as ObjectSchema,
  });
}

/** Reapplies the field's transparent wrappers around its narrowed shape. */
function rewrap(field: ATS.AnyTypeSchema, narrowed: ATS.AnyTypeSchema): ATS.AnyTypeSchema {
  const { optional, nullable, readonly } = resolveWrappers(field);
  let result = narrowed;

  if (nullable) result = Transform.nullable(result);
  if (optional) result = Transform.optional(result);
  if (readonly) result = Transform.readonly(result);
  return result;
}

/**
 * Emits the selection as an object literal over static keys.
 *
 * Nested selections build their own literal, and a nullish parent short-circuits
 * rather than being read through — so an absent `profile` stays absent instead
 * of throwing.
 */
export function emitProjectionLiteral(tree: ProjectionTree, source: string): string {
  const parts = tree.nodes.map((node) => {
    const access = emitPropertyAccess(source, node.key);

    if (node.children === undefined) return `${JSON.stringify(node.key)}: ${access}`;

    const { optional, nullable } = resolveWrappers(node.schema);
    const nested = emitProjectionLiteral(node.children, access);

    if (!optional && !nullable) return `${JSON.stringify(node.key)}: ${nested}`;
    return `${JSON.stringify(node.key)}: ${access} == null ? ${access} : ${nested}`;
  });

  return `{ ${parts.join(", ")} }`;
}

export function projectionCacheKey(tree: ProjectionTree): string {
  return tree.paths.join(",");
}
