import type { QueryConditionNode, QueryValueNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { resolveHints } from "../core/hints/index.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { emitIndexBuilder, type IndexDescriptor, indexCacheKey, resolveIndexDescriptor } from "./indexing.js";
import type { OptimizedQueryPlan, QueryTarget } from "./query.js";
import { resolveHintKey } from "./resolvers/resolve-hints.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitLiteral } from "./source/literal.js";

/**
 * How a query is physically executed. The semantic plan says what is wanted;
 * this says how the rows are reached. It is private: `~query` never carries a
 * physical node, because the standard describes a request, not a strategy.
 */
export type PhysicalQueryStrategy = "Scan" | "EarlyExitScan" | "CachedIndexLookup" | "BinarySearch";

/** The reviewable part of a physical plan, as reported by `explain()`. */
export interface PhysicalQueryExplain {
  readonly strategy: PhysicalQueryStrategy;
  /** Why this strategy was chosen, in terms a reader can check. */
  readonly reason: string;
  /** Expected cost in the size of the input. */
  readonly complexity: "O(1)" | "O(log n)" | "O(k)" | "O(n)";
  /** Collection facts the choice rested on. */
  readonly facts: readonly string[];
}

export interface PhysicalQueryPlan extends PhysicalQueryExplain {
  /** Set when the strategy reaches rows through a key. Never made public. */
  readonly access?: KeyedAccess;
}

/**
 * Strips the access path before the plan leaves the compiler. `explain()` is a
 * reviewing surface, not a way to read query AST nodes back out.
 */
export function describePhysicalQueryPlan(plan: PhysicalQueryPlan): PhysicalQueryExplain {
  return Object.freeze({
    strategy: plan.strategy,
    reason: plan.reason,
    complexity: plan.complexity,
    facts: plan.facts,
  });
}

interface KeyedAccess {
  readonly key: string;
  readonly direction: "asc" | "desc";
  readonly descriptor: IndexDescriptor;
  /** Source of the value the key is matched against. */
  readonly probe: QueryValueNode;
  readonly terminal: "first" | "some";
}

/**
 * Chooses the access path for a plan. Only an equality terminal can be lifted
 * off a scan today: `first` and `some` are the shapes where reaching one row
 * directly answers the whole query.
 */
export function resolvePhysicalQueryPlan(
  schema: ATS.AnyTypeSchema,
  target: QueryTarget,
  plan: OptimizedQueryPlan
): PhysicalQueryPlan {
  const terminal = plan.terminal;

  if (!terminal) {
    return Object.freeze({
      strategy: "Scan" as const,
      reason: "the result is a collection, so every row has to be visited",
      complexity: "O(n)" as const,
      facts: Object.freeze([]),
    });
  }

  const scan = Object.freeze({
    strategy: "EarlyExitScan" as const,
    reason: `${terminal.op} returns as soon as the answer is known`,
    complexity: "O(k)" as const,
    facts: Object.freeze([]),
  });

  // An index reaches one row by key. `findIndex` wants a position and `every`
  // has to see every row, so neither can be answered that way.
  if (terminal.op !== "first" && terminal.op !== "some") return scan;
  if (target.kind !== "array") return scan;
  if (plan.filters.length !== 1) return scan;

  const equality = singleEquality(plan.filters[0]?.condition);

  if (!equality) return scan;

  const choice = resolveKeyedAccessChoice(schema, equality.key);

  if (choice.strategy === "EarlyExitScan") return scan;
  return Object.freeze({
    strategy: choice.strategy,
    reason: choice.reason,
    complexity: choice.complexity,
    facts: choice.facts,
    access: keyedAccess(schema, equality, choice.direction, terminal.op),
  });
}

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

function keyedAccess(
  schema: ATS.AnyTypeSchema,
  equality: { readonly key: string; readonly probe: QueryValueNode },
  direction: "asc" | "desc",
  terminal: "first" | "some"
): KeyedAccess {
  return Object.freeze({
    key: equality.key,
    direction,
    descriptor: resolveIndexDescriptor(schema, [equality.key], "unique"),
    probe: equality.probe,
    terminal,
  });
}

/** Reads `eq(field, value)` in either operand order; anything else is a scan. */
function singleEquality(
  condition: QueryConditionNode | undefined
): { readonly key: string; readonly probe: QueryValueNode } | undefined {
  if (condition?.kind !== "compare" || condition.op !== "eq") return undefined;

  const { left, right } = condition;

  if (left.kind === "field" && right.kind !== "field") return { key: left.key, probe: right };
  if (right.kind === "field" && left.kind !== "field") return { key: right.key, probe: left };
  return undefined;
}

/**
 * Emits the query for a keyed access path. These shapes do not go through the
 * loop IR at all: there is no loop to build.
 */
export function emitPhysicalQuerySource(physical: PhysicalQueryPlan, hasParams: boolean): string | undefined {
  const access = physical.access;

  if (!access) return undefined;

  const shape: KeyedEmitShape = {
    signature: hasParams ? "value, params" : "value",
    probe: emitProbe(access),
    answers: access.terminal === "some" ? "exists" : "row",
  };

  if (physical.strategy === "CachedIndexLookup") return emitCachedIndexLookup(access.descriptor, shape);
  if (physical.strategy === "BinarySearch")
    return emitBinarySearch(access.key, access.descriptor, access.direction, shape);
  return undefined;
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
  readonly answers: "row" | "exists";
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
      writer.line(shape.answers === "exists" ? "return row !== undefined;" : "return row;");
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
        writer.indent(() => writer.line(shape.answers === "exists" ? "return true;" : "return row;"));
        writer.line("}");
        writer.line(`if (${goRight}) low = mid + 1;`);
        writer.line("else high = mid - 1;");
      });
      writer.line("}");
      writer.line(shape.answers === "exists" ? "return false;" : "return undefined;");
    });
    writer.line("}");
    writer.line("return query;");
  });
  writer.line("})()");
  return writer.toString();
}

function emitProbe(access: KeyedAccess): string {
  const probe = access.probe;
  // `singleEquality` rejects a field on both sides, so the probe is never one.
  const value =
    probe.kind === "literal"
      ? emitLiteral(probe.value as never)
      : probe.kind === "param"
        ? emitPropertyAccess("params", probe.name)
        : probe.kind === "binding"
          ? probe.name
          : emitPropertyAccess("row", probe.key);

  // The index stores date keys as timestamps, so the probe has to match.
  return access.descriptor.keys[0]?.valueKind === "date" && probe.kind !== "literal"
    ? `(${value} == null ? ${value} : ${value}.getTime())`
    : value;
}
