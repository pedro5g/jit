import * as ATS from "../../core/ats/index.js";
import { JITError } from "../../errors/index.js";
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

export type DiffIRNode =
  | { readonly kind: "reuse" }
  | { readonly kind: "date" }
  | { readonly kind: "union"; readonly options: readonly DiffIROption[] }
  | { readonly kind: "intersection"; readonly options: readonly DiffIRNode[] }
  | { readonly kind: "discriminatedUnion"; readonly discriminator: string; readonly options: readonly DiffIROption[] }
  | ObjectNode<DiffIRNode>
  | RecordNode<DiffIRNode>
  | TupleNode<DiffIRNode>
  | ArrayNode<DiffIRNode>
  | SetNode<DiffIRNode>
  | MapNode<DiffIRNode>
  | GuardNode<DiffIRNode>;

export interface DiffIROption {
  readonly schema: ATS.AnyTypeSchema;
  readonly node: DiffIRNode;
}

export interface DiffIRProgram {
  readonly kind: "program";
  readonly leftParam: "left";
  readonly rightParam: "right";
  readonly body: DiffIRNode;
}

export function buildDiffIR(schema: ATS.AnyTypeSchema): DiffIRProgram {
  return {
    kind: "program",
    leftParam: "left",
    rightParam: "right",
    body: buildDiffNode(schema),
  };
}

function buildDiffNode(schema: ATS.AnyTypeSchema): DiffIRNode {
  if (schema.type === ATS.TypeName.date) return { kind: "date" };
  if (schema.type === ATS.TypeName.union) return buildUnionNode(schema as ATS.UnionSchema);
  if (schema.type === ATS.TypeName.intersection) return buildIntersectionNode(schema as ATS.IntersectionSchema);
  if (schema.type === ATS.TypeName.discriminatedUnion)
    return buildDiscriminatedUnionNode(schema as ATS.DiscriminatedUnionSchema);

  const node = buildSchemaNode(schema, buildDiffNode);
  if (node) return node;
  if (isPrimitiveLikeSchema(schema)) return { kind: "reuse" };

  throw new JITError("UNSUPPORTED_SCHEMA", `Unimplemented compiler diff IR for type: ${schema.type}`);
}

function buildUnionNode(schema: ATS.UnionSchema): DiffIRNode {
  if (schema.def.options.every((option) => isPrimitiveLikeSchema(option))) {
    return { kind: "reuse" };
  }

  return {
    kind: "union",
    options: schema.def.options.map((option) => ({
      schema: option,
      node: buildDiffNode(option),
    })),
  };
}

function buildIntersectionNode(schema: ATS.IntersectionSchema): DiffIRNode {
  return {
    kind: "intersection",
    options: schema.def.options.map(buildDiffNode),
  };
}

function buildDiscriminatedUnionNode(schema: ATS.DiscriminatedUnionSchema): DiffIRNode {
  return {
    kind: "discriminatedUnion",
    discriminator: schema.def.discriminator,
    options: schema.def.options.map((option) => ({
      schema: option,
      node: buildDiffNode(option),
    })),
  };
}
