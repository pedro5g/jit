import { JIT } from "../../index.js";

describe("JIT DTO aggregates", () => {
  it("should aggregate selected input validation and transport operations", () => {
    const CreateUser = JIT.object({
      name: JIT.string().min(2),
      email: JIT.string().email(),
    }).strict();
    const Input = JIT.dto(CreateUser).get("is", "parse", "safeParse", "fromJSON", "stringify", "codec");
    const value = { name: "Ada", email: "ada@math.org" };

    expect(Input.operations).toEqual(["is", "parse", "safeParse", "fromJSON", "stringify", "codec"]);
    expect(Input.ops).toEqual(["is", "parse", "safeParse", "fromJSON", "stringify", "codec"]);
    expect(Input.extras).toEqual([]);
    expect(Input.is(value)).toBe(true);
    expect(Input.parse(value)).toBe(value);
    expect(Input.safeParse({ ...value, role: "admin" }).success).toBe(false);
    expect(Input.fromJSON(JSON.stringify(value))).toEqual(value);
    expect(Input.stringify(value)).toBe(JSON.stringify(value));
    expect(Input.codec.decode(Input.codec.encode(value))).toEqual(value);
    // @ts-expect-error an input-only DTO has no source mapper
    Input.from;
  });

  it("should map entities through a target-schema whitelist", () => {
    const UserEntity = JIT.object({
      id: JIT.number(),
      fullName: JIT.string(),
      passwordHash: JIT.string(),
      profile: JIT.object({ city: JIT.string(), internalScore: JIT.number() }),
    });
    const PublicUser = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
      city: JIT.string(),
    });
    const Public = JIT.dto(UserEntity, PublicUser, {
      name: { from: "fullName" },
      city: (user) => user.profile.city,
    }).get("from", "many", "stringify");
    const entity = {
      id: 1,
      fullName: "Ada Lovelace",
      passwordHash: "secret",
      profile: { city: "London", internalScore: 99 },
    };

    expect(Public.operations).toEqual(["stringify", "from", "many"]);
    expect(Public.ops).toEqual(["stringify"]);
    expect(Public.extras).toEqual(["from", "many"]);
    expect(Public.from(entity)).toEqual({ id: 1, name: "Ada Lovelace", city: "London" });
    expect(Public.many([entity, { ...entity, id: 2 }])).toEqual([
      { id: 1, name: "Ada Lovelace", city: "London" },
      { id: 2, name: "Ada Lovelace", city: "London" },
    ]);
    expect(Public.stringify(Public.from(entity))).not.toContain("passwordHash");
    expectTypeOf(Public.from).returns.toEqualTypeOf<{ id: number; name: string; city: string }>();
    // @ts-expect-error parse was not selected
    Public.parse;
  });

  it("should derive create and patch DTOs through normal schema transforms", () => {
    const User = JIT.object({
      id: JIT.number(),
      name: JIT.string().min(2),
      email: JIT.string().email(),
      role: JIT.string(),
    });
    const CreateSchema = User.omit("id", "role");
    const PatchSchema = CreateSchema.partial();
    const Create = JIT.dto(CreateSchema).get("parse");
    const Patch = JIT.dto(PatchSchema).get("parse");

    expect(Create.parse({ name: "Ada", email: "ada@math.org" })).toEqual({
      name: "Ada",
      email: "ada@math.org",
    });
    expect(Patch.parse({ name: "Grace" })).toEqual({ name: "Grace", email: undefined });
  });

  it("should cache normalized selections and reject unavailable operations", () => {
    const Schema = JIT.object({ id: JIT.number() });
    const facade = JIT.dto(Schema);

    expect(facade.get("parse", "is")).toBe(facade.get("is", "parse"));
    expect(() => facade.get("from" as never)).toThrow(/requires a source schema/);
    expect(() => facade.get("invalid" as never)).toThrow(/unknown DTO operation/);
  });
});
