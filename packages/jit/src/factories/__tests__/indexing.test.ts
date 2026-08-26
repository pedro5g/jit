import { emitIndexSource } from "../../compiler/indexing.js";
import { JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

describe("JIT.index", () => {
  const User = JIT.object({
    id: JIT.number(),
    tenantId: JIT.string(),
    email: JIT.string(),
    at: JIT.date(),
    nickname: JIT.string().optional(),
  });
  type User = JIT.Typeof<typeof User>;
  const Users = JIT.array(User).keyed("id");

  const rows: User[] = [
    { id: 1, tenantId: "t1", email: "ada@x.com", at: new Date(1_000), nickname: "ada" },
    { id: 2, tenantId: "t1", email: "grace@x.com", at: new Date(2_000), nickname: undefined },
    { id: 3, tenantId: "t2", email: "edsger@x.com", at: new Date(3_000), nickname: "edsger" },
  ];

  it("infers the key a collection already declares and registers the descriptor", () => {
    const byId = JIT.index(Users);

    expect(byId(rows).get(1)?.email).toBe("ada@x.com");
    expect(byId(rows).size).toBe(3);

    const artifact = getArtifact(byId);

    expect(artifact?.kind).toBe("index-plan");
    expect(artifact?.kind === "index-plan" ? artifact.descriptor : undefined).toEqual({
      keys: [{ key: "id", valueKind: "direct", nullish: false }],
      shape: "unique",
      uniqueByFact: true,
    });
    expectTypeOf(byId(rows)).toEqualTypeOf<Map<unknown, User>>();
  });

  it("types the index precisely when the keys are named", () => {
    const byEmail = JIT.index(Users).by("email");
    const byTenantEmail = JIT.index(Users).by("tenantId", "email");

    expect(byEmail(rows).get("edsger@x.com")?.id).toBe(3);
    expect(byTenantEmail(rows).get("t1")?.get("grace@x.com")?.id).toBe(2);
    expect(byTenantEmail(rows).get("t2")?.size).toBe(1);
    expectTypeOf(byEmail(rows)).toEqualTypeOf<Map<string, User>>();
    expectTypeOf(byTenantEmail(rows)).toEqualTypeOf<Map<string, Map<string, User>>>();
  });

  it("indexes a Date key by its timestamp, since Map keys match by identity", () => {
    const byAt = JIT.index(Users).by("at");

    expect(byAt(rows).get(2_000)?.id).toBe(2);
    expect(byAt(rows).get(new Date(2_000) as never)).toBeUndefined();
    expect(emitIndexSource(indexDescriptorOf(byAt))).toContain("row.at.getTime()");
    expectTypeOf(byAt(rows)).toEqualTypeOf<Map<number, User>>();
  });

  it("collects every row per key when grouped, and keeps the last one otherwise", () => {
    const byTenant = JIT.index(Users).by("tenantId");
    const grouped = JIT.index(Users).by("tenantId").grouped();

    // A unique index over a non-unique key keeps the last row for that key.
    expect(byTenant(rows).get("t1")?.id).toBe(2);
    expect(
      grouped(rows)
        .get("t1")
        ?.map((row) => row.id)
    ).toEqual([1, 2]);
    expect(
      grouped(rows)
        .get("t2")
        ?.map((row) => row.id)
    ).toEqual([3]);
    expectTypeOf(grouped(rows)).toEqualTypeOf<Map<string, User[]>>();
  });

  it("builds fresh by default and reuses per array only through cached", () => {
    const byId = JIT.index(Users);
    const byEmail = JIT.index(Users).by("email");

    expect(byId(rows)).not.toBe(byId(rows));
    expect(byId.cached(rows)).toBe(byId.cached(rows));
    // Two plans over the same array keep their own entries.
    expect(byEmail.cached(rows)).not.toBe(byId.cached(rows));
    expect(byEmail.cached(rows).get("ada@x.com")?.id).toBe(1);
    expect(byId.cached(rows).get(1)?.email).toBe("ada@x.com");
    expect(byId.cached([...rows])).not.toBe(byId.cached(rows));
  });

  it("requires a key, and rejects unknown, repeated or structural keys", () => {
    const Unkeyed = JIT.array(User);

    expect(() => JIT.index(Unkeyed)(rows)).toThrow(/index requires a key/i);
    expect(() => JIT.index(Unkeyed).cached(rows)).toThrow(/index requires a key/i);
    // A collection with no fact of its own is still indexable by an explicit key.
    expect(JIT.index(Unkeyed).by("email")(rows).get("ada@x.com")?.id).toBe(1);

    expect(() => JIT.index(Users).by("missing" as never)).toThrow(/unknown key/i);
    expect(() => JIT.index(Users).by("id", "id")).toThrow(/repeats key/i);

    const Nested = JIT.array(JIT.object({ value: JIT.object({ id: JIT.number() }) }));
    expect(() => JIT.index(Nested).by("value")).toThrow(/statically comparable scalar/i);

    const invalidKey = () => {
      // @ts-expect-error index keys are checked from the schema output.
      return JIT.index(Users).by("missing");
    };
    expectTypeOf(invalidKey).toBeFunction();
  });

  it("reads an optional key without inventing a value for it", () => {
    const byNickname = JIT.index(Users).by("nickname");
    const index = byNickname(rows);

    expect(index.get("ada")?.id).toBe(1);
    expect(index.get(undefined)?.id).toBe(2);
    expectTypeOf(index).toEqualTypeOf<Map<string | undefined, User>>();
  });
});

function indexDescriptorOf(plan: object) {
  const artifact = getArtifact(plan);

  if (artifact?.kind !== "index-plan") throw new Error("index plan artifact not registered");
  return artifact.descriptor;
}
