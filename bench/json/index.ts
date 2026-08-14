import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AOT, JIT } from "@jit-compiler/jit";
import { z } from "zod";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";
import {
  assertParseSimple as typiaAssertParseSimple,
  assertParseUser as typiaAssertParseUser,
  assertParseUsers as typiaAssertParseUsers,
  validateParseSimple as typiaValidateParseSimple,
  validateParseUser as typiaValidateParseUser,
  validateParseUsers as typiaValidateParseUsers,
} from "../validate/typia-gen/user.js";

const SYNTAX_ONLY = "JSON syntax decoding only; schema constraints are intentionally not checked";

const Simple = JIT.object({ id: JIT.number().int32(), name: JIT.string() });
const User = JIT.object({
  id: JIT.number().int32().positive(),
  name: JIT.string().min(2).max(64),
  email: JIT.string().email(),
  active: JIT.boolean(),
  tags: JIT.array(JIT.string()).max(8),
  profile: JIT.object({ age: JIT.number().int32().min(0).max(150), score: JIT.number() }),
});
const Users = JIT.array(User);
const zodSimple = z.object({ id: z.number().int(), name: z.string() });
const zodUser = z.object({
  id: z.number().int().positive(),
  name: z.string().min(2).max(64),
  email: z.string().email(),
  active: z.boolean(),
  tags: z.array(z.string()).max(8),
  profile: z.object({ age: z.number().int().min(0).max(150), score: z.number() }),
});
const zodUsers = z.array(zodUser);

const user = {
  id: 42,
  name: "Ada Lovelace",
  email: "ada@math.org",
  active: true,
  tags: ["math", "pioneer"],
  profile: { age: 36, score: 99.5 },
};
const users = Array.from({ length: 10_000 }, (_, index) => ({
  id: index + 1,
  name: `user-${index}`,
  email: `user-${index}@example.com`,
  active: index % 2 === 0,
  tags: ["benchmark"],
  profile: { age: index % 151, score: index / 10 },
}));

interface JsonAotModule {
  readonly Simple_json: (json: string) => unknown;
  readonly Simple_parse: (json: string) => unknown;
  readonly User_json: (json: string) => unknown;
  readonly User_parse: (json: string) => unknown;
  readonly Users_json: (json: string) => unknown;
  readonly Users_parse: (json: string) => unknown;
}

async function loadAot(): Promise<JsonAotModule> {
  const outDir = fileURLToPath(new URL("./.generated/", import.meta.url));

  AOT.generate({
    schemas: {},
    functions: {
      Simple_json: JIT.json.parse(Simple),
      Simple_parse: JIT.json.parse(Simple).validate(),
      User_json: JIT.json.parse(User),
      User_parse: JIT.json.parse(User).validate(),
      Users_json: JIT.json.parse(Users),
      Users_parse: JIT.json.parse(Users).validate(),
    },
    outDir,
  });
  return (await import(pathToFileURL(join(outDir, "index.js")).href)) as JsonAotModule;
}

const aot = await loadAot();
const simpleJson = JSON.stringify({ id: 42, name: "Ada" });
const userJson = JSON.stringify(user);
const usersJson = JSON.stringify(users);
const runtimeSimple = JIT.json.parse(Simple).validate().compile();
const runtimeUser = JIT.json.parse(User).validate().compile();
const runtimeUsers = JIT.json.parse(Users).validate().compile();

registerJsonCase(
  "simple object",
  simpleJson,
  aot.Simple_json,
  aot.Simple_parse,
  runtimeSimple,
  typiaAssertParseSimple,
  typiaValidateParseSimple,
  (json) => zodSimple.parse(JSON.parse(json))
);
registerJsonCase(
  "nested constrained object",
  userJson,
  aot.User_json,
  aot.User_parse,
  runtimeUser,
  typiaAssertParseUser,
  typiaValidateParseUser,
  (json) => zodUser.parse(JSON.parse(json))
);
registerJsonCase(
  "10k nested objects",
  usersJson,
  aot.Users_json,
  aot.Users_parse,
  runtimeUsers,
  typiaAssertParseUsers,
  typiaValidateParseUsers,
  (json) => zodUsers.parse(JSON.parse(json))
);

function registerJsonCase(
  name: string,
  json: string,
  parseJson: (json: string) => unknown,
  parseValidated: (json: string) => unknown,
  runtimeValidated: (json: string) => unknown,
  typiaAssert: ((json: string) => unknown) | undefined,
  typiaValidate: ((json: string) => unknown) | undefined,
  zodParse: (json: string) => unknown
): void {
  // Prime every call site with the same real payload. Besides making V8's
  // JSON object-map transitions representative, this prevents registration
  // order from giving only the first implementation a colder feedback state.
  const warm = [parseJson, parseValidated, runtimeValidated, typiaAssert, typiaValidate, zodParse].filter(
    (fn): fn is (json: string) => unknown => fn !== undefined
  );

  for (const fn of warm) {
    for (let index = 0; index < 100; index++) fn(json);
  }

  registerScenario({
    op: "AOT JSON parse",
    name,
    args: [json],
    jit: parseJson,
    competitors: [{ name: "native JSON.parse", fn: JSON.parse }],
  });

  registerScenario({
    op: "AOT JSON parse + validate",
    name,
    args: [json],
    jit: parseValidated,
    competitors: [
      ...(typiaAssert ? [{ name: "Typia generated assertParse", fn: typiaAssert }] : []),
      ...(typiaValidate ? [{ name: "Typia generated validateParse", fn: typiaValidate }] : []),
      { name: "JIT runtime warmed artifact", fn: runtimeValidated },
      { name: "native JSON.parse only", fn: JSON.parse, biased: SYNTAX_ONLY },
      { name: "JSON.parse + Zod parse", fn: zodParse },
    ],
  });
}

await runSuite("json");
