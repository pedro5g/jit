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

export type UpdateIRNode =
  | { readonly kind: "reuse" }
  | { readonly kind: "date" }
  | ObjectNode<UpdateIRNode>
  | RecordNode<UpdateIRNode>
  | TupleNode<UpdateIRNode>
  | ArrayNode<UpdateIRNode>
  | SetNode<UpdateIRNode>
  | MapNode<UpdateIRNode>
  | GuardNode<UpdateIRNode>;

export interface UpdateIRProgram {
  readonly kind: "program";
  readonly valueParam: "value";
  readonly patchParam: "patch";
  readonly body: UpdateIRNode;
}

export function buildUpdateIR(schema: ATS.AnyTypeSchema): UpdateIRProgram {
  return {
    kind: "program",
    valueParam: "value",
    patchParam: "patch",
    body: buildUpdateNode(schema),
  };
}

function buildUpdateNode(schema: ATS.AnyTypeSchema): UpdateIRNode {
  if (schema.type === ATS.TypeName.date) return { kind: "date" };

  const node = buildSchemaNode(schema, buildUpdateNode);
  if (node) return node;
  if (isPrimitiveLikeSchema(schema)) return { kind: "reuse" };

  throw new Error(`[JIT] Unimplemented compiler update IR for type: ${schema.type}`);
}
