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
  | ObjectNode<CloneIRNode>
  | RecordNode<CloneIRNode>
  | TupleNode<CloneIRNode>
  | ArrayNode<CloneIRNode>
  | SetNode<CloneIRNode>
  | MapNode<CloneIRNode>
  | GuardNode<CloneIRNode>;

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

  const node = buildSchemaNode(schema, buildCloneNode);
  if (node) return node;
  if (isPrimitiveLikeSchema(schema)) return { kind: "reuse" };

  throw new Error(`[JIT] Unimplemented compiler clone IR for type: ${schema.type}`);
}
