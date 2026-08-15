import { JIT } from "../../index.js";

describe("JIT.dto schema annotation", () => {
  it("returns an ordinary schema builder with boundary metadata", () => {
    const CreateUser = JIT.object({
      name: JIT.string().min(2),
      email: JIT.string().email(),
    }).strict();
    const Input = JIT.dto(CreateUser);
    const value = { name: "Ada", email: "ada@math.org" };

    expect(CreateUser.schema).not.toBe(Input.schema);
    expect(Input.schema.annotations?.metadata?.custom?.dto).toBe(true);
    expect(JIT.validate.parse(Input)(value)).toBe(value);
    expect(JIT.json.parse(Input).validate()(JSON.stringify(value))).toEqual(value);
    expect(JIT.binary.decode(Input)(JIT.binary.encode(Input)(value))).toEqual(value);
  });

  it("composes an outbound boundary through map and JSON without a DTO facade", () => {
    const User = JIT.object({ id: JIT.number(), fullName: JIT.string(), passwordHash: JIT.string() });
    const PublicUser = JIT.dto(JIT.object({ id: JIT.number(), name: JIT.string() }));
    const encodePublic = JIT.from(User)
      .map(PublicUser, { name: { from: "fullName" } })
      .to.json();

    expect(encodePublic({ id: 1, fullName: "Ada Lovelace", passwordHash: "secret" })).toBe(
      JSON.stringify({ id: 1, name: "Ada Lovelace" })
    );
    expect(encodePublic.plan.stages.map((stage) => stage.kind)).toEqual(["value", "map", "json.encode"]);
  });

  it("keeps schema transforms as the DTO derivation mechanism", () => {
    const User = JIT.object({
      id: JIT.number(),
      name: JIT.string().min(2),
      email: JIT.string().email(),
      role: JIT.string(),
    });
    const Create = JIT.dto(User.omit("id", "role"));
    const Patch = JIT.dto(Create.partial());

    expect(JIT.validate.parse(Create)({ name: "Ada", email: "ada@math.org" })).toEqual({
      name: "Ada",
      email: "ada@math.org",
    });
    expect(JIT.validate.parse(Patch)({ name: "Grace" })).toEqual({ name: "Grace", email: undefined });
  });
});
