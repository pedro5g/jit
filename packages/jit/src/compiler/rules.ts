import type { QueryCompareOperator, QueryConditionNode, QueryValueNode } from "../core/ast/index.js";
import * as ATS from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { expectProjectionObject } from "./projection.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitObjectKey } from "./source/literal.js";
import {
  emitQueryConditionSource,
  emitQueryValueSource,
  type QueryConditionSourceContext,
} from "./source/query-condition.js";

type RulesObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };

/** One target field of an outcome, resolved to a subject field, an input, or a literal. */
export interface RuleOutcomeField {
  readonly key: string;
  readonly value: QueryValueNode;
}

/**
 * A pure outcome: data built from the subject, the declared inputs and
 * compiler literals. A domain-event target keeps its constructor as an
 * external binding so generated code never inlines a runtime class.
 */
export interface RuleOutcomeDescriptor {
  readonly kind: "object" | "event";
  /** The object shape the rule fills: the target itself, or an event payload. */
  readonly target: ATS.AnyTypeSchema;
  /** The schema of the produced value; the event envelope for `kind: "event"`. */
  readonly type: ATS.AnyTypeSchema;
  readonly fields: readonly RuleOutcomeField[];
  /** Binding name of the domain-event constructor, for `kind: "event"`. */
  readonly binding?: string | undefined;
}

export interface RuleDescriptor {
  readonly id: string;
  readonly condition: QueryConditionNode;
  /** Set when the condition folded to a constant; the rule is then dead or always live. */
  readonly constant: boolean | undefined;
  readonly priority: number;
  readonly order: number;
  readonly subjectPaths: readonly string[];
  readonly inputPaths: readonly string[];
  readonly outcome: RuleOutcomeDescriptor | undefined;
}

export interface RulesDescriptor {
  readonly subject: ATS.AnyTypeSchema;
  readonly inputs?: ATS.AnyTypeSchema | undefined;
  readonly rules: readonly RuleDescriptor[];
  readonly ids: readonly string[];
  readonly outcomes: boolean;
  readonly bindingNames: readonly string[];
  readonly bindings: readonly unknown[];
}

export type RulesSink =
  | "plan"
  | "test"
  | "some"
  | "first"
  | "match"
  | "run"
  | "visitor"
  | "iterator"
  | "many"
  | "many-visitor"
  | "many-iterator"
  | "predicate"
  | "explain";

export interface RulesExplanation {
  readonly matched: readonly string[];
  readonly evaluated: readonly string[];
}

/** Compile-time plan report; never part of an execution path. */
export interface RulesInspection {
  readonly rules: number;
  readonly liveRules: number;
  readonly deadRules: readonly string[];
  readonly subjectPaths: readonly string[];
  readonly inputPaths: readonly string[];
  readonly deadInputs: readonly string[];
  /** Repeated field/input reads hoisted into one local per full evaluation. */
  readonly sharedReads: number;
  readonly sharedPredicates: number;
  readonly priorityGroups: number;
  readonly outcomes: number;
  readonly strategy: "inline";
}

export interface RulesEmitOptions {
  /** Rule id for the `predicate` sink. */
  readonly ruleId?: string | undefined;
  /** Source identifiers replacing outcome bindings, used by AOT co-emission. */
  readonly bindingNames?: ReadonlyMap<string, string> | undefined;
}

type RuleDeclarationOutcome = Omit<RuleOutcomeDescriptor, "fields" | "binding"> & {
  readonly fields: Readonly<Record<string, QueryValueNode>>;
  /** The domain-event constructor, for `kind: "event"`. */
  readonly factory?: unknown;
};

export type RuleDeclaration = {
  readonly id: string;
  readonly condition: QueryConditionNode;
  readonly priority: number;
  readonly outcome?: RuleDeclarationOutcome | undefined;
};

/** Validates and freezes the semantic graph before any sink is compiled. */
export function resolveRulesDescriptor(
  subject: ATS.AnyTypeSchema,
  inputs: ATS.AnyTypeSchema | undefined,
  declarations: readonly RuleDeclaration[]
): RulesDescriptor {
  const subjectObject = expectProjectionObject(subject, "JIT.rules()");
  const inputObject = inputs === undefined ? undefined : expectProjectionObject(inputs, "JIT.rules().inputs()");
  const ids = new Set<string>();
  const rules: RuleDescriptor[] = [];
  const bindingNames: string[] = [];
  const bindings: unknown[] = [];

  for (let order = 0; order < declarations.length; order++) {
    const declaration = declarations[order] as RuleDeclaration;

    if (declaration.id.length === 0) throw new JITError("INVALID_OPERATION", "rule id must not be empty");
    if (ids.has(declaration.id)) {
      throw new JITError("INVALID_OPERATION", `rule id ${JSON.stringify(declaration.id)} is duplicated`);
    }
    if (!Number.isSafeInteger(declaration.priority)) {
      throw new JITError("INVALID_OPERATION", `rule ${JSON.stringify(declaration.id)} priority must be a safe integer`);
    }

    const subjectPaths = new Set<string>();
    const inputPaths = new Set<string>();

    validateCondition(declaration.condition, subjectObject, inputObject, subjectPaths, inputPaths);

    // Folding first means a dead branch never contributes a dependency, so a
    // constant-false rule also removes the facts only it would have read.
    const folded = foldCondition(declaration.condition);
    const constant = typeof folded === "boolean" ? folded : undefined;
    const condition = typeof folded === "boolean" ? TRUE_CONDITION : folded;
    const dependencies = constant === undefined ? { subjectPaths, inputPaths } : collectPaths(condition);
    const outcome =
      declaration.outcome === undefined
        ? undefined
        : resolveOutcome(declaration, subjectObject, inputObject, dependencies, (value) => {
            const existing = bindings.indexOf(value);

            if (existing !== -1) return bindingNames[existing] as string;

            const name = `__ro${bindings.length}`;

            bindings[bindings.length] = value;
            bindingNames[bindingNames.length] = name;
            return name;
          });

    ids.add(declaration.id);
    rules[rules.length] = Object.freeze({
      id: declaration.id,
      condition: freezeCondition(condition),
      constant,
      priority: declaration.priority,
      order,
      subjectPaths: Object.freeze([...dependencies.subjectPaths]),
      inputPaths: Object.freeze([...dependencies.inputPaths]),
      outcome,
    });
  }

  return Object.freeze({
    subject,
    inputs,
    rules: Object.freeze(rules),
    ids: Object.freeze([...ids]),
    outcomes: rules.some((rule) => rule.outcome !== undefined),
    bindingNames: Object.freeze(bindingNames),
    bindings: Object.freeze(bindings),
  });
}

const TRUE_CONDITION: QueryConditionNode = Object.freeze({
  kind: "compare",
  op: "eq",
  left: Object.freeze({ kind: "literal", value: true }),
  right: Object.freeze({ kind: "literal", value: true }),
}) as QueryConditionNode;

interface RuleDependencies {
  readonly subjectPaths: Set<string>;
  readonly inputPaths: Set<string>;
}

function collectPaths(condition: QueryConditionNode): RuleDependencies {
  const subjectPaths = new Set<string>();
  const inputPaths = new Set<string>();
  const walk = (node: QueryConditionNode): void => {
    if (node.kind === "logical") {
      walk(node.left);
      walk(node.right);
      return;
    }
    if (node.kind === "not") {
      walk(node.inner);
      return;
    }
    for (const value of [node.left, node.right]) {
      if (value.kind === "field") subjectPaths.add(value.key);
      else if (value.kind === "param") inputPaths.add(value.name);
    }
  };

  walk(condition);
  return { subjectPaths, inputPaths };
}

function resolveOutcome(
  declaration: RuleDeclaration,
  subject: RulesObjectSchema,
  inputs: RulesObjectSchema | undefined,
  dependencies: RuleDependencies,
  bind: (value: unknown) => string
): RuleOutcomeDescriptor {
  const outcome = declaration.outcome as RuleDeclarationOutcome;
  const shape = expectProjectionObject(outcome.target, `rule ${JSON.stringify(declaration.id)} outcome`);
  const explicit = outcome.fields;

  for (const key of Object.keys(explicit)) {
    if (shape.def.props[key] === undefined) {
      throw new JITError(
        "INVALID_OPERATION",
        `rule ${JSON.stringify(declaration.id)} outcome names unknown target field ${JSON.stringify(key)}`
      );
    }
  }

  const fields: RuleOutcomeField[] = [];

  for (const key of Object.keys(shape.def.props)) {
    const target = shape.def.props[key] as ATS.AnyTypeSchema;
    const value = explicit[key] ?? autoMatchOutcomeValue(key, target, subject, inputs);

    if (value === undefined) {
      if (resolveWrappers(target).optional) continue;
      throw new JITError(
        "INVALID_OPERATION",
        `rule ${JSON.stringify(declaration.id)} outcome cannot fill required target field ${JSON.stringify(key)}`
      );
    }
    if (value.kind === "field") {
      if (subject.def.props[value.key] === undefined) {
        throw new JITError(
          "INVALID_OPERATION",
          `rule ${JSON.stringify(declaration.id)} outcome names unknown subject field ${JSON.stringify(value.key)}`
        );
      }
      dependencies.subjectPaths.add(value.key);
    } else if (value.kind === "param") {
      if (inputs?.def.props[value.name] === undefined) {
        throw new JITError(
          "INVALID_OPERATION",
          `rule ${JSON.stringify(declaration.id)} outcome names unknown input ${JSON.stringify(value.name)}`
        );
      }
      dependencies.inputPaths.add(value.name);
    } else if (value.kind === "binding") {
      throw new JITError("INVALID_OPERATION", "rule outcomes carry compiler literals, subject fields or inputs");
    }
    fields[fields.length] = Object.freeze({ key, value: Object.freeze({ ...value }) });
  }

  return Object.freeze({
    kind: outcome.kind,
    target: outcome.target,
    type: outcome.type,
    fields: Object.freeze(fields),
    binding: outcome.kind === "event" ? bind(outcome.factory) : undefined,
  });
}

/**
 * A target field with no explicit reference resolves by name against the
 * subject, then the inputs; a literal schema field fills itself. Auto-matching
 * keeps declarations short without a second mapping language.
 */
function autoMatchOutcomeValue(
  key: string,
  target: ATS.AnyTypeSchema,
  subject: RulesObjectSchema,
  inputs: RulesObjectSchema | undefined
): QueryValueNode | undefined {
  const base = resolveWrappers(target).base;
  const subjectProp = subject.def.props[key] as ATS.AnyTypeSchema | undefined;

  if (subjectProp !== undefined && compatible(base, subjectProp)) return { kind: "field", key };

  const inputProp = inputs?.def.props[key] as ATS.AnyTypeSchema | undefined;

  if (inputProp !== undefined && compatible(base, inputProp)) return { kind: "param", name: key };
  if (base.type === ATS.TypeName.literal) return { kind: "literal", value: (base.def as ATS.LiteralDef).value };
  return undefined;
}

/** Auto-matching is by name and type; an explicit reference is checked by the type system. */
function compatible(target: ATS.AnyTypeSchema, source: ATS.AnyTypeSchema): boolean {
  return target.type === resolveWrappers(source).base.type;
}

function validateCondition(
  condition: QueryConditionNode,
  subject: RulesObjectSchema,
  inputs: RulesObjectSchema | undefined,
  subjectPaths: Set<string>,
  inputPaths: Set<string>
): void {
  if (condition.kind === "logical") {
    validateCondition(condition.left, subject, inputs, subjectPaths, inputPaths);
    validateCondition(condition.right, subject, inputs, subjectPaths, inputPaths);
    return;
  }
  if (condition.kind === "not") {
    validateCondition(condition.inner, subject, inputs, subjectPaths, inputPaths);
    return;
  }
  validateValue(condition.left, subject, inputs, subjectPaths, inputPaths);
  validateValue(condition.right, subject, inputs, subjectPaths, inputPaths);
}

function validateValue(
  value: QueryValueNode,
  subject: RulesObjectSchema,
  inputs: RulesObjectSchema | undefined,
  subjectPaths: Set<string>,
  inputPaths: Set<string>
): void {
  if (value.kind === "field") {
    if (subject.def.props[value.key] === undefined) {
      throw new JITError(
        "INVALID_OPERATION",
        `rule condition names unknown subject field ${JSON.stringify(value.key)}`
      );
    }
    subjectPaths.add(value.key);
    return;
  }
  if (value.kind === "param") {
    if (inputs?.def.props[value.name] === undefined) {
      throw new JITError("INVALID_OPERATION", `rule condition names unknown input ${JSON.stringify(value.name)}`);
    }
    inputPaths.add(value.name);
    return;
  }
  if (value.kind === "binding") {
    throw new JITError("INVALID_OPERATION", "rules require compiler literals or declared inputs, not runtime bindings");
  }

  const literal = value.value;

  if (
    literal !== null &&
    literal !== undefined &&
    typeof literal !== "string" &&
    typeof literal !== "number" &&
    typeof literal !== "bigint" &&
    typeof literal !== "boolean"
  ) {
    throw new JITError("INVALID_OPERATION", "rule literals must be primitive compiler literals");
  }
}

const COMPARATORS: Readonly<Record<QueryCompareOperator, (left: never, right: never) => boolean>> = Object.freeze({
  eq: (left, right) => left === right,
  neq: (left, right) => left !== right,
  gt: (left, right) => left > right,
  gte: (left, right) => left >= right,
  lt: (left, right) => left < right,
  lte: (left, right) => left <= right,
});

/** Literal-only comparisons and constant logic collapse before any sink is emitted. */
function foldCondition(condition: QueryConditionNode): QueryConditionNode | boolean {
  if (condition.kind === "logical") {
    const left = foldCondition(condition.left);
    const right = foldCondition(condition.right);

    if (condition.op === "and") {
      if (left === false || right === false) return false;
      if (left === true) return right;
      if (right === true) return left;
    } else {
      if (left === true || right === true) return true;
      if (left === false) return right;
      if (right === false) return left;
    }
    return { kind: "logical", op: condition.op, left: left as QueryConditionNode, right: right as QueryConditionNode };
  }
  if (condition.kind === "not") {
    const inner = foldCondition(condition.inner);

    if (typeof inner === "boolean") return !inner;
    // A double negation is the one simplification the public DSL can produce.
    if (inner.kind === "not") return inner.inner;
    return { kind: "not", inner };
  }
  if (condition.left.kind === "literal" && condition.right.kind === "literal") {
    return COMPARATORS[condition.op](condition.left.value as never, condition.right.value as never);
  }
  return condition;
}

function freezeCondition(condition: QueryConditionNode): QueryConditionNode {
  if (condition.kind === "logical") {
    return Object.freeze({
      ...condition,
      left: freezeCondition(condition.left),
      right: freezeCondition(condition.right),
    });
  }
  if (condition.kind === "not") return Object.freeze({ ...condition, inner: freezeCondition(condition.inner) });
  return Object.freeze({
    ...condition,
    left: Object.freeze({ ...condition.left }),
    right: Object.freeze({ ...condition.right }),
  });
}

/* -------------------------------------------------------------------------- */
/* Physical planning                                                          */
/* -------------------------------------------------------------------------- */

const SUBJECT = "subject";
const INPUTS = "inputs";

/** A plan without declared inputs never receives an inputs parameter it cannot read. */
function paramList(descriptor: RulesDescriptor, head: string, tail?: string): string {
  const parts = [head];

  if (descriptor.inputs !== undefined) parts[parts.length] = INPUTS;
  if (tail !== undefined) parts[parts.length] = tail;
  return parts.join(", ");
}

/** Rules that can still match, in evaluation order: priority first, then declaration. */
function orderedRules(descriptor: RulesDescriptor): readonly RuleDescriptor[] {
  const live = descriptor.rules.filter((rule) => rule.constant !== false);

  return [...live].sort((left, right) => right.priority - left.priority || left.order - right.order);
}

interface SharedBinding {
  readonly local: string;
  readonly source: string;
}

/**
 * Shared reads and shared predicates for the sinks that evaluate every rule.
 *
 * Early-exit sinks (`test`, `some`, `first`, `predicate`) never get this: a
 * hoisted read is work the short circuit was allowed to skip. Sinks that must
 * evaluate every rule pay each repeated read and each repeated comparison once
 * instead, and `many` splits them so the input-only half stays outside the loop.
 */
interface SharedPlan {
  readonly reads: ReadonlyMap<string, string>;
  readonly predicates: ReadonlyMap<string, string>;
  readonly invariant: readonly SharedBinding[];
  readonly variant: readonly SharedBinding[];
}

const EMPTY_PLAN: SharedPlan = Object.freeze({
  reads: new Map<string, string>(),
  predicates: new Map<string, string>(),
  invariant: Object.freeze([]),
  variant: Object.freeze([]),
});

function planShared(rules: readonly RuleDescriptor[], loop = false): SharedPlan {
  const leaves: QueryConditionNode[] = [];
  const collect = (node: QueryConditionNode): void => {
    if (node.kind === "logical") {
      collect(node.left);
      collect(node.right);
      return;
    }
    if (node.kind === "not") {
      collect(node.inner);
      return;
    }
    leaves[leaves.length] = node;
  };

  for (const rule of rules) if (rule.constant === undefined) collect(rule.condition);

  const plain: QueryConditionSourceContext = { fieldBase: SUBJECT, paramBase: INPUTS };
  const counts = new Map<string, number>();
  const nodes = new Map<string, QueryConditionNode>();

  for (const leaf of leaves) {
    const key = emitQueryConditionSource(leaf, plain);

    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!nodes.has(key)) nodes.set(key, leaf);
  }

  // Common subexpression elimination: a comparison written by two rules is
  // computed once. Every operand is a property read or a literal, so hoisting
  // it cannot change the result or throw.
  // Inside a `many` loop an input-only comparison is loop invariant, so it is
  // hoisted even when a single rule writes it: the collection pays it once.
  const predicates = new Map<string, string>();
  for (const [key, count] of counts) {
    if (count > 1 || (loop && !readsSubject(nodes.get(key) as QueryConditionNode))) {
      predicates.set(key, `c${predicates.size}`);
    }
  }

  const readCounts = new Map<string, number>();
  const countValue = (value: QueryValueNode): void => {
    const key = value.kind === "field" ? `f:${value.key}` : value.kind === "param" ? `p:${value.name}` : undefined;

    if (key !== undefined) readCounts.set(key, (readCounts.get(key) ?? 0) + 1);
  };
  const countLeaf = (leaf: QueryConditionNode): void => {
    if (leaf.kind !== "compare") return;
    countValue(leaf.left);
    countValue(leaf.right);
  };

  // Only the source that survives CSE decides whether a read repeats.
  for (const leaf of leaves) {
    if (leaf.kind !== "compare") continue;
    if (predicates.has(emitQueryConditionSource(leaf, plain))) continue;
    countLeaf(leaf);
  }
  for (const key of predicates.keys()) countLeaf(nodes.get(key) as QueryConditionNode);
  for (const rule of rules) {
    for (const field of rule.outcome?.fields ?? []) countValue(field.value);
  }

  const reads = new Map<string, string>();
  const invariant: SharedBinding[] = [];
  const variant: SharedBinding[] = [];

  for (const [key, count] of readCounts) {
    const invariantRead = loop && key.startsWith("p:");

    if (count < 2 && !invariantRead) continue;

    const path = key.slice(2);

    if (key.startsWith("f:")) {
      const local = `s${variant.length}`;

      reads.set(key, local);
      variant[variant.length] = { local, source: emitPropertyAccess(SUBJECT, path) };
    } else {
      const local = `p${invariant.length}`;

      reads.set(key, local);
      invariant[invariant.length] = { local, source: emitPropertyAccess(INPUTS, path) };
    }
  }

  const withReads = readContext(reads);

  for (const [key, local] of predicates) {
    const node = nodes.get(key) as QueryConditionNode;
    const binding = { local, source: emitQueryConditionSource(node, withReads) };

    // A comparison over inputs alone is loop invariant, so `many` evaluates it
    // once for the whole collection instead of once per record.
    if (readsSubject(node)) variant[variant.length] = binding;
    else invariant[invariant.length] = binding;
  }

  return {
    reads,
    predicates,
    invariant: Object.freeze(invariant),
    variant: Object.freeze(variant),
  };
}

function readsSubject(node: QueryConditionNode): boolean {
  if (node.kind === "logical") return readsSubject(node.left) || readsSubject(node.right);
  if (node.kind === "not") return readsSubject(node.inner);
  return node.left.kind === "field" || node.right.kind === "field";
}

function readContext(reads: ReadonlyMap<string, string>): QueryConditionSourceContext {
  if (reads.size === 0) return { fieldBase: SUBJECT, paramBase: INPUTS };
  return {
    fieldBase: SUBJECT,
    paramBase: INPUTS,
    fieldAccess: (key) => reads.get(`f:${key}`) ?? emitPropertyAccess(SUBJECT, key),
    paramAccess: (name) => reads.get(`p:${name}`) ?? emitPropertyAccess(INPUTS, name),
  };
}

/* -------------------------------------------------------------------------- */
/* Emission                                                                   */
/* -------------------------------------------------------------------------- */

function emitCondition(rule: RuleDescriptor, plan: SharedPlan): string {
  if (rule.constant !== undefined) return String(rule.constant);
  return emitNode(rule.condition, plan);
}

function emitNode(node: QueryConditionNode, plan: SharedPlan): string {
  if (node.kind === "logical") {
    const operator = node.op === "and" ? "&&" : "||";

    return `(${emitNode(node.left, plan)} ${operator} ${emitNode(node.right, plan)})`;
  }
  if (node.kind === "not") return `!(${emitNode(node.inner, plan)})`;

  const shared = plan.predicates.get(emitQueryConditionSource(node, { fieldBase: SUBJECT, paramBase: INPUTS }));

  return shared ?? emitQueryConditionSource(node, readContext(plan.reads));
}

function emitOutcome(rule: RuleDescriptor, plan: SharedPlan, options: RulesEmitOptions): string {
  const outcome = rule.outcome;

  if (outcome === undefined) return "undefined";

  const context = readContext(plan.reads);
  const fields = outcome.fields
    .map((field) => `${emitObjectKey(field.key)}: ${emitQueryValueSource(field.value, context)}`)
    .join(", ");
  const value = `{ ${fields} }`;

  if (outcome.kind === "object") return value;

  const binding = outcome.binding as string;

  return `${options.bindingNames?.get(binding) ?? binding}.create(${value})`;
}

function emitBindings(writer: CodeWriter, bindings: readonly SharedBinding[]): void {
  for (const binding of bindings) writer.line(`const ${binding.local} = ${binding.source};`);
}

export function emitRulesTestSource(descriptor: RulesDescriptor): string {
  const writer = new CodeWriter();

  writer.line(`function rulesTest(${paramList(descriptor, "rule, subject")}) {`);
  writer.indent(() => {
    writer.line("switch (rule) {");
    writer.indent(() => {
      for (const rule of descriptor.rules) {
        writer.line(`case ${JSON.stringify(rule.id)}:`);
        writer.indent(() => writer.line(`return ${emitCondition(rule, EMPTY_PLAN)};`));
      }
      writer.line("default:");
      writer.indent(() => writer.line("return false;"));
    });
    writer.line("}");
  });
  writer.line("}");
  return writer.toString();
}

export function emitRulesPredicateSource(descriptor: RulesDescriptor, ruleId: string): string {
  const rule = descriptor.rules.find((candidate) => candidate.id === ruleId);

  if (rule === undefined) {
    throw new JITError("INVALID_OPERATION", `unknown rule ${JSON.stringify(ruleId)}`);
  }
  return `function rulesPredicate(${paramList(descriptor, SUBJECT)}) {\n  return ${emitCondition(rule, EMPTY_PLAN)};\n}\n`;
}

export function emitRulesSomeSource(descriptor: RulesDescriptor): string {
  const rules = descriptor.rules.filter((rule) => rule.constant !== false);
  const always = rules.some((rule) => rule.constant === true);
  const expression = always
    ? "true"
    : rules.length === 0
      ? "false"
      : rules.map((rule) => `(${emitCondition(rule, EMPTY_PLAN)})`).join(" || ");

  return `function rulesSome(${paramList(descriptor, SUBJECT)}) {\n  return ${expression};\n}\n`;
}

export function emitRulesFirstSource(descriptor: RulesDescriptor): string {
  const writer = new CodeWriter();

  writer.line(`function rulesFirst(${paramList(descriptor, SUBJECT)}) {`);
  writer.indent(() => {
    for (const rule of orderedRules(descriptor)) {
      if (rule.constant === true) {
        // Nothing below this priority can be reached.
        writer.line(`return ${JSON.stringify(rule.id)};`);
        return;
      }
      writer.line(`if (${emitCondition(rule, EMPTY_PLAN)}) return ${JSON.stringify(rule.id)};`);
    }
    writer.line("return undefined;");
  });
  writer.line("}");
  return writer.toString();
}

export function emitRulesMatchSource(descriptor: RulesDescriptor): string {
  const rules = orderedRules(descriptor);
  const plan = planShared(rules);
  const writer = new CodeWriter();

  writer.line(`function rulesMatch(${paramList(descriptor, SUBJECT)}) {`);
  writer.indent(() => {
    emitBindings(writer, plan.invariant);
    emitBindings(writer, plan.variant);
    writer.line("const out = [];");
    writer.line("let j = 0;");
    for (const rule of rules) {
      const id = JSON.stringify(rule.id);

      if (rule.constant === true) writer.line(`out[j++] = ${id};`);
      else writer.line(`if (${emitCondition(rule, plan)}) out[j++] = ${id};`);
    }
    writer.line("return out;");
  });
  writer.line("}");
  return writer.toString();
}

/** Only rules that emit take part in `run`; a predicate-only rule is dead work here. */
function outcomeRules(descriptor: RulesDescriptor): readonly RuleDescriptor[] {
  return orderedRules(descriptor).filter((rule) => rule.outcome !== undefined);
}

export function emitRulesRunSource(descriptor: RulesDescriptor, options: RulesEmitOptions = {}): string {
  const rules = outcomeRules(descriptor);
  const plan = planShared(rules);
  const writer = new CodeWriter();

  writer.line(`function rulesRun(${paramList(descriptor, SUBJECT)}) {`);
  writer.indent(() => {
    emitBindings(writer, plan.invariant);
    emitBindings(writer, plan.variant);
    writer.line("const out = [];");
    writer.line("let j = 0;");
    for (const rule of rules) {
      const outcome = emitOutcome(rule, plan, options);

      if (rule.constant === true) writer.line(`out[j++] = ${outcome};`);
      else writer.line(`if (${emitCondition(rule, plan)}) out[j++] = ${outcome};`);
    }
    writer.line("return out;");
  });
  writer.line("}");
  return writer.toString();
}

export function emitRulesVisitorSource(descriptor: RulesDescriptor, options: RulesEmitOptions = {}): string {
  const rules = orderedRules(descriptor);
  const plan = planShared(rules);
  const writer = new CodeWriter();

  writer.line(`function rulesVisit(${paramList(descriptor, SUBJECT, "consume")}) {`);
  writer.indent(() => {
    emitBindings(writer, plan.invariant);
    emitBindings(writer, plan.variant);
    writer.line("let n = 0;");
    for (const rule of rules) {
      const call = `n++, consume(${JSON.stringify(rule.id)}, ${emitOutcome(rule, plan, options)});`;

      if (rule.constant === true) writer.line(call);
      else writer.line(`if (${emitCondition(rule, plan)}) ${call}`);
    }
    writer.line("return n;");
  });
  writer.line("}");
  return writer.toString();
}

export function emitRulesIteratorSource(descriptor: RulesDescriptor, options: RulesEmitOptions = {}): string {
  const rules = outcomeRules(descriptor);
  const plan = planShared(rules);
  const writer = new CodeWriter();

  writer.line(`function* rulesIterate(${paramList(descriptor, SUBJECT)}) {`);
  writer.indent(() => {
    emitBindings(writer, plan.invariant);
    emitBindings(writer, plan.variant);
    for (const rule of rules) {
      const outcome = `yield ${emitOutcome(rule, plan, options)};`;

      if (rule.constant === true) writer.line(outcome);
      else writer.line(`if (${emitCondition(rule, plan)}) ${outcome}`);
    }
  });
  writer.line("}");
  return writer.toString();
}

function emitManyBody(
  writer: CodeWriter,
  rules: readonly RuleDescriptor[],
  plan: SharedPlan,
  options: RulesEmitOptions,
  statement: (rule: RuleDescriptor, outcome: string) => string
): void {
  emitBindings(writer, plan.invariant);
  writer.line("const size = list.length;");
  writer.line("for (let i = 0; i < size; i++) {");
  writer.indent(() => {
    writer.line("const subject = list[i];");
    emitBindings(writer, plan.variant);
    for (const rule of rules) {
      const line = statement(rule, emitOutcome(rule, plan, options));

      if (rule.constant === true) writer.line(line);
      else writer.line(`if (${emitCondition(rule, plan)}) ${line}`);
    }
  });
  writer.line("}");
}

export function emitRulesManySource(descriptor: RulesDescriptor, options: RulesEmitOptions = {}): string {
  const rules = outcomeRules(descriptor);
  const plan = planShared(rules, true);
  const writer = new CodeWriter();

  writer.line(`function rulesMany(${paramList(descriptor, "list")}) {`);
  writer.indent(() => {
    writer.line("const out = [];");
    writer.line("let j = 0;");
    emitManyBody(writer, rules, plan, options, (_rule, outcome) => `out[j++] = ${outcome};`);
    writer.line("return out;");
  });
  writer.line("}");
  return writer.toString();
}

export function emitRulesManyVisitorSource(descriptor: RulesDescriptor, options: RulesEmitOptions = {}): string {
  const rules = orderedRules(descriptor);
  const plan = planShared(rules, true);
  const writer = new CodeWriter();

  writer.line(`function rulesManyVisit(${paramList(descriptor, "list", "consume")}) {`);
  writer.indent(() => {
    writer.line("let n = 0;");
    emitManyBody(
      writer,
      rules,
      plan,
      options,
      (rule, outcome) => `n++, consume(${JSON.stringify(rule.id)}, ${outcome}, i);`
    );
    writer.line("return n;");
  });
  writer.line("}");
  return writer.toString();
}

export function emitRulesManyIteratorSource(descriptor: RulesDescriptor, options: RulesEmitOptions = {}): string {
  const rules = outcomeRules(descriptor);
  const plan = planShared(rules, true);
  const writer = new CodeWriter();

  writer.line(`function* rulesManyIterate(${paramList(descriptor, "list")}) {`);
  writer.indent(() => {
    emitManyBody(writer, rules, plan, options, (_rule, outcome) => `yield ${outcome};`);
  });
  writer.line("}");
  return writer.toString();
}

export function emitRulesExplainSource(descriptor: RulesDescriptor): string {
  const rules = orderedRules(descriptor);
  const plan = planShared(rules);
  const writer = new CodeWriter();

  writer.line(`function rulesExplain(${paramList(descriptor, SUBJECT)}) {`);
  writer.indent(() => {
    emitBindings(writer, plan.invariant);
    emitBindings(writer, plan.variant);
    writer.line("const matched = [];");
    writer.line("let j = 0;");
    for (const rule of rules) {
      const id = JSON.stringify(rule.id);

      if (rule.constant === true) writer.line(`matched[j++] = ${id};`);
      else writer.line(`if (${emitCondition(rule, plan)}) matched[j++] = ${id};`);
    }
    writer.line(`return { matched, evaluated: ${JSON.stringify(rules.map((rule) => rule.id))} };`);
  });
  writer.line("}");
  return writer.toString();
}

function emitRulesPlanSource(descriptor: RulesDescriptor, options: RulesEmitOptions): string {
  const writer = new CodeWriter();

  writer.line("(() => {");
  writer.indent(() => {
    for (const source of [
      emitRulesTestSource(descriptor),
      emitRulesSomeSource(descriptor),
      emitRulesFirstSource(descriptor),
      emitRulesMatchSource(descriptor),
      emitRulesRunSource(descriptor, options),
      emitRulesVisitorSource(descriptor, options),
      emitRulesIteratorSource(descriptor, options),
      emitRulesManySource(descriptor, options),
      emitRulesManyVisitorSource(descriptor, options),
      emitRulesManyIteratorSource(descriptor, options),
      emitRulesExplainSource(descriptor),
    ]) {
      for (const line of source.split("\n")) writer.line(line);
    }
    writer.line("const many = Object.assign(rulesMany, {");
    writer.indent(() => {
      writer.line("to: Object.freeze({ visitor: () => rulesManyVisit, iterator: () => rulesManyIterate }),");
    });
    writer.line("});");
    writer.line("const predicates = Object.freeze({");
    writer.indent(() => {
      for (const rule of descriptor.rules) {
        writer.line(`${emitObjectKey(rule.id)}: ${emitRulesPredicateSource(descriptor, rule.id).trim()},`);
      }
    });
    writer.line("});");
    writer.line("return Object.freeze({");
    writer.indent(() => {
      writer.line("test: rulesTest,");
      writer.line("some: rulesSome,");
      writer.line("first: rulesFirst,");
      writer.line("match: rulesMatch,");
      writer.line("run: rulesRun,");
      writer.line("explain: rulesExplain,");
      writer.line("predicate: (rule) => predicates[rule],");
      writer.line("many: () => many,");
      writer.line("to: Object.freeze({ visitor: () => rulesVisit, iterator: () => rulesIterate }),");
      writer.line(`ids: Object.freeze(${JSON.stringify(descriptor.ids)}),`);
    });
    writer.line("});");
  });
  writer.line("})()");
  return writer.toString();
}

export function emitRulesSinkSource(
  descriptor: RulesDescriptor,
  sink: RulesSink,
  options: RulesEmitOptions = {}
): string {
  switch (sink) {
    case "test":
      return emitRulesTestSource(descriptor);
    case "some":
      return emitRulesSomeSource(descriptor);
    case "first":
      return emitRulesFirstSource(descriptor);
    case "match":
      return emitRulesMatchSource(descriptor);
    case "run":
      return emitRulesRunSource(descriptor, options);
    case "visitor":
      return emitRulesVisitorSource(descriptor, options);
    case "iterator":
      return emitRulesIteratorSource(descriptor, options);
    case "many":
      return emitRulesManySource(descriptor, options);
    case "many-visitor":
      return emitRulesManyVisitorSource(descriptor, options);
    case "many-iterator":
      return emitRulesManyIteratorSource(descriptor, options);
    case "explain":
      return emitRulesExplainSource(descriptor);
    case "predicate":
      return emitRulesPredicateSource(descriptor, options.ruleId as string);
    default:
      return emitRulesPlanSource(descriptor, options);
  }
}

export function compileRulesSink<TFunction extends (...args: never[]) => unknown>(
  descriptor: RulesDescriptor,
  sink: Exclude<RulesSink, "plan">,
  options?: CompileCacheOptions & RulesEmitOptions
): TFunction {
  const source = emitRulesSinkSource(descriptor, sink, { ruleId: options?.ruleId });
  // Outcome constructors are user values: cache the pure template and re-apply
  // the bindings, exactly like the mapper and query tiers.
  const template = getCompileCached(
    descriptor.subject,
    `rules:${sink}:${source}`,
    () => ({ source, create: globalThis.Function(...descriptor.bindingNames, `return ${source};`) }),
    options
  );

  return template.create(...descriptor.bindings) as TFunction;
}

/** Compile-time report: what the plan reads, shares and eliminates. */
export function inspectRules(descriptor: RulesDescriptor): RulesInspection {
  const live = orderedRules(descriptor);
  const plan = planShared(live);
  const subjectPaths = new Set<string>();
  const inputPaths = new Set<string>();

  for (const rule of live) {
    for (const path of rule.subjectPaths) subjectPaths.add(path);
    for (const path of rule.inputPaths) inputPaths.add(path);
  }

  const declared =
    descriptor.inputs === undefined
      ? []
      : Object.keys(expectProjectionObject(descriptor.inputs, "JIT.rules().inputs()").def.props);

  return Object.freeze({
    rules: descriptor.rules.length,
    liveRules: live.length,
    deadRules: Object.freeze(descriptor.rules.filter((rule) => rule.constant === false).map((rule) => rule.id)),
    subjectPaths: Object.freeze([...subjectPaths]),
    inputPaths: Object.freeze([...inputPaths]),
    deadInputs: Object.freeze(declared.filter((name) => !inputPaths.has(name))),
    sharedReads: plan.reads.size,
    sharedPredicates: plan.predicates.size,
    priorityGroups: new Set(live.map((rule) => rule.priority)).size,
    outcomes: descriptor.rules.filter((rule) => rule.outcome !== undefined).length,
    strategy: "inline",
  });
}

/* -------------------------------------------------------------------------- */
/* Query lowering                                                             */
/* -------------------------------------------------------------------------- */

export type LoweredRuleCondition =
  | { readonly kind: "always"; readonly bindings: readonly unknown[] }
  | { readonly kind: "never"; readonly bindings: readonly unknown[] }
  | {
      readonly kind: "condition";
      readonly condition: QueryConditionNode;
      readonly bindings: readonly unknown[];
    };

/**
 * Lowers one rule into a plain query condition.
 *
 * Declared inputs are resolved to their concrete values and travel as query
 * bindings, so `~query` and every external adapter see an ordinary predicate:
 * no rule, fact or outcome node crosses that boundary.
 */
export function lowerRuleToQueryCondition(
  descriptor: RulesDescriptor,
  ruleId: string,
  inputs: unknown,
  bindingOffset: number
): LoweredRuleCondition {
  const rule = descriptor.rules.find((candidate) => candidate.id === ruleId);

  if (rule === undefined) throw new JITError("INVALID_OPERATION", `unknown rule ${JSON.stringify(ruleId)}`);
  if (rule.constant !== undefined) {
    return Object.freeze({ kind: rule.constant ? "always" : "never", bindings: Object.freeze([]) });
  }

  const values: unknown[] = [];
  const condition = bindInputs(
    rule.condition,
    inputs as Readonly<Record<string, unknown>> | undefined,
    bindingOffset,
    values
  );

  return Object.freeze({ kind: "condition", condition, bindings: Object.freeze(values) });
}

function bindInputs(
  condition: QueryConditionNode,
  inputs: Readonly<Record<string, unknown>> | undefined,
  offset: number,
  bindings: unknown[]
): QueryConditionNode {
  if (condition.kind === "logical") {
    return {
      ...condition,
      left: bindInputs(condition.left, inputs, offset, bindings),
      right: bindInputs(condition.right, inputs, offset, bindings),
    };
  }
  if (condition.kind === "not") return { ...condition, inner: bindInputs(condition.inner, inputs, offset, bindings) };
  return {
    ...condition,
    left: bindInputValue(condition.left, inputs, offset, bindings),
    right: bindInputValue(condition.right, inputs, offset, bindings),
  };
}

function bindInputValue(
  value: QueryValueNode,
  inputs: Readonly<Record<string, unknown>> | undefined,
  offset: number,
  bindings: unknown[]
): QueryValueNode {
  if (value.kind !== "param") return value;

  const name = `__q${offset + bindings.length}`;

  bindings[bindings.length] = inputs?.[value.name];
  return { kind: "binding", name };
}
