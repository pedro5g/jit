import type * as ATS from "../../core/ats/index.js";
import {
  buildStructuralIR,
  type RecursiveHelper,
  type StructuralIRNode,
  type StructuralIROption,
} from "../schema-nodes.js";
import { findRecursiveSchemas } from "../schema-recursion.js";

/** Describes the node tree consumed by the clone emitter. */
export type CloneIRNode = StructuralIRNode;

/** Associates a source schema with the clone node built for it. */
export type CloneIROption = StructuralIROption;

/** Describes a complete clone program before JavaScript emission. */
export interface CloneIRProgram {
  readonly kind: "program";
  readonly param: "value";
  readonly body: CloneIRNode;
  /** Named functions for cycle participants; empty for an acyclic schema. */
  readonly helpers: readonly RecursiveHelper<CloneIRNode>[];
}

/** Creates the JIT clone ir artifact from the supplied input. */
export function buildCloneIR(schema: ATS.AnyTypeSchema): CloneIRProgram {
  const { body, helpers } = buildStructuralIR(schema, findRecursiveSchemas(schema), "clone");

  return { kind: "program", param: "value", body, helpers };
}
