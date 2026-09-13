import { describe, expect, expectTypeOf, it } from "vitest";
import { JIT } from "../../index.js";

const ChangeNameEvent = JIT.ddd.domainEvent("user.name-changed", {
  version: 1,
  payload: JIT.object({ oldName: JIT.string(), newName: JIT.string() }),
});
const UserId = JIT.ddd.uniqueIdentifier();
const OrderPaidEvent = JIT.ddd.domainEvent("order.paid", {
  version: 1,
  payload: JIT.object({ orderId: JIT.string() }),
});
type ChangeName = JIT.Typeof<typeof ChangeNameEvent>;

describe("DDD domain state", () => {
  it("separates the protected state bag from the public readonly view", () => {
    const UserSchema = JIT.object({
      id: UserId,
      name: JIT.string(),
      slug: JIT.string().readonly(),
      createdAt: JIT.date(),
      updatedAt: JIT.date().nullable(),
      version: JIT.int(),
    });
    const UserBase = JIT.ddd
      .aggregateRoot(UserSchema, { id: "id" })
      .events(ChangeNameEvent)
      .extends(JIT.ddd.timestamps(), JIT.ddd.versioned(), {
        active: JIT.boolean().default(true),
      });

    class User extends UserBase {
      changeName(name: string) {
        if (this._props.name === name) return;
        const event = ChangeNameEvent.create({ oldName: this._props.name, newName: name });
        this._props.name = name;
        this._props.active = true;
        this.touch();
        this.raise(event);
      }

      rejectInvalidMutation() {
        if (Object.is(1, 2)) {
          // @ts-expect-error the domain state reference itself is readonly
          this._props = {};
          // @ts-expect-error identity is immutable inside the domain state
          this._props.id = UserId.create();
          // @ts-expect-error explicit readonly schema fields are immutable inside the domain state
          this._props.slug = "user";
          // @ts-expect-error managed lifecycle fields are capability-owned
          this._props.createdAt = new Date();
          // @ts-expect-error managed lifecycle fields are capability-owned
          this._props.updatedAt = new Date();
          // @ts-expect-error managed lifecycle fields are capability-owned
          this._props.version++;
        }
      }

      assertStateTypes() {
        expectTypeOf(this._props.name).toEqualTypeOf<string>();
        expectTypeOf(this._props.id).toEqualTypeOf<JIT.ScalarValueObject<string>>();
        expectTypeOf(this._props.slug).toEqualTypeOf<string>();
        expectTypeOf(this._props.createdAt).toEqualTypeOf<Date>();
        expectTypeOf(this._props.updatedAt).toEqualTypeOf<Date | null>();
        expectTypeOf(this._props.version).toEqualTypeOf<number>();
        expectTypeOf(this._props.active).toEqualTypeOf<boolean>();
      }
    }

    const user = User.create({ id: "u_1", name: "Ada", slug: "ada" });
    user.changeName("Grace");
    user.assertStateTypes();

    expect(user.name).toBe("Grace");
    expect(user.id).toBeInstanceOf(UserId);
    expect(user.active).toBe(true);
    expect(user.peekEvents()).toHaveLength(1);
    expect(user.peekEvents()[0]?.type).toBe("user.name-changed");
    expect(Object.keys(user)).toEqual([]);
    expect(Object.getOwnPropertyNames(user)).toEqual([]);
    expect(Object.getOwnPropertySymbols(user)).toHaveLength(2);
    expectTypeOf(user.peekEvents()).toEqualTypeOf<readonly ChangeName[]>();

    if (Object.is(1, 2)) {
      // @ts-expect-error public fields remain readonly
      user.name = "Pedro";
      // @ts-expect-error protected domain state is only available to subclasses
      user._props;
      // @ts-expect-error event emission is protected
      user.raise(ChangeNameEvent.create({ oldName: "Grace", newName: "Pedro" }));
      // @ts-expect-error aggregate update() was removed; domain code mutates _props directly
      user.update({ name: "Pedro" });
    }
  });

  it("keeps event unions through subclasses and does not validate raise at runtime", () => {
    const Base = JIT.ddd
      .aggregateRoot(JIT.object({ id: JIT.string() }), { id: "id" })
      .events(ChangeNameEvent, OrderPaidEvent);

    class User extends Base {
      record(event: ChangeName | JIT.Typeof<typeof OrderPaidEvent>) {
        this.raise(event);
      }
    }

    const user = User.create({ id: "u_1" });
    user.record(ChangeNameEvent.create({ oldName: "Ada", newName: "Grace" }));
    user.record(OrderPaidEvent.create({ orderId: "o_1" }));

    expect(user.peekEvents().map((event) => event.type)).toEqual(["user.name-changed", "order.paid"]);
    expectTypeOf(user.peekEvents()).toEqualTypeOf<readonly (ChangeName | JIT.Typeof<typeof OrderPaidEvent>)[]>();
    expectTypeOf(user.pullEvents()).toEqualTypeOf<(ChangeName | JIT.Typeof<typeof OrderPaidEvent>)[]>();
  });

  it("supports a type-only event union and rejects foreign events at compile time", () => {
    type UserEvent = ChangeName | JIT.Typeof<typeof OrderPaidEvent>;
    const Base = JIT.ddd.aggregateRoot(JIT.object({ id: JIT.string() }), { id: "id" }).events<UserEvent>();

    class User extends Base {
      record(event: UserEvent) {
        this.raise(event);
      }

      rejectForeign() {
        const ForeignEvent = JIT.ddd.domainEvent("invoice.paid", {
          version: 1,
          payload: JIT.object({ invoiceId: JIT.string() }),
        });
        if (Object.is(1, 2)) {
          // @ts-expect-error an aggregate only accepts its declared event union
          this.raise(ForeignEvent.create({ invoiceId: "i_1" }));
        }
      }
    }

    const user = User.create({ id: "u_1" });
    user.record(ChangeNameEvent.create({ oldName: "Ada", newName: "Grace" }));
    expectTypeOf(user.peekEvents()).toEqualTypeOf<readonly UserEvent[]>();

    const Propagated = Base.validate()
      .assert((query) => query.eq("id", "u_1"))
      .factories({ create: "make", hydrate: "restore" });
    class PropagatedUser extends Propagated {
      record(event: UserEvent) {
        this.raise(event);
      }
    }
    expectTypeOf<ReturnType<PropagatedUser["peekEvents"]>>().toEqualTypeOf<readonly UserEvent[]>();
  });

  it("provides a typesafe contextual DSL when nested descriptor inference needs help", () => {
    const Base = JIT.ddd
      .aggregateRoot(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" })
      .extends(JIT.ddd.timestamps(), ($) => ({
        isValid: $.field(JIT.boolean().default(true))
          .public()
          .setter(function (valid) {
            expectTypeOf(valid).toEqualTypeOf<boolean>();
            expectTypeOf(this._props.isValid).toEqualTypeOf<boolean>();
            expectTypeOf(this.touch).toEqualTypeOf<() => void>();
            if (Object.is(1, 2)) {
              // @ts-expect-error public access remains readonly inside a custom setter
              this.isValid = valid;
            }
            this._props.isValid = valid;
            this.touch();
          }),
        displayName: $.field("displayName", JIT.string().default(""))
          .public()
          .getter(function () {
            expectTypeOf(this._props.name).toEqualTypeOf<string>();
            return this._props.name;
          }),
      }));
    class User extends Base {}
    const user = User.create({ id: "u_1", name: "Ada" });

    user.isValid = false;
    expect(user.isValid).toBe(false);
    expect(user.displayName).toBe("Ada");
    expectTypeOf(user.displayName).toEqualTypeOf<string>();
  });

  it("types plain extension methods against the internal domain surface", () => {
    const Base = JIT.ddd
      .aggregateRoot(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" })
      .extends(JIT.ddd.timestamps(), {
        normalize() {
          this._props.name = this.name.trim();
          this.touch();
        },
      });
    class User extends Base {}
    const user = User.create({ id: "u_1", name: " Ada " });
    user.normalize();
    expect(user.name).toBe("Ada");
  });

  it("uses one hidden state bag for cloning and semantic operations", () => {
    const UserBase = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" })
      .extends(JIT.class.clone(), JIT.class.diff(), JIT.class.json());
    class User extends UserBase {
      rename(name: string) {
        this._props.name = name;
      }
    }
    const original = User.create({ id: "u_1", name: "Ada" });
    const copy = original.clone() as User;

    expect(copy).not.toBe(original);
    expect(copy.name).toBe("Ada");
    expect(copy.diff(original)).toEqual([]);
    expect(copy.toJson()).toBe('{"id":"u_1","name":"Ada"}');
    copy.rename("Grace");
    expect(original.name).toBe("Ada");
    expect(original.diff(copy)).toEqual([{ type: "update", path: ["name"], value: "Grace" }]);
    expect(copy.toJson()).toBe('{"id":"u_1","name":"Grace"}');
    expect(Object.getOwnPropertySymbols(copy)).toHaveLength(1);
  });

  it("keeps previous extensions in later contextual field callbacks", () => {
    const Base = JIT.ddd
      .aggregateRoot(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" })
      .extends({
        displayName() {
          return this.name;
        },
      })
      .extends(JIT.ddd.timestamps(), ($) => ({
        isValid: $.field(JIT.boolean().default(true))
          .public()
          .setter(function (value) {
            expectTypeOf(this.displayName()).toEqualTypeOf<string>();
            this._props.isValid = value;
            this.touch();
          }),
      }));
    class User extends Base {}
    const user = User.create({ id: "u_1", name: "Ada" });
    user.isValid = false;
    expect(user.isValid).toBe(false);
  });
});
