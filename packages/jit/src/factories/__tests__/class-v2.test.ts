import { describe, expect, expectTypeOf, it } from "vitest";
import { JIT } from "../../index.js";

describe("Runtime Class DDD V2", () => {
  it("resolves canonical lifecycle fields before materialization", () => {
    const User = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" })
      .extends(JIT.ddd.timestamps(), JIT.ddd.softDelete(), JIT.ddd.versioned());

    expect(Object.keys(User.schema.def.innerType.def.props)).toEqual([
      "id",
      "name",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "version",
    ]);

    const user = User.create({ id: "u_1", name: "Ada" });
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeNull();
    expect(user.deletedAt).toBeNull();
    expect(user.version).toBe(0);
    expectTypeOf(user.createdAt).toEqualTypeOf<Date>();
    expectTypeOf(user.updatedAt).toEqualTypeOf<Date | null>();
    expectTypeOf(user.deletedAt).toEqualTypeOf<Date | null>();
    expectTypeOf(user.version).toEqualTypeOf<number>();

    user.update({ name: "Ada" });
    expect(user.updatedAt).toBeNull();
    user.update({ name: "Grace" });
    expect(user.updatedAt).toBeInstanceOf(Date);
    expect(user.version).toBe(1);
    expect(() => {
      (user as unknown as Record<string, unknown>).version = 99;
    }).toThrow(TypeError);
  });

  it("discovers custom lifecycle names and preserves complete hydrate state", () => {
    const User = JIT.ddd
      .entity(JIT.object({ id: JIT.string() }), { id: "id" })
      .extends(
        JIT.ddd.timestamps({ createdAt: "registeredAt", updatedAt: "changedAt" }),
        JIT.ddd.softDelete({ field: "archivedAt" }),
        JIT.ddd.versioned({ field: "revision" })
      );

    const user = User.create({ id: "u_1" });
    expect(user.registeredAt).toBeInstanceOf(Date);
    expect(user.changedAt).toBeNull();
    expect(user.archivedAt).toBeNull();
    expect(user.revision).toBe(0);
    expectTypeOf(user.registeredAt).toEqualTypeOf<Date>();
    expectTypeOf(user.changedAt).toEqualTypeOf<Date | null>();
    expectTypeOf(user.archivedAt).toEqualTypeOf<Date | null>();
    expectTypeOf(user.revision).toEqualTypeOf<number>();

    expect(() => User.hydrate({ id: "u_1" } as never)).toThrow(/registeredAt/i);
    const hydrated = User.hydrate({
      id: "u_1",
      registeredAt: new Date(0),
      changedAt: null,
      archivedAt: null,
      revision: 3,
    });
    expect(hydrated.registeredAt).toEqual(new Date(0));
    expect(hydrated.revision).toBe(3);
  });

  it("augments semantically compatible declared lifecycle fields", () => {
    const User = JIT.ddd
      .entity(
        JIT.object({
          id: JIT.string(),
          createdAt: JIT.date(),
          updatedAt: JIT.date(),
          deletedAt: JIT.date(),
          version: JIT.int(),
        }),
        { id: "id" }
      )
      .extends(JIT.ddd.timestamps(), JIT.ddd.softDelete(), JIT.ddd.versioned());

    const user = User.create({ id: "u_1" });
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeNull();
    expect(user.deletedAt).toBeNull();
    expect(user.version).toBe(0);
  });

  it("reports structural capability conflicts and revalidates managed field overwrites", () => {
    try {
      JIT.ddd
        .entity(JIT.object({ id: JIT.string(), updatedAt: JIT.string() }), { id: "id" })
        .extends(JIT.ddd.timestamps());
      throw new Error("expected a declaration error");
    } catch (error) {
      expect(error).toMatchObject({ code: "DDD_CAPABILITY_SCHEMA_CONFLICT" });
    }

    const User = JIT.ddd.entity(JIT.object({ id: JIT.string() }), { id: "id" }).extends(JIT.ddd.timestamps());
    try {
      User.extends({
        updatedAt: JIT.overwrite(JIT.string()),
      });
      throw new Error("expected a declaration error");
    } catch (error) {
      expect(error).toMatchObject({ code: "DDD_CAPABILITY_SCHEMA_CONFLICT" });
    }
  });

  it("accumulates extension state and exposes prior members", () => {
    const User = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), firstName: JIT.string(), lastName: JIT.string() }), { id: "id" })
      .extends({
        fullName() {
          return `${this.firstName} ${this.lastName}`;
        },
      })
      .extends({
        label() {
          return `User: ${this.fullName()}`;
        },
      })
      .extends({
        debug() {
          return this.label();
        },
      });

    const user = User.create({ id: "u_1", firstName: "Ada", lastName: "Lovelace" });
    expect(user.debug()).toBe("User: Ada Lovelace");
    expectTypeOf(user.debug()).toEqualTypeOf<string>();
  });

  it("resolves overwrite sequentially for methods and managed fields", () => {
    const Base = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" })
      .extends(JIT.ddd.timestamps())
      .extends({
        displayName() {
          return this.name;
        },
      });
    const User = Base.extends({
      displayName: JIT.overwrite(function displayName(this: { name: string }) {
        return this.name.toUpperCase();
      }),
      updatedAt: JIT.overwrite(JIT.date().nullable().default(null)),
    });

    const user = User.create({ id: "u_1", name: "Ada" });
    expect(user.displayName()).toBe("ADA");
    expect(user.updatedAt).toBeNull();
    expectTypeOf(user.displayName()).toEqualTypeOf<string>();

    expect(() =>
      Base.extends({
        missing: JIT.overwrite(function missing() {
          return 1;
        }),
      } as never)
    ).toThrow(/can only replace an existing member/i);
  });

  it("supports same-call capability then overwrite ordering", () => {
    const User = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" })
      .extends(JIT.ddd.timestamps(), {
        touch: JIT.overwrite(function touch(this: { name: string }) {
          return this.name;
        }),
      });

    expect(User.create({ id: "u_1", name: "Ada" }).touch()).toBe("Ada");
    expect(() =>
      JIT.ddd
        .entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" })
        .extends({ touch: JIT.overwrite(function touch() {}) } as never, JIT.ddd.timestamps())
    ).toThrow(/can only replace an existing member/i);
  });

  it("does not read a lifecycle clock for no-op deletion transitions", () => {
    let reads = 0;
    const User = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" })
      .extends(JIT.ddd.timestamps({ clock: () => new Date(++reads) }), JIT.ddd.softDelete(), JIT.ddd.versioned());
    const user = User.create({ id: "u_1", name: "Ada" });
    const afterCreate = reads;
    user.softDelete();
    const afterDelete = reads;
    user.softDelete();
    expect(reads).toBe(afterDelete);
    user.restore();
    expect(reads).toBe(afterDelete + 1);
    user.restore();
    expect(reads).toBe(afterDelete + 1);
    expect(afterCreate).toBe(1);
  });

  it("keeps nested result policies inside the outer validation boundary", () => {
    let nestedErrorCalls = 0;
    class NestedEmailError extends Error {}
    class OuterUserError extends Error {
      constructor(readonly issues: readonly unknown[]) {
        super("invalid user");
      }
    }

    const Email = JIT.ddd.valueObject(JIT.string().email()).validate({
      result: "tuple",
      error: () => {
        nestedErrorCalls++;
        return new NestedEmailError();
      },
    });
    const User = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), email: Email }), { id: "id" })
      .validate({ result: "result", error: (issues) => new OuterUserError(issues) });
    const NestedOnly = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), email: Email }), { id: "id" })
      .validate({ result: "result" });

    const rejected = User.create({ id: "u_1", email: "invalid" });

    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected a validation rejection");
    expect(rejected.error).toBeInstanceOf(OuterUserError);
    expect((rejected.error as OuterUserError).issues).toMatchObject([{ path: ["email"] }]);
    expect(nestedErrorCalls).toBe(0);

    const nestedRejected = NestedOnly.create({ id: "u_1", email: "invalid" });
    expect(nestedRejected.ok).toBe(false);
    if (nestedRejected.ok) throw new Error("expected a nested validation rejection");
    expect(nestedRejected.error).toBeInstanceOf(NestedEmailError);
    expect(nestedErrorCalls).toBe(1);

    class HigherNestedError extends Error {}
    const HighPriorityEmail = JIT.ddd.valueObject(JIT.string().email()).validate({
      result: "result",
      error: () => new HigherNestedError(),
      priority: 1200,
    });
    const HighPriorityUser = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), email: HighPriorityEmail }), { id: "id" })
      .validate({ result: "result", error: () => new OuterUserError([]) });
    const highPriorityRejected = HighPriorityUser.create({ id: "u_1", email: "invalid" });
    expect(highPriorityRejected.ok).toBe(false);
    if (highPriorityRejected.ok) throw new Error("expected a high-priority nested rejection");
    expect(highPriorityRejected.error).toBeInstanceOf(HigherNestedError);
  });
});
