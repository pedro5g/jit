import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

const Profile = JIT.object({ name: JIT.string(), bio: JIT.string() });
const User = JIT.object({
  id: JIT.number().int(),
  email: JIT.string(),
  status: JIT.string(),
  tags: JIT.array(JIT.string()),
  profile: JIT.nullable(Profile),
});
type User = JIT.Typeof<typeof User>;

const value: User = {
  id: 1,
  email: "ada@x.com",
  status: "active",
  tags: ["a"],
  profile: { name: "Ada", bio: "b" },
};

function sourceOf(plan: object): string {
  const artifact = getArtifact(plan);

  if (artifact?.kind !== "changed-plan") throw new Error("changed plan not registered");
  return Compiler.emitChangedSource(artifact.descriptor);
}

describe("JIT.compare.changed", () => {
  it("reports which fields moved as a bitmask", () => {
    const changed = JIT.compare.changed(User);
    const mask = changed(value, { ...value, email: "grace@x.com" });

    expect(changed.has(mask, "email")).toBe(true);
    expect(changed.has(mask, "status")).toBe(false);
    expect(changed.has(mask, "id")).toBe(false);
  });

  it("reports nothing for the same reference", () => {
    const changed = JIT.compare.changed(User);

    expect(changed(value, value)).toBe(0);
  });

  it("reports every field that moved at once", () => {
    const changed = JIT.compare.changed(User);
    const mask = changed(value, { ...value, email: "other", status: "blocked" });

    expect(changed.has(mask, "email")).toBe(true);
    expect(changed.has(mask, "status")).toBe(true);
    expect(changed.has(mask, "id")).toBe(false);
  });

  it("names the watched fields in bit order", () => {
    expect(JIT.compare.changed(User).fields).toEqual(["id", "email", "status", "tags", "profile"]);
  });

  /**
   * A rebuilt array or object holds new references. Reporting it as a change
   * would make the mask useless for anything that arrived over the wire.
   */
  it("decides a structural field by value, not by reference", () => {
    const changed = JIT.compare.changed(User);

    expect(changed(value, { ...value, tags: ["a"] })).toBe(0);
    expect(changed(value, { ...value, profile: { name: "Ada", bio: "b" } })).toBe(0);
    expect(changed.has(changed(value, { ...value, tags: ["b"] }), "tags")).toBe(true);
  });

  describe("select", () => {
    it("watches only the named fields", () => {
      const changed = JIT.compare.changed(User).select("status");

      expect(changed.fields).toEqual(["status"]);
      expect(changed(value, { ...value, email: "other" })).toBe(0);
      expect(changed.has(changed(value, { ...value, status: "blocked" }), "status")).toBe(true);
    });

    it("follows a dotted path and survives a nullish parent", () => {
      const changed = JIT.compare.changed(User).select("profile.name");

      expect(changed(value, { ...value, profile: { name: "Ada", bio: "different" } })).toBe(0);
      expect(changed.has(changed(value, { ...value, profile: { name: "Grace", bio: "b" } }), "profile.name")).toBe(
        true
      );
      expect(changed.has(changed(value, { ...value, profile: null }), "profile.name")).toBe(true);
      expect(changed({ ...value, profile: null }, { ...value, profile: null })).toBe(0);
    });

    it("answers false for a path it does not watch", () => {
      const changed = JIT.compare.changed(User).select("status");

      // @ts-expect-error — "email" is not watched by this mask
      expect(changed.has(changed(value, { ...value, email: "other" }), "email")).toBe(false);
    });
  });

  /**
   * A number mask silently drops bit 32 and beyond, which would report a real
   * change as no change. Widening is the only safe answer.
   */
  describe("representation", () => {
    const wide = JIT.object(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, JIT.number()])));
    const wideValue = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, i]));

    it("stays a number up to 31 fields", () => {
      const narrow = JIT.object(Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`f${i}`, JIT.number()])));

      expect(typeof JIT.compare.changed(narrow)({}, {})).toBe("number");
    });

    it("widens past 31 fields rather than losing a bit", () => {
      const changed = JIT.compare.changed(wide);
      const mask = changed(wideValue, { ...wideValue, f35: 999 });

      expect(typeof mask).toBe("bigint");
      expect(changed.has(mask, "f35")).toBe(true);
      expect(changed.has(mask, "f2")).toBe(false);
    });
  });

  describe("generated source", () => {
    it("compares scalars in place and defers only structural fields", () => {
      const source = sourceOf(JIT.compare.changed(User));

      expect(source).toContain("if (left.id !== right.id) mask |= 1;");
      expect(source).toContain("if (left.email !== right.email) mask |= 2;");
      expect(source).toContain("__changedEqual3(left.tags, right.tags)");
      expect(source).not.toContain("Object.keys");
      expect(source).not.toContain("for (");
    });

    it("allocates nothing and returns a primitive", () => {
      const source = sourceOf(JIT.compare.changed(User));

      expect(source).not.toContain("= {}");
      expect(source).not.toContain("= [];");
      expect(source).not.toContain("push(");
    });

    it("returns early for the same reference before reading a field", () => {
      expect(sourceOf(JIT.compare.changed(User))).toContain("if (left === right) return 0;");
    });
  });
});

describe("JIT.watch with a field subset", () => {
  const Users = JIT.array(User);
  const previous = [value];

  it("reports an update only when a named field moved", () => {
    const byName = JIT.watch(Users, { key: "id", fields: ["status"] });

    expect(byName(previous, [{ ...value, email: "other@x.com" }]).updatedItems).toHaveLength(0);
    expect(byName(previous, [{ ...value, status: "blocked" }]).updatedItems).toHaveLength(1);
  });

  /** The existing behavior has to stay exactly as it was when no subset is named. */
  it("still compares by reference when no fields are named", () => {
    const byReference = JIT.watch(Users, { key: "id" });

    expect(byReference(previous, [{ ...value }]).updatedItems).toHaveLength(1);
    expect(byReference(previous, previous).updatedItems).toHaveLength(0);
  });

  it("still reports additions and removals the same way", () => {
    const byName = JIT.watch(Users, { key: "id", fields: ["status"] });
    const result = byName(previous, [{ ...value, id: 2 }]);

    expect(result.newItems).toHaveLength(1);
    expect(result.removedItems).toHaveLength(1);
  });
});
