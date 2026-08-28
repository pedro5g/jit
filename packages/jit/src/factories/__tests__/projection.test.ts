import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

const Profile = JIT.object({ name: JIT.string(), bio: JIT.string(), avatar: JIT.string() });
const User = JIT.object({
  id: JIT.number().int(),
  email: JIT.string(),
  status: JIT.string(),
  secret: JIT.string(),
  profile: Profile,
  optionalProfile: JIT.optional(Profile),
  nullableProfile: JIT.nullable(Profile),
});
type User = JIT.Typeof<typeof User>;

const value: User = {
  id: 1,
  email: "ada@x.com",
  status: "active",
  secret: "shh",
  profile: { name: "Ada", bio: "b", avatar: "a" },
  optionalProfile: undefined,
  nullableProfile: null,
};

function projectSourceOf(plan: object): string {
  const artifact = getArtifact(plan);

  if (artifact?.kind !== "project-plan") throw new Error("project plan not registered");
  return Compiler.emitProjectSource(artifact.tree);
}

describe("JIT.project", () => {
  it("fuses conditional field authorization into static property assignments", () => {
    const Actor = JIT.object({ id: JIT.number() });
    const access = JIT.access(User)
      .actor(Actor)
      .can("read", { fields: ["id", "status"] })
      .can("read", {
        fields: ["email"],
        when: (query, actor) => query.eq("id", actor.field("id")),
      });
    const own = JIT.project(User).authorize(access({ id: 1 }), "read");
    const other = JIT.project(User).authorize(access({ id: 2 }), "read");

    expect(own(value)).toEqual({ id: 1, email: "ada@x.com", status: "active" });
    expect(other(value)).toEqual({ id: 1, status: "active" });
    expectTypeOf(own(value)).toEqualTypeOf<Partial<User>>();
  });

  it("keeps only the named fields", () => {
    const project = JIT.project(User).select("id", "status");

    expect(project(value)).toEqual({ id: 1, status: "active" });
  });

  it("narrows a nested object rather than pulling it whole", () => {
    const project = JIT.project(User).select("id", "profile.name");

    expect(project(value)).toEqual({ id: 1, profile: { name: "Ada" } });
  });

  it("keeps a nullish parent nullish instead of reading through it", () => {
    const optional = JIT.project(User).select("optionalProfile.name");
    const nullable = JIT.project(User).select("nullableProfile.name");

    expect(optional(value)).toEqual({ optionalProfile: undefined });
    expect(nullable(value)).toEqual({ nullableProfile: null });
    expect(optional({ ...value, optionalProfile: { name: "Grace", bio: "", avatar: "" } })).toEqual({
      optionalProfile: { name: "Grace" },
    });
  });

  it("resolves a parent named twice once", () => {
    const project = JIT.project(User).select("profile.name", "profile.bio");

    expect(project(value)).toEqual({ profile: { name: "Ada", bio: "b" } });
  });

  it("rejects a field the schema does not declare", () => {
    // @ts-expect-error — "missing" is not a field of User
    expect(() => JIT.project(User).select("missing")).toThrow(/does not declare/);
  });

  it("rejects an empty selection", () => {
    expect(() => JIT.project(User).select()).toThrow(/at least one field/);
  });

  describe("generated source", () => {
    it("builds one object literal over static keys", () => {
      const source = projectSourceOf(JIT.project(User).select("id", "status"));

      expect(source).toContain('return { "id": value.id, "status": value.status };');
      expect(source).not.toContain("Object.keys");
      expect(source).not.toContain("for (");
      expect(source).not.toContain("delete ");
    });

    it("never mentions a field that was not selected", () => {
      const source = projectSourceOf(JIT.project(User).select("id"));

      expect(source).not.toContain("secret");
      expect(source).not.toContain("email");
    });
  });
});

describe("JIT.compare.equal().select()", () => {
  it("compares only the named fields", () => {
    const equal = JIT.compare.equal(User).select("id", "status");

    expect(equal(value, { ...value, secret: "other", email: "other@x.com" })).toBe(true);
    expect(equal(value, { ...value, status: "blocked" })).toBe(false);
  });

  it("follows a dotted path into a nested object", () => {
    const equal = JIT.compare.equal(User).select("profile.name");

    expect(equal(value, { ...value, profile: { name: "Ada", bio: "different", avatar: "different" } })).toBe(true);
    expect(equal(value, { ...value, profile: { name: "Grace", bio: "b", avatar: "a" } })).toBe(false);
  });

  it("still compares everything when nothing is selected", () => {
    const equal = JIT.compare.equal(User);

    expect(equal(value, { ...value, secret: "other" })).toBe(false);
  });

  /**
   * The point of the feature: unselected fields are not compared and then
   * discarded — they are absent from the generated comparison entirely.
   */
  it("does not read an unselected field at all", () => {
    const tree = Compiler.buildProjectionTree(User.schema, ["id", "status"], "test");
    const source = Compiler.emitEqualSource(tree.schema);

    expect(source).toContain("l.id !== r.id");
    expect(source).toContain("l.status !== r.status");
    expect(source).not.toContain("secret");
    expect(source).not.toContain("email");
    expect(source).not.toContain("profile");
  });

  it("throws on a field the schema does not declare", () => {
    // @ts-expect-error — "missing" is not a field of User
    expect(() => JIT.compare.equal(User).select("missing")).toThrow(/does not declare/);
  });
});

describe("the shared projection tree", () => {
  /**
   * Query select, standalone projection and selective comparison are the same
   * question asked three ways. They must resolve it identically, or a field
   * that is compared would not be the field that was projected.
   */
  it("resolves the same paths the same way for every consumer", () => {
    const paths = ["id", "profile.name"] as const;
    const tree = Compiler.buildProjectionTree(User.schema, paths, "test");

    expect(tree.paths).toEqual(["id", "profile.name"]);
    expect(Object.keys(tree.schema.def.props)).toEqual(["id", "profile"]);
  });

  it("drops unknown keys and a catchall so a projection cannot leak a field", () => {
    const Loose = JIT.object({ id: JIT.number(), name: JIT.string() }).loose();
    const tree = Compiler.buildProjectionTree(Loose.schema, ["id"], "test");

    expect(tree.schema.def.unknownKeys).toBe("strip");
    expect(tree.schema.def.catchall).toBeUndefined();
  });

  it("keeps a nullable parent nullable in the derived schema", () => {
    const tree = Compiler.buildProjectionTree(User.schema, ["nullableProfile.name"], "test");
    const field = tree.schema.def.props.nullableProfile;

    expect(field).toBeDefined();
    expect(Compiler.emitProjectSource(tree)).toContain("== null ?");
  });
});
