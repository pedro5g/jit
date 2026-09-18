import { compileEqual, emitEqualSource } from "../compiler/equal.js";
import {
  buildMutationPlan,
  type CollectionMutationDescriptor,
  type CollectionMutationExplain,
  collectionMutationCacheKey,
  emitCollectionMutationSource,
  explainCollectionMutation,
  isSpecializableMutation,
  type MutationWriteInput,
  resolveCollectionMutation,
} from "../compiler/mutation/index.js";
import { resolveRowObjectSchema } from "../compiler/row-keys.js";
import type { QueryConditionNode } from "../core/ast/index.js";
import type { AnyTypeSchema, ArraySchema, ElementDef, TypeofSchema } from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { getCachedIndex } from "../runtime/index/index-cache.js";
import { createConditionBuilder, type QueryConditionBuilder } from "./query.js";
import { collectPatchWrites, type UpdatePatchParams, type UpdatePatchTemplate } from "./update.js";

/**
 * A compiled collection mutation, and the access path it resolved to.
 *
 * @example
 * ```ts
 * const Users = JIT.array(JIT.object({ id: JIT.number(), name: JIT.string() })).keyed("id");
 * const rename = JIT.state.collection(Users).updateByKey({ key: "id", patch: { name: "Ada" } });
 * rename([{ id: 1, name: "Grace" }], { key: 1 }); // [{ id: 1, name: "Ada" }]
 * ```
 */
export type CollectionMutation<TRow, TParams> = ((value: readonly TRow[], params: TParams) => readonly TRow[]) & {
  explain(): CollectionMutationExplain;
};

/**
 * Immutable mutation of a collection, with the search planned from its facts.
 *
 * This is not an array API. The operation says what should happen to a row —
 * update this key, remove it, upsert it — and the collection's declared facts
 * decide how that row is reached: a cached index, a binary search, or a scan.
 *
 * @example
 * ```ts
 * const Users = JIT.array(JIT.object({ id: JIT.number(), active: JIT.boolean() })).keyed("id");
 * const remove = JIT.state.collection(Users).removeWhere((query) => query.eq("active", false));
 * const remaining = remove([{ id: 1, active: true }, { id: 2, active: false }], {});
 * ```
 */
export interface CollectionState<TSchema extends AnyTypeSchema, TRow> {
  /** Updates the row identified by the supplied key. */
  updateByKey<const TPatch extends UpdatePatchTemplate<TRow>>(options: {
    readonly key?: string;
    readonly patch: TPatch;
  }): CollectionMutation<TRow, UpdatePatchParams<TPatch> & { readonly key: unknown }>;
  /** Removes the row identified by the supplied key. */
  removeByKey(options?: { readonly key?: string }): CollectionMutation<TRow, { readonly key: unknown }>;
  /** Replaces the row identified by the supplied key. */
  replaceByKey(options?: {
    readonly key?: string;
  }): CollectionMutation<TRow, { readonly key: unknown; readonly row: TRow }>;
  /** Replaces the row for a key or appends it when the key is absent. */
  upsert(options?: { readonly key?: string }): CollectionMutation<TRow, { readonly key: unknown; readonly row: TRow }>;
  /** Appends one row without searching the collection. */
  append(): CollectionMutation<TRow, { readonly row: TRow }>;
  /** Prepends one row without searching the collection. */
  prepend(): CollectionMutation<TRow, { readonly row: TRow }>;
  /** Inserts one row at an index. */
  insertAt(): CollectionMutation<TRow, { readonly index: number; readonly row: TRow }>;
  /** Removes the row at an index. */
  removeAt(): CollectionMutation<TRow, { readonly index: number }>;
  /** Replaces the row at an index. */
  replaceAt(): CollectionMutation<TRow, { readonly index: number; readonly row: TRow }>;
  /** Updates the row at an index. */
  updateAt<const TPatch extends UpdatePatchTemplate<TRow>>(options: {
    readonly patch: TPatch;
  }): CollectionMutation<TRow, UpdatePatchParams<TPatch> & { readonly index: number }>;
  /** Swaps two row positions. */
  swap(): CollectionMutation<TRow, { readonly a: number; readonly b: number }>;
  /** Moves one row from `from` to `to`. */
  move(): CollectionMutation<TRow, { readonly from: number; readonly to: number }>;
  /** Keeps only the first `length` rows. */
  truncate(): CollectionMutation<TRow, { readonly length: number }>;
  /**
   * Updates every row the predicate selects. The predicate is the shared query
   * condition, not a second filter language.
   *
   * The patch's own parameters are named in the type; a parameter the predicate
   * declares is not, because a condition node does not carry its name into the
   * type system.
   */
  updateWhere<const TPatch extends UpdatePatchTemplate<TRow>>(
    predicate: (query: QueryConditionBuilder<TRow>) => QueryConditionNode,
    patch: TPatch
  ): CollectionMutation<TRow, UpdatePatchParams<TPatch> & Readonly<Record<string, unknown>>>;
  /** Removes every row the predicate selects. */
  removeWhere(
    predicate: (query: QueryConditionBuilder<TRow>) => QueryConditionNode,
    options?: { readonly mode?: "first" | "all" }
  ): CollectionMutation<TRow, Readonly<Record<string, unknown>>>;
  /** Replaces every row selected by the shared query condition. */
  replaceWhere(
    predicate: (query: QueryConditionBuilder<TRow>) => QueryConditionNode
  ): CollectionMutation<TRow, Readonly<Record<string, unknown>> & { readonly row: TRow }>;
  readonly schema: TSchema;
}

/** Describes the JIT collection mutation host contract used by the public API. */
export type CollectionMutationHost = <TRow, TParams>(
  schema: AnyTypeSchema,
  descriptor: CollectionMutationDescriptor,
  bindings: readonly unknown[]
) => CollectionMutation<TRow, TParams>;

/**
 * Opens the mutation surface of one collection schema.
 *
 * @param schema - An array schema, normally carrying `.keyed()` or `.ordered()`.
 * @example
 * ```ts
 * const Users = JIT.array(JIT.object({ id: JIT.number(), name: JIT.string() })).keyed("id");
 * const update = JIT.state.collection(Users).updateByKey({ key: "id", patch: { name: "Ada" } });
 * ```
 */
export function collection<TElement extends AnyTypeSchema>(
  schema: SchemaInput<ArraySchema<TElement>>
): CollectionState<ArraySchema<TElement>, TypeofSchema<TElement>> {
  return createCollectionState(
    schema as SchemaInput<ArraySchema<AnyTypeSchema>>,
    compileCollectionMutation as CollectionMutationHost
  ) as unknown as CollectionState<ArraySchema<TElement>, TypeofSchema<TElement>>;
}

/** Builds the same semantic collection surface for runtime and define hosts. */
export function createCollectionState<TElement extends AnyTypeSchema>(
  schema: SchemaInput<ArraySchema<TElement>>,
  compile: CollectionMutationHost
): CollectionState<ArraySchema<TElement>, TypeofSchema<TElement>> {
  const unwrapped = unwrapSchema(schema);
  if (unwrapped.type !== TypeName.array) {
    throw new JITError("UNSUPPORTED_SCHEMA", "JIT.state.collection() requires an array schema");
  }
  const state = {
    schema: unwrapped as ArraySchema<TElement>,
    updateByKey: (options: { key?: string; patch: unknown }) => {
      const rowSchema = resolveRowObjectSchema(unwrapped, "state.collection") as unknown as AnyTypeSchema;
      const bindings: unknown[] = [];
      const writes = collectPatchWrites(rowSchema, options.patch, [], bindings);
      if (
        writes === undefined ||
        !isSpecializableMutation(
          rowSchema,
          writes.map((write) => write.path)
        )
      ) {
        throw new JITError(
          "INVALID_UPDATE",
          "updateByKey() patches a row field by field; a leaf the deep-partial update merges is not supported yet"
        );
      }
      const plan = buildMutationPlan(rowSchema, writes as MutationWriteInput[], bindings);
      return compile(unwrapped, resolveCollectionMutation(unwrapped, "updateByKey", options.key, plan), plan.bindings);
    },
    removeByKey: (options?: { key?: string }) =>
      compile(unwrapped, resolveCollectionMutation(unwrapped, "removeByKey", options?.key), []),
    replaceByKey: (options?: { key?: string }) =>
      compile(unwrapped, resolveCollectionMutation(unwrapped, "replaceByKey", options?.key), []),
    upsert: (options?: { key?: string }) =>
      compile(unwrapped, resolveCollectionMutation(unwrapped, "upsert", options?.key), []),
    append: () => compile(unwrapped, resolveCollectionMutation(unwrapped, "append", undefined), []),
    prepend: () => compile(unwrapped, resolveCollectionMutation(unwrapped, "prepend", undefined), []),
    insertAt: () => compile(unwrapped, resolveCollectionMutation(unwrapped, "insertAt", undefined), []),
    removeAt: () => compile(unwrapped, resolveCollectionMutation(unwrapped, "removeAt", undefined), []),
    replaceAt: () => compile(unwrapped, resolveCollectionMutation(unwrapped, "replaceAt", undefined), []),
    updateAt: (options: { patch: unknown }) => {
      const rowSchema = resolveRowObjectSchema(unwrapped, "state.collection") as unknown as AnyTypeSchema;
      const bindings: unknown[] = [];
      const writes = collectPatchWrites(rowSchema, options.patch, [], bindings);
      if (
        writes === undefined ||
        !isSpecializableMutation(
          rowSchema,
          writes.map((write) => write.path)
        )
      ) {
        throw new JITError(
          "INVALID_UPDATE",
          "updateAt() patches a row field by field; a leaf the deep-partial update merges is not supported yet"
        );
      }
      const plan = buildMutationPlan(rowSchema, writes as MutationWriteInput[], bindings);
      return compile(unwrapped, resolveCollectionMutation(unwrapped, "updateAt", undefined, plan), plan.bindings);
    },
    swap: () => compile(unwrapped, resolveCollectionMutation(unwrapped, "swap", undefined), []),
    move: () => compile(unwrapped, resolveCollectionMutation(unwrapped, "move", undefined), []),
    truncate: () => compile(unwrapped, resolveCollectionMutation(unwrapped, "truncate", undefined), []),
    updateWhere: (predicate: (query: QueryConditionBuilder<unknown>) => QueryConditionNode, patch: unknown) => {
      const rowSchema = resolveRowObjectSchema(unwrapped, "state.collection") as unknown as AnyTypeSchema;
      const bindings: unknown[] = [];
      const writes = collectPatchWrites(rowSchema, patch, [], bindings);
      if (
        writes === undefined ||
        !isSpecializableMutation(
          rowSchema,
          writes.map((write) => write.path)
        )
      ) {
        throw new JITError(
          "INVALID_UPDATE",
          "updateWhere() patches a row field by field; a leaf the deep-partial update merges is not supported yet"
        );
      }
      const plan = buildMutationPlan(rowSchema, writes as MutationWriteInput[], bindings);
      // The condition's own bindings continue the patch's numbering, so one
      // binding list reaches the compiled function.
      const condition = createConditionBuilder(plan.bindings.length);
      const node = predicate(condition.builder);
      return compile(unwrapped, resolveCollectionMutation(unwrapped, "updateWhere", undefined, plan, node), [
        ...plan.bindings,
        ...condition.bindings,
      ]);
    },
    removeWhere: (
      predicate: (query: QueryConditionBuilder<unknown>) => QueryConditionNode,
      options?: { mode?: "first" | "all" }
    ) => {
      const condition = createConditionBuilder(0);
      const node = predicate(condition.builder);
      return compile(
        unwrapped,
        resolveCollectionMutation(unwrapped, "removeWhere", undefined, undefined, node, options?.mode ?? "all"),
        condition.bindings
      );
    },
    replaceWhere: (predicate: (query: QueryConditionBuilder<unknown>) => QueryConditionNode) => {
      const condition = createConditionBuilder(0);
      const node = predicate(condition.builder);
      return compile(
        unwrapped,
        resolveCollectionMutation(unwrapped, "replaceWhere", undefined, undefined, node),
        condition.bindings
      );
    },
  };
  return Object.freeze(state) as unknown as CollectionState<ArraySchema<TElement>, TypeofSchema<TElement>>;
}

function compileCollectionMutation<TRow, TParams>(
  schema: AnyTypeSchema,
  descriptor: CollectionMutationDescriptor,
  bindings: readonly unknown[]
): CollectionMutation<TRow, TParams> {
  const elementSchema = (schema.def as ElementDef).element;
  const source = emitCollectionMutationSource(descriptor);
  const names = bindings.map((_, index) => `__q${index}`);
  const needsEqual =
    descriptor.kind === "upsert" ||
    descriptor.kind === "replaceAt" ||
    descriptor.kind === "replaceByKey" ||
    descriptor.kind === "replaceWhere";
  const equal = needsEqual ? compileEqual(elementSchema) : undefined;
  const mutate = globalThis.Function(
    "__cachedIndex",
    "__equal",
    ...names,
    `return ${source};`
  )(getCachedIndex, equal, ...bindings) as CollectionMutation<TRow, TParams>;
  const explanation = explainCollectionMutation(descriptor);

  Object.defineProperty(mutate, "explain", {
    enumerable: false,
    value: () => explanation,
  });
  registerArtifact(mutate as object, {
    kind: "collection-mutation-plan",
    schema,
    source,
    bindingNames: names,
    bindingValues: bindings,
    // The upsert no-op test is schema-specialized equality, emitted as a local
    // helper by AOT rather than carried as a runtime binding.
    equalSource: needsEqual ? emitEqualSource(elementSchema) : undefined,
    cacheKey: collectionMutationCacheKey(descriptor),
    explanation,
  });
  return mutate;
}
