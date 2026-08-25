import * as ATS from "../core/ats/index.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { resolveLazySchema } from "./schema-recursion.js";

export interface GuardNode<TNode> {
  readonly kind: "guard";
  readonly optional: boolean;
  readonly nullable: boolean;
  readonly inner: TNode;
}

export interface ObjectNode<TNode> {
  readonly kind: "object";
  readonly props: readonly ObjectNodeProp<TNode>[];
}

export interface ObjectNodeProp<TNode> {
  readonly key: string;
  readonly schema: ATS.AnyTypeSchema;
  readonly value: TNode;
  /** Readonly fields are preserved verbatim by immutable update programs. */
  readonly readonly: boolean;
}

export interface RecordNode<TNode> {
  readonly kind: "record";
  readonly value: TNode;
}

export interface TupleNode<TNode> {
  readonly kind: "tuple";
  readonly items: readonly TNode[];
}

export interface ArrayNode<TNode> {
  readonly kind: "array";
  readonly element: TNode;
}

export interface SetNode<TNode> {
  readonly kind: "set";
  readonly element: TNode;
}

export interface MapNode<TNode> {
  readonly kind: "map";
  readonly key: TNode;
  readonly value: TNode;
}

type InnerWrappedSchema = ATS.AnyTypeSchema & { readonly def: ATS.InnerTypeDef<ATS.AnyTypeSchema> };
type LazyWrappedSchema = ATS.AnyTypeSchema & { readonly def: ATS.LazyDef<ATS.AnyTypeSchema> };
type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };
type RecordSchema = ATS.AnyTypeSchema & { readonly def: ATS.KeyValueDef };
type TupleSchema = ATS.AnyTypeSchema & { readonly def: ATS.TupleDef };
type ElementSchema = ATS.AnyTypeSchema & { readonly def: ATS.ElementDef };
type MapSchema = ATS.AnyTypeSchema & { readonly def: ATS.KeyValueDef };

export function buildSchemaNode<TNode>(
  schema: ATS.AnyTypeSchema,
  buildNode: (schema: ATS.AnyTypeSchema) => TNode
):
  | GuardNode<TNode>
  | ObjectNode<TNode>
  | RecordNode<TNode>
  | TupleNode<TNode>
  | ArrayNode<TNode>
  | SetNode<TNode>
  | MapNode<TNode>
  | undefined {
  switch (schema.type) {
    case ATS.TypeName.optional:
      return { kind: "guard", optional: true, nullable: false, inner: buildNode(innerType(schema)) };
    case ATS.TypeName.nullable:
      return { kind: "guard", optional: false, nullable: true, inner: buildNode(innerType(schema)) };
    case ATS.TypeName.nullish:
      return { kind: "guard", optional: true, nullable: true, inner: buildNode(innerType(schema)) };
    case ATS.TypeName.default:
    case ATS.TypeName.brand:
    case ATS.TypeName.transform:
    case ATS.TypeName.pipe:
    case ATS.TypeName.readonly:
    case ATS.TypeName.refine:
    case ATS.TypeName.coerce:
      return buildNode(innerType(schema)) as ReturnType<typeof buildSchemaNode<TNode>>;
    case ATS.TypeName.lazy:
      return buildNode((schema as LazyWrappedSchema).def.getter()) as ReturnType<typeof buildSchemaNode<TNode>>;
    case ATS.TypeName.array:
      return { kind: "array", element: buildNode((schema as ElementSchema).def.element) };
    case ATS.TypeName.set:
      return { kind: "set", element: buildNode((schema as ElementSchema).def.element) };
    case ATS.TypeName.map:
      return {
        kind: "map",
        key: buildNode((schema as MapSchema).def.key),
        value: buildNode((schema as MapSchema).def.value),
      };
    case ATS.TypeName.record:
      return { kind: "record", value: buildNode((schema as RecordSchema).def.value) };
    case ATS.TypeName.tuple:
      return { kind: "tuple", items: (schema as TupleSchema).def.items.map(buildNode) };
    case ATS.TypeName.object: {
      const props = (schema as ObjectSchema).def.props;

      return {
        kind: "object",
        props: Object.keys(props).map((key) => ({
          key,
          schema: props[key],
          value: buildNode(props[key]),
          readonly: resolveWrappers(props[key]).readonly,
        })),
      };
    }
    default:
      return undefined;
  }
}

export function isPrimitiveLikeSchema(schema: ATS.AnyTypeSchema): boolean {
  switch (schema.type) {
    case ATS.TypeName.any:
    case ATS.TypeName.unknown:
    case ATS.TypeName.never:
    case ATS.TypeName.void:
    case ATS.TypeName.undefined:
    case ATS.TypeName.null:
    case ATS.TypeName.symbol:
    case ATS.TypeName.boolean:
    case ATS.TypeName.nan:
    case ATS.TypeName.int:
    case ATS.TypeName.bigint:
    case ATS.TypeName.number:
    case ATS.TypeName.string:
    case ATS.TypeName.literal:
    case ATS.TypeName.enum:
    case ATS.TypeName.file:
    case ATS.TypeName.regex:
    case ATS.TypeName.instanceof:
      return true;
    default:
      return false;
  }
}

export function innerType(schema: ATS.AnyTypeSchema): ATS.AnyTypeSchema {
  return (schema as InnerWrappedSchema).def.innerType;
}

export function emitGuardTest(optional: boolean, nullable: boolean, source: string): string {
  if (optional && nullable) return `${source} != null`;
  if (optional) return `${source} !== undefined`;
  return `${source} !== null`;
}

/** A back-edge into a schema that is being expanded further up the tree. */
export interface RecursiveNode {
  readonly kind: "recursive";
  /** Suffix of the generated helper, unique inside one program. */
  readonly id: string;
}

/** One named function a program must emit alongside its body. */
export interface RecursiveHelper<TNode> {
  readonly id: string;
  readonly node: TNode;
}

export interface RecursiveProgram<TNode> {
  readonly body: TNode;
  readonly helpers: readonly RecursiveHelper<TNode>[];
}

/**
 * Builds a node tree in which every cycle is broken by a `recursive` node.
 *
 * The structural emitters expand a schema inline, which never terminates on a
 * self-referencing shape. This lifts each cycle participant into its own
 * helper once and leaves a reference behind, so the emitter writes a named
 * function that calls itself — the same shape the validator uses.
 *
 * A schema with no cycle never reaches `makeRef`, so its node tree, and the
 * source emitted from it, are byte-identical to before.
 */
export function buildRecursiveProgram<TNode>(
  schema: ATS.AnyTypeSchema,
  build: (current: ATS.AnyTypeSchema, recurse: (child: ATS.AnyTypeSchema) => TNode) => TNode,
  makeRef: (id: string) => TNode,
  recursive: ReadonlySet<ATS.AnyTypeSchema>
): RecursiveProgram<TNode> {
  const ids = new Map<ATS.AnyTypeSchema, string>();
  const helpers: RecursiveHelper<TNode>[] = [];
  const started = new Set<ATS.AnyTypeSchema>();

  const idFor = (target: ATS.AnyTypeSchema): string => {
    const existing = ids.get(target);

    if (existing) return existing;
    const id = `r${ids.size + 1}`;

    ids.set(target, id);
    return id;
  };

  const recurse = (child: ATS.AnyTypeSchema): TNode => {
    const target = resolveLazySchema(child);

    if (!recursive.has(target)) return build(child, recurse);

    const id = idFor(target);

    if (!started.has(target)) {
      started.add(target);
      // Reserved before building so the back-edge inside resolves to this id.
      helpers.push({ id, node: build(target, recurse) });
    }

    return makeRef(id);
  };

  return { body: recurse(schema), helpers };
}

/**
 * Flattens an intersection of objects into the single object it describes.
 *
 * `A & B` over objects is an object holding both sets of properties, so the
 * shape is known at compile time and no emitter needs a runtime merge: it sees
 * one object and emits one pass. A key present in both is emitted once, with
 * the later option winning — the rule the validator already applies.
 *
 * Returns undefined when an option is not an object, leaving the caller to
 * report the case it genuinely cannot represent.
 */
export function flattenObjectIntersection(schema: ATS.AnyTypeSchema): ATS.AnyTypeSchema | undefined {
  const cached = FLATTENED_INTERSECTIONS.get(schema);

  if (cached !== undefined) return cached.schema;

  const flattened = buildFlattenedIntersection(schema);

  FLATTENED_INTERSECTIONS.set(schema, { schema: flattened });
  return flattened;
}

/** Shared across emitters, so the merged shape is built once per schema. */
const FLATTENED_INTERSECTIONS = new WeakMap<ATS.AnyTypeSchema, { readonly schema: ATS.AnyTypeSchema | undefined }>();

function buildFlattenedIntersection(schema: ATS.AnyTypeSchema): ATS.AnyTypeSchema | undefined {
  const options = (schema as { readonly def: { readonly options?: readonly ATS.AnyTypeSchema[] } }).def.options;

  if (!options || options.length === 0) return undefined;

  const props: Record<string, ATS.AnyTypeSchema> = {};

  for (const option of options) {
    const resolved = resolveLazySchema(option) as ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

    if (resolved.type !== ATS.TypeName.object) return undefined;

    const optionProps = resolved.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;

    for (const key of Object.keys(optionProps)) props[key] = optionProps[key];
  }

  return ATS.createSchema(ATS.TypeName.object, { props, unknownKeys: undefined, catchall: undefined, checks: [] });
}
