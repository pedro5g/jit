import { describe, expect, expectTypeOf, it } from "vitest";
import { JITValidationError } from "../../errors/index.js";
import { JIT } from "../../index.js";

describe("Runtime Type class capabilities", () => {
  function definitions() {
    const EntityId = JIT.ddd.uniqueIdentifier(
      JIT.string()
        .uuid()
        .default(() => crypto.randomUUID())
    );
    const Email = JIT.ddd.valueObject(JIT.string().email());
    const schema = JIT.object({
      id: EntityId,
      name: JIT.string().min(3).max(100),
      email: Email,
    });
    return { EntityId, Email, schema };
  }

  it("restores entity equality, hashing and identity as preset members", () => {
    const { schema } = definitions();
    const User = JIT.ddd.entity(schema);
    const user = User.create({ name: "Pedro", email: "pedro@example.com" });

    expect(user.equals(user)).toBe(true);
    expect(typeof user.equals).toBe("function");
    expect(typeof user.hashCode).toBe("function");
    expect(user.hashCode()).toBe(user.hashCode());
    expect(user.identity()).toBe(user.id);
    expect(user.sameIdentity(user)).toBe(true);
    expectTypeOf(user.equals).toBeFunction();
    expectTypeOf(user.hashCode).toBeFunction();
    expectTypeOf(user.identity).toBeFunction();
    expectTypeOf(user.sameIdentity).toBeFunction();
  });

  it("restores the aggregate preset equality, hashing and event surface", async () => {
    const { schema } = definitions();
    const User = JIT.ddd.aggregateRoot(schema);
    const user = User.create({ name: "Pedro", email: "pedro@example.com" });

    expect(user.equals(user)).toBe(true);
    expect(user.hashCode()).toBe(user.hashCode());
    expect(user.identity()).toBe(user.id);
    expect(user.sameIdentity(user)).toBe(true);
    expect(user.peekEvents()).toEqual([]);
    expect(user.pullEvents()).toEqual([]);
    await user.commit({ publish() {} });
  });

  it("keeps preset methods available through subclasses", () => {
    const { schema } = definitions();
    const UserBase = JIT.ddd.entity(schema);
    class User extends UserBase {}
    const user = User.create({ name: "Pedro", email: "pedro@example.com" });

    expect(user).toBeInstanceOf(User);
    expect(user.equals(user)).toBe(true);
    expect(user.hashCode()).toBe(user.hashCode());
  });

  it("supports Runtime Type fields in clone and diff capabilities", () => {
    const { schema } = definitions();
    const CloneUser = JIT.ddd.entity(schema).extends(JIT.class.clone());
    const DiffUser = JIT.ddd.entity(schema).extends(JIT.class.diff());
    const cloneSource = CloneUser.create({ name: "Pedro", email: "pedro@example.com" });
    const diffSource = DiffUser.create({ name: "Pedro", email: "pedro@example.com" });

    const clone = cloneSource.clone();
    expect(clone).toBeInstanceOf(CloneUser);
    expect(clone.email).toBe(cloneSource.email);
    expect(diffSource.diff(diffSource)).toEqual([]);
    const changed = DiffUser.create({ id: diffSource.id.value, name: "Grace", email: "pedro@example.com" });
    expect(diffSource.diff(changed)).toEqual([{ type: "update", path: ["name"], value: "Grace" }]);
  });

  it("does not cache mutable Entity hash codes", () => {
    const User = JIT.class(JIT.object({ id: JIT.string(), name: JIT.string() })).extends(JIT.class.hashCode());
    const user = new User({ id: "u_1", name: "Pedro" });
    const before = user.hashCode();

    (user as { name: string }).name = "Grace";

    expect(user.hashCode()).not.toBe(before);
  });

  it("accepts callable capability descriptors in every valid order", () => {
    const { schema } = definitions();
    const base = JIT.class(schema).construction("factory");
    const variants = [
      base.extends(JIT.class.equals(), JIT.class.clone()),
      base.extends(JIT.class.clone(), JIT.class.equals()),
      base.extends(JIT.class.clone(), JIT.class.diff()),
      base.extends(JIT.class.clone(), JIT.class.diff(), JIT.class.json()),
      base.extends(JIT.class.equals(), JIT.class.hashCode(), JIT.class.clone(), JIT.class.diff(), JIT.class.json()),
    ];

    for (const User of variants) {
      const user = (
        User as unknown as { create(input: unknown): { equals(other: unknown): boolean; hashCode(): number } }
      ).create({
        name: "Pedro",
        email: "pedro@example.com",
      });
      if (typeof user.equals === "function") expect(user.equals(user)).toBe(true);
      if (typeof user.hashCode === "function") expect(user.hashCode()).toBe(user.hashCode());
    }
  });

  it("does not validate an unconfigured entity factory", () => {
    const { schema } = definitions();
    const User = JIT.ddd.entity(schema);

    expect(() => User.create({ name: "pe", email: "" })).not.toThrow();
  });

  it("validates only after the root factory policy is explicitly enabled", () => {
    const { schema } = definitions();
    const User = JIT.ddd.entity(schema).validate();

    expect(() => User.create({ name: "pe", email: "" })).toThrow(JITValidationError);
  });

  it("keeps fluent validation immutable", () => {
    const { schema } = definitions();
    const User = JIT.ddd.entity(schema);
    const ValidatedUser = User.validate();

    expect(User).not.toBe(ValidatedUser);
    expect(() => User.create({ name: "pe", email: "" })).not.toThrow();
    expect(() => ValidatedUser.create({ name: "pe", email: "" })).toThrow();
  });

  it("keeps nested validation scoped to the explicitly validated Runtime Type", () => {
    const Email = JIT.ddd.valueObject(JIT.string().email()).validate();
    const User = JIT.ddd.entity(
      JIT.object({
        id: JIT.string(),
        name: JIT.string().min(3),
        email: Email,
      }),
      { id: "id" }
    );

    expect(() => User.create({ id: "u_1", name: "pe", email: "" })).toThrow(JITValidationError);
    expect(() => User.create({ id: "u_1", name: "pedro", email: "pedro@example.com" })).not.toThrow();
  });

  it("keeps scalar Value Object validation explicit", () => {
    const Email = JIT.ddd.valueObject(JIT.string().email());
    const ValidatedEmail = Email.validate();

    expect(() => Email.create("")).not.toThrow();
    expect(() => ValidatedEmail.create("")).toThrow(JITValidationError);

    const a = Email.create("a@example.com");
    const b = Email.create("a@example.com");
    expect(a.equals(b)).toBe(true);
    expect(a.hashCode()).toBe(b.hashCode());
  });
});
