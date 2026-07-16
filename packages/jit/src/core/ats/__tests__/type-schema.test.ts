import type {
  MergeShape,
  NullishSchema,
  NumberSchema,
  ObjectSchema,
  OmitShape,
  OptionalSchema,
  PartialShape,
  PickShape,
  RequiredShape,
  StringSchema,
  Typeof,
  TypeofSchema,
  TypeofShape,
} from "../index.js";

describe("Core ATS type foundations", () => {
  describe("schema inference", () => {
    it("infers primitive and object schema outputs", () => {
      type UserShape = {
        readonly id: NumberSchema;
        readonly name: StringSchema;
      };

      type UserSchema = ObjectSchema<UserShape>;

      expectTypeOf<TypeofSchema<StringSchema>>().toEqualTypeOf<string>();
      expectTypeOf<TypeofSchema<NullishSchema<StringSchema>>>().toEqualTypeOf<string | null | undefined>();
      expectTypeOf<Typeof<UserSchema>>().toEqualTypeOf<{
        id: number;
        name: string;
      }>();
    });
  });

  describe("object shape transforms", () => {
    it("maps optional and required object shapes", () => {
      type Shape = {
        readonly id: NumberSchema;
        readonly name: StringSchema;
        readonly nickname: OptionalSchema<StringSchema>;
      };

      expectTypeOf<TypeofShape<PartialShape<Shape>>>().toEqualTypeOf<{
        id: number | undefined;
        name: string | undefined;
        nickname: string | undefined;
      }>();

      expectTypeOf<TypeofShape<RequiredShape<Shape>>>().toEqualTypeOf<{
        id: number;
        name: string;
        nickname: string;
      }>();
    });

    it("maps pick, omit, and merge object shapes", () => {
      type BaseShape = {
        readonly id: NumberSchema;
        readonly name: StringSchema;
      };

      type ExtensionShape = {
        readonly name: OptionalSchema<StringSchema>;
      };

      expectTypeOf<TypeofShape<PickShape<BaseShape, "id">>>().toEqualTypeOf<{
        id: number;
      }>();

      expectTypeOf<TypeofShape<OmitShape<BaseShape, "name">>>().toEqualTypeOf<{
        id: number;
      }>();

      expectTypeOf<TypeofShape<MergeShape<BaseShape, ExtensionShape>>>().toEqualTypeOf<{
        id: number;
        name: string | undefined;
      }>();
    });
  });
});
