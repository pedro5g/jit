import type { QueryConditionNode, QueryValueNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { resolveHints } from "../core/hints/index.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { emitIndexBuilder, type IndexDescriptor, indexCacheKey } from "./indexing.js";
import { resolveHintKey } from "./resolvers/resolve-hints.js";
import { emitPropertyAccess } from "./source/access.js";

/** How reaching one row by a single key is answered, given the collection's facts. */
export interface KeyedAccessChoice {
  readonly strategy: "CachedIndexLookup" | "BinarySearch" | "EarlyExitScan";
  readonly reason: string;
  readonly complexity: "O(1)" | "O(log n)" | "O(k)" | "O(n)";
  readonly facts: readonly string[];
  readonly direction: "asc" | "desc";
}

/**
 * Chooses the access path for one key. A standalone lookup and a keyed query
 * terminal are the same question asked twice, so both ask it here: the caller
 * never names an algorithm, and the two can never disagree about the facts.
 */
export function resolveKeyedAccessChoice(schema: ATS.AnyTypeSchema, key: string): KeyedAccessChoice {
  const hints = resolveHints(schema);
  const ordered = hints.order ?? hints.collection?.ordered;
  const orderedKey = resolveHintKey(ordered?.key);
  const cacheIndex = hints.entity?.cacheIndex === true;
  const identityKey = resolveHintKey(hints.index?.key) ?? resolveHintKey(hints.entity?.key);
  const unique = hints.collection?.unique === true || hints.entity?.key !== undefined;

  // An ordered key is searched without allocating anything, so it wins over an
  // index even where both are declared.
  if (ordered && orderedKey === key && unique) {
    return Object.freeze({
      strategy: "BinarySearch" as const,
      reason: "the collection declares this key ordered and unique",
      complexity: "O(log n)" as const,
      facts: Object.freeze([`ordered: ${orderedKey} ${ordered.direction ?? "asc"}`, `unique key: ${orderedKey}`]),
      direction: ordered.direction === "desc" ? ("desc" as const) : ("asc" as const),
    });
  }

  // Building an index for a single lookup is strictly worse than scanning —
  // `pnpm bench:index` measures 456 us against 5.13 us on 10 000 rows — so the
  // index path is taken only where the schema opted into caching it.
  if (cacheIndex && identityKey === key) {
    return Object.freeze({
      strategy: "CachedIndexLookup" as const,
      reason: "the collection is keyed, so the index is built once per array and reused",
      complexity: "O(1)" as const,
      facts: Object.freeze([`keyed: ${identityKey}`, "index cache: enabled"]),
      direction: "asc" as const,
    });
  }

  return Object.freeze({
    strategy: "EarlyExitScan" as const,
    reason: "no declared fact reaches this key directly, so rows are scanned until one matches",
    complexity: "O(k)" as const,
    facts: Object.freeze([]),
    direction: "asc" as const,
  });
}

/**
 * What a keyed access path differs by between callers: its parameter list, how
 * it reads the value being matched, and whether it answers the row or merely
 * whether one exists. Everything else — the index build, the search — is the
 * same code, so it is emitted once and shared.
 */
export interface KeyedEmitShape {
  readonly signature: string;
  readonly probe: string;
  /**
   * `row` and `exists` answer a query. `position` answers a mutation: an
   * immutable replacement needs the slot, not the row, and a missing key still
   * has to say where it would go. It returns the index when the key is present
   * and the bitwise complement of the insertion point when it is not, so both
   * answers travel in one number and neither allocates.
   */
  readonly answers: "row" | "exists" | "position";
}

export function emitCachedIndexLookup(descriptor: IndexDescriptor, shape: KeyedEmitShape): string {
  const writer = new CodeWriter();

  // `__cachedIndex` is supplied the way `__getIndex` already is: bound by the
  // runtime compiler, emitted as a module helper by AOT.
  writer.line("(() => {");
  writer.indent(() => {
    emitIndexBuilder(writer, descriptor, "const build = (value) => {", "};");
    writer.line(`function query(${shape.signature}) {`);
    writer.indent(() => {
      writer.line(
        `const row = __cachedIndex(value, ${JSON.stringify(indexCacheKey(descriptor))}, build).get(${shape.probe});`
      );
      if (shape.answers === "exists") writer.line("return row !== undefined;");
      // An index says nothing about where a missing key belongs, so a miss is
      // an append: the insertion point is the end of the collection.
      else if (shape.answers === "position") writer.line("return row === undefined ? ~value.length : row;");
      else writer.line("return row;");
    });
    writer.line("}");
    writer.line("return query;");
  });
  writer.line("})()");
  return writer.toString();
}

export function emitBinarySearch(
  key: string,
  descriptor: IndexDescriptor,
  direction: "asc" | "desc",
  shape: KeyedEmitShape
): string {
  const access = { key, descriptor, direction };
  const writer = new CodeWriter();
  const probe = shape.probe;
  const read = (row: string) => {
    const value = emitPropertyAccess(row, access.key);
    return access.descriptor.keys[0]?.valueKind === "date" ? `${value}.getTime()` : value;
  };
  // Descending order flips which half the search continues into.
  const goRight = access.direction === "desc" ? "probe > target" : "probe < target";

  writer.line("(() => {");
  writer.indent(() => {
    writer.line(`function query(${shape.signature}) {`);
    writer.indent(() => {
      writer.line(`const target = ${probe};`);
      writer.line("let low = 0;");
      writer.line("let high = value.length - 1;");
      writer.line("while (low <= high) {");
      writer.indent(() => {
        writer.line("const mid = (low + high) >>> 1;");
        writer.line("const row = value[mid];");
        writer.line(`const probe = ${read("row")};`);
        writer.line("if (probe === target) {");
        writer.indent(() =>
          writer.line(
            shape.answers === "exists" ? "return true;" : shape.answers === "position" ? "return mid;" : "return row;"
          )
        );
        writer.line("}");
        writer.line(`if (${goRight}) low = mid + 1;`);
        writer.line("else high = mid - 1;");
      });
      writer.line("}");
      // `low` is where the key belongs, so a miss reports the insertion point
      // rather than only the absence: that is what an ordered upsert needs.
      writer.line(
        shape.answers === "exists"
          ? "return false;"
          : shape.answers === "position"
            ? "return ~low;"
            : "return undefined;"
      );
    });
    writer.line("}");
    writer.line("return query;");
  });
  writer.line("})()");
  return writer.toString();
}

/**
 * Emits a scan that stops at the first match.
 *
 * This is what every strategy falls back to: no declared fact reaches the key,
 * so rows are visited until one matches. It answers a position the same way the
 * other two paths do, which is what lets a mutation change strategy without
 * changing anything else about how it is written.
 */
export function emitEarlyExitScan(key: string, descriptor: IndexDescriptor, shape: KeyedEmitShape): string {
  const writer = new CodeWriter();
  const isDate = descriptor.keys[0]?.valueKind === "date";
  const read = (row: string) => {
    const value = emitPropertyAccess(row, key);
    return isDate ? `${value}.getTime()` : value;
  };

  writer.line("(() => {");
  writer.indent(() => {
    writer.line(`function query(${shape.signature}) {`);
    writer.indent(() => {
      writer.line(`const target = ${shape.probe};`);
      // A position answer needs the length after the loop, to say where a
      // missing key belongs; the other answers keep the compact header.
      if (shape.answers === "position") writer.line("const len = value.length;");
      writer.line(
        shape.answers === "position"
          ? "for (let i = 0; i < len; i++) {"
          : "for (let i = 0, len = value.length; i < len; i++) {"
      );
      writer.indent(() => {
        writer.line("const row = value[i];");
        writer.line(`if (${read("row")} === target) {`);
        writer.indent(() =>
          writer.line(
            shape.answers === "exists" ? "return true;" : shape.answers === "position" ? "return i;" : "return row;"
          )
        );
        writer.line("}");
      });
      writer.line("}");
      writer.line(
        shape.answers === "exists"
          ? "return false;"
          : shape.answers === "position"
            ? "return ~len;"
            : "return undefined;"
      );
    });
    writer.line("}");
    writer.line("return query;");
  });
  writer.line("})()");
  return writer.toString();
}

/** Reads `eq(field, value)` in either operand order; anything else is a scan. */
export function singleKeyEquality(
  condition: QueryConditionNode | undefined
): { readonly key: string; readonly probe: QueryValueNode } | undefined {
  if (condition?.kind !== "compare" || condition.op !== "eq") return undefined;

  const { left, right } = condition;

  if (left.kind === "field" && right.kind !== "field") return { key: left.key, probe: right };
  if (right.kind === "field" && left.kind !== "field") return { key: right.key, probe: left };
  return undefined;
}
