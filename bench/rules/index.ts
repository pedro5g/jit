import { Compiler, JIT } from "../../packages/jit/src/index.js";
import { getArtifact } from "../../packages/jit/src/runtime/artifact-registry.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const Transaction = JIT.object({
  id: JIT.number().int(),
  amount: JIT.number(),
  accountAgeDays: JIT.number().int(),
  velocity: JIT.number(),
  chargebacks: JIT.number().int(),
  country: JIT.string(),
});
type Transaction = JIT.Typeof<typeof Transaction>;

const Inputs = { riskScore: JIT.number(), tier: JIT.number().int() } as const;
type Inputs = { readonly riskScore: number; readonly tier: number };

const inputs: Inputs = { riskScore: 82, tier: 2 };

// 100,000 records: 1,000 evaluations sit inside the harness noise floor, where
// runtime and AOT emit identical source and still differ between runs.
const SIZE = 100_000;
const transactions: Transaction[] = Array.from({ length: SIZE }, (_, index) => ({
  id: index,
  amount: (index % 40) * 500,
  accountAgeDays: index % 90,
  velocity: index % 17,
  chargebacks: index % 4,
  country: index % 3 === 0 ? "BR" : "US",
}));

/* ------------------------------------------------------------------ */
/* A generic rules engine, the shape JIT.rules compiles away           */
/* ------------------------------------------------------------------ */

type Operator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";

interface GenericCondition {
  readonly fact: string;
  readonly operator: Operator;
  readonly value: number | string;
}

interface GenericRule {
  readonly id: string;
  readonly priority: number;
  readonly all: readonly GenericCondition[];
}

/**
 * The runtime a generic engine needs per evaluation: a fact resolver with a
 * cache, an operator registry looked up by name, and a scan over the rule
 * array. `json-rules-engine` itself is not in this suite because its `run()`
 * is Promise-based: measuring it here would mostly measure the microtask
 * queue, not decision work.
 */
const OPERATORS: Readonly<Record<Operator, (left: never, right: never) => boolean>> = {
  eq: (left, right) => left === right,
  neq: (left, right) => left !== right,
  gt: (left, right) => left > right,
  gte: (left, right) => left >= right,
  lt: (left, right) => left < right,
  lte: (left, right) => left <= right,
};

/** Counters proving how much work the optimizer removes. */
export const work = { factReads: 0, conditionEvaluations: 0 };

class Almanac {
  readonly #subject: Readonly<Record<string, unknown>>;
  readonly #inputs: Readonly<Record<string, unknown>>;
  readonly #cache = new Map<string, unknown>();

  constructor(subject: Transaction, values: Inputs) {
    this.#subject = subject as unknown as Readonly<Record<string, unknown>>;
    this.#inputs = values as unknown as Readonly<Record<string, unknown>>;
  }

  factValue(fact: string): unknown {
    const cached = this.#cache.get(fact);

    if (cached !== undefined) return cached;
    work.factReads++;
    const value = fact in this.#subject ? this.#subject[fact] : this.#inputs[fact];

    this.#cache.set(fact, value);
    return value;
  }
}

function genericEvaluate(rule: GenericRule, almanac: Almanac): boolean {
  for (const condition of rule.all) {
    work.conditionEvaluations++;
    const operator = OPERATORS[condition.operator];

    if (!operator(almanac.factValue(condition.fact) as never, condition.value as never)) return false;
  }
  return true;
}

function genericMatch(rules: readonly GenericRule[], subject: Transaction, values: Inputs): string[] {
  const almanac = new Almanac(subject, values);
  const matched: string[] = [];

  for (const rule of [...rules].sort((left, right) => right.priority - left.priority)) {
    if (genericEvaluate(rule, almanac)) matched[matched.length] = rule.id;
  }
  return matched;
}

function genericFirst(rules: readonly GenericRule[], subject: Transaction, values: Inputs): string | undefined {
  const almanac = new Almanac(subject, values);

  for (const rule of [...rules].sort((left, right) => right.priority - left.priority)) {
    if (genericEvaluate(rule, almanac)) return rule.id;
  }
  return undefined;
}

function genericSome(rules: readonly GenericRule[], subject: Transaction, values: Inputs): boolean {
  const almanac = new Almanac(subject, values);

  for (const rule of rules) if (genericEvaluate(rule, almanac)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Rule set generation, shared by both engines                         */
/* ------------------------------------------------------------------ */

const SUBJECT_FACTS = ["amount", "accountAgeDays", "velocity", "chargebacks"] as const;
const INPUT_FACTS = ["riskScore", "tier"] as const;
const OPERATOR_CYCLE: readonly Operator[] = ["gte", "lt", "gt", "lte", "neq", "eq"];

function generateRules(count: number, factCount: number): GenericRule[] {
  const rules: GenericRule[] = [];

  for (let index = 0; index < count; index++) {
    const all: GenericCondition[] = [];

    for (let term = 0; term < 2; term++) {
      const slot = (index * 2 + term) % factCount;
      const fact =
        slot < SUBJECT_FACTS.length
          ? (SUBJECT_FACTS[slot] as string)
          : (INPUT_FACTS[(slot - SUBJECT_FACTS.length) % INPUT_FACTS.length] as string);

      all[term] = {
        fact,
        operator: OPERATOR_CYCLE[(index + term) % OPERATOR_CYCLE.length] as Operator,
        value: (index * 7 + term * 3) % 60,
      };
    }
    rules[index] = { id: `r${index}`, priority: index % 4, all };
  }
  return rules;
}

type AnyRulesPlan = {
  test(rule: string, subject: Transaction, values: Inputs): boolean;
  some(subject: Transaction, values: Inputs): boolean;
  first(subject: Transaction, values: Inputs): string | undefined;
  match(subject: Transaction, values: Inputs): string[];
  many(): (subjects: readonly Transaction[], values: Inputs) => unknown[];
};

function compilePlan(specs: readonly GenericRule[]): AnyRulesPlan {
  let plan = JIT.rules(Transaction).inputs(Inputs) as never;

  for (const spec of specs) {
    plan = (plan as unknown as { rule(id: string, options: unknown): never }).rule(spec.id, {
      priority: spec.priority,
      when: (
        query: Record<Operator, (left: unknown, right: unknown) => unknown> & {
          and(left: unknown, right: unknown): unknown;
        },
        input: { field(key: string): unknown }
      ) => {
        const terms = spec.all.map((condition) => {
          const left = (SUBJECT_FACTS as readonly string[]).includes(condition.fact)
            ? condition.fact
            : input.field(condition.fact);

          return query[condition.operator](left, condition.value);
        });

        return terms.length === 1 ? terms[0] : query.and(terms[0], terms[1] as unknown);
      },
    }) as never;
  }
  return plan as unknown as AnyRulesPlan;
}

/**
 * The handwritten ceiling. It takes the inputs as an argument, exactly like the
 * compiled sink does: reading them from an enclosing closure instead measures
 * V8 context slots rather than decision work.
 */
function handwrittenBlock(subject: Transaction, values: Inputs): boolean {
  return subject.amount >= 10_000 && values.riskScore >= 80;
}

function handwrittenEarly(subject: Transaction): boolean {
  return subject.country === "ZZ" && subject.amount >= 0;
}

function handwrittenLate(subject: Transaction): boolean {
  return subject.amount >= 0 && subject.country === "ZZ";
}

// Every competitor carries its own loop, and every loop folds its results
// into an accumulator. Sharing one `sweep` helper would let the first closure
// measured keep an inlined, monomorphic version of it while the later ones run
// the polymorphic one; keeping only the last result would let the engine
// eliminate the other 99,999 pure calls. Both mistakes make decision
// microbenchmarks unbelievable, so neither is used here.

/* ------------------------------------------------------------------ */
/* Simple: one rule, two comparisons                                   */
/* ------------------------------------------------------------------ */

const simpleSpecs: GenericRule[] = [
  {
    id: "block",
    priority: 0,
    all: [
      { fact: "amount", operator: "gte", value: 10_000 },
      { fact: "riskScore", operator: "gte", value: 80 },
    ],
  },
];
const simple = compilePlan(simpleSpecs);

registerScenario({
  op: "rules test",
  name: "1 rule / 2 comparisons / 100000 evaluations",
  args: [transactions],
  jit: (input: readonly Transaction[]) => {
    let matched = 0;

    for (let index = 0, size = input.length; index < size; index++) {
      if (simple.test("block", input[index] as Transaction, inputs)) matched++;
    }
    return matched;
  },
  competitors: [
    {
      name: "generic rules engine",
      fn: (input: readonly Transaction[]) => {
        let matched = 0;

        for (let index = 0, size = input.length; index < size; index++) {
          if (genericSome(simpleSpecs, input[index] as Transaction, inputs)) matched++;
        }
        return matched;
      },
    },
    {
      name: "handwritten predicate",
      fn: (input: readonly Transaction[]) => {
        let matched = 0;

        for (let index = 0, size = input.length; index < size; index++) {
          if (handwrittenBlock(input[index] as Transaction, inputs)) matched++;
        }
        return matched;
      },
    },
  ],
});

/* ------------------------------------------------------------------ */
/* Medium: ten rules, shared fields                                    */
/* ------------------------------------------------------------------ */

const mediumSpecs = generateRules(10, 6);
const medium = compilePlan(mediumSpecs);

registerScenario({
  op: "rules match",
  name: "10 rules / shared facts / 100000 evaluations",
  args: [transactions],
  jit: (input: readonly Transaction[]) => {
    let total = 0;

    for (let index = 0, size = input.length; index < size; index++) {
      total += medium.match(input[index] as Transaction, inputs).length;
    }
    return total;
  },
  competitors: [
    {
      name: "generic rules engine",
      fn: (input: readonly Transaction[]) => {
        let total = 0;

        for (let index = 0, size = input.length; index < size; index++) {
          total += genericMatch(mediumSpecs, input[index] as Transaction, inputs).length;
        }
        return total;
      },
    },
  ],
});

registerScenario({
  op: "rules some",
  name: "10 rules / early exit / 100000 evaluations",
  args: [transactions],
  jit: (input: readonly Transaction[]) => {
    let matched = 0;

    for (let index = 0, size = input.length; index < size; index++) {
      if (medium.some(input[index] as Transaction, inputs)) matched++;
    }
    return matched;
  },
  competitors: [
    {
      name: "generic rules engine",
      fn: (input: readonly Transaction[]) => {
        let matched = 0;

        for (let index = 0, size = input.length; index < size; index++) {
          if (genericSome(mediumSpecs, input[index] as Transaction, inputs)) matched++;
        }
        return matched;
      },
    },
  ],
});

registerScenario({
  op: "rules first",
  name: "10 rules / priority order / 100000 evaluations",
  args: [transactions],
  jit: (input: readonly Transaction[]) => {
    let matched = 0;

    for (let index = 0, size = input.length; index < size; index++) {
      if (medium.first(input[index] as Transaction, inputs) !== undefined) matched++;
    }
    return matched;
  },
  competitors: [
    {
      name: "generic rules engine",
      fn: (input: readonly Transaction[]) => {
        let matched = 0;

        for (let index = 0, size = input.length; index < size; index++) {
          if (genericFirst(mediumSpecs, input[index] as Transaction, inputs) !== undefined) matched++;
        }
        return matched;
      },
    },
  ],
});

/* ------------------------------------------------------------------ */
/* Heavy shared facts: fifty rules over five facts                     */
/* ------------------------------------------------------------------ */

const sharedSpecs = generateRules(50, 5);
const shared = compilePlan(sharedSpecs);

registerScenario({
  op: "rules match",
  name: "50 rules / 5 shared facts / 100000 evaluations",
  args: [transactions],
  jit: (input: readonly Transaction[]) => {
    let total = 0;

    for (let index = 0, size = input.length; index < size; index++) {
      total += shared.match(input[index] as Transaction, inputs).length;
    }
    return total;
  },
  competitors: [
    {
      name: "generic rules engine",
      fn: (input: readonly Transaction[]) => {
        let total = 0;

        for (let index = 0, size = input.length; index < size; index++) {
          total += genericMatch(sharedSpecs, input[index] as Transaction, inputs).length;
        }
        return total;
      },
    },
  ],
});

/* ------------------------------------------------------------------ */
/* Large: one hundred rules                                            */
/* ------------------------------------------------------------------ */

const largeSpecs = generateRules(100, 6);
const large = compilePlan(largeSpecs);

registerScenario({
  op: "rules match",
  name: "100 rules / 100000 evaluations",
  args: [transactions],
  jit: (input: readonly Transaction[]) => {
    let total = 0;

    for (let index = 0, size = input.length; index < size; index++) {
      total += large.match(input[index] as Transaction, inputs).length;
    }
    return total;
  },
  competitors: [
    {
      name: "generic rules engine",
      fn: (input: readonly Transaction[]) => {
        let total = 0;

        for (let index = 0, size = input.length; index < size; index++) {
          total += genericMatch(largeSpecs, input[index] as Transaction, inputs).length;
        }
        return total;
      },
    },
  ],
});

registerScenario({
  op: "rules first",
  name: "100 rules / priority order / 100000 evaluations",
  args: [transactions],
  jit: (input: readonly Transaction[]) => {
    let matched = 0;

    for (let index = 0, size = input.length; index < size; index++) {
      if (large.first(input[index] as Transaction, inputs) !== undefined) matched++;
    }
    return matched;
  },
  competitors: [
    {
      name: "generic rules engine",
      fn: (input: readonly Transaction[]) => {
        let matched = 0;

        for (let index = 0, size = input.length; index < size; index++) {
          if (genericFirst(largeSpecs, input[index] as Transaction, inputs) !== undefined) matched++;
        }
        return matched;
      },
    },
  ],
});

/* ------------------------------------------------------------------ */
/* Early and late failure                                              */
/* ------------------------------------------------------------------ */

const earlySpecs: GenericRule[] = [
  {
    id: "early",
    priority: 0,
    all: [
      { fact: "country", operator: "eq", value: "ZZ" },
      { fact: "amount", operator: "gte", value: 0 },
    ],
  },
];
const lateSpecs: GenericRule[] = [
  {
    id: "late",
    priority: 0,
    all: [
      { fact: "amount", operator: "gte", value: 0 },
      { fact: "country", operator: "eq", value: "ZZ" },
    ],
  },
];

function compileStringPlan(specs: readonly GenericRule[]): AnyRulesPlan {
  let plan = JIT.rules(Transaction).inputs(Inputs) as never;

  for (const spec of specs) {
    plan = (plan as unknown as { rule(id: string, options: unknown): never }).rule(spec.id, {
      priority: spec.priority,
      when: (
        query: Record<string, (left: unknown, right: unknown) => unknown> & { and(a: unknown, b: unknown): unknown }
      ) =>
        query.and(
          query[spec.all[0]?.operator as string]?.(spec.all[0]?.fact, spec.all[0]?.value),
          query[spec.all[1]?.operator as string]?.(spec.all[1]?.fact, spec.all[1]?.value)
        ),
    }) as never;
  }
  return plan as unknown as AnyRulesPlan;
}

const early = compileStringPlan(earlySpecs);
const late = compileStringPlan(lateSpecs);

registerScenario({
  op: "rules some",
  name: "first condition fails / 100000 evaluations",
  args: [transactions],
  jit: (input: readonly Transaction[]) => {
    let matched = 0;

    for (let index = 0, size = input.length; index < size; index++) {
      if (early.some(input[index] as Transaction, inputs)) matched++;
    }
    return matched;
  },
  competitors: [
    {
      name: "generic rules engine",
      fn: (input: readonly Transaction[]) => {
        let matched = 0;

        for (let index = 0, size = input.length; index < size; index++) {
          if (genericSome(earlySpecs, input[index] as Transaction, inputs)) matched++;
        }
        return matched;
      },
    },
    {
      name: "handwritten predicate",
      fn: (input: readonly Transaction[]) => {
        let matched = 0;

        for (let index = 0, size = input.length; index < size; index++) {
          if (handwrittenEarly(input[index] as Transaction)) matched++;
        }
        return matched;
      },
    },
  ],
});

registerScenario({
  op: "rules some",
  name: "last condition fails / 100000 evaluations",
  args: [transactions],
  jit: (input: readonly Transaction[]) => {
    let matched = 0;

    for (let index = 0, size = input.length; index < size; index++) {
      if (late.some(input[index] as Transaction, inputs)) matched++;
    }
    return matched;
  },
  competitors: [
    {
      name: "generic rules engine",
      fn: (input: readonly Transaction[]) => {
        let matched = 0;

        for (let index = 0, size = input.length; index < size; index++) {
          if (genericSome(lateSpecs, input[index] as Transaction, inputs)) matched++;
        }
        return matched;
      },
    },
    {
      name: "handwritten predicate",
      fn: (input: readonly Transaction[]) => {
        let matched = 0;

        for (let index = 0, size = input.length; index < size; index++) {
          if (handwrittenLate(input[index] as Transaction)) matched++;
        }
        return matched;
      },
    },
  ],
});

/* ------------------------------------------------------------------ */
/* Outcomes over a collection                                          */
/* ------------------------------------------------------------------ */

const Review = JIT.object({
  transactionId: JIT.number().int(),
  riskScore: JIT.number(),
  amount: JIT.number(),
});

const outcomeRules = JIT.rules(Transaction)
  .inputs(Inputs)
  .rule("review", {
    when: (query, input) => query.and(query.gte("amount", 5_000), query.gte(input.field("riskScore"), 80)),
    emit: Review,
    values: (subject) => ({ transactionId: subject.field("id") }),
  });
const classify = outcomeRules.many();
const classifyVisitor = classify.to.visitor();

registerScenario({
  op: "rules many",
  name: "1 rule / outcome per match / 100000 rows",
  args: [transactions],
  jit: (input: readonly Transaction[]) => classify(input, inputs),
  competitors: [
    {
      name: "map + run per record",
      fn: (input: readonly Transaction[]) => input.flatMap((subject) => outcomeRules.run(subject, inputs)),
    },
    { name: "handwritten loop", fn: (input: readonly Transaction[]) => handwrittenClassify(input, inputs) },
  ],
});

registerScenario({
  op: "rules many visitor",
  name: "1 rule / consumed outcome / 100000 rows",
  args: [transactions],
  jit: (input: readonly Transaction[]) => {
    let total = 0;

    classifyVisitor(input, inputs, (_rule, outcome) => {
      total += (outcome as { amount: number }).amount;
    });
    return total;
  },
  competitors: [
    {
      name: "many + array walk",
      fn: (input: readonly Transaction[]) => {
        const outcomes = classify(input, inputs) as { amount: number }[];
        let total = 0;

        for (let index = 0; index < outcomes.length; index++) total += (outcomes[index] as { amount: number }).amount;
        return total;
      },
    },
  ],
});

function handwrittenClassify(
  input: readonly Transaction[],
  values: Inputs
): { transactionId: number; riskScore: number; amount: number }[] {
  const out: { transactionId: number; riskScore: number; amount: number }[] = [];
  let j = 0;
  const risk = values.riskScore;
  const eligible = risk >= 80;

  for (let index = 0, size = input.length; index < size; index++) {
    const subject = input[index] as Transaction;

    if (subject.amount >= 5_000 && eligible) {
      out[j++] = { transactionId: subject.id, riskScore: risk, amount: subject.amount };
    }
  }
  return out;
}

function handwrittenFilter(input: readonly Transaction[], values: Inputs): Transaction[] {
  const out: Transaction[] = [];
  let j = 0;
  const eligible = values.riskScore >= 80;

  for (let index = 0, size = input.length; index < size; index++) {
    const subject = input[index] as Transaction;

    if (subject.amount >= 5_000 && eligible) out[j++] = subject;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Query fusion                                                        */
/* ------------------------------------------------------------------ */

const highRisk = JIT.rules(Transaction)
  .inputs(Inputs)
  .rule("high-risk", {
    when: (query, input) => query.and(query.gte("amount", 5_000), query.gte(input.field("riskScore"), 80)),
  });
const fusedQuery = JIT.cqrs.query(Transaction).where(highRisk.predicate("high-risk"), inputs);
const rulePredicate = highRisk.predicate("high-risk");

registerScenario({
  op: "rules query",
  name: "rule predicate fused into the scan / 100000 rows",
  args: [transactions],
  jit: fusedQuery,
  competitors: [
    {
      name: "filter rule predicate per row",
      fn: (input: readonly Transaction[]) => input.filter((subject) => rulePredicate(subject, inputs)),
    },
    { name: "handwritten inline loop", fn: (input: readonly Transaction[]) => handwrittenFilter(input, inputs) },
  ],
});

/* ------------------------------------------------------------------ */
/* AOT                                                                 */
/* ------------------------------------------------------------------ */

function aotSink(plan: object, sink: "match" | "first"): (subject: Transaction, values: Inputs) => unknown {
  const artifact = getArtifact(plan);

  if (artifact?.kind !== "rules-plan") throw new Error("rules benchmark requires a rules plan");
  return globalThis.Function(`return ${Compiler.emitRulesSinkSource(artifact.descriptor, sink)};`)() as never;
}

const aotMatch = aotSink(shared as unknown as object, "match");

registerScenario({
  op: "rules match",
  name: "50 rules / 5 shared facts / AOT / 100000 evaluations",
  args: [transactions],
  jit: (input: readonly Transaction[]) => {
    let total = 0;

    for (let index = 0, size = input.length; index < size; index++) {
      total += (aotMatch(input[index] as Transaction, inputs) as readonly unknown[]).length;
    }
    return total;
  },
  competitors: [
    {
      name: "JIT runtime",
      fn: (input: readonly Transaction[]) => {
        let total = 0;

        for (let index = 0, size = input.length; index < size; index++) {
          total += shared.match(input[index] as Transaction, inputs).length;
        }
        return total;
      },
    },
    {
      name: "generic rules engine",
      fn: (input: readonly Transaction[]) => {
        let total = 0;

        for (let index = 0, size = input.length; index < size; index++) {
          total += genericMatch(sharedSpecs, input[index] as Transaction, inputs).length;
        }
        return total;
      },
    },
  ],
});

/* ------------------------------------------------------------------ */
/* Work avoided                                                        */
/* ------------------------------------------------------------------ */

work.factReads = 0;
work.conditionEvaluations = 0;
for (let index = 0; index < 1_000; index++) genericMatch(sharedSpecs, transactions[index] as Transaction, inputs);

const inspection = (
  shared as unknown as {
    inspect(): {
      sharedReads: number;
      sharedPredicates: number;
      subjectPaths: readonly string[];
      inputPaths: readonly string[];
    };
  }
).inspect();

console.log(
  [
    "",
    "work avoided (50 rules / 5 shared facts, 1000 evaluations)",
    `  generic engine fact reads:      ${work.factReads}`,
    `  generic engine condition evals: ${work.conditionEvaluations}`,
    `  compiled distinct facts:        ${inspection.subjectPaths.length + inspection.inputPaths.length}`,
    `  compiled hoisted fact reads:    ${inspection.sharedReads}`,
    `  compiled shared predicates:     ${inspection.sharedPredicates}`,
    "",
  ].join("\n")
);

await runSuite("rules");
