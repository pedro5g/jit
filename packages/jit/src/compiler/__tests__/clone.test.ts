import { AST, Compiler, JIT } from "../../index.js";
import { buildSchemaNode, flattenObjectIntersection, isPrimitiveLikeSchema } from "../schema-nodes.js";

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

it("should materialize static default object props while cloning", () => {
  const schema = JIT.object({
    id: JIT.number().default(1),
    name: JIT.string().optional(),
    profile: JIT.object({ enabled: JIT.boolean(), tags: JIT.array(JIT.string()) }).default({
      enabled: true,
      tags: ["core"],
    }),
  }).schema;
  const clone = Compiler.compileClone(schema);

  expect(clone({} as never)).toEqual({ id: 1, name: undefined, profile: { enabled: true, tags: ["core"] } });
  expect(clone({ id: undefined } as never)).toEqual({
    id: 1,
    name: undefined,
    profile: { enabled: true, tags: ["core"] },
  });
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

  const mapClone = Compiler.compileClone(JIT.mapSchema(JIT.string(), JIT.object({ id: JIT.number() })).schema);
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

it("should expose the clone compiler as a low-level API", () => {
  const clone = Compiler.compileClone(JIT.object({ id: JIT.number() }).schema);
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
  const schema = JIT.union(JIT.number(), JIT.string()).schema;
  const clone = Compiler.compileClone(schema);
  const source = Compiler.emitCloneSource(schema);

  expect(clone(1)).toBe(1);
  expect(clone("jit")).toBe("jit");
  expect(source).toContain("return value;");
  expect(source).not.toContain("if (");

  const mixedSchema = JIT.union(JIT.number(), JIT.object({ nested: JIT.object({ value: JIT.number() }) })).schema;
  const mixedClone = Compiler.compileClone(mixedSchema);
  const mixedValue = { nested: { value: 1 } };
  const mixedCopy = mixedClone(mixedValue as never) as typeof mixedValue;

  expect(mixedCopy).toEqual(mixedValue);
  expect(mixedCopy).not.toBe(mixedValue);
  expect(mixedCopy.nested).not.toBe(mixedValue.nested);
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

it("should clone nested lazy schemas and non-object intersections", () => {
  const Nested = JIT.object({ value: JIT.number() });
  const LazyRoot = JIT.object({ nested: JIT.lazy(() => Nested) });
  const lazyClone = Compiler.compileClone(LazyRoot.schema);
  const lazyInput = { nested: { value: 1 } };
  const lazyOutput = lazyClone(lazyInput);

  expect(lazyOutput).toEqual(lazyInput);
  expect(lazyOutput.nested).not.toBe(lazyInput.nested);

  const MixedIntersection = JIT.intersection(JIT.object({ id: JIT.number() }), JIT.unknown()).schema;
  const intersectionClone = Compiler.compileClone(MixedIntersection);
  const intersectionInput = { id: 1 };
  const ObjectIntersection = JIT.intersection(
    JIT.object({ id: JIT.number() }),
    JIT.object({ name: JIT.string() })
  ).schema;

  expect(intersectionClone(intersectionInput)).toEqual(intersectionInput);
  expect(intersectionClone(intersectionInput)).not.toBe(intersectionInput);

  expect(isPrimitiveLikeSchema(JIT.custom().schema)).toBe(false);
  expect(flattenObjectIntersection(ObjectIntersection)).toBe(flattenObjectIntersection(ObjectIntersection));
  expect(flattenObjectIntersection(JIT.intersection().schema)).toBeUndefined();
});

it("should keep optional and nullable guards distinct in generated clones", () => {
  const optional = Compiler.emitCloneSource(JIT.object({ value: JIT.number().optional() }).schema);
  const nullable = Compiler.emitCloneSource(JIT.object({ value: JIT.number().nullable() }).schema);
  const nullish = Compiler.emitCloneSource(JIT.object({ value: JIT.number().nullish() }).schema);

  expect(optional).toContain("value.value !== undefined");
  expect(nullable).toContain("value.value !== null");
  expect(nullish).toContain("value.value != null");
});

it("should assign distinct helpers to independent recursive schemas", () => {
  let Left: never;
  let Right: never;
  Left = JIT.object({ leftValue: JIT.number(), next: JIT.lazy((): never => Left).optional() }) as never;
  Right = JIT.object({ rightValue: JIT.string(), next: JIT.lazy((): never => Right).optional() }) as never;
  const Root = JIT.object({ left: Left, right: Right }).schema;
  const clone = Compiler.compileClone(Root);
  const value = { left: { leftValue: 1 }, right: { rightValue: "two" } };
  const copy = clone(value as never) as typeof value;

  expect(copy).toEqual(value);
  expect(copy).not.toBe(value);
  expect(copy.left).not.toBe(value.left);
  expect(copy.right).not.toBe(value.right);
});

it("should retain nullable metadata in the structural guard node", () => {
  const guard = buildSchemaNode(JIT.number().nullable().schema, (schema) => schema);

  expect(guard).toMatchObject({ kind: "guard", optional: false, nullable: true });
});

it("should preserve empty intersections and reject unsupported schemas", () => {
  expect(Compiler.emitCloneSource(JIT.intersection().schema)).toContain("Object.assign({},");
  expect(() => Compiler.compileClone(JIT.custom().schema)).toThrow(/Unimplemented compiler clone IR/);
});
