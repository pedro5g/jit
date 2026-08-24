import { JIT } from "../../../index.js";
import type { Input, Update } from "../index.js";

describe("Input and Update schema types", () => {
  it("makes defaulted, optional, and nullish object fields optional only at the input boundary", () => {
    const User = JIT.object({
      id: JIT.string().default("generated"),
      name: JIT.string(),
      nickname: JIT.string().optional(),
      note: JIT.string().nullish(),
      profile: JIT.object({
        createdAt: JIT.date().default(() => new Date()),
        label: JIT.string(),
      }),
    });

    expectTypeOf<Input<typeof User>>().toMatchTypeOf<{
      id?: string | undefined;
      name: string;
      nickname?: string | undefined;
      note?: string | null | undefined;
      profile: { createdAt?: Date | undefined; label: string };
    }>();
    expectTypeOf<{
      id?: string | undefined;
      name: string;
      nickname?: string | undefined;
      note?: string | null | undefined;
      profile: { createdAt?: Date | undefined; label: string };
    }>().toMatchTypeOf<Input<typeof User>>();
    expectTypeOf<JIT.Typeof<typeof User>>().toEqualTypeOf<{
      id: string;
      name: string;
      nickname: string | undefined;
      note: string | null | undefined;
      profile: { createdAt: Date; label: string };
    }>();
  });

  it("removes readonly fields from update patches recursively", () => {
    const User = JIT.object({
      id: JIT.string().readonly(),
      name: JIT.string(),
      profile: JIT.object({
        createdAt: JIT.date().readonly(),
        label: JIT.string(),
      }),
    });

    expectTypeOf<Update<typeof User>>().toEqualTypeOf<{
      name?: string;
      profile?: { label?: string };
    }>();

    const valid: JIT.Update<typeof User> = {
      name: "Grace",
      profile: { label: "compiler" },
    };
    expect(valid.name).toBe("Grace");
    // @ts-expect-error readonly fields are not patchable
    const invalid: JIT.Update<typeof User> = { id: "u_1" };
    expect(invalid).toBeDefined();
  });
});
