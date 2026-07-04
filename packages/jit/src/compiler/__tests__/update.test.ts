import { Compiler, JIT } from "../../index.js";

describe("JIT compiler update", () => {
  it("should update object fields immutably and reuse unchanged input", () => {
    const User = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
      active: JIT.boolean(),
    }).schema;
    const update = Compiler.compileUpdate(User);
    const input = { id: 1, name: "Ada", active: true };

    expect(update(input, {})).toBe(input);
    expect(update(input, { name: "Ada" })).toBe(input);

    const output = update(input, { name: "Grace" });

    expect(output).toEqual({ id: 1, name: "Grace", active: true });
    expect(output).not.toBe(input);
    expectTypeOf(update).parameter(1).toEqualTypeOf<{
      readonly id?: number | undefined;
      readonly name?: string | undefined;
      readonly active?: boolean | undefined;
    }>();
  });

  it("should update nested object branches with structural sharing", () => {
    const User = JIT.object({
      id: JIT.number(),
      profile: JIT.object({
        name: JIT.string(),
        age: JIT.number(),
      }),
    }).schema;
    const update = Compiler.compileUpdate(User);
    const input = { id: 1, profile: { name: "Ada", age: 37 } };

    expect(update(input, { profile: { name: "Ada" } })).toBe(input);

    const output = update(input, { profile: { age: 38 } });

    expect(output).toEqual({ id: 1, profile: { name: "Ada", age: 38 } });
    expect(output).not.toBe(input);
    expect(output.profile).not.toBe(input.profile);
  });

  it("should update arrays with preallocation only when an index changes", () => {
    const Users = JIT.array(
      JIT.object({
        id: JIT.number(),
        name: JIT.string(),
      })
    ).schema;
    const update = Compiler.compileUpdate(Users);
    const input = [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ];

    expect(update(input, [])).toBe(input);
    expect(update(input, [{ name: "Ada" }])).toBe(input);

    const output = update(input, [undefined, { name: "Katherine" }]);
    const source = Compiler.emitUpdateSource(Users);

    expect(output).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Katherine" },
    ]);
    expect(output).not.toBe(input);
    expect(output[0]).toBe(input[0]);
    expect(output[1]).not.toBe(input[1]);
    expect(source).toContain("value.slice()");
    expect(source).toContain("for (let i = 0; i < patchLen; i++)");
    expect(source).toContain("const item = value[i];");
    expect(source).not.toContain("new Array(outLen)");
    expect(source).not.toContain(".push(");
    expect(source).not.toContain(".map(");
  });

  it("should update nested arrays with copy-on-write structural sharing", () => {
    const Matrix = JIT.array(JIT.array(JIT.object({ id: JIT.number(), name: JIT.string() }))).schema;
    const update = Compiler.compileUpdate(Matrix);
    const input = [
      [
        { id: 1, name: "Ada" },
        { id: 2, name: "Grace" },
      ],
      [
        { id: 3, name: "Katherine" },
        { id: 4, name: "Mary" },
      ],
    ];

    expect(update(input, [])).toBe(input);

    const output = update(input, [undefined, [undefined, { name: "Marie" }]]);

    expect(output).toEqual([
      [
        { id: 1, name: "Ada" },
        { id: 2, name: "Grace" },
      ],
      [
        { id: 3, name: "Katherine" },
        { id: 4, name: "Marie" },
      ],
    ]);
    expect(output).not.toBe(input);
    expect(output[0]).toBe(input[0]);
    expect(output[1]).not.toBe(input[1]);
    expect(output[1][0]).toBe(input[1][0]);
    expect(output[1][1]).not.toBe(input[1][1]);
  });

  it("should update nullable wrappers without touching absent patches", () => {
    const schema = JIT.object({ id: JIT.number() }).nullable().schema;
    const update = Compiler.compileUpdate(schema);
    const input = { id: 1 };

    expect(update(input, undefined)).toBe(input);
    expect(update(input, null)).toBeNull();
    expect(update(null, { id: 1 })).toEqual({ id: 1 });
  });

  it("should update nullable dates without unsafe access", () => {
    const update = Compiler.compileUpdate(JIT.date().nullable().schema);
    const value = new Date("2026-02-01T00:00:00.000Z");
    const next = new Date("2026-03-01T00:00:00.000Z");

    expect(update(null, undefined)).toBeNull();
    expect(update(null, next)).toBe(next);
    expect(update(value, new Date(value.getTime()))).toBe(value);
    expect(update(value, next)).toEqual(next);
    expect(update(value, next)).not.toBe(next);
  });

  it("should update tuples, records, sets, and maps", () => {
    const tupleUpdate = Compiler.compileUpdate(JIT.tuple(JIT.number(), JIT.object({ name: JIT.string() })).schema);
    const tupleInput = [1, { name: "Ada" }] as [number, { readonly name: string }];

    expect(tupleUpdate(tupleInput, [])).toBe(tupleInput);
    expect(tupleUpdate(tupleInput, [undefined, { name: "Grace" }])).toEqual([1, { name: "Grace" }]);

    const recordUpdate = Compiler.compileUpdate(JIT.record(JIT.string(), JIT.object({ score: JIT.number() })).schema);
    const recordInput = { ada: { score: 1 } };

    expect(recordUpdate(recordInput, { ada: { score: 1 } })).toBe(recordInput);
    expect(recordUpdate(recordInput, { ada: { score: 2 } })).toEqual({ ada: { score: 2 } });

    const setUpdate = Compiler.compileUpdate(JIT.set(JIT.number()).schema);
    const setInput = new Set([1, 2]);
    const setPatch = new Set([1, 3]);

    expect(setUpdate(setInput, undefined)).toBe(setInput);
    expect(setUpdate(setInput, new Set([1, 2]))).toBe(setInput);
    expect(setUpdate(setInput, setPatch)).toBe(setPatch);

    const mapUpdate = Compiler.compileUpdate(JIT.map(JIT.string(), JIT.number()).schema);
    const mapInput = new Map([["a", 1]]);
    const mapPatch = new Map([["a", 2]]);

    expect(mapUpdate(mapInput, undefined)).toBe(mapInput);
    expect(mapUpdate(mapInput, new Map([["a", 1]]))).toBe(mapInput);
    expect(mapUpdate(mapInput, mapPatch)).toBe(mapPatch);
  });

  it("should expose deterministic readable source", () => {
    const schema = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
    }).schema;

    expect(Compiler.emitUpdateSource(schema)).toMatchInlineSnapshot(`
      "function update(value, patch) {
        let out = value;
        if (patch !== undefined) {
          let next_id = value.id;
          if (patch.id !== undefined && !Object.is(value.id, patch.id)) {
            next_id = patch.id;
          }
          let next_name = value.name;
          if (patch.name !== undefined && !Object.is(value.name, patch.name)) {
            next_name = patch.name;
          }
          if (next_id !== value.id || next_name !== value.name) {
            out = { "id": next_id, "name": next_name };
          }
        }
        return out;
      }"
    `);
  });

  it("should expose JIT.compileUpdate as a public convenience API", () => {
    const update = JIT.compileUpdate(JIT.object({ id: JIT.number() }).schema);
    const input = { id: 1 };

    expect(update(input, {})).toBe(input);
    expect(update(input, { id: 2 })).toEqual({ id: 2 });
  });

  it("should expose JIT.update with patch and draft recipe modes", () => {
    const User = JIT.object({
      id: JIT.number(),
      profile: JIT.object({
        name: JIT.string(),
        age: JIT.number(),
      }),
    });
    const update = JIT.update(User);
    const input = { id: 1, profile: { name: "Ada", age: 37 } };

    expect(update(input, { profile: { name: "Ada" } })).toBe(input);

    const patched = update(input, { profile: { age: 38 } });
    const drafted = update(input, (draft) => {
      draft.profile.age = 38;
    });

    expect(patched).toEqual({ id: 1, profile: { name: "Ada", age: 38 } });
    expect(drafted).toEqual(patched);
    expect(drafted).not.toBe(input);
    expect(drafted.profile).not.toBe(input.profile);
  });

  it("should reject updates for readonly schemas", () => {
    const User = JIT.object({ id: JIT.number() }).readonly().schema;

    expect(() => Compiler.compileUpdate(User)).toThrow("readonly");
    expect(() => JIT.update(User)).toThrow("readonly");
  });

  it("should keep generated array source allocation-conscious", () => {
    const source = Compiler.emitUpdateSource(JIT.array(JIT.object({ id: JIT.number() })).schema);

    expect(source).toContain("value.slice()");
    expect(source).not.toContain("new Array(outLen)");
    expect(source).not.toContain(".push(");
    expect(source).not.toContain(".map(");
    expect(source).not.toContain(".filter(");
    expect(source).not.toContain(".reduce(");
  });

  it("should keep generated map and set update source free from array conversions", () => {
    const setSource = Compiler.emitUpdateSource(JIT.set(JIT.number()).schema);
    const mapSource = Compiler.emitUpdateSource(JIT.map(JIT.string(), JIT.number()).schema);

    for (const source of [setSource, mapSource]) {
      expect(source).not.toContain("Array.from");
      expect(source).not.toContain("[...");
      expect(source).not.toContain(".map(");
      expect(source).not.toContain(".filter(");
      expect(source).not.toContain(".reduce(");
    }
    expect(setSource).toContain(".values()");
    expect(mapSource).toContain(".entries()");
    expect(setSource).not.toContain("new Set");
    expect(mapSource).not.toContain("new Map");
  });
});
