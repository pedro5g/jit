import * as ATS from "../../core/ats/index.js";
import { JITError } from "../../errors/index.js";
import { resolveWrappers } from "../resolvers/resolve-wrappers.js";
import { buildUpdateIR } from "../update/build-update-ir.js";

/** Where one written value comes from at call time. */
export type MutationValue =
  | { readonly kind: "param"; readonly name: string }
  | { readonly kind: "binding"; readonly index: number };

/**
 * One declared write.
 *
 * A mutation is described as a set of writes to normalized paths, not as a
 * patch object. That is what lets the planner decide which levels have to be
 * rebuilt before any source is emitted, and what lets a write announce what it
 * reads and what it writes.
 */
export interface MutationWrite {
  readonly kind: "set";
  readonly path: readonly string[];
  readonly value: MutationValue;
  /** Leaf schema, so the emitter can compare and copy it the way updates do. */
  readonly schema: ATS.AnyTypeSchema;
}

/** Paths a mutation reads and writes; the basis of dependency intersection. */
export interface MutationDependencies {
  readonly reads: readonly (readonly string[])[];
  readonly writes: readonly (readonly string[])[];
}

/**
 * A level of the value that has to be rebuilt because something below it did.
 *
 * Copy-on-write is planned here rather than discovered while emitting: each
 * level appears once, with the props it must carry over and the children it
 * must rebuild, so a mutation allocates one object per changed level.
 */
export interface MutationLevel {
  readonly path: readonly string[];
  readonly schema: ATS.AnyTypeSchema;
  /** Object props at this level, in schema order. */
  readonly props: readonly string[];
  /** Prop -> write, for props this level assigns directly. */
  readonly writes: ReadonlyMap<string, MutationWrite>;
  /** Prop -> nested level, for props rebuilt from below. */
  readonly children: ReadonlyMap<string, MutationLevel>;
}

export interface MutationPlan {
  readonly schema: ATS.AnyTypeSchema;
  readonly writes: readonly MutationWrite[];
  readonly dependencies: MutationDependencies;
  readonly params: readonly string[];
  readonly bindings: readonly unknown[];
  /** The copy tree; `undefined` when the mutation writes nothing. */
  readonly root: MutationLevel | undefined;
}

export interface MutationWriteInput {
  readonly path: readonly string[];
  readonly value: MutationValue;
}

/**
 * Builds the plan for a set of declared writes.
 *
 * Paths are resolved against the schema once. Writes that a later write makes
 * unobservable are dropped, writes under one parent are fused into a single
 * rebuild of that parent, and a mutation that writes nothing keeps no plan at
 * all — the three passes that decide how much a call is allowed to allocate.
 */
export function buildMutationPlan(
  schema: ATS.AnyTypeSchema,
  writes: readonly MutationWriteInput[],
  bindings: readonly unknown[]
): MutationPlan {
  const resolved: MutationWrite[] = [];
  const byPath = new Map<string, number>();

  for (const write of writes) {
    const leaf = resolveMutationPath(schema, write.path);
    const key = write.path.join(".");
    const previous = byPath.get(key);
    const node: MutationWrite = Object.freeze({
      kind: "set" as const,
      path: Object.freeze([...write.path]),
      value: write.value,
      schema: leaf,
    });
    // Dead write elimination: no declared write reads, so an earlier write to
    // the same path cannot be observed by a later one.
    if (previous === undefined) {
      byPath.set(key, resolved.length);
      resolved.push(node);
      continue;
    }
    resolved[previous] = node;
  }

  const params: string[] = [];
  for (const write of resolved) {
    if (write.value.kind === "param" && !params.includes(write.value.name)) params.push(write.value.name);
  }

  return Object.freeze({
    schema,
    writes: Object.freeze(resolved),
    dependencies: Object.freeze({
      // A declared write reads the field it overwrites, because the mutation
      // compares before it allocates.
      reads: Object.freeze(resolved.map((write) => write.path)),
      writes: Object.freeze(resolved.map((write) => write.path)),
    }),
    params: Object.freeze(params),
    bindings: Object.freeze([...bindings]),
    root: resolved.length === 0 ? undefined : planLevels(schema, resolved),
  });
}

/**
 * True when every declared path can be rebuilt with static object copies.
 *
 * The specialization has to mean exactly what the generic deep-partial update
 * means, so a leaf qualifies only when the generic update would assign it
 * directly: a primitive, a nullable/optional primitive, or a bare date. An
 * object, array, map, set or union leaf is *merged* by the generic update, not
 * replaced, and a level that may be absent would have to be created before it
 * could be copied. Those stay on the generic update rather than quietly
 * changing what a patch means.
 */
export function isSpecializableMutation(schema: ATS.AnyTypeSchema, paths: readonly (readonly string[])[]): boolean {
  for (const path of paths) {
    if (path.length === 0) return false;
    let current = schema;
    for (let index = 0; index < path.length; index++) {
      const wrappers = resolveWrappers(current);
      if (index > 0 && (wrappers.optional || wrappers.nullable)) return false;
      if (wrappers.base.type !== ATS.TypeName.object) return false;
      if (hasDefault(current)) return false;
      const next = (wrappers.base.def as ATS.ObjectDef).props[path[index] as string];
      if (next === undefined) return false;
      if (resolveWrappers(next).readonly) return false;
      current = next;
    }
    if (!isAssignedLeaf(current)) return false;
  }
  return true;
}

/** Leaf kinds the generic update assigns rather than merges. */
export function isAssignedLeaf(schema: ATS.AnyTypeSchema): boolean {
  if (hasDefault(schema)) return false;
  let program: ReturnType<typeof buildUpdateIR>;
  try {
    program = buildUpdateIR(schema);
  } catch {
    return false;
  }
  if (program.helpers.length > 0) return false;
  const node = program.body;
  if (node.kind === "reuse" || node.kind === "date") return true;
  return node.kind === "guard" && node.inner.kind === "reuse";
}

/** True when the leaf needs the date comparison the generic update uses. */
export function isDateLeaf(schema: ATS.AnyTypeSchema): boolean {
  return resolveWrappers(schema).base.type === ATS.TypeName.date;
}

function hasDefault(schema: ATS.AnyTypeSchema): boolean {
  let current = schema;
  while (true) {
    if (current.type === ATS.TypeName.default) return true;
    const inner = (current.def as { readonly innerType?: ATS.AnyTypeSchema }).innerType;
    if (inner === undefined) return false;
    current = inner;
  }
}

function resolveMutationPath(schema: ATS.AnyTypeSchema, path: readonly string[]): ATS.AnyTypeSchema {
  let current = schema;
  for (const key of path) {
    const base = resolveWrappers(current).base;
    if (base.type !== ATS.TypeName.object) {
      throw new JITError("INVALID_UPDATE", `Mutation path ${JSON.stringify(path.join("."))} leaves the object shape`);
    }
    const next = (base.def as ATS.ObjectDef).props[key];
    if (next === undefined) {
      throw new JITError(
        "INVALID_UPDATE",
        `Mutation path ${JSON.stringify(path.join("."))} is not declared by the schema`
      );
    }
    current = next;
  }
  return current;
}

/** Groups writes into one rebuild per level; siblings share their parent copy. */
function planLevels(schema: ATS.AnyTypeSchema, writes: readonly MutationWrite[]): MutationLevel {
  interface Draft {
    readonly path: readonly string[];
    readonly schema: ATS.AnyTypeSchema;
    readonly writes: Map<string, MutationWrite>;
    readonly children: Map<string, Draft>;
  }

  const root: Draft = { path: [], schema, writes: new Map(), children: new Map() };

  for (const write of writes) {
    let level = root;
    for (let index = 0; index < write.path.length - 1; index++) {
      const key = write.path[index] as string;
      let child = level.children.get(key);
      if (child === undefined) {
        const base = resolveWrappers(level.schema).base;
        child = {
          path: write.path.slice(0, index + 1),
          schema: (base.def as ATS.ObjectDef).props[key] as ATS.AnyTypeSchema,
          writes: new Map(),
          children: new Map(),
        };
        level.children.set(key, child);
      }
      level = child;
    }
    level.writes.set(write.path[write.path.length - 1] as string, write);
  }

  const freeze = (draft: Draft): MutationLevel =>
    Object.freeze({
      path: Object.freeze([...draft.path]),
      schema: draft.schema,
      props: Object.freeze(Object.keys((resolveWrappers(draft.schema).base.def as ATS.ObjectDef).props)),
      writes: draft.writes,
      children: new Map([...draft.children].map(([key, child]) => [key, freeze(child)])),
    });

  return freeze(root);
}
