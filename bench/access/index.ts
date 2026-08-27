import { Compiler, JIT } from "../../packages/jit/src/index.js";
import { getArtifact } from "../../packages/jit/src/runtime/artifact-registry.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const User = JIT.object({ id: JIT.number(), role: JIT.string() });
const Post = JIT.object({
  id: JIT.number(),
  authorId: JIT.number(),
  locked: JIT.boolean(),
  title: JIT.string(),
  body: JIT.string(),
});
type User = JIT.Typeof<typeof User>;
type Post = JIT.Typeof<typeof Post>;

const actor: User = { id: 1, role: "user" };
// 1,000 checks land at ~5 ns/check, which is the measurement's own noise floor —
// runtime and AOT emit identical source there and still differ. 100,000 puts the
// scenarios above it.
const posts: Post[] = Array.from({ length: 100_000 }, (_, index) => ({
  id: index,
  authorId: index % 3,
  locked: index % 5 === 0,
  title: `t${index}`,
  body: `b${index}`,
}));

// ------------------------------------------------------- one action, one rule

const simple = JIT.access(Post).actor(User).can("read");
const simpleAbility = simple(actor);

/** What a generic rule engine does per check: scan the rules, match, evaluate. */
interface GenericRule {
  readonly effect: "can" | "cannot";
  readonly action: string;
  readonly conditions?: Readonly<Record<string, unknown>>;
}

function genericCheck(rules: readonly GenericRule[], action: string, subject: Post, actorValue: User): boolean {
  let allowed = false;
  for (const rule of rules) {
    if (rule.action !== action) continue;
    let matches = true;
    if (rule.conditions !== undefined) {
      for (const key of Object.keys(rule.conditions)) {
        const expected = rule.conditions[key];
        const value = (subject as unknown as Record<string, unknown>)[key];
        const resolved = expected === "$actor.id" ? actorValue.id : expected;
        if (value !== resolved) {
          matches = false;
          break;
        }
      }
    }
    if (!matches) continue;
    if (rule.effect === "cannot") return false;
    allowed = true;
  }
  return allowed;
}

const simpleRules: GenericRule[] = [{ effect: "can", action: "read" }];

const sweep = (fn: (subject: Post) => boolean) => (input: readonly Post[]) => {
  let allowed = 0;
  for (let i = 0, len = input.length; i < len; i++) if (fn(input[i] as Post)) allowed++;
  return allowed;
};

registerScenario({
  op: "access",
  name: "1 action / 1 unconditional rule / 100000 checks",
  args: [posts],
  jit: sweep((subject) => simpleAbility.can("read", subject)),
  competitors: [
    { name: "generic rule traversal", fn: sweep((subject) => genericCheck(simpleRules, "read", subject, actor)) },
    { name: "handwritten check", fn: sweep((subject) => subject.id >= 0) },
  ],
});

// ------------------------------------------------- ownership plus deny override

const owned = JIT.access(Post)
  .actor(User)
  .can("delete", (query, self) => query.eq("authorId", self.field("id")))
  .cannot("delete", (query) => query.eq("locked", true));
const ownedAbility = owned(actor);

const ownedRules: GenericRule[] = [
  { effect: "can", action: "delete", conditions: { authorId: "$actor.id" } },
  { effect: "cannot", action: "delete", conditions: { locked: true } },
];

registerScenario({
  op: "access",
  name: "ownership + deny override / 100000 checks",
  args: [posts],
  jit: sweep((subject) => ownedAbility.can("delete", subject)),
  competitors: [
    { name: "generic rule traversal", fn: sweep((subject) => genericCheck(ownedRules, "delete", subject, actor)) },
    {
      name: "handwritten check",
      fn: sweep((subject) => subject.authorId === actor.id && subject.locked !== true),
    },
  ],
});

// --------------------------------------------------------- many actions, many rules

const actions = ["read", "create", "update", "delete", "publish", "archive", "share", "comment"] as const;
let wide = JIT.access(Post).actor(User).can("read");
const wideRules: GenericRule[] = [{ effect: "can", action: "read" }];

for (const action of actions.slice(1)) {
  wide = wide.can(action, (query, self) => query.eq("authorId", self.field("id"))) as never;
  wideRules.push({ effect: "can", action, conditions: { authorId: "$actor.id" } });
}
for (const action of actions.slice(1, 4)) {
  wide = wide.cannot(action, (query) => query.eq("locked", true)) as never;
  wideRules.push({ effect: "cannot", action, conditions: { locked: true } });
}
const wideAbility = wide(actor);

// The last action is the worst case for a scan and the same cost for a switch.
registerScenario({
  op: "access",
  name: "8 actions / 20 rules / last action / 100000 checks",
  args: [posts],
  jit: sweep((subject) => wideAbility.can("archive", subject)),
  competitors: [
    { name: "generic rule traversal", fn: sweep((subject) => genericCheck(wideRules, "archive", subject, actor)) },
    { name: "handwritten check", fn: sweep((subject) => subject.authorId === actor.id) },
  ],
});

// --------------------------------------------------------------- field rules

const fielded = JIT.access(Post)
  .actor(User)
  .can("update", (query, self) => query.eq("authorId", self.field("id")))
  .cannot("update", { fields: ["body"] });
const fieldedAbility = fielded(actor);

registerScenario({
  op: "access",
  name: "field rule / 100000 checks",
  args: [posts],
  jit: sweep((subject) => fieldedAbility.can("update", subject, "title")),
  competitors: [
    {
      name: "handwritten check",
      fn: sweep((subject) => subject.authorId === actor.id && ("title" as string) !== "body"),
    },
  ],
});

// -------------------------------------------------------------------- AOT

function aotOf(
  plan: object
): (actorValue: User) => { can: (action: string, subject?: Post, field?: string) => boolean } {
  const artifact = getArtifact(plan);

  if (artifact?.kind !== "access-plan") throw new Error("access benchmark requires an AccessPlan");
  return globalThis.Function(`return ${Compiler.emitAccessSource(artifact.descriptor)};`)() as never;
}

const aotAbility = aotOf(owned)(actor);

registerScenario({
  op: "access",
  name: "ownership + deny override / AOT / 100000 checks",
  args: [posts],
  jit: sweep((subject) => aotAbility.can("delete", subject)),
  competitors: [
    { name: "JIT runtime", fn: sweep((subject) => ownedAbility.can("delete", subject)) },
    {
      name: "handwritten check",
      fn: sweep((subject) => subject.authorId === actor.id && subject.locked !== true),
    },
  ],
});

await runSuite("access");
