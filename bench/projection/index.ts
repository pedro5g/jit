import { JIT } from "../../packages/jit/src/index.js";
import { loadAotArtifacts } from "../shared/aot.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const Profile = JIT.object({ name: JIT.string(), bio: JIT.string(), avatar: JIT.string() });
const Row = JIT.object({
  id: JIT.number(),
  email: JIT.string(),
  status: JIT.string(),
  notes: JIT.string(),
  secret: JIT.string(),
  score: JIT.number(),
  createdAt: JIT.number(),
  updatedAt: JIT.number(),
  profile: Profile,
});
type Row = JIT.Typeof<typeof Row>;

const rows: Row[] = Array.from({ length: 10_000 }, (_, index) => ({
  id: index,
  email: `user-${index}@example.com`,
  status: index % 3 === 0 ? "active" : "idle",
  notes: `note-${index}`,
  secret: `secret-${index}`,
  score: index,
  createdAt: index,
  updatedAt: index,
  profile: { name: `user-${index}`, bio: `bio-${index}`, avatar: `avatar-${index}` },
}));

// ------------------------------------------------------------------ project

const project = JIT.project(Row).select("id", "status");
const projectAot = await loadAotArtifacts<{ readonly project: typeof project }>({ project });

/**
 * The results are collected, which is what a projection is normally for.
 *
 * Consuming them without retaining anything lets the engine escape-analyse the
 * allocation away, and it does so unevenly across the competitors — which
 * produces a 3x difference that is an artifact of the harness rather than of
 * the code. Retaining the results measures the operation as it is used.
 */
const sweepProject = (fn: (row: Row) => { id: number; status: string }) => (input: readonly Row[]) => {
  const out = new Array<{ id: number; status: string }>(input.length);
  for (let i = 0, len = input.length; i < len; i++) out[i] = fn(input[i] as Row);
  return out;
};

registerScenario({
  op: "projection",
  name: "project 2 of 9 fields / 10000 rows",
  args: [rows],
  jit: sweepProject(project),
  competitors: [
    { name: "JIT AOT", fn: sweepProject(projectAot.project) },
    { name: "handwritten optimized", fn: sweepProject((row) => ({ id: row.id, status: row.status })) },
    {
      name: "idiomatic destructure",
      fn: sweepProject((row) => {
        const { id, status } = row;
        return { id, status };
      }),
    },
    {
      name: "idiomatic pick loop",
      fn: sweepProject((row) => {
        const out: Record<string, unknown> = {};
        for (const key of ["id", "status"]) out[key] = (row as unknown as Record<string, unknown>)[key];
        return out as unknown as { id: number; status: string };
      }),
    },
  ],
});

// ------------------------------------------------------------ selective equal

const equalAll = JIT.compare.equal(Row);
const equalSelected = JIT.compare.equal(Row).select("id", "status");
const equalAot = await loadAotArtifacts<{ readonly equalSelected: typeof equalSelected }>({ equalSelected });

/** Pairs that agree on the selection but differ elsewhere: the worst case for a full compare. */
const pairs = rows.map((row) => [row, { ...row, notes: `${row.notes}!`, secret: `${row.secret}!` }] as const);

const sweepEqual = (fn: (left: Row, right: Row) => boolean) => () => {
  let same = 0;
  for (let i = 0, len = pairs.length; i < len; i++) {
    const pair = pairs[i] as readonly [Row, Row];
    if (fn(pair[0], pair[1])) same++;
  }
  return same;
};

registerScenario({
  op: "projection",
  name: "equal on 2 of 9 fields / 10000 pairs",
  args: [],
  jit: sweepEqual(equalSelected),
  competitors: [
    { name: "JIT AOT", fn: sweepEqual(equalAot.equalSelected) },
    { name: "full equal", fn: sweepEqual(equalAll) },
    {
      name: "handwritten optimized",
      fn: sweepEqual((left, right) => left.id === right.id && left.status === right.status),
    },
  ],
});

await runSuite("projection");
