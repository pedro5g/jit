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

export type DiffIRNode =
  | { readonly kind: "reuse" }
  | { readonly kind: "date" }
  | ObjectNode<DiffIRNode>
  | RecordNode<DiffIRNode>
  | TupleNode<DiffIRNode>
  | ArrayNode<DiffIRNode>
  | SetNode<DiffIRNode>
  | MapNode<DiffIRNode>
  | GuardNode<DiffIRNode>;

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

  const node = buildSchemaNode(schema, buildDiffNode);
  if (node) return node;
  if (isPrimitiveLikeSchema(schema)) return { kind: "reuse" };

  throw new Error(`[JIT] Unimplemented compiler diff IR for type: ${schema.type}`);
}
