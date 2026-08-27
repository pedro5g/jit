import { expectTypeOf } from "vitest";

import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

const Event = JIT.discriminatedUnion("type", [
  JIT.object({ type: JIT.literal("created"), id: JIT.number().int() }),
  JIT.object({ type: JIT.literal("updated"), id: JIT.number().int(), field: JIT.string() }),
  JIT.object({ type: JIT.literal("deleted"), id: JIT.number().int() }),
]);

function sourceOf(plan: object): string {
  const artifact = getArtifact(plan);

  if (artifact?.kind !== "match-plan") throw new Error("match plan not registered");
  return Compiler.emitMatchSource(artifact.descriptor);
}

describe("JIT.match", () => {
  const handle = JIT.match(Event)
    .case("created", (event) => `created ${event.id}`)
    .case("updated", (event) => `updated ${event.id}.${event.field}`)
    .case("deleted", (event) => `deleted ${event.id}`)
    .exhaustive();

  it("dispatches to the case for the value's tag", () => {
    expect(handle({ type: "created", id: 1 })).toBe("created 1");
    expect(handle({ type: "updated", id: 2, field: "name" })).toBe("updated 2.name");
    expect(handle({ type: "deleted", id: 3 })).toBe("deleted 3");
  });

  /** The narrowing is the reason to reach for this over a switch by hand. */
  it("narrows the value to the member the case is for", () => {
    const narrowed = JIT.match(Event)
      .case("updated", (event) => event.field)
      .otherwise(() => "none");

    expect(narrowed({ type: "updated", id: 1, field: "title" })).toBe("title");
  });

  it("falls through to otherwise for a tag with no case", () => {
    const partial = JIT.match(Event)
      .case("created", (event) => `c${event.id}`)
      .otherwise(() => "other");

    expect(partial({ type: "created", id: 1 })).toBe("c1");
    expect(partial({ type: "deleted", id: 9 })).toBe("other");
  });

  describe("exhaustiveness", () => {
    it("refuses to close a match that is missing a tag", () => {
      const incomplete = JIT.match(Event).case("created", (event) => event.id);

      expect(() => incomplete.exhaustive()).toThrow(/missing a case for "updated", "deleted"/);
    });

    /**
     * The type-level half of the same guard: an incomplete match does not close
     * into a callable, so the omission is visible in an editor and not only at
     * declaration time.
     */
    it("does not type an incomplete match as callable", () => {
      const incomplete = JIT.match(Event).case("created", (event) => event.id);
      type Closed = ReturnType<typeof incomplete.exhaustive>;

      expectTypeOf<Closed>().toEqualTypeOf<{ readonly missing: "updated" | "deleted" }>();
    });

    it("refuses a case for a tag the union does not declare", () => {
      expect(() =>
        JIT.match(Event)
          // @ts-expect-error — "invented" is not a member of the union
          .case("invented", () => 1)
          .otherwise(() => 0)
      ).toThrow(/does not declare/);
    });

    it("throws at run time when a value carries a tag from outside the union", () => {
      expect(() => handle({ type: "smuggled", id: 1 } as never)).toThrow(/unmatched type: smuggled/);
    });
  });

  it("requires a discriminated union", () => {
    expect(() => JIT.match(JIT.object({ id: JIT.number() })).otherwise(() => 1)).toThrow(
      /requires a discriminated union/
    );
  });

  describe("generated source", () => {
    /** The claim: a switch over literals, not a handler map looked up per call. */
    it("switches on the discriminator", () => {
      const source = sourceOf(handle);

      expect(source).toContain("switch (value.type)");
      expect(source).toContain('case "created":');
      expect(source).not.toContain("Object.keys");
      expect(source).not.toContain("handlers[");
      expect(source).not.toContain(".find(");
      expect(source).not.toContain("for (");
    });

    it("throws rather than falling through when the match is exhaustive", () => {
      expect(sourceOf(handle)).toContain("throw new Error");
    });

    it("emits the fallback as the default when one was given", () => {
      const partial = JIT.match(Event)
        .case("created", () => 1)
        .otherwise(() => 0);

      expect(sourceOf(partial)).toContain("return __fallback(value);");
      expect(sourceOf(partial)).not.toContain("throw new Error");
    });
  });
});
