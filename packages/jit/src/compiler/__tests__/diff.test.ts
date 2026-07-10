import { Compiler, JIT } from "../../index.js";

describe("JIT compiler diff", () => {
  it("should diff primitive and object fields with deterministic paths", () => {
    const User = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
      active: JIT.boolean(),
    }).schema;
    const diff = Compiler.compileDiff(User);

    expect(diff({ id: 1, name: "Ada", active: true }, { id: 1, name: "Ada", active: true })).toEqual([]);
    expect(diff({ id: 1, name: "Ada", active: true }, { id: 1, name: "Grace", active: false })).toEqual([
      { type: "update", path: ["name"], value: "Grace" },
      { type: "update", path: ["active"], value: false },
    ]);

    expectTypeOf(diff).parameter(0).toEqualTypeOf<{
      id: number;
      name: string;
      active: boolean;
    }>();
  });

  it("should diff nested object fields", () => {
    const User = JIT.object({
      id: JIT.number(),
      profile: JIT.object({
        name: JIT.string(),
        age: JIT.number(),
      }),
    }).schema;
    const diff = Compiler.compileDiff(User);

    expect(diff({ id: 1, profile: { name: "Ada", age: 37 } }, { id: 1, profile: { name: "Ada", age: 38 } })).toEqual([
      { type: "update", path: ["profile", "age"], value: 38 },
    ]);
  });

  it("should diff arrays with update, add, and remove changes", () => {
    const Users = JIT.array(
      JIT.object({
        id: JIT.number(),
        name: JIT.string(),
      })
    ).schema;
    const diff = Compiler.compileDiff(Users);
    const source = Compiler.emitDiffSource(Users);

    expect(
      diff(
        [
          { id: 1, name: "Ada" },
          { id: 2, name: "Grace" },
        ],
        [
          { id: 1, name: "Ada" },
          { id: 2, name: "Katherine" },
          { id: 3, name: "Mary" },
        ]
      )
    ).toEqual([
      { type: "update", path: [1, "name"], value: "Katherine" },
      { type: "add", path: [2], value: { id: 3, name: "Mary" } },
    ]);

    expect(diff([{ id: 1, name: "Ada" }], [])).toEqual([{ type: "remove", path: [0] }]);
    expect(source).toContain("changes[changes.length]");
    expect(source).toContain("for (let i = 0; i < commonLen; i++)");
    expect(source).not.toContain("Object.keys");
    expect(source).not.toContain(".map(");
  });

  it("should diff nullable wrappers as root updates when nullability changes", () => {
    const schema = JIT.object({ id: JIT.number() }).nullable().schema;
    const diff = Compiler.compileDiff(schema);

    expect(diff(null, null)).toEqual([]);
    expect(diff(null, { id: 1 })).toEqual([{ type: "update", path: [], value: { id: 1 } }]);
    expect(diff({ id: 1 }, null)).toEqual([{ type: "update", path: [], value: null }]);
  });

  it("should diff nullable dates without unsafe access", () => {
    const diff = Compiler.compileDiff(JIT.date().nullable().schema);
    const value = new Date("2026-02-01T00:00:00.000Z");
    const next = new Date("2026-03-01T00:00:00.000Z");

    expect(diff(null, null)).toEqual([]);
    expect(diff(null, next)).toEqual([{ type: "update", path: [], value: next }]);
    expect(diff(value, new Date(value.getTime()))).toEqual([]);
    expect(diff(value, next)).toEqual([{ type: "update", path: [], value: next }]);
  });

  it("should diff tuples, records, sets, and maps", () => {
    const tupleDiff = Compiler.compileDiff(JIT.tuple(JIT.number(), JIT.object({ name: JIT.string() })).schema);

    expect(tupleDiff([1, { name: "Ada" }], [1, { name: "Grace" }])).toEqual([
      { type: "update", path: [1, "name"], value: "Grace" },
    ]);

    const recordDiff = Compiler.compileDiff(JIT.record(JIT.string(), JIT.number()).schema);

    expect(recordDiff({ a: 1 }, { a: 2, b: 3 })).toEqual([
      { type: "update", path: ["a"], value: 2 },
      { type: "add", path: ["b"], value: 3 },
    ]);
    expect(recordDiff({ a: 1, b: 2 }, { a: 1 })).toEqual([{ type: "remove", path: ["b"] }]);

    const setDiff = Compiler.compileDiff(JIT.set(JIT.number()).schema);
    const nextSet = new Set([1, 3]);

    expect(setDiff(new Set([1, 2]), new Set([1, 2]))).toEqual([]);
    expect(setDiff(new Set([1, 2]), nextSet)).toEqual([{ type: "update", path: [], value: nextSet }]);

    const mapDiff = Compiler.compileDiff(JIT.map(JIT.string(), JIT.number()).schema);
    const nextMap = new Map([["a", 2]]);

    expect(mapDiff(new Map([["a", 1]]), nextMap)).toEqual([{ type: "update", path: [], value: nextMap }]);
  });

  it("should expose deterministic readable source", () => {
    const schema = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
    }).schema;

    expect(Compiler.emitDiffSource(schema)).toMatchInlineSnapshot(`
      "function diff(left, right) {
        const changes = [];
        if (Object.is(left, right)) {
          return changes;
        }
        if (!Object.is(left, right)) {
          if (!Object.is(left.id, right.id)) {
            changes[changes.length] = { type: "update", path: ["id"], value: right.id };
          }
          if (!Object.is(left.name, right.name)) {
            changes[changes.length] = { type: "update", path: ["name"], value: right.name };
          }
        }
        return changes;
      }"
    `);
  });

  it("should expose JIT.compileDiff as a public convenience API", () => {
    const diff = JIT.compileDiff(JIT.object({ id: JIT.number() }).schema);

    expect(diff({ id: 1 }, { id: 2 })).toEqual([{ type: "update", path: ["id"], value: 2 }]);
  });

  it("should keep generated source free from generic array helpers", () => {
    const source = Compiler.emitDiffSource(JIT.array(JIT.object({ id: JIT.number() })).schema);

    expect(source).not.toContain(".push(");
    expect(source).not.toContain(".map(");
    expect(source).not.toContain(".filter(");
    expect(source).not.toContain(".reduce(");
  });

  it("should keep generated map and set diff source free from array conversions", () => {
    const setSource = Compiler.emitDiffSource(JIT.set(JIT.number()).schema);
    const mapSource = Compiler.emitDiffSource(JIT.map(JIT.string(), JIT.number()).schema);

    for (const source of [setSource, mapSource]) {
      expect(source).not.toContain("Array.from");
      expect(source).not.toContain("[...");
      expect(source).not.toContain(".map(");
      expect(source).not.toContain(".filter(");
      expect(source).not.toContain(".reduce(");
    }
    expect(setSource).toContain(".values()");
    expect(mapSource).toContain(".entries()");
  });
});
