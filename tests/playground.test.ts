import { describe, expect, it } from "vitest";
import { executePlaygroundRequest, type PlaygroundOp } from "../apps/site/lib/playground/worker.js";

const rows = [
  { id: 1, score: 42.5, active: true, region: "br" },
  { id: 2, score: 18, active: false, region: "us" },
  { id: 3, score: 91.5, active: true, region: "br" },
  { id: 4, score: 73, active: true, region: "eu" },
];

const eventSchema = `
const schema = JIT.object({
  id: JIT.number().int32(),
  score: JIT.number().float64(),
  active: JIT.boolean(),
  region: JIT.union(JIT.literal("br"), JIT.literal("us"), JIT.literal("eu")),
});`;

describe("browser playground advanced operations", () => {
  it("executes configured sanitizers and exposes generated source", () => {
    const sanitized = execute(
      "sanitize",
      `const schema = JIT.object({
  text: JIT.string().sanitize(),
  rich: JIT.string().sanitize({ preset: "none", html: { mode: "allow", tags: ["b"] } }),
  identifier: JIT.string().sanitize("sqlIdentifier"),
});`,
      {
        text: "<script>bad()</script><b>Hello</b>",
        rich: '<b onclick="bad()">Hello</b><img src=x>',
        identifier: "users.name; DROP",
      }
    );

    expect(sanitized.value).toEqual({ text: "Hello", rich: "<b>Hello</b>", identifier: "users_name_DROP" });
    expect(sanitized.source).toContain("function sanitize(value)");
    expect(sanitized.source).toContain("rawName.toLowerCase()");
  });

  it("executes reactive updates with path and aggregate notifications", () => {
    const result = execute(
      "reactiveUpdate",
      `const schema = JIT.object({
  id: JIT.number(),
  profile: JIT.object({ score: JIT.number(), active: JIT.boolean() }),
});
const reactiveUpdate = (initial, patches) => {
  const store = JIT.update(schema).reactive(initial);
  const events = [];
  store.watch(["profile", "score"], ({ previous, value }) => events.push({ previous, value }));
  store.subscribe((event) => events.push({ version: event.version, changes: event.changes }));
  store.batch((state) => patches.forEach((patch) => state.update(patch)));
  return { value: store.value, version: store.version, events };
};`,
      { id: 1, profile: { score: 1, active: true } },
      [{ profile: { score: 2 } }, { profile: { active: false } }]
    );

    expect(result.value).toEqual({
      value: { id: 1, profile: { score: 2, active: false } },
      version: 2,
      events: [
        {
          version: 2,
          changes: [
            { type: "update", path: ["profile", "score"], previous: 1, value: 2 },
            { type: "update", path: ["profile", "active"], previous: true, value: false },
          ],
        },
        { previous: 1, value: 2 },
      ],
    });
  });

  it("executes lazy generators and direct visitors", () => {
    const lazy = execute(
      "lazy",
      `${eventSchema}
const lazy = JIT.query(JIT.array(schema))
  .filter((q) => q.eq("active", true))
  .select("id", "score")
  .take(2)
  .lazy()
  .compile();`,
      rows
    );
    const visitor = execute(
      "visitor",
      `${eventSchema}
const visitor = JIT.query(JIT.array(schema))
  .filter((q) => q.and(q.eq("active", true), q.gte("score", 40)))
  .select("id", "score")
  .compileVisitor();`,
      rows
    );

    expect(lazy.value).toEqual([
      { id: 1, score: 42.5 },
      { id: 3, score: 91.5 },
    ]);
    expect(lazy.source).toContain("function query(input)");
    expect(visitor.value).toEqual({
      visited: 3,
      values: [
        { id: 1, score: 42.5 },
        { id: 3, score: 91.5 },
        { id: 4, score: 73 },
      ],
    });
    expect(visitor.source).toContain("function visit(input, consume)");
  });

  it("executes stateless watchers and stateful watched-list actions", () => {
    const previous = [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ];
    const current = [
      { id: 1, name: "Ada Lovelace" },
      { id: 3, name: "Alan" },
    ];
    const schema = `
const schema = JIT.object({ id: JIT.number().int32(), name: JIT.string() });
const Users = JIT.array(schema);`;
    const watch = execute("watch", `${schema}\nconst watch = JIT.watch(Users, { key: "id" });`, previous, current);
    const watchedList = execute(
      "watchedList",
      `${schema}
const watchedList = (initial) => JIT.watchedList(Users, initial, { key: "id" });`,
      previous,
      [
        { type: "remove", item: previous[1] },
        { type: "add", item: current[1] },
      ]
    );

    expect(watch.value).toMatchObject({
      newItems: [{ id: 3, name: "Alan" }],
      removedItems: [{ id: 2, name: "Grace" }],
      updatedItems: [{ previous: previous[0], current: current[0] }],
      isChanged: true,
    });
    expect(watch.source).toContain("const previousIndex = new Map();");
    expect(watchedList.value).toMatchObject({
      currentItems: [previous[0], current[1]],
      newItems: [current[1]],
      removedItems: [previous[1]],
      isChanged: true,
    });
    expect(watchedList.source).toBeNull();
  });

  it("executes columnar rowset queries and chunked JSON generators", () => {
    const binary = execute(
      "binary",
      `${eventSchema}
const binary = JIT.array(schema).binary({ strategy: "exact", memoryLayout: "columnar" });
const binaryQuery = JIT.query(binary)
  .filter((q) => q.and(q.eq("region", "br"), q.eq("active", true)))
  .select("id", "score")
  .compile();`,
      rows
    );
    const chunks = execute(
      "jsonChunks",
      `const Item = JIT.object({ id: JIT.number().int32(), name: JIT.string() });
const schema = JIT.array(Item);
const stringifyChunks = JIT.json(schema).stringifyChunks({ chunkBytes: 24 }).compile();`,
      [
        { id: 1, name: "Ada Lovelace" },
        { id: 2, name: "Grace Hopper" },
        { id: 3, name: "Barbara Liskov" },
      ]
    );
    const binaryValue = binary.value as { readonly bytes: number };
    const chunksValue = chunks.value as {
      readonly chunkCount: number;
      readonly chunks: readonly string[];
      readonly json: string;
    };

    expect(binary.value).toMatchObject({
      rows: 4,
      layout: "columnar",
      result: [
        { id: 1, score: 42.5 },
        { id: 3, score: 91.5 },
      ],
      hydrated: rows,
    });
    expect(binaryValue.bytes).toBeGreaterThan(0);
    expect(binary.source).toContain("function query(rowset)");
    expect(chunksValue.chunkCount).toBeGreaterThan(1);
    expect(chunksValue.chunks.join("")).toBe(chunksValue.json);
    expect(JSON.parse(chunksValue.json)).toHaveLength(3);
    expect(chunks.source).toContain("function* stringifyChunks(value)");
  });
});

function execute(op: PlaygroundOp, code: string, inputA: unknown, inputB?: unknown) {
  const response = executePlaygroundRequest({
    id: 1,
    code,
    op,
    inputA: JSON.stringify(inputA),
    inputB: inputB === undefined ? "" : JSON.stringify(inputB),
  });

  expect(response.ok, response.ok ? undefined : response.error).toBe(true);
  if (!response.ok) throw new Error(response.error);

  return {
    value: JSON.parse(response.result) as unknown,
    source: response.source,
  };
}
