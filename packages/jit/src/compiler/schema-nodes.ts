import * as ATS from "../core/ats/index.js";

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
  readonly value: TNode;
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
        props: Object.keys(props).map((key) => ({ key, value: buildNode(props[key]) })),
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
