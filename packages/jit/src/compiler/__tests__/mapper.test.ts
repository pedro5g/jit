import { Compiler, Errors, JIT } from "../../index.js";

describe("JIT compiler mapper", () => {
  const User = JIT.object({
    id: JIT.number(),
    first: JIT.string(),
    last: JIT.string(),
    emailAddress: JIT.string(),
    passwordHash: JIT.string(),
    age: JIT.number(),
  });

  const UserDTO = JIT.object({
    id: JIT.number(),
    fullName: JIT.string(),
    email: JIT.string(),
  });

  const ada = {
    id: 1,
    first: "Ada",
    last: "Lovelace",
    emailAddress: "ada@math.org",
    passwordHash: "s3cr3t",
    age: 37,
  };

  it("should auto-match by name and apply computed and rename overrides", () => {
    const toDTO = JIT.mapper(User, UserDTO, {
      fullName: (user) => `${user.first} ${user.last}`,
      email: { from: "emailAddress" },
    });

    const dto = toDTO.map(ada);

    expect(dto).toEqual({ id: 1, fullName: "Ada Lovelace", email: "ada@math.org" });
    expectTypeOf(dto).toEqualTypeOf<{
      id: number;
      fullName: string;
      email: string;
    }>();
  });

  it("should never leak source fields absent from the target schema", () => {
    const toDTO = JIT.mapper(User, UserDTO, {
      fullName: (user) => `${user.first} ${user.last}`,
      email: { from: "emailAddress" },
    });

    const dto = toDTO.map(ada) as Record<string, unknown>;

    expect(dto.passwordHash).toBeUndefined();
    expect(Object.keys(dto)).toEqual(["id", "fullName", "email"]);
  });

  it("should map lists in one fused loop without per-item calls", () => {
    const toDTO = JIT.mapper(User, UserDTO, {
      fullName: (user) => `${user.first} ${user.last}`,
      email: { from: "emailAddress" },
    });
    const source = Compiler.emitMapperSource(User.schema, UserDTO.schema, {
      fullName: () => "",
      email: { from: "emailAddress" },
    });
    const grace = { ...ada, id: 2, first: "Grace", last: "Hopper" };

    expect(toDTO.many([ada, grace]).map((dto) => dto.fullName)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(source).toContain("const len = list.length;");
    expect(source).toContain("const out = new Array(len);");
    expect(source).toContain("for (let i = 0; i < len; i++)");
    expect(source).not.toContain(".map(");
    expect(source).not.toContain(".push(");
    expect(source).not.toContain("map(list[i])");
  });

  it("should convert values with via and fill defaults", () => {
    const Event = JIT.object({
      id: JIT.number(),
      created_at: JIT.date(),
      channel: JIT.optional(JIT.string()),
    });
    const EventDTO = JIT.object({
      id: JIT.number(),
      createdAt: JIT.string(),
      channel: JIT.string(),
    });
    const toDTO = JIT.mapper(Event, EventDTO, {
      createdAt: { from: "created_at", via: (date) => date.toISOString() },
      channel: { default: "web" },
    });
    const timestamp = new Date("2026-07-04T12:00:00.000Z");

    expect(toDTO.map({ id: 1, created_at: timestamp, channel: "mobile" })).toEqual({
      id: 1,
      createdAt: "2026-07-04T12:00:00.000Z",
      channel: "mobile",
    });
    expect(toDTO.map({ id: 2, created_at: timestamp, channel: undefined })).toEqual({
      id: 2,
      createdAt: "2026-07-04T12:00:00.000Z",
      channel: "web",
    });
  });

  it("should recurse into nested objects and arrays of objects", () => {
    const Order = JIT.object({
      id: JIT.number(),
      customer: JIT.object({ id: JIT.number(), name: JIT.string(), document: JIT.string() }),
      items: JIT.array(JIT.object({ sku: JIT.string(), price: JIT.number(), internalCost: JIT.number() })),
      tags: JIT.array(JIT.string()),
    });
    const OrderDTO = JIT.object({
      id: JIT.number(),
      customer: JIT.object({ id: JIT.number(), name: JIT.string() }),
      items: JIT.array(JIT.object({ sku: JIT.string(), price: JIT.number() })),
      tags: JIT.array(JIT.string()),
    });
    const toDTO = JIT.mapper(Order, OrderDTO);
    const source = Compiler.emitMapperSource(Order.schema, OrderDTO.schema);

    const order = {
      id: 7,
      customer: { id: 1, name: "Ada", document: "123" },
      items: [
        { sku: "a", price: 10, internalCost: 4 },
        { sku: "b", price: 20, internalCost: 9 },
      ],
      tags: ["priority"],
    };
    const dto = toDTO.map(order);

    expect(dto).toEqual({
      id: 7,
      customer: { id: 1, name: "Ada" },
      items: [
        { sku: "a", price: 10 },
        { sku: "b", price: 20 },
      ],
      tags: ["priority"],
    });
    expect((dto.customer as Record<string, unknown>).document).toBeUndefined();
    expect((dto.items[0] as Record<string, unknown>).internalCost).toBeUndefined();
    expect(dto.tags).not.toBe(order.tags);
    expect(source).toContain('"customer": { "id": source.customer.id, "name": source.customer.name }');
    expect(source).not.toContain("Object.keys");
    expect(source).not.toContain("...");
  });

  it("should omit optional unmatched fields and reject required ones", () => {
    const Source = JIT.object({ id: JIT.number() });
    const WithOptional = JIT.object({ id: JIT.number(), note: JIT.optional(JIT.string()) });
    const WithRequired = JIT.object({ id: JIT.number(), note: JIT.string() });

    const toOptional = JIT.mapper(Source, WithOptional);

    expect(toOptional.map({ id: 1 })).toEqual({ id: 1 });
    expect(Object.keys(toOptional.map({ id: 1 }))).toEqual(["id"]);
    expect(() => Compiler.compileMapper(Source.schema, WithRequired.schema)).toThrow(Errors.JITError);
    expect(() => Compiler.compileMapper(Source.schema, WithRequired.schema)).toThrow(/no source match and no override/);

    const missingOverrides = () => {
      // @ts-expect-error required unmatched target fields demand an overrides argument.
      return JIT.mapper(Source, WithRequired);
    };

    expect(missingOverrides).toThrow(Errors.JITError);
  });

  it("should validate override shapes and unknown fields at plan time", () => {
    expect(() =>
      Compiler.compileMapper(User.schema, UserDTO.schema, {
        fullName: () => "",
        email: { from: "emailAddress" },
        ghost: { from: "first" },
      })
    ).toThrow(/unknown target field/);
    expect(() =>
      Compiler.compileMapper(User.schema, UserDTO.schema, {
        fullName: () => "",
        email: { from: "missing" },
      })
    ).toThrow(/unknown source field/);
    expect(() => Compiler.compileMapper(JIT.array(User).schema, UserDTO.schema)).toThrow(/object schema/);

    try {
      Compiler.compileMapper(User.schema, UserDTO.schema, { email: { from: "missing" }, fullName: () => "" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(Errors.JITError);
      expect((error as Errors.JITError).code).toBe("INVALID_MAPPER");
      expect((error as Errors.JITError).path).toEqual(["email"]);
    }
  });

  it("should reject optional source into required target without default or via", () => {
    const Source = JIT.object({ id: JIT.number(), name: JIT.optional(JIT.string()) });
    const Target = JIT.object({ id: JIT.number(), name: JIT.string() });

    expect(() => Compiler.compileMapper(Source.schema, Target.schema)).toThrow(/optional/);
  });

  it("should keep override values as external bindings, never interpolated", () => {
    const source = Compiler.emitMapperSource(User.schema, UserDTO.schema, {
      fullName: () => "constant",
      email: { from: "emailAddress" },
    });

    expect(source).toContain("__m0(source)");
    expect(source).not.toContain("constant");
  });

  it("should share the compiled template across equivalent mappers but rebind callbacks", () => {
    const first = JIT.mapper(User, UserDTO, {
      fullName: (user) => `${user.first} ${user.last}`,
      email: { from: "emailAddress" },
    });
    const second = JIT.mapper(User, UserDTO, {
      fullName: (user) => `${user.last}, ${user.first}`,
      email: { from: "emailAddress" },
    });

    expect(first.map(ada).fullName).toBe("Ada Lovelace");
    expect(second.map(ada).fullName).toBe("Lovelace, Ada");
    expect(first.map).not.toBe(second.map);
  });
});
