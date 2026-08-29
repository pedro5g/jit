import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";
import { buildMutationPlan, isSpecializableMutation } from "../mutation/index.js";

const Address = JIT.object({ city: JIT.string(), zip: JIT.string() });
const Profile = JIT.object({ age: JIT.number(), address: Address, nickname: JIT.string().optional() });
const User = JIT.object({
  id: JIT.string(),
  name: JIT.string(),
  profile: Profile,
  settings: JIT.object({ theme: JIT.string() }),
  tags: JIT.array(JIT.string()),
});

const value = {
  id: "u_1",
  name: "Ada",
  profile: { age: 36, address: { city: "London", zip: "E1" }, nickname: undefined },
  settings: { theme: "dark" },
  tags: ["math"],
};

function sourceOf(mutate: unknown): string {
  const artifact = getArtifact(mutate as object);
  if (artifact?.kind !== "mutation-plan") throw new Error("expected a specialized mutation artifact");
  return artifact.source;
}

describe("MutationPlan", () => {
  it("rebuilds only the levels under a changed field", () => {
    const declared = JIT.state.update(User).patch({
      name: JIT.cqrs.param("name"),
      profile: { address: { city: JIT.cqrs.param("city") } },
    });
    const mutate = declared.compile();
    const next = mutate(value, { name: "Grace", city: "Baltimore" });

    expect(declared.explain()).toEqual({
      strategy: "specialized",
      reads: ["name", "profile.address.city"],
      writes: ["name", "profile.address.city"],
      params: ["name", "city"],
    });
    expect(next).toEqual({
      id: "u_1",
      name: "Grace",
      profile: { age: 36, address: { city: "Baltimore", zip: "E1" }, nickname: undefined },
      settings: { theme: "dark" },
      tags: ["math"],
    });
    expect(next).not.toBe(value);
    expect(next.profile).not.toBe(value.profile);
    expect(next.profile.address).not.toBe(value.profile.address);
    // Untouched branches keep their identity.
    expect(next.settings).toBe(value.settings);
    expect(next.tags).toBe(value.tags);
  });

  it("returns the original value when nothing semantically changed", () => {
    const mutate = JIT.state
      .update(User)
      .patch({ name: JIT.cqrs.param("name"), profile: { address: { city: JIT.cqrs.param("city") } } })
      .compile();

    expect(mutate(value, { name: "Ada", city: "London" })).toBe(value);
    // An absent parameter is not a write, exactly as in a deep-partial patch.
    expect(mutate(value, { name: undefined, city: undefined })).toBe(value);
    expect(mutate(value, { name: "Ada", city: "Paris" }).profile.address.city).toBe("Paris");
  });

  it("rebuilds a shared parent once for sibling writes", () => {
    const mutate = JIT.state
      .update(User)
      .patch({ profile: { age: JIT.cqrs.param("age"), address: { city: JIT.cqrs.param("city") } } })
      .compile();
    const source = sourceOf(mutate);
    const next = mutate(value, { age: 37, city: "Paris" });

    expect(next.profile.age).toBe(37);
    expect(next.profile.address.city).toBe("Paris");
    // One replacement per level, not one per write.
    expect(source.match(/l_profile_next = \{/g)).toHaveLength(1);
    expect(source.match(/l_profile_address_next = \{/g)).toHaveLength(1);
  });

  it("keeps only the last write to one path", () => {
    const plan = buildMutationPlan(
      JIT.object({ name: JIT.string() }).schema,
      [
        { path: ["name"], value: { kind: "binding", index: 0 } },
        { path: ["name"], value: { kind: "binding", index: 1 } },
      ],
      ["first", "second"]
    );

    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]?.value).toEqual({ kind: "binding", index: 1 });
    expect(plan.dependencies.writes).toEqual([["name"]]);
  });

  it("plans nothing for a mutation that writes nothing", () => {
    const plan = buildMutationPlan(JIT.object({ name: JIT.string() }).schema, [], []);

    expect(plan.root).toBeUndefined();
    expect(plan.dependencies).toEqual({ reads: [], writes: [] });
  });

  it("does not discover the shape at run time", () => {
    const source = sourceOf(
      JIT.state
        .update(User)
        .patch({ profile: { address: { zip: JIT.cqrs.param("zip") } } })
        .compile()
    );

    expect(source).not.toContain("Object.keys");
    expect(source).not.toContain("for (");
    expect(source).not.toContain("for(");
    expect(source).not.toContain("in ");
    expect(source).not.toContain("...");
    // Allocation follows the decision; it does not precede it.
    expect(source.indexOf("_changed =")).toBeLessThan(source.indexOf("_next = {"));
  });

  it("declines to specialize a leaf the deep-partial update would merge", () => {
    const object = JIT.state.update(User).patch({ settings: JIT.cqrs.param("settings") });
    const array = JIT.state.update(User).patch({ tags: JIT.cqrs.param("tags") });

    expect(object.explain().strategy).toBe("generic");
    expect(array.explain().strategy).toBe("generic");
    expect(isSpecializableMutation(User.schema, [["settings"]])).toBe(false);
    expect(isSpecializableMutation(User.schema, [["tags"]])).toBe(false);
    expect(isSpecializableMutation(User.schema, [["profile", "nickname"]])).toBe(true);
    // An intermediate level that may be absent would have to be created first.
    const Optional = JIT.object({ profile: Profile.optional() });
    expect(isSpecializableMutation(Optional.schema, [["profile", "age"]])).toBe(false);
  });

  it("compares dates by instant and copies them on write", () => {
    const Event = JIT.object({ id: JIT.string(), at: JIT.date() });
    const mutate = JIT.state
      .update(Event)
      .patch({ at: JIT.cqrs.param("at") })
      .compile();
    const current = { id: "e_1", at: new Date("2026-01-01T00:00:00.000Z") };

    expect(mutate(current, { at: new Date("2026-01-01T00:00:00.000Z") })).toBe(current);
    const moved = mutate(current, { at: new Date("2026-02-01T00:00:00.000Z") });
    expect(moved.at.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(moved.at).not.toBe(current.at);
  });

  describe("result channels", () => {
    const declared = JIT.state
      .update(User)
      .patch({ name: JIT.cqrs.param("name"), profile: { address: { city: JIT.cqrs.param("city") } } });
    const applyPatch = JIT.state.patch.apply(User);

    it("produces the mask compare.changed produces, in the same pass", () => {
      const mutate = declared.result({ value: true, changed: true }).compile();
      const changed = JIT.compare.changed(User);
      const result = mutate(value, { name: "Grace", city: "Paris" });

      expect(result.changed).toBe(changed(value, result.value));
      expect(mutate(value, { name: "Ada", city: "London" }).changed).toBe(0);
      // The mask is only meaningful next to the layout it was made against.
      expect(mutate.layout()?.paths).toEqual(["id", "name", "profile", "settings", "tags"]);
      const narrow = declared.result({ changed: ["profile.address.city"] }).compile();
      expect(narrow.layout()?.paths).toEqual(["profile.address.city"]);
      expect(narrow(value, { name: "Grace", city: "Paris" }).changed).toBe(1);
      expect(narrow(value, { name: "Grace", city: "London" }).changed).toBe(0);
    });

    it("round-trips through the forward and inverse patches", () => {
      const mutate = declared.result({ value: true, patch: true, inverse: true }).compile();
      const result = mutate(value, { name: "Grace", city: "Paris" });

      expect(result.patch).toEqual({ name: "Grace", profile: { address: { city: "Paris" } } });
      expect(result.inverse).toEqual({ name: "Ada", profile: { address: { city: "London" } } });
      expect(applyPatch(value, result.patch as never)).toEqual(result.value);
      expect(applyPatch(result.value, result.inverse as never)).toEqual(value);
    });

    it("allocates no patch for a mutation that changed nothing", () => {
      const mutate = declared.result({ value: true, changed: true, patch: true, inverse: true }).compile();
      const result = mutate(value, { name: "Ada", city: "London" });

      expect(result.value).toBe(value);
      expect(result.changed).toBe(0);
      expect(result.patch).toBeUndefined();
      expect(result.inverse).toBeUndefined();
    });

    it("does not generate an output nobody asked for", () => {
      const only = (channels: Parameters<typeof declared.result>[0]) => {
        const artifact = getArtifact(declared.result(channels).compile() as object);
        if (artifact?.kind !== "mutation-plan") throw new Error("expected a specialized mutation artifact");
        return artifact.source;
      };

      expect(only({ value: true })).not.toContain("mask");
      expect(only({ value: true })).not.toContain("patch");
      expect(only({ value: true })).not.toContain("inverse");
      expect(only({ changed: true })).toContain("mask |=");
      expect(only({ changed: true })).not.toContain("_patch");
      expect(only({ patch: true })).toContain("_patch");
      expect(only({ patch: true })).not.toContain("_inverse");
      expect(only({ patch: true })).not.toContain("mask");
      expect(only({ inverse: true })).toContain("_inverse");
      expect(only({ inverse: true })).not.toContain("_patch =");
    });

    it("refuses channels a generic patch cannot produce", () => {
      expect(() =>
        JIT.state
          .update(User)
          .patch({ settings: JIT.cqrs.param("settings") })
          .result({ changed: true })
      ).toThrow(/specialized mutation/i);
    });

    it("round-trips on every input, against the update it specializes", () => {
      const mutate = declared.result({ value: true, changed: true, patch: true, inverse: true }).compile();
      const changed = JIT.compare.changed(User);

      fc.assert(
        fc.property(
          fc.option(fc.string(), { nil: undefined }),
          fc.option(fc.string(), { nil: undefined }),
          fc.string(),
          fc.string(),
          (name, city, currentName, currentCity) => {
            const current = {
              ...value,
              name: currentName,
              profile: { ...value.profile, address: { city: currentCity, zip: "E1" } },
            };
            const result = mutate(current, { name, city });

            expect(result.changed).toBe(changed(current, result.value));
            if (result.patch === undefined) {
              expect(result.value).toBe(current);
              return;
            }
            expect(applyPatch(current, result.patch as never)).toEqual(result.value);
            expect(applyPatch(result.value, result.inverse as never)).toEqual(current);
          }
        ),
        { numRuns: 400 }
      );
    });
  });

  it("agrees with the generic deep-partial update on every input", () => {
    const mutate = JIT.state
      .update(User)
      .patch({ name: JIT.cqrs.param("name"), profile: { address: { city: JIT.cqrs.param("city") } } })
      .compile();
    const generic = JIT.state.update(User).compile();

    fc.assert(
      fc.property(
        fc.option(fc.string(), { nil: undefined }),
        fc.option(fc.string(), { nil: undefined }),
        fc.string(),
        fc.string(),
        (name, city, currentName, currentCity) => {
          const current = {
            ...value,
            name: currentName,
            profile: { ...value.profile, address: { city: currentCity, zip: "E1" } },
          };
          const specialized = mutate(current, { name, city });
          const reference = generic(current, { name, profile: { address: { city } } });

          expect(specialized).toEqual(reference);
          // Reference identity has to agree too, not only the value.
          expect(specialized === current).toBe(reference === current);
          expect(specialized.settings === current.settings).toBe(true);
        }
      ),
      { numRuns: 400 }
    );
  });
});
