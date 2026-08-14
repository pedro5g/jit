import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AOT, JIT } from "@jit-compiler/jit";
import { z } from "zod";
import { registerScenario } from "../shared/scenario.js";
import {
  assertSimple as typiaAssertSimple,
  assertUser as typiaAssertUser,
  isSimple as typiaIsSimple,
  isUser as typiaIsUser,
  validateSimple as typiaValidateSimple,
  validateUser as typiaValidateUser,
} from "./typia-gen/user.js";

const SimpleSchema = JIT.object({ id: JIT.number().int32(), name: JIT.string() });
const UserSchema = JIT.object({
  id: JIT.number().int32().positive(),
  name: JIT.string().min(2).max(64),
  email: JIT.string().email(),
  active: JIT.boolean(),
  tags: JIT.array(JIT.string()).max(8),
  profile: JIT.object({
    age: JIT.number().int32().min(0).max(150),
    score: JIT.number(),
  }),
});

const zodSimple = z.object({ id: z.number().int(), name: z.string() });
const zodUser = z.object({
  id: z.number().int().positive(),
  name: z.string().min(2).max(64),
  email: z.string().email(),
  active: z.boolean(),
  tags: z.array(z.string()).max(8),
  profile: z.object({ age: z.number().int().min(0).max(150), score: z.number() }),
});

const validSimple = { id: 42, name: "Ada" };
const invalidSimple = { id: 2 ** 31, name: 7 };
const validUser = {
  id: 42,
  name: "Ada Lovelace",
  email: "ada@math.org",
  active: true,
  tags: ["math", "pioneer"],
  profile: { age: 36, score: 99.5 },
};
const invalidUser = {
  id: -1,
  name: "A",
  email: "not-an-email",
  active: "yes",
  tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
  profile: { age: 200, score: "high" },
};

interface AotModule {
  readonly Simple_is: (value: unknown) => boolean;
  readonly Simple_parse: (value: unknown) => unknown;
  readonly Simple_safeParse: (value: unknown) => unknown;
  readonly User_is: (value: unknown) => boolean;
  readonly User_parse: (value: unknown) => unknown;
  readonly User_safeParse: (value: unknown) => unknown;
}

async function loadAot(): Promise<AotModule> {
  const outDir = fileURLToPath(new URL("./.generated/", import.meta.url));

  AOT.generate({
    schemas: {},
    functions: {
      Simple_is: JIT.is(SimpleSchema),
      Simple_parse: JIT.parse(SimpleSchema),
      Simple_safeParse: JIT.safeParse(SimpleSchema),
      User_is: JIT.is(UserSchema),
      User_parse: JIT.parse(UserSchema),
      User_safeParse: JIT.safeParse(UserSchema),
    },
    outDir,
  });
  return (await import(pathToFileURL(join(outDir, "index.js")).href)) as AotModule;
}

export async function registerValidateScenarios(): Promise<void> {
  const aot = await loadAot();

  registerValidationCase(
    "simple object",
    validSimple,
    invalidSimple,
    {
      is: aot.Simple_is,
      parse: aot.Simple_parse,
      safeParse: aot.Simple_safeParse,
    },
    {
      is: typiaIsSimple,
      parse: typiaAssertSimple,
      safeParse: typiaValidateSimple,
    },
    zodSimple
  );
  registerValidationCase(
    "nested constrained object",
    validUser,
    invalidUser,
    {
      is: aot.User_is,
      parse: aot.User_parse,
      safeParse: aot.User_safeParse,
    },
    {
      is: typiaIsUser,
      parse: typiaAssertUser,
      safeParse: typiaValidateUser,
    },
    zodUser
  );
}

interface ValidationFunctions {
  readonly is: (value: unknown) => unknown;
  readonly parse: (value: unknown) => unknown;
  readonly safeParse: (value: unknown) => unknown;
}

function registerValidationCase(
  name: string,
  valid: unknown,
  invalid: unknown,
  jit: ValidationFunctions,
  typia: ValidationFunctions,
  zodSchema: z.ZodType
): void {
  registerScenario({
    op: "AOT is",
    name: `${name} / valid`,
    args: [valid],
    jit: jit.is,
    competitors: [
      { name: "Typia generated is", fn: typia.is },
      { name: "Zod safeParse.success", fn: (value: unknown) => zodSchema.safeParse(value).success },
    ],
  });
  registerScenario({
    op: "AOT is",
    name: `${name} / invalid`,
    args: [invalid],
    jit: jit.is,
    competitors: [
      { name: "Typia generated is", fn: typia.is },
      { name: "Zod safeParse.success", fn: (value: unknown) => zodSchema.safeParse(value).success },
    ],
  });
  registerScenario({
    op: "AOT parse",
    name: `${name} / valid`,
    args: [valid],
    jit: jit.parse,
    competitors: [
      { name: "Typia generated assert", fn: typia.parse },
      { name: "Zod parse", fn: (value: unknown) => zodSchema.parse(value) },
    ],
  });
  registerScenario({
    op: "AOT safeParse",
    name: `${name} / valid`,
    args: [valid],
    jit: jit.safeParse,
    competitors: [
      { name: "Typia generated validate", fn: typia.safeParse },
      { name: "Zod safeParse", fn: (value: unknown) => zodSchema.safeParse(value) },
    ],
  });
  registerScenario({
    op: "AOT safeParse",
    name: `${name} / invalid`,
    args: [invalid],
    jit: jit.safeParse,
    competitors: [
      { name: "Typia generated validate", fn: typia.safeParse },
      { name: "Zod safeParse", fn: (value: unknown) => zodSchema.safeParse(value) },
    ],
  });
}
