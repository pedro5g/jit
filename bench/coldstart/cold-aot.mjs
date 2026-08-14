// Cold start, AOT path: import the pregenerated pure module and run one call
// of each operation. No engine, no schema construction, no compilation.
const start = process.hrtime.bigint();

const { User } = await import("./.generated/index.js");

const user = {
  id: 42,
  name: "Ada Lovelace",
  email: "ada@math.org",
  active: true,
  tags: ["math", "pioneer"],
  profile: { age: 36, score: 99.5 },
};

if (!User.is(user)) throw new Error("unexpected invalid user");
if (User.stringify(user).length === 0) throw new Error("empty json");

const end = process.hrtime.bigint();

console.log(JSON.stringify({ ns: Number(end - start) }));
