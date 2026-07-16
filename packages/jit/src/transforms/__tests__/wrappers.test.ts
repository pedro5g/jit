import { AST, JIT, Transform } from "../../index.js";

describe("Transform wrapper operators", () => {
  const Base = JIT.string().schema;

  describe("modifier wrappers", () => {
    it("wraps schemas in optional, nullable, nullish, readonly, and promise nodes", () => {
      const cases = [
        { wrapped: Transform.optional(Base), type: AST.TypeName.optional },
        { wrapped: Transform.nullable(Base), type: AST.TypeName.nullable },
        { wrapped: Transform.nullish(Base), type: AST.TypeName.nullish },
        { wrapped: Transform.readonly(Base), type: AST.TypeName.readonly },
        { wrapped: Transform.promise(Base), type: AST.TypeName.promise },
      ] as const;

      for (const { wrapped, type } of cases) {
        expect(wrapped.type).toBe(type);
        expect(wrapped.def.innerType).toBe(Base);
        expect(wrapped._type).toBeNull();
        expect(Object.keys(wrapped)).toEqual(["type", "_type", "def", "annotations"]);
      }

      expectTypeOf<AST.Typeof<ReturnType<typeof Transform.optional<typeof Base>>>>().toEqualTypeOf<
        string | undefined
      >();
      expectTypeOf<AST.Typeof<ReturnType<typeof Transform.nullable<typeof Base>>>>().toEqualTypeOf<string | null>();
      expectTypeOf<AST.Typeof<ReturnType<typeof Transform.nullish<typeof Base>>>>().toEqualTypeOf<
        string | null | undefined
      >();
    });

    it("does not mutate the wrapped schema", () => {
      Transform.optional(Base);

      expect(Base.type).toBe(AST.TypeName.string);
      expect(Object.keys(Base)).toEqual(["type", "_type", "def", "annotations"]);
    });
  });

  describe("default", () => {
    it("stores plain default values and lazy factories", () => {
      const WithValue = Transform.default(Base, "fallback");
      const factory = () => "lazy";
      const WithFactory = Transform.default(Base, factory);

      expect(WithValue.type).toBe(AST.TypeName.default);
      expect(WithValue.def.defaultValue).toBe("fallback");
      expect(WithFactory.def.defaultValue).toBe(factory);
    });
  });

  describe("brand", () => {
    it("stores the brand name alongside the inner schema", () => {
      const UserId = Transform.brand(Base, "UserId");

      expect(UserId.type).toBe(AST.TypeName.brand);
      expect(UserId.def.innerType).toBe(Base);
      expect(UserId.def.brand).toBe("UserId");
    });
  });

  describe("behavior wrappers", () => {
    it("stores pipe transforms, refine predicates, and coercers as external bindings", () => {
      const toLength = (value: string) => value.length;
      const nonEmpty = (value: string) => value.length > 0;
      const toStr = (value: unknown) => String(value);

      const Piped = Transform.pipe(Base, toLength);
      const Refined = Transform.refine(Base, nonEmpty);
      const Coerced = Transform.coerce(Base, toStr);

      expect(Piped.type).toBe(AST.TypeName.pipe);
      expect(Piped.def.transform).toBe(toLength);
      expect(Refined.type).toBe(AST.TypeName.refine);
      expect(Refined.def.predicate).toBe(nonEmpty);
      expect(Coerced.type).toBe(AST.TypeName.coerce);
      expect(Coerced.def.coercer).toBe(toStr);

      for (const schema of [Piped, Refined, Coerced]) {
        expect(schema.def.innerType).toBe(Base);
      }
    });

    it("stores per-field transform specs on object schemas", () => {
      const User = JIT.object({ name: JIT.string() }).schema;
      const upper = (value: string) => value.toUpperCase();
      const Transformed = Transform.transform(User, { name: upper });

      expect(Transformed.type).toBe(AST.TypeName.transform);
      expect(Transformed.def.innerType).toBe(User);
      expect(Transformed.def.transforms).toEqual({ name: upper });
    });
  });
});
