import { JIT } from "../../packages/jit/src/index.js";
import { loadAotArtifacts } from "../shared/aot.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const V1 = JIT.object({ version: JIT.literal(1), name: JIT.string(), score: JIT.number() });
const V2 = JIT.object({ version: JIT.literal(2), fullName: JIT.string(), score: JIT.number() });
const V3 = JIT.object({
  version: JIT.literal(3),
  displayName: JIT.string(),
  score: JIT.number(),
  active: JIT.boolean(),
});
type V1 = JIT.Typeof<typeof V1>;
type V2 = JIT.Typeof<typeof V2>;
type V3 = JIT.Typeof<typeof V3>;
type Version = V1 | V2 | V3;

const migrate = JIT.migrate(V1)
  .to(V2, { fullName: { from: "name" } })
  .to(V3, { displayName: { from: "fullName" }, active: { default: true } });
const aot = await loadAotArtifacts<{ readonly migrate: typeof migrate }>({ migrate });

function handwritten(value: Version): V3 {
  switch (value.version) {
    case 1:
      return { version: 3, displayName: value.name, score: value.score, active: true };
    case 2:
      return { version: 3, displayName: value.fullName, score: value.score, active: true };
    case 3:
      return value;
  }
}

function generic(value: Version): V3 {
  const edges = [
    (input: Version): Version =>
      input.version === 1 ? { version: 2, fullName: input.name, score: input.score } : input,
    (input: Version): Version =>
      input.version === 2 ? { version: 3, displayName: input.fullName, score: input.score, active: true } : input,
  ];
  let current = value;
  for (const edge of edges) current = edge(current);
  return current as V3;
}

for (const value of [
  { version: 1, name: "Ada", score: 1 } as V1,
  { version: 2, fullName: "Grace", score: 2 } as V2,
  { version: 3, displayName: "Lin", score: 3, active: true } as V3,
]) {
  registerScenario({
    op: "migration",
    name: `input v${value.version} -> v3`,
    args: [value],
    jit: migrate,
    competitors: [
      { name: "JIT AOT", fn: aot.migrate },
      { name: "handwritten switch", fn: handwritten },
      { name: "generic edge loop", fn: generic },
    ],
  });
}

await runSuite("migration");
