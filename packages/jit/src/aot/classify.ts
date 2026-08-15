import type { SchemaInput } from "../core/builder/index.js";
import { getArtifact } from "../runtime/artifact-registry.js";

/**
 * Declaration classification, shared by the CLI (which reads files) and the
 * browser Lab (which evaluates an editor buffer). It has no Node
 * dependencies on purpose: both callers hand it the same plain bindings.
 */
export interface ClassifiedDeclarations {
  /** Binding name -> registered compiled artifact. */
  readonly artifacts: Record<string, unknown>;
  /** Binding name -> object literal whose members are compiled artifacts. */
  readonly groups: Record<string, Record<string, unknown>>;
  /** Binding name -> schema, used to name generated types after the declaration. */
  readonly schemas: Record<string, SchemaInput>;
}

export type DeclarationKind = "artifact" | "group" | "schema";

/** Decides what a single top-level binding contributes to generation. */
export function classifyDeclaration(value: unknown): DeclarationKind | undefined {
  if (readArtifactGroup(value)) return "group";
  if (getArtifact(value) !== undefined) return "artifact";
  if (isSchemaInput(value)) return "schema";
  return undefined;
}

/** Splits a bindings record into the three shapes the generator accepts. */
export function classifyDeclarations(bindings: Readonly<Record<string, unknown>>): ClassifiedDeclarations {
  const artifacts: Record<string, unknown> = {};
  const groups: Record<string, Record<string, unknown>> = {};
  const schemas: Record<string, SchemaInput> = {};

  for (const name of Object.keys(bindings)) {
    const value = bindings[name];
    const group = readArtifactGroup(value);

    if (group) groups[name] = group;
    else if (getArtifact(value) !== undefined) artifacts[name] = value;
    else if (isSchemaInput(value)) schemas[name] = value;
  }

  return { artifacts, groups, schemas };
}

/** True for values that are schemas or fluent builders around one. */
export function isSchemaInput(candidate: unknown): candidate is SchemaInput {
  if (candidate === null || typeof candidate !== "object") return false;

  const value = candidate as { schema?: { type?: unknown }; type?: unknown; def?: unknown };

  if (value.schema && typeof value.schema === "object" && typeof value.schema.type === "string") return true;
  return typeof value.type === "string" && value.def !== undefined;
}

/**
 * An object literal is an artifact group when at least one of its own values
 * is a compiled JIT artifact. Members that are not become explicit skips at
 * generation time rather than silently disappearing.
 */
export function readArtifactGroup(candidate: unknown): Record<string, unknown> | undefined {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  if (getArtifact(candidate) !== undefined || isSchemaInput(candidate)) return undefined;

  const prototype = Object.getPrototypeOf(candidate);

  if (prototype !== Object.prototype && prototype !== null) return undefined;

  const group = candidate as Record<string, unknown>;
  const keys = Object.keys(group);

  if (keys.length === 0 || !keys.some((key) => getArtifact(group[key]) !== undefined)) return undefined;
  return group;
}
