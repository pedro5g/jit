import { type Builder, JIT } from "@jit-compiler/jit";
import { z } from "zod";
import { runSuite } from "../shared/persist.js";
import { type Competitor, registerScenario } from "../shared/scenario.js";
import {
  isUser as typiaIsUser,
  isUsers as typiaIsUsers,
  validateUser as typiaValidateUser,
  validateUsers as typiaValidateUsers,
} from "../validate/typia-gen/user.js";

const NATIVE_ONLY_BIAS = "syntax decoding only; does not validate the schema";
const FAIL_FAST_BIAS = "fail-fast validation while JIT and validate competitors collect issues";

const User = JIT.object({
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
const Users = JIT.array(User);
const EntityId = JIT.object({ id: JIT.number() });
const zodEntityId = z.object({ id: z.number() });
const zodUser = z.object({
  id: z.number().int().positive(),
  name: z.string().min(2).max(64),
  email: z.string().email(),
  active: z.boolean(),
  tags: z.array(z.string()).max(8),
  profile: z.object({
    age: z.number().int().min(0).max(150),
    score: z.number(),
  }),
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

registerDecode("object / 1 numeric field", EntityId, '{"id":1}', [
  { name: "JSON.parse + Zod 4 parse", fn: (input: string) => zodEntityId.parse(JSON.parse(input)) },
]);
registerDecode("object / validated nested fields", User, JSON.stringify(user), userCompetitors());
registerDecode("array / 10k validated objects", Users, JSON.stringify(users), userCompetitors(true));

function registerDecode(
  name: string,
  schema: Builder.SchemaInput,
  json: string,
  marketCompetitors: readonly Competitor[]
): void {
  const fused = JIT.json.parse(schema).validate();
  const parse = JIT.parse(schema);

  registerScenario({
    op: "schema-directed JSON decode + validate",
    name,
    args: [json],
    jit: fused,
    competitors: [
      {
        name: "JSON.parse + compiled JIT validation",
        fn: (input: string) => parse(JSON.parse(input)),
      },
      {
        name: "native JSON.parse only",
        fn: JSON.parse,
        biased: NATIVE_ONLY_BIAS,
      },
      ...marketCompetitors,
    ],
  });
}

function userCompetitors(many = false): readonly Competitor[] {
  const zodSchema = many ? zodUsers : zodUser;
  const typiaValidate = many ? typiaValidateUsers : typiaValidateUser;
  const typiaIs = many ? typiaIsUsers : typiaIsUser;

  return [
    {
      name: "JSON.parse + Typia generated validate",
      fn: (input: string) => {
        const result = typiaValidate(JSON.parse(input));

        if (!result.success) throw new Error("invalid benchmark payload");
        return result.data;
      },
    },
    {
      name: "JSON.parse + Typia generated is",
      fn: (input: string) => {
        const value: unknown = JSON.parse(input);

        if (!typiaIs(value)) throw new Error("invalid benchmark payload");
        return value;
      },
      biased: FAIL_FAST_BIAS,
    },
    {
      name: "JSON.parse + Zod 4 parse",
      fn: (input: string) => zodSchema.parse(JSON.parse(input)),
    },
  ];
}

await runSuite("json-decode");
