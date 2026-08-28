import type { QueryConditionNode, QueryValueNode } from "../../core/ast/index.js";
import { emitPropertyAccess } from "./access.js";
import { emitLiteral } from "./literal.js";

export interface QueryConditionSourceContext {
  readonly fieldBase: string;
  readonly paramBase: string;
  readonly fieldAccess?: ((key: string) => string) | undefined;
  readonly paramAccess?: ((name: string) => string) | undefined;
}

/** Emits the shared query-condition AST against two concrete value roots. */
export function emitQueryConditionSource(condition: QueryConditionNode, context: QueryConditionSourceContext): string {
  if (condition.kind === "logical") {
    const operator = condition.op === "and" ? "&&" : "||";
    const left = emitQueryConditionSource(condition.left, context);
    const right = emitQueryConditionSource(condition.right, context);

    return `(${left} ${operator} ${right})`;
  }
  if (condition.kind === "not") return `!(${emitQueryConditionSource(condition.inner, context)})`;

  const operators = { eq: "===", neq: "!==", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;

  return `${emitQueryValueSource(condition.left, context)} ${operators[condition.op]} ${emitQueryValueSource(condition.right, context)}`;
}

/** Emits one query value: a field read, a parameter read, a literal or a binding. */
export function emitQueryValueSource(value: QueryValueNode, context: QueryConditionSourceContext): string {
  if (value.kind === "field")
    return context.fieldAccess?.(value.key) ?? emitPropertyAccess(context.fieldBase, value.key);
  if (value.kind === "param")
    return context.paramAccess?.(value.name) ?? emitPropertyAccess(context.paramBase, value.name);
  if (value.kind === "literal") return emitLiteral(value.value as never);
  return value.name;
}
