import { AST, Compiler, JIT } from "../../index.js";
import { Parse } from "../../shared/index.js";
import { emitPropertyAccess } from "../source/access.js";
import { emitLiteral } from "../source/literal.js";
import { emitPath } from "../source/path.js";

describe("JIT compiler", () => {
  describe("source helpers", () => {
    it("should reuse shared Parse helpers for property access, paths, and literals", () => {
      expect(emitPropertyAccess("value", "name")).toBe(`value${Parse.key_access("name", false)}`);
      expect(emitPropertyAccess("value", "not valid")).toBe(`value${Parse.key_access("not valid", false)}`);
      expect(emitPath("value", ["profile", "display name"])).toBe(
        `value${Parse.key_access("profile", false)}${Parse.key_access("display name", false)}`
      );
      expect(emitLiteral('quoted "value"')).toBe(Parse.parseKey('quoted "value"', { parseAsJson: true }));
      expect(emitLiteral(1n)).toBe(Parse.stringify_literal(1n));
    });
  });

  describe("resolvers", () => {
    it("should resolve wrappers on the fly without mutating schemas", () => {
      const base = JIT.object({ id: JIT.number() });
      const schema = base.optional().nullable().readonly().schema;
      const resolved = Compiler.resolveWrappers(schema);

      expect(resolved.base).toBe(base.schema);
      expect(resolved.optional).toBe(true);
      expect(resolved.nullable).toBe(true);
      expect(schema.type).toBe(AST.TypeName.readonly);
      expect(base.schema.type).toBe(AST.TypeName.object);
    });

    it("should resolve hints and strategies through wrappers", () => {
      const User = JIT.object({ id: JIT.number(), name: JIT.string() });
      const Users = JIT.array(User).entity({ key: "id" }).indexBy("id").readonly().schema;
      const resolved = Compiler.resolveCompilerHints(Users);
      const strategy = Compiler.resolveEqualStrategy(Users);

      expect(resolved.hints.entity?.key).toBe("id");
      expect(resolved.hints.collection?.identify).toBe("id");
      expect(resolved.hints.collection?.indexed).toBe(true);
      expect(strategy.array).toEqual({ type: "map", key: "id" });
    });
  });

  describe("equal IR pipeline", () => {
    it("should expose the optimizer passes in the mandated order", () => {
      expect(Compiler.optimizeEqualIRPasses.map((pass) => pass.name)).toEqual([
        "flattenBlocks",
        "hoistHash",
        "dedupeHash",
        "dedupeLoads",
        "hoistLoads",
        "loopFusion",
        "loopHoist",
        "hoistArrayElements",
        "loopSimplify",
        "eliminateDead",
        "optimizeCost",
        "inlineVars",
        "reorderCompares",
      ]);
    });

    it("should compile primitive and object equality", () => {
      const User = JIT.object({
        id: JIT.number(),
        name: JIT.string(),
        active: JIT.boolean(),
      }).schema;
      const equal = Compiler.compileEqual(User);

      expect(equal({ id: 1, name: "Ada", active: true }, { id: 1, name: "Ada", active: true })).toBe(true);
      expect(equal({ id: Number.NaN, name: "Ada", active: true }, { id: Number.NaN, name: "Ada", active: true })).toBe(
        true
      );
      expect(equal({ id: 1, name: "Ada", active: true }, { id: 1, name: "Grace", active: true })).toBe(false);

      expectTypeOf(equal).parameter(0).toEqualTypeOf<{
        readonly id: number;
        readonly name: string;
        readonly active: boolean;
      }>();
    });

    it("should keep NaN equal for root number schemas", () => {
      const equal = Compiler.compileEqual(JIT.number().schema);

      expect(equal(Number.NaN, Number.NaN)).toBe(true);
      expect(equal(Number.NaN, 1)).toBe(false);
    });

    it("should compile array equality with hoisted length and index loads", () => {
      const Users = JIT.array(
        JIT.object({
          id: JIT.number(),
          name: JIT.string(),
        })
      ).schema;
      const equal = Compiler.compileEqual(Users);

      expect(
        equal(
          [
            { id: 1, name: "Ada" },
            { id: 2, name: "Grace" },
          ],
          [
            { id: 1, name: "Ada" },
            { id: 2, name: "Grace" },
          ]
        )
      ).toBe(true);
      expect(equal([{ id: 1, name: "Ada" }], [{ id: 1, name: "Grace" }])).toBe(false);

      const source = Compiler.emitEqualSource(Users);

      expect(source).toContain("const len = l.length;");
      expect(source).toContain("for (let i = len; i-- !== 0;)");
      expect(source).toContain("const li = l[i];");
      expect(source).not.toContain("Object.keys");
    });

    it("should compile nullish wrappers without mutating the original schema", () => {
      const base = JIT.object({ id: JIT.number() });
      const schema = base.nullish().schema;
      const equal = Compiler.compileEqual(schema);

      expect(schema.type).toBe(AST.TypeName.nullish);
      expect(base.schema.type).toBe(AST.TypeName.object);
      expect(equal(null, null)).toBe(true);
      expect(equal(undefined, undefined)).toBe(true);
      expect(equal(null, undefined)).toBe(false);
      expect(equal({ id: 1 }, { id: 1 })).toBe(true);
      expect(equal({ id: 1 }, { id: 2 })).toBe(false);
    });

    it("should emit deterministic readable source", () => {
      const schema = JIT.object({
        id: JIT.number(),
        name: JIT.string(),
      }).schema;

      expect(Compiler.emitEqualSource(schema)).toMatchInlineSnapshot(`
        "function equal(l, r) {
          if (l === r) {
            return true;
          }
          if (l.id !== r.id && (l.id === l.id || r.id === r.id)) {
            return false;
          }
          if (l.name !== r.name) {
            return false;
          }
          return true;
        }"
      `);
    });

    it("should apply safe optimizations without introducing generic runtime work", () => {
      const schema = JIT.object({
        profile: JIT.object({
          name: JIT.string(),
          age: JIT.number(),
        }),
      }).schema;
      const source = Compiler.emitEqualSource(schema);

      expect(source).toContain("const l_profile = l.profile;");
      expect(source).toContain("const r_profile = r.profile;");
      expect(source).toContain("if (l_profile.name !== r_profile.name)");
      expect(source).not.toContain("Object.keys");
      expect(source).not.toContain(".map(");
    });

    it("should expose JIT.compileEqual as a public convenience API", () => {
      const equal = JIT.compileEqual(JIT.object({ id: JIT.number() }).schema);

      expect(equal({ id: 1 }, { id: 1 })).toBe(true);
      expect(equal({ id: 1 }, { id: 2 })).toBe(false);
    });

    it("should expose JIT.equal as the ergonomic schema-aware equality API", () => {
      const equal = JIT.equal(JIT.object({ id: JIT.number() }).schema);

      expect(equal({ id: 1 }, { id: 1 })).toBe(true);
      expect(equal({ id: 1 }, { id: 2 })).toBe(false);
    });

    it("should compile entity index hints into a map strategy", () => {
      const User = JIT.object({ id: JIT.number(), name: JIT.string() });
      const Users = JIT.array(User).entity({ key: "id" }).indexBy("id").schema;
      const equal = Compiler.compileEqual(Users);
      const source = Compiler.emitEqualSource(Users);

      expect(
        equal(
          [
            { id: 1, name: "Ada" },
            { id: 2, name: "Grace" },
          ],
          [
            { id: 2, name: "Grace" },
            { id: 1, name: "Ada" },
          ]
        )
      ).toBe(true);
      expect(equal([{ id: 1, name: "Ada" }], [{ id: 1, name: "Grace" }])).toBe(false);
      expect(source).toContain("if (len < 64)");
      expect(source).toContain("let rightIndex;");
      expect(source).toContain('__getIndex(r, "id")');
      expect(source).toContain(".get(li.id)");
      expect(source).not.toContain("Object.keys");
      expect(source).not.toContain(".map(");
      expect(source).not.toContain(".filter(");
    });

    it("should compile ordered hints into a binary-search strategy", () => {
      const User = JIT.object({ id: JIT.number(), name: JIT.string() });
      const Users = JIT.array(User).ordered("id", "asc").schema;
      const equal = Compiler.compileEqual(Users);
      const source = Compiler.emitEqualSource(Users);

      expect(
        equal(
          [
            { id: 2, name: "Grace" },
            { id: 1, name: "Ada" },
          ],
          [
            { id: 1, name: "Ada" },
            { id: 2, name: "Grace" },
          ]
        )
      ).toBe(true);
      expect(source).toContain("while (low <= high)");
      expect(source).toContain(">> 1");
      expect(source).not.toContain("Object.keys");
    });

    it("should compile hash hints into a hash short-circuit", () => {
      const User = JIT.object({ id: JIT.number(), name: JIT.string() }).hash("ordered").schema;
      const equal = Compiler.compileEqual(User);
      const source = Compiler.emitEqualSource(User);

      expect(equal({ id: 1, name: "Ada" }, { id: 1, name: "Ada" })).toBe(true);
      expect(equal({ id: 1, name: "Ada" }, { id: 2, name: "Ada" })).toBe(false);
      expect(source).toContain("__hash(l)");
      expect(source).toContain("__hash(r)");
      expect(source).toContain("return false;");
    });

    it("should compile primitive unions", () => {
      const schema = JIT.union(JIT.number(), JIT.string()).schema;
      const equal = Compiler.compileEqual(schema);
      const source = Compiler.emitEqualSource(schema);

      expect(equal(1, 1)).toBe(true);
      expect(equal(Number.NaN, Number.NaN)).toBe(true);
      expect(equal("jit", "jit")).toBe(true);
      expect(equal(1, "1")).toBe(false);
      expect(equal("jit", "codex")).toBe(false);
      expect(source).toContain("l !== r && (l === l || r === r)");
      expect(source).not.toContain("typeof l");
    });

    it("should compile generic object unions with schema guards", () => {
      const Cat = JIT.object({ kind: JIT.literal("cat"), lives: JIT.number() });
      const Dog = JIT.object({ kind: JIT.literal("dog"), bark: JIT.boolean() });
      const schema = JIT.union(Cat, Dog).schema;
      const equal = Compiler.compileEqual(schema);
      const source = Compiler.emitEqualSource(schema);

      expect(equal({ kind: "cat", lives: 9 }, { kind: "cat", lives: 9 })).toBe(true);
      expect(equal({ kind: "cat", lives: 9 }, { kind: "dog", bark: true })).toBe(false);
      expect(equal({ kind: "dog", bark: true }, { kind: "dog", bark: true })).toBe(true);
      expect(source).toContain('l.kind === "cat"');
      expect(source).toContain('r.kind === "cat"');
      expect(source).toContain('l.kind === "dog"');
    });

    it("should compile discriminated object unions", () => {
      const Cat = JIT.object({ kind: JIT.literal("cat"), lives: JIT.number() });
      const Dog = JIT.object({ kind: JIT.literal("dog"), bark: JIT.boolean() });
      const schema = JIT.discriminatedUnion("kind", [Cat, Dog]).schema;
      const equal = Compiler.compileEqual(schema);
      const source = Compiler.emitEqualSource(schema);

      expect(equal({ kind: "cat", lives: 9 }, { kind: "cat", lives: 9 })).toBe(true);
      expect(equal({ kind: "cat", lives: 9 }, { kind: "cat", lives: 8 })).toBe(false);
      expect(equal({ kind: "cat", lives: 9 }, { kind: "dog", bark: true })).toBe(false);
      expect(equal({ kind: "dog", bark: true }, { kind: "dog", bark: true })).toBe(true);
      expect(source).toContain('l.kind === "cat"');
      expect(source).toContain('l.kind === "dog"');
    });

    it("should compile intersections by comparing every member", () => {
      const schema = JIT.intersection(JIT.object({ id: JIT.number() }), JIT.object({ name: JIT.string() })).schema;
      const equal = Compiler.compileEqual(schema);

      expect(equal({ id: 1, name: "Ada" }, { id: 1, name: "Ada" })).toBe(true);
      expect(equal({ id: 1, name: "Ada" }, { id: 2, name: "Ada" })).toBe(false);
      expect(equal({ id: 1, name: "Ada" }, { id: 1, name: "Grace" })).toBe(false);
    });
  });
});
