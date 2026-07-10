import { AST, Compiler, JIT } from "../../index.js";

describe("JIT compiler clone", () => {
  it("should clone primitives by reusing the input value", () => {
    const clone = Compiler.compileClone(JIT.number().schema);

    expect(clone(1)).toBe(1);
    expectTypeOf(clone).parameter(0).toEqualTypeOf<number>();
  });

  it("should compile object clones with stable direct property access", () => {
    const User = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
      createdAt: JIT.date(),
    }).schema;
    const clone = Compiler.compileClone(User);
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const input = { id: 1, name: "Ada", createdAt };
    const output = clone(input);

    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(output.createdAt).not.toBe(createdAt);
    expect(output.createdAt.getTime()).toBe(createdAt.getTime());
    expectTypeOf(output).toEqualTypeOf<{
      id: number;
      name: string;
      createdAt: Date;
    }>();
  });

  it("should compile array clones with preallocation and without push", () => {
    const Users = JIT.array(
      JIT.object({
        id: JIT.number(),
        name: JIT.string(),
      })
    ).schema;
    const clone = Compiler.compileClone(Users);
    const input = [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ];
    const output = clone(input);
    const source = Compiler.emitCloneSource(Users);

    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(output[0]).not.toBe(input[0]);
    expect(output[1]).not.toBe(input[1]);
    expect(source).toContain("const out = new Array(len);");
    expect(source).toContain("for (let i = 0; i < len; i++)");
    expect(source).not.toContain(".push(");
    expect(source).not.toContain(".map(");
  });

  it("should clone nullish wrappers without cloning null or undefined", () => {
    const schema = JIT.object({ id: JIT.number() }).nullish().schema;
    const clone = Compiler.compileClone(schema);
    const value = { id: 1 };

    expect(clone(null)).toBeNull();
    expect(clone(undefined)).toBeUndefined();
    expect(clone(value)).toEqual(value);
    expect(clone(value)).not.toBe(value);
    expect(schema.type).toBe(AST.TypeName.nullish);
  });

  it("should clone nullable dates without unsafe access", () => {
    const schema = JIT.date().nullable().schema;
    const clone = Compiler.compileClone(schema);
    const value = new Date("2026-02-01T00:00:00.000Z");

    expect(clone(null)).toBeNull();
    expect(clone(value)).toEqual(value);
    expect(clone(value)).not.toBe(value);
  });

  it("should clone tuples, records, sets, and maps", () => {
    const Tuple = JIT.tuple(JIT.number(), JIT.object({ name: JIT.string() })).schema;
    const tupleClone = Compiler.compileClone(Tuple);
    const tupleInput: [number, { readonly name: string }] = [1, { name: "Ada" }];
    const tupleOutput = tupleClone(tupleInput);

    expect(tupleOutput).toEqual(tupleInput);
    expect(tupleOutput).not.toBe(tupleInput);
    expect(tupleOutput[1]).not.toBe(tupleInput[1]);

    const recordClone = Compiler.compileClone(JIT.record(JIT.string(), JIT.object({ score: JIT.number() })).schema);
    const recordInput = { ada: { score: 1 }, grace: { score: 2 } };
    const recordOutput = recordClone(recordInput);

    expect(recordOutput).toEqual(recordInput);
    expect(recordOutput).not.toBe(recordInput);
    expect(recordOutput.ada).not.toBe(recordInput.ada);

    const setClone = Compiler.compileClone(JIT.set(JIT.object({ id: JIT.number() })).schema);
    const setItem = { id: 1 };
    const setOutput = setClone(new Set([setItem]));
    const [clonedSetItem] = setOutput;

    expect(setOutput).toEqual(new Set([setItem]));
    expect(clonedSetItem).not.toBe(setItem);

    const mapClone = Compiler.compileClone(JIT.map(JIT.string(), JIT.object({ id: JIT.number() })).schema);
    const mapValue = { id: 1 };
    const mapOutput = mapClone(new Map([["user", mapValue]]));

    expect(mapOutput.get("user")).toEqual(mapValue);
    expect(mapOutput.get("user")).not.toBe(mapValue);
  });

  it("should expose deterministic readable source", () => {
    const schema = JIT.object({
      id: JIT.number(),
      profile: JIT.object({
        name: JIT.string(),
      }),
    }).schema;

    expect(Compiler.emitCloneSource(schema)).toMatchInlineSnapshot(`
      "function clone(value) {
        return { id: value.id, profile: { name: value.profile.name } };
      }"
    `);
  });

  it("should expose JIT.compileClone as a public convenience API", () => {
    const clone = JIT.compileClone(JIT.object({ id: JIT.number() }).schema);
    const input = { id: 1 };

    expect(clone(input)).toEqual(input);
    expect(clone(input)).not.toBe(input);
  });

  it("should keep generated array source allocation-conscious", () => {
    const source = Compiler.emitCloneSource(JIT.array(JIT.object({ id: JIT.number() })).schema);

    expect(source).toContain("new Array(len)");
    expect(source).not.toContain(".push(");
    expect(source).not.toContain(".map(");
    expect(source).not.toContain(".filter(");
    expect(source).not.toContain(".reduce(");
  });

  it("should clone primitive unions", () => {
    const clone = Compiler.compileClone(JIT.union(JIT.number(), JIT.string()).schema);

    expect(clone(1)).toBe(1);
    expect(clone("jit")).toBe("jit");
  });

  it("should clone generic object unions with schema guards", () => {
    const Cat = JIT.object({ kind: JIT.literal("cat"), profile: JIT.object({ lives: JIT.number() }) });
    const Dog = JIT.object({ kind: JIT.literal("dog"), profile: JIT.object({ bark: JIT.boolean() }) });
    const schema = JIT.union(Cat, Dog).schema;
    const clone = Compiler.compileClone(schema);
    const source = Compiler.emitCloneSource(schema);
    const cat = { kind: "cat", profile: { lives: 9 } } as const;
    const dog = { kind: "dog", profile: { bark: true } } as const;
    const clonedCat = clone(cat);
    const clonedDog = clone(dog);

    expect(clonedCat).toEqual(cat);
    expect(clonedCat).not.toBe(cat);
    expect(clonedCat.profile).not.toBe(cat.profile);
    expect(clonedDog).toEqual(dog);
    expect(clonedDog).not.toBe(dog);
    expect(clonedDog.profile).not.toBe(dog.profile);
    expect(source).toContain('value.kind === "cat"');
    expect(source).toContain('value.kind === "dog"');
  });

  it("should clone discriminated object unions", () => {
    const Cat = JIT.object({ kind: JIT.literal("cat"), profile: JIT.object({ lives: JIT.number() }) });
    const Dog = JIT.object({ kind: JIT.literal("dog"), profile: JIT.object({ bark: JIT.boolean() }) });
    const schema = JIT.discriminatedUnion("kind", [Cat, Dog]).schema;
    const clone = Compiler.compileClone(schema);
    const cat = { kind: "cat", profile: { lives: 9 } } as const;
    const dog = { kind: "dog", profile: { bark: true } } as const;
    const clonedCat = clone(cat);
    const clonedDog = clone(dog);

    expect(clonedCat).toEqual(cat);
    expect(clonedCat).not.toBe(cat);
    expect(clonedCat.profile).not.toBe(cat.profile);
    expect(clonedDog).toEqual(dog);
    expect(clonedDog).not.toBe(dog);
    expect(clonedDog.profile).not.toBe(dog.profile);
  });

  it("should clone object intersections by merging member clones", () => {
    const schema = JIT.intersection(
      JIT.object({ id: JIT.number(), left: JIT.object({ value: JIT.string() }) }),
      JIT.object({ name: JIT.string(), right: JIT.object({ value: JIT.number() }) })
    ).schema;
    const clone = Compiler.compileClone(schema);
    const input = { id: 1, name: "Ada", left: { value: "x" }, right: { value: 1 } };
    const output = clone(input);

    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(output.left).not.toBe(input.left);
    expect(output.right).not.toBe(input.right);
  });
});
