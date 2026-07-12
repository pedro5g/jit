import { JIT } from "@pedro5g/jit";
import { createUsers, type MediumUser, MediumUserSchema } from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";
import { genericGroupBy, genericNormalize, genericSortBy, genericUniqueBy } from "./generic.js";

const GENERIC_BIAS = "handwritten generic baseline, not a published library";

interface RoleUser {
  readonly id: number;
  readonly name: string;
  readonly role: string;
}

function createRoleUsers(length: number): RoleUser[] {
  const out = new Array<RoleUser>(length);

  for (let i = 0; i < length; i++) {
    out[i] = { id: i, name: `user-${i}`, role: i % 3 === 0 ? "admin" : i % 3 === 1 ? "editor" : "viewer" };
  }

  return out;
}

export function registerKeyedOps(): void {
  const users = createUsers(10_000);
  const roleUsers = createRoleUsers(10_000);

  const KeyedUsersSchema = JIT.array(MediumUserSchema).keyed("id");
  const RoleUserSchema = JIT.object({
    id: JIT.number(),
    name: JIT.string(),
    role: JIT.string(),
  });
  const RoleUsersSchema = JIT.array(RoleUserSchema).keyed("id").groupBy("role");

  registerScenario({
    op: "normalize",
    name: "users 10000",
    args: [users],
    jit: JIT.compileNormalize(KeyedUsersSchema.schema),
    competitors: [
      {
        name: "generic reduce normalize",
        fn: (value: MediumUser[]) => genericNormalize(value, "id"),
        biased: GENERIC_BIAS,
      },
    ],
  });

  registerScenario({
    op: "groupBy",
    name: "role users 10000",
    args: [roleUsers],
    jit: JIT.compileGroupBy(RoleUsersSchema.schema),
    competitors: [
      {
        name: "generic reduce groupBy",
        fn: (value: RoleUser[]) => genericGroupBy(value, "role"),
        biased: GENERIC_BIAS,
      },
    ],
  });

  registerScenario({
    op: "sortBy",
    name: "users 10000",
    args: [users],
    jit: JIT.compileSortBy(JIT.array(MediumUserSchema).sortBy("id", "desc").schema),
    competitors: [
      {
        name: "generic sortBy",
        fn: (value: MediumUser[]) => genericSortBy<MediumUser>(value, "id", "desc"),
        biased: GENERIC_BIAS,
      },
    ],
  });

  registerScenario({
    op: "uniqueBy",
    name: "users 10000",
    args: [users],
    jit: JIT.compileUniqueBy(JIT.array(MediumUserSchema).uniqueBy("id").schema),
    competitors: [
      {
        name: "generic filter uniqueBy",
        fn: (value: MediumUser[]) => genericUniqueBy(value, "id"),
        biased: GENERIC_BIAS,
      },
    ],
  });
}
