import * as ATS from "../../core/ats/index.js";
import {
  type ArrayNode,
  buildSchemaNode,
  type GuardNode,
  isPrimitiveLikeSchema,
  type MapNode,
  type ObjectNode,
  type RecordNode,
  type SetNode,
  type TupleNode,
} from "../schema-nodes.js";

export type CloneIRNode =
  | { readonly kind: "reuse" }
  | { readonly kind: "date" }
  | { readonly kind: "union"; readonly options: readonly CloneIROption[] }
  | { readonly kind: "intersection"; readonly options: readonly CloneIRNode[] }
  | { readonly kind: "discriminatedUnion"; readonly discriminator: string; readonly options: readonly CloneIROption[] }
  | ObjectNode<CloneIRNode>
  | RecordNode<CloneIRNode>
  | TupleNode<CloneIRNode>
  | ArrayNode<CloneIRNode>
  | SetNode<CloneIRNode>
  | MapNode<CloneIRNode>
  | GuardNode<CloneIRNode>;

export interface CloneIROption {
  readonly schema: ATS.AnyTypeSchema;
  readonly node: CloneIRNode;
}

export interface CloneIRProgram {
  readonly kind: "program";
  readonly param: "value";
  readonly body: CloneIRNode;
}

export function buildCloneIR(schema: ATS.AnyTypeSchema): CloneIRProgram {
  return {
    kind: "program",
    param: "value",
    body: buildCloneNode(schema),
  };
}

function buildCloneNode(schema: ATS.AnyTypeSchema): CloneIRNode {
  if (schema.type === ATS.TypeName.date) return { kind: "date" };
  if (schema.type === ATS.TypeName.union) return buildUnionNode(schema as ATS.UnionSchema);
  if (schema.type === ATS.TypeName.intersection) return buildIntersectionNode(schema as ATS.IntersectionSchema);
  if (schema.type === ATS.TypeName.discriminatedUnion)
    return buildDiscriminatedUnionNode(schema as ATS.DiscriminatedUnionSchema);

  const node = buildSchemaNode(schema, buildCloneNode);
  if (node) return node;
  if (isPrimitiveLikeSchema(schema)) return { kind: "reuse" };

  throw new Error(`[JIT] Unimplemented compiler clone IR for type: ${schema.type}`);
}

function buildUnionNode(schema: ATS.UnionSchema): CloneIRNode {
  if (schema.def.options.every((option) => isPrimitiveLikeSchema(option))) {
    return { kind: "reuse" };
  }

  return {
    kind: "union",
    options: schema.def.options.map((option) => ({
      schema: option,
      node: buildCloneNode(option),
    })),
  };
}

function buildIntersectionNode(schema: ATS.IntersectionSchema): CloneIRNode {
  return {
    kind: "intersection",
    options: schema.def.options.map(buildCloneNode),
  };
}

function buildDiscriminatedUnionNode(schema: ATS.DiscriminatedUnionSchema): CloneIRNode {
  return {
    kind: "discriminatedUnion",
    discriminator: schema.def.discriminator,
    options: schema.def.options.map((option) => ({
      schema: option,
      node: buildCloneNode(option),
    })),
  };
}
