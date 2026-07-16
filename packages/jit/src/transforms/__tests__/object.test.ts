import { AST, JIT, Transform } from "../../index.js";

describe("Transform object operators", () => {
  const User = JIT.object({
    id: JIT.number(),
    name: JIT.string(),
  }).schema;

  describe("partial", () => {
    it("wraps every prop in optional without mutating the original schema", () => {
      const PartialUser = Transform.partial(User);

      expect(PartialUser).not.toBe(User);
      expect(PartialUser.type).toBe(AST.TypeName.object);
      expect(PartialUser.def.props.id.type).toBe(AST.TypeName.optional);
      expect(PartialUser.def.props.name.type).toBe(AST.TypeName.optional);
      expect(PartialUser.def.props.id.def.innerType).toBe(User.def.props.id);

      expect(User.def.props.id.type).toBe(AST.TypeName.number);
      expect(User.def.props.name.type).toBe(AST.TypeName.string);

      expectTypeOf<AST.Typeof<typeof PartialUser>>().toEqualTypeOf<{
        id: number | undefined;
        name: string | undefined;
      }>();
    });

    it("preserves the stable runtime shape and annotations slot", () => {
      const PartialUser = Transform.partial(User);

      expect(Object.keys(PartialUser)).toEqual(["type", "_type", "def", "annotations"]);
      expect(PartialUser._type).toBeNull();
    });
  });

  describe("required", () => {
    it("unwraps optional props and leaves non-optional props untouched", () => {
      const PartialUser = Transform.partial(User);
      const RequiredUser = Transform.required(PartialUser);

      expect(RequiredUser.def.props.id.type).toBe(AST.TypeName.number);
      expect(RequiredUser.def.props.name.type).toBe(AST.TypeName.string);
      expect(RequiredUser.def.props.id).toBe(User.def.props.id);

      expectTypeOf<AST.Typeof<typeof RequiredUser>>().toEqualTypeOf<{
        id: number;
        name: string;
      }>();
    });

    it("is a no-op on schemas that are already required", () => {
      const RequiredUser = Transform.required(User);

      expect(RequiredUser.def.props.id).toBe(User.def.props.id);
      expect(RequiredUser.def.props.name).toBe(User.def.props.name);
    });
  });

  describe("pick", () => {
    it("keeps only the selected props, reusing the original prop schemas", () => {
      const IdOnly = Transform.pick(User, ["id"]);

      expect(Object.keys(IdOnly.def.props)).toEqual(["id"]);
      expect(IdOnly.def.props.id).toBe(User.def.props.id);

      expectTypeOf<AST.Typeof<typeof IdOnly>>().toEqualTypeOf<{
        id: number;
      }>();
    });

    it("rejects unknown keys at the type level", () => {
      const assertInvalidPick = () => {
        // @ts-expect-error "missing" is not a prop of User
        Transform.pick(User, ["missing"]);
      };

      expect(assertInvalidPick).toBeTypeOf("function");
    });
  });

  describe("omit", () => {
    it("drops the selected props and keeps the rest", () => {
      const NameOnly = Transform.omit(User, ["id"]);

      expect(Object.keys(NameOnly.def.props)).toEqual(["name"]);
      expect(NameOnly.def.props.name).toBe(User.def.props.name);

      expectTypeOf<AST.Typeof<typeof NameOnly>>().toEqualTypeOf<{
        name: string;
      }>();
    });
  });

  describe("extend", () => {
    it("adds new props and overrides colliding ones with the extension", () => {
      const Extended = Transform.extend(User, {
        active: JIT.boolean().schema,
        id: JIT.string().schema,
      });

      expect(Extended.def.props.active.type).toBe(AST.TypeName.boolean);
      expect(Extended.def.props.id.type).toBe(AST.TypeName.string);
      expect(Extended.def.props.name).toBe(User.def.props.name);

      expect(User.def.props.id.type).toBe(AST.TypeName.number);

      expectTypeOf<AST.Typeof<typeof Extended>>().toEqualTypeOf<{
        id: string;
        name: string;
        active: boolean;
      }>();
    });
  });

  describe("merge", () => {
    it("merges two object schemas with right-hand props winning", () => {
      const Role = JIT.object({
        id: JIT.string(),
        role: JIT.string(),
      }).schema;
      const Merged = Transform.merge(User, Role);

      expect(Merged.def.props.id.type).toBe(AST.TypeName.string);
      expect(Merged.def.props.name).toBe(User.def.props.name);
      expect(Merged.def.props.role).toBe(Role.def.props.role);

      expectTypeOf<AST.Typeof<typeof Merged>>().toEqualTypeOf<{
        id: string;
        name: string;
        role: string;
      }>();
    });

    it("concatenates checks from both sides", () => {
      const Left = JIT.object({ id: JIT.number() }).schema;
      const Right = JIT.object({ name: JIT.string() }).schema;
      const Merged = Transform.merge(Left, Right);

      expect(Merged.def.checks).toEqual([...Left.def.checks, ...Right.def.checks]);
    });
  });

  describe("unknown keys", () => {
    it("sets strict and loose policies without mutating the original schema", () => {
      const Strict = Transform.strict(User);
      const Loose = Transform.loose(User);

      expect(Strict.def.unknownKeys).toBe("strict");
      expect(Loose.def.unknownKeys).toBe("passthrough");
      expect(User.def.unknownKeys).toBeUndefined();
      expect(Strict.def.props).toBe(User.def.props);
      expect(Loose.def.props).toBe(User.def.props);
    });

    it("attaches a catchall schema and preserves it through shape transforms", () => {
      const Extra = JIT.string().schema;
      const Catchall = Transform.catchall(User, Extra);
      const Picked = Transform.pick(Catchall, ["id"]);
      const Extended = Transform.extend(Catchall, {
        active: JIT.boolean().schema,
      });

      expect(Catchall.def.unknownKeys).toBe("passthrough");
      expect(Catchall.def.catchall).toBe(Extra);
      expect(Picked.def.catchall).toBe(Extra);
      expect(Extended.def.catchall).toBe(Extra);

      expectTypeOf<AST.Typeof<typeof Catchall>>().toEqualTypeOf<
        {
          id: number;
          name: string;
        } & Record<string, string | number>
      >();
    });

    it("creates enum schemas from object keys", () => {
      const Keys = Transform.keyof(User);

      expect(Keys.type).toBe(AST.TypeName.enum);
      expect(Keys.def.values).toEqual(["id", "name"]);
      expectTypeOf<AST.Typeof<typeof Keys>>().toEqualTypeOf<"id" | "name">();
    });
  });
});
