import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

const Address = JIT.object({ city: JIT.string(), zip: JIT.string() });
const User = JIT.object({
  id: JIT.number().int(),
  name: JIT.string(),
  address: Address,
  tags: JIT.array(JIT.string()),
});
type User = JIT.Typeof<typeof User>;

const value: User = {
  id: 1,
  name: "Ada",
  address: { city: "London", zip: "E1" },
  tags: ["a", "b"],
};

describe("JIT.state.patch.merge (RFC 7396)", () => {
  const merge = JIT.state.patch.merge(User);

  it("merges an object member instead of replacing it", () => {
    expect(merge(value, { address: { city: "Paris" } })).toEqual({
      ...value,
      address: { city: "Paris", zip: "E1" },
    });
  });

  /** The one place merge patch and a partial assignment disagree. */
  it("removes a member set to null", () => {
    const result = merge(value, { name: null }) as Partial<User>;

    expect("name" in result).toBe(false);
    expect(result.id).toBe(1);
  });

  it("replaces the whole target when the patch is not an object", () => {
    expect(merge(value, null)).toBeNull();
  });

  it("replaces an array wholesale rather than merging it", () => {
    expect(merge(value, { tags: ["z"] }).tags).toEqual(["z"]);
  });

  it("returns the original value when nothing changed", () => {
    expect(merge(value, {})).toBe(value);
    expect(merge(value, { name: "Ada" })).toBe(value);
  });

  it("does not mutate the input", () => {
    merge(value, { address: { city: "Paris" }, name: null });
    expect(value).toEqual({ id: 1, name: "Ada", address: { city: "London", zip: "E1" }, tags: ["a", "b"] });
  });

  it("ignores a member the schema does not declare", () => {
    const result = merge(value, { unknown: "x" } as never) as Record<string, unknown>;

    expect("unknown" in result).toBe(false);
  });

  describe("generated source", () => {
    it("checks known members with static keys instead of walking the patch", () => {
      const source = Compiler.emitMergePatchProgram(User.schema);

      expect(source).toContain('"city" in patch');
      expect(source).not.toContain("Object.keys(patch)");
      expect(source).not.toContain("for (const key in");
    });

    it("recurses into a nested object through a direct call", () => {
      expect(Compiler.emitMergePatchProgram(User.schema)).toContain("mergePatch_address(value.address, patch.address)");
    });
  });
});

describe("JIT.state.patch.json (RFC 6902)", () => {
  const json = JIT.state.patch.json(User);

  it("replaces at a pointer", () => {
    expect(json(value, [{ op: "replace", path: "/name", value: "Grace" }]).name).toBe("Grace");
  });

  it("adds, including at an array's end", () => {
    expect(json(value, [{ op: "add", path: "/tags/-", value: "c" }]).tags).toEqual(["a", "b", "c"]);
    expect(json(value, [{ op: "add", path: "/tags/0", value: "z" }]).tags).toEqual(["z", "a", "b"]);
  });

  it("removes from an object and from an array", () => {
    expect(json(value, [{ op: "remove", path: "/address/zip" }]).address).toEqual({ city: "London" });
    expect(json(value, [{ op: "remove", path: "/tags/0" }]).tags).toEqual(["b"]);
  });

  it("moves and copies", () => {
    expect(json(value, [{ op: "move", from: "/address/city", path: "/name" }])).toEqual({
      ...value,
      name: "London",
      address: { zip: "E1" },
    });
    expect(json(value, [{ op: "copy", from: "/address/city", path: "/name" }]).name).toBe("London");
  });

  it("applies operations in order", () => {
    const result = json(value, [
      { op: "replace", path: "/name", value: "One" },
      { op: "replace", path: "/name", value: "Two" },
    ]);

    expect(result.name).toBe("Two");
  });

  describe("test", () => {
    it("passes and leaves the document untouched", () => {
      expect(json(value, [{ op: "test", path: "/tags", value: ["a", "b"] }])).toBe(value);
    });

    it("throws naming the pointer that failed", () => {
      expect(() => json(value, [{ op: "test", path: "/name", value: "Nope" }])).toThrow(/test failed at \/name/);
    });

    it("compares structurally rather than by reference", () => {
      expect(json(value, [{ op: "test", path: "/address", value: { city: "London", zip: "E1" } }])).toBe(value);
    });
  });

  it("unescapes ~1 and ~0 in a pointer segment", () => {
    const Odd = JIT.object({ "a/b": JIT.string(), "c~d": JIT.string() });
    const patch = JIT.state.patch.json(Odd);
    const odd = { "a/b": "x", "c~d": "y" };

    expect(patch(odd, [{ op: "replace", path: "/a~1b", value: "z" }])["a/b"]).toBe("z");
    expect(patch(odd, [{ op: "replace", path: "/c~0d", value: "z" }])["c~d"]).toBe("z");
  });

  it("rejects a pointer that does not start with a slash", () => {
    expect(() => json(value, [{ op: "replace", path: "name", value: "x" }])).toThrow(/must start with/);
  });

  it("rejects an operation it does not implement", () => {
    expect(() => json(value, [{ op: "invent", path: "/name", value: "x" } as never])).toThrow(/unsupported/);
  });

  it("does not mutate the input", () => {
    json(value, [
      { op: "add", path: "/tags/-", value: "c" },
      { op: "remove", path: "/address/zip" },
    ]);
    expect(value.tags).toEqual(["a", "b"]);
    expect(value.address).toEqual({ city: "London", zip: "E1" });
  });
});

describe("JIT.state.patch.apply", () => {
  it("checks only fields present in an authorized patch before mutation", () => {
    const Actor = JIT.object({ id: JIT.number() });
    const access = JIT.access(User)
      .actor(Actor)
      .can("update", { fields: ["name"] })
      .can("update", {
        fields: ["address"],
        when: (query, actor) => query.eq("id", actor.field("id")),
      });
    const own = JIT.state.patch.apply(User).authorize(access({ id: 1 }), "update");
    const other = JIT.state.patch.apply(User).authorize(access({ id: 2 }), "update");

    expect(other(value, { name: "Grace" }).name).toBe("Grace");
    expect(own(value, { address: { city: "Paris" } }).address.city).toBe("Paris");
    expect(() => other(value, { address: { city: "Paris" } })).toThrowError(
      expect.objectContaining({ code: "ACCESS_DENIED", action: "update", field: "address" })
    );
  });

  it("is the update plan, not a second engine", () => {
    const apply = JIT.state.patch.apply(User);

    expect(apply(value, { name: "Ada L" })).toEqual({ ...value, name: "Ada L" });
    // Same artifact shape as JIT.state.update over the same schema.
    expect(getArtifact(apply)?.kind).toBe(getArtifact(JIT.state.update(User))?.kind);
  });

  /** `undefined` means "leave alone" here, where merge patch would read null as "remove". */
  it("leaves a member alone rather than removing it", () => {
    const result = JIT.state.patch.apply(User)(value, { name: undefined });

    expect(result.name).toBe("Ada");
  });
});

describe("the three contracts are different on purpose", () => {
  it("disagrees about what null means", () => {
    const withNull = { name: null } as never;

    // merge: remove the member
    expect("name" in (JIT.state.patch.merge(User)(value, withNull) as object)).toBe(false);
    // json: an explicit replace with null
    expect(JIT.state.patch.json(User)(value, [{ op: "replace", path: "/name", value: null }]).name).toBeNull();
  });
});
