import { JIT } from "jit";
import { registerScenario } from "../shared/scenario.js";

const GENERIC_BIAS = "handwritten generic baseline, not a published library";

interface QueryUser {
  readonly id: number;
  readonly name: string;
  readonly age: number;
  readonly role: string;
}

const QueryUserSchema = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  age: JIT.number(),
  role: JIT.string(),
});

const QueryUsersSchema = JIT.array(QueryUserSchema);

function createQueryUsers(length: number): QueryUser[] {
  const out = new Array<QueryUser>(length);

  for (let i = 0; i < length; i++) {
    out[i] = {
      id: i,
      name: `user-${i}`,
      age: 16 + (i % 60),
      role: i % 3 === 0 ? "admin" : i % 3 === 1 ? "editor" : "viewer",
    };
  }

  return out;
}

export function registerQueryScenarios(): void {
  const users = createQueryUsers(10_000);
  const smallUsers = createQueryUsers(100);

  const filterAdults = JIT.query(QueryUsersSchema)
    .filter((q) => q.gt("age", 18))
    .compile();

  registerScenario({
    op: "query filter",
    name: "users 10000",
    args: [users],
    jit: filterAdults,
    competitors: [
      {
        name: "native filter",
        fn: (value: QueryUser[]) => value.filter((user) => user.age > 18),
      },
      {
        name: "handwritten loop",
        fn: (value: QueryUser[]) => {
          const out = new Array(value.length);
          let j = 0;
          for (let i = 0; i < value.length; i++) {
            const user = value[i];
            if (user.age > 18) out[j++] = user;
          }
          out.length = j;
          return out;
        },
        biased: GENERIC_BIAS,
      },
    ],
  });

  const filterSelect = JIT.query(QueryUsersSchema)
    .filter((q) => q.and(q.gt("age", 18), q.neq("role", "viewer")))
    .select("id", "name")
    .compile();

  registerScenario({
    op: "query filter+select",
    name: "users 10000",
    args: [users],
    jit: filterSelect,
    competitors: [
      {
        name: "native filter+map",
        fn: (value: QueryUser[]) =>
          value
            .filter((user) => user.age > 18 && user.role !== "viewer")
            .map((user) => ({
              id: user.id,
              name: user.name,
            })),
      },
    ],
  });

  const uniqueRoles = JIT.query(QueryUsersSchema)
    .filter((q) => q.gt("age", 18))
    .unique("role")
    .select("role")
    .compile();

  registerScenario({
    op: "query filter+unique",
    name: "users 10000",
    args: [users],
    jit: uniqueRoles,
    competitors: [
      {
        name: "native filter+Set",
        fn: (value: QueryUser[]) => {
          const seen = new Set<string>();
          const out: { role: string }[] = [];
          for (const user of value) {
            if (user.age > 18 && !seen.has(user.role)) {
              seen.add(user.role);
              out.push({ role: user.role });
            }
          }
          return out;
        },
        biased: GENERIC_BIAS,
      },
    ],
  });

  const groupByRole = JIT.query(QueryUsersSchema)
    .filter((q) => q.gt("age", 18))
    .groupBy("role")
    .select("id", "name")
    .compile();

  registerScenario({
    op: "query filter+groupBy",
    name: "users 10000",
    args: [users],
    jit: groupByRole,
    competitors: [
      {
        name: "native reduce groupBy",
        fn: (value: QueryUser[]) =>
          value
            .filter((user) => user.age > 18)
            .reduce<Record<string, { id: number; name: string }[]>>((acc, user) => {
              (acc[user.role] ??= []).push({ id: user.id, name: user.name });
              return acc;
            }, {}),
      },
    ],
  });

  const promote = JIT.query(QueryUsersSchema)
    .filter((q) => q.gt("age", 40))
    .update({ role: "senior" })
    .compile();

  registerScenario({
    op: "query update",
    name: "users 10000",
    args: [users],
    jit: promote,
    competitors: [
      {
        name: "native map spread",
        fn: (value: QueryUser[]) => value.map((user) => (user.age > 40 ? { ...user, role: "senior" } : user)),
      },
    ],
  });

  const sumAdultAges = JIT.query(QueryUsersSchema)
    .filter((q) => q.gt("age", 18))
    .sum("age")
    .compile();

  registerScenario({
    op: "query filter+sum",
    name: "users 10000",
    args: [users],
    jit: sumAdultAges,
    competitors: [
      {
        name: "native filter+reduce",
        fn: (value: QueryUser[]) => value.filter((user) => user.age > 18).reduce((total, user) => total + user.age, 0),
      },
      {
        name: "handwritten loop",
        fn: (value: QueryUser[]) => {
          let total = 0;
          for (let i = 0; i < value.length; i++) {
            const user = value[i];
            if (user.age > 18) total += user.age;
          }
          return total;
        },
        biased: GENERIC_BIAS,
      },
    ],
  });

  const filterSmall = JIT.query(QueryUsersSchema)
    .filter((q) => q.and(q.gt("age", 18), q.eq("role", "admin")))
    .compile();

  registerScenario({
    op: "query filter",
    name: "users 100",
    args: [smallUsers],
    jit: filterSmall,
    competitors: [
      {
        name: "native filter",
        fn: (value: QueryUser[]) => value.filter((user) => user.age > 18 && user.role === "admin"),
      },
    ],
  });
}
