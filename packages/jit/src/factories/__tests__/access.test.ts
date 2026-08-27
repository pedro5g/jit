import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

const User = JIT.object({ id: JIT.number().int(), role: JIT.string() });
const Post = JIT.object({
  id: JIT.number().int(),
  authorId: JIT.number().int(),
  locked: JIT.boolean(),
  title: JIT.string(),
  body: JIT.string(),
});
type Post = JIT.Typeof<typeof Post>;

const ada = { id: 1, role: "user" };
const grace = { id: 2, role: "user" };
const post: Post = { id: 10, authorId: 1, locked: false, title: "t", body: "b" };
const locked: Post = { ...post, locked: true };

function sourceOf(plan: object): string {
  const artifact = getArtifact(plan);

  if (artifact?.kind !== "access-plan") throw new Error("access plan not registered");
  return Compiler.emitAccessSource(artifact.descriptor);
}

describe("JIT.access", () => {
  /** Nothing is permitted by omission — that is the whole security posture. */
  describe("default deny", () => {
    it("refuses an action no rule mentions", () => {
      const ability = JIT.access(Post).actor(User).can("read")(ada);

      // @ts-expect-error — "delete" has no rule, so it is not an action
      expect(ability.can("delete", post)).toBe(false);
    });

    it("refuses everything when no rule was declared at all", () => {
      const ability = JIT.access(Post).actor(User)(ada);

      // @ts-expect-error — this ability declares no actions
      expect(ability.can("read", post)).toBe(false);
    });
  });

  it("permits an unconditional action, with or without a subject", () => {
    const ability = JIT.access(Post).actor(User).can("read")(ada);

    expect(ability.can("read", post)).toBe(true);
    expect(ability.can("read")).toBe(true);
  });

  it("checks a condition against the subject and the actor", () => {
    const plan = JIT.access(Post)
      .actor(User)
      .can("update", (query, actor) => query.eq("authorId", actor.field("id")));

    expect(plan(ada).can("update", post)).toBe(true);
    expect(plan(grace).can("update", post)).toBe(false);
  });

  it("compares against a literal", () => {
    const plan = JIT.access(Post)
      .actor(User)
      .can("read", (query) => query.eq("locked", false));

    expect(plan(ada).can("read", post)).toBe(true);
    expect(plan(ada).can("read", locked)).toBe(false);
  });

  it("combines conditions with and, or and not", () => {
    const plan = JIT.access(Post)
      .actor(User)
      .can("read", (query, actor) =>
        query.or(query.eq("authorId", actor.field("id")), query.not(query.eq("locked", true)))
      );

    expect(plan(grace).can("read", post)).toBe(true);
    expect(plan(grace).can("read", locked)).toBe(false);
    expect(plan(ada).can("read", locked)).toBe(true);
  });

  describe("precedence", () => {
    /** The rule that decides the security question: a prohibition wins. */
    it("lets cannot override a can that matched the same action", () => {
      const plan = JIT.access(Post)
        .actor(User)
        .can("delete", (query, actor) => query.eq("authorId", actor.field("id")))
        .cannot("delete", (query) => query.eq("locked", true));

      expect(plan(ada).can("delete", post)).toBe(true);
      expect(plan(ada).can("delete", locked)).toBe(false);
    });

    it("does not depend on the order the rules were declared in", () => {
      const denyFirst = JIT.access(Post)
        .actor(User)
        .cannot("delete", (query) => query.eq("locked", true))
        .can("delete", (query, actor) => query.eq("authorId", actor.field("id")));
      const allowFirst = JIT.access(Post)
        .actor(User)
        .can("delete", (query, actor) => query.eq("authorId", actor.field("id")))
        .cannot("delete", (query) => query.eq("locked", true));

      for (const subject of [post, locked]) {
        expect(denyFirst(ada).can("delete", subject)).toBe(allowFirst(ada).can("delete", subject));
      }
    });

    it("treats several can rules for one action as alternatives", () => {
      const plan = JIT.access(Post)
        .actor(User)
        .can("read", (query, actor) => query.eq("authorId", actor.field("id")))
        .can("read", (query) => query.eq("locked", false));

      expect(plan(grace).can("read", post)).toBe(true);
      expect(plan(grace).can("read", locked)).toBe(false);
      expect(plan(ada).can("read", locked)).toBe(true);
    });

    it("answers cannot as the exact negation of can", () => {
      const plan = JIT.access(Post)
        .actor(User)
        .can("delete", (query, actor) => query.eq("authorId", actor.field("id")));

      for (const subject of [post, locked]) {
        expect(plan(ada).cannot("delete", subject)).toBe(!plan(ada).can("delete", subject));
      }
    });
  });

  describe("field rules", () => {
    const plan = JIT.access(Post)
      .actor(User)
      .can("update", (query, actor) => query.eq("authorId", actor.field("id")))
      .cannot("update", { fields: ["body"] });

    it("denies a named field while allowing the others", () => {
      expect(plan(ada).can("update", post, "title")).toBe(true);
      expect(plan(ada).can("update", post, "body")).toBe(false);
    });

    /** A field-scoped prohibition must not block the whole action. */
    it("still permits the action when asked without a field", () => {
      expect(plan(ada).can("update", post)).toBe(true);
    });

    it("scopes a permission to its own fields", () => {
      const scoped = JIT.access(Post)
        .actor(User)
        .can("update", { fields: ["title"] });

      expect(scoped(ada).can("update", post, "title")).toBe(true);
      expect(scoped(ada).can("update", post, "body")).toBe(false);
      // Asking about the action at all still passes: there is a field it covers.
      expect(scoped(ada).can("update", post)).toBe(true);
    });

    it("combines a field scope with a condition", () => {
      const scoped = JIT.access(Post)
        .actor(User)
        .can("publish", { fields: ["title"], when: (query, actor) => query.eq("authorId", actor.field("id")) });

      expect(scoped(ada).can("publish", post, "title")).toBe(true);
      expect(scoped(grace).can("publish", post, "title")).toBe(false);
      expect(scoped(ada).can("publish", post, "body")).toBe(false);
    });

    it("rejects a field the subject does not declare", () => {
      const declare = () =>
        JIT.access(Post)
          .actor(User)
          // @ts-expect-error — "missing" is not a field of Post
          .can("update", { fields: ["missing"] });

      expect(declare).toThrow(/does not declare/);
    });
  });

  describe("field projection", () => {
    it("reports every field when an unconditional rule restricts nothing", () => {
      expect(JIT.access(Post).actor(User).can("read").fields("read")).toBeUndefined();
    });

    it("reports the union of the fields unconditional rules allow", () => {
      const plan = JIT.access(Post)
        .actor(User)
        .can("read", { fields: ["title"] })
        .can("read", { fields: ["id"] });

      expect(plan.fields("read")).toEqual(["title", "id"]);
    });

    it("removes what an unconditional prohibition denies", () => {
      const plan = JIT.access(Post)
        .actor(User)
        .can("read")
        .cannot("read", { fields: ["body"] });

      expect(plan.fields("read")).toEqual(["id", "authorId", "locked", "title"]);
    });

    /** A conditional rule needs a subject, so it cannot answer this statically. */
    it("contributes nothing from a conditional rule", () => {
      const plan = JIT.access(Post)
        .actor(User)
        .can("read", (query, actor) => query.eq("authorId", actor.field("id")));

      expect(plan.fields("read")).toEqual([]);
    });
  });

  it("names every action any rule mentions", () => {
    const plan = JIT.access(Post).actor(User).can("read").can("update").cannot("update");

    expect(plan.actions).toEqual(["read", "update"]);
  });

  describe("generated source", () => {
    const plan = JIT.access(Post)
      .actor(User)
      .can("read")
      .can("update", (query, actor) => query.eq("authorId", actor.field("id")))
      .cannot("delete", (query) => query.eq("locked", true));

    /**
     * The claim the feature rests on: actions are known, so a check is a switch
     * over literals — never a scan of a rule array.
     */
    it("dispatches on the action instead of scanning rules", () => {
      const source = sourceOf(plan);

      expect(source).toContain("switch (action)");
      expect(source).toContain('case "read":');
      expect(source).not.toContain(".filter(");
      expect(source).not.toContain(".find(");
      expect(source).not.toContain("for (");
      expect(source).not.toContain("rules");
    });

    it("reads the subject and the actor directly", () => {
      expect(sourceOf(plan)).toContain("subject.authorId === actor.id");
    });

    it("ends in a default deny", () => {
      const source = sourceOf(plan);

      expect(source).toContain("default:");
      expect(source.slice(source.indexOf("default:"))).toContain("return false;");
    });

    it("emits no case for an action nobody declared", () => {
      expect(sourceOf(plan)).not.toContain('case "archive"');
    });
  });
});
