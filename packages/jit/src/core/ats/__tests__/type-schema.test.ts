import type {
  Infer,
  InferSchema,
  InferShape,
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
} from "../index.js";

describe("Core ATS type foundations", () => {
  describe("schema inference", () => {
    it("infers primitive and object schema outputs", () => {
      type UserShape = {
        readonly id: NumberSchema;
        readonly name: StringSchema;
      };

      type UserSchema = ObjectSchema<UserShape>;

      expectTypeOf<InferSchema<StringSchema>>().toEqualTypeOf<string>();
      expectTypeOf<InferSchema<NullishSchema<StringSchema>>>().toEqualTypeOf<string | null | undefined>();
      expectTypeOf<Infer<UserSchema>>().toEqualTypeOf<{
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

      expectTypeOf<InferShape<PartialShape<Shape>>>().toEqualTypeOf<{
        id: number | undefined;
        name: string | undefined;
        nickname: string | undefined;
      }>();

      expectTypeOf<InferShape<RequiredShape<Shape>>>().toEqualTypeOf<{
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

      expectTypeOf<InferShape<PickShape<BaseShape, "id">>>().toEqualTypeOf<{
        id: number;
      }>();

      expectTypeOf<InferShape<OmitShape<BaseShape, "name">>>().toEqualTypeOf<{
        id: number;
      }>();

      expectTypeOf<InferShape<MergeShape<BaseShape, ExtensionShape>>>().toEqualTypeOf<{
        id: number;
        name: string | undefined;
      }>();
    });
  });
});
