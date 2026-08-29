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
import type { AnyTypeSchema, ArraySchema, TypeofSchema } from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { getCachedIndex } from "../runtime/index/index-cache.js";
import { createConditionBuilder, type QueryConditionBuilder } from "./query.js";
import { collectPatchWrites, type UpdatePatchParams, type UpdatePatchTemplate } from "./update.js";

/** A compiled collection mutation, and the access path it resolved to. */
export type CollectionMutation<TRow, TParams> = ((value: readonly TRow[], params: TParams) => readonly TRow[]) & {
  explain(): CollectionMutationExplain;
};

/**
 * Immutable mutation of a collection, with the search planned from its facts.
 *
 * This is not an array API. The operation says what should happen to a row —
 * update this key, remove it, upsert it — and the collection's declared facts
 * decide how that row is reached: a cached index, a binary search, or a scan.
 */
export interface CollectionState<TSchema extends AnyTypeSchema, TRow> {
  updateByKey<const TPatch extends UpdatePatchTemplate<TRow>>(options: {
    readonly key?: string;
    readonly patch: TPatch;
  }): CollectionMutation<TRow, UpdatePatchParams<TPatch> & { readonly key: unknown }>;
  removeByKey(options?: { readonly key?: string }): CollectionMutation<TRow, { readonly key: unknown }>;
  upsert(options?: { readonly key?: string }): CollectionMutation<TRow, { readonly key: unknown; readonly row: TRow }>;
  append(): CollectionMutation<TRow, { readonly row: TRow }>;
  prepend(): CollectionMutation<TRow, { readonly row: TRow }>;
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
    predicate: (query: QueryConditionBuilder<TRow>) => QueryConditionNode
  ): CollectionMutation<TRow, Readonly<Record<string, unknown>>>;
  readonly schema: TSchema;
}

/**
 * Opens the mutation surface of one collection schema.
 *
 * @param schema - An array schema, normally carrying `.keyed()` or `.ordered()`.
 */
export function collection<TElement extends AnyTypeSchema>(
  schema: SchemaInput<ArraySchema<TElement>>
): CollectionState<ArraySchema<TElement>, TypeofSchema<TElement>> {
  const unwrapped = unwrapSchema(schema);
  if (unwrapped.type !== TypeName.array) {
    throw new JITError("UNSUPPORTED_SCHEMA", "JIT.state.collection() requires an array schema");
  }
  const rowSchema = resolveRowObjectSchema(unwrapped, "state.collection") as unknown as AnyTypeSchema;

  const state = {
    schema: unwrapped as ArraySchema<TElement>,
    updateByKey: (options: { key?: string; patch: unknown }) => {
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
      return compileCollectionMutation(
        unwrapped,
        resolveCollectionMutation(unwrapped, "updateByKey", options.key, plan),
        plan.bindings
      );
    },
    removeByKey: (options?: { key?: string }) =>
      compileCollectionMutation(unwrapped, resolveCollectionMutation(unwrapped, "removeByKey", options?.key), []),
    upsert: (options?: { key?: string }) =>
      compileCollectionMutation(unwrapped, resolveCollectionMutation(unwrapped, "upsert", options?.key), []),
    append: () => compileCollectionMutation(unwrapped, resolveCollectionMutation(unwrapped, "append", undefined), []),
    prepend: () => compileCollectionMutation(unwrapped, resolveCollectionMutation(unwrapped, "prepend", undefined), []),
    updateWhere: (predicate: (query: QueryConditionBuilder<unknown>) => QueryConditionNode, patch: unknown) => {
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
      return compileCollectionMutation(
        unwrapped,
        resolveCollectionMutation(unwrapped, "updateWhere", undefined, plan, node),
        [...plan.bindings, ...condition.bindings]
      );
    },
    removeWhere: (predicate: (query: QueryConditionBuilder<unknown>) => QueryConditionNode) => {
      const condition = createConditionBuilder(0);
      const node = predicate(condition.builder);
      return compileCollectionMutation(
        unwrapped,
        resolveCollectionMutation(unwrapped, "removeWhere", undefined, undefined, node),
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
  const rowSchema = resolveRowObjectSchema(schema, "state.collection") as unknown as AnyTypeSchema;
  const source = emitCollectionMutationSource(descriptor);
  const names = bindings.map((_, index) => `__q${index}`);
  const equal = descriptor.kind === "upsert" ? compileEqual(rowSchema) : undefined;
  const mutate = globalThis.Function(
    "__cachedIndex",
    "__equal",
    ...names,
    `return ${source};`
  )(getCachedIndex, equal, ...bindings) as CollectionMutation<TRow, TParams>;
  const explanation = explainCollectionMutation(descriptor);

  Object.defineProperty(mutate, "explain", { enumerable: false, value: () => explanation });
  registerArtifact(mutate as object, {
    kind: "collection-mutation-plan",
    schema,
    source,
    bindingNames: names,
    bindingValues: bindings,
    // The upsert no-op test is schema-specialized equality, emitted as a local
    // helper by AOT rather than carried as a runtime binding.
    equalSource: descriptor.kind === "upsert" ? emitEqualSource(rowSchema) : undefined,
    cacheKey: collectionMutationCacheKey(descriptor),
    explanation,
  });
  return mutate;
}
