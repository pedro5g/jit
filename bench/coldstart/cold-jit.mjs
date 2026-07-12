// Cold start, runtime-JIT path: import the engine, build the schema, compile
// the validator + serializer, run one call of each. Prints elapsed ns.
const start = process.hrtime.bigint();

const { JIT } = await import("@pedro5g/jit");

const UserSchema = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2).max(64),
  email: JIT.string().email(),
  active: JIT.boolean(),
  tags: JIT.array(JIT.string()).max(8),
  profile: JIT.object({
    age: JIT.number().int().min(0).max(150),
    score: JIT.number(),
  }),
});

const validate = JIT.validator(UserSchema);
const serializer = JIT.serializer(UserSchema);

const user = {
  id: 42,
  name: "Ada Lovelace",
  email: "ada@math.org",
  active: true,
  tags: ["math", "pioneer"],
  profile: { age: 36, score: 99.5 },
};

if (!validate.is(user)) throw new Error("unexpected invalid user");
if (serializer.stringify(user).length === 0) throw new Error("empty json");

const end = process.hrtime.bigint();

console.log(JSON.stringify({ ns: Number(end - start) }));
