import {
  compileRulesSink,
  inspectRules,
  type RuleDeclaration,
  type RulesDescriptor,
  type RulesExplanation,
  type RulesInspection,
  type RulesSink,
  resolveRulesDescriptor,
} from "../compiler/rules.js";
import type { QueryCompareNode, QueryCompareOperator, QueryConditionNode, QueryValueNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { getArtifact, registerArtifact } from "../runtime/artifact-registry.js";
import { object } from "./object/object.js";

type Field<TValue> = Extract<keyof TValue, string>;
type InputShape = Readonly<Record<string, SchemaInput>>;
type TypeofInputShape<TShape extends InputShape> = {
  readonly [TKey in keyof TShape]: TShape[TKey] extends SchemaInput<infer TSchema> ? ATS.TypeofSchema<TSchema> : never;
};
type InputArgs<TInputs> = keyof TInputs extends never ? readonly [] : readonly [inputs: TInputs];
type NoInputs = Readonly<Record<never, never>>;

export interface RuleInputValue<TValue> {
  readonly kind: "param";
  readonly name: string;
  readonly __value?: TValue;
}

export interface RuleFieldValue<TValue> {
  readonly kind: "field";
  readonly key: string;
  readonly __value?: TValue;
}

export interface RuleInputRef<TInputs> {
  field<TKey extends Field<TInputs>>(key: TKey): RuleInputValue<TInputs[TKey]>;
}

export interface RuleSubjectRef<TSubject> {
  field<TKey extends Field<TSubject>>(key: TKey): RuleFieldValue<TSubject[TKey]>;
}

type RuleOperand<TValue> = TValue | RuleInputValue<TValue>;

/** Query-compatible conditions over subject fields and declared typed inputs. */
export interface RuleConditionBuilder<TSubject> {
  eq<TKey extends Field<TSubject>>(left: TKey, right: RuleOperand<TSubject[TKey]>): QueryCompareNode;
  eq<TValue>(left: RuleInputValue<TValue>, right: RuleOperand<TValue>): QueryCompareNode;
  neq<TKey extends Field<TSubject>>(left: TKey, right: RuleOperand<TSubject[TKey]>): QueryCompareNode;
  neq<TValue>(left: RuleInputValue<TValue>, right: RuleOperand<TValue>): QueryCompareNode;
  gt<TKey extends Field<TSubject>>(left: TKey, right: RuleOperand<TSubject[TKey]>): QueryCompareNode;
  gt<TValue>(left: RuleInputValue<TValue>, right: RuleOperand<TValue>): QueryCompareNode;
  gte<TKey extends Field<TSubject>>(left: TKey, right: RuleOperand<TSubject[TKey]>): QueryCompareNode;
  gte<TValue>(left: RuleInputValue<TValue>, right: RuleOperand<TValue>): QueryCompareNode;
  lt<TKey extends Field<TSubject>>(left: TKey, right: RuleOperand<TSubject[TKey]>): QueryCompareNode;
  lt<TValue>(left: RuleInputValue<TValue>, right: RuleOperand<TValue>): QueryCompareNode;
  lte<TKey extends Field<TSubject>>(left: TKey, right: RuleOperand<TSubject[TKey]>): QueryCompareNode;
  lte<TValue>(left: RuleInputValue<TValue>, right: RuleOperand<TValue>): QueryCompareNode;
  and(left: QueryConditionNode, right: QueryConditionNode, ...rest: readonly QueryConditionNode[]): QueryConditionNode;
  or(left: QueryConditionNode, right: QueryConditionNode, ...rest: readonly QueryConditionNode[]): QueryConditionNode;
  not(inner: QueryConditionNode): QueryConditionNode;
}

/** The value a rule emits: a domain event instance, or the target schema type. */
export type RuleOutcomeOf<TEmit> = TEmit extends { create(input: never): infer TResult }
  ? TResult
  : TEmit extends SchemaInput<infer TSchema>
    ? ATS.TypeofSchema<TSchema>
    : never;

/** The object shape a rule fills: an event payload, or the target itself. */
type RuleEmitPayload<TEmit> = TEmit extends { create(input: infer TInput): unknown }
  ? TInput
  : TEmit extends SchemaInput<infer TSchema>
    ? ATS.TypeofSchema<TSchema>
    : never;

type RuleOutcomeValues<TPayload> = {
  readonly [TKey in keyof TPayload]?: RuleFieldValue<TPayload[TKey]> | RuleInputValue<TPayload[TKey]> | TPayload[TKey];
};

export interface RuleOptions<TSubject, TInputs, TEmit> {
  readonly priority?: number;
  readonly when: (query: RuleConditionBuilder<TSubject>, inputs: RuleInputRef<TInputs>) => QueryConditionNode;
  /** A schema or domain event the rule produces as pure data. */
  readonly emit?: TEmit;
  /** Fills target fields that do not resolve by name from the subject or inputs. */
  readonly values?: (
    subject: RuleSubjectRef<TSubject>,
    inputs: RuleInputRef<TInputs>
  ) => RuleOutcomeValues<RuleEmitPayload<TEmit>>;
}

/** A single rule condition, reusable as a query predicate. */
export type RulePredicate<TSubject, TInputs> = (subject: TSubject, ...args: InputArgs<TInputs>) => boolean;

export type RulesVisitor<TRuleId extends string, TOutcome> = (rule: TRuleId, outcome: TOutcome | undefined) => void;

export type RulesManyVisitor<TRuleId extends string, TOutcome> = (
  rule: TRuleId,
  outcome: TOutcome | undefined,
  index: number
) => void;

/** Collection specialization: one generated loop over every record. */
export interface RulesManyPlan<TInputs, TRuleId extends string, TOutcome, TSubject> {
  (subjects: readonly TSubject[], ...args: InputArgs<TInputs>): TOutcome[];
  readonly to: {
    visitor(): (
      subjects: readonly TSubject[],
      ...args: [...InputArgs<TInputs>, consume: RulesManyVisitor<TRuleId, TOutcome>]
    ) => number;
    iterator(): (subjects: readonly TSubject[], ...args: InputArgs<TInputs>) => IterableIterator<TOutcome>;
  };
}

export interface RulesExplained<TRuleId extends string> {
  readonly matched: readonly TRuleId[];
  readonly evaluated: readonly TRuleId[];
}

export interface RulesPlan<
  TSubject,
  TInputs extends Readonly<Record<string, unknown>>,
  TRuleId extends string,
  TOutcome,
> {
  inputs<const TShape extends InputShape>(
    shape: TShape
  ): RulesPlan<TSubject, TypeofInputShape<TShape>, TRuleId, TOutcome>;
  rule<const TId extends string, TEmit = undefined>(
    id: TId & (TId extends TRuleId ? never : unknown),
    options: RuleOptions<TSubject, TInputs, TEmit>
  ): RulesPlan<TSubject, TInputs, TRuleId | TId, TOutcome | RuleOutcomeOf<TEmit>>;
  /** One rule, one specialized predicate; no other rule is evaluated. */
  test(rule: TRuleId, subject: TSubject, ...args: InputArgs<TInputs>): boolean;
  /** True at the first match; nothing is materialized. */
  some(subject: TSubject, ...args: InputArgs<TInputs>): boolean;
  /** The highest-priority match, testing in priority order and returning early. */
  first(subject: TSubject, ...args: InputArgs<TInputs>): TRuleId | undefined;
  /** Every matched rule id, in priority order. */
  match(subject: TSubject, ...args: InputArgs<TInputs>): TRuleId[];
  /** The outcomes of every matched rule that emits. */
  run(subject: TSubject, ...args: InputArgs<TInputs>): TOutcome[];
  /** Diagnostics; compiled separately so the execution sinks stay clean. */
  explain(subject: TSubject, ...args: InputArgs<TInputs>): RulesExplained<TRuleId>;
  /** One rule lowered to a reusable predicate, consumable by `JIT.cqrs`. */
  predicate(rule: TRuleId): RulePredicate<TSubject, TInputs>;
  /** The same decisions over a collection, in one generated loop. */
  many(): RulesManyPlan<TInputs, TRuleId, TOutcome, TSubject>;
  readonly to: {
    visitor(): (
      subject: TSubject,
      ...args: [...InputArgs<TInputs>, consume: RulesVisitor<TRuleId, TOutcome>]
    ) => number;
    iterator(): (subject: TSubject, ...args: InputArgs<TInputs>) => IterableIterator<TOutcome>;
  };
  readonly ids: readonly TRuleId[];
  /** The compile plan: dependencies, shared predicates and eliminated work. */
  inspect(): RulesInspection;
}

export interface RulesBuilder<TSubject> extends RulesPlan<TSubject, NoInputs, never, never> {}

/**
 * Declares a pure, statically compiled decision graph.
 *
 * Conditions reuse the query AST, inputs are declared schemas, and rule ids
 * stay literal, so every execution sink lowers to direct comparisons over
 * known fields instead of a rule/fact/operator runtime.
 */
export function rules<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RulesBuilder<ATS.TypeofSchema<TSchema>> {
  return createRulesPlan(unwrapSchema(schema), undefined, []) as unknown as RulesBuilder<ATS.TypeofSchema<TSchema>>;
}

type AnyRulesPlan = RulesPlan<unknown, Readonly<Record<string, unknown>>, string, unknown>;
type AnyRuleOptions = RuleOptions<unknown, Readonly<Record<string, unknown>>, unknown>;
type Sink = (...args: never[]) => unknown;

function createRulesPlan(
  subject: ATS.AnyTypeSchema,
  inputs: ATS.AnyTypeSchema | undefined,
  declarations: readonly RuleDeclaration[]
): AnyRulesPlan {
  const descriptor = resolveRulesDescriptor(subject, inputs, declarations);
  // Sinks compile on first use: declaring a plan never pays for a result mode
  // the application does not call.
  const lazy = <TSink extends Sink>(sink: Parameters<typeof compileRulesSink>[1], ruleId?: string): TSink => {
    let compiled: TSink | undefined;

    return ((...args: never[]) => {
      compiled ??= compileRulesSink<TSink>(descriptor, sink, ruleId === undefined ? undefined : { ruleId });
      return compiled(...args);
    }) as TSink;
  };

  const test = lazy("test");
  const some = lazy("some");
  const first = lazy("first");
  const match = lazy("match");
  const run = lazy("run");
  const explain = lazy("explain");
  const predicates = new Map<string, Sink>();
  const visitor = memoize(() => compileSink(descriptor, "visitor"));
  const iterator = memoize(() => compileSink(descriptor, "iterator"));
  const many = memoize(() => createManyPlan(descriptor));
  const plan = {} as AnyRulesPlan;

  Object.defineProperties(plan, {
    inputs: {
      value: (shape: InputShape) => {
        if (inputs !== undefined) {
          throw new JITError("INVALID_OPERATION", "JIT.rules().inputs() may only be declared once");
        }
        return createRulesPlan(subject, unwrapSchema(object(shape)), declarations);
      },
    },
    rule: {
      value: (id: string, options: AnyRuleOptions) =>
        createRulesPlan(subject, inputs, [...declarations, toDeclaration(id, options)]),
    },
    test: { value: test },
    some: { value: some },
    first: { value: first },
    match: { value: match },
    run: { value: run },
    explain: { value: explain },
    predicate: {
      value: (rule: string) => {
        let compiled = predicates.get(rule);

        if (compiled === undefined) {
          compiled = lazy("predicate", rule);
          registerArtifact(compiled, {
            kind: "rules-plan",
            schema: subject,
            descriptor,
            sink: "predicate",
            ruleId: rule,
          });
          predicates.set(rule, compiled);
        }
        return compiled;
      },
    },
    many: { value: many },
    to: { value: Object.freeze({ visitor, iterator }) },
    ids: { value: descriptor.ids, enumerable: true },
    inspect: { value: () => inspectRules(descriptor) },
  });
  Object.freeze(plan);

  registerArtifact(plan, { kind: "rules-plan", schema: subject, descriptor, sink: "plan" });
  registerArtifact(test, { kind: "rules-plan", schema: subject, descriptor, sink: "test" });
  registerArtifact(some, { kind: "rules-plan", schema: subject, descriptor, sink: "some" });
  registerArtifact(first, { kind: "rules-plan", schema: subject, descriptor, sink: "first" });
  registerArtifact(match, { kind: "rules-plan", schema: subject, descriptor, sink: "match" });
  registerArtifact(run, { kind: "rules-plan", schema: subject, descriptor, sink: "run" });
  registerArtifact(explain, { kind: "rules-plan", schema: subject, descriptor, sink: "explain" });
  return plan;
}

/** Compiles one sink and keeps it reconstructive for the AOT generator. */
function compileSink(descriptor: RulesDescriptor, sink: Exclude<RulesSink, "plan">, ruleId?: string): Sink {
  const compiled = compileRulesSink<Sink>(descriptor, sink, ruleId === undefined ? undefined : { ruleId });

  registerArtifact(compiled, {
    kind: "rules-plan",
    schema: descriptor.subject,
    descriptor,
    sink,
    ...(ruleId === undefined ? {} : { ruleId }),
  });
  return compiled;
}

function createManyPlan(descriptor: RulesDescriptor): Sink {
  let compiled: Sink | undefined;
  const callable = ((...args: never[]) => {
    compiled ??= compileRulesSink<Sink>(descriptor, "many");
    return compiled(...args);
  }) as Sink & { to?: unknown };
  const visitor = memoize(() => compileSink(descriptor, "many-visitor"));
  const iterator = memoize(() => compileSink(descriptor, "many-iterator"));

  Object.defineProperty(callable, "to", { value: Object.freeze({ visitor, iterator }) });
  registerArtifact(callable, { kind: "rules-plan", schema: descriptor.subject, descriptor, sink: "many" });
  return callable;
}

function memoize<TValue>(build: () => TValue): () => TValue {
  let value: TValue | undefined;

  return () => (value ??= build());
}

function toDeclaration(id: string, options: AnyRuleOptions): RuleDeclaration {
  const condition = options.when(CONDITION, INPUTS);
  const priority = options.priority ?? 0;

  if (options.emit === undefined) {
    if (options.values !== undefined) {
      throw new JITError("INVALID_OPERATION", `rule ${JSON.stringify(id)} declares values without emit`);
    }
    return { id, condition, priority };
  }

  const values = (options.values?.(SUBJECT_REF, INPUTS) ?? {}) as Readonly<Record<string, unknown>>;
  const fields: Record<string, QueryValueNode> = {};

  for (const key of Object.keys(values)) fields[key] = toOutcomeValue(values[key]);

  const event = resolveEventTarget(options.emit);

  if (event !== undefined) {
    return { id, condition, priority, outcome: { ...event, fields, factory: options.emit } };
  }

  const target = unwrapSchema(options.emit as SchemaInput);

  return { id, condition, priority, outcome: { kind: "object", target, type: target, fields } };
}

/** A domain event fills its payload; the produced value is the whole envelope. */
function resolveEventTarget(
  emit: unknown
): { readonly kind: "event"; readonly target: ATS.AnyTypeSchema; readonly type: ATS.AnyTypeSchema } | undefined {
  if (typeof emit !== "function") return undefined;

  const artifact = getArtifact(emit);

  if (artifact?.kind !== "class" || artifact.domainEvent === undefined) return undefined;

  const schema = artifact.schema as ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };
  const payload = schema.def.props.payload as ATS.AnyTypeSchema | undefined;

  if (payload === undefined) {
    throw new JITError("INVALID_OPERATION", "domain event outcome requires a payload schema");
  }
  return { kind: "event", target: payload, type: schema };
}

function toOutcomeValue(value: unknown): QueryValueNode {
  if (isInputValue(value)) return { kind: "param", name: value.name };
  if (isFieldValue(value)) return { kind: "field", key: value.key };
  return { kind: "literal", value };
}

function toValue(value: unknown, subjectField: boolean): QueryValueNode {
  if (isInputValue(value)) return { kind: "param", name: value.name };
  if (subjectField) return { kind: "field", key: value as string };
  return { kind: "literal", value };
}

function compare(op: QueryCompareOperator, left: unknown, right: unknown): QueryCompareNode {
  return {
    kind: "compare",
    op,
    left: toValue(left, !isInputValue(left)),
    right: toValue(right, false),
  };
}

function fold(
  op: "and" | "or",
  left: QueryConditionNode,
  right: QueryConditionNode,
  rest: readonly QueryConditionNode[]
): QueryConditionNode {
  const tail = rest.length === 0 ? right : fold(op, right, rest[0] as QueryConditionNode, rest.slice(1));

  return { kind: "logical", op, left, right: tail };
}

const CONDITION = Object.freeze({
  eq: (left: unknown, right: unknown) => compare("eq", left, right),
  neq: (left: unknown, right: unknown) => compare("neq", left, right),
  gt: (left: unknown, right: unknown) => compare("gt", left, right),
  gte: (left: unknown, right: unknown) => compare("gte", left, right),
  lt: (left: unknown, right: unknown) => compare("lt", left, right),
  lte: (left: unknown, right: unknown) => compare("lte", left, right),
  and: (left: QueryConditionNode, right: QueryConditionNode, ...rest: readonly QueryConditionNode[]) =>
    fold("and", left, right, rest),
  or: (left: QueryConditionNode, right: QueryConditionNode, ...rest: readonly QueryConditionNode[]) =>
    fold("or", left, right, rest),
  not: (inner: QueryConditionNode) => ({ kind: "not" as const, inner }),
}) as unknown as RuleConditionBuilder<unknown>;

const INPUTS: RuleInputRef<Readonly<Record<string, unknown>>> = Object.freeze({
  field: (key: string) => ({ kind: "param" as const, name: key }),
}) as RuleInputRef<Readonly<Record<string, unknown>>>;

const SUBJECT_REF: RuleSubjectRef<unknown> = Object.freeze({
  field: (key: string) => ({ kind: "field" as const, key }),
}) as RuleSubjectRef<unknown>;

function isInputValue(value: unknown): value is RuleInputValue<unknown> {
  return typeof value === "object" && value !== null && (value as { readonly kind?: unknown }).kind === "param";
}

function isFieldValue(value: unknown): value is RuleFieldValue<unknown> {
  return typeof value === "object" && value !== null && (value as { readonly kind?: unknown }).kind === "field";
}

export type { RulesExplanation, RulesInspection };
