import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { JIT as DefineJIT } from "../../define.js";
import { AOT, JIT } from "../../index.js";
import { createPriorityRules, registerAotTestHooks, verifyGeneratedTypes } from "./aot-test-utils.js";

let outDir: string;
registerAotTestHooks((directory) => {
  outDir = directory;
});

it("emits each rules sink as direct decision code without a rules runtime", async () => {
  const Rules = createPriorityRules();

  const result = AOT.generate({
    artifacts: {
      Rules,
      testRule: Rules.test,
      hasRule: Rules.some,
      firstRule: Rules.first,
      matchedRules: Rules.match,
    },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Rules: typeof Rules;
    readonly testRule: typeof Rules.test;
    readonly hasRule: typeof Rules.some;
    readonly firstRule: typeof Rules.first;
    readonly matchedRules: typeof Rules.match;
  };
  const transaction = { amount: 100, country: "BR" };
  const inputs = { risk: 96 };

  expect(result.skipped).toHaveLength(0);
  expect(generated.Rules.test("block", transaction, inputs)).toBe(true);
  expect(generated.testRule("review", transaction, inputs)).toBe(true);
  expect(generated.hasRule(transaction, inputs)).toBe(true);
  expect(generated.firstRule(transaction, inputs)).toBe("block");
  expect(generated.matchedRules(transaction, inputs)).toEqual(["block", "review"]);
  expect(generated.Rules.inspect()).toEqual({
    rules: 2,
    liveRules: 2,
    deadRules: [],
    subjectPaths: ["country", "amount"],
    inputPaths: ["risk"],
    deadInputs: [],
    sharedReads: 1,
    sharedPredicates: 0,
    priorityGroups: 2,
    outcomes: 0,
    strategy: "inline",
  });
  expect(Object.isFrozen(generated.Rules.inspect())).toBe(true);
  expect(source).toContain("inputs.risk >= 95");
  expect(source).not.toMatch(/Rule\[|Almanac|operatorRegistry|new Map|from ["']@jit-compiler\/jit/);
});

it("lowers every rules result mode, including domain event outcomes", async () => {
  const Transaction = JIT.object({
    id: JIT.number().int(),
    amount: JIT.number(),
    country: JIT.string(),
  });
  const ManualReview = JIT.dto(
    JIT.object({
      type: JIT.literal("manual-review"),
      transactionId: JIT.number().int(),
      riskScore: JIT.number(),
    })
  );
  const TransactionBlocked = JIT.ddd.domainEvent("transaction.blocked", {
    version: 1,
    payload: JIT.object({
      transactionId: JIT.number().int(),
      reason: JIT.string(),
    }),
  });
  const Rules = JIT.rules(Transaction)
    .inputs({ riskScore: JIT.number() })
    .rule("review", {
      when: (query, input) => query.or(query.gte("amount", 10_000), query.gte(input.field("riskScore"), 80)),
      emit: ManualReview,
      values: (subject) => ({ transactionId: subject.field("id") }),
    })
    .rule("block", {
      priority: 100,
      when: (query, input) => query.and(query.eq("country", "BR"), query.gte(input.field("riskScore"), 95)),
      emit: TransactionBlocked,
      values: (subject) => ({
        transactionId: subject.field("id"),
        reason: "risk",
      }),
    });
  const many = Rules.many();
  const result = AOT.generate({
    artifacts: {
      TransactionBlocked,
      Rules,
      runRules: Rules.run,
      explainRules: Rules.explain,
      blockPredicate: Rules.predicate("block"),
      visitRules: Rules.to.visitor(),
      iterateRules: Rules.to.iterator(),
      classifyMany: many,
      visitMany: many.to.visitor(),
    },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Rules: typeof Rules;
    readonly runRules: typeof Rules.run;
    readonly explainRules: typeof Rules.explain;
    readonly blockPredicate: ReturnType<typeof Rules.predicate>;
    readonly visitRules: ReturnType<typeof Rules.to.visitor>;
    readonly iterateRules: ReturnType<typeof Rules.to.iterator>;
    readonly classifyMany: typeof many;
    readonly visitMany: ReturnType<typeof many.to.visitor>;
  };
  const transaction = { id: 7, amount: 100, country: "BR" };
  const inputs = { riskScore: 96 };
  const visited: string[] = [];

  expect(result.skipped).toHaveLength(0);
  expect(generated.runRules(transaction, inputs)).toMatchObject([
    {
      type: "transaction.blocked",
      payload: { transactionId: 7, reason: "risk" },
    },
    { type: "manual-review", transactionId: 7, riskScore: 96 },
  ]);
  expect(generated.explainRules(transaction, inputs)).toEqual({
    matched: ["block", "review"],
    evaluated: ["block", "review"],
  });
  expect(generated.blockPredicate(transaction, inputs)).toBe(true);
  expect(generated.visitRules(transaction, inputs, (rule) => visited.push(rule))).toBe(2);
  expect(visited).toEqual(["block", "review"]);
  expect([...generated.iterateRules(transaction, inputs)]).toHaveLength(2);
  expect(generated.classifyMany([transaction, transaction], inputs)).toHaveLength(4);
  expect(generated.visitMany([transaction], inputs, () => {})).toBe(2);
  expect(generated.Rules.first(transaction, inputs)).toBe("block");
  expect(generated.Rules.many()([transaction], inputs)).toHaveLength(2);
  // The event constructor is the co-emitted class, never a captured runtime value.
  expect(source).toContain("TransactionBlocked.create({");
  expect(source).not.toMatch(/Almanac|operatorRegistry|from ["']@jit-compiler\/jit/);
});

it("types every rules result mode in the generated declaration", () => {
  const Transaction = JIT.object({
    id: JIT.number().int(),
    amount: JIT.number(),
  });
  const Review = JIT.object({
    transactionId: JIT.number().int(),
    amount: JIT.number(),
  });
  const Rules = JIT.rules(Transaction)
    .inputs({ riskScore: JIT.number() })
    .rule("review", {
      when: (query, input) => query.gte(input.field("riskScore"), 80),
      emit: Review,
      values: (subject) => ({ transactionId: subject.field("id") }),
    })
    .rule("domestic", { when: (query) => query.gte("amount", 1) });
  const typedOutDir = join(outDir, "rules-typed");

  AOT.generate({ artifacts: { Rules }, outDir: typedOutDir, format: "ts" });
  expect(() =>
    verifyGeneratedTypes(
      typedOutDir,
      [
        'import { Rules } from "./index.js";',
        "const transaction = { id: 1, amount: 10 };",
        'const first: "review" | "domestic" | undefined = Rules.first(transaction, { riskScore: 90 });',
        "const outcomes: { transactionId: number; amount: number }[] = Rules.run(transaction, { riskScore: 90 });",
        "const classify = Rules.many();",
        "const many: { transactionId: number; amount: number }[] = classify([transaction], { riskScore: 90 });",
        "const visited: number = classify.to.visitor()([transaction], { riskScore: 90 }, () => {});",
        'const predicate: boolean = Rules.predicate("review")(transaction, { riskScore: 90 });',
        'const strategy: "inline" = Rules.inspect().strategy;',
        "// @ts-expect-error — an id that was never declared is not part of the union",
        'Rules.test("missing", transaction, { riskScore: 90 });',
        "console.log(first, outcomes, many, visited, predicate, strategy);",
        "",
      ].join("\n")
    )
  ).not.toThrow();
}, 30_000);

it("reports a rules outcome whose domain event class is not co-emitted", () => {
  const Transaction = JIT.object({
    id: JIT.number().int(),
    amount: JIT.number(),
  });
  const Flagged = JIT.ddd.domainEvent("transaction.flagged", {
    version: 1,
    payload: JIT.object({ transactionId: JIT.number().int() }),
  });
  const Rules = JIT.rules(Transaction).rule("large", {
    when: (query) => query.gte("amount", 10_000),
    emit: Flagged,
    values: (subject) => ({ transactionId: subject.field("id") }),
  });
  const result = AOT.generate({ artifacts: { runRules: Rules.run }, outDir });

  expect(result.skipped).toEqual([
    {
      schema: "runRules",
      operation: "rules.run",
      reason: "AOT rule outcomes require exporting the domain event Runtime Class artifact alongside the rules plan",
    },
  ]);
});

it("lowers authorized query, projection and update without an ability runtime", async () => {
  const Actor = JIT.object({ id: JIT.number() });
  const Post = JIT.object({
    id: JIT.number(),
    authorId: JIT.number(),
    title: JIT.string(),
    secret: JIT.string(),
  });
  const access = JIT.access(Post)
    .actor(Actor)
    .can("read", (query, actor) => query.eq("authorId", actor.field("id")))
    .can("update", {
      fields: ["title"],
      when: (query, actor) => query.eq("authorId", actor.field("id")),
    });
  const ability = access({ id: 1 });
  const read = JIT.cqrs.query(Post).authorize(ability, "read").select("id", "title");
  const shape = JIT.project(Post).authorize(ability, "read");
  const change = JIT.state.patch.apply(Post).authorize(ability, "update");

  const result = AOT.generate({ artifacts: { read, shape, change }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly read: (
      rows: Array<{
        id: number;
        authorId: number;
        title: string;
        secret: string;
      }>
    ) => unknown[];
    readonly shape: (value: { id: number; authorId: number; title: string; secret: string }) => object;
    readonly change: (
      value: { id: number; authorId: number; title: string; secret: string },
      patch: unknown
    ) => { id: number; authorId: number; title: string; secret: string };
  };
  const own = { id: 1, authorId: 1, title: "draft", secret: "s" };
  const other = { id: 2, authorId: 2, title: "other", secret: "x" };

  expect(result.skipped).toHaveLength(0);
  expect(generated.read([own, other])).toEqual([{ id: 1, title: "draft" }]);
  expect(generated.shape(own)).toEqual(own);
  expect(generated.change(own, { title: "published" }).title).toBe("published");
  expect(() => generated.change(other, { title: "blocked" })).toThrowError(
    expect.objectContaining({ code: "ACCESS_DENIED", field: "title" })
  );
  expect(source).not.toContain("AccessPlan");
  expect(source).not.toContain("ability.can");
  expect(source).not.toContain("rules");
});

it("should emit only explicitly grouped operations", async () => {
  const User = JIT.object({ id: JIT.number().int32(), name: JIT.string() });
  const UserRuntime = { is: JIT.validate.is(User), clone: JIT.clone(User) };
  const result = AOT.generate({ groups: { User: UserRuntime }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly User: {
      readonly is: (value: unknown) => boolean;
      readonly clone: <T>(value: T) => T;
    };
  };

  expect(result.skipped).toHaveLength(0);
  expect(Object.keys(generated.User)).toEqual(["is", "clone"]);
  expect(generated.User.is({ id: 1, name: "Ada" })).toBe(true);
  expect(generated.User.clone({ id: 1, name: "Ada" })).toEqual({
    id: 1,
    name: "Ada",
  });
  expect(source).toContain("function is(value)");
  expect(source).toContain("function clone(value)");
  expect(source).not.toContain("function safeParse(value)");
  expect(source).not.toContain("function stringify");
  expect(result.files).toEqual([join(outDir, "index.js")]);
});

it("emits reconstructible match handlers as one standalone switch", async () => {
  const Event = JIT.discriminatedUnion("type", [
    JIT.object({ type: JIT.literal("created"), id: JIT.number() }),
    JIT.object({ type: JIT.literal("deleted"), id: JIT.number() }),
  ]);
  const handle = JIT.match(Event)
    .case("created", (event) => `created:${event.id}`)
    .case("deleted", (event) => `deleted:${event.id}`)
    .exhaustive();

  const result = AOT.generate({ artifacts: { handle }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly handle: (event: { type: "created" | "deleted"; id: number }) => string;
  };

  expect(result.skipped).toHaveLength(0);
  expect(source).toContain("switch (value.type)");
  expect(source).not.toContain('from "@jit-compiler/jit"');
  expect(generated.handle({ type: "created", id: 7 })).toBe("created:7");
});

it("reports a match handler that captures a closure instead of miscompiling it", () => {
  const Event = JIT.discriminatedUnion("type", [JIT.object({ type: JIT.literal("created") })]);
  const prefix = "created";
  const handle = JIT.match(Event)
    .case("created", () => prefix)
    .exhaustive();

  const result = AOT.generate({ artifacts: { handle }, outDir });

  expect(result.skipped).toEqual([
    expect.objectContaining({
      operation: "match",
      reason: expect.stringContaining("closure-dependent"),
    }),
  ]);
});

it("emits fromJSON as native parsing followed by specialized validation", async () => {
  const User = JIT.object({
    id: JIT.number().int32(),
    name: JIT.string().min(2),
  });
  const Json = { fromJSON: JIT.json.parse(User).validate() };

  AOT.generate({ groups: { Json }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");

  expect(source).toContain("JSON.parse");
  expect(source).toContain("safeParse");
  expect(source).not.toContain("const Json_parse");

  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    Json: { fromJSON: (json: string) => { id: number; name: string } };
  };

  expect(generated.Json.fromJSON('{"id":1,"name":"Ada"}')).toEqual({
    id: 1,
    name: "Ada",
  });
});

it("emits an API query boundary as an import-free parser artifact", async () => {
  const User = JIT.object({ id: JIT.string(), age: JIT.number() });
  const ListUsers = JIT.api.query(User, {
    filter: { id: true, age: ["gte"] },
    sort: ["id", "age"],
    select: ["id", "age"],
    pagination: { type: "offset", defaultLimit: 20, maxLimit: 100 },
  });

  const result = AOT.generate({ artifacts: { ListUsers }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly ListUsers: {
      readonly parse: (input: unknown) => unknown;
      readonly explain: () => unknown;
      readonly "~query": { readonly version: number };
    };
  };

  expect(result.skipped).toHaveLength(0);
  expect(source).not.toContain('from "@jit-compiler/jit"');
  expect(source).not.toContain("__reference");
  expect(generated.ListUsers["~query"].version).toBe(1);
  expect(generated.ListUsers.explain()).toEqual(ListUsers.explain());
  expect(generated.ListUsers.parse({ filter: { age: { $gte: 18 } } })).toEqual({
    filter: [{ kind: "gte", path: ["age"], value: 18 }],
    sort: [],
    pagination: { kind: "offset", offset: 0, limit: 20 },
  });
  expect(() => generated.ListUsers.parse([])).toThrow(/invalid API query input/i);
  expect(() => generated.ListUsers.parse({ filter: { id: { $eq: "u_1" } } })).toThrow(/invalid API query input/i);
  expect(() => generated.ListUsers.parse({ sort: "age,age" })).toThrow(/invalid API query input/i);
  expect(() => generated.ListUsers.parse({ fields: "id,id" })).toThrow(/invalid API query input/i);
  expect(() => generated.ListUsers.parse({ fields: "" })).toThrow(/invalid API query input/i);
  expect(() => generated.ListUsers.parse({ sort: 42 })).toThrow(/invalid API query input/i);
  expect(() => generated.ListUsers.parse({ unknown: true })).toThrow(/invalid API query input/i);
  expect(() => generated.ListUsers.parse({ page: Number.MAX_SAFE_INTEGER, limit: 100 })).toThrow(
    /invalid API query input/i
  );
  expect(() => generated.ListUsers.parse({ page: 1_000, limit: 100 })).toThrow(/invalid API query input/i);
});

it("emits a derived selector and its memo without a dependency runtime", async () => {
  const AppState = JIT.object({
    user: JIT.object({ name: JIT.string(), tags: JIT.array(JIT.string()) }),
    cart: JIT.object({ items: JIT.number() }),
  });
  const Header = JIT.state.derive(AppState).select("user.name", "user.tags");
  const HeaderMemo = Header.memo();

  const result = AOT.generate({ artifacts: { Header, HeaderMemo }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Header: (state: unknown) => unknown;
    readonly HeaderMemo: ((state: unknown, mask?: number) => unknown) & {
      layout(): { readonly id: string };
    };
  };
  const state = { user: { name: "Ada", tags: ["math"] }, cart: { items: 2 } };

  expect(result.skipped).toHaveLength(0);
  expect(source).not.toContain('from "@jit-compiler/jit"');
  expect(generated.Header(state)).toEqual(Header(state));
  expect(generated.HeaderMemo.layout().id).toBe(HeaderMemo.layout().id);
  const first = generated.HeaderMemo(state);
  // Unrelated change, structurally equal dependency, and the mask shortcut.
  expect(generated.HeaderMemo({ ...state, cart: { items: 3 } })).toBe(first);
  expect(generated.HeaderMemo({ ...state, user: { ...state.user, tags: ["math"] } })).toBe(first);
  expect(generated.HeaderMemo({ ...state, cart: { items: 9 } }, 2)).toBe(first);
  expect(generated.HeaderMemo({ ...state, user: { ...state.user, name: "Grace" } })).not.toBe(first);
});

it("emits the requested mutation channels in one generated pass", async () => {
  const User = JIT.object({
    id: JIT.string(),
    name: JIT.string(),
    profile: JIT.object({ age: JIT.number(), city: JIT.string() }),
  });
  const RenameUser = JIT.state
    .update(User)
    .patch({
      name: JIT.cqrs.param("name"),
      profile: { city: JIT.cqrs.param("city") },
    })
    .result({ value: true, changed: true, patch: true, inverse: true })
    .compile();

  const result = AOT.generate({ artifacts: { RenameUser }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly RenameUser: ((value: unknown, params: Readonly<Record<string, unknown>>) => unknown) & {
      layout(): unknown;
    };
  };
  const value = {
    id: "u_1",
    name: "Ada",
    profile: { age: 36, city: "London" },
  };
  const params = { name: "Grace", city: "Paris" };

  expect(result.skipped).toHaveLength(0);
  expect(source).not.toContain('from "@jit-compiler/jit"');
  expect(generated.RenameUser(value, params)).toEqual(RenameUser(value, params));
  expect(generated.RenameUser.layout()).toEqual(RenameUser.layout());
  expect(generated.RenameUser(value, { name: "Ada", city: "London" })).toEqual({
    value,
    changed: 0,
    patch: undefined,
    inverse: undefined,
  });
});

it("emits a collection mutation with its chosen access path", async () => {
  const User = JIT.object({ id: JIT.string(), name: JIT.string() });
  const Users = JIT.array(User).keyed("id");
  const RenameMember = JIT.state.collection(Users).updateByKey({ key: "id", patch: { name: JIT.cqrs.param("name") } });
  const RemoveMember = JIT.state.collection(Users).removeByKey({ key: "id" });
  const ReplaceMember = JIT.state.collection(Users).replaceByKey({ key: "id" });
  const UpsertMember = JIT.state.collection(Users).upsert({ key: "id" });
  const InsertMember = JIT.state.collection(Users).insertAt();
  const RemoveAt = JIT.state.collection(Users).removeAt();
  const ReplaceAt = JIT.state.collection(Users).replaceAt();
  const UpdateAt = JIT.state.collection(Users).updateAt({ patch: { name: JIT.cqrs.param("name") } });
  const SwapMembers = JIT.state.collection(Users).swap();
  const MoveMember = JIT.state.collection(Users).move();
  const TruncateMembers = JIT.state.collection(Users).truncate();
  const ReplaceWhere = JIT.state.collection(Users).replaceWhere((query) => query.eq("id", JIT.cqrs.param("id")));

  const result = AOT.generate({
    artifacts: {
      RenameMember,
      RemoveMember,
      ReplaceMember,
      UpsertMember,
      InsertMember,
      RemoveAt,
      ReplaceAt,
      UpdateAt,
      SwapMembers,
      MoveMember,
      TruncateMembers,
      ReplaceWhere,
    },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly RenameMember: (value: unknown, params: Readonly<Record<string, unknown>>) => unknown;
    readonly RemoveMember: (value: unknown, params: Readonly<Record<string, unknown>>) => unknown;
    readonly ReplaceMember: (value: unknown, params: Readonly<Record<string, unknown>>) => unknown;
    readonly UpsertMember: (value: unknown, params: Readonly<Record<string, unknown>>) => unknown;
    readonly InsertMember: (value: unknown, params: Readonly<Record<string, unknown>>) => unknown;
    readonly RemoveAt: (value: unknown, params: Readonly<Record<string, unknown>>) => unknown;
    readonly ReplaceAt: (value: unknown, params: Readonly<Record<string, unknown>>) => unknown;
    readonly UpdateAt: (value: unknown, params: Readonly<Record<string, unknown>>) => unknown;
    readonly SwapMembers: (value: unknown, params: Readonly<Record<string, unknown>>) => unknown;
    readonly MoveMember: (value: unknown, params: Readonly<Record<string, unknown>>) => unknown;
    readonly TruncateMembers: (value: unknown, params: Readonly<Record<string, unknown>>) => unknown;
    readonly ReplaceWhere: (value: unknown, params: Readonly<Record<string, unknown>>) => unknown;
  };
  const rows = [
    { id: "a", name: "Ada" },
    { id: "b", name: "Bob" },
  ];

  expect(result.skipped).toHaveLength(0);
  expect(source).not.toContain('from "@jit-compiler/jit"');
  expect(source).not.toContain(".filter(");
  expect(generated.RenameMember(rows, { key: "b", name: "Bee" })).toEqual(
    RenameMember(rows, { key: "b", name: "Bee" })
  );
  expect(generated.RemoveMember(rows, { key: "a" })).toEqual(RemoveMember(rows, { key: "a" }));
  expect(generated.ReplaceMember(rows, { key: "b", row: { id: "b", name: "Bee" } })).toEqual(
    ReplaceMember(rows, { key: "b", row: { id: "b", name: "Bee" } })
  );
  const inserted = { id: "x", name: "X" };
  expect(generated.InsertMember(rows, { index: 1, row: inserted })).toEqual(
    InsertMember(rows, { index: 1, row: inserted })
  );
  expect(generated.RemoveAt(rows, { index: 1 })).toEqual(RemoveAt(rows, { index: 1 }));
  expect(generated.ReplaceAt(rows, { index: 1, row: inserted })).toEqual(ReplaceAt(rows, { index: 1, row: inserted }));
  expect(generated.UpdateAt(rows, { index: 1, name: "Bee" })).toEqual(UpdateAt(rows, { index: 1, name: "Bee" }));
  expect(generated.SwapMembers(rows, { a: 0, b: 1 })).toEqual(SwapMembers(rows, { a: 0, b: 1 }));
  expect(generated.MoveMember(rows, { from: 0, to: 1 })).toEqual(MoveMember(rows, { from: 0, to: 1 }));
  expect(generated.TruncateMembers(rows, { length: 1 })).toEqual(TruncateMembers(rows, { length: 1 }));
  expect(generated.ReplaceWhere(rows, { id: "a", row: { id: "a", name: "Grace" } })).toEqual(
    ReplaceWhere(rows, { id: "a", row: { id: "a", name: "Grace" } })
  );
  // The upsert no-op test is specialized equality, inlined into the module.
  expect(generated.UpsertMember(rows, { key: "b", row: { id: "b", name: "Bob" } })).toBe(rows);
  expect(generated.RenameMember(rows, { key: "b", name: "Bob" })).toBe(rows);
});

it("declares state collection mutations without compiling an executable runtime artifact", async () => {
  const Item = DefineJIT.object({
    id: DefineJIT.string(),
    name: DefineJIT.string(),
  });
  const Items = DefineJIT.array(Item).keyed("id");
  const InsertAt = DefineJIT.state.collection(Items).insertAt();
  const UpdateAt = DefineJIT.state.collection(Items).updateAt({ patch: { name: DefineJIT.cqrs.param("name") } });

  expect(() => InsertAt([], { index: 0, row: { id: "a", name: "Ada" } })).toThrow(
    /cannot be executed from definition files/i
  );

  const result = AOT.generate({ artifacts: { InsertAt, UpdateAt }, outDir });
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly InsertAt: typeof InsertAt;
    readonly UpdateAt: typeof UpdateAt;
  };
  const rows = [{ id: "a", name: "Ada" }];

  expect(result.skipped).toHaveLength(0);
  expect(generated.InsertAt(rows, { index: 1, row: { id: "b", name: "Bob" } })).toEqual([
    rows[0],
    { id: "b", name: "Bob" },
  ]);
  expect(generated.UpdateAt(rows, { index: 0, name: "Grace" })).toEqual([{ id: "a", name: "Grace" }]);
});

it("emits a declared patch as one copy-on-write function", async () => {
  const User = JIT.object({
    id: JIT.string(),
    name: JIT.string(),
    profile: JIT.object({ age: JIT.number(), city: JIT.string() }),
    settings: JIT.object({ theme: JIT.string() }),
  });
  const RenameUser = JIT.state
    .update(User)
    .patch({
      name: JIT.cqrs.param("name"),
      profile: { city: JIT.cqrs.param("city") },
    })
    .compile();

  const result = AOT.generate({ artifacts: { RenameUser }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly RenameUser: (value: unknown, params: Readonly<Record<string, unknown>>) => Record<string, unknown>;
  };
  const value = {
    id: "u_1",
    name: "Ada",
    profile: { age: 36, city: "London" },
    settings: { theme: "dark" },
  };

  expect(result.skipped).toHaveLength(0);
  expect(source).not.toContain('from "@jit-compiler/jit"');
  expect(source).not.toContain("Object.keys");
  expect(generated.RenameUser(value, { name: "Grace", city: "Paris" })).toEqual(
    RenameUser(value, { name: "Grace", city: "Paris" })
  );
  // Structural sharing and the no-op identity survive generation.
  expect(generated.RenameUser(value, { name: "Grace", city: "London" }).settings).toBe(value.settings);
  expect(generated.RenameUser(value, { name: "Ada", city: "London" })).toBe(value);
});

it("emits one effective-request parser for a boundary intersected with access", async () => {
  const Post = JIT.object({
    id: JIT.number(),
    authorId: JIT.number(),
    published: JIT.boolean(),
  });
  const Actor = JIT.object({ id: JIT.number() });
  const Listing = JIT.api.query(Post, {
    filter: { published: true },
    select: ["id", "authorId", "published"],
    sort: ["id", "authorId"],
  });
  const AuthorizedListing = JIT.api.authorize(
    Listing,
    JIT.access(Post)
      .actor(Actor)
      .can("read", {
        fields: ["id", "published"],
        when: (query, actor) => query.or(query.eq("published", true), query.eq("authorId", actor.field("id"))),
      }),
    "read"
  );

  const result = AOT.generate({ artifacts: { AuthorizedListing }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly AuthorizedListing: (input: unknown, actor?: unknown) => unknown;
  };
  const request = {
    filter: { published: true },
    fields: "id,authorId",
    sort: "id",
  };

  expect(result.skipped).toHaveLength(0);
  expect(source).not.toContain('from "@jit-compiler/jit"');
  expect(source).not.toContain("__reference");
  // The actor's own predicate and projection are applied, and the request's
  // unreadable field is dropped rather than reaching the adapter.
  expect(generated.AuthorizedListing(request, { id: 7 })).toEqual(AuthorizedListing(request, { id: 7 }));
  expect(
    (
      generated.AuthorizedListing(request, { id: 7 }) as {
        select: readonly string[];
      }
    ).select
  ).toEqual(["id"]);
  expect(() => generated.AuthorizedListing({ sort: "authorId" }, { id: 7 })).toThrow(/access denied/i);
});

it("carries the semantic budget into the generated boundary parser", async () => {
  const User = JIT.object({ age: JIT.number(), name: JIT.string() });
  const Bounded = JIT.api.query(User, {
    filter: { age: ["gte", "lte"] },
    sort: ["name", "age"],
    limits: { maxCost: 5 },
  });

  const result = AOT.generate({ artifacts: { Bounded }, outDir });
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Bounded: {
      readonly parse: (input: unknown) => unknown;
      readonly explain: () => { readonly cost: { readonly budget: number } };
    };
  };
  const affordable = { filter: { age: { $gte: 18 } }, sort: "name" };

  expect(result.skipped).toHaveLength(0);
  expect(generated.Bounded.explain().cost.budget).toBe(5);
  expect(generated.Bounded.parse(affordable)).toEqual(JIT.api.parse(Bounded)(affordable));
  expect(() =>
    generated.Bounded.parse({
      filter: { age: { $gte: 18, $lte: 30 } },
      sort: "name",
    })
  ).toThrow(/invalid API query input/i);
});

it("preserves the structural query protocol on an AOT static CQRS query", async () => {
  const User = JIT.object({
    id: JIT.string(),
    age: JIT.number(),
    active: JIT.boolean(),
  });
  const ActiveUsers = JIT.cqrs
    .query(User)
    .params({ minimumAge: JIT.number() })
    .where((query, params) => query.gte("age", params.minimumAge))
    .where((query) => query.eq("active", true))
    .select("id", "age")
    .limit(1);
  AOT.generate({ artifacts: { ActiveUsers }, outDir });
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly ActiveUsers: ((
      rows: { id: string; age: number; active: boolean }[],
      params: { minimumAge: number }
    ) => unknown) & {
      readonly "~query": {
        readonly version: number;
        readonly definition: {
          readonly filter?: {
            readonly kind: string;
            readonly operator?: string;
          };
          readonly params?: readonly string[];
          readonly projection?: readonly string[];
          readonly limit?: number;
        };
      };
    };
  };

  expect(generated.ActiveUsers["~query"]).toMatchObject({
    version: 1,
    definition: {
      filter: { kind: "logical", operator: "and" },
      params: ["minimumAge"],
      projection: ["id", "age"],
      limit: 1,
    },
  });
  expect(
    generated.ActiveUsers(
      [
        { id: "u_1", age: 30, active: true },
        { id: "u_4", age: 50, active: true },
        { id: "u_2", age: 17, active: true },
        { id: "u_3", age: 40, active: false },
      ],
      { minimumAge: 18 }
    )
  ).toEqual([{ id: "u_1", age: 30 }]);
});

it("inlines compound cursor decoding for an AOT API query boundary", async () => {
  const User = JIT.object({ id: JIT.string(), createdAt: JIT.string() });
  const ListUsers = JIT.api.query(User, {
    pagination: {
      type: "cursor",
      by: ["createdAt", "id"],
      defaultLimit: 20,
      maxLimit: 100,
    },
  });
  AOT.generate({ artifacts: { ListUsers }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly ListUsers: { readonly parse: (input: unknown) => unknown };
  };

  expect(source).toContain("function decodeCursor(value, size)");
  expect(
    generated.ListUsers.parse({
      after: btoa('["2026-01-01","u_1"]'),
      limit: 10,
    })
  ).toEqual({
    filter: [],
    sort: [
      { path: ["createdAt"], direction: "asc" },
      { path: ["id"], direction: "asc" },
    ],
    pagination: { kind: "cursor", after: ["2026-01-01", "u_1"], limit: 10 },
  });
});
