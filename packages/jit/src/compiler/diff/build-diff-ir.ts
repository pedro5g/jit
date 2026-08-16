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
  | GuardNode<DiffIRNode>
  | RecursiveNode;

export interface DiffIROption {
  readonly schema: ATS.AnyTypeSchema;
  readonly node: DiffIRNode;
}

export interface DiffIRProgram {
  readonly kind: "program";
  readonly leftParam: "left";
  readonly rightParam: "right";
  readonly body: DiffIRNode;
  /** Named functions for cycle participants; empty for an acyclic schema. */
  readonly helpers: readonly RecursiveHelper<DiffIRNode>[];
}

export function buildDiffIR(schema: ATS.AnyTypeSchema): DiffIRProgram {
  const { body, helpers } = buildRecursiveProgram<DiffIRNode>(
    schema,
    (current, recurse) => buildDiffNode(current, recurse),
    (id) => ({ kind: "recursive", id }),
    findRecursiveSchemas(schema)
  );

  return { kind: "program", leftParam: "left", rightParam: "right", body, helpers };
}

function buildDiffNode(schema: ATS.AnyTypeSchema, recurse: (child: ATS.AnyTypeSchema) => DiffIRNode): DiffIRNode {
  if (schema.type === ATS.TypeName.date) return { kind: "date" };
  if (schema.type === ATS.TypeName.union) return buildUnionNode(schema as ATS.UnionSchema, recurse);
  if (schema.type === ATS.TypeName.intersection) {
    // Options are merged at compile time so a key shared by two of them is
    // visited once — otherwise the same change is reported twice.
    const flattened = flattenObjectIntersection(schema);

    if (flattened !== undefined) return buildDiffNode(flattened, recurse);
    return buildIntersectionNode(schema as ATS.IntersectionSchema, recurse);
  }
  if (schema.type === ATS.TypeName.discriminatedUnion)
    return buildDiscriminatedUnionNode(schema as ATS.DiscriminatedUnionSchema, recurse);

  const node = buildSchemaNode(schema, recurse);
  if (node) return node;
  if (isPrimitiveLikeSchema(schema)) return { kind: "reuse" };

  throw new JITError("UNSUPPORTED_SCHEMA", `Unimplemented compiler diff IR for type: ${schema.type}`);
}

function buildUnionNode(schema: ATS.UnionSchema, recurse: (child: ATS.AnyTypeSchema) => DiffIRNode): DiffIRNode {
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
  recurse: (child: ATS.AnyTypeSchema) => DiffIRNode
): DiffIRNode {
  return {
    kind: "intersection",
    options: schema.def.options.map(recurse),
  };
}

function buildDiscriminatedUnionNode(
  schema: ATS.DiscriminatedUnionSchema,
  recurse: (child: ATS.AnyTypeSchema) => DiffIRNode
): DiffIRNode {
  return {
    kind: "discriminatedUnion",
    discriminator: schema.def.discriminator,
    options: schema.def.options.map((option) => ({
      schema: option,
      node: recurse(option),
    })),
  };
}
