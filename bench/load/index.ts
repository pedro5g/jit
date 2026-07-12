import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AOT, JIT } from "@jit/compiler";
import { FormatRegistry, Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { Value } from "@sinclair/typebox/value";
import { z } from "zod";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";
import { isUsers as typiaIsUsers, validateUsers as typiaValidateUsers } from "../validate/typia-gen/user.js";

const LOAD_10K = 10_000;
const LOAD_100K = 100_000;
const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

FormatRegistry.Set("email", (value) => EMAIL_PATTERN.test(value));

const UserSchema = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2).max(64),
  email: JIT.string().email(EMAIL_PATTERN),
  active: JIT.boolean(),
  tags: JIT.array(JIT.string()).max(8),
  profile: JIT.object({
    age: JIT.number().int().min(0).max(150),
    score: JIT.number(),
  }),
});
const UsersSchema = JIT.array(UserSchema);

const zodUsers = z.array(
  z.object({
    id: z.number().int().positive(),
    name: z.string().min(2).max(64),
    email: z.string().regex(EMAIL_PATTERN),
    active: z.boolean(),
    tags: z.array(z.string()).max(8),
    profile: z.object({
      age: z.number().int().min(0).max(150),
      score: z.number(),
    }),
  })
);

const typeboxUsers = Type.Array(
  Type.Object({
    id: Type.Integer({ exclusiveMinimum: 0 }),
    name: Type.String({ minLength: 2, maxLength: 64 }),
    email: Type.String({ format: "email" }),
    active: Type.Boolean(),
    tags: Type.Array(Type.String(), { maxItems: 8 }),
    profile: Type.Object({
      age: Type.Integer({ minimum: 0, maximum: 150 }),
      score: Type.Number(),
    }),
  })
);
const typeboxCompiledUsers = TypeCompiler.Compile(typeboxUsers);

interface LoadUser {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly active: boolean;
  readonly tags: readonly string[];
  readonly profile: { readonly age: number; readonly score: number };
}

const validUsers10k = createUsers(LOAD_10K);
const validUsers100k = createUsers(LOAD_100K);
const invalidHead100k = withInvalidAt(validUsers100k, 0);
const invalidTail100k = withInvalidAt(validUsers100k, LOAD_100K - 1);

function createUsers(count: number): readonly LoadUser[] {
  const out = new Array<LoadUser>(count);

  for (let index = 0; index < count; index++) {
    out[index] = {
      id: index + 1,
      name: `user-${index}`,
      email: `user-${index}@example.com`,
      active: index % 5 !== 0,
      tags: index % 3 === 0 ? ["admin", "hot"] : ["member"],
      profile: { age: index % 100, score: index % 10_000 },
    };
  }

  return out;
}

function withInvalidAt(users: readonly LoadUser[], index: number): readonly unknown[] {
  const out = users.slice() as unknown[];
  out[index] = {
    id: -1,
    name: "x",
    email: "not-an-email",
    active: "yes",
    tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
    profile: { age: 151, score: "high" },
  };
  return out;
}

interface AotUsersModule {
  readonly Users_is: (value: unknown) => boolean;
  readonly Users_safeParse: (value: unknown) => unknown;
}

async function loadAotUsers(): Promise<AotUsersModule> {
  const outDir = fileURLToPath(new URL("./.generated/", import.meta.url));
  const selected = JIT.validator(UsersSchema).get("is", "safeParse");

  AOT.generate({ schemas: {}, functions: { Users_is: selected.is, Users_safeParse: selected.safeParse }, outDir });
  return (await import(pathToFileURL(join(outDir, "index.mjs")).href)) as AotUsersModule;
}

const typeboxValueCheck = (value: unknown): boolean => Value.Check(typeboxUsers, value);
const typeboxCompiledCheck = (value: unknown): boolean => typeboxCompiledUsers.Check(value);
const zodSafeParseSuccess = (value: unknown): boolean => zodUsers.safeParse(value).success;

const typeboxCompiledErrors = (value: unknown): unknown => {
  if (typeboxCompiledUsers.Check(value)) return { success: true, data: value };
  return { success: false, issues: [...typeboxCompiledUsers.Errors(value)] };
};

export async function registerLoadScenarios(): Promise<void> {
  const validate = JIT.validator(UsersSchema).get("is", "safeParse");
  const aot = await loadAotUsers();

  registerScenario({
    op: "load is",
    name: `valid users ${LOAD_10K}`,
    args: [validUsers10k],
    jit: validate.is,
    competitors: [
      { name: "jit aot is", fn: aot.Users_is },
      { name: "typebox typecompiler check", fn: typeboxCompiledCheck },
      { name: "typebox value check", fn: typeboxValueCheck },
      { name: "typia is users", fn: typiaIsUsers },
      { name: "zod safeParse.success", fn: zodSafeParseSuccess },
    ],
  });

  registerScenario({
    op: "load is",
    name: `valid users ${LOAD_100K}`,
    args: [validUsers100k],
    jit: validate.is,
    competitors: [
      { name: "jit aot is", fn: aot.Users_is },
      { name: "typebox typecompiler check", fn: typeboxCompiledCheck },
      { name: "typebox value check", fn: typeboxValueCheck },
      { name: "typia is users", fn: typiaIsUsers },
      { name: "zod safeParse.success", fn: zodSafeParseSuccess },
    ],
  });

  registerScenario({
    op: "load is",
    name: `invalid head users ${LOAD_100K}`,
    args: [invalidHead100k],
    jit: validate.is,
    competitors: [
      { name: "jit aot is", fn: aot.Users_is },
      { name: "typebox typecompiler check", fn: typeboxCompiledCheck },
      { name: "typebox value check", fn: typeboxValueCheck },
      { name: "typia is users", fn: typiaIsUsers },
      { name: "zod safeParse.success", fn: zodSafeParseSuccess },
    ],
  });

  registerScenario({
    op: "load is",
    name: `invalid tail users ${LOAD_100K}`,
    args: [invalidTail100k],
    jit: validate.is,
    competitors: [
      { name: "jit aot is", fn: aot.Users_is },
      { name: "typebox typecompiler check", fn: typeboxCompiledCheck },
      { name: "typebox value check", fn: typeboxValueCheck },
      { name: "typia is users", fn: typiaIsUsers },
      { name: "zod safeParse.success", fn: zodSafeParseSuccess },
    ],
  });

  registerScenario({
    op: "load safeParse",
    name: `valid users ${LOAD_10K}`,
    args: [validUsers10k],
    jit: validate.safeParse,
    competitors: [
      { name: "jit aot safeParse", fn: aot.Users_safeParse },
      { name: "typia validate users", fn: typiaValidateUsers },
      { name: "typebox typecompiler errors", fn: typeboxCompiledErrors },
      { name: "zod safeParse", fn: (value: unknown) => zodUsers.safeParse(value) },
    ],
  });

  registerScenario({
    op: "load safeParse",
    name: `invalid tail users ${LOAD_100K}`,
    args: [invalidTail100k],
    jit: validate.safeParse,
    competitors: [
      { name: "jit aot safeParse", fn: aot.Users_safeParse },
      { name: "typia validate users", fn: typiaValidateUsers },
      { name: "typebox typecompiler errors", fn: typeboxCompiledErrors },
      { name: "zod safeParse", fn: (value: unknown) => zodUsers.safeParse(value) },
    ],
  });
}

await registerLoadScenarios();

await runSuite("load");
