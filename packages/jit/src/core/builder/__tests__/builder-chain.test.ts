import { AST, JIT } from "../../../index.js";

describe("Builder chain", () => {
  describe("minimal JIT factories", () => {
    it("creates primitive schemas with a stable runtime shape", () => {
      const NumberBuilder = JIT.number();

      expect(NumberBuilder.schema.type).toBe(AST.TypeName.number);
      expect(NumberBuilder.schema._type).toBeNull();
      expect(NumberBuilder.schema.def).toEqual({});
      expect(NumberBuilder.schema.annotations).toBeUndefined();
      expect(Object.keys(NumberBuilder.schema)).toEqual(["type", "_type", "def", "annotations"]);

      expectTypeOf(NumberBuilder.schema._type).toEqualTypeOf<number>();
    });

    it("creates object builders from schema-like values", () => {
      const User = JIT.object({
        id: JIT.number(),
        name: JIT.string(),
      });

      expect(User.schema.type).toBe(AST.TypeName.object);
      expect(User.schema._type).toBeNull();
      expect(User.schema.def.props.id.type).toBe(AST.TypeName.number);
      expect(User.schema.def.props.name.type).toBe(AST.TypeName.string);
      expect(Object.keys(User.schema)).toEqual(["type", "_type", "def", "annotations"]);

      expectTypeOf<AST.Infer<typeof User>>().toEqualTypeOf<{
        readonly id: number;
        readonly name: string;
      }>();
    });
  });

  describe("object operators", () => {
    it("runs partial, required, and readonly without mutating the original schema", () => {
      const User = JIT.object({
        id: JIT.number(),
      });

      const PartialUser = User.partial();
      const RequiredUser = PartialUser.required();
      const ReadonlyUser = RequiredUser.readonly();

      expect(User.schema.def.props.id.type).toBe(AST.TypeName.number);
      expect(PartialUser.schema.def.props.id.type).toBe(AST.TypeName.optional);
      expect(RequiredUser.schema.def.props.id.type).toBe(AST.TypeName.number);
      expect(ReadonlyUser.schema.type).toBe(AST.TypeName.readonly);
      expect(ReadonlyUser.schema.def.innerType).toBe(RequiredUser.schema);

      expect(User.schema).not.toBe(PartialUser.schema);
      expect(PartialUser.schema).not.toBe(RequiredUser.schema);

      expectTypeOf<AST.Infer<typeof PartialUser>>().toEqualTypeOf<{
        readonly id: number | undefined;
      }>();

      expectTypeOf<AST.Infer<typeof RequiredUser>>().toEqualTypeOf<{
        readonly id: number;
      }>();

      expectTypeOf<AST.Infer<typeof ReadonlyUser>>().toEqualTypeOf<
        Readonly<{
          readonly id: number;
        }>
      >();
    });

    it("wraps schemas with nullish through builders and factories", () => {
      const BuilderNullish = JIT.string().nullish();
      const FactoryNullish = JIT.nullish(JIT.number());

      expect(BuilderNullish.schema.type).toBe(AST.TypeName.nullish);
      expect(BuilderNullish.schema.def.innerType.type).toBe(AST.TypeName.string);
      expect(FactoryNullish.schema.type).toBe(AST.TypeName.nullish);
      expect(FactoryNullish.schema.def.innerType.type).toBe(AST.TypeName.number);

      expectTypeOf<AST.Infer<typeof BuilderNullish>>().toEqualTypeOf<string | null | undefined>();
      expectTypeOf<AST.Infer<typeof FactoryNullish>>().toEqualTypeOf<number | null | undefined>();
    });

    it("rejects object-only operators on primitive builders", () => {
      const assertInvalidNumberBuilder = (builder: ReturnType<typeof JIT.number>) => {
        // @ts-expect-error number builders do not expose object operators
        builder.partial();
        // @ts-expect-error number builders do not expose object field transforms
        builder.transform({});
      };

      expect(assertInvalidNumberBuilder).toBeTypeOf("function");
    });

    it("wraps transform, refine, and coerce operators without mutating inputs", () => {
      const User = JIT.object({
        id: JIT.number(),
        name: JIT.string(),
      });
      const TransformedUser = User.transform({
        name: (value) => value.toUpperCase(),
      });
      const RefinedName = JIT.string().refine((value) => value.length > 0);
      const CoercedNumber = JIT.number().coerce((value) => Number(value));

      expect(TransformedUser.schema.type).toBe(AST.TypeName.transform);
      expect(TransformedUser.schema.def.innerType).toBe(User.schema);
      expect(User.schema.type).toBe(AST.TypeName.object);
      expect(RefinedName.schema.type).toBe(AST.TypeName.refine);
      expect(CoercedNumber.schema.type).toBe(AST.TypeName.coerce);
      expect(Object.keys(TransformedUser.schema)).toEqual(["type", "_type", "def", "annotations"]);

      expectTypeOf<AST.Infer<typeof TransformedUser>>().toEqualTypeOf<{
        readonly id: number;
        readonly name: string;
      }>();
      expectTypeOf<AST.Infer<typeof RefinedName>>().toEqualTypeOf<string>();
      expectTypeOf<AST.Infer<typeof CoercedNumber>>().toEqualTypeOf<number>();
    });
  });
});
