import { JIT } from "jit";
import { z } from "zod";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const GENERIC_BIAS = "handwritten fused baseline, not a published library";
const COUNT = 50_000;

const User = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2),
  email: JIT.string().email(),
  role: JIT.enum(["admin", "member", "blocked"] as const),
  active: JIT.boolean(),
  score: JIT.number(),
});
const Users = JIT.array(User);
const PublicUser = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  score: JIT.number(),
});
const PublicUsers = JIT.array(PublicUser);

const zodUser = z.object({
  id: z.number().int().positive(),
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(["admin", "member", "blocked"]),
  active: z.boolean(),
  score: z.number(),
});

type User = JIT.infer<typeof User>;
type PublicUser = JIT.infer<typeof PublicUser>;

const users = createUsers(COUNT);
const isUser = JIT.validate(User).is().compile();
const selectAdmins = JIT.query(Users)
  .filter((q) => q.and(q.eq("role", "admin"), q.eq("active", true), q.gt("score", 500)))
  .select("id", "name", "score")
  .compile();
const stringifyPublicUsers = JIT.json(PublicUsers).stringify().compile();

function jitFlow(input: readonly unknown[]): string {
  const valid = new Array<User>(input.length);
  let count = 0;

  for (let index = 0; index < input.length; index++) {
    const value = input[index];

    if (isUser(value)) valid[count++] = value;
  }
  valid.length = count;
  return stringifyPublicUsers(selectAdmins(valid));
}

function zodFlow(input: readonly unknown[]): string {
  const valid: User[] = [];

  for (let index = 0; index < input.length; index++) {
    const parsed = zodUser.safeParse(input[index]);

    if (parsed.success) valid.push(parsed.data);
  }

  return JSON.stringify(
    valid
      .filter((user) => user.role === "admin" && user.active === true && user.score > 500)
      .map((user) => ({ id: user.id, name: user.name, score: user.score }))
  );
}

function handwrittenFlow(input: readonly unknown[]): string {
  const selected: PublicUser[] = [];

  for (let index = 0; index < input.length; index++) {
    const value = input[index];

    if (!isHandwrittenUser(value)) continue;
    if (value.role !== "admin" || value.active !== true || value.score <= 500) continue;
    selected[selected.length] = { id: value.id, name: value.name, score: value.score };
  }
  return JSON.stringify(selected);
}

function isHandwrittenUser(value: unknown): value is User {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;

  const user = value as User;

  return (
    typeof user.id === "number" &&
    Number.isInteger(user.id) &&
    user.id > 0 &&
    typeof user.name === "string" &&
    user.name.length >= 2 &&
    typeof user.email === "string" &&
    user.email.includes("@") &&
    (user.role === "admin" || user.role === "member" || user.role === "blocked") &&
    typeof user.active === "boolean" &&
    typeof user.score === "number"
  );
}

function createUsers(count: number): unknown[] {
  const out = new Array<unknown>(count);

  for (let index = 0; index < count; index++) {
    out[index] = {
      id: index + 1,
      name: `user-${index}`,
      email: `user-${index}@example.com`,
      role: index % 11 === 0 ? "blocked" : index % 3 === 0 ? "admin" : "member",
      active: index % 5 !== 0,
      score: index % 1000,
    };
  }
  return out;
}

registerScenario({
  op: "flow validate+query+json",
  name: `users ${COUNT}`,
  args: [users],
  jit: jitFlow,
  competitors: [
    { name: "zod safeParse + native filter/map/stringify", fn: zodFlow },
    { name: "handwritten fused loop", fn: handwrittenFlow, biased: GENERIC_BIAS },
  ],
});

await runSuite("flows");
