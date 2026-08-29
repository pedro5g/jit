import type { QueryConditionNode, QueryValueNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import {
  emitBinarySearch,
  emitCachedIndexLookup,
  type KeyedEmitShape,
  resolveKeyedAccessChoice,
} from "./access-path.js";
import { type IndexDescriptor, resolveIndexDescriptor } from "./indexing.js";
import type { OptimizedQueryPlan, QueryTarget } from "./query.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitLiteral } from "./source/literal.js";

// The access path is shared with lookup, reconcile and collection mutation;
// re-exported here so existing importers keep their entry point.
export {
  emitBinarySearch,
  emitCachedIndexLookup,
  emitEarlyExitScan,
  type KeyedAccessChoice,
  type KeyedEmitShape,
  resolveKeyedAccessChoice,
} from "./access-path.js";

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
