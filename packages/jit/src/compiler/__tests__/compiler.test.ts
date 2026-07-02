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
          if (Object.is(l, r)) {
            return true;
          }
          const l_id = l.id;
          const r_id = r.id;
          if (!((l_id === r_id || (l_id !== l_id && r_id !== r_id)))) {
            return false;
          }
          if (!((l.name === r.name))) {
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
      expect(source).toContain("if (!((l_profile.name === r_profile.name)))");
      expect(source).not.toContain("Object.keys");
      expect(source).not.toContain(".map(");
    });

    it("should expose JIT.compileEqual as a public convenience API", () => {
      const equal = JIT.compileEqual(JIT.object({ id: JIT.number() }).schema);

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
      expect(source).toContain("new Map()");
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
      expect(source).toContain('("object" + "|") + l.id');
      expect(source).toContain("return false;");
    });
  });
});
