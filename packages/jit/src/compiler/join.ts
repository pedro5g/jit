import type { QueryConditionNode, QueryJoinKind, QueryValueNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { resolveHints } from "../core/hints/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { getCachedIndex } from "../runtime/index/index-cache.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { emitIndexBuilder, type IndexDescriptor, indexCacheKey, resolveIndexDescriptor } from "./indexing.js";
import type { QueryProgram } from "./query.js";
import { resolveHintKey } from "./resolvers/resolve-hints.js";
import { resolveRowField, resolveRowObjectSchema, resolveScalarKeyDomain } from "./row-keys.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitLiteral } from "./source/literal.js";

export type JoinPhysicalStrategy = "IndexedJoin" | "HashJoin" | "MergeJoin";

export interface JoinPlan {
  readonly kind: QueryJoinKind;
  readonly leftSchema: ATS.AnyTypeSchema;
  readonly rightSchema: ATS.AnyTypeSchema;
  readonly leftKey: string;
  readonly rightKey: string;
  readonly leftIndex: IndexDescriptor;
  readonly rightIndex: IndexDescriptor;
  readonly direction: "asc" | "desc";
  readonly strategy: JoinPhysicalStrategy;
  readonly reason: string;
  readonly complexity: "O(n + m + k)" | "O(n + k) expected after cached build";
  readonly leftProgram: QueryProgram;
}

export interface JoinExplain {
  readonly strategy: JoinPhysicalStrategy;
  readonly reason: string;
  readonly complexity: JoinPlan["complexity"];
  readonly facts: readonly string[];
}

export type JoinPair<TLeft, TRight> = { readonly left: TLeft; readonly right: TRight };
export type LeftJoinPair<TLeft, TRight> = { readonly left: TLeft; readonly right: TRight | undefined };

export type CompiledJoin<TLeft, TRight, TResult, TParams extends Readonly<Record<string, unknown>>> = (
  left: readonly TLeft[],
  right: readonly TRight[],
  params?: TParams
) => TResult;

export function createJoinPlan(
  leftSchema: ATS.AnyTypeSchema,
  rightSchema: ATS.AnyTypeSchema,
  leftProgram: QueryProgram,
  kind: QueryJoinKind,
  leftKey: string,
  rightKey: string
): JoinPlan {
  assertJoinPrefix(leftProgram);
  const leftIndex = resolveIndexDescriptor(leftSchema, [leftKey], "unique");
  const hints = resolveHints(rightSchema);
  const leftHints = resolveHints(leftSchema);
  const leftOrdered = leftHints.order ?? leftHints.collection?.ordered;
  const rightOrdered = hints.order ?? hints.collection?.ordered;
  const leftOrderedKey = resolveHintKey(leftOrdered?.key);
  const rightOrderedKey = resolveHintKey(rightOrdered?.key);
  const leftDirection = leftOrdered?.direction === "desc" ? "desc" : "asc";
  const rightDirection = rightOrdered?.direction === "desc" ? "desc" : "asc";
  const keyed = hints.entity?.cacheIndex === true;
  const declaredKey = resolveHintKey(hints.index?.key) ?? resolveHintKey(hints.entity?.key);
  const merge = leftOrderedKey === leftKey && rightOrderedKey === rightKey && leftDirection === rightDirection;
  const strategy: JoinPhysicalStrategy = merge
    ? "MergeJoin"
    : keyed && declaredKey === rightKey
      ? "IndexedJoin"
      : "HashJoin";
  const rightUnique = hints.collection?.unique === true || hints.entity?.key !== undefined;
  const rightIndex = resolveIndexDescriptor(
    rightSchema,
    [rightKey],
    kind === "semi" || kind === "anti" || rightUnique ? "unique" : "grouped"
  );

  const leftDomain = resolveScalarKeyDomain(
    resolveRowField(resolveRowObjectSchema(leftSchema, "join"), leftKey, "join"),
    leftKey,
    "join"
  );
  const rightDomain = resolveScalarKeyDomain(
    resolveRowField(resolveRowObjectSchema(rightSchema, "join"), rightKey, "join"),
    rightKey,
    "join"
  );
  if (leftDomain !== rightDomain) {
    throw new JITError("INVALID_QUERY", "join keys must have compatible scalar representations", {
      path: [leftKey, rightKey],
    });
  }

  return Object.freeze({
    kind,
    leftSchema,
    rightSchema,
    leftKey,
    rightKey,
    leftIndex,
    rightIndex,
    direction: merge ? leftDirection : "asc",
    strategy,
    reason:
      strategy === "MergeJoin"
        ? "both collections declare compatible ordering on the join keys"
        : strategy === "IndexedJoin"
          ? "the right collection declares a reusable keyed index"
          : "the right side is hashed once before scanning the left side",
    complexity: strategy === "IndexedJoin" ? "O(n + k) expected after cached build" : "O(n + m + k)",
    leftProgram,
  });
}

export function explainJoinPlan(plan: JoinPlan): JoinExplain {
  return Object.freeze({
    strategy: plan.strategy,
    reason: plan.reason,
    complexity: plan.complexity,
    facts: Object.freeze([
      `join: ${plan.kind}`,
      `keys: ${plan.leftKey} = ${plan.rightKey}`,
      ...(plan.strategy === "IndexedJoin" ? ["right index cache: enabled"] : []),
      ...(plan.strategy === "MergeJoin" ? [`ordered: ${plan.direction}`] : []),
    ]),
  });
}

export function emitJoinSource(plan: JoinPlan): string {
  const writer = new CodeWriter();
  const hasParams = Boolean(plan.leftProgram.params?.length);
  const grouped = plan.rightIndex.shape === "grouped";

  writer.line("(() => {");
  writer.indent(() => {
    if (plan.strategy === "IndexedJoin") {
      emitIndexBuilder(writer, plan.rightIndex, "const build = (value) => {", "};");
    }
    writer.line(`function join(left, right${hasParams ? ", params" : ""}) {`);
    writer.indent(() => {
      if (plan.strategy === "MergeJoin") {
        emitMergeJoin(writer, plan);
        return;
      }
      if (plan.strategy === "IndexedJoin") {
        writer.line(`const index = __cachedIndex(right, ${JSON.stringify(indexCacheKey(plan.rightIndex))}, build);`);
      } else {
        emitIndexBuilder(writer, plan.rightIndex, "const index = ((value) => {", "})(right);");
      }
      writer.line("const len = left.length;");
      writer.line("const out = new Array(len);");
      writer.line("let k = 0;");
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        writer.line("const leftRow = left[i];");
        const guard = emitLeftGuard(plan.leftProgram, "leftRow");
        if (guard) {
          writer.line(`if (!(${guard})) continue;`);
        }
        const key = plan.rightIndex.keys[0];
        const leftKey = plan.leftIndex.keys[0];
        if (!key || !leftKey) throw new JITError("INVALID_QUERY", "join requires scalar keys");
        const leftRead = emitPropertyAccess("leftRow", plan.leftKey);
        const probe =
          leftKey.valueKind === "date"
            ? leftKey.nullish
              ? `(${leftRead} == null ? ${leftRead} : ${leftRead}.getTime())`
              : `${leftRead}.getTime()`
            : leftRead;
        writer.line(`const match = index.get(${probe});`);
        emitJoinResult(writer, plan.kind, grouped);
      });
      writer.line("}");
      writer.line("out.length = k;");
      writer.line("return out;");
    });
    writer.line("}");
    writer.line("return join;");
  });
  writer.line("})()");
  return writer.toString();
}

function emitMergeJoin(writer: CodeWriter, plan: JoinPlan): void {
  const rightKey = plan.rightIndex.keys[0];
  const leftKeyDescriptor = plan.leftIndex.keys[0];
  if (!rightKey || !leftKeyDescriptor) throw new JITError("INVALID_QUERY", "merge join requires scalar keys");
  const readKey = (row: string, key: string, descriptor: (typeof plan.rightIndex.keys)[number]) => {
    const access = emitPropertyAccess(row, key);
    if (descriptor.valueKind !== "date") return access;
    return descriptor.nullish ? `(${access} == null ? ${access} : ${access}.getTime())` : `${access}.getTime()`;
  };
  const leftBefore = plan.direction === "asc" ? "leftKey < rightKey" : "leftKey > rightKey";
  const leftAfter = plan.direction === "asc" ? "leftKey > rightKey" : "leftKey < rightKey";
  const guard = emitLeftGuard(plan.leftProgram, "leftRow");
  const emitUnmatched = () => {
    if (plan.kind === "left") writer.line("out[k++] = { left: leftRow, right: undefined };");
    else if (plan.kind === "anti") writer.line("out[k++] = leftRow;");
  };

  writer.line("const leftLen = left.length;");
  writer.line("const rightLen = right.length;");
  writer.line("const out = new Array(leftLen);");
  writer.line("let i = 0;");
  writer.line("let j = 0;");
  writer.line("let k = 0;");
  writer.line("while (i < leftLen && j < rightLen) {");
  writer.indent(() => {
    writer.line("const leftRow = left[i];");
    writer.line(`const leftKey = ${readKey("leftRow", plan.leftKey, leftKeyDescriptor)};`);
    writer.line(`const rightKey = ${readKey("right[j]", plan.rightKey, rightKey)};`);
    writer.line(`if (${leftBefore}) {`);
    writer.indent(() => {
      if (guard) writer.line(`if (${guard}) {`);
      if (guard) writer.indent(emitUnmatched);
      else emitUnmatched();
      if (guard) writer.line("}");
      writer.line("i++;");
      writer.line("continue;");
    });
    writer.line("}");
    writer.line(`if (${leftAfter}) { j++; continue; }`);
    writer.line("let rightEnd = j + 1;");
    writer.line(
      `while (rightEnd < rightLen && ${readKey("right[rightEnd]", plan.rightKey, rightKey)} === rightKey) rightEnd++;`
    );
    writer.line("do {");
    writer.indent(() => {
      writer.line("const leftRow = left[i];");
      if (guard) writer.line(`if (${guard}) {`);
      if (guard) writer.indent(() => emitMergeMatch(writer, plan.kind));
      else emitMergeMatch(writer, plan.kind);
      if (guard) writer.line("}");
      writer.line("i++;");
    });
    writer.line(`} while (i < leftLen && ${readKey("left[i]", plan.leftKey, leftKeyDescriptor)} === leftKey);`);
    writer.line("j = rightEnd;");
  });
  writer.line("}");
  if (plan.kind === "left" || plan.kind === "anti") {
    writer.line("while (i < leftLen) {");
    writer.indent(() => {
      writer.line("const leftRow = left[i++];");
      if (guard) writer.line(`if (!(${guard})) continue;`);
      emitUnmatched();
    });
    writer.line("}");
  }
  writer.line("out.length = k;");
  writer.line("return out;");
}

function emitMergeMatch(writer: CodeWriter, kind: QueryJoinKind): void {
  if (kind === "semi") {
    writer.line("out[k++] = leftRow;");
    return;
  }
  if (kind === "anti") return;
  writer.line("for (let q = j; q < rightEnd; q++) out[k++] = { left: leftRow, right: right[q] };");
}

function emitJoinResult(writer: CodeWriter, kind: QueryJoinKind, grouped: boolean): void {
  if (kind === "semi") {
    writer.line("if (match !== undefined) out[k++] = leftRow;");
    return;
  }
  if (kind === "anti") {
    writer.line("if (match === undefined) out[k++] = leftRow;");
    return;
  }
  if (!grouped) {
    if (kind === "inner") writer.line("if (match !== undefined) out[k++] = { left: leftRow, right: match };");
    else writer.line("out[k++] = { left: leftRow, right: match };");
    return;
  }

  writer.line("if (match === undefined) {");
  writer.indent(() => {
    if (kind === "left") writer.line("out[k++] = { left: leftRow, right: undefined };");
  });
  writer.line("} else {");
  writer.indent(() => {
    writer.line("const matchLen = match.length;");
    writer.line("for (let j = 0; j < matchLen; j++) out[k++] = { left: leftRow, right: match[j] };");
  });
  writer.line("}");
}

function assertJoinPrefix(program: QueryProgram): void {
  for (const node of program.nodes) {
    if (node.kind !== "filter") {
      throw new JITError(
        "INVALID_QUERY",
        "join v1 accepts params and where/filter before join; shape, ordering, terminal and mutation stages must follow a future fused plan"
      );
    }
  }
}

function emitLeftGuard(program: QueryProgram, row: string): string | undefined {
  const filters = program.nodes.filter((node) => node.kind === "filter");
  if (filters.length === 0) return undefined;
  return filters.map((filter) => `(${emitCondition(filter.condition, row)})`).join(" && ");
}

function emitCondition(condition: QueryConditionNode, row: string): string {
  if (condition.kind === "logical") {
    const operator = condition.op === "and" ? "&&" : "||";
    return `(${emitCondition(condition.left, row)} ${operator} ${emitCondition(condition.right, row)})`;
  }
  if (condition.kind === "not") return `!(${emitCondition(condition.inner, row)})`;
  const operators = { eq: "===", neq: "!==", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;
  return `${emitValue(condition.left, row)} ${operators[condition.op]} ${emitValue(condition.right, row)}`;
}

function emitValue(value: QueryValueNode, row: string): string {
  if (value.kind === "field") return emitPropertyAccess(row, value.key);
  if (value.kind === "literal") return emitLiteral(value.value as never);
  if (value.kind === "param") return emitPropertyAccess("params", value.name);
  return value.name;
}

export function compileJoin<TLeft, TRight, TResult, TParams extends Readonly<Record<string, unknown>>>(
  plan: JoinPlan,
  options?: CompileCacheOptions
): CompiledJoin<TLeft, TRight, TResult, TParams> {
  const names = plan.leftProgram.bindings.map((_, index) => `__q${index}`);
  const key = `join:${plan.kind}:${plan.leftKey}:${plan.rightKey}:${plan.strategy}:${plan.direction}:${indexCacheKey(plan.leftIndex)}:${indexCacheKey(plan.rightIndex)}:${JSON.stringify(plan.leftProgram.nodes)}:${plan.leftProgram.params?.join(",") ?? ""}`;
  const template = getCompileCached(
    plan.leftSchema,
    key,
    () => {
      const source = emitJoinSource(plan);
      return { source, create: globalThis.Function("__cachedIndex", ...names, `return ${source};`) };
    },
    options
  );
  const compiled = template.create(getCachedIndex, ...plan.leftProgram.bindings) as CompiledJoin<
    TLeft,
    TRight,
    TResult,
    TParams
  >;

  registerArtifact(compiled, { kind: "join-plan", plan });
  return compiled;
}
