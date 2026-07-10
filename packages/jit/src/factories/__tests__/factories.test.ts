import { AST, JIT } from "../../index.js";

describe("JIT AST builders", () => {
  describe("primitives", () => {
    it("should correctly generate the string schema", () => {
      const schema = JIT.string().schema;

      expect(schema.type).toBe(AST.TypeName.string);
      expect(schema._type).toBeNull();
      expect(schema.def).toEqual({});
      expect(schema.annotations).toBeUndefined();
      expect(Object.keys(schema)).toEqual(["type", "_type", "def", "annotations"]);

      expectTypeOf(schema._type).toEqualTypeOf<string>();
    });

    it("should correctly generate number variants", () => {
      expect(JIT.number().schema.type).toBe(AST.TypeName.number);
      expectTypeOf(JIT.number().schema._type).toEqualTypeOf<number>();

      expect(JIT.int().schema.type).toBe(AST.TypeName.int);
      expectTypeOf(JIT.int().schema._type).toEqualTypeOf<number>();

      expect(JIT.bigint().schema.type).toBe(AST.TypeName.bigint);
      expectTypeOf(JIT.bigint().schema._type).toEqualTypeOf<bigint>();

      expect(JIT.nan().schema.type).toBe(AST.TypeName.nan);
      expectTypeOf(JIT.nan().schema._type).toEqualTypeOf<number>();
    });

    it("should correctly generate special primitive schemas", () => {
      expect(JIT.boolean().schema.type).toBe(AST.TypeName.boolean);
      expectTypeOf(JIT.boolean().schema._type).toEqualTypeOf<boolean>();

      expect(JIT.null().schema.type).toBe(AST.TypeName.null);
      expectTypeOf(JIT.null().schema._type).toEqualTypeOf<null>();

      expect(JIT.undefined().schema.type).toBe(AST.TypeName.undefined);
      expectTypeOf(JIT.undefined().schema._type).toEqualTypeOf<undefined>();

      expect(JIT.symbol().schema.type).toBe(AST.TypeName.symbol);
      expectTypeOf(JIT.symbol().schema._type).toEqualTypeOf<symbol>();

      expect(JIT.void().schema.type).toBe(AST.TypeName.void);
      expectTypeOf(JIT.void().schema._type).toEqualTypeOf<void>();

      expect(JIT.never().schema.type).toBe(AST.TypeName.never);
      expectTypeOf(JIT.never().schema._type).toEqualTypeOf<never>();

      expect(JIT.any().schema.type).toBe(AST.TypeName.any);
      expectTypeOf(JIT.any().schema._type).toEqualTypeOf<any>();

      expect(JIT.unknown().schema.type).toBe(AST.TypeName.unknown);
      expectTypeOf(JIT.unknown().schema._type).toEqualTypeOf<unknown>();
    });

    it("should correctly generate object-backed primitive schemas", () => {
      expect(JIT.file().schema.type).toBe(AST.TypeName.file);
      expectTypeOf(JIT.file().schema._type).toEqualTypeOf<File>();

      expect(JIT.date().schema.type).toBe(AST.TypeName.date);
      expectTypeOf(JIT.date().schema._type).toEqualTypeOf<Date>();

      expect(JIT.regex().schema.type).toBe(AST.TypeName.regex);
      expectTypeOf(JIT.regex().schema._type).toEqualTypeOf<RegExp>();
    });
  });

  describe("collections", () => {
    it("should encapsulate schemas within an array", () => {
      const string_schema = JIT.string();
      const array_schema = JIT.array(string_schema).schema;

      expect(array_schema.type).toBe(AST.TypeName.array);
      expect(array_schema.def.element).toBe(string_schema.schema);
      expectTypeOf(array_schema._type).toEqualTypeOf<string[]>();
    });

    it("should correctly construct set, map, and record schemas", () => {
      const set_schema = JIT.set(JIT.string()).schema;
      expect(set_schema.type).toBe(AST.TypeName.set);
      expect(set_schema.def.element.type).toBe(AST.TypeName.string);
      expectTypeOf(set_schema._type).toEqualTypeOf<Set<string>>();

      const map_schema = JIT.map(JIT.string(), JIT.number()).schema;
      expect(map_schema.type).toBe(AST.TypeName.map);
      expect(map_schema.def.key.type).toBe(AST.TypeName.string);
      expect(map_schema.def.value.type).toBe(AST.TypeName.number);
      expectTypeOf(map_schema._type).toEqualTypeOf<Map<string, number>>();

      const record_schema = JIT.record(JIT.string(), JIT.number()).schema;
      expect(record_schema.type).toBe(AST.TypeName.record);
      expect(record_schema.def.key.type).toBe(AST.TypeName.string);
      expect(record_schema.def.value.type).toBe(AST.TypeName.number);
      expectTypeOf(record_schema._type).toEqualTypeOf<Record<string, number>>();
    });

    it("should infer and construct variadic tuples", () => {
      const tuple_schema = JIT.tuple(JIT.string(), JIT.number()).schema;

      expect(tuple_schema.type).toBe(AST.TypeName.tuple);
      expect(tuple_schema.def.items).toHaveLength(2);
      expect(tuple_schema.def.items[0].type).toBe(AST.TypeName.string);
      expect(tuple_schema.def.items[1].type).toBe(AST.TypeName.number);
      expectTypeOf(tuple_schema._type).toEqualTypeOf<[string, number]>();
    });
  });

  describe("complex structures", () => {
    it("should construct and infer object schemas by mapping keys", () => {
      const object_schema = JIT.object({
        id: JIT.string(),
        name: JIT.string(),
        isActive: JIT.boolean(),
      }).schema;

      expect(object_schema.type).toBe(AST.TypeName.object);
      expect(object_schema.def.props.id.type).toBe(AST.TypeName.string);
      expect(object_schema.def.props.name.type).toBe(AST.TypeName.string);
      expect(object_schema.def.props.isActive.type).toBe(AST.TypeName.boolean);
      expectTypeOf(object_schema._type).toEqualTypeOf<{
        id: string;
        name: string;
        isActive: boolean;
      }>();
    });

    it("should construct and infer union and intersection schemas", () => {
      const union_schema = JIT.union(JIT.string(), JIT.number()).schema;
      expect(union_schema.type).toBe(AST.TypeName.union);
      expect(union_schema.def.options).toHaveLength(2);
      expectTypeOf(union_schema._type).toEqualTypeOf<string | number>();

      const intersection_schema = JIT.intersection(
        JIT.object({ a: JIT.string() }),
        JIT.object({ b: JIT.number() })
      ).schema;
      expect(intersection_schema.type).toBe(AST.TypeName.intersection);
      expect(intersection_schema.def.options).toHaveLength(2);
      expectTypeOf(intersection_schema._type).toEqualTypeOf<
        {
          a: string;
        } & {
          b: number;
        }
      >();
    });

    it("should construct discriminated unions", () => {
      const schema = JIT.discriminatedUnion("type", [
        JIT.object({ type: JIT.literal("user"), name: JIT.string() }),
        JIT.object({ type: JIT.literal("org"), members: JIT.number() }),
      ]).schema;

      expect(schema.type).toBe(AST.TypeName.discriminatedUnion);
      expect(schema.def.discriminator).toBe("type");
      expect(schema.def.options).toHaveLength(2);
      expectTypeOf(schema._type).toEqualTypeOf<
        | {
            type: "user";
            name: string;
          }
        | {
            type: "org";
            members: number;
          }
      >();
    });
  });

  describe("literal", () => {
    it("should construct and infer literals", () => {
      const string_literal = JIT.literal("literal").schema;
      expect(string_literal.type).toBe(AST.TypeName.literal);
      expect(string_literal.def.value).toBe("literal");
      expectTypeOf(string_literal._type).toEqualTypeOf<"literal">();

      const number_literal = JIT.literal(1).schema;
      expect(number_literal.def.value).toBe(1);
      expectTypeOf(number_literal._type).toEqualTypeOf<1>();

      const boolean_literal = JIT.literal(true).schema;
      expect(boolean_literal.def.value).toBe(true);
      expectTypeOf(boolean_literal._type).toEqualTypeOf<true>();
    });

    it("should construct and infer enum schemas", () => {
      const enum_schema = JIT.enum({
        PENDING: "pending",
        SUCCESS: "success",
        FAILED: "failed",
      }).schema;

      expect(enum_schema.type).toBe(AST.TypeName.enum);
      expect(enum_schema.def.values).toEqual({
        PENDING: "pending",
        SUCCESS: "success",
        FAILED: "failed",
      });
      expectTypeOf(enum_schema._type).toEqualTypeOf<"pending" | "success" | "failed">();
    });

    it("should construct and infer enum schemas from readonly arrays", () => {
      const fish_schema = JIT.enum(["Salmon", "Tuna", "Trout"] as const).schema;

      expect(fish_schema.type).toBe(AST.TypeName.enum);
      expect(fish_schema.def.values).toEqual(["Salmon", "Tuna", "Trout"]);
      expectTypeOf(fish_schema._type).toEqualTypeOf<"Salmon" | "Tuna" | "Trout">();
    });
  });

  describe("modifiers and chains", () => {
    it("should wrap optional, nullable, nullish, readonly, and promise schemas", () => {
      const optional_schema = JIT.string().optional().schema;
      expect(optional_schema.type).toBe(AST.TypeName.optional);
      expectTypeOf(optional_schema._type).toEqualTypeOf<string | undefined>();

      const factory_optional_schema = JIT.optional(JIT.string()).schema;
      expect(factory_optional_schema.type).toBe(AST.TypeName.optional);
      expectTypeOf(factory_optional_schema._type).toEqualTypeOf<string | undefined>();

      const nullable_schema = JIT.number().nullable().schema;
      expect(nullable_schema.type).toBe(AST.TypeName.nullable);
      expectTypeOf(nullable_schema._type).toEqualTypeOf<number | null>();

      const factory_nullable_schema = JIT.nullable(JIT.number()).schema;
      expect(factory_nullable_schema.type).toBe(AST.TypeName.nullable);
      expectTypeOf(factory_nullable_schema._type).toEqualTypeOf<number | null>();

      const nullish_schema = JIT.nullish(JIT.boolean()).schema;
      expect(nullish_schema.type).toBe(AST.TypeName.nullish);
      expectTypeOf(nullish_schema._type).toEqualTypeOf<boolean | null | undefined>();

      const readonly_schema = JIT.object({ id: JIT.number() }).readonly().schema;
      expect(readonly_schema.type).toBe(AST.TypeName.readonly);
      expectTypeOf(readonly_schema._type).toEqualTypeOf<
        Readonly<{
          id: number;
        }>
      >();

      expectTypeOf(JIT.array(JIT.string()).readonly().schema._type).toEqualTypeOf<readonly string[]>();
      expectTypeOf(JIT.tuple(JIT.string(), JIT.number()).readonly().schema._type).toEqualTypeOf<
        readonly [string, number]
      >();
      expectTypeOf(JIT.set(JIT.string()).readonly().schema._type).toEqualTypeOf<ReadonlySet<string>>();
      expectTypeOf(JIT.map(JIT.string(), JIT.number()).readonly().schema._type).toEqualTypeOf<
        ReadonlyMap<string, number>
      >();

      const promise_schema = JIT.string().promise().schema;
      expect(promise_schema.type).toBe(AST.TypeName.promise);
      expectTypeOf(promise_schema._type).toEqualTypeOf<Promise<string>>();

      const factory_promise_schema = JIT.promise(JIT.string()).schema;
      expect(factory_promise_schema.type).toBe(AST.TypeName.promise);
      expectTypeOf(factory_promise_schema._type).toEqualTypeOf<Promise<string>>();
    });

    it("should register default values and brands", () => {
      const default_schema = JIT.string().default("empty").schema;
      expect(default_schema.type).toBe(AST.TypeName.default);
      expect(default_schema.def.defaultValue).toBe("empty");
      expect(default_schema.def.innerType.type).toBe(AST.TypeName.string);
      expectTypeOf(default_schema._type).toEqualTypeOf<string>();

      const factory_default_schema = JIT.default(JIT.string(), "factory-empty").schema;
      expect(factory_default_schema.type).toBe(AST.TypeName.default);
      expect(factory_default_schema.def.defaultValue).toBe("factory-empty");
      expectTypeOf(factory_default_schema._type).toEqualTypeOf<string>();

      const UserId = JIT.string().brand("UserId").schema;
      expect(UserId.type).toBe(AST.TypeName.brand);
      expect(UserId.def.brand).toBe("UserId");
      expectTypeOf(UserId._type).toEqualTypeOf<string & { readonly __brand: "UserId" }>();

      const FactoryUserId = JIT.brand(JIT.string(), "FactoryUserId").schema;
      expect(FactoryUserId.type).toBe(AST.TypeName.brand);
      expect(FactoryUserId.def.brand).toBe("FactoryUserId");
      expectTypeOf(FactoryUserId._type).toEqualTypeOf<string & { readonly __brand: "FactoryUserId" }>();
    });

    it("should attach compile hints through fluent APIs without mutating original schemas", () => {
      const User = JIT.object({ id: JIT.number(), name: JIT.string() });
      const Users = JIT.array(User);
      const IndexedUsers = Users.entity({ key: "id" })
        .keyed("id")
        .groupBy("name")
        .sortBy("id", "asc")
        .uniqueBy("id")
        .hash("ordered");
      const schema = IndexedUsers.schema;

      expect(Users.schema.annotations).toBeUndefined();
      expect(schema.annotations?.hints?.entity?.key).toBe("id");
      expect(schema.annotations?.hints?.collection?.identify).toBe("id");
      expect(schema.annotations?.hints?.collection?.indexed).toBe(true);
      expect(schema.annotations?.hints?.collection?.groupBy).toBe("name");
      expect(schema.annotations?.hints?.collection?.uniqueBy).toBe("id");
      expect(schema.annotations?.hints?.collection?.unique).toBe(true);
      expect(schema.annotations?.hints?.collection?.ordered?.direction).toBe("asc");
      expect(schema.annotations?.hints?.hash?.strategy).toBe("ordered");
      expect(schema._type).toBeNull();
      expect(Object.keys(schema)).toEqual(["type", "_type", "def", "annotations"]);

      expectTypeOf(schema._type).toEqualTypeOf<
        {
          id: number;
          name: string;
        }[]
      >();
    });

    it("should generate transformations and lazy schemas", () => {
      const transformer = (value: string) => parseInt(value, 10);
      const piped = JIT.string().pipe(transformer).schema;

      expect(piped.type).toBe(AST.TypeName.pipe);
      expect(piped.def.transform).toBe(transformer);
      expectTypeOf(piped._type).toEqualTypeOf<number>();

      const factory_piped = JIT.pipe(JIT.string(), transformer).schema;
      expect(factory_piped.type).toBe(AST.TypeName.pipe);
      expect(factory_piped.def.transform).toBe(transformer);
      expectTypeOf(factory_piped._type).toEqualTypeOf<number>();

      const transformed = JIT.object({ id: JIT.number(), name: JIT.string() }).transform({
        name: (value) => value.toUpperCase(),
      }).schema;
      expect(transformed.type).toBe(AST.TypeName.transform);
      expect(transformed.def.innerType.type).toBe(AST.TypeName.object);
      expectTypeOf(transformed._type).toEqualTypeOf<{
        id: number;
        name: string;
      }>();

      const refined = JIT.refine(JIT.string(), (value) => value.length > 0).schema;
      expect(refined.type).toBe(AST.TypeName.refine);
      expectTypeOf(refined._type).toEqualTypeOf<string>();

      const coerced = JIT.coerce(JIT.number(), (value) => Number(value)).schema;
      expect(coerced.type).toBe(AST.TypeName.coerce);
      expectTypeOf(coerced._type).toEqualTypeOf<number>();

      const lazyString = JIT.lazy(() => JIT.string()).schema;
      expect(lazyString.type).toBe(AST.TypeName.lazy);
      expect(lazyString.def.getter().type).toBe(AST.TypeName.string);
      expectTypeOf(lazyString._type).toEqualTypeOf<string>();

      let schema!: { readonly schema: AST.AnyTypeSchema };
      const recursive = JIT.object({
        id: JIT.string(),
        self: JIT.lazy(() => schema),
      });
      schema = recursive;

      expect(recursive.schema.type).toBe(AST.TypeName.object);
      const lazyNode = recursive.schema.def.props.self;
      expect(lazyNode.type).toBe(AST.TypeName.lazy);
      expect(lazyNode.def.getter()).toBe(recursive.schema);
    });

    it("should construct instanceOf schemas", () => {
      class User {
        readonly id = 1;
      }

      const schema = JIT.instanceOf(User).schema;

      expect(schema.type).toBe(AST.TypeName.instanceof);
      expect(schema.def.ctor).toBe(User);
      expectTypeOf(schema._type).toEqualTypeOf<User>();
    });

    it("should construct json, custom, template literal, and function schemas", () => {
      const Json = JIT.json().schema;
      const Custom = JIT.custom<{ cents: number }>((value) => typeof value === "object" && value !== null).schema;
      const Greeting = JIT.templateLiteral(["hello, ", JIT.string(), "!"] as const).schema;
      const MyFunction = JIT.function({
        input: [JIT.string()],
        output: JIT.number(),
      });
      const computeTrimmedLength = MyFunction.implement((input) => input.trim().length);
      const InputOnly = JIT.function({ input: [JIT.string()] });
      const returnsBoolean = InputOnly.implement((input) => input.length > 0);

      expect(Json.type).toBe(AST.TypeName.json);
      expect(Custom.type).toBe(AST.TypeName.custom);
      expect(Greeting.type).toBe(AST.TypeName.templateLiteral);
      expect(Greeting.def.parts[0]).toBe("hello, ");
      expect(Greeting.def.parts[1].type).toBe(AST.TypeName.string);
      expect(MyFunction.schema.type).toBe(AST.TypeName.function);
      expect(MyFunction.schema.def.input[0].type).toBe(AST.TypeName.string);
      expect(MyFunction.schema.def.output?.type).toBe(AST.TypeName.number);

      expectTypeOf(Json._type).toEqualTypeOf<AST.JsonValue>();
      expectTypeOf(Custom._type).toEqualTypeOf<{ cents: number }>();
      expectTypeOf(Greeting._type).toEqualTypeOf<`hello, ${string}!`>();
      expectTypeOf<AST.Infer<typeof MyFunction>>().toEqualTypeOf<(input: string) => number>();
      expectTypeOf(computeTrimmedLength).toEqualTypeOf<(input: string) => number>();
      expectTypeOf(returnsBoolean).toEqualTypeOf<(input: string) => boolean>();
    });

    it("should apply external builder functions inside chains", () => {
      function setCommonNumberChecks<TSchema extends ReturnType<typeof JIT.number>>(schema: TSchema) {
        return schema.min(0).max(100);
      }

      const schema = JIT.number().apply(setCommonNumberChecks).nullable().schema;

      expect(schema.type).toBe(AST.TypeName.nullable);
      expect(schema.def.innerType.def.checks).toEqual([
        { kind: "min", value: 0 },
        { kind: "max", value: 100 },
      ]);
      expectTypeOf(schema._type).toEqualTypeOf<number | null>();
    });

    it("should construct Temporal schemas", () => {
      const Instant = JIT.temporal.instant().schema;
      const PlainDate = JIT.temporal.plainDate().schema;
      const Duration = JIT.temporal.duration().schema;

      expect(Instant.type).toBe(AST.TypeName.temporal);
      expect(Instant.def.kind).toBe("instant");
      expect(PlainDate.def.kind).toBe("plainDate");
      expect(Duration.def.kind).toBe("duration");

      expectTypeOf(Instant._type).toEqualTypeOf<Temporal.Instant>();
      expectTypeOf(PlainDate._type).toEqualTypeOf<Temporal.PlainDate>();
      expectTypeOf(Duration._type).toEqualTypeOf<Temporal.Duration>();
    });

    it("should construct bidirectional value codecs", () => {
      const StringToDate = JIT.codec(JIT.string().datetime(), JIT.date(), {
        decode: (iso) => new Date(iso),
        encode: (date) => date.toISOString(),
      });

      expect(StringToDate.schema.type).toBe(AST.TypeName.codec);
      expect(StringToDate.schema.def.input.type).toBe(AST.TypeName.string);
      expect(StringToDate.schema.def.output.type).toBe(AST.TypeName.date);
      expectTypeOf<AST.Infer<typeof StringToDate>>().toEqualTypeOf<Date>();
      expectTypeOf(StringToDate.decode("2020-01-01T00:00:00.000Z")).toEqualTypeOf<Date>();
      expectTypeOf(StringToDate.encode(new Date("2020-01-01T00:00:00.000Z"))).toEqualTypeOf<string>();
    });
  });

  describe("object operators", () => {
    it("should partial and require object schemas without mutating input", () => {
      const User = JIT.object({
        id: JIT.number(),
        name: JIT.string(),
      });

      const PartialUser = User.partial();
      const RequiredUser = PartialUser.required();

      expect(User.schema.def.props.id.type).toBe(AST.TypeName.number);
      expect(PartialUser.schema.def.props.id.type).toBe(AST.TypeName.optional);
      expect(RequiredUser.schema.def.props.id.type).toBe(AST.TypeName.number);
      expect(User.schema).not.toBe(PartialUser.schema);
      expect(PartialUser.schema).not.toBe(RequiredUser.schema);

      expectTypeOf<AST.Infer<typeof PartialUser>>().toEqualTypeOf<{
        id: number | undefined;
        name: string | undefined;
      }>();

      expectTypeOf<AST.Infer<typeof RequiredUser>>().toEqualTypeOf<{
        id: number;
        name: string;
      }>();
    });

    it("should pick, omit, extend, and merge object schemas", () => {
      const User = JIT.object({
        id: JIT.number(),
        name: JIT.string(),
      });

      const Picked = User.pick(["id"]);
      const VarargPicked = User.pick("id", "name");
      expect(Object.keys(Picked.schema.def.props)).toEqual(["id"]);
      expect(Object.keys(VarargPicked.schema.def.props)).toEqual(["id", "name"]);
      expectTypeOf<AST.Infer<typeof Picked>>().toEqualTypeOf<{
        id: number;
      }>();
      expectTypeOf<AST.Infer<typeof VarargPicked>>().toEqualTypeOf<{
        id: number;
        name: string;
      }>();

      const Omitted = User.omit(["name"]);
      const VarargOmitted = User.omit("name");
      expect(Object.keys(Omitted.schema.def.props)).toEqual(["id"]);
      expect(Object.keys(VarargOmitted.schema.def.props)).toEqual(["id"]);
      expectTypeOf<AST.Infer<typeof Omitted>>().toEqualTypeOf<{
        id: number;
      }>();

      const Extended = User.extend({
        active: JIT.boolean(),
      });
      expect(Extended.schema.def.props.active.type).toBe(AST.TypeName.boolean);
      expectTypeOf<AST.Infer<typeof Extended>>().toEqualTypeOf<{
        id: number;
        name: string;
        active: boolean;
      }>();

      const Merged = User.merge(
        JIT.object({
          age: JIT.number(),
        })
      );
      expect(Merged.schema.def.props.age.type).toBe(AST.TypeName.number);
      expectTypeOf<AST.Infer<typeof Merged>>().toEqualTypeOf<{
        id: number;
        name: string;
        age: number;
      }>();
    });

    it("should configure object unknown key policies, catchalls, and keyof schemas", () => {
      const User = JIT.object({
        id: JIT.number(),
        name: JIT.string(),
      });
      const Extra = JIT.string();
      const Strict = User.strict();
      const Loose = User.loose();
      const Catchall = User.catchall(Extra);
      const Keys = User.keyof();

      expect(Strict.schema.def.unknownKeys).toBe("strict");
      expect(Strict.schema.def.catchall).toBeUndefined();
      expect(Loose.schema.def.unknownKeys).toBe("passthrough");
      expect(Catchall.schema.def.unknownKeys).toBe("passthrough");
      expect(Catchall.schema.def.catchall).toBe(Extra.schema);
      expect(Keys.schema.type).toBe(AST.TypeName.enum);
      expect(Keys.schema.def.values).toEqual({ id: "id", name: "name" });

      expectTypeOf<AST.Infer<typeof Strict>>().toEqualTypeOf<{
        id: number;
        name: string;
      }>();
      expectTypeOf<AST.Infer<typeof Loose>>().toEqualTypeOf<
        {
          id: number;
          name: string;
        } & Record<string, unknown>
      >();
      expectTypeOf<AST.Infer<typeof Catchall>>().toEqualTypeOf<
        {
          id: number;
          name: string;
        } & Record<string, string | number>
      >();
      expectTypeOf<AST.Infer<typeof Keys>>().toEqualTypeOf<"id" | "name">();
    });

    it("should reject object-only operators on primitive builders", () => {
      const assertInvalidNumberBuilder = (builder: ReturnType<typeof JIT.number>) => {
        // @ts-expect-error number builders do not expose object operators
        builder.pick(["id"]);
      };

      expect(assertInvalidNumberBuilder).toBeTypeOf("function");
    });
  });
});
