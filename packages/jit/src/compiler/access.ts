import type { QueryConditionNode, QueryValueNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { AccessDeniedError, JITError } from "../errors/index.js";
import { getArtifact, registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { expectProjectionObject } from "./projection.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitQueryConditionSource } from "./source/query-condition.js";

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
  readonly metadata?: { readonly id?: string; readonly reason?: string } | undefined;
}

export interface AccessDescriptor {
  readonly subject: ATS.AnyTypeSchema;
  readonly actor?: ATS.AnyTypeSchema | undefined;
  readonly rules: readonly AccessRule[];
  /** Every action any rule mentions, in first-seen order. */
  readonly actions: readonly string[];
  readonly actionPlans: readonly AccessActionPlan[];
}

export interface AccessActionPlan {
  readonly action: string;
  readonly allow: readonly AccessRule[];
  readonly deny: readonly AccessRule[];
  readonly subjectPaths: readonly string[];
  readonly actorPaths: readonly string[];
}

export interface AccessAbilityContext {
  readonly descriptor: AccessDescriptor;
  readonly actor: unknown;
}

export interface LoweredAccessCondition {
  readonly kind: "allow" | "deny" | "condition";
  readonly condition?: QueryConditionNode;
  readonly bindings: readonly unknown[];
}

/** The same answer before actor values are bound; `param` nodes are intact. */
export interface ComposedAccessCondition {
  readonly kind: "allow" | "deny" | "condition";
  readonly condition?: QueryConditionNode;
}

const ACCESS_ABILITIES = new WeakMap<object, AccessAbilityContext>();

export function registerAccessAbility(ability: object, descriptor: AccessDescriptor, actor: unknown): void {
  ACCESS_ABILITIES.set(ability, Object.freeze({ descriptor, actor }));
}

export function getAccessAbility(ability: object): AccessAbilityContext | undefined {
  return ACCESS_ABILITIES.get(ability);
}

export function resolveAccessContext(value: object, actor?: unknown): AccessAbilityContext | undefined {
  const ability = getAccessAbility(value);
  if (ability !== undefined) return ability;
  const artifact = getArtifact(value);
  return artifact?.kind === "access-plan" ? Object.freeze({ descriptor: artifact.descriptor, actor }) : undefined;
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

  const normalized = rules.map((rule) =>
    rule.fields === undefined ? rule : Object.freeze({ ...rule, fields: Object.freeze([...new Set(rule.fields)]) })
  );

  const actionPlans = actions.map((action) => {
    const allow = foldDominatedRules(normalized.filter((rule) => rule.effect === "can" && rule.action === action));
    const deny = foldDominatedRules(normalized.filter((rule) => rule.effect === "cannot" && rule.action === action));
    const subjectPaths = new Set<string>();
    const actorPaths = new Set<string>();
    for (const rule of [...allow, ...deny]) collectConditionPaths(rule.condition, subjectPaths, actorPaths);
    return Object.freeze({
      action,
      allow: Object.freeze(allow),
      deny: Object.freeze(deny),
      subjectPaths: Object.freeze([...subjectPaths]),
      actorPaths: Object.freeze([...actorPaths]),
    });
  });

  return Object.freeze({
    subject,
    actor,
    rules: Object.freeze(normalized),
    actions: Object.freeze(actions),
    actionPlans: Object.freeze(actionPlans),
  });
}

function foldDominatedRules(rules: readonly AccessRule[]): AccessRule[] {
  const unconditional = rules.find((rule) => rule.condition === undefined && rule.fields === undefined);
  return unconditional === undefined ? [...rules] : [unconditional];
}

function collectConditionPaths(
  condition: QueryConditionNode | undefined,
  subject: Set<string>,
  actor: Set<string>
): void {
  if (condition === undefined) return;
  if (condition.kind === "logical") {
    collectConditionPaths(condition.left, subject, actor);
    collectConditionPaths(condition.right, subject, actor);
    return;
  }
  if (condition.kind === "not") {
    collectConditionPaths(condition.inner, subject, actor);
    return;
  }
  for (const value of [condition.left, condition.right]) {
    if (value.kind === "field") subject.add(value.key);
    else if (value.kind === "param") actor.add(value.name);
  }
}

function actionPlan(descriptor: AccessDescriptor, action: string): AccessActionPlan | undefined {
  return descriptor.actionPlans.find((plan) => plan.action === action);
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
    writer.line("function explain(action, subject, field) {");
    writer.indent(() => {
      writer.line("switch (action) {");
      writer.indent(() => {
        for (const action of descriptor.actions) emitExplainCase(writer, descriptor, action);
        writer.line("default:");
        writer.indent(() => writer.line('return { allowed: false, reason: "default-deny" };'));
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line("function assert(action, subject, field) {");
    writer.indent(() => {
      writer.line("if (can(action, subject, field)) return subject;");
      writer.line("const detail = explain(action, subject, field);");
      writer.line("throw new __AccessDeniedError(action, field, detail.reason, detail.ruleId);");
    });
    writer.line("}");
    writer.line("function fields(action, subject) {");
    writer.indent(() => {
      writer.line("if (subject === undefined) {");
      writer.indent(() => {
        writer.line("switch (action) {");
        writer.indent(() => {
          const object = expectProjectionObject(descriptor.subject, "JIT.access()");
          const allFields = Object.keys(object.def.props);
          for (const action of descriptor.actions) {
            const fields = unconditionalFields(descriptor, action) ?? allFields;
            writer.line(`case ${JSON.stringify(action)}:`);
            writer.indent(() => writer.line(`return ${JSON.stringify(fields)};`));
          }
          writer.line("default:");
          writer.indent(() => writer.line("return [];"));
        });
        writer.line("}");
      });
      writer.line("}");
      writer.line("const out = [];");
      writer.line("let j = 0;");
      const object = expectProjectionObject(descriptor.subject, "JIT.access()");
      for (const field of Object.keys(object.def.props)) {
        writer.line(`if (can(action, subject, ${JSON.stringify(field)})) out[j++] = ${JSON.stringify(field)};`);
      }
      writer.line("return out;");
    });
    writer.line("}");
    // Diagnostics and field materialization remain off the boolean hot path.
    writer.line(
      "return { can: can, cannot: (action, subject, field) => !can(action, subject, field), assert: assert, explain: explain, fields: fields };"
    );
  });
  writer.line("}");
  return writer.toString();
}

function emitExplainCase(writer: CodeWriter, descriptor: AccessDescriptor, action: string): void {
  const plan = actionPlan(descriptor, action);
  const cans = plan?.allow ?? [];
  const cannots = plan?.deny ?? [];

  writer.line(`case ${JSON.stringify(action)}:`);
  writer.indent(() => {
    for (const rule of cannots) {
      writer.line(`if (${emitRule(rule, "cannot")}) return ${diagnosticLiteral(rule)};`);
    }
    for (const rule of cans) {
      writer.line(`if (${emitRule(rule, "can")}) return { allowed: true };`);
    }
    writer.line('return { allowed: false, reason: "default-deny" };');
  });
}

function diagnosticLiteral(rule: AccessRule): string {
  const entries = ["allowed: false"];
  entries.push(`reason: ${JSON.stringify(rule.metadata?.reason ?? "denied-by-rule")}`);
  if (rule.metadata?.id !== undefined) entries.push(`ruleId: ${JSON.stringify(rule.metadata.id)}`);
  entries.push("matchedProhibition: true");
  return `{ ${entries.join(", ")} }`;
}

/**
 * What one action reduces to.
 *
 * A `cannot` overrides a `can` that matched the same action and field, so the
 * shape is always "some permission matched, and no prohibition did".
 */
function emitAction(descriptor: AccessDescriptor, action: string): string {
  return emitAccessActionExpression(descriptor, action, "subject", "field", "actor");
}

/** Emits one already-specialized action check for composition with another plan. */
export function emitAccessActionExpression(
  descriptor: AccessDescriptor,
  action: string,
  subject: string,
  field: string,
  actor: string
): string {
  const plan = actionPlan(descriptor, action);
  const cans = plan?.allow ?? [];
  const cannots = plan?.deny ?? [];

  if (cans.length === 0) return "false";

  const allowed = joinOr(cans.map((rule) => emitRuleAt(rule, "can", subject, field, actor)));

  if (cannots.length === 0) return allowed;

  const denied = joinOr(cannots.map((rule) => emitRuleAt(rule, "cannot", subject, field, actor)));

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
  return emitRuleAt(rule, effect, "subject", "field", "actor");
}

function emitRuleAt(rule: AccessRule, effect: "can" | "cannot", subject: string, field: string, actor: string): string {
  const condition = rule.condition === undefined ? "true" : emitConditionAt(rule.condition, subject, actor);

  if (rule.fields === undefined) return condition;

  const names = rule.fields.map((name) => `${field} === ${JSON.stringify(name)}`).join(" || ");
  const guard = effect === "can" ? `(${field} === undefined || ${names})` : `(${field} !== undefined && (${names}))`;

  return condition === "true" ? guard : `${guard} && (${condition})`;
}

function emitConditionAt(condition: QueryConditionNode, subject: string, actor: string): string {
  return emitQueryConditionSource(condition, { fieldBase: subject, paramBase: actor });
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
      return { source, create: globalThis.Function("__AccessDeniedError", `return ${source};`) };
    },
    options
  );
  const compiled = template.create(AccessDeniedError) as (actor: TActor) => TAbility;

  registerArtifact(compiled as object, { kind: "access-plan", schema: descriptor.subject, descriptor });
  return compiled;
}

/** Lowers an actor-bound action to an ordinary query predicate. */
/**
 * Composes the row predicate one action authorizes, before any actor exists.
 *
 * A public query boundary compiles against the plan and binds the actor per
 * request, so composition and binding are separate steps of the same lowering
 * rather than two implementations of the same rules.
 */
export function composeAccessCondition(descriptor: AccessDescriptor, action: string): ComposedAccessCondition {
  const plan = actionPlan(descriptor, action);
  const cans = plan?.allow ?? [];
  // A field-only prohibition must not reject the complete row. This is the
  // same unfocused-check rule used by `can(action, subject)`.
  const cannots = (plan?.deny ?? []).filter((rule) => rule.fields === undefined);

  if (cans.length === 0 || cannots.some((rule) => rule.condition === undefined)) {
    return Object.freeze({ kind: "deny" });
  }

  const allowConditions = cans.map((rule) => rule.condition);
  const denyConditions = cannots.map((rule) => rule.condition).filter(isCondition);
  const allowAlways = allowConditions.some((condition) => condition === undefined);

  if (allowAlways && denyConditions.length === 0) return Object.freeze({ kind: "allow" });

  let semantic = allowAlways ? truth(true) : joinConditions("or", allowConditions.filter(isCondition));
  if (denyConditions.length > 0) {
    semantic = {
      kind: "logical",
      op: "and",
      left: semantic,
      right: { kind: "not", inner: joinConditions("or", denyConditions) },
    };
  }
  return Object.freeze({ kind: "condition", condition: semantic });
}

export function lowerAccessToQueryCondition(
  context: AccessAbilityContext,
  action: string,
  bindingOffset: number
): LoweredAccessCondition {
  const composed = composeAccessCondition(context.descriptor, action);
  if (composed.condition === undefined) return Object.freeze({ kind: composed.kind, bindings: Object.freeze([]) });

  const values: unknown[] = [];
  const condition = bindActorRefs(composed.condition, context.actor, bindingOffset, values);
  return Object.freeze({ kind: "condition", condition, bindings: Object.freeze(values) });
}

/** Compiles a top-level mutation guard with one static branch per schema field. */
export function compileAccessMutationGuard(
  context: AccessAbilityContext,
  action: string
): (subject: unknown, patch: unknown) => void {
  const source = emitAccessMutationGuardSource(context.descriptor, action);
  return globalThis.Function("actor", "__AccessDeniedError", `return ${source};`)(context.actor, AccessDeniedError) as (
    subject: unknown,
    patch: unknown
  ) => void;
}

export function emitAccessMutationGuardSource(descriptor: AccessDescriptor, action: string): string {
  const object = expectProjectionObject(descriptor.subject, "authorized mutation");
  const writer = new CodeWriter();
  writer.line("function authorizeMutation(subject, patch) {");
  writer.indent(() => {
    for (const field of Object.keys(object.def.props)) {
      const patchValue = emitPropertyAccess("patch", field);
      const check = emitAccessActionExpression(descriptor, action, "subject", JSON.stringify(field), "actor");
      if (check === "true") continue;
      const denied = `throw new __AccessDeniedError(${JSON.stringify(action)}, ${JSON.stringify(field)}, "field-denied")`;
      writer.line(`if (${patchValue} !== undefined${check === "false" ? "" : ` && !(${check})`}) ${denied};`);
    }
  });
  writer.line("}");
  return writer.toString();
}

function isCondition(value: QueryConditionNode | undefined): value is QueryConditionNode {
  return value !== undefined;
}

function joinConditions(op: "and" | "or", values: readonly QueryConditionNode[]): QueryConditionNode {
  if (values.length === 0) return truth(op === "and");
  let result = values[0] as QueryConditionNode;
  for (let index = 1; index < values.length; index++) {
    result = { kind: "logical", op, left: result, right: values[index] as QueryConditionNode };
  }
  return result;
}

function truth(value: boolean): QueryConditionNode {
  return {
    kind: "compare",
    op: "eq",
    left: { kind: "literal", value: true },
    right: { kind: "literal", value },
  };
}

function bindActorRefs(
  condition: QueryConditionNode,
  actor: unknown,
  bindingOffset: number,
  bindings: unknown[]
): QueryConditionNode {
  if (condition.kind === "logical") {
    return {
      ...condition,
      left: bindActorRefs(condition.left, actor, bindingOffset, bindings),
      right: bindActorRefs(condition.right, actor, bindingOffset, bindings),
    };
  }
  if (condition.kind === "not") {
    return { ...condition, inner: bindActorRefs(condition.inner, actor, bindingOffset, bindings) };
  }
  return {
    ...condition,
    left: bindActorValue(condition.left, actor, bindingOffset, bindings),
    right: bindActorValue(condition.right, actor, bindingOffset, bindings),
  };
}

function bindActorValue(
  value: QueryValueNode,
  actor: unknown,
  bindingOffset: number,
  bindings: unknown[]
): QueryValueNode {
  if (value.kind !== "param") return value;
  const record = actor as Readonly<Record<string, unknown>> | null | undefined;
  const name = `__q${bindingOffset + bindings.length}`;
  bindings.push(record?.[value.name]);
  return { kind: "binding", name };
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

/**
 * Fields safe to expose from every row that passes the action predicate.
 * Conditional prohibitions are removed conservatively; a later subject-aware
 * projection may add a conditionally allowed field back without leaking it.
 */
export function accessProjectionFields(descriptor: AccessDescriptor, action: string): readonly string[] | undefined {
  const plan = actionPlan(descriptor, action);
  if (plan === undefined || plan.allow.length === 0) return [];
  const object = expectProjectionObject(descriptor.subject, "authorized query projection");
  const all = Object.keys(object.def.props);
  const allowed = new Set(
    all.filter(
      (field) =>
        plan.allow.some(
          (rule) => rule.condition === undefined && (rule.fields === undefined || rule.fields.includes(field))
        ) || plan.allow.every((rule) => rule.fields === undefined || rule.fields.includes(field))
    )
  );

  for (const rule of plan.deny) {
    // Subject-wide denials are already part of the row predicate, so no
    // returned row matches them. Field-scoped denials are intentionally absent
    // from that predicate and therefore constrain the projection here.
    if (rule.fields === undefined) continue;
    for (const field of rule.fields) allowed.delete(field);
  }

  return allowed.size === all.length ? undefined : all.filter((field) => allowed.has(field));
}
