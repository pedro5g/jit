import { AST, type Builder, JIT } from "../../../index.js";

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

      expectTypeOf<AST.Typeof<typeof User>>().toEqualTypeOf<{
        id: number;
        name: string;
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

      expectTypeOf<AST.Typeof<typeof PartialUser>>().toEqualTypeOf<{
        id: number | undefined;
      }>();

      expectTypeOf<AST.Typeof<typeof RequiredUser>>().toEqualTypeOf<{
        id: number;
      }>();

      expectTypeOf<AST.Typeof<typeof ReadonlyUser>>().toEqualTypeOf<
        Readonly<{
          id: number;
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

      expectTypeOf<AST.Typeof<typeof BuilderNullish>>().toEqualTypeOf<string | null | undefined>();
      expectTypeOf<AST.Typeof<typeof FactoryNullish>>().toEqualTypeOf<number | null | undefined>();
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

    it("keeps pick name-only and partial/required selectable by field", () => {
      const User = JIT.object({
        id: JIT.number(),
        name: JIT.string(),
        email: JIT.string(),
      });
      const PartialName = User.partial("name");
      const RequiredName = PartialName.required("name");
      const Picked = User.pick("id", "name");
      const assertInvalidShapeMask = () => {
        // @ts-expect-error pick accepts field names, not `{ field: true }` masks
        User.pick({ id: true });
      };

      expect(PartialName.schema.def.props.id.type).toBe(AST.TypeName.number);
      expect(PartialName.schema.def.props.name.type).toBe(AST.TypeName.optional);
      expect(RequiredName.schema.def.props.name.type).toBe(AST.TypeName.string);
      expect(Object.keys(Picked.schema.def.props)).toEqual(["id", "name"]);
      expectTypeOf<AST.Typeof<typeof PartialName>>().toEqualTypeOf<{
        id: number;
        name: string | undefined;
        email: string;
      }>();
      expectTypeOf<AST.Typeof<typeof RequiredName>>().toEqualTypeOf<{
        id: number;
        name: string;
        email: string;
      }>();
      expect(assertInvalidShapeMask).toBeTypeOf("function");
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

      expectTypeOf<AST.Typeof<typeof TransformedUser>>().toEqualTypeOf<{
        id: number;
        name: string;
      }>();
      expectTypeOf<AST.Typeof<typeof RefinedName>>().toEqualTypeOf<string>();
      expectTypeOf<AST.Typeof<typeof CoercedNumber>>().toEqualTypeOf<number>();
    });

    it("rejects statically invalid literal defaults", () => {
      const ValidStringDefault = JIT.string().min(5).max(10).default("hello");
      const ValidObjectDefault = JIT.object({
        name: JIT.string().min(5),
        role: JIT.string().oneOf(["admin", "user"] as const),
      }).default({ name: "Pedro", role: "admin" });

      const assertInvalidDefaults = () => {
        // @ts-expect-error literal is shorter than the declared min length
        JIT.string().min(5).default("oi");
        // @ts-expect-error literal does not start with the declared prefix
        JIT.string().startsWith("jit:").default("app:user");
        // @ts-expect-error literal does not include the declared segment
        JIT.string().includes(":user:").default("jit:admin:1");
        // @ts-expect-error literal does not end with the declared suffix
        JIT.string().endsWith(":v1").default("jit:user:v2");
        JIT.string()
          .oneOf(["admin", "user"] as const)
          // @ts-expect-error literal is not one of the declared string options
          .default("root");
        // @ts-expect-error numeric literal is outside the declared max
        JIT.number().max(10).default(11);
        // @ts-expect-error object literal field violates nested constraints
        JIT.object({ name: JIT.string().min(5) }).default({ name: "Ana" });
      };

      expect(ValidStringDefault.schema.type).toBe(AST.TypeName.default);
      expect(ValidObjectDefault.schema.type).toBe(AST.TypeName.default);
      expectTypeOf<Builder.Strict<typeof ValidObjectDefault, { name: "Pedro"; role: "admin" }>>().toEqualTypeOf<{
        name: "Pedro";
        role: "admin";
      }>();
      expectTypeOf<Builder.Strict<typeof ValidObjectDefault, { name: "Ana"; role: "admin" }>>().toEqualTypeOf<never>();
      expect(assertInvalidDefaults).toBeTypeOf("function");
    });

    it("rejects invalid literal format patterns", () => {
      const Formatted = JIT.string().format("(##) #####-####");
      const StrictFormatted = JIT.string().format("(##) #####-####", {
        mode: "strict",
      });
      const assertInvalidFormats = () => {
        // @ts-expect-error format patterns must contain at least one # placeholder
        JIT.string().format("phone");
        // @ts-expect-error format patterns only allow mask characters
        JIT.string().format("##:##");
      };

      expect(Formatted.schema.type).toBe(AST.TypeName.string);
      expect(StrictFormatted.schema.def.checks?.[0]?.value).toMatchObject({
        mode: "strict",
      });
      expect(assertInvalidFormats).toBeTypeOf("function");
    });
  });
});
