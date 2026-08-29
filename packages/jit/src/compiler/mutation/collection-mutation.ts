import type { QueryConditionNode } from "../../core/ast/index.js";
import type * as ATS from "../../core/ats/index.js";
import { resolveHints } from "../../core/hints/index.js";
import { JITError } from "../../errors/index.js";
import {
  emitBinarySearch,
  emitCachedIndexLookup,
  emitEarlyExitScan,
  type KeyedAccessChoice,
  type KeyedEmitShape,
  resolveKeyedAccessChoice,
  singleKeyEquality,
} from "../access-path.js";
import { CodeWriter } from "../emitter/code-writer.js";
import { type IndexDescriptor, resolveIndexDescriptor, resolveIndexKeysFromFacts } from "../indexing.js";
import { resolveRowField, resolveRowObjectSchema, resolveScalarKeyKind } from "../row-keys.js";
import { emitQueryConditionSource, emitQueryValueSource } from "../source/query-condition.js";
import { emitMutationBody } from "./emit-mutation.js";
import type { MutationPlan } from "./mutation-plan.js";

export type CollectionMutationKind =
  | "updateByKey"
  | "removeByKey"
  | "replaceByKey"
  | "upsert"
  | "append"
  | "prepend"
  | "insertAt"
  | "removeAt"
  | "replaceAt"
  | "updateAt"
  | "swap"
  | "move"
  | "truncate"
  | "updateWhere"
  | "removeWhere"
  | "replaceWhere";

export type CollectionMutationMode = "first" | "all";

export interface CollectionMutationFacts {
  readonly reads: readonly (readonly string[])[];
  readonly writes: readonly (readonly string[])[];
  readonly changesLength: boolean;
  readonly changesOrder: boolean;
  readonly changesIdentity: boolean;
  readonly preservesKeyed: boolean;
  readonly preservesOrdering: boolean;
}

/**
 * One immutable mutation of a collection, and the path it reaches a row by.
 *
 * The operation is semantic — update this key, remove this key, upsert this
 * row. Which algorithm finds the row is decided from the collection's declared
 * facts by the same planner queries and lookups use, so a caller never names
 * an algorithm and the two can never disagree about the facts.
 */
export interface CollectionMutationDescriptor {
  readonly kind: CollectionMutationKind;
  readonly key: string;
  readonly descriptor: IndexDescriptor;
  readonly choice: KeyedAccessChoice;
  /** A Date key is matched by timestamp, the way the index stores it. */
  readonly date: boolean;
  /** Set for `updateByKey`/`updateWhere`: how a matched row is rebuilt. */
  readonly row?: MutationPlan;
  /** Ordering facts this mutation must not silently break. */
  readonly orderedBy?: string;
  /** Set for the `where` operations: the shared query condition they select by. */
  readonly condition?: QueryConditionNode;
  /** Expression the access path matches the key against. */
  readonly probe: string;
  readonly facts: CollectionMutationFacts;
  readonly mode: CollectionMutationMode;
}

export interface CollectionMutationExplain {
  readonly operation: CollectionMutationKind;
  readonly key: string;
  readonly physical: {
    readonly strategy: KeyedAccessChoice["strategy"] | "DirectPosition";
    readonly reason: string;
    readonly complexity: KeyedAccessChoice["complexity"];
    readonly facts: readonly string[];
  };
  /** Complexity of materializing the result, which copying does not escape. */
  readonly copy: "O(1)" | "O(n)";
  readonly mutation: CollectionMutationFacts;
}

const POSITIONAL_KINDS: ReadonlySet<CollectionMutationKind> = new Set([
  "append",
  "prepend",
  "insertAt",
  "removeAt",
  "replaceAt",
  "updateAt",
  "swap",
  "move",
  "truncate",
]);

/**
 * Resolves the key and access path for one collection mutation.
 *
 * The key comes from the collection's own facts unless one is named, so a
 * `.keyed("id")` collection needs no argument to know what identity means.
 */
export function resolveCollectionMutation(
  schema: ATS.AnyTypeSchema,
  kind: CollectionMutationKind,
  key: string | undefined,
  row?: MutationPlan,
  condition?: QueryConditionNode,
  mode: CollectionMutationMode = "all"
): CollectionMutationDescriptor {
  if (kind === "updateWhere" || kind === "removeWhere" || kind === "replaceWhere") {
    return resolveWhereMutation(schema, kind, condition as QueryConditionNode, row, mode);
  }
  if (POSITIONAL_KINDS.has(kind)) return resolvePositionalMutation(schema, kind, row);
  const object = resolveRowObjectSchema(schema, "state.collection");
  const resolved = key ?? resolveIndexKeysFromFacts(schema)?.[0];

  if (!resolved) {
    throw new JITError(
      "UNSUPPORTED_SCHEMA",
      "JIT.state.collection() needs a key: declare one with .keyed()/.indexBy()/.uniqueBy(), or name it"
    );
  }
  const field = resolveRowField(object, resolved, "state.collection");
  const choice = resolveKeyedAccessChoice(schema, resolved);
  const ordered = resolveOrderingKey(schema);
  if (row !== undefined) assertFactsPreserved(row, resolved, ordered);

  return Object.freeze({
    kind,
    key: resolved,
    descriptor: resolveIndexDescriptor(
      schema,
      [resolved],
      choice.strategy === "CachedIndexLookup" ? "position" : "unique"
    ),
    choice,
    date: resolveScalarKeyKind(field, resolved, "state.collection") === "date",
    ...(row === undefined ? {} : { row }),
    ...(ordered === undefined ? {} : { orderedBy: ordered }),
    probe: "params.key",
    facts: mutationFacts(kind, row),
    mode,
  });
}

function resolvePositionalMutation(
  schema: ATS.AnyTypeSchema,
  kind: CollectionMutationKind,
  row: MutationPlan | undefined
): CollectionMutationDescriptor {
  if (row !== undefined) {
    assertFactsPreserved(row, resolveIndexKeysFromFacts(schema)?.[0] ?? "", resolveOrderingKey(schema));
  }
  return Object.freeze({
    kind,
    key: "",
    descriptor: Object.freeze({
      keys: Object.freeze([]),
      shape: "unique" as const,
      uniqueByFact: false,
    }),
    choice: Object.freeze({
      strategy: "EarlyExitScan" as const,
      reason: "a positional mutation addresses array slots directly",
      complexity: "O(1)" as const,
      facts: Object.freeze([]),
      direction: "asc" as const,
    }),
    date: false,
    probe: "",
    ...(row === undefined ? {} : { row }),
    facts: mutationFacts(kind, row),
    mode: "all",
  });
}

function mutationFacts(kind: CollectionMutationKind, row?: MutationPlan): CollectionMutationFacts {
  const changesLength = [
    "append",
    "prepend",
    "insertAt",
    "removeAt",
    "truncate",
    "removeByKey",
    "upsert",
    "removeWhere",
  ].includes(kind);
  const changesOrder = [
    "prepend",
    "insertAt",
    "removeAt",
    "swap",
    "move",
    "truncate",
    "removeByKey",
    "upsert",
    "removeWhere",
  ].includes(kind);
  const preservesKeyed = [
    "removeAt",
    "updateAt",
    "swap",
    "move",
    "truncate",
    "updateByKey",
    "removeByKey",
    "updateWhere",
    "removeWhere",
  ].includes(kind);
  const preservesOrdering = [
    "removeAt",
    "updateAt",
    "truncate",
    "updateByKey",
    "removeByKey",
    "updateWhere",
    "removeWhere",
  ].includes(kind);
  return Object.freeze({
    reads: Object.freeze(row?.dependencies.reads ?? []),
    writes: Object.freeze(row?.dependencies.writes ?? [Object.freeze([])]),
    changesLength,
    changesOrder,
    changesIdentity: kind === "replaceAt" || kind === "replaceByKey" || kind === "replaceWhere" || kind === "upsert",
    preservesKeyed,
    preservesOrdering,
  });
}

/**
 * Resolves a mutation selected by a predicate rather than by identity.
 *
 * The predicate is the shared query condition, not a second filter language.
 * When it is one equality over a key the collection declares unique, the same
 * access path that answers a lookup answers the mutation and at most one row
 * is reached; anything else is a scan over every row, because anything else
 * can match more than one.
 */
function resolveWhereMutation(
  schema: ATS.AnyTypeSchema,
  kind: "updateWhere" | "removeWhere" | "replaceWhere",
  condition: QueryConditionNode,
  row: MutationPlan | undefined,
  mode: CollectionMutationMode
): CollectionMutationDescriptor {
  const object = resolveRowObjectSchema(schema, "state.collection");
  const equality = singleKeyEquality(condition);
  const lifted = equality ? resolveKeyedAccessChoice(schema, equality.key) : undefined;
  const ordered = resolveOrderingKey(schema);
  if (row !== undefined && equality !== undefined) assertFactsPreserved(row, equality.key, ordered);

  if (equality === undefined || lifted === undefined || lifted.strategy === "EarlyExitScan") {
    return Object.freeze({
      kind,
      key: "",
      descriptor: Object.freeze({
        keys: Object.freeze([]),
        shape: "unique" as const,
        uniqueByFact: false,
      }),
      choice: Object.freeze({
        strategy: "EarlyExitScan" as const,
        reason: "the predicate can match more than one row, so every row is visited",
        complexity: "O(n)" as const,
        facts: Object.freeze([]),
        direction: "asc" as const,
      }),
      date: false,
      condition,
      probe: "",
      ...(row === undefined ? {} : { row }),
      ...(ordered === undefined ? {} : { orderedBy: ordered }),
      facts: mutationFacts(kind, row),
      mode,
    });
  }

  const field = resolveRowField(object, equality.key, "state.collection");
  const date = resolveScalarKeyKind(field, equality.key, "state.collection") === "date";
  const probe = emitQueryValueSource(equality.probe, {
    fieldBase: "row",
    paramBase: "params",
  });

  return Object.freeze({
    kind,
    key: equality.key,
    descriptor: resolveIndexDescriptor(
      schema,
      [equality.key],
      lifted.strategy === "CachedIndexLookup" ? "position" : "unique"
    ),
    choice: lifted,
    date,
    condition,
    probe: date ? `(${probe} == null ? ${probe} : ${probe}.getTime())` : probe,
    ...(row === undefined ? {} : { row }),
    ...(ordered === undefined ? {} : { orderedBy: ordered }),
    facts: mutationFacts(kind, row),
    mode,
  });
}

function resolveOrderingKey(schema: ATS.AnyTypeSchema): string | undefined {
  const hints = resolveHints(schema);
  const ordered = hints.order ?? hints.collection?.ordered;
  const key = ordered?.key;
  return typeof key === "string" ? key : undefined;
}

/**
 * Refuses a patch that would invalidate the facts the search rests on.
 *
 * Writing the identity key changes which row a key reaches and can break
 * uniqueness; writing the ordering key can move the row out of order, and the
 * collection would still claim to be sorted. Both are repairs, not writes, so
 * the first version says no rather than silently leaving a collection whose
 * declared facts have stopped being true.
 */
function assertFactsPreserved(row: MutationPlan, key: string, ordered: string | undefined): void {
  for (const write of row.writes) {
    if (write.path.length === 1 && write.path[0] === key) {
      throw new JITError(
        "INVALID_UPDATE",
        `updateByKey() cannot write the identity key ${JSON.stringify(key)}; remove and insert the row instead`
      );
    }
    if (ordered !== undefined && write.path.length === 1 && write.path[0] === ordered) {
      throw new JITError(
        "INVALID_UPDATE",
        `updateByKey() cannot write the ordering key ${JSON.stringify(ordered)}; the collection would no longer be ordered`
      );
    }
  }
}

export function explainCollectionMutation(descriptor: CollectionMutationDescriptor): CollectionMutationExplain {
  const positional = POSITIONAL_KINDS.has(descriptor.kind);
  return Object.freeze({
    operation: descriptor.kind,
    key: descriptor.key,
    physical: Object.freeze({
      strategy: positional ? "DirectPosition" : descriptor.choice.strategy,
      reason: descriptor.choice.reason,
      complexity: descriptor.choice.complexity,
      facts: descriptor.choice.facts,
    }),
    // Finding the row can be O(1) or O(log n); rebuilding the array cannot.
    // Saying so is the honest half of the claim.
    copy: "O(n)" as const,
    mutation: descriptor.facts,
  });
}

export function collectionMutationCacheKey(descriptor: CollectionMutationDescriptor): string {
  return `collection:${descriptor.kind}:${descriptor.mode}:${descriptor.choice.strategy}:${descriptor.key}:${descriptor.date}:${descriptor.choice.direction}`;
}

/** Emits the position finder for one mutation, from the shared access path. */
function emitFindPosition(descriptor: CollectionMutationDescriptor): string {
  const shape: KeyedEmitShape = {
    signature: "value, params",
    probe:
      descriptor.date && descriptor.probe === "params.key"
        ? "(params.key == null ? params.key : params.key.getTime())"
        : descriptor.probe,
    answers: "position",
  };

  if (descriptor.choice.strategy === "CachedIndexLookup") return emitCachedIndexLookup(descriptor.descriptor, shape);
  if (descriptor.choice.strategy === "BinarySearch") {
    return emitBinarySearch(descriptor.key, descriptor.descriptor, descriptor.choice.direction, shape);
  }
  return emitEarlyExitScan(descriptor.key, descriptor.descriptor, shape);
}

/**
 * Emits one collection mutation.
 *
 * Nothing is copied before the decision is made: the position is found first,
 * a mutation that changes nothing returns the original array, and only then is
 * one array of the right length allocated and filled with indexed loops. There
 * is no `filter`, no `map` and no callback anywhere in the result.
 */
export function emitCollectionMutationSource(descriptor: CollectionMutationDescriptor): string {
  const writer = new CodeWriter();

  writer.line("(() => {");
  writer.indent(() => {
    if (needsPositionFinder(descriptor)) writer.line(`const find = ${emitFindPosition(descriptor)};`);
    writer.line("function mutate(value, params) {");
    writer.indent(() => emitBody(writer, descriptor));
    writer.line("}");
    writer.line("return mutate;");
  });
  writer.line("})()");
  return writer.toString();
}

function needsPositionFinder(descriptor: CollectionMutationDescriptor): boolean {
  if (POSITIONAL_KINDS.has(descriptor.kind)) return false;
  if (descriptor.kind !== "updateWhere" && descriptor.kind !== "removeWhere" && descriptor.kind !== "replaceWhere")
    return true;
  return descriptor.choice.strategy !== "EarlyExitScan";
}

function emitBody(writer: CodeWriter, descriptor: CollectionMutationDescriptor): void {
  if (descriptor.kind === "append" || descriptor.kind === "prepend") {
    emitInsertEnd(writer, descriptor.kind);
    return;
  }
  if (descriptor.kind === "insertAt") {
    emitInsertAt(writer);
    return;
  }
  if (descriptor.kind === "removeAt") {
    emitPositionalRemoveAt(writer);
    return;
  }
  if (descriptor.kind === "replaceAt" || descriptor.kind === "updateAt") {
    writer.line("const at = params.index;");
    writer.line("if (!Number.isInteger(at) || at < 0 || at >= value.length) return value;");
    emitReplaceAt(writer, descriptor, "row");
    return;
  }
  if (descriptor.kind === "swap") {
    emitSwap(writer);
    return;
  }
  if (descriptor.kind === "move") {
    emitMove(writer);
    return;
  }
  if (descriptor.kind === "truncate") {
    emitTruncate(writer);
    return;
  }
  if (descriptor.kind === "updateWhere" || descriptor.kind === "removeWhere" || descriptor.kind === "replaceWhere") {
    if (descriptor.choice.strategy === "EarlyExitScan") {
      if (descriptor.kind === "updateWhere") emitUpdateWhereScan(writer, descriptor);
      else if (descriptor.kind === "removeWhere") {
        if (descriptor.mode === "first") emitRemoveWhereFirst(writer, descriptor);
        else emitRemoveWhereScan(writer, descriptor);
      } else emitReplaceWhereScan(writer, descriptor);
      return;
    }
    writer.line("const at = find(value, params);");
    writer.line("if (at < 0) return value;");
    if (descriptor.kind === "removeWhere") emitRemoveAt(writer);
    else emitReplaceAt(writer, descriptor, "row");
    return;
  }
  writer.line("const at = find(value, params);");

  if (descriptor.kind === "removeByKey") {
    writer.line("if (at < 0) return value;");
    emitRemoveAt(writer);
    return;
  }
  if (descriptor.kind === "updateByKey" || descriptor.kind === "replaceByKey") {
    writer.line("if (at < 0) return value;");
    emitReplaceAt(writer, descriptor, "row");
    return;
  }
  emitUpsert(writer);
}

/** Rebuilds the matched row through its mutation plan, then replaces one slot. */
function emitReplaceAt(writer: CodeWriter, descriptor: CollectionMutationDescriptor, rowVar: string): void {
  writer.line(`const ${rowVar} = value[at];`);
  writer.line("const next = (() => {");
  writer.indent(() => {
    writer.line(`const value = ${rowVar};`);
    if (descriptor.row === undefined) writer.line("return params.row;");
    else for (const line of emitMutationBody(descriptor.row).split("\n")) writer.line(line);
  });
  writer.line("})();");
  // A row that did not change means the collection did not change, so the
  // original array is returned rather than copied.
  writer.line(
    descriptor.kind === "replaceAt" || descriptor.kind === "replaceByKey" || descriptor.kind === "replaceWhere"
      ? `if (__equal(${rowVar}, next)) return value;`
      : `if (next === ${rowVar}) return value;`
  );
  writer.line("const out = value.slice();");
  writer.line("out[at] = next;");
  writer.line("return out;");
}

function emitRemoveAt(writer: CodeWriter): void {
  // Not `filter`: that visits every row, allocates through a callback and
  // mixes finding the row with building the result.
  writer.line("const len = value.length;");
  writer.line("const out = new Array(len - 1);");
  writer.line("for (let i = 0; i < at; i++) out[i] = value[i];");
  writer.line("for (let i = at + 1; i < len; i++) out[i - 1] = value[i];");
  writer.line("return out;");
}

function emitInsertAt(writer: CodeWriter): void {
  writer.line("const at = params.index;");
  writer.line("const len = value.length;");
  writer.line("if (!Number.isInteger(at) || at < 0 || at > len) return value;");
  writer.line("const out = new Array(len + 1);");
  writer.line("for (let i = 0; i < at; i++) out[i] = value[i];");
  writer.line("out[at] = params.row;");
  writer.line("for (let i = at; i < len; i++) out[i + 1] = value[i];");
  writer.line("return out;");
}

function emitPositionalRemoveAt(writer: CodeWriter): void {
  writer.line("const at = params.index;");
  writer.line("if (!Number.isInteger(at) || at < 0 || at >= value.length) return value;");
  emitRemoveAt(writer);
}

function emitSwap(writer: CodeWriter): void {
  writer.line("const a = params.a;");
  writer.line("const b = params.b;");
  writer.line("const len = value.length;");
  writer.line(
    "if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= len || b >= len || a === b || value[a] === value[b]) return value;"
  );
  writer.line("const out = value.slice();");
  writer.line("out[a] = value[b];");
  writer.line("out[b] = value[a];");
  writer.line("return out;");
}

function emitMove(writer: CodeWriter): void {
  writer.line("const from = params.from;");
  writer.line("const to = params.to;");
  writer.line("const len = value.length;");
  writer.line(
    "if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= len || to >= len || from === to) return value;"
  );
  writer.line("const out = new Array(len);");
  writer.line("if (from < to) {");
  writer.indent(() => {
    writer.line("for (let i = 0; i < from; i++) out[i] = value[i];");
    writer.line("for (let i = from; i < to; i++) out[i] = value[i + 1];");
    writer.line("out[to] = value[from];");
    writer.line("for (let i = to + 1; i < len; i++) out[i] = value[i];");
  });
  writer.line("} else {");
  writer.indent(() => {
    writer.line("for (let i = 0; i < to; i++) out[i] = value[i];");
    writer.line("out[to] = value[from];");
    writer.line("for (let i = to + 1; i <= from; i++) out[i] = value[i - 1];");
    writer.line("for (let i = from + 1; i < len; i++) out[i] = value[i];");
  });
  writer.line("}");
  writer.line("return out;");
}

function emitTruncate(writer: CodeWriter): void {
  writer.line("const length = params.length;");
  writer.line("const len = value.length;");
  writer.line("if (!Number.isInteger(length) || length < 0 || length >= len) return value;");
  writer.line("const out = new Array(length);");
  writer.line("for (let i = 0; i < length; i++) out[i] = value[i];");
  writer.line("return out;");
}

function emitUpsert(writer: CodeWriter): void {
  writer.line("if (at >= 0) {");
  writer.indent(() => {
    writer.line("const row = value[at];");
    writer.line("const next = params.row;");
    writer.line("if (__equal(row, next)) return value;");
    writer.line("const out = value.slice();");
    writer.line("out[at] = next;");
    writer.line("return out;");
  });
  writer.line("}");
  // A binary search reports where the key belongs, so an ordered collection
  // stays ordered; an index or a scan reports the end, which is an append.
  writer.line("const insertion = ~at;");
  writer.line("const len = value.length;");
  writer.line("const out = new Array(len + 1);");
  writer.line("for (let i = 0; i < insertion; i++) out[i] = value[i];");
  writer.line("out[insertion] = params.row;");
  writer.line("for (let i = insertion; i < len; i++) out[i + 1] = value[i];");
  writer.line("return out;");
}

/**
 * Updates every row the predicate selects, copying once and only once.
 *
 * The output array is not allocated until a row actually changes, so a
 * predicate that matches nothing — or matches rows that were already correct —
 * returns the original collection.
 */
function emitUpdateWhereScan(writer: CodeWriter, descriptor: CollectionMutationDescriptor): void {
  writer.line("const len = value.length;");
  writer.line("let out = null;");
  writer.line("for (let i = 0; i < len; i++) {");
  writer.indent(() => {
    writer.line("const row = value[i];");
    writer.line(`if (!(${emitPredicate(descriptor)})) continue;`);
    writer.line("const next = (() => {");
    writer.indent(() => {
      writer.line("const value = row;");
      if (descriptor.row === undefined) writer.line("return params.row;");
      else for (const line of emitMutationBody(descriptor.row).split("\n")) writer.line(line);
    });
    writer.line("})();");
    writer.line("if (next === row) continue;");
    writer.line("if (out === null) out = value.slice();");
    writer.line("out[i] = next;");
  });
  writer.line("}");
  writer.line("return out === null ? value : out;");
}

/** Replaces every selected row, allocating only after a semantic change. */
function emitReplaceWhereScan(writer: CodeWriter, descriptor: CollectionMutationDescriptor): void {
  writer.line("const len = value.length;");
  writer.line("let out = null;");
  writer.line("for (let i = 0; i < len; i++) {");
  writer.indent(() => {
    writer.line("const row = value[i];");
    writer.line(`if (!(${emitPredicate(descriptor)})) continue;`);
    writer.line("if (__equal(row, params.row)) continue;");
    writer.line("if (out === null) out = value.slice();");
    writer.line("out[i] = params.row;");
  });
  writer.line("}");
  writer.line("return out === null ? value : out;");
}

/**
 * Removes every row the predicate selects.
 *
 * The matches are counted first so exactly one array of the final length is
 * allocated; a predicate that matches nothing returns the original collection
 * without allocating at all. The predicate runs twice per row, which is the
 * price of never over-allocating and never growing an array.
 */
function emitRemoveWhereScan(writer: CodeWriter, descriptor: CollectionMutationDescriptor): void {
  const predicate = emitPredicate(descriptor);
  writer.line("const len = value.length;");
  writer.line("let removed = 0;");
  writer.line("for (let i = 0; i < len; i++) {");
  writer.indent(() => {
    writer.line("const row = value[i];");
    writer.line(`if (${predicate}) removed++;`);
  });
  writer.line("}");
  writer.line("if (removed === 0) return value;");
  writer.line("const out = new Array(len - removed);");
  writer.line("let j = 0;");
  writer.line("for (let i = 0; i < len; i++) {");
  writer.indent(() => {
    writer.line("const row = value[i];");
    writer.line(`if (!(${predicate})) out[j++] = row;`);
  });
  writer.line("}");
  writer.line("return out;");
}

/** Finds only the first selected slot, then performs the specialized removal. */
function emitRemoveWhereFirst(writer: CodeWriter, descriptor: CollectionMutationDescriptor): void {
  writer.line("let at = -1;");
  writer.line("for (let i = 0; i < value.length; i++) {");
  writer.indent(() => {
    writer.line("const row = value[i];");
    writer.line(`if (${emitPredicate(descriptor)}) { at = i; break; }`);
  });
  writer.line("}");
  writer.line("if (at < 0) return value;");
  emitRemoveAt(writer);
}

function emitPredicate(descriptor: CollectionMutationDescriptor): string {
  return emitQueryConditionSource(descriptor.condition as QueryConditionNode, {
    fieldBase: "row",
    paramBase: "params",
  });
}

function emitInsertEnd(writer: CodeWriter, kind: "append" | "prepend"): void {
  writer.line("const len = value.length;");
  writer.line("const out = new Array(len + 1);");
  if (kind === "append") {
    writer.line("for (let i = 0; i < len; i++) out[i] = value[i];");
    writer.line("out[len] = params.row;");
  } else {
    writer.line("out[0] = params.row;");
    writer.line("for (let i = 0; i < len; i++) out[i + 1] = value[i];");
  }
  writer.line("return out;");
}
