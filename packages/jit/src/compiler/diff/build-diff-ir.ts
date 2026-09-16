import type * as ATS from "../../core/ats/index.js";
import {
  buildStructuralIR,
  type RecursiveHelper,
  type StructuralIRNode,
  type StructuralIROption,
} from "../schema-nodes.js";
import { findRecursiveSchemas } from "../schema-recursion.js";

/** Describes the node tree consumed by the diff emitter. */
export type DiffIRNode = StructuralIRNode;

/** Associates a source schema with the diff node built for it. */
export type DiffIROption = StructuralIROption;

/** Describes a complete diff program before JavaScript emission. */
export interface DiffIRProgram {
  readonly kind: "program";
  readonly leftParam: "left";
  readonly rightParam: "right";
  readonly body: DiffIRNode;
  /** Named functions for cycle participants; empty for an acyclic schema. */
  readonly helpers: readonly RecursiveHelper<DiffIRNode>[];
}

/** Creates the JIT build diff ir artifact from the supplied input. */
export function buildDiffIR(schema: ATS.AnyTypeSchema): DiffIRProgram {
  const { body, helpers } = buildStructuralIR(schema, findRecursiveSchemas(schema), "diff");

  return { kind: "program", leftParam: "left", rightParam: "right", body, helpers };
}
