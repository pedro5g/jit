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
        readonly id: number;
        readonly name: string;
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
        readonly id: number | undefined;
        readonly name: string | undefined;
        readonly nickname: string | undefined;
      }>();

      expectTypeOf<InferShape<RequiredShape<Shape>>>().toEqualTypeOf<{
        readonly id: number;
        readonly name: string;
        readonly nickname: string;
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
        readonly id: number;
      }>();

      expectTypeOf<InferShape<OmitShape<BaseShape, "name">>>().toEqualTypeOf<{
        readonly id: number;
      }>();

      expectTypeOf<InferShape<MergeShape<BaseShape, ExtensionShape>>>().toEqualTypeOf<{
        readonly id: number;
        readonly name: string | undefined;
      }>();
    });
  });
});
