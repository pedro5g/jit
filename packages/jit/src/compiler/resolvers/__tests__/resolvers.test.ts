import { AST, JIT } from "../../../index.js";
import { resolveCompilerHints, resolveHintKey } from "../resolve-hints.js";
import { resolveWrappers } from "../resolve-wrappers.js";

describe("compiler resolvers", () => {
  describe("resolveWrappers", () => {
    it("returns the schema itself when nothing is wrapped", () => {
      const Base = JIT.string().schema;
      const resolved = resolveWrappers(Base);

      expect(resolved.base).toBe(Base);
      expect(resolved.optional).toBe(false);
      expect(resolved.nullable).toBe(false);
    });

    it("unwraps optional and nullable flags", () => {
      const Base = JIT.number().schema;

      expect(resolveWrappers(JIT.optional(JIT.number()).schema).optional).toBe(true);
      expect(resolveWrappers(JIT.nullable(JIT.number()).schema).nullable).toBe(true);

      const nullish = resolveWrappers(JIT.nullish(JIT.number()).schema);

      expect(nullish.optional).toBe(true);
      expect(nullish.nullable).toBe(true);
      expect(nullish.base.type).toBe(Base.type);
    });

    it("unwraps stacked behavior wrappers down to the base schema", () => {
      const Wrapped = JIT.string()
        .refine((value) => value.length > 0)
        .brand("NonEmpty")
        .readonly()
        .optional().schema;

      const resolved = resolveWrappers(Wrapped);

      expect(resolved.base.type).toBe(AST.TypeName.string);
      expect(resolved.optional).toBe(true);
    });

    it("resolves lazy schemas through their getter", () => {
      const Base = JIT.string().schema;
      const Lazy = JIT.lazy(() => JIT.string());

      const resolved = resolveWrappers(Lazy.schema);

      expect(resolved.base.type).toBe(Base.type);
    });
  });

  describe("resolveHintKey", () => {
    it("accepts plain string keys", () => {
      expect(resolveHintKey("id")).toBe("id");
    });

    it("accepts single-element string arrays", () => {
      expect(resolveHintKey(["id"])).toBe("id");
    });

    it("rejects everything else", () => {
      expect(resolveHintKey(["id", "name"])).toBeUndefined();
      expect(resolveHintKey([42])).toBeUndefined();
      expect(resolveHintKey(42)).toBeUndefined();
      expect(resolveHintKey(undefined)).toBeUndefined();
    });
  });

  describe("resolveCompilerHints", () => {
    it("resolves base schema and hint bag together", () => {
      const Users = JIT.array(
        JIT.object({
          id: JIT.number(),
          name: JIT.string(),
        })
      ).entity({ key: "id" });

      const { base, hints } = resolveCompilerHints(Users.schema);

      expect(base.type).toBe(AST.TypeName.array);
      expect(hints.entity?.key).toBe("id");
    });
  });
});
