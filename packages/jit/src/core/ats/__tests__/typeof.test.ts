import { describe, expectTypeOf, it } from "vitest";
import { JIT, Transform } from "../../../../index.js";

type MoneyValue = {
  amount: number;
  currency: string;
};
type MoneyInstance = MoneyValue & {
  readonly value: Readonly<MoneyValue>;
  equals(other: unknown): boolean;
  hashCode(): number;
};

describe("public Typeof resolver", () => {
  it("rebuilds structural collections from schema children", () => {
    const User = JIT.object({
      id: JIT.number(),
      role: JIT.enum(["admin", "member"]),
      tags: JIT.array(JIT.string()),
      profile: JIT.object({ bio: JIT.string().nullable() }).optional(),
    });
    const UserList = JIT.array(User);

    expectTypeOf<JIT.Typeof<typeof User>>().toEqualTypeOf<{
      id: number;
      role: "admin" | "member";
      tags: string[];
      profile: { bio: string | null } | undefined;
    }>();
    expectTypeOf<JIT.Typeof<typeof UserList>>().toEqualTypeOf<
      {
        id: number;
        role: "admin" | "member";
        tags: string[];
        profile: { bio: string | null } | undefined;
      }[]
    >();
  });

  it("preserves tuples, sets, maps, records, unions and nullability", () => {
    const Values = JIT.tuple(JIT.string(), JIT.number(), JIT.boolean());
    const SetOfValues = JIT.set(JIT.string());
    const MapOfValues = JIT.mapSchema(JIT.string(), JIT.number());
    const RecordOfValues = JIT.record(JIT.string(), JIT.boolean());
    const Choice = JIT.union(JIT.literal("ready"), JIT.number());

    expectTypeOf<JIT.Typeof<typeof Values>>().toEqualTypeOf<[string, number, boolean]>();
    expectTypeOf<JIT.Typeof<typeof SetOfValues>>().toEqualTypeOf<Set<string>>();
    expectTypeOf<JIT.Typeof<typeof MapOfValues>>().toEqualTypeOf<Map<string, number>>();
    expectTypeOf<JIT.Typeof<typeof RecordOfValues>>().toEqualTypeOf<Record<string, boolean>>();
    expectTypeOf<JIT.Typeof<typeof Choice>>().toEqualTypeOf<"ready" | number>();
  });

  it("keeps atomic runtime types and special output semantics intact", () => {
    const Money = JIT.ddd.valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() }));
    const Order = JIT.object({ total: Money });
    const ReadonlyUser = JIT.object({ name: JIT.string() }).readonly();
    const Branded = JIT.string().brand("Email");
    const Transformed = Transform.pipe(JIT.string().schema, (value) => value.length);
    expectTypeOf<JIT.Typeof<typeof Order>>().toMatchTypeOf<{
      total: MoneyInstance;
    }>();
    expectTypeOf<JIT.Typeof<typeof ReadonlyUser>>().toEqualTypeOf<{
      readonly name: string;
    }>();
    expectTypeOf<JIT.Typeof<typeof Branded>>().toEqualTypeOf<string & { readonly __brand: "Email" }>();
    expectTypeOf<JIT.Typeof<typeof Transformed>>().toEqualTypeOf<number>();
  });

  it("returns the materialized instance for a Runtime Type itself", () => {
    const Money = JIT.ddd.valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() }));

    expectTypeOf<JIT.Typeof<typeof Money>>().toMatchTypeOf<MoneyInstance>();
  });
});
