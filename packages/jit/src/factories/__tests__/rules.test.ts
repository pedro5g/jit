import { expectTypeOf } from "vitest";
import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

const Transaction = JIT.object({
  id: JIT.number().int(),
  amount: JIT.number(),
  country: JIT.string(),
});
type Transaction = JIT.Typeof<typeof Transaction>;

const TransactionRules = JIT.rules(Transaction)
  .inputs({ riskScore: JIT.number(), accountAgeDays: JIT.number().int() })
  .rule("manual-review", {
    when: (query, input) => query.or(query.gte("amount", 10_000), query.gte(input.field("riskScore"), 80)),
  })
  .rule("block", {
    priority: 100,
    when: (query, input) =>
      query.and(query.gte(input.field("riskScore"), 95), query.lt(input.field("accountAgeDays"), 7)),
  })
  .rule("domestic", { priority: 100, when: (query) => query.eq("country", "BR") });

const low = { riskScore: 20, accountAgeDays: 300 };
const high = { riskScore: 96, accountAgeDays: 2 };
const transaction: Transaction = { id: 1, amount: 100, country: "BR" };

describe("JIT.rules", () => {
  describe("descriptor and types", () => {
    it("keeps literal ids and typed subject/input fields", () => {
      expect(TransactionRules.ids).toEqual(["manual-review", "block", "domestic"]);
      expectTypeOf<(typeof TransactionRules.ids)[number]>().toEqualTypeOf<"manual-review" | "block" | "domestic">();
      expectTypeOf(TransactionRules.first(transaction, low)).toEqualTypeOf<
        "manual-review" | "block" | "domestic" | undefined
      >();

      // Declared, never called: these assertions are about what the compiler
      // rejects, and running them would only prove the runtime guards.
      const invalidDeclarations = () => {
        JIT.rules(Transaction)
          .inputs({ riskScore: JIT.number() })
          .rule("valid", { when: (query, input) => query.gte(input.field("riskScore"), 80) });

        JIT.rules(Transaction).rule("bad-subject", {
          // @ts-expect-error — the subject does not declare this field
          when: (query) => query.eq("missing", 1),
        });
        JIT.rules(Transaction)
          .inputs({ riskScore: JIT.number() })
          .rule("bad-input", {
            // @ts-expect-error — the input shape does not declare this field
            when: (query, input) => query.eq(input.field("missing"), 1),
          });
        JIT.rules(Transaction)
          .rule("same", { when: (query) => query.eq("id", 1) })
          // @ts-expect-error — duplicate literal ids are rejected by the chain type
          .rule("same", { when: (query) => query.eq("id", 2) });
      };

      expect(typeof invalidDeclarations).toBe("function");
    });

    it("rejects invalid dynamic declarations before compilation", () => {
      expect(() =>
        JIT.rules(Transaction)
          .rule("duplicate", { when: (query) => query.eq("id", 1) })
          .rule(
            // @ts-expect-error — runtime coverage for a deliberately invalid dynamic call
            "duplicate",
            { when: (query) => query.eq("id", 2) }
          )
      ).toThrow(/duplicated/);
      expect(() =>
        JIT.rules(Transaction).rule("priority", {
          priority: 1.5,
          when: (query) => query.eq("id", 1),
        })
      ).toThrow(/safe integer/);
    });

    it("records exact per-rule dependencies", () => {
      const artifact = getArtifact(TransactionRules);
      if (artifact?.kind !== "rules-plan") throw new Error("rules plan not registered");

      expect(
        artifact.descriptor.rules.map(({ id, subjectPaths, inputPaths }) => ({ id, subjectPaths, inputPaths }))
      ).toEqual([
        { id: "manual-review", subjectPaths: ["amount"], inputPaths: ["riskScore"] },
        { id: "block", subjectPaths: [], inputPaths: ["riskScore", "accountAgeDays"] },
        { id: "domestic", subjectPaths: ["country"], inputPaths: [] },
      ]);
      expect(Object.isFrozen(artifact.descriptor)).toBe(true);
      expect(Object.isFrozen(artifact.descriptor.rules)).toBe(true);
    });
  });

  describe("execution sinks", () => {
    it("tests one rule without evaluating a rule array", () => {
      expect(TransactionRules.test("manual-review", transaction, low)).toBe(false);
      expect(TransactionRules.test("block", transaction, high)).toBe(true);
      expect(TransactionRules.test("domestic", transaction, low)).toBe(true);
      // @ts-expect-error — unknown rule ids are not part of the literal union
      expect(TransactionRules.test("missing", transaction, low)).toBe(false);
    });

    it("short-circuits some and returns false when none match", () => {
      expect(TransactionRules.some(transaction, low)).toBe(true);
      expect(TransactionRules.some({ ...transaction, country: "US" }, low)).toBe(false);
    });

    it("orders first by descending priority and breaks ties by declaration order", () => {
      expect(TransactionRules.first(transaction, high)).toBe("block");
      expect(TransactionRules.first(transaction, low)).toBe("domestic");
      expect(TransactionRules.first({ ...transaction, country: "US" }, low)).toBeUndefined();
    });

    it("materializes only matched ids in priority order", () => {
      expect(TransactionRules.match(transaction, high)).toEqual(["block", "domestic", "manual-review"]);
      expect(TransactionRules.match({ ...transaction, country: "US" }, low)).toEqual([]);
    });

    it("obeys the core property relations", () => {
      for (const value of [transaction, { ...transaction, amount: 20_000 }, { ...transaction, country: "US" }]) {
        for (const inputs of [low, high]) {
          const matched = TransactionRules.match(value, inputs);
          expect(TransactionRules.some(value, inputs)).toBe(matched.length > 0);
          const first = TransactionRules.first(value, inputs);
          expect(first === undefined || matched.includes(first)).toBe(true);
          for (const id of TransactionRules.ids) {
            expect(TransactionRules.test(id, value, inputs)).toBe(matched.includes(id));
          }
        }
      }
    });
  });

  describe("generated source", () => {
    it("emits direct comparisons, switch-specialized test and no interpreter infrastructure", () => {
      const artifact = getArtifact(TransactionRules);
      if (artifact?.kind !== "rules-plan") throw new Error("rules plan not registered");
      const test = Compiler.emitRulesTestSource(artifact.descriptor);
      const some = Compiler.emitRulesSomeSource(artifact.descriptor);
      const first = Compiler.emitRulesFirstSource(artifact.descriptor);
      const match = Compiler.emitRulesMatchSource(artifact.descriptor);

      expect(test).toContain('case "block"');
      expect(test).toContain("inputs.riskScore >= 95");
      expect(some).toContain("||");
      expect(first.indexOf('return "block"')).toBeLessThan(first.indexOf('return "domestic"'));
      expect(match).toContain("out[j++]");
      expect(match).toContain("const p0 = inputs.riskScore;");
      expect(match.match(/inputs\.riskScore/g)).toHaveLength(1);
      for (const source of [test, some, first, match]) {
        expect(source).not.toMatch(/Rule\[|Map\(|operator|Almanac|for \(/);
      }
    });
  });
});

/* -------------------------------------------------------------------------- */

const ManualReview = JIT.dto(
  JIT.object({
    type: JIT.literal("manual-review"),
    transactionId: JIT.number().int(),
    riskScore: JIT.number(),
  })
);
type ManualReview = JIT.Typeof<typeof ManualReview>;

const TransactionBlocked = JIT.ddd.domainEvent("transaction.blocked", {
  version: 1,
  payload: JIT.object({ transactionId: JIT.number().int(), reason: JIT.string() }),
});

const DecisionRules = JIT.rules(Transaction)
  .inputs({ riskScore: JIT.number(), accountAgeDays: JIT.number().int() })
  .rule("manual-review", {
    when: (query, input) => query.or(query.gte("amount", 10_000), query.gte(input.field("riskScore"), 80)),
    emit: ManualReview,
    values: (subject) => ({ transactionId: subject.field("id") }),
  })
  .rule("block", {
    priority: 100,
    when: (query, input) =>
      query.and(query.gte(input.field("riskScore"), 95), query.lt(input.field("accountAgeDays"), 7)),
    emit: TransactionBlocked,
    values: (subject) => ({ transactionId: subject.field("id"), reason: "risk" }),
  })
  .rule("domestic", { when: (query) => query.eq("country", "BR") });

function rulesDescriptor(plan: unknown): Compiler.RulesDescriptor {
  const artifact = getArtifact(plan as object);

  if (artifact?.kind !== "rules-plan") throw new Error("rules plan not registered");
  return artifact.descriptor;
}

/** Generic walker used only as the differential oracle. */
function interpret(
  condition: Compiler.RulesDescriptor["rules"][number]["condition"],
  subject: unknown,
  inputs: unknown
): boolean {
  if (condition.kind === "logical") {
    const left = interpret(condition.left, subject, inputs);

    if (condition.op === "and") return left && interpret(condition.right, subject, inputs);
    return left || interpret(condition.right, subject, inputs);
  }
  if (condition.kind === "not") return !interpret(condition.inner, subject, inputs);

  const read = (value: (typeof condition)["left"]): unknown => {
    if (value.kind === "field") return (subject as Record<string, unknown>)[value.key];
    if (value.kind === "param") return (inputs as Record<string, unknown>)[value.name];
    if (value.kind === "literal") return value.value;
    throw new Error("bindings are not part of a rule condition");
  };
  const left = read(condition.left) as number;
  const right = read(condition.right) as number;

  switch (condition.op) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    default:
      return left <= right;
  }
}

function referenceMatch(descriptor: Compiler.RulesDescriptor, subject: unknown, inputs: unknown): string[] {
  return [...descriptor.rules]
    .sort((left, right) => right.priority - left.priority || left.order - right.order)
    .filter((rule) => rule.constant ?? interpret(rule.condition, subject, inputs))
    .map((rule) => rule.id);
}

describe("JIT.rules outcomes", () => {
  it("fills a target schema from the subject, the inputs and its literals", () => {
    const outcomes = DecisionRules.run(transaction, high);

    expect(outcomes).toHaveLength(2);
    expect(outcomes[1]).toEqual({ type: "manual-review", transactionId: 1, riskScore: 96 });
    expectTypeOf(DecisionRules.run(transaction, high)).toEqualTypeOf<
      (ManualReview | ReturnType<typeof TransactionBlocked.create>)[]
    >();
  });

  it("builds a domain event without publishing it", () => {
    const event = DecisionRules.run(transaction, high)[0] as ReturnType<typeof TransactionBlocked.create>;

    expect(event.type).toBe("transaction.blocked");
    expect(event.version).toBe(1);
    expect(event.payload).toEqual({ transactionId: 1, reason: "risk" });
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(typeof event.id).toBe("string");
  });

  it("skips rules that only exist as predicates", () => {
    expect(DecisionRules.match(transaction, low)).toContain("domestic");
    expect(DecisionRules.run(transaction, low)).toEqual([]);
  });

  it("rejects an outcome it cannot fill or address", () => {
    expect(() =>
      JIT.rules(Transaction).rule("bad", {
        when: (query) => query.eq("id", 1),
        emit: JIT.object({ missing: JIT.string() }),
      })
    ).toThrow(/cannot fill required target field "missing"/);
    expect(() =>
      JIT.rules(Transaction).rule("bad", {
        when: (query) => query.eq("id", 1),
        emit: JIT.object({ id: JIT.number().int() }),
        // @ts-expect-error — the target does not declare this field
        values: () => ({ nope: 1 }),
      })
    ).toThrow(/unknown target field "nope"/);
    expect(() =>
      JIT.rules(Transaction).rule("bad", {
        when: (query) => query.eq("id", 1),
        // @ts-expect-error — values require a declared emit target
        values: () => ({}),
      })
    ).toThrow(/values without emit/);
  });
});

describe("JIT.rules result modes", () => {
  it("visits every matched rule without materializing an array", () => {
    const visited: [string, string | undefined][] = [];
    const visit = DecisionRules.to.visitor();
    const count = visit(transaction, high, (rule, outcome) => {
      visited[visited.length] = [rule, outcome === undefined ? undefined : outcome.type];
    });

    expect(count).toBe(3);
    expect(visited).toEqual([
      ["block", "transaction.blocked"],
      ["manual-review", "manual-review"],
      ["domestic", undefined],
    ]);
  });

  it("yields outcomes incrementally", () => {
    const iterate = DecisionRules.to.iterator();
    const outcomes = [...iterate(transaction, high)];

    expect(outcomes.map((outcome) => outcome.type)).toEqual(["transaction.blocked", "manual-review"]);
    expect(iterate(transaction, low)[Symbol.iterator]().next().done).toBe(true);
  });

  it("explains matched and evaluated rules outside the execution sinks", () => {
    expect(DecisionRules.explain(transaction, high)).toEqual({
      matched: ["block", "manual-review", "domestic"],
      evaluated: ["block", "manual-review", "domestic"],
    });
  });

  it("reports the compile plan", () => {
    expect(DecisionRules.inspect()).toEqual({
      rules: 3,
      liveRules: 3,
      deadRules: [],
      subjectPaths: ["id", "amount", "country"],
      inputPaths: ["riskScore", "accountAgeDays"],
      deadInputs: [],
      sharedReads: 2,
      sharedPredicates: 0,
      priorityGroups: 2,
      outcomes: 2,
      strategy: "inline",
    });
  });
});

describe("JIT.rules collections", () => {
  const list = [transaction, { ...transaction, id: 2, country: "US" }, { ...transaction, id: 3, amount: 20_000 }];

  it("evaluates a collection in one loop with a single output array", () => {
    const classify = DecisionRules.many();

    expect(classify(list, low).map((outcome) => outcome.type)).toEqual(["manual-review"]);
    expect(classify(list, high)).toHaveLength(6);
  });

  it("streams collection outcomes through a visitor and an iterator", () => {
    const classify = DecisionRules.many();
    const seen: number[] = [];
    const count = classify.to.visitor()(list, low, (_rule, _outcome, index) => {
      seen[seen.length] = index;
    });

    expect(count).toBe(3);
    expect(seen).toEqual([0, 2, 2]);
    expect([...classify.to.iterator()(list, low)]).toHaveLength(1);
  });

  it("matches the equivalent per-record run", () => {
    const classify = DecisionRules.many();
    const perRecord = list.flatMap((value) => DecisionRules.run(value, high));

    expect(JSON.stringify(stripIds(classify(list, high)))).toEqual(JSON.stringify(stripIds(perRecord)));
  });
});

function stripIds(outcomes: readonly unknown[]): unknown[] {
  return outcomes.map((outcome) => {
    const { id: _id, occurredAt: _occurredAt, ...rest } = outcome as Record<string, unknown>;

    return rest;
  });
}

describe("JIT.rules as a query predicate", () => {
  const rows = [
    { id: 1, amount: 1000, country: "BR" },
    { id: 2, amount: 10, country: "US" },
    { id: 3, amount: 900, country: "PT" },
  ];

  it("fuses one rule into the query loop and keeps rules out of the protocol", () => {
    const highRisk = JIT.rules(Transaction)
      .inputs({ riskScore: JIT.number() })
      .rule("high-risk", {
        when: (query, input) => query.and(query.gte("amount", 500), query.gte(input.field("riskScore"), 80)),
      });
    const query = JIT.cqrs.query(Transaction).where(highRisk.predicate("high-risk"), { riskScore: 90 });

    expect(query(rows).map((row) => row.id)).toEqual([1, 3]);
    expect(JSON.stringify(query["~query"])).not.toMatch(/rule|fact|outcome/i);
    expect(JSON.stringify(query["~query"])).toContain('"where"');
  });

  it("passes rule inputs as query values", () => {
    const rules = JIT.rules(Transaction)
      .inputs({ minimum: JIT.number() })
      .rule("large", { when: (query, input) => query.gte("amount", input.field("minimum")) });
    const predicate = rules.predicate("large");

    expect(
      JIT.cqrs
        .query(Transaction)
        .where(predicate, { minimum: 900 })(rows)
        .map((row) => row.id)
    ).toEqual([1, 3]);
    expect(JIT.cqrs.query(Transaction).where(predicate, { minimum: 2000 })(rows)).toEqual([]);
  });

  it("filters an NDJSON stream in the parse loop", () => {
    const rules = JIT.rules(Transaction)
      .inputs({ riskScore: JIT.number() })
      .rule("high-risk", {
        when: (query, input) => query.and(query.gte("amount", 500), query.gte(input.field("riskScore"), 80)),
      });
    const lines = rows.map((row) => JSON.stringify(row)).join("\n");
    const parse = JIT.ndjson.parse(Transaction).validate().where(rules.predicate("high-risk"), { riskScore: 90 });
    const seen: number[] = [];

    expect(parse(lines).map((row) => row.id)).toEqual([1, 3]);
    expect(
      JIT.ndjson.parse(Transaction).where(rules.predicate("high-risk"), { riskScore: 90 }).to.visitor()(
        lines,
        (row) => {
          seen[seen.length] = row.id;
        }
      )
    ).toBe(2);
    expect(seen).toEqual([1, 3]);
  });

  it("keeps the standalone predicate callable and cached per rule", () => {
    const predicate = DecisionRules.predicate("domestic");

    expect(predicate).toBe(DecisionRules.predicate("domestic"));
    expect(predicate(transaction, low)).toBe(true);
    expect(predicate({ ...transaction, country: "US" }, low)).toBe(false);
  });
});

describe("JIT.rules compiler guarantees", () => {
  it("folds a constant condition and eliminates the dead rule", () => {
    const descriptor = Compiler.resolveRulesDescriptor(JIT.object({ amount: JIT.number() }).schema, undefined, [
      {
        id: "dead",
        priority: 0,
        condition: {
          kind: "logical",
          op: "and",
          left: {
            kind: "compare",
            op: "eq",
            left: { kind: "field", key: "amount" },
            right: { kind: "literal", value: 1 },
          },
          right: {
            kind: "compare",
            op: "gt",
            left: { kind: "literal", value: 1 },
            right: { kind: "literal", value: 2 },
          },
        },
      },
      {
        id: "live",
        priority: 0,
        condition: {
          kind: "compare",
          op: "gte",
          left: { kind: "field", key: "amount" },
          right: { kind: "literal", value: 5 },
        },
      },
    ]);

    expect(descriptor.rules[0]?.constant).toBe(false);
    expect(descriptor.rules[0]?.subjectPaths).toEqual([]);
    expect(Compiler.emitRulesMatchSource(descriptor)).not.toContain('"dead"');
    expect(Compiler.emitRulesSomeSource(descriptor)).toBe(
      "function rulesSome(subject) {\n  return (subject.amount >= 5);\n}\n"
    );
    expect(Compiler.inspectRules(descriptor).deadRules).toEqual(["dead"]);
  });

  it("stops emitting rules a constant match makes unreachable", () => {
    const always: Compiler.RuleDeclaration = {
      id: "always",
      priority: 100,
      condition: {
        kind: "compare",
        op: "eq",
        left: { kind: "literal", value: 1 },
        right: { kind: "literal", value: 1 },
      },
    };
    const below: Compiler.RuleDeclaration = {
      id: "below",
      priority: 0,
      condition: {
        kind: "compare",
        op: "gte",
        left: { kind: "field", key: "amount" },
        right: { kind: "literal", value: 5 },
      },
    };
    const descriptor = Compiler.resolveRulesDescriptor(JIT.object({ amount: JIT.number() }).schema, undefined, [
      always,
      below,
    ]);
    const first = Compiler.emitRulesFirstSource(descriptor);
    const compiled = Compiler.compileRulesSink<(subject: unknown) => string | undefined>(descriptor, "first");

    expect(descriptor.rules[0]?.constant).toBe(true);
    expect(first).toContain('return "always";');
    expect(first).not.toContain('"below"');
    expect(first.match(/}/g)).toHaveLength(1);
    expect(compiled({ amount: 0 })).toBe("always");
    expect(Compiler.emitRulesSomeSource(descriptor)).toContain("return true;");
  });

  it("auto-matches an outcome field only when the types agree", () => {
    const Subject = JIT.object({ id: JIT.number().int(), label: JIT.string() });
    const Target = JIT.object({ id: JIT.number().int(), label: JIT.literal("flagged") });
    const rules = JIT.rules(Subject).rule("flag", { when: (query) => query.gte("id", 1), emit: Target });

    // `label` is a string on the subject and a literal on the target, so the
    // literal fills itself instead of silently copying an incompatible field.
    expect(rules.run({ id: 3, label: "anything" })).toEqual([{ id: 3, label: "flagged" }]);
  });

  it("shares one binding between rules emitting the same domain event", () => {
    const Subject = JIT.object({ id: JIT.number().int(), amount: JIT.number() });
    const Flagged = JIT.ddd.domainEvent("subject.flagged", {
      version: 1,
      payload: JIT.object({ id: JIT.number().int() }),
    });
    const rules = JIT.rules(Subject)
      .rule("large", { when: (query) => query.gte("amount", 100), emit: Flagged })
      .rule("small", { when: (query) => query.lt("amount", 100), emit: Flagged });

    expect(rulesDescriptor(rules).bindingNames).toEqual(["__ro0"]);
    expect(rules.run({ id: 1, amount: 500 })).toHaveLength(1);
  });

  it("shares a comparison written by two rules", () => {
    const rules = JIT.rules(Transaction)
      .inputs({ riskScore: JIT.number() })
      .rule("a", { when: (query, input) => query.gte(input.field("riskScore"), 80) })
      .rule("b", {
        when: (query, input) => query.and(query.gte(input.field("riskScore"), 80), query.gt("amount", 5000)),
      });
    const source = Compiler.emitRulesMatchSource(rulesDescriptor(rules));

    expect(source).toContain("const c0 = inputs.riskScore >= 80;");
    expect(source.match(/>= 80/g)).toHaveLength(1);
    expect(rules.inspect().sharedPredicates).toBe(1);
  });

  it("hoists loop-invariant input work out of the collection loop", () => {
    const source = Compiler.emitRulesManySource(rulesDescriptor(DecisionRules));
    const loop = source.slice(source.indexOf("for (let i"));

    expect(source).toContain("const p0 = inputs.riskScore;");
    expect(loop).not.toContain("inputs.");
  });

  it("drops the inputs parameter when no rule declares inputs", () => {
    const rules = JIT.rules(Transaction).rule("domestic", { when: (query) => query.eq("country", "BR") });

    expect(Compiler.emitRulesSomeSource(rulesDescriptor(rules))).toContain("function rulesSome(subject) {");
    expect(rules.some(transaction)).toBe(true);
  });

  it("keeps the boolean sinks allocation free", () => {
    const descriptor = rulesDescriptor(DecisionRules);

    for (const source of [
      Compiler.emitRulesTestSource(descriptor),
      Compiler.emitRulesSomeSource(descriptor),
      Compiler.emitRulesFirstSource(descriptor),
      Compiler.emitRulesPredicateSource(descriptor, "block"),
    ]) {
      expect(source).not.toMatch(/\[\]|\{ |new |\.push\(|Object\./);
    }
    expect(Compiler.emitRulesVisitorSource(descriptor)).not.toContain("const out = []");
    expect(Compiler.emitRulesMatchSource(descriptor)).toContain("const out = []");
  });
});

describe("JIT.rules differential and property coverage", () => {
  const values = [
    transaction,
    { ...transaction, amount: 20_000 },
    { ...transaction, country: "US" },
    { id: 9, amount: 0, country: "" },
  ];
  const inputSets = [low, high, { riskScore: 80, accountAgeDays: 7 }, { riskScore: 95, accountAgeDays: 6 }];

  it("agrees with a generic interpreter on every sink", () => {
    const descriptor = rulesDescriptor(DecisionRules);

    for (const value of values) {
      for (const inputs of inputSets) {
        const expected = referenceMatch(descriptor, value, inputs);

        expect(DecisionRules.match(value, inputs)).toEqual(expected);
        expect(DecisionRules.some(value, inputs)).toBe(expected.length > 0);
        expect(DecisionRules.first(value, inputs)).toBe(expected[0]);
        expect(DecisionRules.explain(value, inputs).matched).toEqual(expected);
        for (const id of DecisionRules.ids) {
          expect(DecisionRules.test(id, value, inputs)).toBe(expected.includes(id));
        }
      }
    }
  });

  it("agrees with the interpreter on random rule trees", () => {
    const Subject = JIT.object({ a: JIT.number(), b: JIT.number(), c: JIT.number() });
    const fields = ["a", "b", "c"] as const;
    const operators = ["eq", "neq", "gt", "gte", "lt", "lte"] as const;
    let seed = 0x2f6e2b1;
    const next = (bound: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed % bound;
    };
    type Builder = Parameters<Parameters<typeof plan.rule>[1]["when"]>[0];
    const build = (query: Builder, input: { field(key: "threshold"): never }, depth: number): never => {
      if (depth === 0 || next(3) === 0) {
        const operator = operators[next(operators.length)] as (typeof operators)[number];
        const field = fields[next(fields.length)] as (typeof fields)[number];

        return query[operator](field, next(2) === 0 ? next(5) : input.field("threshold")) as never;
      }
      const left = build(query, input, depth - 1);
      const right = build(query, input, depth - 1);
      const kind = next(3);

      if (kind === 0) return query.and(left, right) as never;
      if (kind === 1) return query.or(left, right) as never;
      return query.not(left) as never;
    };

    let plan = JIT.rules(Subject).inputs({ threshold: JIT.number() });

    for (let index = 0; index < 24; index++) {
      plan = plan.rule(`r${index}` as never, {
        priority: next(3),
        when: (query, input) => build(query as Builder, input as never, 3),
      }) as typeof plan;
    }

    const descriptor = rulesDescriptor(plan);
    const compiled = plan as unknown as {
      match(subject: unknown, inputs: unknown): string[];
      some(subject: unknown, inputs: unknown): boolean;
      first(subject: unknown, inputs: unknown): string | undefined;
      test(rule: string, subject: unknown, inputs: unknown): boolean;
    };

    for (let round = 0; round < 200; round++) {
      const subject = { a: next(5), b: next(5), c: next(5) };
      const inputs = { threshold: next(5) };
      const expected = referenceMatch(descriptor, subject, inputs);

      expect(compiled.match(subject, inputs)).toEqual(expected);
      expect(compiled.some(subject, inputs)).toBe(expected.length > 0);
      expect(compiled.first(subject, inputs)).toBe(expected[0]);
      for (const id of descriptor.ids) {
        expect(compiled.test(id, subject, inputs)).toBe(expected.includes(id));
      }
    }
  });
});
