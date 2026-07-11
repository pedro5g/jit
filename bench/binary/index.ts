import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { JIT } from "jit";
import { z } from "zod";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const GENERIC_BIAS = "handwritten fused loop, not a published library";
const VALIDATION_BIAS = "validates the full input before running the native JS filter/map";
const SIZES = [10_000, 100_000, 1_000_000] as const;

const User = JIT.object({
  id: JIT.number().int32(),
  name: JIT.string(),
  role: JIT.union(JIT.literal("admin"), JIT.literal("member"), JIT.literal("blocked")),
  active: JIT.boolean(),
  score: JIT.number().float32(),
  note: JIT.string().optional(),
});
const Users = JIT.array(User);

type User = JIT.infer<typeof User>;
type PublicUser = { readonly id: number; readonly name: string; readonly score: number };

const zodUser = z.object({
  id: z.number().int(),
  name: z.string(),
  role: z.union([z.literal("admin"), z.literal("member"), z.literal("blocked")]),
  active: z.boolean(),
  score: z.number(),
  note: z.string().optional(),
});
const zodUsers = z.array(zodUser);

const typeboxUser = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  role: Type.Union([Type.Literal("admin"), Type.Literal("member"), Type.Literal("blocked")]),
  active: Type.Boolean(),
  score: Type.Number(),
  note: Type.Optional(Type.String()),
});
const typeboxUsers = Type.Array(typeboxUser);

for (const size of SIZES) {
  const users = createUsers(size);
  const binary = Users.binary({ strategy: "exact" });
  const rowset = binary.load(users);
  const byteQuery = JIT.query(rowset)
    .filter((q) => q.and(q.eq("role", "admin"), q.and(q.eq("active", true), q.gt("score", 500))))
    .select("id", "name", "score")
    .compile();
  const regularQuery = JIT.query(Users)
    .filter((q) => q.and(q.eq("role", "admin"), q.and(q.eq("active", true), q.gt("score", 500))))
    .select("id", "name", "score")
    .compile();
  const exactPipeline = JIT.process(User)
    .binary({ strategy: "exact" })
    .filter((q) => q.and(q.eq("role", "admin"), q.and(q.eq("active", true), q.gt("score", 500))))
    .select("id", "name", "score")
    .compile();
  const dynamicPipeline = JIT.process(User)
    .binary({ strategy: "dynamic", initialBytes: 1024 * 1024 })
    .filter((q) => q.and(q.eq("role", "admin"), q.and(q.eq("active", true), q.gt("score", 500))))
    .select("id", "name", "score")
    .compile();

  registerScenario({
    op: "binary query preloaded",
    name: `${size} users`,
    args: [rowset],
    jit: byteQuery,
    competitors: [
      { name: "JIT query over JS array", fn: () => regularQuery(users) },
      { name: "handwritten JS filter/map", fn: () => handwritten(users), biased: GENERIC_BIAS },
    ],
  });

  registerScenario({
    op: "binary process load+query",
    name: `${size} users`,
    args: [users],
    jit: exactPipeline.execute,
    competitors: [
      { name: "JIT binary dynamic load+query", fn: dynamicPipeline.execute },
      { name: "JIT query over JS array", fn: regularQuery },
      { name: "handwritten JS filter/map", fn: handwritten, biased: GENERIC_BIAS },
      { name: "Zod 4 parse + native filter/map", fn: zodFlow, biased: VALIDATION_BIAS },
      { name: "TypeBox Value.Check + native filter/map", fn: typeboxFlow, biased: VALIDATION_BIAS },
    ],
  });
}

function createUsers(count: number): User[] {
  const out = new Array<User>(count);

  for (let index = 0; index < count; index++) {
    out[index] = {
      id: index + 1,
      name: `user-${index}`,
      role: index % 11 === 0 ? "blocked" : index % 3 === 0 ? "admin" : "member",
      active: index % 5 !== 0,
      score: index % 1000,
      note: index % 7 === 0 ? `note-${index}` : undefined,
    };
  }
  return out;
}

function handwritten(input: readonly User[]): PublicUser[] {
  const out = new Array<PublicUser>(input.length);
  let cursor = 0;

  for (let index = 0; index < input.length; index++) {
    const user = input[index];

    if (user.role !== "admin" || user.active !== true || user.score <= 500) continue;
    out[cursor++] = { id: user.id, name: user.name, score: user.score };
  }
  out.length = cursor;
  return out;
}

function zodFlow(input: readonly User[]): PublicUser[] {
  return handwritten(zodUsers.parse(input));
}

function typeboxFlow(input: readonly User[]): PublicUser[] {
  if (!Value.Check(typeboxUsers, input)) throw new Error("invalid typebox bench input");
  return handwritten(input);
}

await runSuite("binary");
