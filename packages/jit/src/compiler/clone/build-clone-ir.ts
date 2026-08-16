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
  | GuardNode<CloneIRNode>
  | RecursiveNode;

export interface CloneIROption {
  readonly schema: ATS.AnyTypeSchema;
  readonly node: CloneIRNode;
}

export interface CloneIRProgram {
  readonly kind: "program";
  readonly param: "value";
  readonly body: CloneIRNode;
  /** Named functions for cycle participants; empty for an acyclic schema. */
  readonly helpers: readonly RecursiveHelper<CloneIRNode>[];
}

export function buildCloneIR(schema: ATS.AnyTypeSchema): CloneIRProgram {
  const { body, helpers } = buildRecursiveProgram<CloneIRNode>(
    schema,
    (current, recurse) => buildCloneNode(current, recurse),
    (id) => ({ kind: "recursive", id }),
    findRecursiveSchemas(schema)
  );

  return { kind: "program", param: "value", body, helpers };
}

function buildCloneNode(schema: ATS.AnyTypeSchema, recurse: (child: ATS.AnyTypeSchema) => CloneIRNode): CloneIRNode {
  if (schema.type === ATS.TypeName.date) return { kind: "date" };
  if (schema.type === ATS.TypeName.union) return buildUnionNode(schema as ATS.UnionSchema, recurse);
  if (schema.type === ATS.TypeName.intersection) {
    // Merging the options at compile time turns three allocations — one per
    // option plus the Object.assign result — into a single object literal.
    const flattened = flattenObjectIntersection(schema);

    if (flattened !== undefined) return buildCloneNode(flattened, recurse);
    return buildIntersectionNode(schema as ATS.IntersectionSchema, recurse);
  }
  if (schema.type === ATS.TypeName.discriminatedUnion)
    return buildDiscriminatedUnionNode(schema as ATS.DiscriminatedUnionSchema, recurse);

  const node = buildSchemaNode(schema, recurse);
  if (node) return node;
  if (isPrimitiveLikeSchema(schema)) return { kind: "reuse" };

  throw new JITError("UNSUPPORTED_SCHEMA", `Unimplemented compiler clone IR for type: ${schema.type}`);
}

function buildUnionNode(schema: ATS.UnionSchema, recurse: (child: ATS.AnyTypeSchema) => CloneIRNode): CloneIRNode {
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

function buildIntersectionNode(
  schema: ATS.IntersectionSchema,
  recurse: (child: ATS.AnyTypeSchema) => CloneIRNode
): CloneIRNode {
  return {
    kind: "intersection",
    options: schema.def.options.map(recurse),
  };
}

function buildDiscriminatedUnionNode(
  schema: ATS.DiscriminatedUnionSchema,
  recurse: (child: ATS.AnyTypeSchema) => CloneIRNode
): CloneIRNode {
  return {
    kind: "discriminatedUnion",
    discriminator: schema.def.discriminator,
    options: schema.def.options.map((option) => ({
      schema: option,
      node: recurse(option),
    })),
  };
}
