import * as ATS from "../../core/ats/index.js";
import { JITError } from "../../errors/index.js";
import {
  type ArrayNode,
  buildRecursiveProgram,
  buildSchemaNode,
  flattenObjectIntersection,
  type GuardNode,
  isPrimitiveLikeSchema,
  type MapNode,
  type ObjectNode,
  type RecordNode,
  type RecursiveHelper,
  type RecursiveNode,
  type SetNode,
  type TupleNode,
} from "../schema-nodes.js";
import { findRecursiveSchemas } from "../schema-recursion.js";

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
  | GuardNode<UpdateIRNode>
  | RecursiveNode;

export interface UpdateIROption {
  readonly schema: ATS.AnyTypeSchema;
  readonly node: UpdateIRNode;
}

export interface UpdateIRProgram {
  readonly kind: "program";
  readonly valueParam: "value";
  readonly patchParam: "patch";
  readonly body: UpdateIRNode;
  /** Named functions for cycle participants; empty for an acyclic schema. */
  readonly helpers: readonly RecursiveHelper<UpdateIRNode>[];
}

export function buildUpdateIR(schema: ATS.AnyTypeSchema): UpdateIRProgram {
  const { body, helpers } = buildRecursiveProgram<UpdateIRNode>(
    schema,
    (current, recurse) => buildUpdateNode(current, recurse),
    (id) => ({ kind: "recursive", id }),
    findRecursiveSchemas(schema)
  );

  return { kind: "program", valueParam: "value", patchParam: "patch", body, helpers };
}

function buildUpdateNode(schema: ATS.AnyTypeSchema, recurse: (child: ATS.AnyTypeSchema) => UpdateIRNode): UpdateIRNode {
  if (schema.type === ATS.TypeName.date) return { kind: "date" };
  if (schema.type === ATS.TypeName.union) return buildUnionNode(schema as ATS.UnionSchema, recurse);
  if (schema.type === ATS.TypeName.discriminatedUnion)
    return buildDiscriminatedUnionNode(schema as ATS.DiscriminatedUnionSchema, recurse);
  if (schema.type === ATS.TypeName.intersection) {
    // An intersection of objects is one object, so patching it is an ordinary
    // object update over the merged shape — no per-option merge at run time.
    const flattened = flattenObjectIntersection(schema);

    if (flattened !== undefined) return buildUpdateNode(flattened, recurse);
  }

  const node = buildSchemaNode(schema, recurse);
  if (node) return node;
  if (isPrimitiveLikeSchema(schema)) return { kind: "reuse" };

  throw new JITError("UNSUPPORTED_SCHEMA", `Unimplemented compiler update IR for type: ${schema.type}`);
}

function buildUnionNode(schema: ATS.UnionSchema, recurse: (child: ATS.AnyTypeSchema) => UpdateIRNode): UpdateIRNode {
  if (schema.def.options.every((option) => isPrimitiveLikeSchema(option))) {
    return { kind: "reuse" };
  }

  return {
    kind: "union",
    options: schema.def.options.map((option) => ({
      schema: option,
      node: recurse(option),
    })),
  };
}

function buildDiscriminatedUnionNode(
  schema: ATS.DiscriminatedUnionSchema,
  recurse: (child: ATS.AnyTypeSchema) => UpdateIRNode
): UpdateIRNode {
  return {
    kind: "discriminatedUnion",
    discriminator: schema.def.discriminator,
    options: schema.def.options.map((option) => ({
      schema: option,
      node: recurse(option),
    })),
  };
}
