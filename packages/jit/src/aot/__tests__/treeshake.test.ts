import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { AOT, JIT } from "../../index.js";

describe("JIT AOT tree-shaking (real bundler proof)", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "jit-treeshake-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  async function bundle(entrySource: string): Promise<string> {
    const entry = join(outDir, "entry.mjs");

    writeFileSync(entry, entrySource);

    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      write: false,
      minify: false,
      treeShaking: true,
    });

    return result.outputFiles[0].text;
  }

  it("should keep only the imported flat operation in the final bundle", async () => {
    const User = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
      email: JIT.string().email(),
    });
    const isUser = JIT.validate.is(User);

    AOT.generate({ groups: {}, artifacts: { User_is: isUser }, outDir });

    const bundled = await bundle(
      `import { User_is } from "./index.js";\nconsole.log(User_is({ id: 1, name: "Ada", email: "ada@math.org" }));\n`
    );

    // Only the validator survives; every other compiled operation is gone.
    expect(bundled).toContain("function is(");
    expect(bundled).not.toContain("stringify");
    expect(bundled).not.toContain("encode");
    expect(bundled).not.toContain("clone");
    expect(bundled).not.toContain("JITValidationError"); // parse unused
    expect(bundled).not.toContain("Object.freeze"); // namespace dropped
  });

  it("should drop unused flat exports from the final app bundle", async () => {
    const User = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
      email: JIT.string().email(),
    });
    const isUser = JIT.validate.is(User);
    const parseUser = JIT.validate.parse(User);
    const stringify = JIT.json.stringify(User);

    AOT.generate({
      groups: {},
      artifacts: {
        User_is: isUser,
        User_parse: parseUser,
        User_stringify: stringify,
      },
      outDir,
    });

    const generated = readFileSync(join(outDir, "index.js"), "utf8");
    const bundled = await bundle(
      `import { User_is } from "./index.js";\nconsole.log(User_is({ id: 1, name: "Ada", email: "ada@math.org" }));\n`
    );

    expect(generated).toContain("const User_parse");
    expect(generated).toContain("const User_stringify");
    expect(generated).toContain("class JITValidationError extends Error");
    expect(bundled).toContain("User_is");
    expect(bundled).not.toContain("User_parse");
    expect(bundled).not.toContain("User_stringify");
    expect(bundled).not.toContain("JITValidationError");
    expect(bundled).not.toContain("function stringify");
  });

  it("should keep only the stages used by a composed JSON collection pipeline", async () => {
    const User = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
      active: JIT.boolean(),
    });
    const activeUsers = JIT.json
      .parse(JIT.array(User))
      .validate()
      .filter((query) => query.eq("active", true))
      .select("id", "name")
      .to.json();

    AOT.generate({ groups: {}, artifacts: { activeUsers }, outDir });
    const bundled = await bundle(
      `import { activeUsers } from "./index.js";\nconsole.log(activeUsers('[{"id":1,"name":"Ada","active":true}]'));\n`
    );

    expect(bundled).toContain("function query(value)");
    expect(bundled).toContain("function stringify");
    expect(bundled).not.toContain("encodeInto");
    expect(bundled).not.toContain("function clone");
    expect(bundled).not.toContain("function map(source)");
  });

  it("should keep a CQRS filter artifact independent from unrelated operation families", async () => {
    const User = JIT.object({
      id: JIT.number(),
      active: JIT.boolean(),
      score: JIT.number(),
    });
    const activeIds = JIT.cqrs
      .query(User)
      .where((query) => query.eq("active", true))
      .select("id");

    AOT.generate({ artifacts: { activeIds }, outDir });
    const bundled = await bundle(
      `import { activeIds } from "./index.js";\nconsole.log(activeIds([{ id: 1, active: true, score: 10 }]));\n`
    );

    expect(bundled).toContain("const query = (function query");
    expect(bundled).toContain("value[i]");
    expect(bundled).not.toContain("function stringify");
    expect(bundled).not.toContain("encodeInto");
    expect(bundled).not.toContain("function clone");
    expect(bundled).not.toContain("rules.filter");
  });

  it("should ship only the selected rules sink", async () => {
    const Transaction = JIT.object({ amount: JIT.number(), country: JIT.string() });
    const Rules = JIT.rules(Transaction)
      .inputs({ risk: JIT.number() })
      .rule("review", {
        when: (query, input) => query.or(query.gte("amount", 10_000), query.gte(input.field("risk"), 80)),
      })
      .rule("block", {
        priority: 100,
        when: (query, input) => query.and(query.eq("country", "BR"), query.gte(input.field("risk"), 95)),
      });

    AOT.generate({ artifacts: { testRule: Rules.test }, outDir });
    const bundled = await bundle(
      `import { testRule } from "./index.js";\nconsole.log(testRule("block", { amount: 100, country: "BR" }, { risk: 96 }));\n`
    );

    expect(bundled).toContain("function rulesTest");
    expect(bundled).toContain('case "block"');
    expect(bundled).not.toContain("rulesSome");
    expect(bundled).not.toContain("rulesFirst");
    expect(bundled).not.toContain("rulesMatch");
    expect(bundled).not.toContain("const out = []");
    expect(bundled).not.toContain("Object.freeze");
  });

  it("should ship only the selected rules outcome sink", async () => {
    const Transaction = JIT.object({ id: JIT.number().int(), amount: JIT.number(), country: JIT.string() });
    const ManualReview = JIT.object({ transactionId: JIT.number().int(), riskScore: JIT.number() });
    const Rules = JIT.rules(Transaction)
      .inputs({ riskScore: JIT.number() })
      .rule("review", {
        when: (query, input) => query.or(query.gte("amount", 10_000), query.gte(input.field("riskScore"), 80)),
        emit: ManualReview,
        values: (subject) => ({ transactionId: subject.field("id") }),
      })
      .rule("domestic", { when: (query) => query.eq("country", "BR") });

    AOT.generate({ artifacts: { runRules: Rules.run }, outDir });
    const bundled = await bundle(
      'import { runRules } from "./index.js";\nconsole.log(runRules({ id: 1, amount: 100, country: "BR" }, { riskScore: 90 }));\n'
    );

    expect(bundled).toContain("function rulesRun");
    expect(bundled).toContain("transactionId:");
    // A predicate-only rule contributes nothing to `run`, and no other sink ships.
    expect(bundled).not.toContain('"domestic"');
    expect(bundled).not.toContain("rulesMatch");
    expect(bundled).not.toContain("rulesVisit");
    expect(bundled).not.toContain("rulesExplain");
    expect(bundled).not.toContain("evaluated");
  });

  it("should keep a composite aggregate down to accumulators", async () => {
    const Order = JIT.object({ id: JIT.number(), total: JIT.number() });
    const summary = JIT.cqrs
      .query(JIT.array(Order))
      .where((query) => query.gt("total", 10))
      .aggregate({
        count: JIT.cqrs.count(),
        revenue: JIT.cqrs.sum("total"),
        average: JIT.cqrs.avg("total"),
      });

    AOT.generate({ artifacts: { summary }, outDir });
    const bundled = await bundle(
      `import { summary } from "./index.js";\nconsole.log(summary([{ id: 1, total: 50 }]));\n`
    );

    // Three answers, one loop, no group arrays and no second reduce pass.
    expect(bundled.match(/for \(/g)).toHaveLength(1);
    expect(bundled).not.toContain(".reduce(");
    expect(bundled).not.toContain("new Array");
    expect(bundled).not.toContain("Object.keys");
    expect(bundled).not.toContain("function clone");
  });

  it("should keep a grouped aggregate down to one accumulator per group", async () => {
    const Order = JIT.object({ customerId: JIT.string(), total: JIT.number() });
    const perCustomer = JIT.cqrs
      .query(JIT.array(Order))
      .groupBy("customerId")
      .aggregate({ count: JIT.cqrs.count(), total: JIT.cqrs.sum("total") });

    AOT.generate({ artifacts: { perCustomer }, outDir });
    const bundled = await bundle(
      `import { perCustomer } from "./index.js";\nconsole.log(perCustomer([{ customerId: "c1", total: 50 }]));\n`
    );

    // One pass, an accumulator per group, and no array to hold the rows.
    expect(bundled.match(/for \(/g)).toHaveLength(1);
    expect(bundled).toContain("out[collectKey] = group;");
    expect(bundled).toContain("group = {");
    expect(bundled).not.toContain("group = [");
    expect(bundled).not.toContain(".push(");
    expect(bundled).not.toContain(".reduce(");
  });

  it("should keep a join independent from unrelated CQRS and operation families", async () => {
    const Order = JIT.object({ customerId: JIT.string(), total: JIT.number() });
    const Customer = JIT.object({ id: JIT.string(), name: JIT.string() });
    const joinOrders = JIT.cqrs.query(Order).join(Customer).on("customerId", "id");

    AOT.generate({ artifacts: { joinOrders }, outDir });
    const bundled = await bundle(
      `import { joinOrders } from "./index.js";\nconsole.log(joinOrders([{ customerId: "c1", total: 10 }], [{ id: "c1", name: "Ada" }]));\n`
    );

    expect(bundled).toMatch(/function join\d*\(left, right\)/);
    expect(bundled).toContain("new Map()");
    expect(bundled).not.toContain(".find(");
    expect(bundled).not.toContain("function stringify");
    expect(bundled).not.toContain("function clone");
    expect(bundled).not.toContain("CachedIndexLookup");
    expect(bundled).not.toContain("HashJoin");
  });

  it("should keep structural distinct independent from unrelated operation families", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const distinctUsers = JIT.cqrs.query(User).distinct();

    AOT.generate({ artifacts: { distinctUsers }, outDir });
    const bundled = await bundle(
      `import { distinctUsers } from "./index.js";\nconsole.log(distinctUsers([{ id: 1, name: "Ada" }]));\n`
    );

    expect(bundled).toContain("function __distinctAccept");
    expect(bundled).toContain("__distinctEqual(bucket[i], item)");
    expect(bundled).not.toContain("JSON.stringify");
    expect(bundled).not.toContain("function stringify");
    expect(bundled).not.toContain("function clone");
    expect(bundled).not.toContain("HashJoin");
  });

  /**
   * A lookup is the smallest thing the planner produces, so it is the clearest
   * proof that choosing an algorithm costs nothing at runtime: the binary path
   * carries no index, and the scan path carries neither.
   */
  it("should ship only the access path a lookup resolved to", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const userByName = JIT.lookup(JIT.array(User)).by("name");

    AOT.generate({ artifacts: { userByName }, outDir });
    const bundled = await bundle(
      `import { userByName } from "./index.js";\nconsole.log(userByName([{ id: 1, name: "Ada" }], "Ada"));\n`
    );

    expect(bundled).toContain("row.name === target");
    // The scan path resolved, so no index, no search and no planner came with it.
    expect(bundled).not.toContain("__cachedIndex");
    expect(bundled).not.toContain("new Map");
    expect(bundled).not.toContain(">>> 1");
    expect(bundled).not.toContain("resolveKeyedAccessChoice");
    expect(bundled).not.toContain("EarlyExitScan");
    expect(bundled).not.toContain("function __distinctAccept");
    expect(bundled).not.toContain("HashJoin");
  });

  it("should build the index once for a keyed lookup and search without one when ordered", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const ordered = JIT.lookup(JIT.array(User).ordered("id", "asc").uniqueBy("id"));

    AOT.generate({ artifacts: { ordered }, outDir });
    const bundled = await bundle(
      `import { ordered } from "./index.js";\nconsole.log(ordered([{ id: 1, name: "Ada" }], 1));\n`
    );

    expect(bundled).toContain(">>> 1");
    expect(bundled).not.toContain("__cachedIndex");
    expect(bundled).not.toContain("new Map");
  });

  /**
   * A narrowed reconciliation is the strongest tree-shaking claim in the
   * library: turning a channel off has to remove the code that would have
   * served it, not merely hide its result.
   */
  it("should ship only the channels a reconciliation asked for", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const addedOnly = JIT.state.reconcile(JIT.array(User).keyed("id"), {
      removed: false,
      changed: false,
      unchanged: false,
    });

    AOT.generate({ artifacts: { addedOnly }, outDir });
    const bundled = await bundle(
      `import { addedOnly } from "./index.js";\nconsole.log(addedOnly([], [{ id: 1, name: "Ada" }]));\n`
    );

    expect(bundled).toContain("index.get(id)");
    // Nothing depends on comparing rows, so no equality was generated at all.
    expect(bundled).not.toContain("__reconcileEqual");
    expect(bundled).not.toContain("index.values()");
    expect(bundled).not.toContain("index.delete");
    expect(bundled).not.toContain("function diff");
    expect(bundled).not.toContain("HashJoin");
    expect(bundled).not.toContain("function __distinctAccept");
  });

  it("should carry a diff into a reconciliation only when one was declared", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const withDiff = JIT.state.reconcile(JIT.array(User).keyed("id")).changes("diff");
    const withoutDiff = JIT.state.reconcile(JIT.array(User).keyed("id"));

    AOT.generate({ artifacts: { withDiff }, outDir });
    const diffed = await bundle(
      `import { withDiff } from "./index.js";\nconsole.log(withDiff([], [{ id: 1, name: "Ada" }]));\n`
    );

    AOT.generate({ artifacts: { withoutDiff }, outDir });
    const plain = await bundle(
      `import { withoutDiff } from "./index.js";\nconsole.log(withoutDiff([], [{ id: 1, name: "Ada" }]));\n`
    );

    expect(diffed).toContain("__reconcileDiff");
    expect(plain).not.toContain("__reconcileDiff");
    expect(plain.length).toBeLessThan(diffed.length);
  });

  it("should ship a projection as a literal, and a selective compare as a two-field equality", async () => {
    const Profile = JIT.object({ name: JIT.string(), bio: JIT.string() });
    const User = JIT.object({ id: JIT.number(), secret: JIT.string(), profile: Profile });
    const publicUser = JIT.project(User).select("id", "profile.name");
    const sameIdentity = JIT.compare.equal(User).select("id");

    AOT.generate({ artifacts: { publicUser, sameIdentity }, outDir });
    // The consumer builds its input elsewhere, so the bundle's only mention of
    // an unselected field would have to come from the generated code.
    const bundled = await bundle(
      `import { publicUser, sameIdentity } from "./index.js";\nconsole.log(publicUser(JSON.parse(process.argv[2])), sameIdentity);\n`
    );

    expect(bundled).toContain('"id": value.id');
    // The fields nobody selected are absent, not merely unused.
    expect(bundled).not.toContain("secret");
    expect(bundled).not.toContain("bio");
    expect(bundled).not.toContain("Object.keys");
    expect(bundled).not.toContain("ProjectionTree");
  });

  /**
   * The plan's headline claim for authorization: declarative rules become
   * direct checks, and nothing that resembles a rule engine survives.
   */
  it("should ship an ability as a switch, with no rule engine behind it", async () => {
    const User = JIT.object({ id: JIT.number(), role: JIT.string() });
    const Post = JIT.object({ id: JIT.number(), authorId: JIT.number(), locked: JIT.boolean() });
    const canEditPost = JIT.access(Post)
      .actor(User)
      .can("read")
      .can("update", (query, actor) => query.eq("authorId", actor.field("id")))
      .cannot("delete", (query) => query.eq("locked", true));

    AOT.generate({ artifacts: { canEditPost }, outDir });
    const bundled = await bundle(
      `import { canEditPost } from "./index.js";\nconsole.log(canEditPost(JSON.parse(process.argv[2])).can("update", JSON.parse(process.argv[3])));\n`
    );

    expect(bundled).toContain("subject.authorId === actor.id");
    expect(bundled).toContain('case "read"');
    // No rule array, no matcher, no condition interpreter.
    expect(bundled).not.toContain("rules");
    expect(bundled).not.toContain(".filter(");
    expect(bundled).not.toContain("conditions");
    expect(bundled).not.toContain("effect");
    // And nothing from the unrelated operation families.
    expect(bundled).not.toContain("function __distinctAccept");
    expect(bundled).not.toContain("HashJoin");
    expect(bundled).not.toContain("__parsePointer");
  });

  it("should compile an access path in, and no planner with it", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const byKey = JIT.cqrs
      .query(JIT.array(User).keyed("id"))
      .params({ id: JIT.number() })
      .where((query, params) => query.eq("id", params.id))
      .first();
    const byOrder = JIT.cqrs
      .query(JIT.array(User).ordered("id", "asc").uniqueBy("id"))
      .params({ id: JIT.number() })
      .where((query, params) => query.eq("id", params.id))
      .first();

    AOT.generate({ artifacts: { byKey, byOrder }, outDir });
    const keyBundle = await bundle(
      `import { byKey } from "./index.js";\nconsole.log(byKey([{ id: 1, name: "Ada" }], { id: 1 }));\n`
    );
    const orderBundle = await bundle(
      `import { byOrder } from "./index.js";\nconsole.log(byOrder([{ id: 1, name: "Ada" }], { id: 1 }));\n`
    );

    // The chosen strategy is the code; the choosing is not shipped.
    expect(keyBundle).toContain("__cachedIndex(value,");
    expect(keyBundle).not.toContain("CachedIndexLookup");
    expect(keyBundle).not.toContain("strategy");
    expect(keyBundle).not.toContain("resolveHints");
    expect(keyBundle).not.toContain("byOrder");

    // A binary search needs no cache helper at all.
    expect(orderBundle).toContain(">>> 1");
    expect(orderBundle).not.toContain("__cachedIndex");
    expect(orderBundle).not.toContain("new Map()");
    expect(orderBundle).not.toContain("BinarySearch");
  });

  it("should keep a terminal query free of any result collection", async () => {
    const User = JIT.object({ id: JIT.number(), active: JIT.boolean() });
    const firstActive = JIT.cqrs
      .query(JIT.array(User))
      .where((query) => query.eq("active", true))
      .first();

    AOT.generate({ artifacts: { firstActive }, outDir });
    const bundled = await bundle(
      `import { firstActive } from "./index.js";\nconsole.log(firstActive([{ id: 1, active: true }]));\n`
    );

    // The answer leaves the loop; nothing is allocated to hold it.
    expect(bundled).toContain("return item;");
    expect(bundled).not.toContain("new Array");
    expect(bundled).not.toContain("out.length");
    expect(bundled).not.toContain("function stringify");
    expect(bundled).not.toContain("function clone");
  });

  it("should keep a sort plan free of every unrelated compiler and of a generic comparator", async () => {
    const User = JIT.object({
      id: JIT.number(),
      lastName: JIT.string(),
      createdAt: JIT.date(),
    });
    const sortUsers = JIT.sort(User).by("lastName").thenBy("createdAt", "desc");
    const unrelated = JIT.cqrs.query(JIT.array(User)).where((query) => query.eq("id", 1));

    AOT.generate({ artifacts: { sortUsers, unrelated }, outDir });
    const bundled = await bundle(
      `import { sortUsers } from "./index.js";\nconsole.log(sortUsers([{ id: 1, lastName: "Ada", createdAt: new Date(0) }]));\n`
    );

    // The comparator is inlined against the schema: static access, no key list.
    expect(bundled).toContain("left.lastName");
    expect(bundled).toContain("leftRaw1.getTime()");
    expect(bundled).not.toContain("Object.keys");
    expect(bundled).not.toContain("criteria");
    // Neighbouring artifacts and unrelated operation families are dropped.
    expect(bundled).not.toContain("unrelated");
    expect(bundled).not.toContain("function stringify");
    expect(bundled).not.toContain("encodeInto");
    expect(bundled).not.toContain("function clone");
  });

  it("should keep an index plan free of unrelated compilers and of a schema walker", async () => {
    const User = JIT.object({
      id: JIT.number(),
      tenantId: JIT.string(),
      email: JIT.string(),
    });
    const Users = JIT.array(User).keyed("id");
    const byId = JIT.index(Users);
    const unrelated = JIT.sort(User).by("email");

    AOT.generate({ artifacts: { byId, unrelated }, outDir });
    const bundled = await bundle(
      `import { byId } from "./index.js";\nconsole.log(byId([{ id: 1, tenantId: "t", email: "a@x" }]).get(1));\n`
    );

    // The key is inlined from the schema: static access, no key list at runtime.
    expect(bundled).toContain("row.id");
    expect(bundled).toContain("new Map()");
    expect(bundled).not.toContain("Object.keys");
    expect(bundled).not.toContain("descriptor");
    // Neighbouring artifacts and unrelated operation families are dropped.
    expect(bundled).not.toContain("unrelated");
    expect(bundled).not.toContain("function stringify");
    expect(bundled).not.toContain("encodeInto");
    expect(bundled).not.toContain("function clone");
  });

  it("should retain only the co-emitted class required by a construction pipeline", async () => {
    const User = JIT.class(JIT.object({ id: JIT.string(), name: JIT.string() }));
    const parseUser = JIT.json.parse(User).validate();

    AOT.generate({ groups: {}, artifacts: { User, parseUser }, outDir });
    const bundled = await bundle(
      `import { parseUser } from "./index.js";\nconsole.log(parseUser('{"id":"u_1","name":"Ada"}'));\n`
    );

    expect(bundled).toContain("class User");
    expect(bundled).toContain("new User(r.data, true)");
    expect(bundled).not.toContain("@jit-compiler/jit");
    expect(bundled).not.toContain("ExecutionPlan");
    expect(bundled).not.toContain("artifact-registry");
  });

  it("should emit only configured class capabilities and drop unused classes", async () => {
    const Shape = JIT.object({ id: JIT.string(), value: JIT.number() });
    const Comparable = JIT.class(Shape).use(JIT.class.equals);
    const Hashable = JIT.class(Shape).use(JIT.class.hashCode);

    AOT.generate({ groups: {}, artifacts: { Comparable, Hashable }, outDir });
    const generated = readFileSync(join(outDir, "index.js"), "utf8");
    const bundled = await bundle(
      `import { Comparable } from "./index.js";\nconst value = Comparable.create({ id: "a", value: 1 });\nconsole.log(value.equals(value));\n`
    );

    expect(generated).toContain("equals(other)");
    expect(generated).toContain("hashCode()");
    expect(bundled).toContain("equals(other)");
    expect(bundled).not.toContain("hashCode()");
    expect(bundled).not.toContain("Hashable");
  });

  it("should drop entire schemas that are never imported", async () => {
    const User = JIT.object({ id: JIT.number() });
    const Order = JIT.object({ sku: JIT.string() });
    AOT.generate({
      artifacts: {
        User_equal: JIT.compare.equal(User),
        Order_equal: JIT.compare.equal(Order),
      },
      outDir,
    });

    const bundled = await bundle(
      `import { User_equal } from "./index.js";\nconsole.log(User_equal({ id: 1 }, { id: 1 }));\n`
    );

    expect(bundled).toContain("User_equal");
    expect(bundled).not.toContain("Order");
  });

  it("should keep the namespace aggregation only when it is used", async () => {
    const User = JIT.object({ id: JIT.number() });
    const isUser = JIT.validate.is(User);

    AOT.generate({ groups: { User: { is: isUser } }, outDir });

    const bundled = await bundle(`import { User } from "./index.js";\nconsole.log(User.is({ id: 1 }));\n`);

    expect(bundled).toContain("Object.freeze");
  });

  it("should keep match as one switch without a handler registry or unrelated plans", async () => {
    const Event = JIT.discriminatedUnion("type", [
      JIT.object({ type: JIT.literal("created"), id: JIT.number() }),
      JIT.object({ type: JIT.literal("deleted"), id: JIT.number() }),
    ]);
    const handle = JIT.match(Event)
      .case("created", (event) => event.id)
      .case("deleted", (event) => -event.id)
      .exhaustive();

    AOT.generate({ artifacts: { handle }, outDir });
    const bundled = await bundle(
      'import { handle } from "./index.js";\nconsole.log(handle({ type: "created", id: 1 }));\n'
    );

    expect(bundled).toContain("switch (value.type)");
    expect(bundled).not.toContain("handlers[");
    expect(bundled).not.toContain("new Map");
    expect(bundled).not.toContain("csvHeader");
    expect(bundled).not.toContain("QueryProgram");
  });

  it("should keep JSON Patch down to pointer helpers without other patch contracts", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const patchUser = JIT.state.patch.json(User);

    AOT.generate({ artifacts: { patchUser }, outDir });
    const bundled = await bundle(
      'import { patchUser } from "./index.js";\nconsole.log(patchUser({ id: 1, name: "Ada" }, [{ op: "replace", path: "/name", value: "Grace" }]));\n'
    );

    expect(bundled).toContain("function __parsePointer");
    expect(bundled).not.toContain("mergePatch");
    expect(bundled).not.toContain("csvHeader");
    expect(bundled).not.toContain("ndjsonRow");
    expect(bundled).not.toContain("ProjectionTree");
  });

  it("should keep a migration down to its version switch and mapper edges", async () => {
    const V1 = JIT.object({ version: JIT.literal(1), name: JIT.string() });
    const V2 = JIT.object({ version: JIT.literal(2), fullName: JIT.string() });
    const migrate = JIT.migrate(V1).to(V2, { fullName: { from: "name" } });

    AOT.generate({ artifacts: { migrate }, outDir });
    const bundled = await bundle(
      'import { migrate } from "./index.js";\nconsole.log(migrate({ version: 1, name: "Ada" }));\n'
    );

    expect(bundled).toContain("switch (value.version)");
    expect(bundled).toContain("function migrateEdge0");
    expect(bundled).not.toContain("csvRecords");
    expect(bundled).not.toContain("ndjsonLines");
    expect(bundled).not.toContain("JITValidationError");
  });

  it("should keep CSV parsing independent from other transport plans", async () => {
    const Row = JIT.object({ id: JIT.number().int(), name: JIT.string() });
    const parseCsv = JIT.csv.parse(Row);

    AOT.generate({ artifacts: { parseCsv }, outDir });
    const bundled = await bundle('import { parseCsv } from "./index.js";\nconsole.log(parseCsv("id,name\\n1,Ada"));\n');

    expect(bundled).toContain("const decoder = new TextDecoder()");
    expect(bundled).toContain("function csvRow");
    expect(bundled).not.toContain("ndjsonLines");
    expect(bundled).not.toContain("migrateEdge");
    expect(bundled).not.toContain("function clone");
    expect(bundled).not.toContain("function* csvRecords");
  });

  it("should keep a fused NDJSON sink free of CSV, query and projection runtimes", async () => {
    const Row = JIT.object({ id: JIT.number(), active: JIT.boolean() });
    const activeIds = JIT.ndjson
      .parse(Row)
      .where((query) => query.eq("active", true))
      .select("id")
      .to.ndjson();

    AOT.generate({ artifacts: { activeIds }, outDir });
    const bundled = await bundle(
      'import { activeIds } from "./index.js";\nconsole.log(activeIds("{\\"id\\":1,\\"active\\":true}\\n"));\n'
    );

    expect(bundled).toContain("const decoder = new TextDecoder()");
    expect(bundled).toContain("item.active === __q0");
    expect(bundled).not.toContain("const out = []");
    expect(bundled).not.toContain("csvRecords");
    expect(bundled).not.toContain("QueryProgram");
    expect(bundled).not.toContain("ProjectionTree");
    expect(bundled).not.toContain("function* ndjsonLines");
  });
});
