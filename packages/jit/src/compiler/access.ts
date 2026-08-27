import type { QueryConditionNode, QueryValueNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { expectProjectionObject } from "./projection.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitLiteral } from "./source/literal.js";

/**
 * One authorization rule.
 *
 * The condition is an ordinary query condition, so the actor reference is a
 * `param` node and the subject's fields are `field` nodes — the same AST the
 * query compiler already emits, rather than a second expression language.
 */
export interface AccessRule {
  readonly effect: "can" | "cannot";
  readonly action: string;
  readonly condition?: QueryConditionNode | undefined;
  /** When present, the rule speaks only about these fields of the subject. */
  readonly fields?: readonly string[] | undefined;
}

export interface AccessDescriptor {
  readonly subject: ATS.AnyTypeSchema;
  readonly actor?: ATS.AnyTypeSchema | undefined;
  readonly rules: readonly AccessRule[];
  /** Every action any rule mentions, in first-seen order. */
  readonly actions: readonly string[];
}

export function resolveAccessDescriptor(
  subject: ATS.AnyTypeSchema,
  actor: ATS.AnyTypeSchema | undefined,
  rules: readonly AccessRule[]
): AccessDescriptor {
  const object = expectProjectionObject(subject, "JIT.access()");
  const actions: string[] = [];

  for (const rule of rules) {
    if (!actions.includes(rule.action)) actions.push(rule.action);
    for (const field of rule.fields ?? []) {
      if (object.def.props[field] === undefined) {
        throw new JITError(
          "UNSUPPORTED_SCHEMA",
          `JIT.access() names field "${field}", which the subject does not declare`
        );
      }
    }
  }

  return Object.freeze({ subject, actor, rules: Object.freeze([...rules]), actions: Object.freeze(actions) });
}

/**
 * Emits the ability.
 *
 * Actions are known at declaration time, so the check is a switch over string
 * literals rather than a scan of a rule array. Each case is the boolean the
 * rules for that action reduce to; an action nobody mentioned is not a case at
 * all, and falls through to the default deny.
 */
export function emitAccessSource(descriptor: AccessDescriptor): string {
  const writer = new CodeWriter();

  writer.line("function ability(actor) {");
  writer.indent(() => {
    writer.line("function can(action, subject, field) {");
    writer.indent(() => {
      writer.line("switch (action) {");
      writer.indent(() => {
        for (const action of descriptor.actions) {
          writer.line(`case ${JSON.stringify(action)}:`);
          writer.indent(() => writer.line(`return ${emitAction(descriptor, action)};`));
        }
        // Default deny: an action with no rule is refused, not permitted.
        writer.line("default:");
        writer.indent(() => writer.line("return false;"));
      });
      writer.line("}");
    });
    writer.line("}");
    // `cannot` is the negation, not a second rule scan: asking it the other way
    // round would be a second place for the precedence to be got wrong.
    writer.line("return { can: can, cannot: (action, subject, field) => !can(action, subject, field) };");
  });
  writer.line("}");
  return writer.toString();
}

/**
 * What one action reduces to.
 *
 * A `cannot` overrides a `can` that matched the same action and field, so the
 * shape is always "some permission matched, and no prohibition did".
 */
function emitAction(descriptor: AccessDescriptor, action: string): string {
  const cans = descriptor.rules.filter((rule) => rule.effect === "can" && rule.action === action);
  const cannots = descriptor.rules.filter((rule) => rule.effect === "cannot" && rule.action === action);

  if (cans.length === 0) return "false";

  const allowed = joinOr(cans.map((rule) => emitRule(rule, "can")));

  if (cannots.length === 0) return allowed;

  const denied = joinOr(cannots.map((rule) => emitRule(rule, "cannot")));

  if (allowed === "true") return `!(${denied})`;
  return `(${allowed}) && !(${denied})`;
}

function joinOr(parts: readonly string[]): string {
  if (parts.includes("true")) return "true";

  const meaningful = parts.filter((part) => part !== "false");

  if (meaningful.length === 0) return "false";
  return meaningful.length === 1 ? (meaningful[0] as string) : meaningful.map((part) => `(${part})`).join(" || ");
}

/**
 * One rule, as a boolean.
 *
 * The field guard differs by effect on purpose. A permission scoped to some
 * fields still answers "may I do this at all", so an unfocused check passes it.
 * A prohibition scoped to some fields must not block the whole action, so an
 * unfocused check skips it — you may still update the fields it says nothing about.
 */
function emitRule(rule: AccessRule, effect: "can" | "cannot"): string {
  const condition = rule.condition === undefined ? "true" : emitCondition(rule.condition);

  if (rule.fields === undefined) return condition;

  const names = rule.fields.map((field) => `field === ${JSON.stringify(field)}`).join(" || ");
  const guard = effect === "can" ? `(field === undefined || ${names})` : `(field !== undefined && (${names}))`;

  return condition === "true" ? guard : `${guard} && (${condition})`;
}

function emitCondition(condition: QueryConditionNode): string {
  if (condition.kind === "logical") {
    const operator = condition.op === "and" ? "&&" : "||";

    return `(${emitCondition(condition.left)} ${operator} ${emitCondition(condition.right)})`;
  }
  if (condition.kind === "not") return `!(${emitCondition(condition.inner)})`;

  const operators = { eq: "===", neq: "!==", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;

  return `${emitValue(condition.left)} ${operators[condition.op]} ${emitValue(condition.right)}`;
}

/** A `param` node is the actor; a `field` node is the subject. */
function emitValue(value: QueryValueNode): string {
  if (value.kind === "field") return emitPropertyAccess("subject", value.key);
  if (value.kind === "literal") return emitLiteral(value.value as never);
  if (value.kind === "param") return emitPropertyAccess("actor", value.name);
  return value.name;
}

export function accessCacheKey(descriptor: AccessDescriptor): string {
  return `access:${JSON.stringify(descriptor.rules)}`;
}

export function compileAccess<TActor, TAbility>(
  descriptor: AccessDescriptor,
  options?: CompileCacheOptions
): (actor: TActor) => TAbility {
  const template = getCompileCached(
    descriptor.subject,
    accessCacheKey(descriptor),
    () => {
      const source = emitAccessSource(descriptor);
      return { source, create: globalThis.Function(`return ${source};`) };
    },
    options
  );
  const compiled = template.create() as (actor: TActor) => TAbility;

  registerArtifact(compiled as object, { kind: "access-plan", schema: descriptor.subject, descriptor });
  return compiled;
}

/**
 * The fields an action may touch, or `undefined` when it may touch all of them.
 *
 * A read permission answers this without a subject when its rules are
 * unconditional, which is what lets a query intersect it with a projection
 * before materializing anything.
 */
export function unconditionalFields(descriptor: AccessDescriptor, action: string): readonly string[] | undefined {
  const cans = descriptor.rules.filter(
    (rule) => rule.effect === "can" && rule.action === action && rule.condition === undefined
  );

  if (cans.length === 0) return [];
  if (cans.some((rule) => rule.fields === undefined)) {
    // One unrestricted permission makes the field list the whole subject.
    const denied = descriptor.rules.filter(
      (rule) => rule.effect === "cannot" && rule.action === action && rule.condition === undefined
    );

    if (denied.length === 0) return undefined;

    const object = expectProjectionObject(descriptor.subject, "JIT.access()");
    const blocked = new Set(denied.flatMap((rule) => rule.fields ?? Object.keys(object.def.props)));

    return Object.keys(object.def.props).filter((field) => !blocked.has(field));
  }

  const allowed = new Set(cans.flatMap((rule) => rule.fields ?? []));

  for (const rule of descriptor.rules) {
    if (rule.effect !== "cannot" || rule.action !== action || rule.condition !== undefined) continue;
    for (const field of rule.fields ?? allowed) allowed.delete(field);
  }
  return [...allowed];
}
