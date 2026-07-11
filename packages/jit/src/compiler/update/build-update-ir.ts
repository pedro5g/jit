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

export type UpdateIRNode =
  | { readonly kind: "reuse" }
  | { readonly kind: "date" }
  | { readonly kind: "union"; readonly options: readonly UpdateIROption[] }
  | { readonly kind: "discriminatedUnion"; readonly discriminator: string; readonly options: readonly UpdateIROption[] }
  | ObjectNode<UpdateIRNode>
  | RecordNode<UpdateIRNode>
  | TupleNode<UpdateIRNode>
  | ArrayNode<UpdateIRNode>
  | SetNode<UpdateIRNode>
  | MapNode<UpdateIRNode>
  | GuardNode<UpdateIRNode>;

export interface UpdateIROption {
  readonly schema: ATS.AnyTypeSchema;
  readonly node: UpdateIRNode;
}

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
  if (schema.type === ATS.TypeName.union) return buildUnionNode(schema as ATS.UnionSchema);
  if (schema.type === ATS.TypeName.discriminatedUnion)
    return buildDiscriminatedUnionNode(schema as ATS.DiscriminatedUnionSchema);

  const node = buildSchemaNode(schema, buildUpdateNode);
  if (node) return node;
  if (isPrimitiveLikeSchema(schema)) return { kind: "reuse" };

  throw new JITError("UNSUPPORTED_SCHEMA", `Unimplemented compiler update IR for type: ${schema.type}`);
}

function buildUnionNode(schema: ATS.UnionSchema): UpdateIRNode {
  if (schema.def.options.every((option) => isPrimitiveLikeSchema(option))) {
    return { kind: "reuse" };
  }

  return {
    kind: "union",
    options: schema.def.options.map((option) => ({
      schema: option,
      node: buildUpdateNode(option),
    })),
  };
}

function buildDiscriminatedUnionNode(schema: ATS.DiscriminatedUnionSchema): UpdateIRNode {
  return {
    kind: "discriminatedUnion",
    discriminator: schema.def.discriminator,
    options: schema.def.options.map((option) => ({
      schema: option,
      node: buildUpdateNode(option),
    })),
  };
}
