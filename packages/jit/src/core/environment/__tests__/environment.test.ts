import { RegistryDuplicateIdError } from "../../../errors/index.js";
import { JIT } from "../../../index.js";

describe("JIT environment isolation", () => {
  it("isolates presentation configuration, registries, and schema ownership", () => {
    const AppJIT = JIT.create({ locale: JIT.locales.ptBR });
    const PublicJIT = JIT.create({ locale: JIT.locales.enUS });
    const AppUser = AppJIT.object({ name: AppJIT.string() }).meta({ id: "AppUser", title: "Usuário" });
    const PublicUser = PublicJIT.object({ name: PublicJIT.string() });

    expect(AppJIT.globalRegistry).not.toBe(PublicJIT.globalRegistry);
    expect(AppJIT.globalRegistry).not.toBe(JIT.globalRegistry);
    expect(AppJIT.globalRegistry.get(AppUser.schema)).toEqual({ id: "AppUser", title: "Usuário" });
    expect(PublicJIT.globalRegistry.get(AppUser.schema)).toBeUndefined();
    expect(AppJIT.validate.is(AppUser)({ name: "Ada" })).toBe(true);
    expect(AppJIT.validate.is(PublicUser)({ name: "Ada" })).toBe(true);
  });

  it("keeps the compiled predicate independent from later locale changes", () => {
    const AppJIT = JIT.create({ locale: JIT.locales.ptBR });
    const User = AppJIT.object({ name: AppJIT.string() });
    const isUser = AppJIT.validate.is(User);
    const error = AppJIT.validate.safeParse(User)({ name: 1 });

    expect(isUser({ name: "Ada" })).toBe(true);
    expect(error.success).toBe(false);
    if (!error.success) expect(AppJIT.error.pretty(error)).toContain("esperado texto");
  });

  it("supports typed metadata registries and rejects duplicate ids", () => {
    const docs = JIT.registry<{ id: string; title: string }>("docs");
    const User = JIT.object({ id: JIT.string() });
    const Other = JIT.object({ id: JIT.string() });

    User.register(docs, { id: "User", title: "User" });
    expect(docs.get(User.schema)).toEqual({ id: "User", title: "User" });
    expect(() => Other.register(docs, { id: "User", title: "Other" })).toThrow(RegistryDuplicateIdError);

    User.register(docs, { id: "User", title: "User v2" });
    expect(docs.getById("User")).toEqual({ id: "User", title: "User v2" });
  });

  it("creates immutable extension environments with stable identities", () => {
    const slug = JIT.plugin.operator({
      id: "@acme/slug",
      version: "1.0.0",
      abi: 1,
      name: "slug",
      target: "string",
      grammar: { requires: ["string"], provides: ["slug"], repeat: "forbid" },
      compose: (schema: unknown) => schema,
    });
    const Extended = JIT.$extends(slug);

    expect(Extended).not.toBe(JIT);
    expect(Extended.string).not.toBe(JIT.string);
    const schema = Extended.string();
    expect(Extended.validate.is(schema)("jit")).toBe(true);
    expect(JIT.validate.is(JIT.string())("jit")).toBe(true);

    const Slug = Extended.string.slug();
    expect(Slug.is("valid-slug")).toBe(true);
  });

  it("shares namespace implementations through facade prototypes", () => {
    const AppJIT = JIT.create();

    expect(Object.getPrototypeOf(AppJIT)).toBe(JIT);
    expect(Object.getPrototypeOf(AppJIT.validate)).toBe(JIT.validate);
    expect(Object.keys(AppJIT)).toContain("string");
    expect(Object.keys(AppJIT.validate)).toContain("is");
  });
});

describe("JIT environment extensions", () => {
  it("rejects composition operators that shadow a built-in member", () => {
    const shadow = JIT.plugin.operator({
      id: "@acme/shadow",
      version: "1.0.0",
      abi: 1,
      name: "min",
      target: "string",
      grammar: { repeat: "forbid" },
      compose: (schema: unknown) => schema,
    });

    expect(() => JIT.$extends(shadow)).toThrow(/cannot shadow/);
  });
});
