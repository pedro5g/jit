import { describe, expect, it } from "vitest";
import { JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

const AppState = JIT.object({
  user: JIT.object({ name: JIT.string(), status: JIT.string(), tags: JIT.array(JIT.string()) }),
  cart: JIT.object({ items: JIT.number() }),
});

const state = {
  user: { name: "Ada", status: "active", tags: ["math"] },
  cart: { items: 2 },
};

function sourceOf(selector: unknown): string {
  const artifact = getArtifact(selector as object);
  if (artifact?.kind !== "derived-plan") throw new Error("expected a derived plan artifact");
  return artifact.source;
}

describe("JIT.state.derive", () => {
  it("infers its dependencies from what it selects", () => {
    const header = JIT.state.derive(AppState).select("user.name", "user.status");

    expect(header.explain().reads).toEqual(["user.name", "user.status"]);
    expect(header.explain().layout.paths).toEqual(["user", "cart"]);
    // It depends on the `user` bit and not on the `cart` bit.
    expect(header.explain().mask).toBe(1);
    expect(header(state)).toEqual({ name: "Ada", status: "active" });
  });

  it("recomputes only when a field it reads changed", () => {
    const memo = JIT.state.derive(AppState).select("user.name", "user.status").memo();
    const first = memo(state);

    // Same reference in: the cheapest answer, no reads at all.
    expect(memo(state)).toBe(first);
    // A new state object whose selected fields are equal: still no recompute.
    expect(memo({ ...state, cart: { items: 3 } })).toBe(first);
    expect(memo({ ...state, user: { ...state.user } })).toBe(first);
    // A field it reads actually changed.
    const renamed = memo({ ...state, user: { ...state.user, name: "Grace" } });
    expect(renamed).not.toBe(first);
    expect(renamed).toEqual({ name: "Grace", status: "active" });
  });

  it("compares a structural dependency with the schema's own equality", () => {
    const tags = JIT.state.derive(AppState).select("user.tags").memo();
    const first = tags(state);

    expect(sourceOf(tags)).toContain("__derivedEqual0(");
    // A rebuilt but equal array is not a change.
    expect(tags({ ...state, user: { ...state.user, tags: ["math"] } })).toBe(first);
    expect(tags({ ...state, user: { ...state.user, tags: ["math", "art"] } })).not.toBe(first);
  });

  it("skips the comparison entirely when the mask says nothing it reads moved", () => {
    const memo = JIT.state.derive(AppState).select("user.name").memo();
    const mutate = JIT.state
      .update(AppState)
      .patch({ cart: { items: JIT.cqrs.param("items") } })
      .result({ value: true, changed: true })
      .compile();
    const first = memo(state);
    const result = mutate(state, { items: 9 });

    expect(memo.accepts(mutate.layout() as never)).toBe(true);
    expect(result.changed).toBe(2);
    // The mask names only `cart`, so the selector answers without reading.
    expect(memo(result.value, result.changed)).toBe(first);
    // And it is still correct once the state it reads does change.
    const renamed = JIT.state
      .update(AppState)
      .patch({ user: { name: JIT.cqrs.param("name") } })
      .result({ value: true, changed: true })
      .compile()(result.value, { name: "Grace" });
    expect(memo(renamed.value, renamed.changed)).toEqual({ name: "Grace" });
  });

  it("reports whether a mask came from a compatible agreement", () => {
    const memo = JIT.state.derive(AppState).select("user.name").memo();
    const narrow = JIT.state
      .derive(AppState, { layout: JIT.state.derive(AppState).select("user.name").explain().layout })
      .select("user.name")
      .memo();
    const other = JIT.compare.changed(AppState).select("cart");

    expect(memo.accepts(narrow.layout())).toBe(true);
    expect(memo.layout().id).toBe("int32:user,cart");
    // A mask over different paths is a different number; saying so is the point
    // of giving the agreement an identity.
    expect(memo.accepts({ paths: ["cart"], representation: "int32", id: "int32:cart" })).toBe(false);
    // A mask over different paths is a different number for the same change.
    expect(other(state, { ...state, cart: { items: 3 } })).toBe(1);
    expect(JIT.compare.changed(AppState)(state, { ...state, cart: { items: 3 } })).toBe(2);
  });

  it("refuses a selection it cannot turn into a value", () => {
    expect(() => JIT.state.derive(AppState).select()).toThrow(/at least one path/i);
    // Two paths ending in the same key would collide in the derived value.
    const Colliding = JIT.object({
      left: JIT.object({ name: JIT.string() }),
      right: JIT.object({ name: JIT.string() }),
    });
    expect(() => JIT.state.derive(Colliding).select("left.name", "right.name")).toThrow(/already takes/i);
    // @ts-expect-error a derived path has to exist on the state
    expect(() => JIT.state.derive(AppState).select("user.missing")).toThrow();
  });

  it("never compares the whole state", () => {
    const source = sourceOf(JIT.state.derive(AppState).select("user.name").memo());

    expect(source).not.toContain("cart");
    expect(source).toContain("state.user?.name");
    expect(source).not.toContain("Object.keys");
  });
});
